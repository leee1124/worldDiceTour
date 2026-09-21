import { DomainError } from '../shared/DomainError.js';
import { assertAmount as assertDepositAmount } from './DepositAccount.js';
import { MAX_QUANTITY, MIN_QUANTITY } from './TradingDesk.js';

/** 한 좌석이 걸어 둘 수 있는 예약 주문 수(설계서 §3.4). */
export const MAX_QUEUED_ORDERS_PER_SEAT = 3;

/** 예약할 수 있는 주문 종류. 새 상품이 붙으면 여기에 한 줄이 늘어난다. */
export const ORDER_KINDS = Object.freeze({
  BUY_STOCK: 'BUY_STOCK',
  SELL_STOCK: 'SELL_STOCK',
  DEPOSIT: 'DEPOSIT',
  WITHDRAW: 'WITHDRAW',
});

const STOCK_KINDS = Object.freeze([ORDER_KINDS.BUY_STOCK, ORDER_KINDS.SELL_STOCK]);
const CASH_KINDS = Object.freeze([ORDER_KINDS.DEPOSIT, ORDER_KINDS.WITHDRAW]);

/** 주문 id 형식(컨트롤러 검증과 같은 모양). */
export const ORDER_ID_PATTERN = /^ord-\d{1,4}$/;

/**
 * 예약 주문 큐(남의 턴에 걸어 두는 주문).
 *
 * 남의 턴에도 할 일이 있게 만드는 템포 장치이면서, **게임 상태를 바꾸지 않는다** — 큐만 바뀌므로
 * 다른 좌석의 진행에 영향이 없다. 자기 창구가 열릴 때 등록 순서대로 자동 체결되며,
 * 그 시점에 현금·한도·상장 여부를 **전면 재검증**한다(설계서 §3.8 — 예약으로 창구 규칙을 우회하지 못하게).
 *
 * id는 재사용하지 않는다(취소된 번호가 다시 나오면 화면의 낙관적 갱신이 어긋난다).
 */
export class OrderQueue {
  /** @type {Array<{id:string, seatId:string, kind:string, instrumentId:string|null, quantity:number|null, amount:number|null}>} */
  #orders;
  #sequence;

  constructor({ orders = [], sequence = null } = {}) {
    if (!Array.isArray(orders)) {
      throw DomainError.invalidArgument('예약 주문 목록이 배열이 아닙니다');
    }
    this.#orders = orders.map((raw) => normalize(raw));
    const highest = this.#orders.reduce((max, order) => Math.max(max, sequenceOf(order.id)), 0);
    if (sequence !== null && (!Number.isSafeInteger(sequence) || sequence < 0)) {
      throw DomainError.invalidArgument(`예약 주문 시퀀스가 올바르지 않습니다: ${describe(sequence)}`);
    }
    this.#sequence = Math.max(sequence ?? 0, highest);
  }

  get size() {
    return this.#orders.length;
  }

  /** 그 좌석의 예약(등록 순서, 사본). */
  ofSeat(seatId) {
    return this.#orders.filter((order) => order.seatId === seatId).map((order) => ({ ...order }));
  }

  /** 전체 예약(등록 순서, 사본) — 전원 공개 DTO. */
  viewModel() {
    return this.#orders.map((order) => ({ ...order }));
  }

  /** 예약을 건다. */
  place({ seatId, kind, instrumentId = null, quantity = null, amount = null }) {
    if (typeof seatId !== 'string' || seatId.length === 0) {
      throw DomainError.invalidArgument(`좌석 식별자가 올바르지 않습니다: ${describe(seatId)}`);
    }
    if (this.ofSeat(seatId).length >= MAX_QUEUED_ORDERS_PER_SEAT) {
      throw DomainError.tradeLimit(
        `예약 주문은 좌석당 ${MAX_QUEUED_ORDERS_PER_SEAT}건까지입니다: ${seatId}`,
      );
    }
    this.#sequence += 1;
    const order = normalize({
      id: `ord-${this.#sequence}`,
      seatId,
      kind,
      instrumentId,
      quantity,
      amount,
    });
    this.#orders.push(order);
    return { ...order };
  }

  /** 예약을 취소한다. **자기 좌석 것만** 취소할 수 있다. */
  cancel({ seatId, orderId }) {
    const at = this.#orders.findIndex((order) => order.id === orderId);
    if (at < 0) {
      throw DomainError.invalidArgument(`예약 주문을 찾을 수 없습니다: ${describe(orderId)}`);
    }
    if (this.#orders[at].seatId !== seatId) {
      throw DomainError.forbidden(`남의 예약 주문은 취소할 수 없습니다: ${orderId}`);
    }
    const [removed] = this.#orders.splice(at, 1);
    return { ...removed };
  }

  /** 창구가 열릴 때: 그 좌석 예약을 등록 순서로 꺼내고 큐에서 지운다. */
  takeFor(seatId) {
    const taken = this.ofSeat(seatId);
    this.#orders = this.#orders.filter((order) => order.seatId !== seatId);
    return taken;
  }

  /** 파산·탈락 좌석의 예약을 전부 지운다(설계서 §4.7 1단계). */
  removeAllOf(seatId) {
    return this.takeFor(seatId);
  }

  toSnapshot() {
    return { orders: this.#orders.map((order) => ({ ...order })), sequence: this.#sequence };
  }
}

/** 예약 한 건의 모양과 값을 검증해 정규화한다(손상 스냅샷·악성 입력 방어). */
function normalize(raw) {
  if (typeof raw !== 'object' || raw === null) {
    throw DomainError.invalidArgument('예약 주문이 객체가 아닙니다');
  }
  const { id, seatId, kind } = raw;
  if (typeof id !== 'string' || !ORDER_ID_PATTERN.test(id)) {
    throw DomainError.invalidArgument(`예약 주문 id가 올바르지 않습니다: ${describe(id)}`);
  }
  if (typeof seatId !== 'string' || seatId.length === 0) {
    throw DomainError.invalidArgument(`예약 주문 좌석이 올바르지 않습니다: ${describe(seatId)}`);
  }
  if (!Object.values(ORDER_KINDS).includes(kind)) {
    throw DomainError.invalidArgument(`알 수 없는 예약 주문 종류입니다: ${describe(kind)}`);
  }
  if (STOCK_KINDS.includes(kind)) {
    if (typeof raw.instrumentId !== 'string' || raw.instrumentId.length === 0) {
      throw DomainError.invalidArgument(`예약 주문 종목이 올바르지 않습니다: ${describe(raw.instrumentId)}`);
    }
    if (
      !Number.isSafeInteger(raw.quantity) ||
      raw.quantity < MIN_QUANTITY ||
      raw.quantity > MAX_QUANTITY
    ) {
      throw DomainError.invalidArgument(`예약 주문 수량이 올바르지 않습니다: ${describe(raw.quantity)}`);
    }
    return {
      id,
      seatId,
      kind,
      instrumentId: raw.instrumentId,
      quantity: raw.quantity,
      amount: null,
    };
  }
  if (CASH_KINDS.includes(kind)) {
    assertDepositAmount(raw.amount);
    return { id, seatId, kind, instrumentId: null, quantity: null, amount: raw.amount };
  }
  throw DomainError.invalidArgument(`처리할 수 없는 예약 주문 종류입니다: ${describe(kind)}`);
}

function sequenceOf(id) {
  return Number(id.slice('ord-'.length));
}

function describe(value) {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : `<${typeof value}>`;
}
