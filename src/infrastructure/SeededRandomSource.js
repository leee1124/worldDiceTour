/**
 * 시드 기반 결정적 PRNG(mulberry32). E2E 재현용.
 */
export class SeededRandomSource {
  #state;

  constructor(seed = 1) {
    this.#state = seed >>> 0;
  }

  #next() {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min, max) {
    return min + Math.floor(this.#next() * (max - min + 1));
  }
}
