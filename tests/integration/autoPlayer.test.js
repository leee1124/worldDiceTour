import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AutoPlayerPolicy } from '../../src/application/AutoPlayerPolicy.js';
import { toGameViewDto } from '../../src/application/dto.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { BUILDING_TYPES } from '../../src/domain/game/City.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { buildGame } from '../support/gameBuilder.js';
import { createAppFixture, startedRoom } from '../support/appFixture.js';

const policy = new AutoPlayerPolicy();
const decideFor = (game) => policy.decide(toGameViewDto(game));

describe('AutoPlayerPolicy(컴퓨터 의사결정)', () => {
  it('주사위 차례에는 굴린다', () => {
    // Given
    const game = buildGame({ random: new FakeRandomSource([1, 2]) });

    // When / Then
    assert.deepEqual(decideFor(game), { type: COMMAND_TYPES.ROLL });
  });

  it('현금이 가격의 2배 이상이면 매입한다', () => {
    // Given
    const game = buildGame({ random: new FakeRandomSource([1, 2]) });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.equal(game.phase, PHASES.AWAIT_BUY);
    assert.equal(decideFor(game).type, COMMAND_TYPES.BUY);
  });

  it('현금이 가격의 2배 미만이면 매입하지 않는다', () => {
    // Given
    const game = buildGame({ cash: { s1: 100_000 }, random: new FakeRandomSource([1, 2]) });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.equal(decideFor(game).type, COMMAND_TYPES.SKIP_BUY);
  });

  it('건설 후에도 최소 현금이 남는 범위에서 가장 비싼 조합을 고른다', () => {
    // Given (방콕: 별장 21,000 / 빌딩 42,000 / 호텔 63,000)
    const game = buildGame({
      cash: { s1: 400_000 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: new FakeRandomSource([1, 2]),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const decision = decideFor(game);

    // Then (예산 100,000원 → 호텔 63,000 + 별장 21,000)
    assert.equal(decision.type, COMMAND_TYPES.BUILD);
    assert.deepEqual(decision.payload.buildings, [BUILDING_TYPES.HOTEL, BUILDING_TYPES.VILLA]);
  });

  it('예산이 없으면 건설을 건너뛴다', () => {
    // Given
    const game = buildGame({
      cash: { s1: 310_000 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: new FakeRandomSource([1, 2]),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.equal(decideFor(game).type, COMMAND_TYPES.SKIP_BUILD);
  });

  it('랜드마크는 현금이 건설비의 2배 이상일 때만 짓는다', () => {
    // Given (방콕 랜드마크 70,000원)
    const rich = buildGame({
      cash: { s1: 200_000 },
      cities: [{ index: 3, ownerId: 's1', buildings: ['VILLA', 'BUILDING', 'HOTEL'] }],
      random: new FakeRandomSource([1, 2]),
    });
    const poor = buildGame({
      cash: { s1: 100_000 },
      cities: [{ index: 3, ownerId: 's1', buildings: ['VILLA', 'BUILDING', 'HOTEL'] }],
      random: new FakeRandomSource([1, 2]),
    });
    rich.execute('s1', COMMAND_TYPES.ROLL);
    poor.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.deepEqual(decideFor(rich).payload.buildings, [BUILDING_TYPES.LANDMARK]);
    assert.equal(decideFor(poor).type, COMMAND_TYPES.SKIP_BUILD);
  });

  it('출발 칸 보너스에서는 가장 비싼 내 도시를 고른다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 37 },
      cities: [
        { index: 1, ownerId: 's1' },
        { index: 39, ownerId: 's1' },
      ],
      random: new FakeRandomSource([1, 2]),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const decision = decideFor(game);

    // Then
    assert.equal(decision.type, COMMAND_TYPES.START_BUILD);
    assert.equal(decision.payload.cityIndex, 39);
  });

  it('인수 가격의 3배 이상 현금이 있으면 인수한다', () => {
    // Given (방콕 인수 가격 140,000원)
    const game = buildGame({
      cities: [{ index: 3, ownerId: 's2' }],
      random: new FakeRandomSource([1, 2]),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.equal(game.phase, PHASES.AWAIT_ACQUIRE);
    assert.equal(decideFor(game).type, COMMAND_TYPES.ACQUIRE);
  });

  it('현금이 인수 가격의 3배 미만이면 인수하지 않는다', () => {
    // Given
    const game = buildGame({
      cash: { s1: 300_000 },
      cities: [{ index: 3, ownerId: 's2' }],
      random: new FakeRandomSource([1, 2]),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.equal(decideFor(game).type, COMMAND_TYPES.SKIP_ACQUIRE);
  });

  it('카지노는 최소액으로 한 번만 걸고 그다음엔 떠난다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 20 },
      phase: PHASES.AWAIT_CASINO,
      casinoRoundsLeft: 3,
      random: new FakeRandomSource([3]),
    });

    // When
    const first = decideFor(game);
    game.execute('s1', COMMAND_TYPES.CASINO_BET, first.payload);

    // Then
    assert.equal(first.type, COMMAND_TYPES.CASINO_BET);
    assert.equal(first.payload.bet, 10_000);
    const second = buildGame({
      positions: { s1: 20 },
      phase: PHASES.AWAIT_CASINO,
      casinoRoundsLeft: 2,
      random: new FakeRandomSource([]),
    });
    assert.equal(decideFor(second).type, COMMAND_TYPES.CASINO_LEAVE);
  });

  it('조난 섬에서는 현금이 넉넉하면 구조비를 낸다', () => {
    // Given
    const rich = buildGame({
      positions: { s1: 10 },
      islandTurns: { s1: 3 },
      phase: PHASES.AWAIT_ISLAND_CHOICE,
      random: new FakeRandomSource([]),
    });
    const poor = buildGame({
      positions: { s1: 10 },
      islandTurns: { s1: 3 },
      cash: { s1: 300_000 },
      phase: PHASES.AWAIT_ISLAND_CHOICE,
      random: new FakeRandomSource([]),
    });

    // When / Then
    assert.equal(decideFor(rich).type, COMMAND_TYPES.ISLAND_PAY);
    assert.equal(decideFor(poor).type, COMMAND_TYPES.ISLAND_ROLL);
  });

  it('공항에서는 주인 없는 가장 비싼 도시로 이동한다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 30 },
      airportPending: ['s1'],
      phase: PHASES.AWAIT_TRAVEL,
      cities: [{ index: 39, ownerId: 's2' }],
      random: new FakeRandomSource([]),
    });

    // When
    const decision = decideFor(game);

    // Then (서울이 주인 있으므로 뉴욕 600,000원)
    assert.equal(decision.type, COMMAND_TYPES.TRAVEL);
    assert.equal(decision.payload.destination, 38);
  });

  it('가장 비싼 빈 도시가 지금 서 있는 칸이면 그다음 후보를 고른다', () => {
    // Given (서울 39에 서 있고 서울이 최고가 빈 도시)
    const game = buildGame({
      positions: { s1: 39 },
      airportPending: ['s1'],
      phase: PHASES.AWAIT_TRAVEL,
      random: new FakeRandomSource([]),
    });

    // When
    const decision = decideFor(game);

    // Then (뉴욕 600,000원)
    assert.equal(decision.type, COMMAND_TYPES.TRAVEL);
    assert.equal(decision.payload.destination, 38);
  });

  it('빈 도시가 하나도 없으면 금지 칸이 아닌 아무 칸이나 고른다', () => {
    // Given (모든 소유 가능 칸을 s2가 가진 상태에서 0번 칸에 서 있다)
    const ownableIndexes = [
      1, 3, 4, 5, 6, 8, 9, 11, 13, 14, 15, 16, 17, 19, 21, 23, 24, 25, 26, 28, 29, 31, 33, 34, 35,
      36, 37, 38, 39,
    ];
    const game = buildGame({
      positions: { s1: 0 },
      airportPending: ['s1'],
      phase: PHASES.AWAIT_TRAVEL,
      cities: ownableIndexes.map((index) => ({ index, ownerId: 's2' })),
      random: new FakeRandomSource([]),
    });

    // When
    const decision = decideFor(game);

    // Then (현재 칸 0과 공항 칸 30은 고르지 않는다)
    assert.equal(decision.type, COMMAND_TYPES.TRAVEL);
    assert.notEqual(decision.payload.destination, 0);
    assert.notEqual(decision.payload.destination, 30);
    assert.ok(Number.isInteger(decision.payload.destination));
  });

  it('고른 목적지는 도메인이 실제로 받아준다', () => {
    // Given (금지 칸을 고르면 도메인이 거부하므로 결정과 도메인이 어긋나면 안 된다)
    const game = buildGame({
      positions: { s1: 39 },
      airportPending: ['s1'],
      phase: PHASES.AWAIT_TRAVEL,
      random: new FakeRandomSource([]),
    });

    // When
    const decision = decideFor(game);

    // Then
    assert.doesNotThrow(() => game.execute('s1', decision.type, decision.payload));
  });

  it('지불 불능이면 자동매각 → 대출 → 파산 순서로 판단한다', () => {
    // Given
    const withAssets = buildGame({
      cash: { s1: 5_000 },
      cities: [
        { index: 3, ownerId: 's2', buildings: ['VILLA', 'BUILDING', 'HOTEL'] },
        { index: 39, ownerId: 's1' },
      ],
      random: new FakeRandomSource([1, 2]),
    });
    const loanOnly = buildGame({
      cash: { s1: 5_000 },
      cities: [{ index: 3, ownerId: 's2', buildings: ['VILLA', 'BUILDING', 'HOTEL'] }],
      random: new FakeRandomSource([1, 2]),
    });
    const nothingLeft = buildGame({
      cash: { s1: 5_000 },
      loans: { s1: { used: true, debt: 0 } },
      cities: [{ index: 3, ownerId: 's2', buildings: ['VILLA', 'BUILDING', 'HOTEL'] }],
      random: new FakeRandomSource([1, 2]),
    });
    withAssets.execute('s1', COMMAND_TYPES.ROLL);
    loanOnly.execute('s1', COMMAND_TYPES.ROLL);
    nothingLeft.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.equal(decideFor(withAssets).type, COMMAND_TYPES.AUTO_SELL);
    assert.equal(decideFor(loanOnly).type, COMMAND_TYPES.TAKE_LOAN);
    assert.equal(decideFor(nothingLeft).type, COMMAND_TYPES.DECLARE_BANKRUPTCY);
  });

  it('게임이 끝났으면 아무 결정도 하지 않는다', () => {
    // Given
    const game = buildGame({ phase: PHASES.GAME_OVER, random: new FakeRandomSource([]) });

    // When / Then
    assert.equal(decideFor(game), null);
  });
});

describe('AutoPlayerDriver(자동 진행 스케줄러)', () => {
  const codeRandom = (extra = []) =>
    new FakeRandomSource([...Array.from({ length: 4 }, (_unused, index) => index), ...extra]);

  it('컴퓨터 좌석 차례가 되면 서버가 대신 진행한다', async () => {
    // Given
    const fixture = createAppFixture({
      random: codeRandom(Array.from({ length: 400 }, (_unused, index) => (index % 6) + 1)),
    });
    const started = await startedRoom(fixture, { guestCount: 0, computerCount: 1 });

    // When (사람 호스트의 턴을 정책대로 끝내면 컴퓨터 차례로 넘어간다)
    for (let guard = 0; guard < 20; guard += 1) {
      const current = await fixture.repository.findByCode(started.code);
      if (current.game.isOver() || current.game.currentPlayerId !== started.host.seatId) {
        break;
      }
      const decision = policy.decide(toGameViewDto(current.game));
      await fixture.gameService.execute({
        code: started.code,
        token: started.host.seatToken,
        type: decision.type,
        payload: decision.payload,
      });
    }
    await fixture.driver.whenIdle();

    // Then
    const room = await fixture.repository.findByCode(started.code);
    assert.equal(room.game.version > 1, true, '컴퓨터가 커맨드를 실행했다');
    assert.equal(
      room.game.currentPlayerId === started.host.seatId || room.game.isOver(),
      true,
      '턴이 사람에게 돌아왔거나 게임이 끝났다',
    );
  });

  it('같은 방에 타이머가 중복으로 걸리지 않는다', async () => {
    // Given
    let scheduled = 0;
    let cleared = 0;
    const timers = {
      setTimeout: (fn) => {
        scheduled += 1;
        return setTimeout(fn, 0);
      },
      clearTimeout: (handle) => {
        cleared += 1;
        clearTimeout(handle);
      },
    };
    const fixture = createAppFixture({ random: codeRandom() });
    const { AutoPlayerDriver } = await import('../../src/application/AutoPlayerDriver.js');
    const driver = new AutoPlayerDriver({
      delayMs: 0,
      policy,
      gameService: { autoTurn: async () => null },
      logger: { error: () => {} },
      timers,
    });

    // When
    driver.schedule('AAAA');
    driver.schedule('AAAA');
    driver.schedule('AAAA');
    await driver.whenIdle();

    // Then
    assert.equal(scheduled, 3);
    assert.equal(cleared, 2, '이전 타이머는 취소된다');
    assert.equal(fixture.repository.size, 0);
  });

  it('방이 끝나면 예약을 정리한다', async () => {
    // Given
    const { AutoPlayerDriver } = await import('../../src/application/AutoPlayerDriver.js');
    let cleared = 0;
    const driver = new AutoPlayerDriver({
      delayMs: 1_000,
      policy,
      gameService: { autoTurn: async () => null },
      logger: { error: () => {} },
      timers: {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (handle) => {
          cleared += 1;
          clearTimeout(handle);
        },
      },
    });

    // When
    driver.schedule('AAAA');
    driver.cancel('AAAA');

    // Then
    assert.equal(cleared, 1);
    await driver.whenIdle();
  });

  it('자동 진행이 실패해도 예외를 던지지 않고 로그만 남긴다', async () => {
    // Given (재시도 없이 한 번만 시도하도록 백오프 목록을 비운다)
    const errors = [];
    const { AutoPlayerDriver } = await import('../../src/application/AutoPlayerDriver.js');
    const driver = new AutoPlayerDriver({
      delayMs: 0,
      policy,
      retryDelaysMs: [],
      gameService: {
        autoTurn: async () => {
          throw new Error('저장소 장애');
        },
      },
      logger: { error: (message) => errors.push(message) },
    });

    // When
    driver.schedule('AAAA');
    await driver.whenIdle();

    // Then
    assert.match(errors[0], /자동 진행 실패/);
    assert.match(errors.at(-1), /포기/);
  });

  describe('실패 복구(재시도와 백오프)', () => {
    /** 예약 지연을 기록하는 타이머 대역. */
    const recordingTimers = () => {
      const delays = [];
      return {
        delays,
        timers: {
          setTimeout: (fn, ms) => {
            delays.push(ms);
            return setTimeout(fn, 0);
          },
          clearTimeout: (handle) => clearTimeout(handle),
        },
      };
    };

    it('스텝이 실패하면 백오프를 두고 다시 예약한다', async () => {
      // Given
      const { AutoPlayerDriver } = await import('../../src/application/AutoPlayerDriver.js');
      const { delays, timers } = recordingTimers();
      let attempts = 0;
      const driver = new AutoPlayerDriver({
        delayMs: 0,
        policy,
        timers,
        retryDelaysMs: [10, 20],
        logger: { error: () => {} },
        gameService: {
          autoTurn: async () => {
            attempts += 1;
            throw new Error('저장소 장애');
          },
        },
      });

      // When
      driver.schedule('AAAA');
      await driver.whenIdle();

      // Then (최초 1회 + 재시도 2회)
      assert.equal(attempts, 3);
      assert.deepEqual(delays, [0, 10, 20]);
    });

    it('재시도를 모두 소진하면 autoStalled 플래그를 방송한다', async () => {
      // Given
      const { AutoPlayerDriver } = await import('../../src/application/AutoPlayerDriver.js');
      const stalled = [];
      const driver = new AutoPlayerDriver({
        delayMs: 0,
        policy,
        retryDelaysMs: [0],
        logger: { error: () => {} },
        gameService: {
          autoTurn: async () => {
            throw new Error('저장소 장애');
          },
          publishAutoStalled: async (code) => stalled.push(code),
        },
      });

      // When
      driver.schedule('AAAA');
      await driver.whenIdle();

      // Then
      assert.deepEqual(stalled, ['AAAA']);
    });

    it('결정이 없으면(null) 재시도한 뒤 멈춘다', async () => {
      // Given
      const { AutoPlayerDriver } = await import('../../src/application/AutoPlayerDriver.js');
      let decided = 0;
      const stalled = [];
      const driver = new AutoPlayerDriver({
        delayMs: 0,
        retryDelaysMs: [0],
        policy: {
          decide: () => {
            decided += 1;
            return null;
          },
        },
        logger: { error: () => {} },
        gameService: {
          autoTurn: async () => ({ seatId: 's1', view: {}, version: 0 }),
          publishAutoStalled: async (code) => stalled.push(code),
        },
      });

      // When
      driver.schedule('AAAA');
      await driver.whenIdle();

      // Then
      assert.equal(decided, 2);
      assert.deepEqual(stalled, ['AAAA']);
    });

    it('한 번 성공하면 재시도 횟수가 초기화된다', async () => {
      // Given (첫 시도는 실패, 두 번째는 성공, 그다음 또 실패)
      const { AutoPlayerDriver } = await import('../../src/application/AutoPlayerDriver.js');
      const stalled = [];
      let calls = 0;
      const driver = new AutoPlayerDriver({
        delayMs: 0,
        retryDelaysMs: [0],
        policy: { decide: () => ({ type: 'ROLL' }) },
        logger: { error: () => {} },
        gameService: {
          autoTurn: async () => {
            calls += 1;
            if (calls === 1) {
              throw new Error('일시 장애');
            }
            return calls <= 2 ? { seatId: 's1', view: {}, version: 0 } : null;
          },
          executeAsServer: async () => {
            driver.schedule('AAAA');
          },
          publishAutoStalled: async (code) => stalled.push(code),
        },
      });

      // When
      driver.schedule('AAAA');
      await driver.whenIdle();

      // Then (성공 이후 턴이 없어져 조용히 끝난다 — 멈춤 신호 없음)
      assert.deepEqual(stalled, []);
    });

    it('이미 진행 중이면 스텝을 버리지 않고 다시 예약한다', async () => {
      // Given
      const { AutoPlayerDriver } = await import('../../src/application/AutoPlayerDriver.js');
      let turns = 0;
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const driver = new AutoPlayerDriver({
        delayMs: 0,
        policy: { decide: () => null },
        retryDelaysMs: [],
        logger: { error: () => {} },
        gameService: {
          autoTurn: async () => {
            turns += 1;
            if (turns === 1) {
              await gate;
            }
            return null;
          },
          publishAutoStalled: async () => {},
        },
      });

      // When (첫 스텝이 진행 중인 사이에 두 번째 예약이 발사된다)
      driver.schedule('AAAA');
      await new Promise((resolve) => setTimeout(resolve, 5));
      driver.schedule('AAAA');
      await new Promise((resolve) => setTimeout(resolve, 5));
      release();
      await driver.whenIdle();

      // Then (두 번째 스텝이 버려지지 않고 실제로 실행됐다)
      assert.equal(turns, 2);
    });
  });

  describe('낙관적 동시성(버전 확인)', () => {
    it('버전이 다르면 서버 대행을 거부하고 상태를 바꾸지 않는다', async () => {
      // Given
      const fixture = createAppFixture({ random: codeRandom([1, 2, 1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 0, computerCount: 1 });
      fixture.driver.stop();
      const before = await fixture.repository.findByCode(started.code);
      const computerSeatId = before.seats.find((seat) => seat.isComputer).id;

      // When / Then
      await assert.rejects(
        () =>
          fixture.gameService.executeAsServer({
            code: started.code,
            seatId: computerSeatId,
            type: COMMAND_TYPES.ROLL,
            expectedVersion: before.game.version + 5,
          }),
        { code: 'ERR005' },
      );
      const after = await fixture.repository.findByCode(started.code);
      assert.equal(after.game.version, before.game.version);
      assert.equal(after.game.phase, before.game.phase);
    });

    it('버전이 같으면 서버 대행이 통과한다', async () => {
      // Given
      const fixture = createAppFixture({ random: codeRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 0, computerCount: 1 });
      fixture.driver.stop();
      await fixture.roomService.hostAction({
        code: started.code,
        token: started.host.seatToken,
        action: { type: 'SET_AUTOPILOT', seatId: started.host.seatId, enabled: true },
      });
      const turn = await fixture.gameService.autoTurn(started.code);

      // When
      const result = await fixture.gameService.executeAsServer({
        code: started.code,
        seatId: turn.seatId,
        type: COMMAND_TYPES.ROLL,
        expectedVersion: turn.version,
      });

      // Then
      assert.equal(turn.version, 0);
      assert.equal(result.view.version, 1);
    });

    it('autoTurn은 결정 근거가 된 뷰 버전을 함께 알려준다', async () => {
      // Given
      const fixture = createAppFixture({ random: codeRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 0, computerCount: 1 });
      fixture.driver.stop();
      await fixture.roomService.hostAction({
        code: started.code,
        token: started.host.seatToken,
        action: { type: 'SET_AUTOPILOT', seatId: started.host.seatId, enabled: true },
      });

      // When
      const turn = await fixture.gameService.autoTurn(started.code);

      // Then
      assert.equal(turn.version, turn.view.version);
    });

    it('버전이 어긋나면 드라이버는 다시 결정한다', async () => {
      // Given (첫 대행은 버전 충돌로 실패, 두 번째는 성공)
      const { AutoPlayerDriver } = await import('../../src/application/AutoPlayerDriver.js');
      const { AppError } = await import('../../src/application/errors.js');
      const seenVersions = [];
      let version = 0;
      const driver = new AutoPlayerDriver({
        delayMs: 0,
        retryDelaysMs: [0, 0],
        policy: { decide: () => ({ type: 'ROLL' }) },
        logger: { error: () => {} },
        gameService: {
          autoTurn: async () => (version > 1 ? null : { seatId: 's1', view: {}, version }),
          executeAsServer: async ({ expectedVersion }) => {
            seenVersions.push(expectedVersion);
            if (seenVersions.length === 1) {
              version = 1;
              throw new AppError('ERR005', '버전 불일치');
            }
            version = 2;
            driver.schedule('AAAA');
          },
          publishAutoStalled: async () => {},
        },
      });

      // When
      driver.schedule('AAAA');
      await driver.whenIdle();

      // Then (두 번째 시도는 갱신된 버전으로 다시 결정했다)
      assert.deepEqual(seenVersions, [0, 1]);
    });
  });

  it('한 방의 자동 진행 횟수 상한을 넘기면 멈춘다', async () => {
    // Given (항상 자동 좌석 차례인 것처럼 응답하는 가짜 서비스)
    const errors = [];
    const { AutoPlayerDriver } = await import('../../src/application/AutoPlayerDriver.js');
    let executed = 0;
    const driver = new AutoPlayerDriver({
      delayMs: 0,
      policy: { decide: () => ({ type: 'ROLL' }) },
      gameService: {
        autoTurn: async () => ({ seatId: 's1', view: {} }),
        executeAsServer: async () => {
          executed += 1;
          driver.schedule('AAAA');
        },
      },
      logger: { error: (message) => errors.push(message) },
      maxStepsPerRoom: 3,
    });

    // When
    driver.schedule('AAAA');
    await driver.whenIdle();

    // Then
    assert.equal(executed, 3);
    assert.match(errors.at(-1), /자동 진행 한도/);
  });
});
