import { EVENT_TYPES } from '../game/events.js';
import { SECTORS } from './data/instruments.js';

/** 보드 사건이 섹터에 남기는 압력의 기준값(설계서 §3.3 표). */
export const NUDGE_BP = Object.freeze({
  LANDMARK_BUILT: 300,
  EXPENSIVE_PURCHASE: 100,
  JACKPOT_WON: 800,
  JACKPOT_MILESTONE: 200,
  RESORT_TOLL: 100,
  TRAVEL: 200,
  CUSTOMS: -100,
});

/** "비싼 도시"의 기준(이 가격 이상이면 건설 섹터에 압력). */
export const EXPENSIVE_CITY_PRICE = 300_000;
/** 잭팟 누적이 이 금액을 넘어서는 순간 카지노·엔터에 압력. */
export const JACKPOT_MILESTONE = 1_000_000;

/**
 * 보드 연동 압력(설계서 §3.3).
 *
 * 보드에서 벌어진 일이 어느 섹터를 밀어 올리는지 **표 하나로** 안다. `Game`은 "이번 커맨드에서
 * 이런 일이 있었다"는 이벤트 목록만 넘기고 규칙은 여기 있다(R1 — Game은 규칙을 모른다).
 *
 * 압력은 **다음 틱에** 반영되고 전원에게 공개된다. 즉시 반영하면 "내 턴에 건설주를 사놓고
 * 랜드마크를 지어 즉시 상승"이 성립해 내부정보 거래가 되므로, 미루는 것이 이 설계의 핵심이다.
 */
export class BoardNudges {
  /** @type {import('./Market.js').Market} */
  #market;
  #isResort;

  /**
   * @param {{market: import('./Market.js').Market, isResort: (index:number) => boolean}} params
   *   `isResort`는 통행료가 발생한 칸이 휴양지인지 판단한다(보드를 직접 알지 않기 위한 포트).
   */
  constructor({ market, isResort }) {
    this.#market = market;
    this.#isResort = isResort;
  }

  /**
   * 한 커맨드가 만든 이벤트를 훑어 압력을 적립한다.
   * @param {Array<{type:string}>} events
   * @param {{jackpotBefore:number, jackpotAfter:number}} context
   */
  observe(events, { jackpotBefore, jackpotAfter }) {
    for (const event of events) {
      switch (event.type) {
        case EVENT_TYPES.LANDMARK_BUILT:
          this.#market.nudge({ sector: SECTORS.CONSTRUCTION, bp: NUDGE_BP.LANDMARK_BUILT });
          break;
        case EVENT_TYPES.CITY_PURCHASED:
          if ((event.price ?? 0) >= EXPENSIVE_CITY_PRICE) {
            this.#market.nudge({ sector: SECTORS.CONSTRUCTION, bp: NUDGE_BP.EXPENSIVE_PURCHASE });
          }
          break;
        case EVENT_TYPES.CASINO_RESULT:
          if ((event.jackpotWon ?? 0) > 0) {
            this.#market.nudge({ sector: SECTORS.ENTERTAINMENT, bp: NUDGE_BP.JACKPOT_WON });
          }
          break;
        case EVENT_TYPES.TOLL_PAID:
          if (this.#isResort(event.index)) {
            this.#market.nudge({ sector: SECTORS.HOTEL, bp: NUDGE_BP.RESORT_TOLL });
          }
          break;
        case EVENT_TYPES.TRAVELED:
          this.#market.nudge({ sector: SECTORS.AIRLINE, bp: NUDGE_BP.TRAVEL });
          break;
        case EVENT_TYPES.TAX_PAID:
          this.#market.nudgeAll(NUDGE_BP.CUSTOMS);
          break;
        default:
          break;
      }
    }

    // 잭팟 누적이 기준선을 **넘어서는 순간**에만 한 번(이벤트 하나로는 알 수 없어 전후를 비교한다).
    if (jackpotBefore < JACKPOT_MILESTONE && jackpotAfter >= JACKPOT_MILESTONE) {
      this.#market.nudge({ sector: SECTORS.ENTERTAINMENT, bp: NUDGE_BP.JACKPOT_MILESTONE });
    }
  }
}
