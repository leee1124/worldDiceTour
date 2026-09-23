import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENT_ROOM_SCHEMA_VERSION,
  RoomSchemaError,
  deserializeRoom,
  migrateRoomSnapshot,
  serializeRoom,
  validateRoomSnapshot,
} from '../../src/infrastructure/RoomSerializer.js';
import { ROOM_STATUS, Room } from '../../src/domain/room/Room.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { ORDER_KINDS } from '../../src/domain/market/OrderQueue.js';
import { MatchRecorder, MAX_ROUND_SNAPSHOTS } from '../../src/domain/report/MatchRecorder.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { ScriptedRandomSource } from '../support/ScriptedRandomSource.js';

const NOW = 1_700_000_000_000;

/** 투자 모드가 켜진 방을 만들고 몇 가지 거래를 해 둔다. */
function playingStockRoom() {
  const room = Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW });
  room.join({ name: '두리', token: 'b'.repeat(64), now: NOW });
  room.setOptions({
    roundLimit: 30,
    finance: { investmentMode: 'STOCKS' },
    bySeatId: room.hostSeatId,
    now: NOW,
  });
  room.start({ bySeatId: room.hostSeatId, random: new ScriptedRandomSource(), now: NOW });
  room.executeCommand({
    seatId: 'seat-1',
    type: COMMAND_TYPES.BUY_STOCK,
    payload: { instrumentId: 'AIR', quantity: 10 },
    now: NOW,
  });
  room.executeCommand({
    seatId: 'seat-1',
    type: COMMAND_TYPES.DEPOSIT,
    payload: { amount: 500_000 },
    now: NOW,
  });
  room.executeCommand({
    seatId: 'seat-2',
    type: COMMAND_TYPES.QUEUE_ORDER,
    payload: { kind: ORDER_KINDS.BUY_STOCK, instrumentId: 'CON', quantity: 5 },
    now: NOW,
  });
  return room;
}

/** 시장 스냅샷의 한 부분만 망가뜨린 방 스냅샷. */
function corrupt(mutate) {
  const snapshot = playingStockRoom().toSnapshot();
  mutate(snapshot.game.market, snapshot);
  return snapshot;
}

describe('시장 스냅샷 왕복', () => {
  it('거래·예금·예약이 담긴 방이 그대로 복원된다', () => {
    // Given
    const room = playingStockRoom();

    // When
    const restored = deserializeRoom(JSON.parse(serializeRoom(room)), new FakeRandomSource());

    // Then
    assert.deepEqual(restored.toSnapshot(), room.toSnapshot());
    assert.equal(restored.game.phase, PHASES.AWAIT_TRADE);
    const view = restored.game.marketView({ actingSeatId: 'seat-1' });
    assert.deepEqual(view.holdings['seat-1'], [
      { instrumentId: 'AIR', qty: 10, avgCost: 12_000, marketValue: 120_000 },
    ]);
    assert.equal(view.deposits['seat-1'], 500_000);
    assert.equal(view.orderQueue.length, 1);
    assert.equal(view.budget.ordersUsed, 2, '창구 주문 기록이 유지된다');
  });

  it('거래 도중 재접속해도 남은 예산으로 그대로 이어서 플레이할 수 있다', () => {
    // Given (커맨드마다 방이 저장되므로 창구 도중의 재접속은 언제든 일어난다)
    const room = playingStockRoom();
    const beforeBudget = room.game.marketView({ actingSeatId: 'seat-1' }).budget;

    // When (저장 → 복원 후 같은 창구를 이어서 쓴다)
    const restored = deserializeRoom(JSON.parse(serializeRoom(room)), new ScriptedRandomSource());
    const afterBudget = restored.game.marketView({ actingSeatId: 'seat-1' }).budget;
    restored.executeCommand({
      seatId: 'seat-1',
      type: COMMAND_TYPES.SELL_STOCK,
      payload: { instrumentId: 'AIR', quantity: 10 },
      now: NOW,
    });

    // Then (예산이 되살아나지 않았고, 3번째 주문이라 창구가 자동으로 닫힌다)
    assert.deepEqual(afterBudget, beforeBudget, '재접속이 예산을 되돌렸다');
    assert.equal(restored.game.phase, PHASES.AWAIT_TRADE, '한도가 없으므로 창구는 자동으로 닫히지 않고 이어진다(D46)');
    assert.equal(restored.game.moneyReport().balanced, true);

    // When (창구를 직접 닫고 — 자동 마감은 없다(D46) — 그다음 턴 진행도 정상이다)
    restored.executeCommand({ seatId: 'seat-1', type: COMMAND_TYPES.CLOSE_TRADING, payload: {}, now: NOW });
    const events = restored.executeCommand({
      seatId: 'seat-1',
      type: COMMAND_TYPES.ROLL,
      payload: {},
      now: NOW,
    });

    // Then
    assert.ok(events.some((event) => event.type === 'DICE_ROLLED'));
    assert.equal(restored.game.moneyReport().balanced, true);
  });

  it('스냅샷은 현재 스키마 버전을 담고 검증을 통과한다', () => {
    // Given
    const snapshot = playingStockRoom().toSnapshot();

    // When / Then
    assert.equal(snapshot.schemaVersion, CURRENT_ROOM_SCHEMA_VERSION);
    assert.doesNotThrow(() => validateRoomSnapshot(snapshot));
  });

  it('투자 모드가 꺼진 방은 market이 null이고 그대로 통과한다', () => {
    // Given
    const room = Room.create({ code: 'CD3E', hostName: '하나', token: 'a'.repeat(64), now: NOW });
    room.join({ name: '두리', token: 'b'.repeat(64), now: NOW });
    room.start({ bySeatId: room.hostSeatId, random: new FakeRandomSource(), now: NOW });

    // When
    const snapshot = room.toSnapshot();

    // Then
    assert.equal(snapshot.game.market, null);
    assert.doesNotThrow(() => validateRoomSnapshot(snapshot));
  });
});

describe('손상된 시장 스냅샷은 거부된다(참조 정합성 포함)', () => {
  const cases = {
    '시장이 객체가 아니다': (market, snapshot) => {
      snapshot.game.market = 'STOCKS';
    },
    '상품 목록이 비었다': (market) => {
      market.instruments = [];
    },
    '알 수 없는 종목 id': (market) => {
      market.instruments[0].id = 'HACK';
    },
    '가격이 정수가 아니다': (market) => {
      market.instruments[0].price = 12_000.5;
    },
    '가격이 안전 정수를 넘는다': (market) => {
      market.instruments[0].price = 1e300;
    },
    '가격이 음수다': (market) => {
      market.instruments[0].price = -100;
    },
    '알 수 없는 상장 상태': (market) => {
      market.instruments[0].state = 'HALTED';
    },
    '이력이 30개를 넘는다': (market) => {
      market.instruments[0].series = Array.from({ length: 31 }, () => 12_000);
    },
    '이력에 음수가 있다': (market) => {
      market.instruments[0].series = [12_000, -1];
    },
    '알 수 없는 경기 국면': (market) => {
      market.cycle.phase = 'BOOM';
    },
    '국면 나이가 0이다': (market) => {
      market.cycle.age = 0;
    },
    '기준금리가 범위를 벗어난다': (market) => {
      market.baseRateBp = 5_000;
    },
    '보유 종목이 상장 목록에 없다': (market) => {
      market.holdings['seat-1'] = { GHOST: { qty: 1, avgCost: 100 } };
    },
    '보유 좌석이 방에 없다': (market) => {
      market.holdings['seat-99'] = { AIR: { qty: 1, avgCost: 100 } };
    },
    '보유 수량이 음수다': (market) => {
      market.holdings['seat-1'].AIR.qty = -1;
    },
    '보유 수량이 상한을 넘는다': (market) => {
      market.holdings['seat-1'].AIR.qty = 501;
    },
    '예금 좌석이 방에 없다': (market) => {
      market.deposits['seat-99'] = 10_000;
    },
    '예금이 단위의 배수가 아니다': (market) => {
      market.deposits['seat-1'] = 5_555;
    },
    '예금이 상한을 넘는다': (market) => {
      market.deposits['seat-1'] = 20_000_000;
    },
    '예약 주문 좌석이 방에 없다': (market) => {
      market.orderQueue.orders[0].seatId = 'seat-99';
    },
    '예약 주문 종목이 상장 목록에 없다': (market) => {
      market.orderQueue.orders[0].instrumentId = 'GHOST';
    },
    '예약 주문이 좌석당 상한을 넘는다': (market) => {
      const order = market.orderQueue.orders[0];
      market.orderQueue.orders = [1, 2, 3, 4].map((index) => ({ ...order, id: `ord-${index}` }));
    },
    '알 수 없는 예약 주문 종류': (market) => {
      market.orderQueue.orders[0].kind = 'SHORT_STOCK';
    },
    '창구 좌석이 방에 없다': (market) => {
      market.window.seatId = 'seat-99';
    },
    '창구 주문 수가 음수다(상한은 없지만 음수·비정수는 손상이다)': (market) => {
      market.window.budget.ordersUsed = -1;
    },
    '섹터 압력이 알 수 없는 섹터다': (market) => {
      market.nudges = { CRYPTO: 100 };
    },
    '뉴스 덱에 그 국면의 카드가 아닌 id가 있다': (market) => {
      market.newsDeck.piles = { RECOVERY: ['NE1'] };
    },
    '최근 뉴스 id가 목록에 없다': (market) => {
      market.latestNews = { id: 'NX9', round: 2 };
    },
    // SPEC 12.1은 "가격은 항상 tickUnit의 배수이며 경계 안"이라고 약속한다. 복원 경로에도
    // 그 약속이 있어야 한다 — 없으면 매도 수수료를 낼 수 없는 가격이 들어와 돈이 생긴다.
    '가격이 tickUnit의 배수가 아니다': (market) => {
      market.instruments[0].price = 12_050;
    },
    '가격이 하한 아래다': (market) => {
      market.instruments[0].price = 100;
    },
    '가격이 상한 위다': (market) => {
      market.instruments[0].price = 100_000;
    },
    '상장 상태인데 상장폐지 임계 이하다': (market) => {
      market.instruments[0].price = 2_400;
      market.instruments[0].state = 'LISTED';
    },
    '가격 이력이 tickUnit의 배수가 아니다': (market) => {
      market.instruments[0].series = [12_000, 12_050];
    },
    '예비 종목이 예비 풀 소속이 아니다': (market) => {
      market.reserve = ['AIR'];
    },
    '예비 종목이 이미 상장돼 있다': (market) => {
      market.reserve = ['AIR', 'SKY'];
    },
    '거래 창구 좌석이 현재 턴 좌석이 아니다': (market) => {
      market.window.seatId = 'seat-2';
    },
  };

  for (const [label, mutate] of Object.entries(cases)) {
    it(`${label} → 격리된다`, () => {
      // Given
      const snapshot = corrupt(mutate);

      // When / Then
      assert.throws(() => validateRoomSnapshot(snapshot), RoomSchemaError, `통과해 버렸다: ${label}`);
    });
  }

  it('AWAIT_TRADE 페이즈인데 창구가 없으면 거부한다(페이즈-상태 정합성)', () => {
    // Given
    const snapshot = corrupt((market) => {
      market.window = null;
    });

    // When / Then
    assert.throws(() => validateRoomSnapshot(snapshot), RoomSchemaError);
  });

  it('창구가 열려 있는데 페이즈가 AWAIT_TRADE가 아니면 거부한다', () => {
    // Given
    const snapshot = playingStockRoom().toSnapshot();
    snapshot.game.phase = PHASES.AWAIT_ROLL;
    snapshot.game.turn.afterTrade = null;

    // When / Then
    assert.throws(() => validateRoomSnapshot(snapshot), RoomSchemaError);
  });

  it('투자 모드가 꺼졌는데 AWAIT_TRADE 페이즈면 거부한다', () => {
    // Given
    const snapshot = playingStockRoom().toSnapshot();
    snapshot.game.market = null;

    // When / Then
    assert.throws(() => validateRoomSnapshot(snapshot), RoomSchemaError);
  });

  it('멀쩡한 방을 격리하지 않는다 — 거래가 이어지는 모든 중간 상태가 검증을 통과한다', () => {
    // Given (거짓 양성 방어: 실제로 일어나는 상태를 전부 통과시켜야 한다)
    const room = playingStockRoom();

    // When / Then (창구는 스스로 닫히지 않으므로(D46) 직접 닫은 뒤 굴린다)
    for (const [type, payload] of [
      [COMMAND_TYPES.SELL_STOCK, { instrumentId: 'AIR', quantity: 5 }],
      [COMMAND_TYPES.CLOSE_TRADING, {}],
      [COMMAND_TYPES.ROLL, {}],
    ]) {
      room.executeCommand({ seatId: 'seat-1', type, payload, now: NOW });
      const snapshot = JSON.parse(serializeRoom(room));
      assert.doesNotThrow(() => validateRoomSnapshot(snapshot), `${type} 직후 상태가 격리됐다`);
      assert.deepEqual(deserializeRoom(snapshot, new FakeRandomSource()).toSnapshot(), room.toSnapshot());
    }
  });
});

describe('성적표 수집 스냅샷', () => {
  it('라운드 스냅샷에 상한이 있어 방 파일이 무한히 자라지 않는다', () => {
    // Given (라운드 제한 없음(null)이 실제 선택지이므로 200라운드 판도 가능하다.
    //        커맨드마다 방 전체를 다시 쓰므로 상한이 없으면 쓰기 증폭이 계속 커진다)
    const recorder = new MatchRecorder();
    const netWorth = {
      breakdownOf: () => ({ cash: 1, property: 0, stock: 0, deposit: 0, loanDebt: 0, total: 1 }),
    };

    // When
    for (let round = 1; round <= MAX_ROUND_SNAPSHOTS + 40; round += 1) {
      recorder.recordRound({ round, players: [{ id: 'seat-1' }], netWorth });
    }

    // Then (가장 오래된 라운드가 밀려나고 최근 것이 남는다)
    const snapshot = recorder.toSnapshot();
    assert.equal(snapshot.snapshots.length, MAX_ROUND_SNAPSHOTS);
    assert.equal(snapshot.snapshots.at(-1).round, MAX_ROUND_SNAPSHOTS + 40);
  });


  it('라운드 스냅샷·하이라이트·사유별 손익이 저장되고 왕복한다', () => {
    // Given
    const room = playingStockRoom();

    // When
    const report = room.toSnapshot().game.report;

    // Then
    assert.ok(Array.isArray(report.snapshots));
    assert.ok(Array.isArray(report.highlights));
    assert.ok(report.pnl['seat-1'], '거래한 좌석의 사유별 손익이 쌓인다');
    assert.equal(report.pnl['seat-1'].TRADE_BUY, -120_000);
    assert.equal(report.pnl['seat-1'].DEPOSIT, -500_000);
    assert.doesNotThrow(() => validateRoomSnapshot(room.toSnapshot()));
  });

  it('손상된 성적표는 거부한다', () => {
    // Given
    const badCases = [
      (game) => {
        game.report = [];
      },
      (game) => {
        game.report.snapshots = 'nope';
      },
      (game) => {
        game.report.highlights = { a: 1 };
      },
      (game) => {
        game.report.pnl = { 'seat-1': { TRADE_BUY: 1.5 } };
      },
      (game) => {
        game.report.pnl = { 'seat-1': { NOT_A_REASON: 100 } };
      },
    ];

    // When / Then
    for (const mutate of badCases) {
      const snapshot = playingStockRoom().toSnapshot();
      mutate(snapshot.game);
      assert.throws(() => validateRoomSnapshot(snapshot), RoomSchemaError);
    }
  });
});

describe('마이그레이션 v2 → v3', () => {
  it('저장된 v2 방은 투자 모드가 꺼진 채로 그대로 이어진다', () => {
    // Given (v2 시절 저장된 방: finance는 있지만 market/report가 없다)
    const room = Room.create({ code: 'EF4G', hostName: '하나', token: 'a'.repeat(64), now: NOW });
    room.join({ name: '두리', token: 'b'.repeat(64), now: NOW });
    room.start({ bySeatId: room.hostSeatId, random: new FakeRandomSource(), now: NOW });
    const legacy = room.toSnapshot();
    legacy.schemaVersion = 2;
    delete legacy.game.market;
    delete legacy.game.report;

    // When
    const migrated = migrateRoomSnapshot(legacy);

    // Then
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.game.market, null, '진행 중인 판에 기능이 끼어들지 않는다');
    assert.deepEqual(migrated.game.report, { snapshots: [], highlights: [], pnl: {} });
    assert.doesNotThrow(() => validateRoomSnapshot(migrated));
    assert.equal(
      deserializeRoom(legacy, new FakeRandomSource()).options.finance.investmentMode,
      'OFF',
    );
  });

  it('v1 방도 3까지 한 번에 올라온다', () => {
    // Given
    const room = Room.create({ code: 'GH5J', hostName: '하나', token: 'a'.repeat(64), now: NOW });
    const legacy = room.toSnapshot();
    delete legacy.schemaVersion;
    legacy.options = { roundLimit: 20 };

    // When
    const migrated = migrateRoomSnapshot(legacy);

    // Then
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.options.finance.investmentMode, 'OFF');
    assert.equal(migrated.status, ROOM_STATUS.LOBBY);
  });
});
