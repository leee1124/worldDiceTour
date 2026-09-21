import { BUILDING_TYPES } from '../domain/game/City.js';
import { CASINO_GAMES } from '../domain/game/Casino.js';
import { COMMAND_TYPES } from '../domain/game/commands.js';
import { PHASES } from '../domain/game/phases.js';
import { SPACE_KINDS } from '../domain/game/data/board.js';

/** 매입 기준: 현금이 가격의 2배 이상. */
const BUY_CASH_RATIO = 2;
/** 인수 기준: 현금이 인수 가격의 3배 이상. */
const ACQUIRE_CASH_RATIO = 3;
/** 건설 후 남겨둘 최소 현금. */
const BUILD_CASH_RESERVE = 300_000;
/** 랜드마크 기준: 현금이 건설비의 2배 이상. */
const LANDMARK_CASH_RATIO = 2;
/** 구조비를 낼지 판단하는 현금 기준. */
const ISLAND_PAY_CASH = 1_000_000;

/**
 * 컴퓨터/자동 진행 좌석의 의사결정(규칙 기반, 상태 없음).
 * 입력은 공개 게임 뷰(GameViewDto)뿐이며 도메인 엔티티에 접근하지 않는다.
 */
export class AutoPlayerPolicy {
  /**
   * @param {object} view GameViewDto
   * @returns {{type:string, payload?:object}|null}
   */
  decide(view) {
    const me = view.players.find((player) => player.seatId === view.currentSeatId);
    if (!me || view.isOver) {
      return null;
    }
    const pending = view.pending;

    switch (view.phase) {
      case PHASES.AWAIT_ROLL:
        return { type: COMMAND_TYPES.ROLL };
      case PHASES.AWAIT_BUY:
        return me.cash >= pending.price * BUY_CASH_RATIO
          ? { type: COMMAND_TYPES.BUY }
          : { type: COMMAND_TYPES.SKIP_BUY };
      case PHASES.AWAIT_BUILD:
        return this.#decideBuild(me, pending.options);
      case PHASES.AWAIT_START_BUILD:
        return this.#decideStartBuild(me, pending.candidates);
      case PHASES.AWAIT_ACQUIRE:
        return me.cash >= pending.price * ACQUIRE_CASH_RATIO
          ? { type: COMMAND_TYPES.ACQUIRE }
          : { type: COMMAND_TYPES.SKIP_ACQUIRE };
      case PHASES.AWAIT_CASINO:
        return this.#decideCasino(pending);
      case PHASES.AWAIT_ISLAND_CHOICE:
        return pending.canPayFee && me.cash >= ISLAND_PAY_CASH
          ? { type: COMMAND_TYPES.ISLAND_PAY }
          : { type: COMMAND_TYPES.ISLAND_ROLL };
      case PHASES.AWAIT_TRAVEL:
        return { type: COMMAND_TYPES.TRAVEL, payload: { destination: this.#pickDestination(view) } };
      case PHASES.AWAIT_LIQUIDATION:
        return this.#decideLiquidation(pending);
      default:
        return null;
    }
  }

  /** 현금 여유를 남기면서 가장 비싼 조합을 고른다. */
  #decideBuild(me, options) {
    const buildings = this.#chooseBuildings(me.cash, options);
    return buildings.length > 0
      ? { type: COMMAND_TYPES.BUILD, payload: { buildings } }
      : { type: COMMAND_TYPES.SKIP_BUILD };
  }

  #decideStartBuild(me, candidates) {
    const ranked = [...candidates].sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    for (const candidate of ranked) {
      const buildings = this.#chooseBuildings(me.cash, candidate.options);
      if (buildings.length > 0) {
        return {
          type: COMMAND_TYPES.START_BUILD,
          payload: { cityIndex: candidate.index, buildings },
        };
      }
    }
    return { type: COMMAND_TYPES.SKIP_START_BUILD };
  }

  /**
   * 건설 조합 선택.
   * 랜드마크는 현금이 건설비의 2배 이상일 때만, 일반 건물은 건설 후 최소 현금이 남는 범위에서
   * 비싼 것부터 담는다.
   */
  #chooseBuildings(cash, options = []) {
    const landmark = options.find((option) => option.type === BUILDING_TYPES.LANDMARK);
    if (landmark) {
      return cash >= landmark.cost * LANDMARK_CASH_RATIO ? [BUILDING_TYPES.LANDMARK] : [];
    }
    const budget = cash - BUILD_CASH_RESERVE;
    if (budget <= 0) {
      return [];
    }
    const chosen = [];
    let spent = 0;
    for (const option of [...options].sort((a, b) => b.cost - a.cost)) {
      if (spent + option.cost <= budget) {
        chosen.push(option.type);
        spent += option.cost;
      }
    }
    return chosen;
  }

  /** 카지노는 방문당 최소액으로 한 번만 건다. */
  #decideCasino(pending) {
    const firstRound = pending.roundsLeft >= 3;
    if (!firstRound || pending.limits.max < pending.limits.min) {
      return { type: COMMAND_TYPES.CASINO_LEAVE };
    }
    return {
      type: COMMAND_TYPES.CASINO_BET,
      payload: { game: CASINO_GAMES.ODD_EVEN, bet: pending.limits.min, choice: 'ODD' },
    };
  }

  /**
   * 공항: 주인 없는 도시 중 가장 비싼 칸으로 이동.
   * 금지 칸(공항 칸과 **지금 서 있는 칸**)은 절대 고르지 않는다 — 도메인이 거부하므로
   * 여기서 걸러야 자동 진행이 막히지 않는다. 빈 도시가 없으면 금지 칸이 아닌 아무 칸이나 고른다.
   */
  #pickDestination(view) {
    const forbidden = new Set(view.pending?.forbiddenIndexes ?? []);
    const best = view.board
      .filter(
        (space) =>
          (space.kind === SPACE_KINDS.CITY || space.kind === SPACE_KINDS.RESORT) &&
          !space.ownerId &&
          !forbidden.has(space.index),
      )
      .sort((a, b) => b.price - a.price)[0];
    if (best) {
      return best.index;
    }
    return view.board.find((space) => !forbidden.has(space.index))?.index ?? 0;
  }

  /** 지불 불능: 자동매각 → 대출 → 파산. */
  #decideLiquidation(pending) {
    if (pending.canSell) {
      return { type: COMMAND_TYPES.AUTO_SELL };
    }
    if (pending.canLoan) {
      return { type: COMMAND_TYPES.TAKE_LOAN };
    }
    return { type: COMMAND_TYPES.DECLARE_BANKRUPTCY };
  }
}
