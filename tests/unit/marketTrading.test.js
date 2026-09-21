import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DepositAccount, DEPOSIT_CAP, DEPOSIT_UNIT } from '../../src/domain/market/DepositAccount.js';
import { Holdings, MAX_POSITION_PER_INSTRUMENT } from '../../src/domain/market/Holdings.js';
import { Instrument } from '../../src/domain/market/Instrument.js';
import {
  MAX_QUEUED_ORDERS_PER_SEAT,
  ORDER_KINDS,
  OrderQueue,
} from '../../src/domain/market/OrderQueue.js';
import {
  MAX_NOTIONAL_PER_ORDER,
  MAX_NOTIONAL_PER_WINDOW,
  MAX_ORDERS_PER_WINDOW,
  TradeBudget,
} from '../../src/domain/market/TradeBudget.js';
import {
  FEE_BP,
  FEE_MIN,
  MAX_QUANTITY,
  MIN_QUANTITY,
  REJECT_REASONS,
  TradingDesk,
} from '../../src/domain/market/TradingDesk.js';
import { BaseRate } from '../../src/domain/market/BaseRate.js';
import { LISTED_INSTRUMENTS, instrumentSpecById } from '../../src/domain/market/data/instruments.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';
import { MONEY_REASONS } from '../../src/domain/shared/MoneyIntent.js';

const air = () => Instrument.fromSpec(instrumentSpecById('AIR'));
const delistedAir = () =>
  Instrument.restore({ id: 'AIR', price: 2_400, state: 'DELISTED', series: [2_400] });

/** 매수/매도 한 건을 실행하기 위한 기본 재료. */
function desk({ cash = 10_000_000, budget = TradeBudget.open(), holdings = new Holdings() } = {}) {
  return { tradingDesk: new TradingDesk(), cash, budget, holdings };
}

/** intent 목록을 { reason: 합계 }로 요약한다(부호 포함). */
function byReason(intents) {
  const summary = {};
  for (const intent of intents) {
    summary[intent.reason] = (summary[intent.reason] ?? 0) + intent.amount;
  }
  return summary;
}

describe('Holdings(보유 포지션과 평균 매입가)', () => {
  it('매수하면 수량이 늘고 평단이 가중평균(내림)으로 갱신된다', () => {
    // Given
    const holdings = new Holdings();

    // When
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 10, price: 12_000 });
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 5, price: 15_000 });

    // Then (10×12,000 + 5×15,000 = 195,000 / 15 = 13,000)
    assert.equal(holdings.qtyOf('s1', 'AIR'), 15);
    assert.deepEqual(holdings.positionsOf('s1'), [
      { instrumentId: 'AIR', qty: 15, avgCost: 13_000 },
    ]);
  });

  it('매도해도 평단은 그대로다(이동평균 방식)', () => {
    // Given
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 10, price: 12_000 });

    // When
    const removed = holdings.remove({ playerId: 's1', instrumentId: 'AIR', quantity: 4 });

    // Then
    assert.equal(holdings.qtyOf('s1', 'AIR'), 6);
    assert.equal(holdings.positionsOf('s1')[0].avgCost, 12_000);
    assert.equal(removed.costBasis, 48_000, '4 × 12,000');
  });

  it('전량 매도하면 포지션이 사라진다', () => {
    // Given
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 3, price: 12_000 });

    // When
    holdings.remove({ playerId: 's1', instrumentId: 'AIR', quantity: 3 });

    // Then
    assert.deepEqual(holdings.positionsOf('s1'), []);
    assert.equal(holdings.hasAny('s1'), false);
  });

  it('보유보다 많이 팔 수 없고 음수·비정수 수량은 거부한다', () => {
    // Given
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 3, price: 12_000 });

    // When / Then
    assert.throws(() => holdings.remove({ playerId: 's1', instrumentId: 'AIR', quantity: 4 }), {
      code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH,
    });
    for (const quantity of [0, -1, 1.5, Number.NaN, '3']) {
      assert.throws(
        () => holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity, price: 100 }),
        { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
        `거부되지 않았다: ${String(quantity)}`,
      );
    }
  });

  it('종목별 보유 상한은 500주다', () => {
    // Given / When / Then
    assert.equal(MAX_POSITION_PER_INSTRUMENT, 500);
  });

  it('상장폐지 소각은 수량과 원가를 알려주고 포지션을 지운다', () => {
    // Given
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'ENT', quantity: 80, price: 6_000 });
    holdings.add({ playerId: 's2', instrumentId: 'ENT', quantity: 10, price: 5_000 });
    holdings.add({ playerId: 's2', instrumentId: 'AIR', quantity: 4, price: 12_000 });

    // When
    const wiped = holdings.wipeAll('ENT');

    // Then
    assert.deepEqual(wiped, [
      { playerId: 's1', instrumentId: 'ENT', quantity: 80, costBasis: 480_000 },
      { playerId: 's2', instrumentId: 'ENT', quantity: 10, costBasis: 50_000 },
    ]);
    assert.equal(holdings.qtyOf('s1', 'ENT'), 0);
    assert.equal(holdings.qtyOf('s2', 'AIR'), 4, '다른 종목은 그대로');
  });

  it('포지션 목록은 종목 id 사전순으로 안정적이다', () => {
    // Given
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'NRG', quantity: 1, price: 20_000 });
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 1, price: 12_000 });
    holdings.add({ playerId: 's1', instrumentId: 'CON', quantity: 1, price: 8_000 });

    // When / Then
    assert.deepEqual(
      holdings.positionsOf('s1').map((position) => position.instrumentId),
      ['AIR', 'CON', 'NRG'],
    );
  });

  it('스냅샷을 왕복해도 같고 손상된 값은 거부한다', () => {
    // Given
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 7, price: 12_000 });

    // When / Then
    assert.deepEqual(new Holdings(holdings.toSnapshot()).toSnapshot(), holdings.toSnapshot());
    assert.throws(() => new Holdings({ s1: { AIR: { qty: -1, avgCost: 100 } } }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.throws(() => new Holdings({ s1: { AIR: { qty: 1, avgCost: -5 } } }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.throws(() => new Holdings({ s1: 'AIR' }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });
});

describe('DepositAccount(예금 계좌)', () => {
  it('예치 단위는 10,000원이고 잔액 상한은 10,000,000원이다', () => {
    // Given / When / Then
    assert.equal(DEPOSIT_UNIT, 10_000);
    assert.equal(DEPOSIT_CAP, 10_000_000);
  });

  it('예치와 인출이 잔액을 바꾼다', () => {
    // Given
    const account = new DepositAccount();

    // When
    assert.equal(account.deposit({ playerId: 's1', amount: 500_000 }), 500_000);
    assert.equal(account.deposit({ playerId: 's1', amount: 200_000 }), 700_000);
    assert.equal(account.withdraw({ playerId: 's1', amount: 300_000 }), 400_000);

    // Then
    assert.equal(account.balanceOf('s1'), 400_000);
    assert.equal(account.balanceOf('s2'), 0);
  });

  it('상한을 넘는 예치는 한도 초과로 거부한다', () => {
    // Given
    const account = new DepositAccount({ s1: 9_990_000 });

    // When / Then
    assert.throws(() => account.deposit({ playerId: 's1', amount: 20_000 }), {
      code: DOMAIN_ERROR_CODES.TRADE_LIMIT,
    });
    assert.equal(account.balanceOf('s1'), 9_990_000, '거부되면 상태가 그대로다');
    assert.equal(account.deposit({ playerId: 's1', amount: 10_000 }), DEPOSIT_CAP, '경계는 통과');
  });

  it('잔액보다 많이 인출할 수 없다', () => {
    // Given
    const account = new DepositAccount({ s1: 100_000 });

    // When / Then
    assert.throws(() => account.withdraw({ playerId: 's1', amount: 110_000 }), {
      code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH,
    });
    assert.equal(account.balanceOf('s1'), 100_000);
  });

  it('단위·범위를 어긴 금액은 거부한다', () => {
    // Given
    const account = new DepositAccount();

    // When / Then
    for (const amount of [0, -10_000, 5_000, 15_000, 10_000_001, 1.5, Number.NaN]) {
      assert.throws(
        () => account.deposit({ playerId: 's1', amount }),
        { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
        `거부되지 않았다: ${String(amount)}`,
      );
    }
  });

  it('이자는 예금에서 총부채를 뺀 금액에만 붙는다(대출이 있으면 0 — 캐리 트레이드 차단)', () => {
    // Given (설계서 §3.8: floor(max(0, 예금 − 총부채) × baseRateBp / 10000))
    const account = new DepositAccount({ s1: 1_000_000, s2: 1_000_000 });
    const rate = new BaseRate(50);

    // When / Then
    assert.equal(account.interestFor({ playerId: 's1', debt: 0, baseRate: rate }), 5_000);
    assert.equal(
      account.interestFor({ playerId: 's2', debt: 1_200_000, baseRate: rate }),
      0,
      '부채가 예금보다 크면 이자 0',
    );
    assert.equal(
      account.interestFor({ playerId: 's1', debt: 600_000, baseRate: rate }),
      2_000,
      'floor((1,000,000 − 600,000) × 50 / 10000)',
    );
    assert.equal(account.interestFor({ playerId: 'none', debt: 0, baseRate: rate }), 0);
  });

  it('전액 인출(정리·파산용)은 잔액을 돌려주고 계좌를 비운다', () => {
    // Given
    const account = new DepositAccount({ s1: 340_000 });

    // When
    const drained = account.drain('s1');

    // Then
    assert.equal(drained, 340_000);
    assert.equal(account.balanceOf('s1'), 0);
    assert.equal(account.drain('s1'), 0, '비어 있으면 0');
  });

  it('스냅샷을 왕복해도 같고 손상된 잔액은 거부한다', () => {
    // Given
    const account = new DepositAccount({ s1: 120_000 });

    // When / Then (스냅샷은 프로토타입이 없는 객체다 — 내용으로 비교한다)
    assert.deepEqual({ ...account.toSnapshot() }, { s1: 120_000 });
    assert.throws(() => new DepositAccount({ s1: -1 }), { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT });
    assert.throws(() => new DepositAccount({ s1: 5_555 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.throws(() => new DepositAccount({ s1: DEPOSIT_CAP + 10_000 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });
});

describe('TradeBudget(창구 예산 VO)', () => {
  it('한도는 3건 / 창구 2,000,000원 / 1건 1,000,000원이다', () => {
    // Given / When / Then
    assert.equal(MAX_ORDERS_PER_WINDOW, 3);
    assert.equal(MAX_NOTIONAL_PER_WINDOW, 2_000_000);
    assert.equal(MAX_NOTIONAL_PER_ORDER, 1_000_000);
  });

  it('새 창구는 예산이 가득 차 있고 소진되지 않았다', () => {
    // Given / When
    const budget = TradeBudget.open();

    // Then
    assert.equal(budget.ordersLeft, 3);
    assert.equal(budget.notionalLeft, 2_000_000);
    assert.equal(budget.exhausted, false);
  });

  it('주문을 쓰면 건수와 명목금액이 함께 줄고, 3건을 다 쓰면 소진된다', () => {
    // Given
    let budget = TradeBudget.open();

    // When
    budget = budget.consume(600_000);
    budget = budget.consume(500_000);

    // Then
    assert.equal(budget.ordersLeft, 1);
    assert.equal(budget.notionalLeft, 900_000);
    assert.equal(budget.exhausted, false);

    // When
    budget = budget.consume(0);

    // Then
    assert.equal(budget.ordersLeft, 0);
    assert.equal(budget.exhausted, true, '건수가 떨어지면 창구가 자동으로 닫힌다');
  });

  it('예금·인출은 건수만 쓰고 명목금액 예산은 쓰지 않는다(예금 한도가 10,000,000원이므로)', () => {
    // Given
    const budget = TradeBudget.open().consume(0);

    // When / Then
    assert.equal(budget.ordersLeft, 2);
    assert.equal(budget.notionalLeft, 2_000_000);
  });

  it('한도 위반을 사유 코드로 알려준다(예외를 던지지 않는다 — 예약 주문 재검증용)', () => {
    // Given
    const full = TradeBudget.open().consume(0).consume(0).consume(0);
    const spent = TradeBudget.open().consume(1_000_000).consume(900_000);

    // When / Then
    assert.deepEqual(TradeBudget.open().check(500_000), { ok: true, reasonCode: null });
    assert.deepEqual(full.check(0), { ok: false, reasonCode: REJECT_REASONS.ORDER_LIMIT });
    assert.deepEqual(spent.check(200_000), {
      ok: false,
      reasonCode: REJECT_REASONS.NOTIONAL_LIMIT,
    });
    assert.deepEqual(TradeBudget.open().check(1_000_001), {
      ok: false,
      reasonCode: REJECT_REASONS.NOTIONAL_LIMIT,
    });
  });

  it('스냅샷을 왕복해도 같고 손상된 값은 거부한다', () => {
    // Given
    const budget = TradeBudget.open().consume(700_000);

    // When / Then
    assert.deepEqual(budget.toSnapshot(), { ordersUsed: 1, notionalUsed: 700_000 });
    assert.deepEqual(new TradeBudget(budget.toSnapshot()).toSnapshot(), budget.toSnapshot());
    assert.throws(() => new TradeBudget({ ordersUsed: -1, notionalUsed: 0 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.throws(() => new TradeBudget({ ordersUsed: 99, notionalUsed: 0 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });
});

describe('TradingDesk(주문 검증·체결·수수료 — 거래의 유일한 진입점)', () => {
  it('수수료는 명목금액의 1%, 최소 1,000원이다', () => {
    // Given / When / Then
    assert.equal(FEE_BP, 100);
    assert.equal(FEE_MIN, 1_000);
    assert.equal(TradingDesk.fee(512_000), 5_120);
    assert.equal(TradingDesk.fee(50_000), 1_000, '1% = 500원이지만 최소 1,000원');
    assert.equal(TradingDesk.fee(100_001), 1_001, '올림(플레이어에게 불리한 산출)');
    assert.equal(TradingDesk.fee(0), FEE_MIN);
  });

  it('수량 범위는 1~200주다', () => {
    // Given / When / Then
    assert.equal(MIN_QUANTITY, 1);
    assert.equal(MAX_QUANTITY, 200);
  });

  it('매수는 명목금액과 수수료를 따로 발행하고 보유·예산을 갱신한다', () => {
    // Given
    const instrument = air();
    const { tradingDesk, holdings } = desk();

    // When
    const result = tradingDesk.buy({
      playerId: 's1',
      instrument,
      quantity: 40,
      cash: 1_000_000,
      budget: TradeBudget.open(),
      holdings,
    });

    // Then
    assert.equal(result.notional, 480_000);
    assert.equal(result.fee, 4_800);
    assert.deepEqual(byReason(result.intents), {
      [MONEY_REASONS.TRADE_BUY]: -480_000,
      [MONEY_REASONS.TRADE_FEE]: -4_800,
    });
    assert.equal(holdings.qtyOf('s1', 'AIR'), 40);
    assert.equal(result.budget.ordersLeft, 2);
    assert.equal(result.budget.notionalLeft, 1_520_000);
    assert.equal(result.events[0].type, 'ORDER_FILLED');
    assert.deepEqual(result.events[0].payload, {
      playerId: 's1',
      kind: 'BUY',
      instrumentId: 'AIR',
      name: '한빛항공',
      quantity: 40,
      price: 12_000,
      notional: 480_000,
      fee: 4_800,
      viaLiquidation: false,
    });
  });

  it('매도는 명목금액을 받고 수수료를 따로 낸다', () => {
    // Given
    const instrument = air();
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 40, price: 11_000 });
    const { tradingDesk } = desk();

    // When
    const result = tradingDesk.sell({
      playerId: 's1',
      instrument,
      quantity: 40,
      budget: TradeBudget.open(),
      holdings,
    });

    // Then
    assert.deepEqual(byReason(result.intents), {
      [MONEY_REASONS.TRADE_SELL]: 480_000,
      [MONEY_REASONS.TRADE_FEE]: -4_800,
    });
    assert.equal(holdings.qtyOf('s1', 'AIR'), 0);
    assert.equal(result.events[0].payload.kind, 'SELL');
  });

  it('현금이 명목금액 + 수수료보다 적으면 거부한다(수수료 회피 불가)', () => {
    // Given (40주 × 12,000 = 480,000 + 수수료 4,800 = 484,800)
    const { tradingDesk, holdings } = desk();

    // When / Then
    assert.throws(
      () =>
        tradingDesk.buy({
          playerId: 's1',
          instrument: air(),
          quantity: 40,
          cash: 484_799,
          budget: TradeBudget.open(),
          holdings,
        }),
      { code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH },
    );
    assert.equal(holdings.qtyOf('s1', 'AIR'), 0, '거부되면 상태가 그대로다');
  });

  it('보유 수량보다 많이 팔면 거부한다', () => {
    // Given
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 5, price: 12_000 });

    // When / Then
    assert.throws(
      () =>
        new TradingDesk().sell({
          playerId: 's1',
          instrument: air(),
          quantity: 6,
          budget: TradeBudget.open(),
          holdings,
        }),
      { code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH },
    );
  });

  it('4번째 주문은 한도 초과로 거부한다', () => {
    // Given
    const budget = TradeBudget.open().consume(10_000).consume(10_000).consume(10_000);

    // When / Then
    assert.throws(
      () =>
        new TradingDesk().buy({
          playerId: 's1',
          instrument: air(),
          quantity: 1,
          cash: 1_000_000,
          budget,
          holdings: new Holdings(),
        }),
      { code: DOMAIN_ERROR_CODES.TRADE_LIMIT },
    );
  });

  it('1건 명목금액 1,000,000원과 창구 예산 2,000,000원을 넘으면 거부한다', () => {
    // Given (AIR 12,000원 → 84주 = 1,008,000원)
    const { tradingDesk, holdings } = desk();

    // When / Then
    assert.throws(
      () =>
        tradingDesk.buy({
          playerId: 's1',
          instrument: air(),
          quantity: 84,
          cash: 10_000_000,
          budget: TradeBudget.open(),
          holdings,
        }),
      { code: DOMAIN_ERROR_CODES.TRADE_LIMIT },
      '1건 한도',
    );
    assert.throws(
      () =>
        tradingDesk.buy({
          playerId: 's1',
          instrument: air(),
          quantity: 83,
          cash: 10_000_000,
          budget: TradeBudget.open().consume(1_200_000),
          holdings,
        }),
      { code: DOMAIN_ERROR_CODES.TRADE_LIMIT },
      '창구 예산',
    );
  });

  it('종목별 보유 상한 500주를 넘기면 거부한다(매점 차단)', () => {
    // Given
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 450, price: 12_000 });

    // When / Then
    assert.throws(
      () =>
        new TradingDesk().buy({
          playerId: 's1',
          instrument: air(),
          quantity: 51,
          cash: 10_000_000,
          budget: TradeBudget.open(),
          holdings,
        }),
      { code: DOMAIN_ERROR_CODES.TRADE_LIMIT },
    );
    assert.equal(holdings.qtyOf('s1', 'AIR'), 450);
  });

  it('상장폐지 종목은 사고팔 수 없다', () => {
    // Given
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 10, price: 12_000 });

    // When / Then
    for (const call of [
      () =>
        new TradingDesk().buy({
          playerId: 's1',
          instrument: delistedAir(),
          quantity: 1,
          cash: 10_000_000,
          budget: TradeBudget.open(),
          holdings,
        }),
      () =>
        new TradingDesk().sell({
          playerId: 's1',
          instrument: delistedAir(),
          quantity: 1,
          budget: TradeBudget.open(),
          holdings,
        }),
    ]) {
      assert.throws(call, { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT });
    }
  });

  it('수량 범위를 벗어난 주문은 거부한다(도메인 2차 검증)', () => {
    // Given
    const { tradingDesk, holdings } = desk();

    // When / Then
    for (const quantity of [0, -1, 201, 1.5, Number.NaN, '10', 1e21]) {
      assert.throws(
        () =>
          tradingDesk.buy({
            playerId: 's1',
            instrument: air(),
            quantity,
            cash: 10_000_000,
            budget: TradeBudget.open(),
            holdings,
          }),
        { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
        `거부되지 않았다: ${String(quantity)}`,
      );
    }
  });

  it('예치·인출은 건수만 쓰고 잔액을 바꾼다', () => {
    // Given
    const account = new DepositAccount();
    const tradingDesk = new TradingDesk();

    // When
    const made = tradingDesk.deposit({
      playerId: 's1',
      amount: 500_000,
      cash: 1_000_000,
      budget: TradeBudget.open(),
      account,
    });
    const taken = tradingDesk.withdraw({
      playerId: 's1',
      amount: 200_000,
      budget: made.budget,
      account,
    });

    // Then
    assert.deepEqual(byReason(made.intents), { [MONEY_REASONS.DEPOSIT]: -500_000 });
    assert.deepEqual(byReason(taken.intents), { [MONEY_REASONS.DEPOSIT]: 200_000 });
    assert.equal(account.balanceOf('s1'), 300_000);
    assert.equal(taken.budget.ordersLeft, 1);
    assert.equal(taken.budget.notionalLeft, 2_000_000, '명목금액 예산은 그대로');
    assert.equal(made.events[0].type, 'DEPOSIT_MADE');
    assert.deepEqual(made.events[0].payload, { playerId: 's1', amount: 500_000, balance: 500_000 });
    assert.deepEqual(taken.events[0].payload, {
      playerId: 's1',
      amount: 200_000,
      balance: 300_000,
      viaLiquidation: false,
    });
  });

  it('현금보다 많이 예치할 수 없다', () => {
    // Given
    const account = new DepositAccount();

    // When / Then
    assert.throws(
      () =>
        new TradingDesk().deposit({
          playerId: 's1',
          amount: 500_000,
          cash: 499_999,
          budget: TradeBudget.open(),
          account,
        }),
      { code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH },
    );
    assert.equal(account.balanceOf('s1'), 0);
  });

  it('정리·파산 매각은 수수료가 면제된다', () => {
    // Given
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 40, price: 12_000 });

    // When
    const result = new TradingDesk().sellAtMarket({
      playerId: 's1',
      instrument: air(),
      quantity: 40,
      holdings,
    });

    // Then
    assert.equal(result.fee, 0);
    assert.equal(result.refund, 480_000);
    assert.deepEqual(byReason(result.intents), { [MONEY_REASONS.LIQUIDATION]: 480_000 });
    assert.equal(result.events[0].payload.viaLiquidation, true);
  });

  it('정리 매각은 창구 예산·수량 상한을 보지 않는다(강제 지불이므로)', () => {
    // Given (500주는 창구 상한 200주를 넘고 명목금액도 1,000,000원을 넘는다)
    const holdings = new Holdings();
    holdings.add({ playerId: 's1', instrumentId: 'AIR', quantity: 500, price: 12_000 });

    // When
    const result = new TradingDesk().sellAtMarket({
      playerId: 's1',
      instrument: air(),
      quantity: 500,
      holdings,
    });

    // Then
    assert.equal(result.refund, 6_000_000);
    assert.equal(holdings.qtyOf('s1', 'AIR'), 0);
  });

  it('속성: 같은 창구에서 매수 → 매도 왕복은 수량 1~200주 전수에서 언제나 손실이다', () => {
    // Given (가격은 창구 동안 고정이고 수수료는 양방향이므로 수학적으로 보장된다)
    let checked = 0;

    // When / Then
    for (const spec of LISTED_INSTRUMENTS) {
      const price = spec.basePrice;
      for (let quantity = MIN_QUANTITY; quantity <= MAX_QUANTITY; quantity += 1) {
        const notional = price * quantity;
        const buyFee = TradingDesk.fee(notional);
        const sellFee = TradingDesk.fee(notional);
        const net = -(notional + buyFee) + (notional - sellFee);

        assert.ok(net < 0, `${spec.id} ${quantity}주 왕복이 손실이 아니다: ${net}`);
        assert.equal(net, -(buyFee + sellFee), '손실은 정확히 수수료 두 번이다');
        assert.ok(buyFee >= FEE_MIN && sellFee >= FEE_MIN);
        checked += 1;
      }
    }
    assert.equal(checked, LISTED_INSTRUMENTS.length * MAX_QUANTITY);
  });
});

describe('OrderQueue(남의 턴 예약 주문)', () => {
  it('좌석당 최대 3건까지 예약할 수 있다', () => {
    // Given
    const queue = new OrderQueue();

    // When
    for (let index = 0; index < MAX_QUEUED_ORDERS_PER_SEAT; index += 1) {
      queue.place({ seatId: 's1', kind: ORDER_KINDS.BUY_STOCK, instrumentId: 'AIR', quantity: 10 });
    }

    // Then
    assert.equal(MAX_QUEUED_ORDERS_PER_SEAT, 3);
    assert.equal(queue.ofSeat('s1').length, 3);
    assert.throws(
      () =>
        queue.place({ seatId: 's1', kind: ORDER_KINDS.BUY_STOCK, instrumentId: 'AIR', quantity: 1 }),
      { code: DOMAIN_ERROR_CODES.TRADE_LIMIT },
    );
  });

  it('주문 id는 순서대로 붙고 예약 내용을 그대로 담는다', () => {
    // Given
    const queue = new OrderQueue();

    // When
    const stock = queue.place({
      seatId: 's1',
      kind: ORDER_KINDS.SELL_STOCK,
      instrumentId: 'CON',
      quantity: 20,
    });
    const cash = queue.place({ seatId: 's2', kind: ORDER_KINDS.DEPOSIT, amount: 200_000 });

    // Then
    assert.deepEqual(stock, {
      id: 'ord-1',
      seatId: 's1',
      kind: 'SELL_STOCK',
      instrumentId: 'CON',
      quantity: 20,
      amount: null,
    });
    assert.deepEqual(cash, {
      id: 'ord-2',
      seatId: 's2',
      kind: 'DEPOSIT',
      instrumentId: null,
      quantity: null,
      amount: 200_000,
    });
  });

  it('자기 좌석 주문만 취소할 수 있다', () => {
    // Given
    const queue = new OrderQueue();
    queue.place({ seatId: 's1', kind: ORDER_KINDS.DEPOSIT, amount: 10_000 });

    // When / Then
    assert.throws(() => queue.cancel({ seatId: 's2', orderId: 'ord-1' }), {
      code: DOMAIN_ERROR_CODES.FORBIDDEN,
    });
    assert.equal(queue.ofSeat('s1').length, 1, '남의 취소 시도로 상태가 바뀌지 않는다');
    assert.equal(queue.cancel({ seatId: 's1', orderId: 'ord-1' }).id, 'ord-1');
    assert.equal(queue.ofSeat('s1').length, 0);
  });

  it('없는 주문을 취소하면 거부한다', () => {
    // Given / When / Then
    assert.throws(() => new OrderQueue().cancel({ seatId: 's1', orderId: 'ord-9' }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });

  it('창구가 열릴 때 그 좌석 주문만 등록 순서로 꺼내고 큐에서 지운다', () => {
    // Given
    const queue = new OrderQueue();
    queue.place({ seatId: 's1', kind: ORDER_KINDS.DEPOSIT, amount: 10_000 });
    queue.place({ seatId: 's2', kind: ORDER_KINDS.DEPOSIT, amount: 20_000 });
    queue.place({ seatId: 's1', kind: ORDER_KINDS.WITHDRAW, amount: 30_000 });

    // When
    const taken = queue.takeFor('s1');

    // Then
    assert.deepEqual(
      taken.map((order) => order.id),
      ['ord-1', 'ord-3'],
    );
    assert.equal(queue.ofSeat('s1').length, 0);
    assert.equal(queue.ofSeat('s2').length, 1, '남의 예약은 그대로');
  });

  it('파산·탈락 좌석의 예약은 전부 지운다', () => {
    // Given
    const queue = new OrderQueue();
    queue.place({ seatId: 's1', kind: ORDER_KINDS.DEPOSIT, amount: 10_000 });
    queue.place({ seatId: 's1', kind: ORDER_KINDS.DEPOSIT, amount: 20_000 });

    // When
    const removed = queue.removeAllOf('s1');

    // Then
    assert.equal(removed.length, 2);
    assert.equal(queue.ofSeat('s1').length, 0);
  });

  it('알 수 없는 주문 종류·손상된 수량은 거부한다', () => {
    // Given
    const queue = new OrderQueue();

    // When / Then
    assert.throws(() => queue.place({ seatId: 's1', kind: 'BUY_COIN', instrumentId: 'HAN', quantity: 1 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.throws(
      () => queue.place({ seatId: 's1', kind: ORDER_KINDS.BUY_STOCK, instrumentId: 'AIR', quantity: 0 }),
      { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
    );
    assert.throws(() => queue.place({ seatId: 's1', kind: ORDER_KINDS.DEPOSIT, amount: 5_000 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });

  it('스냅샷을 왕복해도 주문과 다음 id가 유지된다', () => {
    // Given
    const queue = new OrderQueue();
    queue.place({ seatId: 's1', kind: ORDER_KINDS.DEPOSIT, amount: 10_000 });
    queue.cancel({ seatId: 's1', orderId: 'ord-1' });
    queue.place({ seatId: 's1', kind: ORDER_KINDS.DEPOSIT, amount: 20_000 });

    // When
    const restored = new OrderQueue(queue.toSnapshot());

    // Then
    assert.deepEqual(restored.toSnapshot(), queue.toSnapshot());
    assert.equal(restored.ofSeat('s1')[0].id, 'ord-2', 'id를 재사용하지 않는다');
  });
});

describe('스냅샷 키 오염 방어(프로토타입 키)', () => {
  it('Holdings는 __proto__ 좌석도 스냅샷에서 잃지 않는다', () => {
    // Given (손상·조작된 방 파일에 JSON.parse가 만든 `__proto__` 키가 들어올 수 있다.
    //        평범한 객체 리터럴에 그 키를 대입하면 **조용히 사라져** 보유 수량이 없어진다)
    const raw = JSON.parse(
      '{"__proto__":{"AIR":{"qty":3,"avgCost":100}},"s1":{"AIR":{"qty":2,"avgCost":100}}}',
    );
    const holdings = new Holdings(raw);

    // When
    const snapshot = holdings.toSnapshot();

    // Then
    assert.equal(holdings.qtyOf('__proto__', 'AIR'), 3);
    assert.deepEqual(Object.keys(snapshot).sort(), ['__proto__', 's1'], '키가 사라졌다');
    assert.deepEqual(new Holdings(snapshot).toSnapshot(), snapshot, '왕복이 깨졌다');
    assert.equal(Object.prototype.AIR, undefined, 'Object.prototype이 오염됐다');
  });

  it('DepositAccount도 __proto__ 좌석 잔액을 잃지 않는다', () => {
    // Given
    const raw = JSON.parse('{"__proto__":10000,"s1":20000}');
    const account = new DepositAccount(raw);

    // When
    const snapshot = account.toSnapshot();

    // Then
    assert.equal(account.balanceOf('__proto__'), 10_000);
    assert.deepEqual(Object.keys(snapshot).sort(), ['__proto__', 's1'], '잔액이 사라졌다');
    assert.deepEqual(new DepositAccount(snapshot).toSnapshot(), snapshot);
  });
});
