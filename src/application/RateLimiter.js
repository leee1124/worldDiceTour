/**
 * 토큰 버킷 레이트 리미터(키별).
 *
 * `KeyedMutex`가 이미 방 단위로 커맨드를 직렬화하므로 CPU 폭주는 없다. 진짜 병목은 **커맨드마다
 * 일어나는 파일 저장**이므로, 한 좌석이 초당 수십 건을 밀어 넣어 디스크를 붙잡는 것을 막는 것이
 * 이 리미터의 목적이다(설계서 §7).
 *
 * 연속 회복(창의 절반이 지나면 절반이 돌아온다)이라 정상적인 사람의 연타에는 걸리지 않고,
 * 스크립트로 쏟아붓는 경우에만 걸린다.
 */
export class TokenBucketLimiter {
  #capacity;
  #windowMs;
  #now;
  /** @type {Map<string, {tokens:number, at:number}>} */
  #buckets = new Map();

  /**
   * @param {{capacity:number, windowMs:number, now?:() => number}} params
   *   `capacity`개를 `windowMs` 안에 쓸 수 있다. `now`는 테스트에서 시간을 고정하기 위한 포트다.
   */
  constructor({ capacity, windowMs, now = () => Date.now() }) {
    this.#capacity = capacity;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  /** 지금 들고 있는 버킷 수(메모리 누수 확인용). */
  get size() {
    return this.#buckets.size;
  }

  /**
   * 토큰 하나를 쓴다.
   * @returns {boolean} 통과했는지(false면 한도 초과)
   */
  tryConsume(key) {
    const now = this.#now();
    this.#sweep(now);

    const bucket = this.#buckets.get(key);
    if (!bucket) {
      this.#buckets.set(key, { tokens: this.#capacity - 1, at: now });
      return true;
    }

    // 지난 시간만큼 연속적으로 회복시킨다(정수로 깎지 않아 긴 공백 뒤에도 정확하다).
    const refilled = ((now - bucket.at) * this.#capacity) / this.#windowMs;
    const tokens = Math.min(this.#capacity, bucket.tokens + refilled);
    bucket.at = now;
    if (tokens < 1) {
      bucket.tokens = tokens;
      return false;
    }
    bucket.tokens = tokens - 1;
    return true;
  }

  /**
   * 오래 쓰지 않은 버킷을 버린다. 방이 많이 생기고 사라지는 서버에서 Map이 무한히 자라지 않게 한다.
   * 창을 두 번 넘긴 버킷은 어차피 가득 찬 상태와 구별되지 않으므로 지워도 동작이 같다.
   */
  #sweep(now) {
    const staleBefore = now - this.#windowMs * 2;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.at < staleBefore) {
        this.#buckets.delete(key);
      }
    }
  }
}

/** 아무것도 막지 않는 리미터(테스트·비활성 구성용). */
export class UnlimitedLimiter {
  get size() {
    return 0;
  }

  tryConsume() {
    return true;
  }
}
