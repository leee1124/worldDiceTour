import { DomainError } from '../shared/DomainError.js';
import { LIMIT_KINDS } from './rejectReasons.js';

/**
 * 한 좌석이 한 종목을 가질 수 있는 최대 수량(설계서 §3.8).
 * 매점(cornering)으로 다른 플레이어가 살 수 없게 만드는 것을 막는다.
 */
export const MAX_POSITION_PER_INSTRUMENT = 500;

/**
 * 전 좌석의 보유 포지션.
 *
 * 평균 매입가는 **이동평균**으로 관리한다 — 매수하면 가중평균(내림)으로 갱신되고 매도해도 변하지 않는다.
 * 수량 검증(정수·양수·보유 초과 금지)을 스스로 하므로 음수 수량이나 없는 물량을 파는 일이 구조적으로 막힌다.
 */
export class Holdings {
  /** @type {Map<string, Map<string, {qty:number, avgCost:number}>>} 좌석 → 종목 → 포지션 */
  #bySeat;

  constructor(raw = {}) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw DomainError.invalidArgument('보유 스냅샷이 객체가 아닙니다');
    }
    this.#bySeat = new Map();
    for (const [seatId, positions] of Object.entries(raw)) {
      if (typeof positions !== 'object' || positions === null || Array.isArray(positions)) {
        throw DomainError.invalidArgument(`보유 목록이 객체가 아닙니다: ${seatId}`);
      }
      const map = new Map();
      for (const [instrumentId, position] of Object.entries(positions)) {
        if (typeof position !== 'object' || position === null) {
          throw DomainError.invalidArgument(`포지션이 객체가 아닙니다: ${seatId}/${instrumentId}`);
        }
        assertQuantity(position.qty, `보유 수량(${seatId}/${instrumentId})`);
        assertCost(position.avgCost, `평균 매입가(${seatId}/${instrumentId})`);
        if (position.qty > MAX_POSITION_PER_INSTRUMENT) {
          throw DomainError.invalidArgument(
            `보유 수량이 상한을 넘습니다: ${seatId}/${instrumentId} ${position.qty}`,
          );
        }
        map.set(instrumentId, { qty: position.qty, avgCost: position.avgCost });
      }
      if (map.size > 0) {
        this.#bySeat.set(seatId, map);
      }
    }
  }

  /** 그 좌석이 그 종목을 몇 주 가졌는지. */
  qtyOf(playerId, instrumentId) {
    return this.#bySeat.get(playerId)?.get(instrumentId)?.qty ?? 0;
  }

  /** 평균 매입가(없으면 0). */
  avgCostOf(playerId, instrumentId) {
    return this.#bySeat.get(playerId)?.get(instrumentId)?.avgCost ?? 0;
  }

  /** 보유 목록(**종목 id 사전순** — 같은 상태면 언제나 같은 순서가 나온다). */
  positionsOf(playerId) {
    const map = this.#bySeat.get(playerId);
    if (!map) {
      return [];
    }
    return [...map.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([instrumentId, position]) => ({
        instrumentId,
        qty: position.qty,
        avgCost: position.avgCost,
      }));
  }

  /** 가진 종목이 하나라도 있는지(거래 창구를 열지 판단에 쓴다). */
  hasAny(playerId) {
    return (this.#bySeat.get(playerId)?.size ?? 0) > 0;
  }

  /** 매수: 수량을 더하고 평단을 가중평균(내림)으로 갱신한다. */
  add({ playerId, instrumentId, quantity, price }) {
    assertQuantity(quantity, '매수 수량', { positive: true });
    assertCost(price, '매수 가격');
    const map = this.#bySeat.get(playerId) ?? new Map();
    const current = map.get(instrumentId) ?? { qty: 0, avgCost: 0 };
    const qty = current.qty + quantity;
    if (qty > MAX_POSITION_PER_INSTRUMENT) {
      throw DomainError.tradeLimit(
        `종목 보유 상한(${MAX_POSITION_PER_INSTRUMENT}주)을 넘습니다: ${instrumentId} ${qty}`,
        LIMIT_KINDS.POSITION,
      );
    }
    const avgCost = Math.floor((current.qty * current.avgCost + quantity * price) / qty);
    map.set(instrumentId, { qty, avgCost });
    this.#bySeat.set(playerId, map);
    return { qty, avgCost };
  }

  /** 매도: 수량을 덜고 평단은 유지한다. @returns {{qty:number, costBasis:number}} */
  remove({ playerId, instrumentId, quantity }) {
    assertQuantity(quantity, '매도 수량', { positive: true });
    const map = this.#bySeat.get(playerId);
    const current = map?.get(instrumentId);
    if (!current || current.qty < quantity) {
      throw DomainError.insufficientCash(
        `보유 수량이 부족합니다: ${instrumentId} ${current?.qty ?? 0}주 < ${quantity}주`,
      );
    }
    const costBasis = quantity * current.avgCost;
    const qty = current.qty - quantity;
    if (qty === 0) {
      map.delete(instrumentId);
      if (map.size === 0) {
        this.#bySeat.delete(playerId);
      }
    } else {
      map.set(instrumentId, { qty, avgCost: current.avgCost });
    }
    return { qty, costBasis };
  }

  /**
   * 상장폐지 소각: 그 종목을 가진 모든 좌석의 포지션을 **전액 없앤다**(현금 이동 없음).
   * @returns {Array<{playerId:string, instrumentId:string, quantity:number, costBasis:number}>}
   *   좌석 id 사전순(같은 상태면 언제나 같은 이벤트 순서)
   */
  wipeAll(instrumentId) {
    const wiped = [];
    for (const playerId of [...this.#bySeat.keys()].sort()) {
      const position = this.#bySeat.get(playerId)?.get(instrumentId);
      if (!position) {
        continue;
      }
      wiped.push({
        playerId,
        instrumentId,
        quantity: position.qty,
        costBasis: position.qty * position.avgCost,
      });
      this.remove({ playerId, instrumentId, quantity: position.qty });
    }
    return wiped;
  }

  /**
   * 저장 형태 `{ 좌석: { 종목: {qty, avgCost} } }`.
   *
   * **프로토타입이 없는 객체로 만든다.** 평범한 객체 리터럴에 `raw['__proto__'] = …`를 대입하면
   * 프로토타입 설정자가 가로채 **그 좌석의 보유가 조용히 사라진다**(= 자산이 없어진다).
   * 손상되거나 조작된 방 파일에 그런 키가 들어올 수 있으므로, 어떤 키든 그대로 실리게 한다.
   * (`JSON.stringify`는 프로토타입 없는 객체도 정상적으로 직렬화한다.)
   */
  toSnapshot() {
    const raw = Object.create(null);
    for (const playerId of [...this.#bySeat.keys()].sort()) {
      const positions = Object.create(null);
      for (const position of this.positionsOf(playerId)) {
        positions[position.instrumentId] = { qty: position.qty, avgCost: position.avgCost };
      }
      raw[playerId] = positions;
    }
    return raw;
  }
}

function assertQuantity(value, label, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) {
    throw DomainError.invalidArgument(`${label}이 올바르지 않습니다: ${describe(value)}`);
  }
  return value;
}

function assertCost(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw DomainError.invalidArgument(`${label}이 올바르지 않습니다: ${describe(value)}`);
  }
  return value;
}

function describe(value) {
  return typeof value === 'number' ? String(value) : `<${typeof value}>`;
}
