import { randomInt } from 'node:crypto';

/**
 * 실제 게임에 쓰는 RandomSource 구현(node:crypto 기반).
 */
export class CryptoRandomSource {
  /** min~max(양쪽 포함) 범위의 정수. */
  nextInt(min, max) {
    return randomInt(min, max + 1);
  }
}
