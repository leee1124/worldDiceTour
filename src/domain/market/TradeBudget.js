import { DomainError } from '../shared/DomainError.js';
import { LIMIT_KINDS, REJECT_REASONS } from './rejectReasons.js';

/**
 * 창구 한도. **오너 결정(2026-09-23): 매매 금액·횟수 제한 없음** → 셋 다 `null`.
 * 값을 지우지 않고 `null`로 둔 이유: 나중에 "거래 시간 타이머"(로드맵 5단계)나 방 옵션으로 되살릴 수 있게
 * 예산 VO·DTO·검증 경로를 그대로 남긴다. `null`은 어디서나 "상한 없음"이다.
 * 매점(cornering) 방지는 종목당 보유 상한(Holdings.MAX_POSITION_PER_INSTRUMENT = 500주)이 맡는다.
 */
export const MAX_ORDERS_PER_WINDOW = null;
export const MAX_NOTIONAL_PER_WINDOW = null;
export const MAX_NOTIONAL_PER_ORDER = null;

const unlimited = (cap) => cap === null;

/**
 * 창구 예산(Value Object).
 *
 * 원래는 "거래로 판을 늘리기(스톨링)"를 막는 장치였다(설계서 §3.8: 창구당 3건·2,000,000원, 소진 시 자동 마감).
 * **D46부터 세 상한이 모두 `null`(상한 없음)** 이라 예산은 사용량 기록만 하고 창구는 `CLOSE_TRADING`으로만 닫힌다.
 * VO·DTO·검증 경로를 남겨 둔 것은 거래 타이머·방 옵션으로 상한을 되살릴 수 있게 하기 위해서다.
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
    if (!Number.isSafeInteger(ordersUsed) || ordersUsed < 0 || (!unlimited(MAX_ORDERS_PER_WINDOW) && ordersUsed > MAX_ORDERS_PER_WINDOW)) {
      throw DomainError.invalidArgument(`사용한 주문 수가 올바르지 않습니다: ${describe(ordersUsed)}`);
    }
    if (
      !Number.isSafeInteger(notionalUsed) ||
      notionalUsed < 0 ||
      (!unlimited(MAX_NOTIONAL_PER_WINDOW) && notionalUsed > MAX_NOTIONAL_PER_WINDOW)
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

  /** 남은 주문 수. 상한이 없으면 `null`. */
  get ordersLeft() {
    return unlimited(MAX_ORDERS_PER_WINDOW) ? null : MAX_ORDERS_PER_WINDOW - this.#ordersUsed;
  }

  /** 남은 명목금액. 상한이 없으면 `null`. */
  get notionalLeft() {
    return unlimited(MAX_NOTIONAL_PER_WINDOW) ? null : MAX_NOTIONAL_PER_WINDOW - this.#notionalUsed;
  }

  /** 더 이상 주문을 낼 수 없는지(창구 자동 마감 판단). 상한이 없으면 절대 소진되지 않는다. */
  get exhausted() {
    return this.ordersLeft !== null && this.ordersLeft <= 0;
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
    const overOrderCap = !unlimited(MAX_NOTIONAL_PER_ORDER) && notional > MAX_NOTIONAL_PER_ORDER;
    const overWindowCap = this.notionalLeft !== null && notional > this.notionalLeft;
    if (overOrderCap || overWindowCap) {
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
      unlimited: unlimited(MAX_ORDERS_PER_WINDOW) && unlimited(MAX_NOTIONAL_PER_WINDOW) && unlimited(MAX_NOTIONAL_PER_ORDER),
    };
  }

  toSnapshot() {
    return { ordersUsed: this.#ordersUsed, notionalUsed: this.#notionalUsed };
  }
}

function describe(value) {
  return typeof value === 'number' ? String(value) : `<${typeof value}>`;
}
