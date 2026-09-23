import { DomainError } from '../shared/DomainError.js';
import { LIMIT_KINDS, REJECT_REASONS } from './rejectReasons.js';

/** 한 창구에서 낼 수 있는 주문 수(예치·인출도 1건으로 센다). */
export const MAX_ORDERS_PER_WINDOW = 3;
/** 한 창구의 총 명목금액 한도. */
export const MAX_NOTIONAL_PER_WINDOW = 2_000_000;
/** 주문 1건의 명목금액 한도. */
export const MAX_NOTIONAL_PER_ORDER = 1_000_000;

/**
 * 창구 예산(Value Object).
 *
 * "거래로 판을 늘리기(스톨링)"를 막는 장치다(설계서 §3.8): 한 창구에서 3건, 총 2,000,000원까지만
 * 거래할 수 있고 **건수를 다 쓰면 창구가 자동으로 닫힌다**.
 *
 * **예치·인출은 건수만 쓰고 명목금액 예산은 쓰지 않는다.** 예금 한도가 10,000,000원이라
 * 명목금액 예산에 넣으면 규칙끼리 모순되기 때문이다(2,000,000원 넘게 예치할 방법이 없어진다).
 *
 * 값을 바꾸지 않고 `consume()`이 새 VO를 돌려주므로, 거부된 주문이 예산을 절반만 깎는 일이 없다.
 */
export class TradeBudget {
  #ordersUsed;
  #notionalUsed;

  constructor({ ordersUsed = 0, notionalUsed = 0 } = {}) {
    if (!Number.isSafeInteger(ordersUsed) || ordersUsed < 0 || ordersUsed > MAX_ORDERS_PER_WINDOW) {
      throw DomainError.invalidArgument(`사용한 주문 수가 올바르지 않습니다: ${describe(ordersUsed)}`);
    }
    if (
      !Number.isSafeInteger(notionalUsed) ||
      notionalUsed < 0 ||
      notionalUsed > MAX_NOTIONAL_PER_WINDOW
    ) {
      throw DomainError.invalidArgument(`사용한 명목금액이 올바르지 않습니다: ${describe(notionalUsed)}`);
    }
    this.#ordersUsed = ordersUsed;
    this.#notionalUsed = notionalUsed;
  }

  /** 새 창구(예산 가득). */
  static open() {
    return new TradeBudget();
  }

  get ordersUsed() {
    return this.#ordersUsed;
  }

  get notionalUsed() {
    return this.#notionalUsed;
  }

  get ordersLeft() {
    return MAX_ORDERS_PER_WINDOW - this.#ordersUsed;
  }

  get notionalLeft() {
    return MAX_NOTIONAL_PER_WINDOW - this.#notionalUsed;
  }

  /** 더 이상 주문을 낼 수 없는지(창구 자동 마감 판단). */
  get exhausted() {
    return this.ordersLeft <= 0;
  }

  /**
   * 이 명목금액의 주문이 예산에 들어가는지. **예외를 던지지 않고 사유 코드로 답한다** —
   * 예약 주문 재검증은 실패해도 흐름을 멈추지 않고 그 주문만 버려야 하기 때문이다.
   * @returns {{ok:boolean, reasonCode:string|null}}
   */
  check(notional) {
    if (this.exhausted) {
      return { ok: false, reasonCode: REJECT_REASONS.ORDER_LIMIT };
    }
    if (notional > MAX_NOTIONAL_PER_ORDER || notional > this.notionalLeft) {
      return { ok: false, reasonCode: REJECT_REASONS.NOTIONAL_LIMIT };
    }
    return { ok: true, reasonCode: null };
  }

  /** 예산을 쓴 **새** VO. 한도를 넘으면 거부한다. */
  consume(notional) {
    const verdict = this.check(notional);
    if (!verdict.ok) {
      throw DomainError.tradeLimit(
        `창구 예산을 넘습니다: ${verdict.reasonCode} (명목 ${notional})`,
        verdict.reasonCode,
      );
    }
    return new TradeBudget({
      ordersUsed: this.#ordersUsed + 1,
      notionalUsed: this.#notionalUsed + notional,
    });
  }

  /** 공개 DTO. `open`은 그 좌석이 지금 창구에 있는지. */
  viewModel({ seatId = null, open = false } = {}) {
    return {
      seatId,
      open,
      ordersUsed: this.#ordersUsed,
      ordersLeft: this.ordersLeft,
      ordersMax: MAX_ORDERS_PER_WINDOW,
      notionalUsed: this.#notionalUsed,
      notionalLeft: this.notionalLeft,
      notionalMax: MAX_NOTIONAL_PER_WINDOW,
    };
  }

  toSnapshot() {
    return { ordersUsed: this.#ordersUsed, notionalUsed: this.#notionalUsed };
  }
}

function describe(value) {
  return typeof value === 'number' ? String(value) : `<${typeof value}>`;
}
