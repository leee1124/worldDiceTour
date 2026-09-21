import { AutoPlayerPolicy } from '../../src/application/AutoPlayerPolicy.js';
import { GameService } from '../../src/application/GameService.js';
import { RoomService } from '../../src/application/RoomService.js';
import { UnlimitedLimiter } from '../../src/application/RateLimiter.js';
import { InMemoryRoomRepository } from '../../src/infrastructure/InMemoryRoomRepository.js';
import { SeatAuthenticator } from '../../src/infrastructure/SeatAuthenticator.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';
import { TokenFactory } from '../../src/infrastructure/TokenFactory.js';

/** 한 판에서 허용하는 최대 커맨드 수(무한 루프 방지). */
export const MAX_COMMANDS = 20_000;

const silentLogger = { error: () => {}, warn: () => {}, info: () => {} };
const noopPublisher = { publishRoom: () => {}, publishGame: () => {}, closeRoom: () => {} };

/**
 * 자동 진행 드라이버 없이 서비스만 조립한다(테스트가 직접 턴을 돌린다).
 *
 * 레이트 리밋은 끈다 — 서버 대행 경로는 어차피 제한 대상이 아니고, e2e가 검증하려는 것은
 * 규칙이지 리밋이 아니다(리밋은 `marketAuthorization.test.js`가 따로 검증한다).
 */
export function createHeadlessApp(seed) {
  const random = new SeededRandomSource(seed);
  const repository = new InMemoryRoomRepository({ random, logger: silentLogger });
  const common = {
    repository,
    random,
    authenticator: new SeatAuthenticator(),
    publisher: noopPublisher,
    clock: { now: () => 1_700_000_000_000 },
    logger: silentLogger,
  };
  return {
    repository,
    roomService: new RoomService({ ...common, tokenFactory: new TokenFactory() }),
    gameService: new GameService({ ...common, tradeLimiter: new UnlimitedLimiter() }),
  };
}

/** 컴퓨터 4좌석이 앉은 방을 만들어 게임을 시작한다. */
export async function startFourComputerGame(app, { roundLimit, investmentMode = 'OFF' }) {
  const host = await app.roomService.createRoom({ hostName: '자동1' });
  const code = host.room.code;
  const token = host.seatToken;

  for (const name of ['자동2', '자동3', '자동4']) {
    await app.roomService.hostAction({ code, token, action: { type: 'ADD_COMPUTER', name } });
  }
  await app.roomService.hostAction({
    code,
    token,
    action: { type: 'SET_OPTIONS', roundLimit, finance: { investmentMode } },
  });
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
 * 자동 좌석들이 끝날 때까지 돌리며, 매 커맨드마다 `onCommand`를 부른다.
 * @returns {Promise<{commands:number, room:object, eventCounts:Map<string,number>}>}
 */
export async function playToEnd(app, code, { onCommand } = {}) {
  const policy = new AutoPlayerPolicy();
  const eventCounts = new Map();
  let commands = 0;
  let room = await app.repository.findByCode(code);

  while (commands < MAX_COMMANDS) {
    const turn = await app.gameService.autoTurn(code);
    if (!turn) {
      break;
    }
    const decision = policy.decide(turn.view);
    if (!decision) {
      throw new Error(`결정할 수 없는 페이즈: ${turn.view.phase}`);
    }
    const result = await app.gameService.executeAsServer({
      code,
      seatId: turn.seatId,
      type: decision.type,
      payload: decision.payload,
    });
    commands += 1;
    for (const event of result.events) {
      eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);
    }
    room = await app.repository.findByCode(code);
    onCommand?.({ commands, decision, room, view: result.view, events: result.events });
  }
  return { commands, room, eventCounts };
}
