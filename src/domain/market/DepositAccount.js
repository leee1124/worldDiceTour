import { DomainError } from '../shared/DomainError.js';
import { LIMIT_KINDS } from './rejectReasons.js';

/** 예치·인출 단위(설계서 §3.4). */
export const DEPOSIT_UNIT = 10_000;
/** 한 좌석의 예금 잔액 상한. */
export const DEPOSIT_CAP = 10_000_000;

/**
 * 예금 계좌(전 좌석).
 *
 * **이자는 `max(0, 예금 − 총부채)`에만 붙는다**(설계서 §3.8) — 대출을 끼고 예금에 넣어 이자만 챙기는
 * 무위험 차익(캐리 트레이드)을 막는 핵심 규칙이다. 이자 산출은 플레이어에게 유리하므로 내림이다.
 *
 * 잔액은 현금이 아니라 **은행이 보관하는 채무**이므로, 예치는 `payToBank`, 인출은 `receiveFromBank`로
 * 자연히 보존 불변식에 들어맞는다(설계서 §5.1).
 */
export class DepositAccount {
  /** @type {Map<string, number>} */
  #balances;

  constructor(raw = {}) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw DomainError.invalidArgument('예금 스냅샷이 객체가 아닙니다');
    }
    this.#balances = new Map();
    for (const [seatId, balance] of Object.entries(raw)) {
      if (!Number.isSafeInteger(balance) || balance < 0) {
        throw DomainError.invalidArgument(`예금 잔액이 올바르지 않습니다: ${seatId}=${describe(balance)}`);
      }
      if (balance % DEPOSIT_UNIT !== 0) {
        throw DomainError.invalidArgument(`예금 잔액이 단위의 배수가 아닙니다: ${seatId}=${balance}`);
      }
      if (balance > DEPOSIT_CAP) {
        throw DomainError.invalidArgument(`예금 잔액이 상한을 넘습니다: ${seatId}=${balance}`);
      }
      if (balance > 0) {
        this.#balances.set(seatId, balance);
      }
    }
  }

  balanceOf(playerId) {
    return this.#balances.get(playerId) ?? 0;
  }

  /** 예금이 있는 좌석이 하나라도 있는지. */
  get isEmpty() {
    return this.#balances.size === 0;
  }

  /** 예치. @returns {number} 새 잔액 */
  deposit({ playerId, amount }) {
    assertAmount(amount);
    const next = this.balanceOf(playerId) + amount;
    if (next > DEPOSIT_CAP) {
      throw DomainError.tradeLimit(
        `예금 한도(${DEPOSIT_CAP}원)를 넘습니다: ${next}`,
        LIMIT_KINDS.DEPOSIT_CAP,
      );
    }
    this.#balances.set(playerId, next);
    return next;
  }

  /** 인출. @returns {number} 새 잔액 */
  withdraw({ playerId, amount }) {
    assertAmount(amount);
    const current = this.balanceOf(playerId);
    if (current < amount) {
      throw DomainError.insufficientCash(`예금 잔액이 부족합니다: ${current}원 < ${amount}원`);
    }
    const next = current - amount;
    if (next === 0) {
      this.#balances.delete(playerId);
    } else {
      this.#balances.set(playerId, next);
    }
    return next;
  }

  /**
   * 라운드 틱 이자. **대출 채무를 뺀 금액에만** 붙으므로 부채가 예금보다 크면 0이다.
   * @param {{playerId:string, debt:number, baseRate:import('./BaseRate.js').BaseRate}} params
   */
  interestFor({ playerId, debt, baseRate }) {
    const taxable = Math.max(0, this.balanceOf(playerId) - Math.max(0, debt ?? 0));
    return baseRate.interestOn(taxable);
  }

  /** 정리·파산용 전액 인출. @returns {number} 인출액 */
  drain(playerId) {
    const balance = this.balanceOf(playerId);
    this.#balances.delete(playerId);
    return balance;
  }

  /**
   * 저장 형태 `{ 좌석: 잔액 }`. **프로토타입이 없는 객체로 만든다** —
   * `raw['__proto__'] = 10000`은 평범한 객체에서 조용히 사라져 잔액이 없어진다(`Holdings` 참고).
   */
  toSnapshot() {
    const raw = Object.create(null);
    for (const seatId of [...this.#balances.keys()].sort()) {
      raw[seatId] = this.#balances.get(seatId);
    }
    return raw;
  }
}

/** 예치·인출 금액: 10,000원 단위이며 10,000 ~ 10,000,000원. */
export function assertAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount < DEPOSIT_UNIT || amount > DEPOSIT_CAP) {
    throw DomainError.invalidArgument(`예금 금액이 올바르지 않습니다: ${describe(amount)}`);
  }
  if (amount % DEPOSIT_UNIT !== 0) {
    throw DomainError.invalidArgument(`예금 금액이 ${DEPOSIT_UNIT}원 단위가 아닙니다: ${amount}`);
  }
  return amount;
}

function describe(value) {
  return typeof value === 'number' ? String(value) : `<${typeof value}>`;
}
