import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GameService } from '../../src/application/GameService.js';
import { RoomService } from '../../src/application/RoomService.js';
import { UnlimitedLimiter, TokenBucketLimiter } from '../../src/application/RateLimiter.js';
import { InMemoryRoomRepository } from '../../src/infrastructure/InMemoryRoomRepository.js';
import { SeatAuthenticator } from '../../src/infrastructure/SeatAuthenticator.js';
import { TokenFactory } from '../../src/infrastructure/TokenFactory.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { ScriptedRandomSource } from '../support/ScriptedRandomSource.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';
import { createApp } from '../../src/app.js';
import { request } from '../support/httpClient.js';
import { Room } from '../../src/domain/room/Room.js';

const silentLogger = { error: () => {}, warn: () => {}, info: () => {} };
const noopPublisher = { publishRoom: () => {}, publishGame: () => {}, closeRoom: () => {} };

/** 투자 모드가 켜진 2인 방(사람 좌석 둘). */
async function stockApp({ tradeLimiter = new UnlimitedLimiter(), withComputer = false } = {}) {
  const random = new ScriptedRandomSource();
  const repository = new InMemoryRoomRepository({ random, logger: silentLogger });
  const common = {
    repository,
    random,
    authenticator: new SeatAuthenticator(),
    publisher: noopPublisher,
    clock: { now: () => 1_700_000_000_000 },
    logger: silentLogger,
  };
  const roomService = new RoomService({ ...common, tokenFactory: new TokenFactory() });
  const gameService = new GameService({ ...common, tradeLimiter });

  const host = await roomService.createRoom({ hostName: '하나' });
  const code = host.room.code;
  const guest = await roomService.joinSeat({ code, name: '두리' });
  if (withComputer) {
    await roomService.hostAction({
      code,
      token: host.seatToken,
      action: { type: 'ADD_COMPUTER', name: '컴퓨터' },
    });
  }
  await roomService.hostAction({
    code,
    token: host.seatToken,
    action: { type: 'SET_OPTIONS', roundLimit: 30, finance: { investmentMode: 'STOCKS' } },
  });
  if (withComputer) {
    // 첫 턴은 호스트 좌석이다. 자동 진행으로 돌려 `autoTurn`이 그 좌석을 돌려주게 한다
    // (좌석이 오프라인이어야 하므로 presence가 빈 이 조립에서는 그대로 통과한다).
    await roomService.hostAction({
      code,
      token: host.seatToken,
      action: { type: 'SET_AUTOPILOT', seatId: host.seatId, enabled: true },
    });
  }
  await roomService.hostAction({ code, token: host.seatToken, action: { type: 'START' } });

  return {
    code,
    repository,
    roomService,
    gameService,
    host: { seatId: host.seatId, token: host.seatToken },
    guest: { seatId: guest.seatId, token: guest.seatToken },
  };
}

/** 커맨드가 규격 코드로 거부되고 게임 상태가 한 글자도 바뀌지 않았음을 확인한다. */
async function assertRejectedUnchanged(app, { token, seatId, type, payload }, code, label) {
  const before = JSON.stringify((await app.repository.findByCode(app.code)).toSnapshot());

  await assert.rejects(
    () => app.gameService.execute({ code: app.code, token, seatId, type, payload }),
    (error) => {
      assert.equal(error.code, code, `${label}: 기대 ${code}, 실제 ${error.code}`);
      return true;
    },
    label,
  );

  const after = JSON.stringify((await app.repository.findByCode(app.code)).toSnapshot());
  assert.equal(after, before, `${label}: 거부됐는데 상태가 바뀌었다`);
}

describe('거래 커맨드 권한 매트릭스(서비스 레이어)', () => {
  it('토큰이 없거나 틀리면 ERR002이고 상태가 그대로다', async () => {
    // Given
    const app = await stockApp();

    // When / Then
    for (const [token, label] of [
      ['f'.repeat(64), '없는 토큰'],
      ['short', '형식 오류'],
    ]) {
      await assertRejectedUnchanged(
        app,
        { token, type: COMMAND_TYPES.BUY_STOCK, payload: { instrumentId: 'AIR', quantity: 1 } },
        'ERR002',
        label,
      );
    }
  });

  it('남의 차례에 보낸 거래 커맨드는 ERR006이고 상태가 그대로다', async () => {
    // Given (s1의 턴에 s2가 보낸다)
    const app = await stockApp();

    // When / Then
    for (const [type, payload] of [
      [COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 1 }],
      [COMMAND_TYPES.SELL_STOCK, { instrumentId: 'AIR', quantity: 1 }],
      [COMMAND_TYPES.DEPOSIT, { amount: 10_000 }],
      [COMMAND_TYPES.WITHDRAW, { amount: 10_000 }],
      [COMMAND_TYPES.CLOSE_TRADING, {}],
    ]) {
      await assertRejectedUnchanged(
        app,
        { token: app.guest.token, type, payload },
        'ERR006',
        `남의 차례 ${type}`,
      );
    }
  });

  it('본문 seatId가 토큰의 좌석과 다르면 ERR003이다(좌석 사칭 차단)', async () => {
    // Given
    const app = await stockApp();

    // When / Then
    await assertRejectedUnchanged(
      app,
      {
        token: app.guest.token,
        seatId: app.host.seatId,
        type: COMMAND_TYPES.QUEUE_ORDER,
        payload: { kind: 'DEPOSIT', amount: 10_000 },
      },
      'ERR003',
      '좌석 사칭',
    );
  });

  it('예약 주문은 남의 턴에도 자기 좌석이면 통과한다', async () => {
    // Given
    const app = await stockApp();

    // When
    const result = await app.gameService.execute({
      code: app.code,
      token: app.guest.token,
      type: COMMAND_TYPES.QUEUE_ORDER,
      payload: { kind: 'BUY_STOCK', instrumentId: 'CON', quantity: 5 },
    });

    // Then
    assert.equal(result.events[0].type, 'QUEUED_ORDER_PLACED');
    assert.equal(result.view.market.orderQueue.length, 1);
    assert.equal(result.view.phase, PHASES.AWAIT_TRADE, '게임 상태는 그대로다');
  });

  it('남의 예약 주문은 취소할 수 없다(ERR003)', async () => {
    // Given
    const app = await stockApp();
    await app.gameService.execute({
      code: app.code,
      token: app.guest.token,
      type: COMMAND_TYPES.QUEUE_ORDER,
      payload: { kind: 'DEPOSIT', amount: 10_000 },
    });

    // When / Then
    await assertRejectedUnchanged(
      app,
      {
        token: app.host.token,
        type: COMMAND_TYPES.CANCEL_QUEUED_ORDER,
        payload: { orderId: 'ord-1' },
      },
      'ERR003',
      '남의 예약 취소',
    );
  });

  it('자동 진행 중인 좌석은 사람이 거래할 수 없다(ERR003 — 이중 조종 차단)', async () => {
    // Given (게스트를 자동 진행으로 돌린다)
    const app = await stockApp();
    await app.roomService.hostAction({
      code: app.code,
      token: app.host.token,
      action: { type: 'SET_AUTOPILOT', seatId: app.guest.seatId, enabled: true },
    });

    // When / Then (자기 토큰이어도 거부된다)
    await assertRejectedUnchanged(
      app,
      {
        token: app.guest.token,
        type: COMMAND_TYPES.QUEUE_ORDER,
        payload: { kind: 'DEPOSIT', amount: 10_000 },
      },
      'ERR003',
      '자동 진행 좌석의 예약',
    );
  });

  it('창구를 닫은 뒤의 거래 커맨드는 ERR005이고 상태가 그대로다', async () => {
    // Given
    const app = await stockApp();
    await app.gameService.execute({
      code: app.code,
      token: app.host.token,
      type: COMMAND_TYPES.CLOSE_TRADING,
      payload: {},
    });

    // When / Then
    await assertRejectedUnchanged(
      app,
      {
        token: app.host.token,
        type: COMMAND_TYPES.BUY_STOCK,
        payload: { instrumentId: 'AIR', quantity: 1 },
      },
      'ERR005',
      '창구 밖 주문',
    );
  });

  it('없는 종목·상장폐지 종목은 ERR001이고 상태가 그대로다', async () => {
    // Given
    const app = await stockApp();

    // When / Then
    await assertRejectedUnchanged(
      app,
      {
        token: app.host.token,
        type: COMMAND_TYPES.BUY_STOCK,
        payload: { instrumentId: 'GHOST', quantity: 1 },
      },
      'ERR001',
      '없는 종목',
    );
  });

  it('창구 한도를 넘으면 ERR018이고 상태가 그대로다', async () => {
    // Given (NRG 50주 = 1,000,000원 두 번이면 명목 예산이 끝난다)
    const app = await stockApp();
    for (let index = 0; index < 2; index += 1) {
      await app.gameService.execute({
        code: app.code,
        token: app.host.token,
        type: COMMAND_TYPES.BUY_STOCK,
        payload: { instrumentId: 'NRG', quantity: 50 },
      });
    }

    // When / Then
    await assertRejectedUnchanged(
      app,
      {
        token: app.host.token,
        type: COMMAND_TYPES.BUY_STOCK,
        payload: { instrumentId: 'AIR', quantity: 1 },
      },
      'ERR018',
      '창구 예산 초과',
    );
  });

  it('현금이 부족하면 ERR008이고 상태가 그대로다', async () => {
    // Given
    const app = await stockApp();

    // When / Then (200주 × 20,000 = 4,000,000원 — 1건 한도를 먼저 넘으므로 예금으로 확인한다)
    await assertRejectedUnchanged(
      app,
      {
        token: app.host.token,
        type: COMMAND_TYPES.DEPOSIT,
        payload: { amount: 10_000_000 },
      },
      'ERR008',
      '현금 부족 예치',
    );
  });

  it('탈락한 좌석은 예약도 걸 수 없다(ERR003)', async () => {
    // Given (게스트를 파산시키는 대신 도메인 레벨에서 탈락 상태를 만든다)
    const app = await stockApp();
    const room = await app.repository.findByCode(app.code);
    const snapshot = room.toSnapshot();
    snapshot.game.players[1].eliminated = true;
    snapshot.game.players[1].cash = 0;
    snapshot.game.initialTotal = snapshot.game.players.reduce(
      (sum, player) => sum + player.cash,
      0,
    );
    snapshot.game.ledger = { fromBank: 0, toBank: 0, byReason: {} };
    snapshot.game.market.holdings = {};
    snapshot.game.market.deposits = {};
    await app.repository.save(Room.restore(snapshot, new ScriptedRandomSource()));

    // When / Then
    await assertRejectedUnchanged(
      app,
      {
        token: app.guest.token,
        type: COMMAND_TYPES.QUEUE_ORDER,
        payload: { kind: 'DEPOSIT', amount: 10_000 },
      },
      'ERR003',
      '탈락 좌석의 예약',
    );
  });

  it('예약 주문은 자동 진행의 낙관적 동시성 토큰을 흔들지 않는다(진행 방해 차단)', async () => {
    // Given (예약 주문은 게임 상태를 바꾸지 않으므로, 남의 턴에 이것만 반복해도
    //        자동 진행 좌석의 결정이 무효가 되어서는 안 된다. 무효가 되면 재시도 한도를
    //        소진시켜 그 방의 진행을 영구히 멈출 수 있다)
    const app = await stockApp();
    const turn = await app.gameService.autoTurn(app.code);

    // 이 방은 사람 좌석 둘이라 autoTurn은 null이다 — 토큰 자체를 직접 비교한다.
    const room = await app.repository.findByCode(app.code);
    const before = room.game.stateVersion;

    // When (게스트가 예약을 걸고 취소한다 — 게임 상태와 무관한 커맨드)
    await app.gameService.execute({
      code: app.code,
      token: app.guest.token,
      type: COMMAND_TYPES.QUEUE_ORDER,
      payload: { kind: 'DEPOSIT', amount: 10_000 },
    });
    await app.gameService.execute({
      code: app.code,
      token: app.guest.token,
      type: COMMAND_TYPES.CANCEL_QUEUED_ORDER,
      payload: { orderId: 'ord-1' },
    });

    // Then
    const after = await app.repository.findByCode(app.code);
    assert.equal(turn, null, '사람 좌석뿐인 방에서는 자동 진행 대상이 없다');
    assert.equal(after.game.stateVersion, before, '예약 주문이 동시성 토큰을 올렸다');
    assert.ok(after.game.version > room.game.version, 'DTO version은 올라가야 한다(화면 갱신용)');
  });

  it('거래 커맨드는 동시성 토큰을 올린다(상태가 실제로 바뀌므로)', async () => {
    // Given
    const app = await stockApp();
    const room = await app.repository.findByCode(app.code);
    const before = room.game.stateVersion;

    // When
    await app.gameService.execute({
      code: app.code,
      token: app.host.token,
      type: COMMAND_TYPES.BUY_STOCK,
      payload: { instrumentId: 'AIR', quantity: 1 },
    });

    // Then
    const after = await app.repository.findByCode(app.code);
    assert.equal(after.game.stateVersion, before + 1);
  });

  it('자동 진행 좌석이 결정한 뒤 남이 예약을 걸어도 그 결정이 거부되지 않는다', async () => {
    // Given (컴퓨터 좌석이 있는 방 — 자동 진행 대행 경로를 실제로 태운다)
    const app = await stockApp({ withComputer: true });
    const turn = await app.gameService.autoTurn(app.code);
    assert.ok(turn, '자동 진행 차례가 아니다');

    // When (결정을 내린 뒤, 다른 사람 좌석이 예약을 걸어 version을 흔든다)
    await app.gameService.execute({
      code: app.code,
      token: app.guest.token,
      type: COMMAND_TYPES.QUEUE_ORDER,
      payload: { kind: 'DEPOSIT', amount: 10_000 },
    });

    // Then (예약 전에 읽은 토큰으로도 대행이 성공한다)
    const result = await app.gameService.executeAsServer({
      code: app.code,
      seatId: turn.seatId,
      type: COMMAND_TYPES.CLOSE_TRADING,
      payload: {},
      expectedVersion: turn.version,
    });
    assert.ok(result.view);
  });

  it('좌석당 레이트 리밋을 넘으면 ERR019이고 상태가 그대로다', async () => {
    // Given (2건만 허용)
    const app = await stockApp({
      tradeLimiter: new TokenBucketLimiter({ capacity: 2, windowMs: 5_000, now: () => 1_000 }),
    });

    // When (예약 주문 2건은 통과)
    for (let index = 0; index < 2; index += 1) {
      await app.gameService.execute({
        code: app.code,
        token: app.guest.token,
        type: COMMAND_TYPES.QUEUE_ORDER,
        payload: { kind: 'DEPOSIT', amount: 10_000 },
      });
    }

    // Then (3번째는 막힌다)
    await assertRejectedUnchanged(
      app,
      {
        token: app.guest.token,
        type: COMMAND_TYPES.QUEUE_ORDER,
        payload: { kind: 'DEPOSIT', amount: 10_000 },
      },
      'ERR019',
      '레이트 리밋',
    );
  });

  it('레이트 리밋은 거래가 아닌 커맨드를 막지 않는다(판이 멈추면 안 된다)', async () => {
    // Given
    const app = await stockApp({
      tradeLimiter: new TokenBucketLimiter({ capacity: 0, windowMs: 5_000, now: () => 1_000 }),
    });

    // When / Then (창구 마감은 제한 대상이 아니다)
    const result = await app.gameService.execute({
      code: app.code,
      token: app.host.token,
      type: COMMAND_TYPES.CLOSE_TRADING,
      payload: {},
    });
    assert.equal(result.view.phase, PHASES.AWAIT_ROLL);
  });
});

describe('거래 커맨드 권한 매트릭스(실제 HTTP 서버)', () => {
  let server = null;
  let baseUrl = '';

  before(async () => {
    const random = new SeededRandomSource(20_260_922);
    server = createApp({
      repository: new InMemoryRoomRepository({ random, logger: silentLogger }),
      random,
      tokenFactory: new TokenFactory(),
      publicDir: new URL('../../public', import.meta.url).pathname,
      autoPlayDelayMs: 0,
      logger: silentLogger,
    });
    // 포트 0 = 임시 포트. 오너가 5173에서 실제로 플레이하므로 테스트는 절대 그 포트를 쓰지 않는다.
    await new Promise((resolve) => server.server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.server.address().port}`;
  });

  after(async () => {
    await server.close();
  });

  const post = (path, body, token) => request(baseUrl, { method: 'POST', path, body, token });
  const get = (path) => request(baseUrl, { path });

  /** 투자 모드가 켜진 2인 방을 HTTP로 만든다. */
  async function startStockRoom() {
    const created = await post('/api/rooms', { hostName: '하나' });
    const code = created.body.room.code;
    const hostToken = created.body.seatToken;
    const joined = await post(`/api/rooms/${code}/seats`, { name: '두리' });
    await post(
      `/api/rooms/${code}/host-actions`,
      { type: 'SET_OPTIONS', roundLimit: 30, finance: { investmentMode: 'STOCKS' } },
      hostToken,
    );
    await post(`/api/rooms/${code}/host-actions`, { type: 'START' }, hostToken);
    return { code, hostToken, guestToken: joined.body.seatToken };
  }

  it('권한·형식·페이즈 위반이 모두 규격 에러이고 상태가 바뀌지 않는다', async () => {
    // Given
    const { code, hostToken, guestToken } = await startStockRoom();
    const before = await get(`/api/rooms/${code}`);
    assert.equal(before.body.game.phase, 'AWAIT_TRADE');
    assert.ok(before.body.game.market, 'market DTO가 실려야 한다');
    const digestBefore = JSON.stringify(before.body);

    // When / Then
    const cases = [
      [{ type: 'BUY_STOCK', payload: { instrumentId: 'AIR', quantity: 1 } }, guestToken, 409, 'ERR006'],
      [{ type: 'BUY_STOCK', payload: { instrumentId: 'air', quantity: 1 } }, hostToken, 400, 'ERR001'],
      [{ type: 'BUY_STOCK', payload: { instrumentId: 'AIR', quantity: 0 } }, hostToken, 400, 'ERR001'],
      [{ type: 'BUY_STOCK', payload: { instrumentId: 'AIR', quantity: 999 } }, hostToken, 400, 'ERR001'],
      [{ type: 'BUY_STOCK', payload: { instrumentId: 'AIR', quantity: -3 } }, hostToken, 400, 'ERR001'],
      [{ type: 'DEPOSIT', payload: { amount: 5_000 } }, hostToken, 400, 'ERR001'],
      [{ type: 'DEPOSIT', payload: { amount: -10_000 } }, hostToken, 400, 'ERR001'],
      [{ type: 'DEPOSIT', payload: { amount: 1e21 } }, hostToken, 400, 'ERR001'],
      [{ type: 'BUY_STOCK', payload: { instrumentId: 'GHOST', quantity: 1 } }, hostToken, 400, 'ERR001'],
      [{ type: 'SELL_ASSET', payload: { assetKind: 'STOCK', assetId: 'AIR' } }, hostToken, 409, 'ERR005'],
      [{ type: 'SELL_ASSET', payload: { assetKind: 'CRYPTO', assetId: 'HAN' } }, hostToken, 400, 'ERR001'],
      [{ type: 'CANCEL_QUEUED_ORDER', payload: { orderId: 'ord-9' } }, hostToken, 400, 'ERR001'],
      [{ type: 'CANCEL_QUEUED_ORDER', payload: { orderId: 'nope' } }, hostToken, 400, 'ERR001'],
      [
        {
          type: 'QUEUE_ORDER',
          payload: { kind: 'BUY_STOCK', instrumentId: 'AIR', quantity: 1 },
          seatId: 'seat-1',
        },
        guestToken,
        403,
        'ERR003',
      ],
      [{ type: 'BUY_STOCK', payload: { instrumentId: 'AIR', quantity: 1 } }, 'f'.repeat(64), 401, 'ERR002'],
    ];

    for (const [body, token, status, errorCode] of cases) {
      const response = await post(`/api/rooms/${code}/commands`, body, token);
      assert.equal(
        response.status,
        status,
        `${body.type}(${errorCode}): ${JSON.stringify(response.body)}`,
      );
      assert.deepEqual(Object.keys(response.body).sort(), ['code', 'message']);
      assert.equal(response.body.code, errorCode, body.type);
    }

    const after = await get(`/api/rooms/${code}`);
    assert.equal(JSON.stringify(after.body), digestBefore, '거부된 요청이 상태를 바꿨다');
  });

  it('정상 매수는 통과하고 market DTO·총자산 내역이 갱신된다', async () => {
    // Given
    const { code, hostToken } = await startStockRoom();

    // When
    const response = await post(
      `/api/rooms/${code}/commands`,
      { type: 'BUY_STOCK', payload: { instrumentId: 'AIR', quantity: 10 } },
      hostToken,
    );

    // Then
    assert.equal(response.status, 200);
    assert.equal(response.body.events[0].type, 'ORDER_FILLED');
    assert.deepEqual(response.body.view.market.holdings['seat-1'], [
      { instrumentId: 'AIR', qty: 10, avgCost: 12_000, marketValue: 120_000 },
    ]);
    assert.equal(response.body.view.players[0].stockValue, 120_000);
    assert.equal(
      response.body.view.players[0].netWorth.total,
      response.body.view.players[0].totalAssets,
    );
    // 좌석 토큰은 어떤 DTO/이벤트에도 실리지 않는다(기존 규칙).
    assert.ok(!JSON.stringify(response.body).includes(hostToken), '토큰이 응답에 새어 나왔다');
  });

  it('레이트 리밋 응답에는 retry-after 헤더가 붙는다', async () => {
    // Given (기본 리밋은 5초 10건 — 예약 주문으로 넘긴다)
    const { code, guestToken } = await startStockRoom();
    let limited = null;

    // When
    for (let index = 0; index < 12; index += 1) {
      const response = await post(
        `/api/rooms/${code}/commands`,
        { type: 'QUEUE_ORDER', payload: { kind: 'DEPOSIT', amount: 10_000 } },
        guestToken,
      );
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    // Then
    assert.ok(limited, '레이트 리밋에 걸리지 않았다');
    assert.equal(limited.body.code, 'ERR019');
    assert.equal(limited.headers['retry-after'], '1');
  });
});
