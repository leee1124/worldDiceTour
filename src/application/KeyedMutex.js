/**
 * 키(방 코드)별 직렬화 잠금.
 * "불러오기 → 변경 → 저장" 유스케이스가 같은 방에 대해 겹치면 앞의 결과를 덮어쓸 수 있으므로,
 * 같은 키의 작업은 도착 순서대로 하나씩 실행한다. 다른 키는 서로 영향을 주지 않는다.
 */
export class KeyedMutex {
  /** @type {Map<string, Promise<void>>} */
  #tails = new Map();

  /**
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  async runExclusive(key, task) {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const current = previous.then(() => task());
    // 뒤 작업이 앞 작업의 실패 때문에 멈추지 않도록, 대기열에는 거부되지 않는 꼬리를 남긴다.
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(key, tail);

    try {
      return await current;
    } finally {
      if (this.#tails.get(key) === tail) {
        this.#tails.delete(key);
      }
    }
  }

  /** 대기 중인 키 개수(진단용). */
  get pendingKeys() {
    return this.#tails.size;
  }
}
