import { DomainError } from '../shared/DomainError.js';
import { assertAmount } from '../shared/Money.js';
import { MONEY_REASONS, MoneyIntent } from '../shared/MoneyIntent.js';
import { Dice } from './Dice.js';

export const CASINO_GAMES = Object.freeze({
  ODD_EVEN: 'ODD_EVEN',
  HIGH_LOW_SEVEN: 'HIGH_LOW_SEVEN',
  SLOT: 'SLOT',
});

export const ODD_EVEN_CHOICES = Object.freeze(['ODD', 'EVEN']);
export const HIGH_LOW_SEVEN_CHOICES = Object.freeze(['LOW', 'HIGH', 'SEVEN']);

/** 슬롯 심볼 6종(균등 확률). 마지막 심볼이 잭팟 심볼. */
export const SLOT_SYMBOLS = Object.freeze(['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣']);

const BET_UNIT = 10_000;
const MIN_BET = 10_000;
const MAX_BET = 500_000;
const MAX_ROUNDS_PER_VISIT = 3;

/**
 * 카지노. 잭팟 적립금을 보유하고 3종 게임의 승패/배당을 판정한다.
 *
 * `play()`는 **판정만 하는 순수 함수**다 — 현금도 잭팟도 건드리지 않고 "이렇게 움직여야 한다"는
 * 결과(`payout`/`jackpotWon`/`jackpotAccumulated`)만 돌려준다. 실제 이동은 `Treasury`가
 * 돈 이동 의사(MoneyIntent)로 적용한다. 그래서 잭팟을 포함한 모든 돈의 이동 경로가 한 곳으로 모인다.
 */
export class Casino {
  #jackpot;

  constructor({ jackpot = 0 } = {}) {
    this.#jackpot = jackpot;
  }

  static get MAX_ROUNDS_PER_VISIT() {
    return MAX_ROUNDS_PER_VISIT;
  }

  get jackpot() {
    return this.#jackpot;
  }

  /**
   * 잭팟에 적립한다. **`Treasury`만 호출한다**(돈 이동의 단일 경로).
   * 세관 납부액·진 베팅액의 절반 등이 여기로 쌓인다.
   */
  accumulate(amount) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw DomainError.invalidArgument(`잭팟 적립액이 올바르지 않습니다: ${amount}`);
    }
    assertAmount(amount, '잭팟 적립액');
    // 적립액만이 아니라 **누적 결과**도 상한 안이어야 한다. 손상된 스냅샷이 반복 적립으로
    // 안전 정수 경계까지 자라는 것을 그 자리에서 멈춘다.
    assertAmount(this.#jackpot + amount, '잭팟 적립금');
    this.#jackpot += amount;
    return amount;
  }

  /** 잭팟에서 지급한다. **`Treasury`만 호출한다.** */
  payOut(amount) {
    assertAmount(amount, '잭팟 지급액');
    if (amount > this.#jackpot) {
      throw DomainError.invalidState(
        `잭팟 적립금 ${this.#jackpot}원보다 많이 지급할 수 없습니다: ${amount}`,
      );
    }
    this.#jackpot -= amount;
    return amount;
  }

  /**
   * 적립금의 `share`%(내림)를 지급하는 **돈 이동 의사**를 만든다.
   *
   * `play()`와 같은 순수 계산이다 — 적립금을 건드리지 않고 "얼마를 어디서 옮겨야 하는지"만
   * 알려준다. 실제 이동은 `Treasury.apply()`가 한다. 지분과 나머지의 합은 항상 현재 적립금과
   * 정확히 같으므로(내림에서 흘린 원은 적립금에 남는다) 총합이 보존된다.
   * 적립금이 0원이면 옮길 돈이 없어 의사도 만들지 않는다(빈 지급 의사를 만들지 않는다).
   *
   * @param {{playerId:string, share:number, reason:string, meta?:object}} params `share`는 1~100 정수
   * @returns {{amount:number, remaining:number, intents:import('../shared/MoneyIntent.js').MoneyIntent[]}}
   */
  claimShare({ playerId, share, reason, meta = null }) {
    if (!Number.isInteger(share) || share < 1 || share > 100) {
      throw DomainError.invalidArgument(`잭팟 수령 지분이 올바르지 않습니다: ${String(share)}`);
    }
    const amount = Math.floor((this.#jackpot * share) / 100);
    return {
      amount,
      remaining: this.#jackpot - amount,
      intents:
        amount > 0 ? [MoneyIntent.fromJackpot({ playerId, amount, reason, meta })] : [],
    };
  }

  /** 보유 현금 기준 베팅 한도. */
  betLimits(cash) {
    const max = Math.min(cash, MAX_BET);
    return { min: MIN_BET, max: max < MIN_BET ? 0 : Math.floor(max / BET_UNIT) * BET_UNIT, unit: BET_UNIT };
  }

  canBet(cash) {
    return this.betLimits(cash).max >= MIN_BET;
  }

  assertValidBet(bet, cash) {
    if (!Number.isInteger(bet) || bet < MIN_BET) {
      throw DomainError.invalidArgument(`최소 베팅액은 ${MIN_BET}원입니다: ${bet}`);
    }
    if (bet % BET_UNIT !== 0) {
      throw DomainError.invalidArgument(`베팅액은 ${BET_UNIT}원 단위여야 합니다: ${bet}`);
    }
    if (bet > MAX_BET) {
      throw DomainError.invalidArgument(`최대 베팅액은 ${MAX_BET}원입니다: ${bet}`);
    }
    if (bet > cash) {
      throw DomainError.insufficientCash(`베팅액 ${bet}원이 보유 현금 ${cash}원을 초과합니다`);
    }
  }

  /**
   * 한 판을 판정한다. **상태를 바꾸지 않는다** — 돈을 어떻게 움직여야 하는지만 알려준다.
   *
   * - `payout`: 플레이어가 받을 총액(잭팟 당첨금 포함, 베팅액 반환 포함)
   * - `jackpotWon`: 그중 잭팟에서 나오는 금액(나머지는 은행에서 나온다)
   * - `jackpotAccumulated`: 진 베팅액의 절반(내림). 잭팟으로 쌓일 금액
   *
   * @returns {{game:string, bet:number, win:boolean, payout:number, jackpotWon:number, jackpotAccumulated:number, detail:object}}
   */
  play({ game, bet, choice }, random) {
    const outcome = this.#judge({ game, bet, choice }, random);
    // 잭팟 당첨은 항상 배당이 있는 판(슬롯 7️⃣ 3개)이므로 적립과 동시에 일어나지 않는다.
    const jackpotWon = outcome.jackpot ? this.#jackpot : 0;
    const jackpotAccumulated = outcome.payout === 0 ? Math.floor(bet / 2) : 0;

    return {
      game,
      bet,
      win: outcome.payout > 0,
      payout: outcome.payout + jackpotWon,
      jackpotWon,
      jackpotAccumulated,
      detail: outcome.detail,
    };
  }

  /**
   * 한 판의 돈 이동 의사.
   *
   * 진 베팅액의 절반(내림)은 잭팟으로, 나머지는 은행으로 간다. 배당은 은행에서 나오고
   * 잭팟 당첨금만 잭팟에서 나온다 — 그래서 총합(현금 + 잭팟)의 변화가 장부 순유입과 정확히 맞는다.
   * 잭팟 당첨은 항상 배당이 있는 판이므로 적립과 지급이 같은 판에 함께 일어나지 않는다.
   *
   * @param {{playerId:string, bet:number, result:object}} params `result`는 `play()`의 반환값
   * @returns {import('../shared/MoneyIntent.js').MoneyIntent[]}
   */
  moneyIntentsFor({ playerId, bet, result }) {
    const reason = MONEY_REASONS.CASINO;
    const meta = { game: result.game };
    const amounts = [
      [result.jackpotAccumulated, MoneyIntent.toJackpot],
      [bet - result.jackpotAccumulated, MoneyIntent.toBank],
      [result.payout - result.jackpotWon, MoneyIntent.fromBank],
      [result.jackpotWon, MoneyIntent.fromJackpot],
    ];
    return amounts
      .filter(([amount]) => amount > 0)
      .map(([amount, make]) => make({ playerId, amount, reason, meta }));
  }

  #judge({ game, bet, choice }, random) {
    switch (game) {
      case CASINO_GAMES.ODD_EVEN:
        return this.#judgeOddEven(bet, choice, random);
      case CASINO_GAMES.HIGH_LOW_SEVEN:
        return this.#judgeHighLowSeven(bet, choice, random);
      case CASINO_GAMES.SLOT:
        return this.#judgeSlot(bet, random);
      default:
        throw DomainError.invalidArgument(`알 수 없는 카지노 게임입니다: ${game}`);
    }
  }

  #judgeOddEven(bet, choice, random) {
    if (!ODD_EVEN_CHOICES.includes(choice)) {
      throw DomainError.invalidArgument(`홀짝 선택값이 올바르지 않습니다: ${choice}`);
    }
    const die = new Dice(random).rollOne();
    const outcome = die % 2 === 1 ? 'ODD' : 'EVEN';
    return {
      payout: outcome === choice ? bet * 2 : 0,
      detail: { die, outcome, choice },
    };
  }

  #judgeHighLowSeven(bet, choice, random) {
    if (!HIGH_LOW_SEVEN_CHOICES.includes(choice)) {
      throw DomainError.invalidArgument(`하이로우세븐 선택값이 올바르지 않습니다: ${choice}`);
    }
    const { die1, die2, sum } = new Dice(random).roll();
    const outcome = sum === 7 ? 'SEVEN' : sum < 7 ? 'LOW' : 'HIGH';
    const multiplier = outcome !== choice ? 0 : outcome === 'SEVEN' ? 5 : 2;
    return {
      payout: bet * multiplier,
      detail: { die1, die2, sum, outcome, choice },
    };
  }

  #judgeSlot(bet, random) {
    const reels = [0, 1, 2].map(() => random.nextInt(0, SLOT_SYMBOLS.length - 1));
    const symbols = reels.map((index) => SLOT_SYMBOLS[index]);
    const allSame = reels[0] === reels[1] && reels[1] === reels[2];
    const matched = allSame ? 3 : new Set(reels).size === 2 ? 2 : 1;
    const isJackpotSymbol = allSame && reels[0] === SLOT_SYMBOLS.length - 1;

    let payout = 0;
    if (matched === 3) {
      payout = bet * 10;
    } else if (matched === 2) {
      payout = Math.floor(bet * 1.5);
    }

    return {
      payout,
      jackpot: isJackpotSymbol,
      detail: { symbols, matched, jackpotSymbol: isJackpotSymbol },
    };
  }
}
