import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Market } from '../../src/domain/market/Market.js';
import { DEPOSIT_ASSET_KIND, STOCK_ASSET_KIND } from '../../src/domain/market/MarketAssets.js';
import { PROPERTY_LIQUIDATION_PRIORITY } from '../../src/domain/game/payment/PropertyAssets.js';
import { MARKET_EVENT_TYPES, TRADING_CLOSE_REASONS } from '../../src/domain/market/events.js';
import { ORDER_KINDS } from '../../src/domain/market/OrderQueue.js';
import { REJECT_REASONS } from '../../src/domain/market/rejectReasons.js';
import { CYCLE_PHASES } from '../../src/domain/market/data/cycle.js';
import { SECTORS } from '../../src/domain/market/data/instruments.js';
import { INITIAL_BASE_RATE_BP } from '../../src/domain/market/BaseRate.js';
import { MONEY_REASONS } from '../../src/domain/shared/MoneyIntent.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';

const SEATS = ['s1', 's2'];

/** 난수 없이 국면을 고정한 시장(회복 1년차 → advance가 난수를 쓰지 않는다). */
const freshMarket = () => Market.create();

/** 틱 한 번에 쓰이는 난수: [국면?] + 뉴스 1 + 종목 5. */
function tickRandom({ cycleRoll = null, newsPick = 0, shocks = [0, 0, 0, 0, 0] } = {}) {
  const values = [];
  if (cycleRoll !== null) {
    values.push(cycleRoll);
  }
  values.push(newsPick, ...shocks);
  return new FakeRandomSource(values);
}

const typesOf = (events) => events.map((event) => event.type);
const find = (events, type) => events.find((event) => event.type === type);

describe('Market(시장 루트) — 생성과 뷰', () => {
  it('새 시장은 상장 5종목·회복 국면·기준금리 50bp로 시작하고 뉴스가 아직 없다', () => {
    // Given / When
    const market = freshMarket();
    const view = market.viewModel({ seatIds: SEATS, actingSeatId: 's1' });

    // Then
    assert.equal(view.investmentMode, 'STOCKS');
    assert.deepEqual(
      view.instruments.map((instrument) => instrument.id),
      ['AIR', 'CON', 'HOT', 'ENT', 'NRG'],
    );
    assert.equal(view.cycle.phase, CYCLE_PHASES.RECOVERY);
    assert.equal(view.cycle.age, 1);
    assert.equal(view.baseRateBp, INITIAL_BASE_RATE_BP);
    assert.equal(view.news, null, '첫 라운드에는 아직 뉴스가 없다');
    assert.deepEqual(view.pendingNudges, []);
    assert.deepEqual(view.orderQueue, []);
    assert.deepEqual(view.holdings, { s1: [], s2: [] });
    assert.deepEqual(view.deposits, { s1: 0, s2: 0 });
  });

  it('뷰의 규칙 상수는 화면이 숫자를 하드코딩하지 않도록 전부 담긴다', () => {
    // Given / When
    const rules = freshMarket().viewModel({ seatIds: SEATS, actingSeatId: null }).rules;

    // Then
    assert.deepEqual(rules, {
      feeBp: 100,
      feeMin: 1_000,
      maxOrdersPerWindow: 3,
      maxNotionalPerWindow: 2_000_000,
      maxNotionalPerOrder: 1_000_000,
      minQuantity: 1,
      maxQuantity: 200,
      maxPositionPerInstrument: 500,
      depositUnit: 10_000,
      depositCap: 10_000_000,
      maxQueuedOrders: 3,
      baseRateMinBp: 25,
      baseRateMaxBp: 400,
      seriesLength: 30,
    });
  });

  it('행동 좌석의 예산만 뷰에 실리고, 창구가 닫혀 있으면 open이 false다', () => {
    // Given
    const market = freshMarket();

    // When
    const closed = market.viewModel({ seatIds: SEATS, actingSeatId: 's1' }).budget;
    market.openWindow('s1');
    const open = market.viewModel({ seatIds: SEATS, actingSeatId: 's1' }).budget;
    const other = market.viewModel({ seatIds: SEATS, actingSeatId: 's2' }).budget;

    // Then
    assert.deepEqual(closed, { ...closed, seatId: 's1', open: false, ordersLeft: 3 });
    assert.equal(open.open, true);
    assert.equal(other.open, false, '창구는 한 좌석만 열려 있다');
  });
});

describe('Market — 거래 창구', () => {
  it('거래할 것이 전혀 없으면(현금 0·보유 0·예금 0) 창구를 열지 않는다', () => {
    // Given
    const market = freshMarket();

    // When / Then
    assert.equal(market.hasTradableAssets({ playerId: 's1', cash: 0 }), false);
    assert.equal(market.hasTradableAssets({ playerId: 's1', cash: 1 }), true, '현금이 있으면 열린다');
  });

  it('보유 주식만 있어도(현금 0) 창구가 열린다', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');
    market.buy({ playerId: 's1', instrumentId: 'AIR', quantity: 1, cash: 1_000_000 });
    market.closeWindow();

    // When / Then
    assert.equal(market.hasTradableAssets({ playerId: 's1', cash: 0 }), true);
  });

  it('예금만 있어도(현금 0) 창구가 열린다', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');
    market.deposit({ playerId: 's1', amount: 10_000, cash: 10_000 });
    market.closeWindow();

    // When / Then
    assert.equal(market.hasTradableAssets({ playerId: 's1', cash: 0 }), true);
  });

  it('매수는 현금을 쓰고 보유를 늘리며 예산을 깎는다', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');

    // When
    const result = market.buy({ playerId: 's1', instrumentId: 'AIR', quantity: 40, cash: 1_000_000 });

    // Then
    assert.deepEqual(typesOf(result.events), [MARKET_EVENT_TYPES.ORDER_FILLED]);
    assert.equal(result.intents.length, 2, '명목금액과 수수료를 따로 발행한다');
    assert.equal(market.holdingsOf('s1')[0].qty, 40);
    assert.equal(market.budgetOf('s1').ordersLeft, 2);
  });

  it('창구가 닫혀 있으면 거래 커맨드를 거부한다', () => {
    // Given
    const market = freshMarket();

    // When / Then
    assert.throws(() => market.buy({ playerId: 's1', instrumentId: 'AIR', quantity: 1, cash: 1e6 }), {
      code: DOMAIN_ERROR_CODES.INVALID_PHASE,
    });
    assert.throws(() => market.deposit({ playerId: 's1', amount: 10_000, cash: 1e6 }), {
      code: DOMAIN_ERROR_CODES.INVALID_PHASE,
    });
  });

  it('창구가 열린 좌석이 아니면 거부한다(남의 창구로 거래 불가)', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');

    // When / Then
    assert.throws(() => market.buy({ playerId: 's2', instrumentId: 'AIR', quantity: 1, cash: 1e6 }), {
      code: DOMAIN_ERROR_CODES.NOT_YOUR_TURN,
    });
  });

  it('없는 종목은 거부한다(존재 검증은 도메인이 한다)', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');

    // When / Then
    assert.throws(() => market.buy({ playerId: 's1', instrumentId: 'NOPE', quantity: 1, cash: 1e6 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });

  it('주문 3건을 쓰면 예산이 소진돼 창구가 자동으로 닫힌다', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');

    // When
    market.buy({ playerId: 's1', instrumentId: 'AIR', quantity: 1, cash: 1_000_000 });
    market.buy({ playerId: 's1', instrumentId: 'AIR', quantity: 1, cash: 1_000_000 });
    assert.equal(market.windowExhausted, false);
    market.buy({ playerId: 's1', instrumentId: 'AIR', quantity: 1, cash: 1_000_000 });

    // Then
    assert.equal(market.windowExhausted, true);
  });
});

describe('Market — 예약 주문', () => {
  it('자기 좌석 예약을 걸고 취소할 수 있다(창구와 무관)', () => {
    // Given
    const market = freshMarket();

    // When
    const placed = market.queueOrder({
      seatId: 's2',
      kind: ORDER_KINDS.BUY_STOCK,
      instrumentId: 'CON',
      quantity: 20,
    });

    // Then
    assert.equal(placed.events[0].type, MARKET_EVENT_TYPES.QUEUED_ORDER_PLACED);
    assert.deepEqual(placed.events[0].payload, {
      playerId: 's2',
      orderId: 'ord-1',
      kind: 'BUY_STOCK',
      instrumentId: 'CON',
      quantity: 20,
      amount: null,
    });

    // When
    const cancelled = market.cancelQueuedOrder({ seatId: 's2', orderId: 'ord-1' });

    // Then
    assert.equal(cancelled.events[0].type, MARKET_EVENT_TYPES.QUEUED_ORDER_CANCELLED);
    assert.deepEqual(market.viewModel({ seatIds: SEATS, actingSeatId: null }).orderQueue, []);
  });

  it('예약 주문의 종목은 등록 시점에 존재해야 한다', () => {
    // Given
    const market = freshMarket();

    // When / Then
    assert.throws(
      () =>
        market.queueOrder({
          seatId: 's1',
          kind: ORDER_KINDS.BUY_STOCK,
          instrumentId: 'NOPE',
          quantity: 1,
        }),
      { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
    );
  });

  it('창구가 열리면 예약이 등록 순서로 자동 체결된다', () => {
    // Given
    const market = freshMarket();
    market.queueOrder({ seatId: 's1', kind: ORDER_KINDS.BUY_STOCK, instrumentId: 'AIR', quantity: 10 });
    market.queueOrder({ seatId: 's1', kind: ORDER_KINDS.DEPOSIT, amount: 100_000 });

    // When
    market.openWindow('s1');
    const result = market.runQueuedOrders({ playerId: 's1', cash: 1_000_000 });

    // Then
    assert.deepEqual(typesOf(result.events), [
      MARKET_EVENT_TYPES.QUEUED_ORDER_EXECUTED,
      MARKET_EVENT_TYPES.ORDER_FILLED,
      MARKET_EVENT_TYPES.QUEUED_ORDER_EXECUTED,
      MARKET_EVENT_TYPES.DEPOSIT_MADE,
    ]);
    assert.equal(market.holdingsOf('s1')[0].qty, 10);
    assert.equal(market.depositOf('s1'), 100_000);
    assert.equal(market.budgetOf('s1').ordersLeft, 1, '예약도 창구 예산을 쓴다');
  });

  it('예약은 체결 시점에 재검증되고 실패하면 사유와 함께 버려진다(흐름은 멈추지 않는다)', () => {
    // Given (현금 10,000원으로는 AIR 10주(120,000원)를 살 수 없다)
    const market = freshMarket();
    market.queueOrder({ seatId: 's1', kind: ORDER_KINDS.BUY_STOCK, instrumentId: 'AIR', quantity: 10 });
    market.queueOrder({ seatId: 's1', kind: ORDER_KINDS.DEPOSIT, amount: 10_000 });

    // When
    market.openWindow('s1');
    const result = market.runQueuedOrders({ playerId: 's1', cash: 10_000 });

    // Then
    const rejected = find(result.events, MARKET_EVENT_TYPES.QUEUED_ORDER_REJECTED);
    assert.deepEqual(rejected.payload, {
      playerId: 's1',
      orderId: 'ord-1',
      kind: 'BUY_STOCK',
      reasonCode: REJECT_REASONS.INSUFFICIENT_CASH,
    });
    assert.equal(market.depositOf('s1'), 10_000, '뒤의 예약은 그대로 체결된다');
    assert.equal(market.holdingsOf('s1').length, 0);
  });

  it('예약 체결 중 도메인 오류가 아닌 예외는 삼키지 않는다(버그를 숨기지 않는다)', () => {
    // Given (규칙 위반은 사유 코드로 버리지만, 프로그래밍 오류를 "주문 거절"로 바꿔 버리면
    //        결함이 조용히 묻힌다. 예상 못 한 예외는 위로 올라가 ERR010 + 서버 로그가 돼야 한다)
    const market = freshMarket();
    market.queueOrder({ seatId: 's1', kind: ORDER_KINDS.BUY_STOCK, instrumentId: 'AIR', quantity: 1 });
    market.openWindow('s1');
    const instrument = market.instrumentOf('AIR');
    instrument.isListed = () => {
      throw new TypeError('시장 내부 결함');
    };

    // When / Then
    assert.throws(() => market.runQueuedOrders({ playerId: 's1', cash: 1_000_000 }), TypeError);
  });

  it('상장폐지된 종목의 예약은 버려진다', () => {
    // Given
    const market = Market.restore({
      ...freshMarket().toSnapshot(),
      instruments: [
        { id: 'AIR', price: 2_400, state: 'DELISTED', series: [2_400] },
        { id: 'CON', price: 8_000, state: 'LISTED', series: [8_000] },
        { id: 'HOT', price: 15_000, state: 'LISTED', series: [15_000] },
        { id: 'ENT', price: 6_000, state: 'LISTED', series: [6_000] },
        { id: 'NRG', price: 20_000, state: 'LISTED', series: [20_000] },
      ],
      orderQueue: {
        orders: [
          { id: 'ord-1', seatId: 's1', kind: 'BUY_STOCK', instrumentId: 'AIR', quantity: 1, amount: null },
        ],
        sequence: 1,
      },
    });

    // When
    market.openWindow('s1');
    const result = market.runQueuedOrders({ playerId: 's1', cash: 1_000_000 });

    // Then
    assert.equal(
      find(result.events, MARKET_EVENT_TYPES.QUEUED_ORDER_REJECTED).payload.reasonCode,
      REJECT_REASONS.DELISTED,
    );
  });

  it('예약이 창구 예산을 다 쓰면 나머지는 한도 초과로 버려진다', () => {
    // Given
    const market = freshMarket();
    for (let index = 0; index < 3; index += 1) {
      market.queueOrder({ seatId: 's1', kind: ORDER_KINDS.DEPOSIT, amount: 10_000 });
    }

    // When (예약은 3건까지이므로 3건 모두 체결되고 예산이 소진된다)
    market.openWindow('s1');
    const result = market.runQueuedOrders({ playerId: 's1', cash: 1_000_000 });

    // Then
    assert.equal(
      result.events.filter((event) => event.type === MARKET_EVENT_TYPES.QUEUED_ORDER_EXECUTED).length,
      3,
    );
    assert.equal(market.windowExhausted, true);
  });
});

describe('Market — 라운드 틱(설계서 §2.3)', () => {
  it('틱 순서는 국면 → 뉴스 → 금리 → 시세 → 상장폐지 → 신규상장 → 예금 이자다', () => {
    // Given (회복 1년차 → 국면 전이 판정에 난수를 쓰지 않는다)
    const market = freshMarket();
    market.openWindow('s1');
    market.deposit({ playerId: 's1', amount: 1_000_000, cash: 2_000_000 });
    market.closeWindow();

    // When (뉴스 0번 = NV1, 충격 전부 0)
    const result = market.roundTick({
      round: 2,
      random: tickRandom(),
      players: [{ id: 's1', loanDebt: 0 }],
    });

    // Then
    assert.deepEqual(typesOf(result.events), [
      MARKET_EVENT_TYPES.NEWS_PUBLISHED,
      MARKET_EVENT_TYPES.PRICES_UPDATED,
      MARKET_EVENT_TYPES.DEPOSIT_INTEREST_PAID,
    ]);
    const interest = find(result.events, MARKET_EVENT_TYPES.DEPOSIT_INTEREST_PAID);
    assert.deepEqual(interest.payload, {
      playerId: 's1',
      amount: 5_000,
      balance: 1_000_000,
      baseRateBp: 50,
    });
    assert.equal(result.intents.length, 1);
    assert.equal(result.intents[0].reason, MONEY_REASONS.DEPOSIT_INTEREST);
  });

  it('국면이 바뀌면 CYCLE_CHANGED가 먼저 나오고 그 국면의 뉴스를 뽑는다', () => {
    // Given (회복 2년차 → 전이 판정. 확률 40이므로 1이면 전이 → 호황)
    const market = Market.restore({ ...freshMarket().toSnapshot(), cycle: { phase: 'RECOVERY', age: 2 } });

    // When
    const result = market.roundTick({ round: 3, random: tickRandom({ cycleRoll: 1 }), players: [] });

    // Then
    const changed = find(result.events, MARKET_EVENT_TYPES.CYCLE_CHANGED);
    assert.deepEqual(changed.payload, { from: 'RECOVERY', to: 'EXPANSION', round: 3 });
    assert.equal(find(result.events, MARKET_EVENT_TYPES.NEWS_PUBLISHED).payload.cyclePhase, 'EXPANSION');
    assert.equal(typesOf(result.events)[0], MARKET_EVENT_TYPES.CYCLE_CHANGED);
  });

  it('기준금리는 뉴스의 RATE 효과로만 움직인다', () => {
    // Given (회복 덱 3번째 카드 = NV3: RATE −25, ALL +200)
    const market = freshMarket();

    // When
    const result = market.roundTick({ round: 2, random: tickRandom({ newsPick: 2 }), players: [] });

    // Then
    assert.equal(find(result.events, MARKET_EVENT_TYPES.NEWS_PUBLISHED).payload.id, 'NV3');
    assert.deepEqual(find(result.events, MARKET_EVENT_TYPES.BASE_RATE_CHANGED).payload, {
      from: 50,
      to: 25,
      changeBp: -25,
    });
  });

  it('금리가 경계에서 더 움직이지 않으면 이벤트도 나오지 않는다', () => {
    // Given (이미 하한 25bp에서 NV3의 −25bp)
    const market = Market.restore({ ...freshMarket().toSnapshot(), baseRateBp: 25 });

    // When
    const result = market.roundTick({ round: 2, random: tickRandom({ newsPick: 2 }), players: [] });

    // Then
    assert.equal(find(result.events, MARKET_EVENT_TYPES.BASE_RATE_CHANGED), undefined);
  });

  it('뉴스의 섹터·ALL 효과가 해당 종목에만 정확히 적용된다', () => {
    // Given (회복 덱 첫 카드 = NV1: 항공 +500, 호텔 +400. 회복 drift +150, 충격 0)
    const market = freshMarket();

    // When
    const result = market.roundTick({ round: 2, random: tickRandom({ newsPick: 0 }), players: [] });

    // Then (AIR 12,000 × (1 + 0.0150 + 0.0500) = 12,780 → 12,800)
    const changes = find(result.events, MARKET_EVENT_TYPES.PRICES_UPDATED).payload.changes;
    const byId = Object.fromEntries(changes.map((change) => [change.instrumentId, change.to]));
    assert.equal(byId.AIR, 12_800, '항공 +500bp + drift +150bp');
    assert.equal(byId.HOT, 15_800, '호텔 +400bp + drift +150bp: 15,825 → 15,800');
    assert.equal(byId.CON, 8_100, '효과 없는 섹터는 drift만: 8,120 → 8,100');
    assert.equal(byId.ENT, 6_100, '6,090 → 6,100');
    assert.equal(byId.NRG, 20_300, '20,300');
  });

  it('보드 압력은 다음 틱에 반영되고 반영 뒤에는 비워진다(내부정보 차단)', () => {
    // Given
    const market = freshMarket();
    market.nudge({ sector: SECTORS.CONSTRUCTION, bp: 300 });
    market.nudge({ sector: SECTORS.CONSTRUCTION, bp: 100 });

    // Then (아직 가격은 그대로, 전원에게 공개된다)
    assert.deepEqual(market.viewModel({ seatIds: SEATS, actingSeatId: null }).pendingNudges, [
      { sector: 'CONSTRUCTION', bp: 400, label: '건설' },
    ]);
    assert.equal(market.instrumentOf('CON').price, 8_000, '즉시 반영되지 않는다');

    // When (CON: drift 150 + nudge 400 = 550bp → 8,000 × 1.055 = 8,440 → 8,400)
    const result = market.roundTick({ round: 2, random: tickRandom({ newsPick: 0 }), players: [] });

    // Then
    const changes = find(result.events, MARKET_EVENT_TYPES.PRICES_UPDATED).payload.changes;
    assert.equal(changes.find((change) => change.instrumentId === 'CON').to, 8_400);
    assert.deepEqual(market.viewModel({ seatIds: SEATS, actingSeatId: null }).pendingNudges, []);
  });

  it('보드 압력은 섹터별로 ±600bp로 묶인다', () => {
    // Given
    const market = freshMarket();

    // When
    market.nudge({ sector: SECTORS.ENTERTAINMENT, bp: 500 });
    market.nudge({ sector: SECTORS.ENTERTAINMENT, bp: 500 });

    // Then
    assert.deepEqual(market.viewModel({ seatIds: SEATS, actingSeatId: null }).pendingNudges, [
      { sector: 'ENTERTAINMENT', bp: 600, label: '카지노·엔터' },
    ]);
  });

  it('상장폐지되면 보유가 전액 소각되고 현금은 움직이지 않으며, 다음 틱에 신규 상장된다', () => {
    // Given (ENT를 임계 바로 위에 두고 보유를 만든다)
    const market = Market.restore({
      ...freshMarket().toSnapshot(),
      cycle: { phase: 'RECESSION', age: 1 },
      instruments: [
        { id: 'AIR', price: 12_000, state: 'LISTED', series: [12_000] },
        { id: 'CON', price: 8_000, state: 'LISTED', series: [8_000] },
        { id: 'HOT', price: 15_000, state: 'LISTED', series: [15_000] },
        { id: 'ENT', price: 1_300, state: 'LISTED', series: [1_300] },
        { id: 'NRG', price: 20_000, state: 'LISTED', series: [20_000] },
      ],
      holdings: { s1: { ENT: { qty: 80, avgCost: 6_000 } } },
    });

    // When (침체 덱 6번째 = NR6 "구조조정": 전 종목 −500, drift −150, 그리고 D45 평균 회귀가 1,300원(기준가 22%)에서
    //        +600으로 버틴다 → 이것만으로는 폐지되지 않으므로 ENT에 −900 충격을 주입한다:
    //        합계 −500 −150 +600 −900 = −950 → 1,300 × 0.905 = 1,176.5 → 반올림 1,200 = 하한 = 상장폐지 임계.
    //        NR5는 D44로 카지노 +400인 방어 카드가 되어 더는 ENT를 떨어뜨리지 않는다.)
    const first = market.roundTick({
      round: 2,
      random: tickRandom({ newsPick: 5, shocks: [0, 0, 0, -900, 0] }),
      players: [],
    });

    // Then
    assert.deepEqual(find(first.events, MARKET_EVENT_TYPES.INSTRUMENT_DELISTED).payload, {
      instrumentId: 'ENT',
      name: '네온엔터카지노',
      price: 1_200,
    });
    assert.deepEqual(find(first.events, MARKET_EVENT_TYPES.HOLDINGS_WIPED).payload, {
      playerId: 's1',
      instrumentId: 'ENT',
      quantity: 80,
      costBasis: 480_000,
    });
    assert.equal(first.intents.length, 0, '상장폐지는 현금을 움직이지 않는다');
    assert.equal(market.holdingsOf('s1').length, 0);
    assert.equal(market.instrumentIds.length, 5, '이번 틱에는 아직 폐지 종목이 목록에 남는다');

    // When (다음 틱 — 침체 2년차라 국면 판정을 하고, 폐지된 ENT는 시세 틱을 돌지 않아 충격이 4개다)
    const second = market.roundTick({
      round: 3,
      random: tickRandom({ cycleRoll: 100, newsPick: 0, shocks: [0, 0, 0, 0] }),
      players: [],
    });

    // Then
    assert.deepEqual(find(second.events, MARKET_EVENT_TYPES.INSTRUMENT_LISTED).payload, {
      instrumentId: 'SKY',
      name: '새벽항공운수',
      sector: 'AIRLINE',
      price: 9_000,
    });
    assert.equal(market.instrumentIds.length, 5, '항상 5종목을 유지한다');
    assert.ok(!market.instrumentIds.includes('ENT'));
    assert.ok(market.instrumentIds.includes('SKY'));
  });

  it('예금 이자는 대출 채무가 있는 좌석에게 나가지 않는다', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');
    market.deposit({ playerId: 's1', amount: 1_000_000, cash: 2_000_000 });
    market.closeWindow();
    market.openWindow('s2');
    market.deposit({ playerId: 's2', amount: 1_000_000, cash: 2_000_000 });
    market.closeWindow();

    // When
    const result = market.roundTick({
      round: 2,
      random: tickRandom(),
      players: [
        { id: 's1', loanDebt: 0 },
        { id: 's2', loanDebt: 1_200_000 },
      ],
    });

    // Then
    const paid = result.events.filter((event) => event.type === MARKET_EVENT_TYPES.DEPOSIT_INTEREST_PAID);
    assert.equal(paid.length, 1);
    assert.equal(paid[0].payload.playerId, 's1');
  });

  it('탈락한 좌석에게는 이자를 주지 않는다(보존 불변식 보호)', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');
    market.deposit({ playerId: 's1', amount: 1_000_000, cash: 2_000_000 });
    market.closeWindow();

    // When
    const result = market.roundTick({
      round: 2,
      random: tickRandom(),
      players: [{ id: 's1', loanDebt: 0, eliminated: true }],
    });

    // Then
    assert.equal(find(result.events, MARKET_EVENT_TYPES.DEPOSIT_INTEREST_PAID), undefined);
    assert.equal(result.intents.length, 0);
  });
});

describe('Market — 배당(출발 통과)', () => {
  it('상장 종목만, 1주 배당 내림으로 지급한다', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');
    market.buy({ playerId: 's1', instrumentId: 'AIR', quantity: 40, cash: 1_000_000 });
    market.buy({ playerId: 's1', instrumentId: 'ENT', quantity: 10, cash: 1_000_000 });
    market.closeWindow();

    // When
    const result = market.dividendsFor('s1');

    // Then (AIR 12,000 × 150bp = 180원/주 × 40 = 7,200원 / ENT는 무배당)
    assert.equal(result.events.length, 1);
    assert.deepEqual(result.events[0].payload, {
      playerId: 's1',
      instrumentId: 'AIR',
      name: '한빛항공',
      quantity: 40,
      perShare: 180,
      amount: 7_200,
    });
    assert.equal(result.intents[0].amount, 7_200);
    assert.equal(result.intents[0].reason, MONEY_REASONS.DIVIDEND);
  });

  it('보유가 없으면 아무 일도 없다', () => {
    // Given / When
    const result = freshMarket().dividendsFor('s1');

    // Then
    assert.deepEqual(result, { intents: [], events: [] });
  });
});

describe('MarketAssets(AssetProvider 구현 — 주식·예금)', () => {
  it('정리 순서는 주식(30) → 예금(50) → 부동산(100)이다', () => {
    // Given
    const market = freshMarket();

    // When
    const [stocks, deposits] = market.assetProviders();

    // Then
    assert.equal(stocks.kind, STOCK_ASSET_KIND);
    assert.equal(deposits.kind, DEPOSIT_ASSET_KIND);
    assert.ok(stocks.liquidationPriority < deposits.liquidationPriority);
    assert.ok(deposits.liquidationPriority < PROPERTY_LIQUIDATION_PRIORITY);
  });

  it('매각 목록에 보유 주식과 예금이 오르고 상장폐지 종목은 빠진다', () => {
    // Given
    const market = Market.restore({
      ...freshMarket().toSnapshot(),
      instruments: [
        { id: 'AIR', price: 12_000, state: 'LISTED', series: [12_000] },
        { id: 'CON', price: 8_000, state: 'LISTED', series: [8_000] },
        { id: 'HOT', price: 15_000, state: 'LISTED', series: [15_000] },
        { id: 'ENT', price: 1_100, state: 'DELISTED', series: [1_100] },
        { id: 'NRG', price: 20_000, state: 'LISTED', series: [20_000] },
      ],
      holdings: { s1: { AIR: { qty: 10, avgCost: 11_000 }, ENT: { qty: 5, avgCost: 6_000 } } },
      deposits: { s1: 300_000 },
    });
    const [stocks, deposits] = market.assetProviders();

    // When / Then
    assert.deepEqual(stocks.listOf('s1'), [
      {
        kind: STOCK_ASSET_KIND,
        assetId: 'AIR',
        label: '한빛항공',
        refund: 120_000,
        quantity: 10,
        view: {
          assetKind: STOCK_ASSET_KIND,
          assetId: 'AIR',
          // 자산군이 섞인 한 배열을 렌더러 하나로 그릴 수 있어야 한다 — 이름 필드 키를
          // 자산군마다 다르게 두면(부동산 name / 주식 label) 클라이언트가 분기해야 한다.
          name: '한빛항공',
          label: '한빛항공',
          refund: 120_000,
          quantity: 10,
          maxQuantity: 10,
          unitValue: 12_000,
        },
      },
    ]);
    assert.deepEqual(deposits.listOf('s1'), [
      {
        kind: DEPOSIT_ASSET_KIND,
        assetId: 'CASH',
        label: '예금',
        refund: 300_000,
        quantity: 300_000,
        view: {
          assetKind: DEPOSIT_ASSET_KIND,
          assetId: 'CASH',
          name: '예금',
          label: '예금',
          refund: 300_000,
          quantity: 300_000,
          maxQuantity: 300_000,
          unitValue: 1,
        },
      },
    ]);
  });

  it('평가액은 주식 시가와 예금 잔액이고 상장폐지는 0이다', () => {
    // Given
    const market = Market.restore({
      ...freshMarket().toSnapshot(),
      instruments: [
        { id: 'AIR', price: 13_000, state: 'LISTED', series: [13_000] },
        { id: 'CON', price: 8_000, state: 'LISTED', series: [8_000] },
        { id: 'HOT', price: 15_000, state: 'LISTED', series: [15_000] },
        { id: 'ENT', price: 1_100, state: 'DELISTED', series: [1_100] },
        { id: 'NRG', price: 20_000, state: 'LISTED', series: [20_000] },
      ],
      holdings: { s1: { AIR: { qty: 10, avgCost: 11_000 }, ENT: { qty: 5, avgCost: 6_000 } } },
      deposits: { s1: 300_000 },
    });
    const [stocks, deposits] = market.assetProviders();

    // When / Then
    assert.equal(stocks.valueOf('s1'), 130_000);
    assert.equal(deposits.valueOf('s1'), 300_000);
  });

  it('정리 매각은 수수료 없이 일부 수량만 팔 수 있다', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');
    market.buy({ playerId: 's1', instrumentId: 'AIR', quantity: 10, cash: 1_000_000 });
    market.closeWindow();
    const [stocks] = market.assetProviders();

    // When
    const result = stocks.liquidate({ playerId: 's1', assetId: 'AIR', quantity: 4 });

    // Then
    assert.equal(result.refund, 48_000);
    assert.equal(result.intents[0].reason, MONEY_REASONS.LIQUIDATION);
    assert.equal(result.events[0].payload.fee, 0);
    assert.equal(market.holdingsOf('s1')[0].qty, 6);
  });

  it('예금 일부 인출도 10,000원 단위여야 한다', () => {
    // Given
    const market = Market.restore({ ...freshMarket().toSnapshot(), deposits: { s1: 300_000 } });
    const [, deposits] = market.assetProviders();

    // When
    const result = deposits.liquidate({ playerId: 's1', assetId: 'CASH', quantity: 120_000 });

    // Then
    assert.equal(result.refund, 120_000);
    assert.equal(market.depositOf('s1'), 180_000);
    assert.throws(() => deposits.liquidate({ playerId: 's1', assetId: 'CASH', quantity: 5_000 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });

  it('파산 청산은 전 종목 시장가 매도 + 예금 전액 인출이다(수수료 면제)', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');
    market.buy({ playerId: 's1', instrumentId: 'AIR', quantity: 10, cash: 1_000_000 });
    market.buy({ playerId: 's1', instrumentId: 'CON', quantity: 10, cash: 1_000_000 });
    market.deposit({ playerId: 's1', amount: 200_000, cash: 1_000_000 });
    market.closeWindow();
    const [stocks, deposits] = market.assetProviders();

    // When
    const soldStocks = stocks.releaseAllOf('s1');
    const drained = deposits.releaseAllOf('s1');

    // Then (AIR 120,000 + CON 80,000 = 200,000)
    assert.equal(soldStocks.intents.reduce((sum, intent) => sum + intent.amount, 0), 200_000);
    assert.equal(drained.intents[0].amount, 200_000);
    assert.equal(market.holdingsOf('s1').length, 0);
    assert.equal(market.depositOf('s1'), 0);
    assert.deepEqual(soldStocks.events.map((event) => event.payload.fee), [0, 0]);
  });

  it('파산 청산은 예약 주문도 함께 지운다', () => {
    // Given
    const market = freshMarket();
    market.queueOrder({ seatId: 's1', kind: ORDER_KINDS.DEPOSIT, amount: 10_000 });
    const [stocks] = market.assetProviders();

    // When
    const result = stocks.releaseAllOf('s1');

    // Then
    assert.equal(market.viewModel({ seatIds: SEATS, actingSeatId: null }).orderQueue.length, 0);
    assert.ok(
      result.events.some((event) => event.type === MARKET_EVENT_TYPES.QUEUED_ORDER_CANCELLED),
      '취소 이벤트가 남아야 한다',
    );
  });
});

describe('Market — 스냅샷', () => {
  it('스냅샷을 왕복해도 시장 상태가 그대로다', () => {
    // Given
    const market = freshMarket();
    market.nudge({ sector: SECTORS.HOTEL, bp: 100 });
    market.queueOrder({ seatId: 's2', kind: ORDER_KINDS.DEPOSIT, amount: 20_000 });
    market.openWindow('s1');
    market.buy({ playerId: 's1', instrumentId: 'AIR', quantity: 3, cash: 1_000_000 });
    market.roundTick({ round: 2, random: tickRandom(), players: [{ id: 's1', loanDebt: 0 }] });

    // When
    const restored = Market.restore(market.toSnapshot());

    // Then
    assert.deepEqual(restored.toSnapshot(), market.toSnapshot());
  });

  it('같은 시드로 돌리면 같은 시세가 나온다(결정성)', () => {
    // Given
    const runOnce = () => {
      const market = freshMarket();
      const random = new SeededRandomSource(4_242);
      for (let round = 2; round <= 12; round += 1) {
        market.roundTick({ round, random, players: [] });
      }
      return market.toSnapshot().instruments;
    };

    // When / Then
    assert.deepEqual(runOnce(), runOnce());
  });

  it('열린 창구와 남은 예산도 저장된다 — 새로고침으로 예산을 되돌리는 악용을 막는다', () => {
    // Given (방 파일은 커맨드마다 저장되므로, 창구 도중 재접속이 언제든 일어난다)
    const market = freshMarket();
    market.openWindow('s1');
    market.buy({ playerId: 's1', instrumentId: 'AIR', quantity: 2, cash: 1_000_000 });

    // When
    const restored = Market.restore(market.toSnapshot());

    // Then
    assert.deepEqual(market.toSnapshot().window, { seatId: 's1', budget: { ordersUsed: 1, notionalUsed: 24_000 } });
    assert.equal(restored.openSeatId, 's1');
    assert.equal(restored.budgetOf('s1').ordersLeft, 2, '예산이 되살아나면 3건이 될 것이다');
    assert.deepEqual(restored.toSnapshot(), market.toSnapshot());
  });

  it('창구를 닫으면 저장에서도 사라진다', () => {
    // Given
    const market = freshMarket();
    market.openWindow('s1');

    // When
    market.closeWindow();

    // Then
    assert.equal(market.toSnapshot().window, null);
    assert.equal(market.openSeatId, null);
  });
});

describe('Market — 시세 변화의 분해(뉴스·추세·압력·운)', () => {
  it('PRICES_UPDATED의 각 변화에 분해값이 실리고, 합이 tickBp와 같다', () => {
    // Given (회복 국면, 회복 덱 5번째 = NV5: 엔터 +1000·호텔 +300, 충격은 종목마다 다르게)
    const market = Market.restore({ ...freshMarket().toSnapshot(), cycle: { phase: 'RECOVERY', age: 1 } });

    // When
    const result = market.roundTick({
      round: 2,
      random: tickRandom({ newsPick: 4, shocks: [100, -200, 300, -900, 0] }),
      players: [],
    });

    // Then
    const changes = find(result.events, MARKET_EVENT_TYPES.PRICES_UPDATED).payload.changes;
    for (const change of changes) {
      const b = change.breakdown;
      assert.ok(b, `${change.instrumentId}에 breakdown이 없다`);
      assert.equal(b.newsBp + b.driftBp + b.nudgeBp + b.shockBp + b.reversionBp, change.tickBp, `${change.instrumentId} 합계`);
      assert.equal(b.driftBp, 150, '회복 추세 = 설계 +100 + 균일 +50');
    }
    const ent = changes.find((change) => change.instrumentId === 'ENT');
    assert.equal(ent.breakdown.newsBp, 1_000, 'NV5의 엔터 효과');
    assert.equal(ent.breakdown.shockBp, -900, '주입한 충격');
    assert.equal(ent.breakdown.nudgeBp, 0);
    const air = changes.find((change) => change.instrumentId === 'AIR');
    assert.equal(air.breakdown.newsBp, 0, 'NV5는 항공을 건드리지 않는다');
  });
});

describe('Market — 바닥에 눌러붙은 종목은 되돌아온다(D45 평균 회귀)', () => {
  it('기준가의 1/3(2,000원)에서 침체가 이어져도 10라운드 안에 회복하고 상장폐지되지 않는다', () => {
    // Given — 오너의 43라운드 방에서 실제로 난 값: ENT 2,000원(기준가 6,000), 침체 국면
    const market = Market.restore({
      ...freshMarket().toSnapshot(),
      cycle: { phase: 'RECESSION', age: 1 },
      instruments: [
        { id: 'AIR', price: 12_000, state: 'LISTED', series: [12_000] },
        { id: 'CON', price: 8_000, state: 'LISTED', series: [8_000] },
        { id: 'HOT', price: 15_000, state: 'LISTED', series: [15_000] },
        { id: 'ENT', price: 2_000, state: 'LISTED', series: [2_000] },
        { id: 'NRG', price: 20_000, state: 'LISTED', series: [20_000] },
      ],
    });

    // When — 침체에 머문 채(국면 판정 실패) 충격 0으로 10라운드. 뉴스는 남은 더미의 첫 장(pick 0)을 뽑아
    //        어떤 침체 카드가 오든 상관없이 "침체가 이어지는 상황"만 만든다(더미는 소진되면 스스로 재섞인다).
    const prices = [];
    for (let round = 2; round <= 11; round += 1) {
      // 첫 라운드는 국면 나이가 1이라 국면 판정을 하지 않는다(난수를 안 뽑는다) — 그 뒤부터 100으로 침체 유지.
      const cycleRoll = round === 2 ? null : 100;
      market.roundTick({ round, random: tickRandom({ cycleRoll, newsPick: 0 }), players: [] });
      prices.push(market.viewModel().instruments.find((item) => item.id === 'ENT').price);
    }

    // Then — 복원력(+600/라운드)이 침체 drift(−150)와 악재 카드(최대 −500)를 이기고 끌어올린다
    const last = prices.at(-1);
    assert.ok(last > 2_500, `10라운드 뒤 ENT ${last}원 — 회복하지 않았다: ${prices.join(' → ')}`);
    assert.ok(prices.every((price) => price > 1_200), '상장폐지 선(1,200원) 아래로 내려가면 안 된다');
    assert.ok(market.instrumentIds.includes('ENT'), '상장폐지되지 않았다');
  });
});
