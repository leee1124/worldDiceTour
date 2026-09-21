import { DomainError } from '../shared/DomainError.js';
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
 * 플레이어 현금 이동은 Game이 담당하며, 카지노는 잭팟 적립/지급만 스스로 처리한다.
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

  /** 세관/세무조사 납부액 등을 잭팟에 적립한다. */
  accumulate(amount) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw DomainError.invalidArgument(`잭팟 적립액이 올바르지 않습니다: ${amount}`);
    }
    this.#jackpot += amount;
    return amount;
  }

  /** 잭팟 적립금 전액을 지급하고 0으로 초기화한다. */
  claimJackpot() {
    const won = this.#jackpot;
    this.#jackpot = 0;
    return won;
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
   * 한 판을 진행한다. 잭팟 적립/지급은 내부에서 처리하고 결과를 돌려준다.
   * @returns {{game:string, bet:number, win:boolean, payout:number, jackpotWon:number, jackpotAccumulated:number, detail:object}}
   */
  play({ game, bet, choice }, random) {
    const outcome = this.#judge({ game, bet, choice }, random);
    let jackpotWon = 0;
    let jackpotAccumulated = 0;

    if (outcome.jackpot) {
      jackpotWon = this.claimJackpot();
    }
    if (outcome.payout === 0) {
      jackpotAccumulated = this.accumulate(Math.floor(bet / 2));
    }

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
