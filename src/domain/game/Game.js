import { DomainError } from '../shared/DomainError.js';
import { MoneyIntent } from '../shared/MoneyIntent.js';
import { BankLedger } from './BankLedger.js';
import { Board } from './Board.js';
import { Casino } from './Casino.js';
import { CityTrade } from './CityTrade.js';
import { Dice } from './Dice.js';
import {
  ISLAND_RESCUE_FEE,
  LOAN_DEBT,
  LOAN_PRINCIPAL,
  MAX_CONSECUTIVE_DOUBLES,
  Player,
  STARTING_CASH,
} from './Player.js';
import { LapIncome } from './LapIncome.js';
import {
  buildPendingDecision,
  forbiddenTravelIndexes,
  startBuildCandidates,
} from './PendingDecision.js';
import { RoundClock, TURN_OUTCOMES } from './RoundClock.js';
import { TICKET_ACTIONS, TicketEffects } from './TicketEffects.js';
import { TicketDeck } from './TicketDeck.js';
import { Treasury } from './Treasury.js';
import { AssetRegistry } from './payment/AssetRegistry.js';
import { Bankruptcy } from './payment/Bankruptcy.js';
import { CONTINUATIONS, SINKS } from './payment/DebtNote.js';
import { Liquidator } from './payment/Liquidator.js';
import { NetWorth } from './payment/NetWorth.js';
import { PAYMENT_OUTCOMES, PaymentFlow } from './payment/PaymentFlow.js';
import { PROPERTY_ASSET_KIND, PropertyAssets } from './payment/PropertyAssets.js';
import {
  COMMAND_OWNERSHIP,
  COMMAND_OWNERSHIPS,
  COMMAND_PHASES,
  COMMAND_TYPES,
} from './commands.js';
import { EVENT_TYPES, GAME_OVER_REASONS, MONEY_REASONS } from './events.js';
import { PHASES } from './phases.js';
import { SPACE_KINDS } from './data/board.js';

/** 최소/최대 좌석 수. */
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
/** 세관 납부 비율. */
const CUSTOMS_TAX_RATE = 0.1;
/**
 * 한 커맨드 안에서 티켓이 연쇄될 수 있는 최대 횟수(무한 루프 방지).
 * 배포 티켓 데이터로는 연쇄가 한 번도 일어나지 않으므로 지금은 **방어용**이며,
 * 앞으로 티켓이 추가돼 연쇄가 생겨도 턴이 끝없이 이어지지 않도록 보장한다.
 */
export const MAX_TICKET_CHAIN = 3;
/**
 * 턴 안에서만 쓰는 임시 상태의 초기값.
 * `debt`(진행 중인 채무)는 `PaymentFlow`가 들고 있으며, 스냅샷에서만 이 자리에 실린다.
 */
const EMPTY_TURN = Object.freeze({
  rollWasDouble: false,
  casinoRoundsLeft: 0,
  buildIndex: null,
  acquireIndex: null,
});

/**
 * 게임 Aggregate Root.
 * 턴 소유권/페이즈 전이/모든 돈의 흐름을 스스로 검증하고 도메인 이벤트를 남긴다.
 * 좌석 토큰 같은 인증 정보는 다루지 않으며, 이미 해석된 seatId(=playerId)만 받는다.
 */
export class Game {
  /** @type {Board} */ #board;
  /** @type {Player[]} */ #players;
  /** @type {TicketDeck} */ #deck;
  /** @type {Casino} */ #casino;
  /** @type {BankLedger} */ #ledger;
  /** @type {Treasury} */ #treasury;
  /** @type {import('../shared/interfaces.js').RandomSource} */ #random;
  /** @type {Dice} */ #dice;
  /** @type {RoundClock} */ #clock;
  /** @type {AssetRegistry} */ #assets;
  /** @type {Liquidator} */ #liquidator;
  /** @type {NetWorth} */ #netWorth;
  /** @type {PaymentFlow} */ #payment;
  /** @type {Bankruptcy} */ #bankruptcy;
  /** @type {LapIncome} */ #lapIncome;
  /** @type {TicketEffects} */ #ticketEffects = new TicketEffects();
  /** @type {CityTrade} */ #cityTrade;
  /** @type {Readonly<Record<string, (payload: object) => void>>} */ #handlers;
  #phase;
  #version;
  #initialTotal;
  #turn;
  #events = [];

  constructor({
    board,
    players,
    deck,
    casino,
    ledger,
    random,
    phase = PHASES.AWAIT_ROLL,
    turnIndex = 0,
    round = 1,
    version = 0,
    options = { roundLimit: null },
    initialTotal,
    turn = { ...EMPTY_TURN },
  }) {
    this.#board = board;
    this.#players = players;
    this.#deck = deck;
    this.#casino = casino;
    this.#ledger = ledger;
    this.#random = random;
    this.#dice = new Dice(random);
    this.#phase = phase;
    this.#clock = new RoundClock({ round, turnIndex, roundLimit: options.roundLimit ?? null });
    this.#version = version;
    this.#initialTotal = initialTotal;
    this.#treasury = new Treasury({ players, ledger, casino, initialTotal });

    // 자산군 레지스트리 — 지금은 부동산 하나뿐이다. 주식·예금·파생은 `registerAssetProvider`
    // 한 줄로 총자산·정리 목록·자동매각 순서·파산 청산에 함께 들어온다(Game은 안 바뀐다).
    this.#assets = new AssetRegistry();
    this.#assets.register(new PropertyAssets({ board }));
    this.#liquidator = new Liquidator({ registry: this.#assets });
    this.#netWorth = new NetWorth({ registry: this.#assets });
    this.#bankruptcy = new Bankruptcy({ registry: this.#assets });
    this.#lapIncome = new LapIncome();
    this.#cityTrade = new CityTrade({ findPlayer: (id) => this.playerById(id) });
    this.#payment = new PaymentFlow({
      treasury: this.#treasury,
      findPlayer: (id) => this.playerById(id),
    });

    this.#handlers = this.#buildHandlers();

    const { debt = null, ...turnRest } = turn ?? {};
    this.#turn = { ...EMPTY_TURN, ...turnRest };
    this.#payment.restore(debt);
  }

  /**
   * 새 게임을 시작한다.
   * @param {{players: Array<{id:string,name:string}>, options?: {roundLimit:number|null}, random: import('../shared/interfaces.js').RandomSource}} params
   */
  static start({ players, options = { roundLimit: null }, random }) {
    if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      throw DomainError.notEnoughSeats(`플레이어 수는 ${MIN_PLAYERS}~${MAX_PLAYERS}명이어야 합니다`);
    }
    const entities = players.map((seat) => new Player({ id: seat.id, name: seat.name }));
    return new Game({
      board: Board.createDefault(),
      players: entities,
      deck: TicketDeck.createDefault(),
      casino: new Casino(),
      ledger: new BankLedger(),
      random,
      options,
      initialTotal: entities.length * STARTING_CASH,
    });
  }

  /**
   * 스냅샷에서 복원한다.
   * @param {object} snapshot
   * @param {import('../shared/interfaces.js').RandomSource} random
   * @param {{ticketCatalog?: Record<string, object>}} [options]
   *   `ticketCatalog`는 **테스트 전용** 티켓 목록이다. 배포 데이터로는 만들 수 없는 상황
   *   (예: 티켓이 연달아 나오는 연쇄)을 실제로 재현해 검증하기 위한 seam이며,
   *   운영 경로에서는 언제나 생략해 배포 티켓 20장을 쓴다.
   */
  static restore(snapshot, random, { ticketCatalog } = {}) {
    if (!snapshot || !Array.isArray(snapshot.players)) {
      throw DomainError.invalidArgument('게임 스냅샷 구조가 올바르지 않습니다');
    }
    const players = snapshot.players.map((player) => new Player({ ...player }));
    return new Game({
      board: Board.restore(snapshot.board ?? []),
      players,
      deck: ticketCatalog
        ? TicketDeck.restore(snapshot.deck ?? {}, ticketCatalog)
        : TicketDeck.restore(snapshot.deck ?? {}),
      casino: new Casino(snapshot.casino ?? {}),
      ledger: new BankLedger(snapshot.ledger ?? {}),
      random,
      phase: snapshot.phase,
      turnIndex: snapshot.turnIndex ?? 0,
      round: snapshot.round ?? 1,
      version: snapshot.version ?? 0,
      options: snapshot.options ?? { roundLimit: null },
      initialTotal:
        snapshot.initialTotal ??
        players.reduce((sum, player) => sum + player.cash, 0) + (snapshot.casino?.jackpot ?? 0),
      turn: { ...EMPTY_TURN, ...(snapshot.turn ?? {}) },
    });
  }

  // ── 조회 ────────────────────────────────────────────────────────────────

  get phase() {
    return this.#phase;
  }

  get round() {
    return this.#clock.round;
  }

  get version() {
    return this.#version;
  }

  get options() {
    return { roundLimit: this.#clock.roundLimit };
  }

  /**
   * 라운드 틱 훅을 등록한다(설계서 §2.3 순서).
   * 시장/대출/파생/리포트 같은 서브시스템이 붙는 **유일한 구독 지점**이다. 훅은 돈을 직접
   * 만지지 않고 `{ intents, events }`만 돌려주며, 적용은 Game이 `Treasury`로 한다.
   * @param {import('./RoundClock.js').RoundTickHook} hook
   */
  registerRoundTickHook(hook) {
    this.#clock.registerTick(hook);
    return this;
  }

  get board() {
    return this.#board;
  }

  get players() {
    return [...this.#players];
  }

  get jackpot() {
    return this.#casino.jackpot;
  }

  get casino() {
    return this.#casino;
  }

  get currentPlayerId() {
    return this.#players[this.#clock.turnIndex]?.id ?? null;
  }

  /**
   * 지금 커맨드를 보낼 수 있는 **행동 주체** 좌석(한 번에 한 명).
   *
   * 오늘은 항상 턴 소유자와 같다. 앞으로 압류 경매처럼 "현재 턴 플레이어가 아닌 좌석이
   * 결정을 내리는" 구간이 생기면 이 값만 달라지고, `currentSeatId`는 턴 소유자로 남는다.
   * 그래서 자동 진행 드라이버·SSE·뮤텍스 모델을 흔들지 않는다.
   */
  get actingSeatId() {
    return this.currentPlayerId;
  }

  get #current() {
    return this.#players[this.#clock.turnIndex];
  }

  playerById(id) {
    return this.#players.find((player) => player.id === id) ?? null;
  }

  livingPlayers() {
    return this.#players.filter((player) => !player.eliminated);
  }

  isOver() {
    return this.#phase === PHASES.GAME_OVER;
  }

  /** 현재 플레이어가 내려야 하는 결정(없으면 null). 조립은 읽기 모델이 맡는다. */
  get pendingDecision() {
    return buildPendingDecision({
      phase: this.#phase,
      player: this.#current,
      board: this.#board,
      turn: this.#turn,
      casino: this.#casino,
      payment: this.#payment,
      liquidator: this.#liquidator,
    });
  }

  /** 총자산 순위(단일 출처 `NetWorth`). 생존자 우선, 그다음 총자산 내림차순. */
  rankings() {
    return this.#netWorth.rankings(this.#players);
  }

  /**
   * 한 좌석의 총자산. `application/dto.js`도 이 메서드를 쓴다 — 순위와 화면의 총자산이
   * 어긋나지 않도록 계산 지점을 하나로 유지한다.
   */
  netWorthOf(playerId) {
    const player = this.playerById(playerId);
    return player ? this.#netWorth.of(player) : 0;
  }

  /**
   * 자산군을 등록한다(R3: 확장은 포트 등록으로).
   * 등록 한 줄로 총자산·정리 매각 목록·자동매각 순서·파산 청산에 동시에 반영된다.
   * @param {import('../shared/AssetProvider.js').AssetProvider} provider
   */
  registerAssetProvider(provider) {
    this.#assets.register(provider);
    return this;
  }

  /**
   * 돈의 보존 불변식 점검용 보고.
   * `breakdown`은 사유별 은행 순유입이며 `netFromBank === sum(breakdown)`이 성립한다
   * (`breakdownBalanced`) — 어떤 흐름이 장부를 우회했는지 바로 특정할 수 있다.
   */
  moneyReport() {
    return this.#treasury.report();
  }

  // ── 커맨드 ──────────────────────────────────────────────────────────────

  /**
   * 커맨드를 실행한다. 행동 주체 → 페이즈 → 페이로드 순으로 검증한 뒤 상태를 바꾼다.
   * @param {string} seatId 이미 인증이 끝난 좌석 id
   * @param {string} type COMMAND_TYPES
   * @param {object} payload
   * @returns {object[]} 이번 커맨드가 만든 도메인 이벤트
   */
  execute(seatId, type, payload = {}) {
    const allowedPhases = COMMAND_PHASES[type];
    const handler = this.#handlers[type];
    if (!allowedPhases || !handler) {
      throw DomainError.invalidArgument(`알 수 없는 커맨드입니다: ${type}`);
    }
    if (this.isOver()) {
      throw DomainError.invalidPhase('이미 끝난 게임입니다');
    }
    this.#assertOwnership(type, seatId);
    if (!allowedPhases.includes(this.#phase)) {
      throw DomainError.invalidPhase(`${this.#phase} 페이즈에서는 ${type} 커맨드를 쓸 수 없습니다`);
    }

    this.#events = [];
    handler(payload ?? {});
    this.#version += 1;
    return [...this.#events];
  }

  /** 커맨드 종류 → 처리기. `COMMAND_PHASES`/`COMMAND_OWNERSHIP`과 짝을 이룬다. */
  #buildHandlers() {
    return Object.freeze({
      [COMMAND_TYPES.ROLL]: () => this.#roll(),
      [COMMAND_TYPES.BUY]: () => this.#buy(),
      [COMMAND_TYPES.SKIP_BUY]: () => this.#skipBuy(),
      [COMMAND_TYPES.BUILD]: (payload) => this.#build(payload),
      [COMMAND_TYPES.SKIP_BUILD]: () => this.#skipBuild(),
      [COMMAND_TYPES.START_BUILD]: (payload) => this.#startBuild(payload),
      [COMMAND_TYPES.SKIP_START_BUILD]: () => this.#skipStartBuild(),
      [COMMAND_TYPES.ACQUIRE]: () => this.#acquire(),
      [COMMAND_TYPES.SKIP_ACQUIRE]: () => this.#skipAcquire(),
      [COMMAND_TYPES.CASINO_BET]: (payload) => this.#casinoBet(payload),
      [COMMAND_TYPES.CASINO_LEAVE]: () => this.#casinoLeave(),
      [COMMAND_TYPES.ISLAND_PAY]: () => this.#islandPay(),
      [COMMAND_TYPES.ISLAND_ROLL]: () => this.#islandRoll(),
      [COMMAND_TYPES.TRAVEL]: (payload) => this.#travel(payload),
      [COMMAND_TYPES.SELL]: (payload) => this.#sell(payload),
      [COMMAND_TYPES.AUTO_SELL]: () => this.#autoSell(),
      [COMMAND_TYPES.TAKE_LOAN]: () => this.#takeLoan(),
      [COMMAND_TYPES.DECLARE_BANKRUPTCY]: () => this.#declareBankruptcy(),
    });
  }

  /**
   * 이 커맨드를 보낼 자격이 있는 좌석인지 확인한다.
   * 지금은 모든 커맨드가 `CURRENT_PLAYER`라 "내 차례인가"와 같지만, 표를 통해 판단하므로
   * 앞으로 다른 행동 주체(경매 입찰자 등)가 추가되어도 여기 한 줄만 늘어난다.
   */
  #assertOwnership(type, seatId) {
    const ownership = COMMAND_OWNERSHIP[type];
    if (ownership !== COMMAND_OWNERSHIPS.CURRENT_PLAYER) {
      throw DomainError.invalidArgument(`알 수 없는 행동 주체 규칙입니다: ${ownership}`);
    }
    if (!this.actingSeatId || this.actingSeatId !== seatId) {
      throw DomainError.notYourTurn(`현재 턴은 ${this.currentPlayerId}입니다 (요청: ${seatId})`);
    }
  }

  #roll() {
    const player = this.#current;
    const { die1, die2, sum, isDouble } = this.#dice.roll();
    this.#emit(EVENT_TYPES.DICE_ROLLED, { playerId: player.id, die1, die2, sum, isDouble });
    this.#turn.rollWasDouble = isDouble;

    if (isDouble) {
      const count = player.recordDouble();
      if (count >= MAX_CONSECUTIVE_DOUBLES) {
        this.#turn.rollWasDouble = false;
        player.resetDoubles();
        this.#sendToIsland(player, { teleport: true });
        this.#endTurn();
        return;
      }
    } else {
      player.resetDoubles();
    }

    this.#moveBy(player, sum, 0);
  }

  #buy() {
    const player = this.#current;
    const city = this.#board.cityAt(player.position);
    this.#applyTrade(this.#cityTrade.buy({ player, city }));
    this.#offerBuild(player, city.index);
  }

  /** 도시 거래 결과(돈 이동 + 이벤트)를 반영한다. */
  #applyTrade({ intents, events }) {
    this.#treasury.apply(intents);
    this.#emitAll(events);
  }

  #skipBuy() {
    const player = this.#current;
    this.#emit(EVENT_TYPES.PURCHASE_DECLINED, { playerId: player.id, index: player.position });
    this.#endTurn();
  }

  /** 건설 기회를 제안한다. 지을 것이 없거나 현금이 없으면 턴을 끝낸다(규칙은 City가 안다). */
  #offerBuild(player, cityIndex) {
    const city = this.#board.cityAt(cityIndex);
    if (!city.isOwnedBy(player.id) || !city.canOfferBuildWith(player.cash)) {
      this.#endTurn();
      return;
    }
    this.#turn.buildIndex = cityIndex;
    this.#phase = PHASES.AWAIT_BUILD;
    this.#emit(EVENT_TYPES.BUILD_OFFERED, {
      playerId: player.id,
      index: city.index,
      name: city.name,
      options: city.buildOptions(),
    });
  }

  #build({ buildings }) {
    const city = this.#board.cityAt(this.#turn.buildIndex);
    this.#applyTrade(this.#cityTrade.build({ player: this.#current, city, buildings }));
    this.#endTurn();
  }

  #skipBuild() {
    const player = this.#current;
    this.#emit(EVENT_TYPES.BUILD_DECLINED, { playerId: player.id, index: this.#turn.buildIndex });
    this.#endTurn();
  }

  #offerStartBuild(player) {
    const candidates = startBuildCandidates(this.#board, player);
    if (candidates.length === 0) {
      this.#endTurn();
      return;
    }
    this.#phase = PHASES.AWAIT_START_BUILD;
    this.#emit(EVENT_TYPES.START_BONUS_OFFERED, { playerId: player.id, candidates });
  }

  #startBuild({ cityIndex, buildings }) {
    if (!Number.isInteger(cityIndex) || !this.#board.isOwnable(cityIndex)) {
      throw DomainError.invalidArgument(`건설할 칸이 올바르지 않습니다: ${cityIndex}`);
    }
    const city = this.#board.cityAt(cityIndex);
    this.#applyTrade(this.#cityTrade.build({ player: this.#current, city, buildings }));
    this.#endTurn();
  }

  #skipStartBuild() {
    this.#emit(EVENT_TYPES.BUILD_DECLINED, { playerId: this.#current.id, index: null });
    this.#endTurn();
  }

  /** 통행료를 모두 낸 뒤의 인수 제안. 보유 현금으로만 인수할 수 있다. */
  #offerAcquire(player, cityIndex) {
    const city = this.#board.cityAt(cityIndex);
    if (!city.canBeAcquired() || city.isOwnedBy(player.id) || !player.canPay(city.acquisitionPrice())) {
      this.#endTurn();
      return;
    }
    this.#turn.acquireIndex = cityIndex;
    this.#phase = PHASES.AWAIT_ACQUIRE;
    this.#emit(EVENT_TYPES.ACQUIRE_OFFERED, {
      playerId: player.id,
      index: city.index,
      name: city.name,
      ownerId: city.ownerId,
      price: city.acquisitionPrice(),
    });
  }

  #acquire() {
    const player = this.#current;
    const city = this.#board.cityAt(this.#turn.acquireIndex);
    this.#applyTrade(this.#cityTrade.acquire({ player, city }));
    this.#turn.acquireIndex = null;
    this.#offerBuild(player, city.index);
  }

  #skipAcquire() {
    this.#emit(EVENT_TYPES.ACQUIRE_DECLINED, {
      playerId: this.#current.id,
      index: this.#turn.acquireIndex,
    });
    this.#turn.acquireIndex = null;
    this.#endTurn();
  }

  #casinoBet({ game, bet, choice = null }) {
    const player = this.#current;
    this.#casino.assertValidBet(bet, player.cash);
    const result = this.#casino.play({ game, bet, choice }, this.#random);
    const { jackpotChanged } = this.#treasury.apply(
      this.#casino.moneyIntentsFor({ playerId: player.id, bet, result }),
    );

    this.#emit(EVENT_TYPES.CASINO_RESULT, {
      playerId: player.id,
      game: result.game,
      bet: result.bet,
      win: result.win,
      payout: result.payout,
      jackpotWon: result.jackpotWon,
      detail: result.detail,
    });
    if (jackpotChanged) {
      this.#emit(EVENT_TYPES.JACKPOT_CHANGED, { jackpot: this.#casino.jackpot });
    }

    this.#turn.casinoRoundsLeft -= 1;
    if (this.#turn.casinoRoundsLeft <= 0 || !this.#casino.canBet(player.cash)) {
      this.#leaveCasino(player);
    }
  }

  #casinoLeave() {
    this.#leaveCasino(this.#current);
  }

  #leaveCasino(player) {
    this.#turn.casinoRoundsLeft = 0;
    this.#emit(EVENT_TYPES.CASINO_LEFT, { playerId: player.id });
    this.#endTurn();
  }

  #islandPay() {
    const player = this.#current;
    if (!player.canPay(ISLAND_RESCUE_FEE)) {
      throw DomainError.insufficientCash(`구조비 ${ISLAND_RESCUE_FEE}원이 부족합니다`);
    }
    this.#treasury.payToBank({
      playerId: player.id,
      amount: ISLAND_RESCUE_FEE,
      reason: MONEY_REASONS.ISLAND_RESCUE,
    });
    player.leaveIsland();
    this.#emit(EVENT_TYPES.ISLAND_RESCUE_PAID, { playerId: player.id, amount: ISLAND_RESCUE_FEE });
    this.#emit(EVENT_TYPES.ISLAND_ESCAPED, { playerId: player.id, by: 'PAY' });
    this.#phase = PHASES.AWAIT_ROLL;
  }

  #islandRoll() {
    const player = this.#current;
    const { die1, die2, sum, isDouble } = this.#dice.roll();
    this.#emit(EVENT_TYPES.DICE_ROLLED, { playerId: player.id, die1, die2, sum, isDouble });
    this.#turn.rollWasDouble = false;

    if (isDouble) {
      player.leaveIsland();
      player.resetDoubles();
      this.#emit(EVENT_TYPES.ISLAND_ESCAPED, { playerId: player.id, by: 'DOUBLE' });
      this.#moveBy(player, sum, 0);
      return;
    }
    const remainingTurns = player.spendIslandTurn();
    this.#emit(EVENT_TYPES.ISLAND_STAY, { playerId: player.id, remainingTurns });
    this.#endTurn();
  }

  #travel({ destination }) {
    const player = this.#current;
    if (!Number.isInteger(destination) || destination < 0 || destination >= this.#board.size) {
      throw DomainError.invalidArgument(`목적지 칸이 올바르지 않습니다: ${destination}`);
    }
    if (forbiddenTravelIndexes(this.#board, player).includes(destination)) {
      throw DomainError.invalidArgument(`목적지로 고를 수 없는 칸입니다: ${destination}`);
    }
    player.consumeAirportTicket();
    const from = player.position;
    const steps = this.#board.stepsTo(from, destination);
    this.#emit(EVENT_TYPES.TRAVELED, { playerId: player.id, from, to: destination });
    this.#moveBy(player, steps, 0);
  }

  #sell({ cityIndex }) {
    this.#payment.assertPendingDebt();
    if (!Number.isInteger(cityIndex)) {
      throw DomainError.invalidArgument(`매각할 칸이 올바르지 않습니다: ${cityIndex}`);
    }
    const { intents, events } = this.#liquidator.sell({
      playerId: this.#current.id,
      kind: PROPERTY_ASSET_KIND,
      assetId: String(cityIndex),
    });
    this.#treasury.apply(intents);
    this.#emitAll(events);
    this.#afterLiquidationStep();
  }

  // ── 이동과 칸 해석 ──────────────────────────────────────────────────────

  #moveBy(player, steps, depth) {
    const from = player.position;
    const { index, passedStart } = this.#board.advance(from, steps);
    player.moveTo(index);
    this.#emit(EVENT_TYPES.MOVED, { playerId: player.id, from, to: index, steps, passedStart });
    if (passedStart) {
      this.#collectLapIncome(player);
    }
    this.#resolveLanding(player, index, depth);
  }

  /**
   * 출발 칸 통과 1회 정산(월급 → 대출 압류). 앞으로 배당·분할상환이 붙는 지점은
   * `LapIncome`이며 Game은 결과를 적용만 한다.
   */
  #collectLapIncome(player) {
    const { intents, events } = this.#lapIncome.collect({ player });
    this.#treasury.apply(intents);
    this.#emitAll(events);
  }

  #resolveLanding(player, index, depth) {
    const space = this.#board.spaceAt(index);
    this.#emit(EVENT_TYPES.LANDED, {
      playerId: player.id,
      index,
      kind: space.kind,
      name: space.name,
    });

    switch (space.kind) {
      case SPACE_KINDS.START:
        return this.#offerStartBuild(player);
      case SPACE_KINDS.CITY:
      case SPACE_KINDS.RESORT:
        return this.#resolveOwnable(player, index);
      case SPACE_KINDS.TICKET:
        return this.#resolveTicket(player, depth);
      case SPACE_KINDS.TAX:
        return this.#resolveCustoms(player);
      case SPACE_KINDS.ISLAND:
        this.#sendToIsland(player, { teleport: false });
        return this.#endTurn();
      case SPACE_KINDS.CASINO:
        return this.#resolveCasino(player);
      case SPACE_KINDS.AIRPORT:
        player.grantAirportTicket();
        this.#emit(EVENT_TYPES.AIRPORT_TICKET_GRANTED, { playerId: player.id });
        // 조난과 같은 취급: 더블이어도 추가 턴이 없다. 그래야 이동권은 언제나
        // "다음 자기 턴에 30번 칸에서" 쓰이고, 다른 칸에서 쓰이는 일이 없다.
        return this.#endTurn({ allowExtra: false });
      default:
        return this.#endTurn();
    }
  }

  #resolveOwnable(player, index) {
    const city = this.#board.cityAt(index);

    if (!city.isOwned()) {
      if (player.canPay(city.price)) {
        this.#phase = PHASES.AWAIT_BUY;
        return;
      }
      this.#endTurn();
      return;
    }

    if (city.isOwnedBy(player.id)) {
      this.#offerBuild(player, index);
      return;
    }

    const owner = this.playerById(city.ownerId);
    if (!owner || owner.eliminated) {
      this.#endTurn();
      return;
    }
    const toll = city.tollFor({ resortCount: this.#board.resortCountOf(owner.id) });
    if (toll <= 0) {
      this.#endTurn();
      return;
    }
    this.#charge({
      items: [{ amount: toll, sink: SINKS.PLAYER, toPlayerId: owner.id }],
      reason: MONEY_REASONS.TOLL,
      event: {
        type: EVENT_TYPES.TOLL_PAID,
        payload: { payerId: player.id, ownerId: owner.id, index, amount: toll },
      },
      next: { kind: CONTINUATIONS.ACQUIRE, cityIndex: index },
    });
  }

  #resolveCustoms(player) {
    const amount = Math.floor(player.cash * CUSTOMS_TAX_RATE);
    if (amount <= 0) {
      this.#endTurn();
      return;
    }
    this.#charge({
      items: [{ amount, sink: SINKS.JACKPOT, toPlayerId: null }],
      reason: MONEY_REASONS.TAX,
      event: { type: EVENT_TYPES.TAX_PAID, payload: { playerId: player.id, amount } },
    });
  }

  #resolveCasino(player) {
    if (!this.#casino.canBet(player.cash)) {
      this.#endTurn();
      return;
    }
    this.#turn.casinoRoundsLeft = Casino.MAX_ROUNDS_PER_VISIT;
    this.#phase = PHASES.AWAIT_CASINO;
    this.#emit(EVENT_TYPES.CASINO_ENTERED, {
      playerId: player.id,
      roundsLeft: this.#turn.casinoRoundsLeft,
      jackpot: this.#casino.jackpot,
    });
  }

  #sendToIsland(player, { teleport }) {
    const islandIndex = this.#board.indexOfKind(SPACE_KINDS.ISLAND);
    if (teleport) {
      const from = player.position;
      player.moveTo(islandIndex);
      this.#emit(EVENT_TYPES.MOVED, {
        playerId: player.id,
        from,
        to: islandIndex,
        steps: null,
        passedStart: false,
      });
    }
    player.strand();
    this.#emit(EVENT_TYPES.STRANDED, {
      playerId: player.id,
      remainingTurns: player.islandRemainingTurns,
    });
  }

  // ── 행운 티켓 ───────────────────────────────────────────────────────────

  #resolveTicket(player, depth) {
    if (depth >= MAX_TICKET_CHAIN) {
      this.#endTurn();
      return;
    }
    const ticket = this.#deck.draw(this.#random);
    this.#emit(EVENT_TYPES.TICKET_DRAWN, {
      playerId: player.id,
      ticketId: ticket.id,
      text: ticket.text,
      effect: ticket.effect,
    });
    this.#applyTicket(player, ticket, depth + 1);
  }

  /** 티켓 효과는 `TicketEffects`가 계산하고, Game은 상태기계만 움직인다. */
  #applyTicket(player, ticket, depth) {
    const action = this.#ticketEffects.resolve({ ticket, player, board: this.#board });
    switch (action.action) {
      case TICKET_ACTIONS.GAIN:
        return this.#gainFromBank(player, action.amount, ticket.id);
      case TICKET_ACTIONS.CHARGE:
        return action.amount > 0 ? this.#charge(action) : this.#endTurn();
      case TICKET_ACTIONS.MOVE:
        return this.#moveBy(player, action.steps, depth);
      case TICKET_ACTIONS.TO_ISLAND:
        this.#sendToIsland(player, { teleport: true });
        return this.#endTurn();
      case TICKET_ACTIONS.COLLECT_FROM_ALL:
        return this.#collectFromAll(player, action.amount, ticket.id);
      case TICKET_ACTIONS.PAY_TO_ALL:
        return this.#payToAll(player, action.amount, ticket.id);
      default:
        return this.#endTurn();
    }
  }

  #gainFromBank(player, amount, ticketId) {
    if (amount > 0) {
      this.#treasury.receiveFromBank({
        playerId: player.id,
        amount,
        reason: MONEY_REASONS.TICKET,
        meta: { ticketId },
      });
      this.#emit(EVENT_TYPES.MONEY_GAINED, {
        playerId: player.id,
        amount,
        reason: MONEY_REASONS.TICKET,
        ticketId,
      });
    }
    this.#endTurn();
  }

  /**
   * 다른 모든 생존 플레이어에게서 정액을 받는다.
   * 자기 턴이 아닌 플레이어를 정리 페이즈로 보낼 수는 없으므로 보유 현금 한도까지만 받는다.
   */
  #collectFromAll(player, amount, ticketId) {
    const collected = this.livingPlayers()
      .filter((other) => other.id !== player.id)
      .map((other) => ({ other, paid: Math.min(amount, other.cash) }));

    this.#treasury.apply(
      collected.map(({ other, paid }) =>
        MoneyIntent.transfer({
          fromId: other.id,
          toId: player.id,
          amount: paid,
          reason: MONEY_REASONS.TICKET,
          meta: { ticketId },
        }),
      ),
    );
    for (const { other, paid } of collected) {
      this.#emit(EVENT_TYPES.MONEY_TRANSFERRED, {
        fromId: other.id,
        toId: player.id,
        amount: paid,
        reason: MONEY_REASONS.TICKET,
        ticketId,
      });
    }
    this.#endTurn();
  }

  #payToAll(player, amount, ticketId) {
    const receivers = this.livingPlayers().filter((other) => other.id !== player.id);
    if (receivers.length === 0 || amount <= 0) {
      this.#endTurn();
      return;
    }
    this.#charge({
      items: receivers.map((receiver) => ({
        amount,
        sink: SINKS.PLAYER,
        toPlayerId: receiver.id,
      })),
      reason: MONEY_REASONS.TICKET,
      event: {
        type: EVENT_TYPES.MONEY_LOST,
        payload: {
          playerId: player.id,
          amount: amount * receivers.length,
          reason: MONEY_REASONS.TICKET,
          ticketId,
          toPlayerIds: receivers.map((receiver) => receiver.id),
        },
      },
    });
  }

  // ── 지불/정리/파산 (payment 서브시스템에 위임) ──────────────────────────

  /**
   * 강제 지불. 현금이 부족하면 정리(AWAIT_LIQUIDATION) 페이즈로 들어간다.
   * 현금 부족 자체가 파산은 아니며, 파산은 플레이어가 직접 선언해야 한다.
   */
  #charge({ items, reason, event, next = { kind: CONTINUATIONS.TURN_END } }) {
    this.#applyPayment(
      this.#payment.charge({
        payer: this.#current,
        items,
        reason,
        event,
        next,
        inLiquidation: this.#phase === PHASES.AWAIT_LIQUIDATION,
      }),
    );
  }

  /** 정리 페이즈에서 한 걸음 진행한 뒤, 채무를 덮을 수 있으면 자동 정산한다. */
  #afterLiquidationStep() {
    const result = this.#payment.settleIfAffordable({
      payer: this.#current,
      inLiquidation: this.#phase === PHASES.AWAIT_LIQUIDATION,
    });
    if (result) {
      this.#applyPayment(result);
    }
  }

  /** 결제 흐름의 결과를 상태기계에 반영한다(이벤트 발행 → 페이즈 전이 또는 이어하기). */
  #applyPayment(result) {
    this.#emitAll(result.events);
    if (result.outcome === PAYMENT_OUTCOMES.LIQUIDATION_REQUIRED) {
      this.#phase = PHASES.AWAIT_LIQUIDATION;
      return;
    }
    this.#continueAfterPayment(result.next);
  }

  /** 지불이 끝난 뒤 흐름을 이어간다. */
  #continueAfterPayment(next) {
    if (next?.kind === CONTINUATIONS.ACQUIRE) {
      this.#offerAcquire(this.#current, next.cityIndex);
      return;
    }
    this.#endTurn();
  }

  #autoSell() {
    const player = this.#current;
    const note = this.#payment.assertPendingDebt();
    const { intents, events } = this.#liquidator.autoSell({
      playerId: player.id,
      cash: player.cash,
      amountDue: note.total,
    });
    this.#treasury.apply(intents);
    this.#emitAll(events);
    this.#afterLiquidationStep();
  }

  #takeLoan() {
    const player = this.#current;
    this.#payment.assertPendingDebt();
    if (!player.canTakeLoan()) {
      throw DomainError.invalidState('대출은 게임당 한 번만 받을 수 있습니다');
    }
    const { principal, debt } = player.takeLoan(LOAN_PRINCIPAL, LOAN_DEBT);
    this.#treasury.receiveFromBank({
      playerId: player.id,
      amount: principal,
      reason: MONEY_REASONS.LOAN,
    });
    this.#emit(EVENT_TYPES.LOAN_TAKEN, { playerId: player.id, principal, debt });
    this.#afterLiquidationStep();
  }

  #declareBankruptcy() {
    this.#payment.assertPendingDebt();
    this.#bankrupt(this.#current);
  }

  /** 파산: 남은 현금을 채권자에게 넘기고 모든 자산을 초기화한 뒤 탈락한다. */
  #bankrupt(player) {
    const plan = this.#bankruptcy.plan({
      player,
      note: this.#payment.note,
      players: this.#players,
    });

    if (plan.intents.length > 0) {
      const { jackpotChanged } = this.#treasury.apply(plan.intents);
      for (const { creditor, amount } of plan.transfers) {
        this.#emit(EVENT_TYPES.MONEY_TRANSFERRED, {
          fromId: player.id,
          toId: creditor.id,
          amount,
          reason: MONEY_REASONS.BANKRUPTCY,
        });
      }
      if (jackpotChanged) {
        this.#emit(EVENT_TYPES.JACKPOT_CHANGED, { jackpot: this.#casino.jackpot });
      }
    }

    const { releasedIndexes } = this.#bankruptcy.liquidateAll(player.id);
    player.eliminate();
    this.#payment.clear();
    this.#phase = PHASES.AWAIT_ROLL;
    this.#emit(EVENT_TYPES.BANKRUPT, {
      playerId: player.id,
      // 대표 채권자(기존 계약). 여러 명일 수 있으므로 전원은 creditorIds로 함께 알린다.
      creditorId: plan.creditors[0]?.id ?? null,
      creditorIds: plan.creditors.map((creditor) => creditor.id),
      paidAmount: plan.remaining,
      releasedIndexes,
    });

    if (this.#checkGameOver()) {
      return;
    }
    this.#endTurn({ allowExtra: false });
  }

  // ── 턴 전이 ─────────────────────────────────────────────────────────────

  #endTurn({ allowExtra = true } = {}) {
    const player = this.#current;
    this.#emit(EVENT_TYPES.TURN_ENDED, { playerId: player.id });
    if (this.isOver()) {
      return;
    }

    if (allowExtra && this.#turn.rollWasDouble && !player.eliminated && !player.isStranded()) {
      this.#turn.rollWasDouble = false;
      this.#phase = PHASES.AWAIT_ROLL;
      this.#emit(EVENT_TYPES.EXTRA_TURN, { playerId: player.id });
      return;
    }
    this.#advanceTurn();
  }

  /** 라운드 시계에 차례 넘기기를 맡기고, 그 결과(이벤트·돈 이동·종료)를 반영한다. */
  #advanceTurn() {
    const result = this.#clock.advance({ players: this.#players });

    if (result.intents.length > 0) {
      this.#treasury.apply(result.intents);
    }
    for (const event of result.events) {
      this.#emit(event.type, event.payload);
    }

    if (result.outcome === TURN_OUTCOMES.GAME_OVER) {
      this.#gameOver(result.reason);
      return;
    }
    this.#beginTurn();
  }

  #beginTurn() {
    const player = this.#current;
    // 이전 턴의 흔적(건설/인수 대상 칸까지)을 남기지 않는다.
    this.#turn = { ...EMPTY_TURN };
    player.resetDoubles();
    this.#emit(EVENT_TYPES.TURN_STARTED, { playerId: player.id, round: this.#clock.round });

    if (player.isStranded()) {
      this.#phase = PHASES.AWAIT_ISLAND_CHOICE;
      return;
    }
    if (player.airportPending) {
      this.#phase = PHASES.AWAIT_TRAVEL;
      this.#emit(EVENT_TYPES.AIRPORT_READY, { playerId: player.id });
      return;
    }
    this.#phase = PHASES.AWAIT_ROLL;
  }

  #checkGameOver() {
    if (this.livingPlayers().length <= 1) {
      this.#gameOver(GAME_OVER_REASONS.LAST_SURVIVOR);
      return true;
    }
    return false;
  }

  #gameOver(reason) {
    this.#phase = PHASES.GAME_OVER;
    this.#emit(EVENT_TYPES.GAME_OVER, { reason, rankings: this.rankings() });
  }

  #emit(type, payload) {
    this.#events.push({ type, ...payload });
  }

  /** 서브시스템이 돌려준 이벤트 목록을 순서대로 발행한다. */
  #emitAll(events) {
    for (const event of events) {
      this.#emit(event.type, event.payload);
    }
  }

  // ── 영속화 ──────────────────────────────────────────────────────────────

  toSnapshot() {
    return {
      version: this.#version,
      phase: this.#phase,
      turnIndex: this.#clock.turnIndex,
      round: this.#clock.round,
      options: { roundLimit: this.#clock.roundLimit },
      initialTotal: this.#initialTotal,
      players: this.#players.map((player) => player.toSnapshot()),
      board: this.#board.toSnapshot(),
      deck: this.#deck.toSnapshot(),
      casino: { jackpot: this.#casino.jackpot },
      ledger: this.#ledger.toSnapshot(),
      turn: {
        rollWasDouble: this.#turn.rollWasDouble,
        casinoRoundsLeft: this.#turn.casinoRoundsLeft,
        debt: this.#payment.toSnapshot(),
        buildIndex: this.#turn.buildIndex,
        acquireIndex: this.#turn.acquireIndex,
      },
    };
  }
}
