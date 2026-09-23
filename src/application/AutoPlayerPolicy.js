import { BUILDING_TYPES } from '../domain/game/City.js';
import { CASINO_GAMES } from '../domain/game/Casino.js';
import { COMMAND_TYPES } from '../domain/game/commands.js';
import { PHASES } from '../domain/game/phases.js';
import { SPACE_KINDS } from '../domain/game/data/board.js';
import { CYCLE_PHASES } from '../domain/market/data/cycle.js';
import { INSTRUMENT_STATES } from '../domain/market/data/instruments.js';
import { MAX_POSITION_PER_INSTRUMENT } from '../domain/market/Holdings.js';
import { DEPOSIT_CAP, DEPOSIT_UNIT } from '../domain/market/DepositAccount.js';
import { MAX_NOTIONAL_PER_ORDER } from '../domain/market/TradeBudget.js';
import { MAX_QUANTITY } from '../domain/market/TradingDesk.js';

/** 매입 기준: 현금이 가격의 2배 이상. */
const BUY_CASH_RATIO = 2;
/** 인수 기준: 현금이 인수 가격의 3배 이상. */
const ACQUIRE_CASH_RATIO = 3;
/** 건설 후 남겨둘 최소 현금. */
const BUILD_CASH_RESERVE = 300_000;
/** 관광명소 기준: 현금이 건설비의 2배 이상. */
const LANDMARK_CASH_RATIO = 2;
/** 구조비를 낼지 판단하는 현금 기준. */
const ISLAND_PAY_CASH = 1_000_000;

// ── 증권거래소(설계서 §4.6). 전부 결정적이며 추가 난수를 쓰지 않는다 ──────────

/** 거래 뒤에도 남겨 둘 현금. 이 아래로는 아무것도 하지 않는다. */
export const AUTO_CASH_BUFFER = 1_000_000;
/**
 * 이 금리 이상일 때만 예금에 넣는다(그 아래면 주식·현금이 낫다).
 *
 * 설계서 §4.6은 250bp였는데, 그 값은 **기준금리가 100bp에서 시작한다는 전제**의 2.5배였다.
 * 오너 결정으로 시작 금리가 50bp로 낮아졌으므로 같은 배수를 유지해 125bp로 맞춘다.
 * (250bp를 그대로 두면 자동 좌석이 한 판 내내 예금을 쓰지 않아 예금 경로가 죽는다.)
 */
export const AUTO_DEPOSIT_RATE_BP = 125;
/** 예치 금액을 내림할 단위. */
export const AUTO_DEPOSIT_UNIT = 100_000;
/** 한 번에 주식에 넣을 목표 금액. */
export const AUTO_STOCK_BUDGET = 600_000;
/** 매수하는 국면. */
const BUYING_PHASES = Object.freeze([CYCLE_PHASES.RECOVERY, CYCLE_PHASES.EXPANSION]);
/** 매도하는 국면. */
const SELLING_PHASES = Object.freeze([CYCLE_PHASES.RECESSION, CYCLE_PHASES.OVERHEAT]);

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
      case PHASES.AWAIT_TRADE:
        return this.#decideTrade(view, me);
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


  /**
   * 거래 창구(설계서 §4.6). 판단 순서가 곧 우선순위다:
   * ① 현금 버퍼 아래 → 아무것도 안 함 ② 예금(금리·부채 조건) ③ 주식(국면 조건) ④ 마감.
   *
   * **어떤 경우에도 반드시 결정을 돌려준다**(`CLOSE_TRADING`이 최후의 답이다) — 결정을 못 내리면
   * 자동 진행이 그 자리에서 멈춘다.
   */
  #decideTrade(view, me) {
    const pending = view.pending ?? {};
    const market = view.market;
    const budget = pending.budget ?? market?.budget;
    const close = { type: COMMAND_TYPES.CLOSE_TRADING };

    if (!market || !budget || budget.ordersLeft <= 0) {
      return close;
    }
    const deposit = pending.deposit ?? 0;
    // 버퍼 아래면 손을 대지 않는다. 단 예금이 있으면 먼저 찾아 현금을 회복한다.
    if (me.cash < AUTO_CASH_BUFFER) {
      return deposit > 0 ? withdrawAll(deposit) : close;
    }

    const spare = me.cash - AUTO_CASH_BUFFER;
    const depositDecision = this.#decideDeposit({ me, market, deposit, spare });
    if (depositDecision) {
      return depositDecision;
    }
    return this.#decideStock({ market, budget, pending, spare }) ?? close;
  }

  /**
   * 예금: 부채가 없고 금리가 높으면 여유현금을 넣고, 아니면 전액 찾는다.
   * 부채가 있으면 이자가 0이므로(설계서 §3.8) 예치할 이유가 없다.
   */
  #decideDeposit({ me, market, deposit, spare }) {
    const attractive = (me.loanDebt ?? 0) === 0 && market.baseRateBp >= AUTO_DEPOSIT_RATE_BP;
    if (!attractive) {
      return deposit > 0 ? withdrawAll(deposit) : null;
    }
    const unit = market.rules?.depositUnit ?? DEPOSIT_UNIT;
    const room = (market.rules?.depositCap ?? DEPOSIT_CAP) - deposit;
    const amount = Math.min(floorTo(spare, AUTO_DEPOSIT_UNIT), floorTo(room, unit));
    if (amount < unit) {
      return null;
    }
    return { type: COMMAND_TYPES.DEPOSIT, payload: { amount } };
  }

  /**
   * 주식: 국면으로 방향을 정한다.
   * - 회복·호황 → 기준가 대비 가장 싼 상장 종목을 산다(동률은 id 사전순 → 결정적)
   * - 과열·침체 → 평가액이 가장 큰 보유 종목의 절반을 판다
   *
   * 수량은 창구 한도(200주·1건 명목금액·남은 예산·보유 상한) 안으로 자른다 — 서버가 거부하면
   * 자동 진행이 멈추므로, 정책이 스스로 규칙 안에 머물러야 한다.
   */
  #decideStock({ market, budget, pending, spare }) {
    const rules = market.rules ?? {};
    const phase = market.cycle?.phase;

    if (SELLING_PHASES.includes(phase)) {
      const holdings = pending.holdings ?? market.holdings?.[budget.seatId] ?? [];
      const biggest = [...holdings]
        .filter((position) => this.#isListed(market, position.instrumentId))
        .sort(
          (a, b) =>
            (b.marketValue ?? 0) - (a.marketValue ?? 0) ||
            (a.instrumentId < b.instrumentId ? -1 : 1),
        )[0];
      if (!biggest) {
        return null;
      }
      const price = this.#priceOf(market, biggest.instrumentId);
      const quantity = this.#capQuantity(Math.floor(biggest.qty / 2), { price, budget, rules });
      return quantity > 0
        ? {
            type: COMMAND_TYPES.SELL_STOCK,
            payload: { instrumentId: biggest.instrumentId, quantity },
          }
        : null;
    }

    if (!BUYING_PHASES.includes(phase) || spare < AUTO_STOCK_BUDGET) {
      return null;
    }
    const cheapest = [...(market.instruments ?? [])]
      .filter(
        (instrument) => instrument.state === INSTRUMENT_STATES.LISTED && instrument.basePrice > 0,
      )
      .sort(
        (a, b) =>
          a.price * b.basePrice - b.price * a.basePrice || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0];
    if (!cheapest) {
      return null;
    }
    const held = (market.holdings?.[budget.seatId] ?? []).find(
      (position) => position.instrumentId === cheapest.id,
    );
    const positionRoom = (rules.maxPositionPerInstrument ?? MAX_POSITION_PER_INSTRUMENT) - (held?.qty ?? 0);
    const wanted = Math.min(
      Math.floor(AUTO_STOCK_BUDGET / cheapest.price),
      Math.floor(spare / cheapest.price),
      positionRoom,
    );
    const quantity = this.#capQuantity(wanted, { price: cheapest.price, budget, rules });
    return quantity > 0
      ? { type: COMMAND_TYPES.BUY_STOCK, payload: { instrumentId: cheapest.id, quantity } }
      : null;
  }

  /** 수량을 창구 규칙 안으로 자른다. */
  #capQuantity(wanted, { price, budget, rules }) {
    if (!Number.isFinite(price) || price <= 0) {
      return 0;
    }
    const perOrder = Math.floor((rules.maxNotionalPerOrder ?? MAX_NOTIONAL_PER_ORDER) / price);
    const perWindow = Math.floor(budget.notionalLeft / price);
    return Math.max(0, Math.min(wanted, rules.maxQuantity ?? MAX_QUANTITY, perOrder, perWindow));
  }

  #priceOf(market, instrumentId) {
    return (market.instruments ?? []).find((instrument) => instrument.id === instrumentId)?.price ?? 0;
  }

  #isListed(market, instrumentId) {
    return (
      (market.instruments ?? []).find((instrument) => instrument.id === instrumentId)?.state ===
      INSTRUMENT_STATES.LISTED
    );
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
   * 관광명소는 현금이 건설비의 2배 이상일 때만, 일반 건물은 건설 후 최소 현금이 남는 범위에서
   * 비싼 것부터 담는다. 바퀴가 모자라 잠긴 선택지는 절대 고르지 않는다(서버가 거부한다).
   */
  #chooseBuildings(cash, allOptions = []) {
    const options = allOptions.filter((option) => !option.locked);
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

/** 예금 전액 인출(잔액은 언제나 10,000원 배수다). */
function withdrawAll(deposit) {
  return { type: COMMAND_TYPES.WITHDRAW, payload: { amount: deposit } };
}

/** 단위로 내림. */
function floorTo(value, unit) {
  return Math.floor(Math.max(0, value) / unit) * unit;
}
