import { EVENT_TYPES } from './events.js';
import { MONEY_REASONS, MoneyIntent } from '../shared/MoneyIntent.js';
import { SALARY } from './Player.js';

/**
 * 출발 칸 통과 1회 정산.
 *
 * 지금은 **월급 지급 + 대출 채무 압류**뿐이지만, 설계상 이 지점이
 * `월급 → 배당 → 대출 상환 압류 → 부족분 charge`가 합쳐지는 자리다. 배당·분할상환이
 * 붙을 때 Game이 아니라 여기가 늘어난다.
 *
 * 돈은 직접 옮기지 않고 `{ intents, events }`만 돌려준다(R2).
 */
export class LapIncome {
  #salary;

  constructor({ salary = SALARY } = {}) {
    this.#salary = salary;
  }

  get salary() {
    return this.#salary;
  }

  /**
   * 한 바퀴 소득을 정산한다.
   * @param {{player: import('./Player.js').Player}} params
   * @returns {{intents: object[], events: Array<{type:string, payload:object}>}}
   */
  collect({ player }) {
    const { seized, received } = player.seizeSalary(this.#salary);
    const events = [];
    const intents = [];

    if (seized > 0) {
      events.push({
        type: EVENT_TYPES.SALARY_SEIZED,
        payload: { playerId: player.id, amount: seized, remainingDebt: player.loanDebt },
      });
      if (player.loanDebt === 0) {
        events.push({ type: EVENT_TYPES.LOAN_REPAID, payload: { playerId: player.id } });
      }
    }
    if (received > 0) {
      intents.push(
        MoneyIntent.fromBank({
          playerId: player.id,
          amount: received,
          reason: MONEY_REASONS.SALARY,
        }),
      );
      events.push({
        type: EVENT_TYPES.SALARY_PAID,
        payload: { playerId: player.id, amount: received },
      });
    }
    return { intents, events };
  }
}
