import { DomainError } from '../shared/DomainError.js';

/**
 * 은행 창구 장부. 플레이어 현금/잭팟 총합의 변화는 반드시 이 장부의 순유입과 일치해야 한다
 * (돈의 보존 불변식). 플레이어 간 이동과 잭팟 적립은 총합을 바꾸지 않으므로 기록하지 않는다.
 */
export class BankLedger {
  #fromBank;
  #toBank;

  constructor({ fromBank = 0, toBank = 0 } = {}) {
    this.#fromBank = fromBank;
    this.#toBank = toBank;
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

  receiveFromBank(amount) {
    this.#assert(amount);
    this.#fromBank += amount;
  }

  payToBank(amount) {
    this.#assert(amount);
    this.#toBank += amount;
  }

  /** 순변화가 +면 은행 유입, -면 은행 유출로 기록한다. */
  applyNet(net) {
    if (!Number.isInteger(net)) {
      throw DomainError.invalidArgument(`장부 순변화가 정수가 아닙니다: ${net}`);
    }
    if (net >= 0) {
      this.#fromBank += net;
    } else {
      this.#toBank += -net;
    }
  }

  #assert(amount) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw DomainError.invalidArgument(`장부 금액이 올바르지 않습니다: ${amount}`);
    }
  }

  toSnapshot() {
    return { fromBank: this.#fromBank, toBank: this.#toBank };
  }
}
