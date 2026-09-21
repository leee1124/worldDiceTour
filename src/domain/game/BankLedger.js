import { DomainError } from '../shared/DomainError.js';
import { assertAmount, assertSignedAmount } from '../shared/Money.js';
import { MONEY_REASONS } from '../shared/MoneyIntent.js';

const REASON_LIST = Object.freeze(Object.values(MONEY_REASONS));

/**
 * 은행 창구 장부. 플레이어 현금/잭팟 총합의 변화는 반드시 이 장부의 순유입과 일치해야 한다
 * (돈의 보존 불변식). 플레이어 간 이동과 잭팟 적립은 총합을 바꾸지 않으므로 기록하지 않는다.
 *
 * **사유별 내역(`breakdown`)**: 모든 기록은 사유 태그를 함께 받아 사유별 순액을 쌓는다.
 * 그래서 불변식이 2단으로 강해진다 — ① 총현금 + 잭팟 = 초기총액 + 순유입, ②
 * 순유입 = 사유별 순액의 합. ②가 깨지면 **어떤 흐름이 장부를 우회했는지** 바로 특정된다.
 */
export class BankLedger {
  #fromBank;
  #toBank;
  /** @type {Map<string, number>} 사유 → 순액(+면 은행에서 나간 돈) */
  #byReason;

  constructor({ fromBank = 0, toBank = 0, byReason = {} } = {}) {
    this.#fromBank = assertAmount(fromBank, '장부 fromBank');
    this.#toBank = assertAmount(toBank, '장부 toBank');
    this.#byReason = new Map();
    for (const [reason, net] of Object.entries(byReason ?? {})) {
      if (!REASON_LIST.includes(reason)) {
        throw DomainError.invalidArgument(`알 수 없는 장부 사유입니다: ${reason}`);
      }
      assertSignedAmount(net, `장부 사유(${reason}) 순액`);
      if (net !== 0) {
        this.#byReason.set(reason, net);
      }
    }
  }

  get fromBank() {
    return this.#fromBank;
  }

  get toBank() {
    return this.#toBank;
  }

  /** 은행 → 플레이어 순유입. */
  get netFromBank() {
    return this.#fromBank - this.#toBank;
  }

  /** 사유별 순액(+면 은행에서 나간 돈). */
  get breakdown() {
    return Object.fromEntries(this.#byReason);
  }

  /** 사유별로 설명된 순액의 합. */
  get attributedNet() {
    let sum = 0;
    for (const net of this.#byReason.values()) {
      sum += net;
    }
    return sum;
  }

  /**
   * 사유로 설명되지 않는 순액.
   * 지금 코드로 만들어진 장부에서는 **항상 0**이다. 0이 아닌 경우는 사유별 내역이 없던
   * schemaVersion 1 파일에서 복원한 방뿐이다(과거 순유입은 사유를 되살릴 수 없다).
   */
  get unattributedNet() {
    return this.netFromBank - this.attributedNet;
  }

  receiveFromBank(amount, reason) {
    this.#assert(amount);
    this.#record(reason, amount);
    this.#fromBank += amount;
  }

  payToBank(amount, reason) {
    this.#assert(amount);
    this.#record(reason, -amount);
    this.#toBank += amount;
  }

  /** 순변화가 +면 은행 유입, -면 은행 유출로 기록한다. */
  applyNet(net, reason) {
    if (!Number.isInteger(net)) {
      throw DomainError.invalidArgument(`장부 순변화가 정수가 아닙니다: ${net}`);
    }
    assertSignedAmount(net, '장부 순변화');
    this.#record(reason, net);
    if (net >= 0) {
      this.#fromBank += net;
    } else {
      this.#toBank += -net;
    }
  }

  #record(reason, net) {
    if (!REASON_LIST.includes(reason)) {
      throw DomainError.invalidArgument(`장부 기록에 사유가 필요합니다: ${String(reason)}`);
    }
    if (net === 0) {
      return;
    }
    const next = (this.#byReason.get(reason) ?? 0) + net;
    assertSignedAmount(next, `장부 사유(${reason}) 순액`);
    if (next === 0) {
      this.#byReason.delete(reason);
      return;
    }
    this.#byReason.set(reason, next);
  }

  #assert(amount) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw DomainError.invalidArgument(`장부 금액이 올바르지 않습니다: ${amount}`);
    }
    assertAmount(amount, '장부 금액');
  }

  toSnapshot() {
    return { fromBank: this.#fromBank, toBank: this.#toBank, byReason: this.breakdown };
  }
}
