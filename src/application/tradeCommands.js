import { COMMAND_TYPES } from '../domain/game/commands.js';

/**
 * 좌석당 레이트 리밋을 적용할 커맨드(설계서 §7 "주문 스팸(DoS)").
 *
 * **막혀도 판이 멈추지 않는 커맨드만** 넣는다. `CLOSE_TRADING`(창구 마감)과
 * `SELL_ASSET`/`AUTO_SELL`(강제 지불을 메우는 정리 매각)은 거부되면 그 좌석이 턴을 진행할 수
 * 없게 되므로 제한 대상이 아니다 — 리밋의 목적은 스팸을 막는 것이지 진행을 막는 것이 아니다.
 *
 * 예약 주문(`QUEUE_ORDER`/`CANCEL_QUEUED_ORDER`)은 **남의 턴에도 보낼 수 있어** 스팸의 표면이
 * 가장 넓으므로 반드시 포함한다.
 */
export const TRADE_COMMAND_TYPES = Object.freeze(
  new Set([
    COMMAND_TYPES.BUY_STOCK,
    COMMAND_TYPES.SELL_STOCK,
    COMMAND_TYPES.DEPOSIT,
    COMMAND_TYPES.WITHDRAW,
    COMMAND_TYPES.QUEUE_ORDER,
    COMMAND_TYPES.CANCEL_QUEUED_ORDER,
  ]),
);

/** 레이트 리밋 기본값: 좌석당 5초에 10건. */
export const TRADE_RATE_CAPACITY = 10;
export const TRADE_RATE_WINDOW_MS = 5_000;
