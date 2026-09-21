import { EVENT_TYPES } from './events.js';
import { MONEY_REASONS, MoneyIntent } from '../shared/MoneyIntent.js';
import { SALARY } from './Player.js';

/**
 * 출발 칸 통과 1회 정산 = **한 바퀴 완주**.
 *
 * 앞으로 이동하며 출발 칸을 지나거나 정확히 도착한 순간에만 호출된다(뒤로 밀려온 경우·조난
 * 이송은 해당하지 않는다 — 판단은 `Board.advance()`의 `passedStart`가 한다). 그러므로
 * **바퀴 증가도 여기에 있다**: 한 바퀴를 마쳤다는 사실과 그 대가로 받는 소득은 같은 사건이다.
 *
 * 지금은 **바퀴 증가 + 월급 지급 + 대출 채무 압류**뿐이지만, 설계상 이 지점이
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
    const events = [];
    const intents = [];

    // 바퀴 증가를 **월급보다 먼저** 알린다. 지을 수 있는 건물이 늘어나는 사건이므로 화면이
    // 월급 연출보다 먼저 반영해야 하고, 월급이 대출 상환에 전액 압류돼도 바퀴는 오른다.
    events.push({
      type: EVENT_TYPES.LAP_ADVANCED,
      payload: { playerId: player.id, lap: player.advanceLap() },
    });

    const { seized, received } = player.seizeSalary(this.#salary);
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
