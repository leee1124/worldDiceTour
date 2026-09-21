import { DomainError } from '../shared/DomainError.js';
import { MONEY_REASONS, MoneyIntent } from '../shared/MoneyIntent.js';
import { MARKET_EVENT_TYPES } from './events.js';
import { MAX_NOTIONAL_PER_ORDER } from './TradeBudget.js';
import { MAX_POSITION_PER_INSTRUMENT } from './Holdings.js';
import { assertAmount as assertDepositAmount, DEPOSIT_CAP } from './DepositAccount.js';
import { REJECT_REASONS } from './rejectReasons.js';

export { REJECT_REASONS };

/** 거래 수수료율(bp). */
export const FEE_BP = 100;
/** 최소 수수료(원). 이 값이 있어 같은 창구 안 왕복거래는 **항상** 손실이다. */
export const FEE_MIN = 1_000;
/** 주문 1건의 수량 범위. */
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 200;

/**
 * 거래 창구(도메인 서비스). **주문이 체결되는 유일한 진입점**이다.
 *
 * 한도·수수료·현금·보유 수량을 모두 여기서 판단하고, 돈은 직접 옮기지 않고
 * `MoneyIntent` 목록만 돌려준다(규칙 R2). 그래서 `Game`은 "무엇을 검사해야 하는지" 몰라도 되고,
 * 새 상품(코인·파생)이 붙어도 이 서비스에 주문 종류 하나가 늘 뿐이다.
 *
 * **주문은 가격에 영향을 주지 않는다** — 거래소가 무한 유동성 상대방이므로 시세 조작이 불가능하다.
 */
export class TradingDesk {
  /**
   * 수수료 = `max(1,000, ceil(명목금액 × 100 / 10,000))`.
   * 플레이어에게 불리한 산출이므로 **올림**이다(설계서 §3.8 — 반올림으로 돈이 생기지 않게).
   */
  static fee(notional) {
    return Math.max(FEE_MIN, Math.ceil((notional * FEE_BP) / 10_000));
  }

  /**
   * 매수. 명목금액과 수수료를 **두 개의 intent로 분리**해 발행한다(설계서 §5.2 — 사유별 손익 분리).
   * @returns {{intents:object[], events:object[], budget:import('./TradeBudget.js').TradeBudget, notional:number, fee:number}}
   */
  buy({ playerId, instrument, quantity, cash, budget, holdings }) {
    assertTradable(instrument);
    assertQuantity(quantity);
    const price = instrument.price;
    const notional = price * quantity;
    const fee = TradingDesk.fee(notional);

    assertBudget(budget, notional);
    if (holdings.qtyOf(playerId, instrument.id) + quantity > MAX_POSITION_PER_INSTRUMENT) {
      throw DomainError.tradeLimit(
        `종목 보유 상한(${MAX_POSITION_PER_INSTRUMENT}주)을 넘습니다: ${instrument.id}`,
      );
    }
    if (cash < notional + fee) {
      throw DomainError.insufficientCash(
        `현금이 부족합니다: ${cash}원 < ${notional + fee}원(명목 ${notional} + 수수료 ${fee})`,
      );
    }

    // 검증이 모두 끝난 뒤에 상태를 바꾼다 — 거부된 주문이 보유만 늘리는 일이 없어야 한다.
    holdings.add({ playerId, instrumentId: instrument.id, quantity, price });

    return {
      notional,
      fee,
      budget: budget.consume(notional),
      intents: [
        MoneyIntent.toExchange({
          playerId,
          amount: notional,
          reason: MONEY_REASONS.TRADE_BUY,
          meta: { instrumentId: instrument.id, quantity, price },
        }),
        MoneyIntent.toExchange({
          playerId,
          amount: fee,
          reason: MONEY_REASONS.TRADE_FEE,
          meta: { instrumentId: instrument.id },
        }),
      ],
      events: [filledEvent({ playerId, kind: 'BUY', instrument, quantity, price, notional, fee })],
    };
  }

  /** 매도. */
  sell({ playerId, instrument, quantity, budget, holdings }) {
    assertTradable(instrument);
    assertQuantity(quantity);
    const price = instrument.price;
    const notional = price * quantity;
    const fee = TradingDesk.fee(notional);

    assertBudget(budget, notional);
    if (holdings.qtyOf(playerId, instrument.id) < quantity) {
      throw DomainError.insufficientCash(
        `보유 수량이 부족합니다: ${instrument.id} ${holdings.qtyOf(playerId, instrument.id)}주 < ${quantity}주`,
      );
    }

    holdings.remove({ playerId, instrumentId: instrument.id, quantity });

    return {
      notional,
      fee,
      budget: budget.consume(notional),
      intents: [
        MoneyIntent.fromExchange({
          playerId,
          amount: notional,
          reason: MONEY_REASONS.TRADE_SELL,
          meta: { instrumentId: instrument.id, quantity, price },
        }),
        MoneyIntent.toExchange({
          playerId,
          amount: fee,
          reason: MONEY_REASONS.TRADE_FEE,
          meta: { instrumentId: instrument.id },
        }),
      ],
      events: [filledEvent({ playerId, kind: 'SELL', instrument, quantity, price, notional, fee })],
    };
  }

  /**
   * 정리·파산 시장가 매도. **수수료가 면제되고 창구 예산·수량 상한을 보지 않는다** —
   * 강제 지불을 메우기 위한 매각이므로 거래 창구의 템포 규칙을 적용할 이유가 없다(설계서 §4.7).
   * 상장폐지 종목도 팔 수 있지만 환급이 0이다(휴지조각).
   */
  sellAtMarket({ playerId, instrument, quantity, holdings }) {
    const held = holdings.qtyOf(playerId, instrument.id);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > held) {
      throw DomainError.invalidArgument(`매각 수량이 올바르지 않습니다: ${describe(quantity)} (보유 ${held})`);
    }
    const refund = instrument.valueOf(quantity);
    const price = instrument.isListed() ? instrument.price : 0;
    holdings.remove({ playerId, instrumentId: instrument.id, quantity });

    return {
      refund,
      fee: 0,
      intents:
        refund > 0
          ? [
              MoneyIntent.fromExchange({
                playerId,
                amount: refund,
                reason: MONEY_REASONS.LIQUIDATION,
                meta: { instrumentId: instrument.id, quantity, price },
              }),
            ]
          : [],
      events: [
        filledEvent({
          playerId,
          kind: 'SELL',
          instrument,
          quantity,
          price,
          notional: refund,
          fee: 0,
          viaLiquidation: true,
        }),
      ],
    };
  }

  /** 예치(현금 → 예금). 건수만 쓰고 명목금액 예산은 쓰지 않는다. */
  deposit({ playerId, amount, cash, budget, account }) {
    assertDepositAmount(amount);
    assertBudget(budget, 0);
    if (account.balanceOf(playerId) + amount > DEPOSIT_CAP) {
      throw DomainError.tradeLimit(`예금 한도(${DEPOSIT_CAP}원)를 넘습니다`);
    }
    if (cash < amount) {
      throw DomainError.insufficientCash(`현금이 부족합니다: ${cash}원 < ${amount}원`);
    }
    const balance = account.deposit({ playerId, amount });

    return {
      amount,
      balance,
      budget: budget.consume(0),
      intents: [
        MoneyIntent.toBank({ playerId, amount, reason: MONEY_REASONS.DEPOSIT, meta: { balance } }),
      ],
      events: [
        {
          type: MARKET_EVENT_TYPES.DEPOSIT_MADE,
          payload: { playerId, amount, balance },
        },
      ],
    };
  }

  /** 인출(예금 → 현금). */
  withdraw({ playerId, amount, budget, account }) {
    assertDepositAmount(amount);
    assertBudget(budget, 0);
    const balance = account.withdraw({ playerId, amount });

    return {
      amount,
      balance,
      budget: budget.consume(0),
      intents: [
        MoneyIntent.fromBank({ playerId, amount, reason: MONEY_REASONS.DEPOSIT, meta: { balance } }),
      ],
      events: [
        {
          type: MARKET_EVENT_TYPES.DEPOSIT_WITHDRAWN,
          payload: { playerId, amount, balance, viaLiquidation: false },
        },
      ],
    };
  }

  /** 정리·파산 전액 인출(예산·단위 제약 없음 — 잔액은 언제나 10,000원 배수다). */
  drainDeposit({ playerId, account }) {
    const amount = account.drain(playerId);
    return {
      refund: amount,
      fee: 0,
      intents:
        amount > 0
          ? [
              MoneyIntent.fromBank({
                playerId,
                amount,
                reason: MONEY_REASONS.LIQUIDATION,
                meta: { deposit: true },
              }),
            ]
          : [],
      events:
        amount > 0
          ? [
              {
                type: MARKET_EVENT_TYPES.DEPOSIT_WITHDRAWN,
                payload: { playerId, amount, balance: 0, viaLiquidation: true },
              },
            ]
          : [],
    };
  }
}

function filledEvent({ playerId, kind, instrument, quantity, price, notional, fee, viaLiquidation = false }) {
  return {
    type: MARKET_EVENT_TYPES.ORDER_FILLED,
    payload: {
      playerId,
      kind,
      instrumentId: instrument.id,
      name: instrument.name,
      quantity,
      price,
      notional,
      fee,
      viaLiquidation,
    },
  };
}

function assertTradable(instrument) {
  if (!instrument) {
    throw DomainError.invalidArgument('종목을 찾을 수 없습니다');
  }
  if (!instrument.isListed()) {
    throw DomainError.invalidArgument(`상장폐지된 종목은 거래할 수 없습니다: ${instrument.id}`);
  }
}

function assertQuantity(quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
    throw DomainError.invalidArgument(`주문 수량이 올바르지 않습니다: ${describe(quantity)}`);
  }
  return quantity;
}

function assertBudget(budget, notional) {
  const verdict = budget.check(notional);
  if (!verdict.ok) {
    throw DomainError.tradeLimit(`창구 한도를 넘습니다: ${verdict.reasonCode}`);
  }
  if (notional > MAX_NOTIONAL_PER_ORDER) {
    throw DomainError.tradeLimit(`주문 1건 명목금액 한도를 넘습니다: ${notional}`);
  }
}

function describe(value) {
  return typeof value === 'number' ? String(value) : `<${typeof value}>`;
}
