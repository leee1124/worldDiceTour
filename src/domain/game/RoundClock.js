import { DomainError } from '../shared/DomainError.js';
import { EVENT_TYPES, GAME_OVER_REASONS } from './events.js';

/** `advance()`의 결과 종류. */
export const TURN_OUTCOMES = Object.freeze({
  /** 다음 좌석의 턴을 시작해야 한다. */
  BEGIN_TURN: 'BEGIN_TURN',
  /** 게임이 끝났다(`reason` 참고). */
  GAME_OVER: 'GAME_OVER',
});

/**
 * 라운드 시계. 턴 차례와 라운드 번호를 쥐고, **라운드가 실제로 넘어갈 때만** 틱 훅을 돌린다.
 *
 * 순서를 이 한 곳에 고정한다(설계서 §2.3):
 *   1) 다음 생존 좌석 탐색 — 배열 인덱스가 끝을 넘으면 그것이 라운드 경계다
 *      (누가 탈락했는지와 무관하게 정확하다)
 *   2) 못 찾으면 GAME_OVER(LAST_SURVIVOR)
 *   3) 한 바퀴를 돌지 않았으면 → 턴 시작. **틱 없음**
 *      (더블 추가 턴은 `advance()`를 아예 부르지 않으므로 여기에도 오지 않는다)
 *   4) 한 바퀴를 돌았으면 → round += 1, ROUND_ADVANCED
 *   5) 라운드 제한 도달 → GAME_OVER(ROUND_LIMIT). ★ **틱을 돌리지 않는다**
 *      — 절대 플레이되지 않는 라운드의 사건으로 최종 순위가 뒤집히면 부당하다
 *   6) 틱 훅 실행(등록 순서)
 *   7) 턴 시작
 *
 * 훅은 **돈을 직접 만지지 않는다.** `{ intents, events }`만 돌려주고, 적용은 호출자(Game)가
 * `Treasury`로 한다. 그래서 시장·대출·파생·리포트가 이 시계를 구독만 하면 되고 Game은 안 바뀐다.
 *
 * @typedef {object} RoundTickHook
 * @property {string} name 진단·중복 등록 방지를 위한 이름
 * @property {(context: {round:number, players:object[]}) => ({intents?:object[], events?:object[]}|void)} run
 */
export class RoundClock {
  #round;
  #turnIndex;
  #roundLimit;
  /** @type {RoundTickHook[]} */
  #tickHooks = [];

  constructor({ round = 1, turnIndex = 0, roundLimit = null } = {}) {
    if (!Number.isInteger(round) || round < 1) {
      throw DomainError.invalidArgument(`라운드가 올바르지 않습니다: ${round}`);
    }
    if (!Number.isInteger(turnIndex) || turnIndex < 0) {
      throw DomainError.invalidArgument(`턴 인덱스가 올바르지 않습니다: ${turnIndex}`);
    }
    if (roundLimit !== null && (!Number.isInteger(roundLimit) || roundLimit < 1)) {
      throw DomainError.invalidArgument(`라운드 제한이 올바르지 않습니다: ${roundLimit}`);
    }
    this.#round = round;
    this.#turnIndex = turnIndex;
    this.#roundLimit = roundLimit;
  }

  get round() {
    return this.#round;
  }

  get turnIndex() {
    return this.#turnIndex;
  }

  get roundLimit() {
    return this.#roundLimit;
  }

  /** 등록된 틱 훅 이름(실행 순서). */
  get tickHookNames() {
    return this.#tickHooks.map((hook) => hook.name);
  }

  /**
   * 라운드 틱 훅을 등록한다. 등록 순서대로 실행된다.
   * @param {RoundTickHook} hook
   */
  registerTick(hook) {
    if (!hook || typeof hook.name !== 'string' || hook.name.length === 0) {
      throw DomainError.invalidArgument('틱 훅에는 이름이 필요합니다');
    }
    if (typeof hook.run !== 'function') {
      throw DomainError.invalidArgument(`틱 훅에 run이 없습니다: ${hook.name}`);
    }
    if (this.#tickHooks.some((registered) => registered.name === hook.name)) {
      throw DomainError.invalidState(`이미 등록된 틱 훅입니다: ${hook.name}`);
    }
    this.#tickHooks.push(hook);
    return this;
  }

  /**
   * 다음 좌석으로 차례를 넘긴다.
   * @param {{players: Array<{eliminated:boolean}>}} params
   * @returns {{outcome:string, reason:string|null, events:object[], intents:object[]}}
   */
  advance({ players }) {
    const next = this.#findNextLiving(players);
    if (!next) {
      return done(TURN_OUTCOMES.GAME_OVER, GAME_OVER_REASONS.LAST_SURVIVOR);
    }

    this.#turnIndex = next.index;
    if (!next.wrapped) {
      return done(TURN_OUTCOMES.BEGIN_TURN);
    }

    this.#round += 1;
    const events = [{ type: EVENT_TYPES.ROUND_ADVANCED, payload: { round: this.#round } }];

    if (this.#roundLimit !== null && this.#round > this.#roundLimit) {
      // 끝나는 전이에서는 틱을 돌리지 않는다 — 틱은 "이제 시작할 라운드"에 속한다.
      return done(TURN_OUTCOMES.GAME_OVER, GAME_OVER_REASONS.ROUND_LIMIT, events);
    }

    const intents = [];
    for (const hook of this.#tickHooks) {
      const result = hook.run({ round: this.#round, players }) ?? {};
      events.push(...(result.events ?? []));
      intents.push(...(result.intents ?? []));
    }
    return done(TURN_OUTCOMES.BEGIN_TURN, null, events, intents);
  }

  /**
   * 다음 생존 좌석. 배열 인덱스가 좌석 수를 넘으면(`raw >= size`) 한 바퀴를 돈 것이다 —
   * 탈락자를 몇 명 건너뛰었는지와 무관하게 정확한 라운드 경계다.
   */
  #findNextLiving(players) {
    const size = players.length;
    for (let step = 1; step <= size; step += 1) {
      const raw = this.#turnIndex + step;
      const candidate = raw % size;
      if (!players[candidate].eliminated) {
        return { index: candidate, wrapped: raw >= size };
      }
    }
    return null;
  }
}

function done(outcome, reason = null, events = [], intents = []) {
  return { outcome, reason, events, intents };
}
