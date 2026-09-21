import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AutoPlayerPolicy } from '../../src/application/AutoPlayerPolicy.js';
import { GameService } from '../../src/application/GameService.js';
import { RoomService } from '../../src/application/RoomService.js';
import { InMemoryRoomRepository } from '../../src/infrastructure/InMemoryRoomRepository.js';
import { SeatAuthenticator } from '../../src/infrastructure/SeatAuthenticator.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';
import { TokenFactory } from '../../src/infrastructure/TokenFactory.js';
import { STARTING_CASH } from '../../src/domain/game/Player.js';

/** 한 판에서 허용하는 최대 커맨드 수(무한 루프 방지). */
const MAX_COMMANDS = 20_000;
const SEEDS = [1, 7, 42, 99, 123, 2024, 31337, 65535, 777_777, 1_000_003];

const silentLogger = { error: () => {}, warn: () => {}, info: () => {} };
const noopPublisher = { publishRoom: () => {}, publishGame: () => {} };

/** 자동 진행 드라이버 없이 서비스만 조립한다(테스트가 직접 턴을 돌린다). */
function createHeadlessApp(seed) {
  const random = new SeededRandomSource(seed);
  const repository = new InMemoryRoomRepository({ random, logger: silentLogger });
  const authenticator = new SeatAuthenticator();
  const clock = { now: () => 1_700_000_000_000 };
  const common = { repository, random, authenticator, publisher: noopPublisher, clock, logger: silentLogger };

  return {
    repository,
    roomService: new RoomService({ ...common, tokenFactory: new TokenFactory() }),
    gameService: new GameService(common),
  };
}

/** 컴퓨터 4좌석이 앉은 방을 만들어 게임을 시작한다. */
async function startFourComputerGame(app, { roundLimit }) {
  const host = await app.roomService.createRoom({ hostName: '자동1' });
  const code = host.room.code;
  const token = host.seatToken;

  for (const name of ['자동2', '자동3', '자동4']) {
    await app.roomService.hostAction({ code, token, action: { type: 'ADD_COMPUTER', name } });
  }
  await app.roomService.hostAction({ code, token, action: { type: 'SET_OPTIONS', roundLimit } });
  // 호스트(사람 좌석)도 서버가 대신 진행하도록 자동 진행으로 돌린다 → 4좌석 모두 자동.
  await app.roomService.hostAction({
    code,
    token,
    action: { type: 'SET_AUTOPILOT', seatId: host.seatId, enabled: true },
  });
  await app.roomService.hostAction({ code, token, action: { type: 'START' } });
  return code;
}

/**
 * 자동 좌석들이 더 이상 진행할 수 없을 때까지 돌린다.
 * 매 커맨드마다 돈의 보존 불변식을 확인한다.
 */
async function playToEnd(app, code, policy) {
  let commands = 0;
  let lastRoom = await app.repository.findByCode(code);

  while (commands < MAX_COMMANDS) {
    const turn = await app.gameService.autoTurn(code);
    if (!turn) {
      break;
    }
    const decision = policy.decide(turn.view);
    assert.ok(decision, `결정할 수 없는 페이즈: ${turn.view.phase}`);

    await app.gameService.executeAsServer({
      code,
      seatId: turn.seatId,
      type: decision.type,
      payload: decision.payload,
    });
    commands += 1;

    lastRoom = await app.repository.findByCode(code);
    const report = lastRoom.game.moneyReport();
    assert.equal(
      report.balanced,
      true,
      `돈 보존 불변식 위반 (커맨드 ${commands}, ${decision.type}): ${JSON.stringify(report)}`,
    );
  }
  return { commands, room: lastRoom };
}

describe('E2E: 컴퓨터 4인 자동 대전', () => {
  for (const seed of SEEDS) {
    it(`시드 ${seed}: 예외 없이 게임이 끝나고 돈의 총량이 보존된다`, async () => {
      // Given
      const app = createHeadlessApp(seed);
      const policy = new AutoPlayerPolicy();
      const code = await startFourComputerGame(app, { roundLimit: 30 });

      // When
      const { commands, room } = await playToEnd(app, code, policy);

      // Then
      assert.equal(room.game.isOver(), true, `게임이 끝나지 않았습니다 (커맨드 ${commands}회)`);
      assert.equal(room.isFinished(), true);
      assert.ok(commands > 20, `너무 적은 커맨드로 끝났습니다: ${commands}`);

      const report = room.game.moneyReport();
      assert.equal(report.balanced, true, JSON.stringify(report));
      assert.equal(report.initialTotal, 4 * STARTING_CASH);
      assert.equal(report.actual, report.initialTotal + report.netFromBank);

      const rankings = room.game.rankings();
      assert.equal(rankings.length, 4);
      assert.deepEqual(
        rankings.map((entry) => entry.rank),
        [1, 2, 3, 4],
      );
      assert.equal(new Set(rankings.map((entry) => entry.playerId)).size, 4);
    });
  }

  it('라운드 제한이 없어도 파산으로 승자가 가려진다', async () => {
    // Given
    const app = createHeadlessApp(20_260_921);
    const policy = new AutoPlayerPolicy();
    const code = await startFourComputerGame(app, { roundLimit: null });

    // When
    const { room, commands } = await playToEnd(app, code, policy);

    // Then
    assert.equal(room.game.isOver(), true, `커맨드 ${commands}회 안에 끝나지 않았습니다`);
    assert.equal(room.game.rankings()[0].rank, 1);
    assert.equal(room.game.livingPlayers().length, 1);
    assert.equal(room.game.moneyReport().balanced, true);
  });

  it('여러 시드에서 모든 페이즈가 최소 한 번은 등장하고 모두 GAME_OVER에 닿는다', async () => {
    // Given
    const policy = new AutoPlayerPolicy();
    const seenPhases = new Set();
    const seeds = [3, 11, 77, 512, 4_096];
    const finished = [];

    // When
    for (const seed of seeds) {
      const app = createHeadlessApp(seed);
      const code = await startFourComputerGame(app, { roundLimit: 20 });
      let guard = 0;
      while (guard < MAX_COMMANDS) {
        const turn = await app.gameService.autoTurn(code);
        if (!turn) {
          break;
        }
        seenPhases.add(turn.view.phase);
        const decision = policy.decide(turn.view);
        assert.ok(decision, `시드 ${seed}: 결정할 수 없는 페이즈 ${turn.view.phase}`);
        await app.gameService.executeAsServer({
          code,
          seatId: turn.seatId,
          type: decision.type,
          payload: decision.payload,
        });
        guard += 1;
      }
      // 한 판이 끝날 때마다 실제로 종료됐는지, 돈이 보존됐는지 확인한다.
      const room = await app.repository.findByCode(code);
      assert.equal(room.game.isOver(), true, `시드 ${seed}: 커맨드 ${guard}회 안에 끝나지 않았습니다`);
      assert.equal(room.game.phase, 'GAME_OVER');
      assert.equal(room.isFinished(), true);
      assert.equal(room.game.moneyReport().balanced, true, `시드 ${seed}: 돈 보존 위반`);
      finished.push(seed);
    }

    // Then
    assert.deepEqual(finished, seeds, '모든 시드가 GAME_OVER에 닿아야 한다');
    for (const phase of ['AWAIT_ROLL', 'AWAIT_BUY', 'AWAIT_BUILD', 'AWAIT_ACQUIRE', 'AWAIT_CASINO']) {
      assert.ok(seenPhases.has(phase), `${phase} 페이즈가 한 번도 등장하지 않았습니다`);
    }
    assert.ok(seenPhases.has('GAME_OVER') === false, 'autoTurn은 끝난 게임을 돌려주지 않는다');
  });
});
