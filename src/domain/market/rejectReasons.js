/**
 * 주문 거절 사유 코드(단일 출처).
 *
 * 직접 보낸 주문은 규격 에러(`ERR001`/`ERR008`/`ERR018`)로 거절되지만, **예약 주문은 체결 시점에
 * 재검증되므로 흐름을 멈추지 않고 그 주문만 버려야 한다** — 그때 `QUEUED_ORDER_REJECTED` 이벤트에
 * 실려 화면이 "왜 체결되지 않았는지"를 설명할 수 있게 하는 값이다.
 *
 * `TradeBudget`과 `TradingDesk`가 같은 목록을 쓰므로, 별도 파일에 두어 순환 import를 피한다.
 */
export const REJECT_REASONS = Object.freeze({
  /** 창구가 닫혀 있다(예산 소진 등). */
  WINDOW_CLOSED: 'WINDOW_CLOSED',
  /** 현금이 부족하다. */
  INSUFFICIENT_CASH: 'INSUFFICIENT_CASH',
  /** 보유 수량이 부족하다. */
  NOT_ENOUGH_SHARES: 'NOT_ENOUGH_SHARES',
  /** 상장폐지된 종목이다. */
  DELISTED: 'DELISTED',
  /** 목록에 없는 종목이다. */
  UNKNOWN_INSTRUMENT: 'UNKNOWN_INSTRUMENT',
  /** 창구 주문 수(3건)를 다 썼다. */
  ORDER_LIMIT: 'ORDER_LIMIT',
  /** 명목금액 한도(1건 1,000,000원 / 창구 2,000,000원)를 넘었다. */
  NOTIONAL_LIMIT: 'NOTIONAL_LIMIT',
  /** 종목 보유 상한(500주)을 넘었다. */
  POSITION_LIMIT: 'POSITION_LIMIT',
  /** 예금 한도(10,000,000원)를 넘었다. */
  DEPOSIT_CAP: 'DEPOSIT_CAP',
  /** 예금 잔액이 부족하다. */
  INSUFFICIENT_DEPOSIT: 'INSUFFICIENT_DEPOSIT',
  /** 수량·금액 형식이 규칙에 맞지 않는다. */
  INVALID_ORDER: 'INVALID_ORDER',
});

export const ALL_REJECT_REASONS = Object.freeze(Object.values(REJECT_REASONS));
