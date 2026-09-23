import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';

/**
 * 앞부분만 지정하고 나머지는 결정적으로 이어가는 RandomSource.
 *
 * `FakeRandomSource`는 난수 소비 순서를 **한 개도 틀리지 않게** 적어야 해서, 주사위처럼 앞쪽 몇 개만
 * 중요한 통합 테스트에서는 뒤따르는 소비(티켓 추출·시장 틱의 국면/뉴스/종목별 충격)까지 전부
 * 나열해야 한다. 그러면 테스트가 검증하려는 규칙이 아니라 난수 개수에 묶여 깨진다.
 *
 * 그래서 이 이중은 **지정한 값을 먼저 쓰고, 소진되면 시드 PRNG로 이어간다.** 같은 시드를 쓰므로
 * 결과는 여전히 완전히 결정적이다. 범위를 벗어난 지정값은 `FakeRandomSource`처럼 즉시 실패시켜,
 * "주사위에 0을 넣었다" 같은 실수를 조용히 넘기지 않는다.
 */
export class ScriptedRandomSource {
  #queue;
  #fallback;

  constructor(values = [], seed = 20_260_922) {
    this.#queue = [...values];
    this.#fallback = new SeededRandomSource(seed);
  }

  get remaining() {
    return this.#queue.length;
  }

  nextInt(min, max) {
    if (this.#queue.length === 0) {
      return this.#fallback.nextInt(min, max);
    }
    const value = this.#queue.shift();
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`ScriptedRandomSource: ${value}는 ${min}~${max} 범위의 정수가 아닙니다`);
    }
    return value;
  }
}
