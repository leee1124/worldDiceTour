import { DomainError } from '../shared/DomainError.js';

/**
 * 이력에 남기는 가격의 최대 개수.
 * 라운드 제한의 최대값(30)과 같다 — 한 판의 시세를 전부 담으면서 방 파일이 커지지 않는다
 * (5종목 × 30 = 150 정수).
 */
export const MAX_SERIES_LENGTH = 30;

/**
 * 가격 이력(Value Object). 스파크라인의 입력이며 항상 최근 `MAX_SERIES_LENGTH`개만 유지한다.
 *
 * 값을 바꾸지 않고 `append()`가 **새 VO**를 돌려준다 — 이력이 밖에서 조용히 변형되면
 * 스냅샷과 화면이 어긋나기 때문이다.
 */
export class PriceSeries {
  /** @type {number[]} */
  #values;

  /** @param {number[]} values 오래된 값 → 최신 값 순서 */
  constructor(values) {
    if (!Array.isArray(values) || values.length === 0) {
      throw DomainError.invalidArgument('가격 이력이 비어 있습니다');
    }
    for (const value of values) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw DomainError.invalidArgument(`가격 이력 값이 올바르지 않습니다: ${describe(value)}`);
      }
    }
    this.#values = values.slice(-MAX_SERIES_LENGTH);
  }

  /** 오래된 값 → 최신 값(사본). */
  get values() {
    return [...this.#values];
  }

  get length() {
    return this.#values.length;
  }

  /** 가장 최근 가격. */
  get latest() {
    return this.#values[this.#values.length - 1];
  }

  /** 직전 가격(값이 하나뿐이면 자기 자신 — 등락률 0). */
  get previous() {
    return this.#values.length >= 2 ? this.#values[this.#values.length - 2] : this.latest;
  }

  /** 가격 하나를 덧붙인 **새** 이력. */
  append(price) {
    return new PriceSeries([...this.#values, price]);
  }

  toSnapshot() {
    return [...this.#values];
  }
}

function describe(value) {
  return typeof value === 'number' ? String(value) : `<${typeof value}>`;
}
