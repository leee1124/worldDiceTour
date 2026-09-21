/**
 * 주사위. 난수는 주입된 RandomSource에서만 얻는다(서버 권위).
 */
export class Dice {
  /** @type {import('../shared/interfaces.js').RandomSource} */
  #random;

  constructor(random) {
    this.#random = random;
  }

  /** 주사위 한 개를 굴린다. */
  rollOne() {
    return this.#random.nextInt(1, 6);
  }

  /** 주사위 두 개를 굴려 눈/합/더블 여부를 돌려준다. */
  roll() {
    const die1 = this.rollOne();
    const die2 = this.rollOne();
    return { die1, die2, sum: die1 + die2, isDouble: die1 === die2 };
  }
}
