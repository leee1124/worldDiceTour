/**
 * 결정적 테스트용 RandomSource 구현.
 * 미리 정해둔 정수 큐를 순서대로 반환하며, 범위를 벗어나거나 큐가 비면 즉시 실패시켜
 * 테스트가 난수 소비 순서를 정확히 기술하도록 강제한다.
 */
export class FakeRandomSource {
  #queue;

  constructor(values = []) {
    this.#queue = [...values];
  }

  push(...values) {
    this.#queue.push(...values);
    return this;
  }

  get remaining() {
    return this.#queue.length;
  }

  nextInt(min, max) {
    if (this.#queue.length === 0) {
      throw new Error(`FakeRandomSource: 준비된 난수가 없습니다 (요청 범위 ${min}~${max})`);
    }
    const value = this.#queue.shift();
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`FakeRandomSource: ${value}는 ${min}~${max} 범위의 정수가 아닙니다`);
    }
    return value;
  }
}
