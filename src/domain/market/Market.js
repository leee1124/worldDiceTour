import { DomainError } from '../shared/DomainError.js';
import { MONEY_REASONS, MoneyIntent } from '../shared/MoneyIntent.js';
import { BaseRate, BASE_RATE_MAX_BP, BASE_RATE_MIN_BP, INITIAL_BASE_RATE_BP } from './BaseRate.js';
import { BusinessCycle } from './BusinessCycle.js';
import {
  assertAmount as assertDepositAmount,
  DepositAccount,
  DEPOSIT_CAP,
  DEPOSIT_UNIT,
} from './DepositAccount.js';
import { Holdings, MAX_POSITION_PER_INSTRUMENT } from './Holdings.js';
import { Instrument } from './Instrument.js';
import { DepositAssets, StockAssets } from './MarketAssets.js';
import { NewsDeck } from './NewsDeck.js';
import { MAX_QUEUED_ORDERS_PER_SEAT, ORDER_KINDS, OrderQueue } from './OrderQueue.js';
import { MAX_SERIES_LENGTH } from './PriceSeries.js';
import { PriceProcess } from './PriceProcess.js';
import {
  MAX_NOTIONAL_PER_ORDER,
  MAX_NOTIONAL_PER_WINDOW,
  MAX_ORDERS_PER_WINDOW,
  TradeBudget,
} from './TradeBudget.js';
import { FEE_BP, FEE_MIN, MAX_QUANTITY, MIN_QUANTITY, TradingDesk } from './TradingDesk.js';
import { MARKET_EVENT_TYPES } from './events.js';
import { ALL_REJECT_REASONS, REJECT_REASONS } from './rejectReasons.js';
import {
  ALL_SECTORS,
  LISTED_INSTRUMENTS,
  RESERVE_INSTRUMENTS,
  SECTOR_LABELS,
  instrumentSpecById,
} from './data/instruments.js';
import { NEWS_EFFECT_TARGETS, newsCardById } from './data/news.js';

/** 투자 모드 `STOCKS`가 다루는 상품 수(항상 유지된다). */
const LISTING_SIZE = LISTED_INSTRUMENTS.length;

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 시장 루트(Game Aggregate 안의 자식 루트).
 *
 * **모든 메서드는 순수하다** — 돈을 직접 옮기지 않고 `{ intents, events }`만 돌려준다(규칙 R2).
 * 실제 이동은 `Treasury.apply()` 한 곳에서만 일어나므로 돈의 보존 불변식이 구조적으로 지켜진다.
 *
 * `Game`은 이 루트에 위임만 하고 가격·한도·수수료 규칙을 모른다(규칙 R1).
 */
export class Market {
  /** @type {Instrument[]} */
  #instruments;
  /** @type {BusinessCycle} */
  #cycle;
  /** @type {NewsDeck} */
  #newsDeck;
  /** @type {BaseRate} */
  #baseRate;
  /** @type {{id:string, round:number}|null} */
  #latestNews;
  /** @type {Map<string, number>} 섹터 → 다음 틱에 반영할 누적 압력(bp) */
  #nudges;
  /** @type {Holdings} */
  #holdings;
  /** @type {DepositAccount} */
  #deposits;
  /** @type {OrderQueue} */
  #orderQueue;
  /** @type {string[]} 아직 쓰지 않은 예비 상장 id */
  #reserve;
  /** @type {{seatId:string, budget:TradeBudget}|null} 지금 열린 거래 창구 */
  #window;
  /** @type {TradingDesk} */
  #desk = new TradingDesk();
  /** @type {StockAssets} */
  #stockAssets;
  /** @type {DepositAssets} */
  #depositAssets;

  constructor({
    instruments,
    cycle,
    newsDeck,
    baseRate,
    latestNews = null,
    nudges = new Map(),
    holdings,
    deposits,
    orderQueue,
    reserve,
    window = null,
  }) {
    this.#instruments = instruments;
    this.#cycle = cycle;
    this.#newsDeck = newsDeck;
    this.#baseRate = baseRate;
    this.#latestNews = latestNews;
    this.#nudges = nudges;
    this.#holdings = holdings;
    this.#deposits = deposits;
    this.#orderQueue = orderQueue;
    this.#reserve = reserve;
    this.#window = window;
    this.#stockAssets = new StockAssets({ market: this });
    this.#depositAssets = new DepositAssets({ market: this });
  }

  /** 새 판의 시장. */
  static create() {
    return new Market({
      instruments: LISTED_INSTRUMENTS.map((spec) => Instrument.fromSpec(spec)),
      cycle: new BusinessCycle(),
      newsDeck: new NewsDeck(),
      baseRate: new BaseRate(INITIAL_BASE_RATE_BP),
      holdings: new Holdings(),
      deposits: new DepositAccount(),
      orderQueue: new OrderQueue(),
      reserve: RESERVE_INSTRUMENTS.map((spec) => spec.id),
    });
  }

  /** 스냅샷에서 복원한다. */
  static restore(raw) {
    if (!raw || typeof raw !== 'object') {
      throw DomainError.invalidArgument('시장 스냅샷이 객체가 아닙니다');
    }
    const instruments = (raw.instruments ?? []).map((entry) => Instrument.restore(entry));
    if (instruments.length === 0) {
      throw DomainError.invalidArgument('시장 스냅샷에 상품이 없습니다');
    }
    const nudges = new Map();
    for (const [sector, bp] of Object.entries(raw.nudges ?? {})) {
      if (!ALL_SECTORS.includes(sector)) {
        throw DomainError.invalidArgument(`알 수 없는 섹터 압력입니다: ${sector}`);
      }
      if (!Number.isSafeInteger(bp)) {
        throw DomainError.invalidArgument(`섹터 압력이 정수가 아닙니다: ${sector}`);
      }
      if (bp !== 0) {
        nudges.set(sector, PriceProcess.nudgeBp(bp));
      }
    }
    return new Market({
      instruments,
      cycle: new BusinessCycle(raw.cycle ?? {}),
      newsDeck: new NewsDeck(raw.newsDeck ?? {}),
      baseRate: new BaseRate(raw.baseRateBp ?? INITIAL_BASE_RATE_BP),
      latestNews: restoreLatestNews(raw.latestNews),
      nudges,
      holdings: new Holdings(raw.holdings ?? {}),
      deposits: new DepositAccount(raw.deposits ?? {}),
      orderQueue: new OrderQueue(raw.orderQueue ?? {}),
      reserve: restoreReserve(raw.reserve),
      window: restoreWindow(raw.window),
    });
  }

  // ── 조회 ────────────────────────────────────────────────────────────────

  get instrumentIds() {
    return this.#instruments.map((instrument) => instrument.id);
  }

  /** 종목 하나(없으면 null). */
  instrumentOf(instrumentId) {
    return this.#instruments.find((instrument) => instrument.id === instrumentId) ?? null;
  }

  get baseRateBp() {
    return this.#baseRate.bp;
  }

  get cyclePhase() {
    return this.#cycle.phase;
  }

  /** 지금 창구가 열린 좌석(없으면 null). */
  get openSeatId() {
    return this.#window?.seatId ?? null;
  }

  /** 열린 창구의 예산이 소진됐는지(창구 자동 마감 판단). */
  get windowExhausted() {
    return Boolean(this.#window?.budget.exhausted);
  }

  holdingsOf(playerId) {
    return this.#holdings.positionsOf(playerId);
  }

  depositOf(playerId) {
    return this.#deposits.balanceOf(playerId);
  }

  /** 보유 주식의 시가 평가액(상장폐지는 0). */
  stockValueOf(playerId) {
    return this.#holdings
      .positionsOf(playerId)
      .reduce((sum, position) => sum + (this.instrumentOf(position.instrumentId)?.valueOf(position.qty) ?? 0), 0);
  }

  /** 그 좌석의 창구 예산(열려 있지 않으면 새 창구 기준). */
  budgetOf(playerId) {
    return this.#window?.seatId === playerId ? this.#window.budget : TradeBudget.open();
  }

  /**
   * 거래할 것이 하나라도 있는지(창구를 열지 판단).
   * 현금 0 · 보유 0 · 예금 0이면 창구를 열지 않는다(설계서 §4.1 — 빈 결정을 만들지 않는다).
   */
  hasTradableAssets({ playerId, cash }) {
    return cash > 0 || this.#holdings.hasAny(playerId) || this.#deposits.balanceOf(playerId) > 0;
  }

  /** `AssetRegistry`에 등록할 자산군 제공자(주식 → 예금 순). */
  assetProviders() {
    return [this.#stockAssets, this.#depositAssets];
  }

  // ── 거래 창구 ───────────────────────────────────────────────────────────

  /** 창구를 연다(그 턴에 한 번). */
  openWindow(seatId) {
    this.#window = { seatId, budget: TradeBudget.open() };
  }

  /** 창구를 닫는다. */
  closeWindow() {
    this.#window = null;
  }

  /** 매수. */
  buy({ playerId, instrumentId, quantity, cash }) {
    this.#assertWindow(playerId);
    const result = this.#desk.buy({
      playerId,
      instrument: this.#requireInstrument(instrumentId),
      quantity,
      cash,
      budget: this.#window.budget,
      holdings: this.#holdings,
    });
    this.#window.budget = result.budget;
    return { intents: result.intents, events: result.events };
  }

  /** 매도. `cash`는 수수료 지불 능력 확인에 쓴다(명목금액이 최소 수수료보다 작을 수 있다). */
  sell({ playerId, instrumentId, quantity, cash = 0 }) {
    this.#assertWindow(playerId);
    const result = this.#desk.sell({
      playerId,
      instrument: this.#requireInstrument(instrumentId),
      quantity,
      cash,
      budget: this.#window.budget,
      holdings: this.#holdings,
    });
    this.#window.budget = result.budget;
    return { intents: result.intents, events: result.events };
  }

  /** 예치. */
  deposit({ playerId, amount, cash }) {
    this.#assertWindow(playerId);
    const result = this.#desk.deposit({
      playerId,
      amount,
      cash,
      budget: this.#window.budget,
      account: this.#deposits,
    });
    this.#window.budget = result.budget;
    return { intents: result.intents, events: result.events };
  }

  /** 인출. */
  withdraw({ playerId, amount }) {
    this.#assertWindow(playerId);
    const result = this.#desk.withdraw({
      playerId,
      amount,
      budget: this.#window.budget,
      account: this.#deposits,
    });
    this.#window.budget = result.budget;
    return { intents: result.intents, events: result.events };
  }

  // ── 예약 주문 ───────────────────────────────────────────────────────────

  /** 예약을 건다(모든 페이즈, 자기 좌석). 종목 존재 여부는 등록 시점에도 확인한다. */
  queueOrder({ seatId, kind, instrumentId = null, quantity = null, amount = null }) {
    if (kind === ORDER_KINDS.BUY_STOCK || kind === ORDER_KINDS.SELL_STOCK) {
      this.#requireInstrument(instrumentId);
    }
    const order = this.#orderQueue.place({ seatId, kind, instrumentId, quantity, amount });
    return {
      intents: [],
      events: [
        {
          type: MARKET_EVENT_TYPES.QUEUED_ORDER_PLACED,
          payload: {
            playerId: seatId,
            orderId: order.id,
            kind: order.kind,
            instrumentId: order.instrumentId,
            quantity: order.quantity,
            amount: order.amount,
          },
        },
      ],
    };
  }

  /** 예약을 취소한다(자기 것만). */
  cancelQueuedOrder({ seatId, orderId }) {
    const order = this.#orderQueue.cancel({ seatId, orderId });
    return {
      intents: [],
      events: [
        {
          type: MARKET_EVENT_TYPES.QUEUED_ORDER_CANCELLED,
          payload: { playerId: seatId, orderId: order.id },
        },
      ],
    };
  }

  /**
   * 창구가 열릴 때 예약 주문을 등록 순서로 체결한다.
   *
   * **전면 재검증**한다(현금·한도·상장·예산). 하나가 실패해도 흐름을 멈추지 않고 그 주문만
   * 사유와 함께 버린다 — 예약으로 창구 규칙을 우회하지 못하게 하면서도, 남의 턴에 걸어 둔 주문
   * 하나가 자기 턴을 망가뜨리지 않게 한다.
   *
   * `cash`는 체결이 진행되며 줄어들므로 내부에서 추적한다(Treasury 적용은 나중에 한 번에).
   */
  runQueuedOrders({ playerId, cash }) {
    this.#assertWindow(playerId);
    const intents = [];
    const events = [];
    let available = cash;

    for (const order of this.#orderQueue.takeFor(playerId)) {
      const attempt = this.#executeQueued({ order, playerId, cash: available });
      if (!attempt.ok) {
        events.push({
          type: MARKET_EVENT_TYPES.QUEUED_ORDER_REJECTED,
          payload: {
            playerId,
            orderId: order.id,
            kind: order.kind,
            reasonCode: attempt.reasonCode,
          },
        });
        continue;
      }
      events.push({
        type: MARKET_EVENT_TYPES.QUEUED_ORDER_EXECUTED,
        payload: { playerId, orderId: order.id, kind: order.kind },
      });
      events.push(...attempt.events);
      intents.push(...attempt.intents);
      available += attempt.cashDelta;
    }
    return { intents, events };
  }

  // ── 라운드 틱 ───────────────────────────────────────────────────────────

  /**
   * 라운드 틱(설계서 §2.3의 6-a). 순서를 이 한 곳에 고정한다:
   * 국면 전이 → 뉴스 1장 → 기준금리 → 전 종목 시세 → 상장폐지/소각 → 신규 상장 → 예금 이자.
   *
   * 난수 소비 순서도 고정이다: (국면 전이 판정) → 뉴스 추출 → 종목 순서대로 충격.
   */
  roundTick({ round, random, players = [] }) {
    const events = [];
    const intents = [];

    // 1) 국면
    const transition = this.#cycle.advance(random);
    if (transition.changed) {
      events.push({
        type: MARKET_EVENT_TYPES.CYCLE_CHANGED,
        payload: { from: transition.from, to: transition.to, round },
      });
    }

    // 2) 뉴스
    const card = this.#newsDeck.draw(this.#cycle.phase, random);
    this.#latestNews = { id: card.id, round };
    events.push({
      type: MARKET_EVENT_TYPES.NEWS_PUBLISHED,
      payload: {
        id: card.id,
        headline: card.headline,
        explanation: card.explanation,
        effects: card.effects.map((effect) => ({ ...effect })),
        round,
        cyclePhase: this.#cycle.phase,
      },
    });

    // 3) 기준금리(뉴스만이 움직인다)
    const rateBp = sumEffects(card, NEWS_EFFECT_TARGETS.RATE);
    if (rateBp !== 0) {
      const from = this.#baseRate.bp;
      this.#baseRate = this.#baseRate.shift(rateBp);
      if (this.#baseRate.bp !== from) {
        events.push({
          type: MARKET_EVENT_TYPES.BASE_RATE_CHANGED,
          payload: { from, to: this.#baseRate.bp, changeBp: this.#baseRate.bp - from },
        });
      }
    }

    // 4) 시세
    const changes = [];
    const delisted = [];
    for (const instrument of this.#instruments) {
      if (!instrument.isListed()) {
        continue;
      }
      const result = instrument.tick({
        driftBp: this.#cycle.driftBp,
        newsBp: newsBpFor(card, instrument.sector),
        nudgeBp: PriceProcess.nudgeBp(this.#nudges.get(instrument.sector) ?? 0),
        volMulPct: this.#cycle.volMulPct,
        random,
      });
      changes.push({
        instrumentId: instrument.id,
        from: result.from,
        to: result.to,
        changeBp: result.changeBp,
        tickBp: result.tickBp,
        // 뉴스 "+10%"가 확정 수익이 아님을 화면이 보여 줄 수 있게, 변화의 재료를 함께 싣는다(가산 계약).
        breakdown: result.breakdown,
        state: instrument.state,
      });
      if (result.delisted) {
        delisted.push(instrument);
      }
    }
    // 압력은 반영된 뒤 비운다 — 다음 라운드로 새지 않는다.
    this.#nudges.clear();
    events.push({ type: MARKET_EVENT_TYPES.PRICES_UPDATED, payload: { round, changes } });

    // 5) 상장폐지와 보유 소각(현금 이동 없음)
    for (const instrument of delisted) {
      events.push({
        type: MARKET_EVENT_TYPES.INSTRUMENT_DELISTED,
        payload: { instrumentId: instrument.id, name: instrument.name, price: instrument.price },
      });
      for (const wiped of this.#holdings.wipeAll(instrument.id)) {
        events.push({ type: MARKET_EVENT_TYPES.HOLDINGS_WIPED, payload: wiped });
      }
      this.#dropQueuedOrdersOf(instrument.id, events);
    }

    // 6) 신규 상장(지난 틱에 폐지된 종목을 대체 — 목록은 항상 5종목)
    events.push(...this.#relistIfNeeded(delisted));

    // 7) 예금 이자
    for (const player of players) {
      if (player.eliminated) {
        continue;
      }
      const amount = this.#deposits.interestFor({
        playerId: player.id,
        debt: player.loanDebt ?? 0,
        baseRate: this.#baseRate,
      });
      if (amount <= 0) {
        continue;
      }
      intents.push(
        MoneyIntent.fromBank({
          playerId: player.id,
          amount,
          reason: MONEY_REASONS.DEPOSIT_INTEREST,
        }),
      );
      events.push({
        type: MARKET_EVENT_TYPES.DEPOSIT_INTEREST_PAID,
        payload: {
          playerId: player.id,
          amount,
          balance: this.#deposits.balanceOf(player.id),
          baseRateBp: this.#baseRate.bp,
        },
      });
    }

    return { intents, events };
  }

  /**
   * 보드에서 벌어진 일이 섹터에 남기는 압력. **다음 틱에** 반영되고 전원에게 공개된다
   * (즉시 반영하면 "내 턴에 건설주를 사고 랜드마크를 지어 즉시 상승"이 성립해 내부정보 거래가 된다).
   */
  nudge({ sector, bp }) {
    if (!ALL_SECTORS.includes(sector)) {
      throw DomainError.invalidArgument(`알 수 없는 섹터입니다: ${String(sector)}`);
    }
    if (!Number.isSafeInteger(bp)) {
      throw DomainError.invalidArgument(`섹터 압력이 올바르지 않습니다: ${String(bp)}`);
    }
    const next = PriceProcess.nudgeBp((this.#nudges.get(sector) ?? 0) + bp);
    if (next === 0) {
      this.#nudges.delete(sector);
      return;
    }
    this.#nudges.set(sector, next);
  }

  /** 전 섹터에 같은 압력(뉴스의 ALL과 같은 모양의 보드 사건용). */
  nudgeAll(bp) {
    for (const sector of ALL_SECTORS) {
      this.nudge({ sector, bp });
    }
  }

  // ── 배당 ────────────────────────────────────────────────────────────────

  /** 출발 칸 통과 시 배당(상장 종목만, 1주 배당 내림). `LapIncome`이 부른다. */
  dividendsFor(playerId) {
    const intents = [];
    const events = [];
    for (const position of this.#holdings.positionsOf(playerId)) {
      const instrument = this.instrumentOf(position.instrumentId);
      const perShare = instrument?.dividendPerShare() ?? 0;
      if (perShare <= 0) {
        continue;
      }
      const amount = perShare * position.qty;
      intents.push(
        MoneyIntent.fromBank({
          playerId,
          amount,
          reason: MONEY_REASONS.DIVIDEND,
          meta: { instrumentId: instrument.id, quantity: position.qty, perShare },
        }),
      );
      events.push({
        type: MARKET_EVENT_TYPES.DIVIDEND_PAID,
        payload: {
          playerId,
          instrumentId: instrument.id,
          name: instrument.name,
          quantity: position.qty,
          perShare,
          amount,
        },
      });
    }
    return { intents, events };
  }

  // ── 정리·파산(자산군 제공자가 부른다) ───────────────────────────────────

  /** 시장가 일부/전량 매도(수수료 면제). */
  liquidateStock({ playerId, instrumentId, quantity }) {
    const instrument = this.#requireInstrument(instrumentId);
    return this.#desk.sellAtMarket({ playerId, instrument, quantity, holdings: this.#holdings });
  }

  /**
   * 예금 일부 인출(정리용). 10,000원 단위여야 한다.
   *
   * 거래 창구의 `withdraw`를 쓰지 않고 계좌를 직접 줄인다. 창구 경로를 재사용하면 그쪽이 만든
   * `DEPOSIT` intent를 **버리고** 여기서 `LIQUIDATION` intent를 다시 만들어야 하는데,
   * 나중에 누군가 두 intent를 모두 넘기면 플레이어가 같은 금액을 두 번 받는다. 그 함정을 없앤다.
   */
  liquidateDeposit({ playerId, amount }) {
    assertDepositAmount(amount);
    const balance = this.#deposits.withdraw({ playerId, amount });
    return {
      refund: amount,
      fee: 0,
      intents: [
        MoneyIntent.fromBank({
          playerId,
          amount,
          reason: MONEY_REASONS.LIQUIDATION,
          meta: { deposit: true },
        }),
      ],
      events: [
        {
          type: MARKET_EVENT_TYPES.DEPOSIT_WITHDRAWN,
          payload: { playerId, amount, balance, viaLiquidation: true },
        },
      ],
    };
  }

  /** 파산: 전 종목 시장가 매도(수수료 면제) + 예약 주문 취소. */
  releaseStocksOf(playerId) {
    const intents = [];
    const events = [];
    for (const order of this.#orderQueue.removeAllOf(playerId)) {
      events.push({
        type: MARKET_EVENT_TYPES.QUEUED_ORDER_CANCELLED,
        payload: { playerId, orderId: order.id },
      });
    }
    for (const position of this.#holdings.positionsOf(playerId)) {
      const result = this.liquidateStock({
        playerId,
        instrumentId: position.instrumentId,
        quantity: position.qty,
      });
      intents.push(...result.intents);
      events.push(...result.events);
    }
    return { intents, events };
  }

  /** 파산: 예금 전액 인출. */
  releaseDepositOf(playerId) {
    return this.#desk.drainDeposit({ playerId, account: this.#deposits });
  }

  // ── 공개 DTO ────────────────────────────────────────────────────────────

  /**
   * 화면이 그대로 쓰는 공개 스냅샷. **비밀 정보를 만들지 않는다** — 전원의 보유·예금·예약과
   * 다음 틱에 반영될 압력까지 모두 담는다(설계서 §7).
   */
  viewModel({ seatIds = [], actingSeatId = null } = {}) {
    const holdings = {};
    const deposits = {};
    for (const seatId of seatIds) {
      holdings[seatId] = this.#holdings.positionsOf(seatId).map((position) => ({
        ...position,
        marketValue: this.instrumentOf(position.instrumentId)?.valueOf(position.qty) ?? 0,
      }));
      deposits[seatId] = this.#deposits.balanceOf(seatId);
    }

    return {
      investmentMode: 'STOCKS',
      cycle: this.#cycle.viewModel(),
      baseRateBp: this.#baseRate.bp,
      news: this.#newsView(),
      pendingNudges: ALL_SECTORS.filter((sector) => this.#nudges.has(sector)).map((sector) => ({
        sector,
        bp: this.#nudges.get(sector),
        label: SECTOR_LABELS[sector],
      })),
      instruments: this.#instruments.map((instrument) => instrument.viewModel()),
      holdings,
      deposits,
      orderQueue: this.#orderQueue.viewModel(),
      budget: this.budgetOf(actingSeatId).viewModel({
        seatId: actingSeatId,
        open: actingSeatId !== null && this.openSeatId === actingSeatId,
      }),
      rules: MARKET_RULES,
    };
  }

  toSnapshot() {
    const nudges = {};
    for (const sector of ALL_SECTORS) {
      if (this.#nudges.has(sector)) {
        nudges[sector] = this.#nudges.get(sector);
      }
    }
    return {
      cycle: this.#cycle.toSnapshot(),
      baseRateBp: this.#baseRate.bp,
      newsDeck: this.#newsDeck.toSnapshot(),
      latestNews: this.#latestNews ? { ...this.#latestNews } : null,
      nudges,
      instruments: this.#instruments.map((instrument) => instrument.toSnapshot()),
      holdings: this.#holdings.toSnapshot(),
      deposits: this.#deposits.toSnapshot(),
      orderQueue: this.#orderQueue.toSnapshot(),
      reserve: [...this.#reserve],
      window: this.#window
        ? { seatId: this.#window.seatId, budget: this.#window.budget.toSnapshot() }
        : null,
    };
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  #newsView() {
    if (!this.#latestNews) {
      return null;
    }
    const card = newsCardById(this.#latestNews.id);
    if (!card) {
      return null;
    }
    return {
      id: card.id,
      headline: card.headline,
      explanation: card.explanation,
      round: this.#latestNews.round,
      cyclePhase: card.phase,
      effects: card.effects.map((effect) => ({ ...effect })),
    };
  }

  #assertWindow(playerId) {
    if (!this.#window) {
      throw DomainError.invalidPhase('거래 창구가 열려 있지 않습니다');
    }
    if (this.#window.seatId !== playerId) {
      throw DomainError.notYourTurn(
        `거래 창구는 ${this.#window.seatId} 좌석의 것입니다 (요청: ${playerId})`,
      );
    }
  }

  #requireInstrument(instrumentId) {
    const instrument = this.instrumentOf(instrumentId);
    if (!instrument) {
      throw DomainError.invalidArgument(`상장된 종목이 아닙니다: ${String(instrumentId)}`);
    }
    return instrument;
  }

  /**
   * 예약 한 건을 재검증하고 체결한다. 실패는 예외가 아니라 사유 코드로 돌려준다.
   * @returns {{ok:boolean, reasonCode?:string, intents?:object[], events?:object[], cashDelta?:number}}
   */
  #executeQueued({ order, playerId, cash }) {
    if (this.#window.budget.exhausted) {
      return { ok: false, reasonCode: REJECT_REASONS.ORDER_LIMIT };
    }
    try {
      if (order.kind === ORDER_KINDS.BUY_STOCK || order.kind === ORDER_KINDS.SELL_STOCK) {
        const instrument = this.instrumentOf(order.instrumentId);
        if (!instrument) {
          return { ok: false, reasonCode: REJECT_REASONS.UNKNOWN_INSTRUMENT };
        }
        if (!instrument.isListed()) {
          return { ok: false, reasonCode: REJECT_REASONS.DELISTED };
        }
        const notional = instrument.price * order.quantity;
        if (order.kind === ORDER_KINDS.BUY_STOCK) {
          const result = this.buy({
            playerId,
            instrumentId: order.instrumentId,
            quantity: order.quantity,
            cash,
          });
          return { ok: true, ...result, cashDelta: -(notional + TradingDesk.fee(notional)) };
        }
        const result = this.sell({
          playerId,
          instrumentId: order.instrumentId,
          quantity: order.quantity,
          cash,
        });
        return { ok: true, ...result, cashDelta: notional - TradingDesk.fee(notional) };
      }
      if (order.kind === ORDER_KINDS.DEPOSIT) {
        const result = this.deposit({ playerId, amount: order.amount, cash });
        return { ok: true, ...result, cashDelta: -order.amount };
      }
      const result = this.withdraw({ playerId, amount: order.amount });
      return { ok: true, ...result, cashDelta: order.amount };
    } catch (error) {
      // **규칙 위반만** 사유 코드로 바꿔 그 주문을 버린다. 프로그래밍 오류(TypeError 등)를
      // "주문 거절"로 바꿔 버리면 결함이 조용히 묻히므로 그대로 올려보낸다
      // (application 레이어가 ERR010 + 서버 로그로 처리한다).
      if (!(error instanceof DomainError)) {
        throw error;
      }
      return { ok: false, reasonCode: reasonCodeOf(error, order) };
    }
  }

  /** 상장폐지 종목을 겨눈 예약은 체결될 수 없으므로 버린다. */
  #dropQueuedOrdersOf(instrumentId, events) {
    for (const order of this.#orderQueue.viewModel()) {
      if (order.instrumentId !== instrumentId) {
        continue;
      }
      this.#orderQueue.cancel({ seatId: order.seatId, orderId: order.id });
      events.push({
        type: MARKET_EVENT_TYPES.QUEUED_ORDER_REJECTED,
        payload: {
          playerId: order.seatId,
          orderId: order.id,
          kind: order.kind,
          reasonCode: REJECT_REASONS.DELISTED,
        },
      });
    }
  }

  /**
   * 지난 틱에 폐지된 종목을 목록에서 빼고 예비 풀에서 채운다.
   * 이번 틱에 폐지된 종목은 화면이 "무슨 일이 있었는지" 보여 줄 수 있도록 한 라운드 남겨 둔다.
   */
  #relistIfNeeded(delistedThisTick) {
    const events = [];
    const stale = this.#instruments.filter(
      (instrument) => !instrument.isListed() && !delistedThisTick.includes(instrument),
    );
    for (const instrument of stale) {
      this.#instruments = this.#instruments.filter((candidate) => candidate !== instrument);
      const nextId = this.#reserve.shift();
      const spec = nextId ? instrumentSpecById(nextId) : null;
      if (!spec) {
        // 예비 풀이 비었으면 목록이 줄어든다(25라운드 판에서는 일어나지 않지만 규칙을 정해 둔다).
        continue;
      }
      const listed = Instrument.fromSpec(spec);
      this.#instruments.push(listed);
      events.push({
        type: MARKET_EVENT_TYPES.INSTRUMENT_LISTED,
        payload: {
          instrumentId: listed.id,
          name: listed.name,
          sector: listed.sector,
          price: listed.price,
        },
      });
    }
    return events;
  }
}

/** 화면이 숫자를 하드코딩하지 않도록 뷰에 함께 싣는 규칙 상수. */
const MARKET_RULES = Object.freeze({
  feeBp: FEE_BP,
  feeMin: FEE_MIN,
  maxOrdersPerWindow: MAX_ORDERS_PER_WINDOW,
  maxNotionalPerWindow: MAX_NOTIONAL_PER_WINDOW,
  maxNotionalPerOrder: MAX_NOTIONAL_PER_ORDER,
  minQuantity: MIN_QUANTITY,
  maxQuantity: MAX_QUANTITY,
  maxPositionPerInstrument: MAX_POSITION_PER_INSTRUMENT,
  depositUnit: DEPOSIT_UNIT,
  depositCap: DEPOSIT_CAP,
  maxQueuedOrders: MAX_QUEUED_ORDERS_PER_SEAT,
  baseRateMinBp: BASE_RATE_MIN_BP,
  baseRateMaxBp: BASE_RATE_MAX_BP,
  seriesLength: MAX_SERIES_LENGTH,
});

/** 그 종목(섹터)에 적용되는 뉴스 효과 합계(bp). `ALL`은 전 종목에 더해진다. */
function newsBpFor(card, sector) {
  let bp = 0;
  for (const effect of card.effects) {
    if (effect.target === NEWS_EFFECT_TARGETS.SECTOR && effect.sector === sector) {
      bp += effect.bp;
    } else if (effect.target === NEWS_EFFECT_TARGETS.ALL) {
      bp += effect.bp;
    }
  }
  return bp;
}

function sumEffects(card, target) {
  let bp = 0;
  for (const effect of card.effects) {
    if (effect.target === target) {
      bp += effect.bp;
    }
  }
  return bp;
}

/**
 * 도메인 오류를 예약 주문 거절 사유로 옮긴다.
 *
 * 한도 위반은 `DomainError.details`에 실린 **세부 종류 코드**로 분류한다 — 예전에는 한국어
 * 오류 메시지를 정규식으로 봤는데, 문구를 다듬는 것만으로 사유가 조용히 바뀌었다.
 */
function reasonCodeOf(error, order) {
  switch (error?.code) {
    case 'INSUFFICIENT_CASH':
      return order.kind === 'SELL_STOCK'
        ? REJECT_REASONS.NOT_ENOUGH_SHARES
        : order.kind === 'WITHDRAW'
          ? REJECT_REASONS.INSUFFICIENT_DEPOSIT
          : REJECT_REASONS.INSUFFICIENT_CASH;
    case 'TRADE_LIMIT':
      return ALL_REJECT_REASONS.includes(error.details)
        ? error.details
        : REJECT_REASONS.NOTIONAL_LIMIT;
    case 'INVALID_PHASE':
      return REJECT_REASONS.WINDOW_CLOSED;
    default:
      return REJECT_REASONS.INVALID_ORDER;
  }
}

function restoreLatestNews(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  if (!newsCardById(raw.id) || !Number.isSafeInteger(raw.round)) {
    return null;
  }
  return { id: raw.id, round: raw.round };
}

function restoreReserve(raw) {
  if (!Array.isArray(raw)) {
    return RESERVE_INSTRUMENTS.map((spec) => spec.id);
  }
  const allowed = RESERVE_INSTRUMENTS.map((spec) => spec.id);
  return raw.filter((id) => allowed.includes(id));
}

function restoreWindow(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  if (typeof raw.seatId !== 'string' || raw.seatId.length === 0) {
    throw DomainError.invalidArgument(`거래 창구 좌석이 올바르지 않습니다: ${String(raw.seatId)}`);
  }
  // 숫자·문자열이 들어오면 구조 분해가 0으로 떨어져 **예산이 가득 찬 새 창구**가 된다.
  // (검증기가 먼저 막지만, 여기서도 조용히 예산을 되돌리지 않게 한다.)
  if (raw.budget !== undefined && raw.budget !== null && !isPlainObject(raw.budget)) {
    throw DomainError.invalidArgument('거래 창구 예산이 객체가 아닙니다');
  }
  return { seatId: raw.seatId, budget: new TradeBudget(raw.budget ?? {}) };
}

export { LISTING_SIZE };
