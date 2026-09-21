import { DomainError } from '../shared/DomainError.js';
import { BankLedger } from './BankLedger.js';
import { Board } from './Board.js';
import { Casino } from './Casino.js';
import { Dice } from './Dice.js';
import { BUILDING_TYPES } from './City.js';
import {
  ISLAND_RESCUE_FEE,
  LOAN_DEBT,
  LOAN_PRINCIPAL,
  MAX_CONSECUTIVE_DOUBLES,
  Player,
  SALARY,
  STARTING_CASH,
} from './Player.js';
import { TicketDeck } from './TicketDeck.js';
import { COMMAND_PHASES, COMMAND_TYPES } from './commands.js';
import { EVENT_TYPES, GAME_OVER_REASONS, MONEY_REASONS } from './events.js';
import { PHASES } from './phases.js';
import { SPACE_KINDS } from './data/board.js';
import { TICKET_EFFECTS } from './data/tickets.js';

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
/** 돈이 향하는 곳. 저장 스냅샷 검증(RoomSerializer)도 이 목록을 쓴다. */
export const SINKS = Object.freeze({ PLAYER: 'PLAYER', BANK: 'BANK', JACKPOT: 'JACKPOT' });
/** 지불이 끝난 뒤 이어질 흐름. 저장 스냅샷 검증도 이 목록을 쓴다. */
export const CONTINUATIONS = Object.freeze({ TURN_END: 'TURN_END', ACQUIRE: 'ACQUIRE' });
/** 턴 안에서만 쓰는 임시 상태의 초기값. */
const EMPTY_TURN = Object.freeze({
  rollWasDouble: false,
  casinoRoundsLeft: 0,
  debt: null,
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
  /** @type {import('../shared/interfaces.js').RandomSource} */ #random;
  /** @type {Dice} */ #dice;
  #phase;
  #turnIndex;
  #round;
  #version;
  #options;
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
    this.#turnIndex = turnIndex;
    this.#round = round;
    this.#version = version;
    this.#options = { roundLimit: options.roundLimit ?? null };
    this.#initialTotal = initialTotal;
    this.#turn = { ...turn };
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
    return this.#round;
  }

  get version() {
    return this.#version;
  }

  get options() {
    return { ...this.#options };
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
    return this.#players[this.#turnIndex]?.id ?? null;
  }

  get #current() {
    return this.#players[this.#turnIndex];
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

  /** 현재 플레이어가 내려야 하는 결정(없으면 null). */
  get pendingDecision() {
    const player = this.#current;
    if (!player) {
      return null;
    }
    switch (this.#phase) {
      case PHASES.AWAIT_BUY: {
        const city = this.#board.cityAt(player.position);
        return { kind: 'BUY', index: city.index, name: city.name, price: city.price };
      }
      case PHASES.AWAIT_BUILD: {
        const city = this.#board.cityAt(this.#turn.buildIndex);
        return {
          kind: 'BUILD',
          index: city.index,
          name: city.name,
          options: this.#buildOptionsOf(city),
          buildings: city.buildings,
          landmark: city.landmark,
        };
      }
      case PHASES.AWAIT_START_BUILD:
        return { kind: 'START_BUILD', candidates: this.#startBuildCandidates(player) };
      case PHASES.AWAIT_ACQUIRE: {
        const city = this.#board.cityAt(this.#turn.acquireIndex);
        return {
          kind: 'ACQUIRE',
          index: city.index,
          name: city.name,
          ownerId: city.ownerId,
          price: city.acquisitionPrice(),
        };
      }
      case PHASES.AWAIT_CASINO:
        return {
          kind: 'CASINO',
          roundsLeft: this.#turn.casinoRoundsLeft,
          limits: this.#casino.betLimits(player.cash),
          jackpot: this.#casino.jackpot,
        };
      case PHASES.AWAIT_ISLAND_CHOICE:
        return {
          kind: 'ISLAND',
          remainingTurns: player.islandRemainingTurns,
          fee: ISLAND_RESCUE_FEE,
          canPayFee: player.canPay(ISLAND_RESCUE_FEE),
        };
      case PHASES.AWAIT_TRAVEL:
        return { kind: 'TRAVEL', forbiddenIndexes: this.#forbiddenTravelIndexes(player) };
      case PHASES.AWAIT_LIQUIDATION: {
        const sellable = this.#board.ownedBy(player.id).map((city) => ({
          index: city.index,
          name: city.name,
          refund: city.liquidationValue(),
        }));
        return {
          kind: 'LIQUIDATION',
          amountDue: this.#debtTotal(),
          creditorId: this.#primaryCreditorId(),
          canSell: sellable.length > 0,
          canLoan: player.canTakeLoan(),
          sellable,
        };
      }
      default:
        return null;
    }
  }

  /** 총자산 순위. 생존자 우선, 그다음 총자산 내림차순. */
  rankings() {
    const scored = this.#players.map((player) => ({
      playerId: player.id,
      name: player.name,
      eliminated: player.eliminated,
      cash: player.cash,
      loanDebt: player.loanDebt,
      totalAssets: player.eliminated
        ? 0
        : player.cash + this.#board.totalAssetValueOf(player.id) - player.loanDebt,
    }));
    // 동점이면 현금이 많은 쪽, 그마저 같으면 좌석 순서(입력 순서)를 따른다 — 항상 같은 결과가 나온다.
    const seatOrder = new Map(this.#players.map((player, order) => [player.id, order]));
    scored.sort((a, b) => {
      if (a.eliminated !== b.eliminated) {
        return a.eliminated ? 1 : -1;
      }
      if (b.totalAssets !== a.totalAssets) {
        return b.totalAssets - a.totalAssets;
      }
      if (b.cash !== a.cash) {
        return b.cash - a.cash;
      }
      return seatOrder.get(a.playerId) - seatOrder.get(b.playerId);
    });
    return scored.map((entry, order) => ({ ...entry, rank: order + 1 }));
  }

  /** 돈의 보존 불변식 점검용 보고. */
  moneyReport() {
    const totalCash = this.#players.reduce((sum, player) => sum + player.cash, 0);
    const actual = totalCash + this.#casino.jackpot;
    const expected = this.#initialTotal + this.#ledger.netFromBank;
    return {
      totalCash,
      jackpot: this.#casino.jackpot,
      initialTotal: this.#initialTotal,
      netFromBank: this.#ledger.netFromBank,
      actual,
      expected,
      balanced: actual === expected,
    };
  }

  // ── 커맨드 ──────────────────────────────────────────────────────────────

  /**
   * 커맨드를 실행한다. 턴 소유권 → 페이즈 → 페이로드 순으로 검증한 뒤 상태를 바꾼다.
   * @param {string} seatId 이미 인증이 끝난 좌석 id
   * @param {string} type COMMAND_TYPES
   * @param {object} payload
   * @returns {object[]} 이번 커맨드가 만든 도메인 이벤트
   */
  execute(seatId, type, payload = {}) {
    const allowedPhases = COMMAND_PHASES[type];
    if (!allowedPhases) {
      throw DomainError.invalidArgument(`알 수 없는 커맨드입니다: ${type}`);
    }
    if (this.isOver()) {
      throw DomainError.invalidPhase('이미 끝난 게임입니다');
    }
    this.#assertTurn(seatId);
    if (!allowedPhases.includes(this.#phase)) {
      throw DomainError.invalidPhase(`${this.#phase} 페이즈에서는 ${type} 커맨드를 쓸 수 없습니다`);
    }

    this.#events = [];
    this.#dispatch(type, payload ?? {});
    this.#version += 1;
    return [...this.#events];
  }

  #dispatch(type, payload) {
    switch (type) {
      case COMMAND_TYPES.ROLL:
        return this.#roll();
      case COMMAND_TYPES.BUY:
        return this.#buy();
      case COMMAND_TYPES.SKIP_BUY:
        return this.#skipBuy();
      case COMMAND_TYPES.BUILD:
        return this.#build(payload);
      case COMMAND_TYPES.SKIP_BUILD:
        return this.#skipBuild();
      case COMMAND_TYPES.START_BUILD:
        return this.#startBuild(payload);
      case COMMAND_TYPES.SKIP_START_BUILD:
        return this.#skipStartBuild();
      case COMMAND_TYPES.ACQUIRE:
        return this.#acquire();
      case COMMAND_TYPES.SKIP_ACQUIRE:
        return this.#skipAcquire();
      case COMMAND_TYPES.CASINO_BET:
        return this.#casinoBet(payload);
      case COMMAND_TYPES.CASINO_LEAVE:
        return this.#casinoLeave();
      case COMMAND_TYPES.ISLAND_PAY:
        return this.#islandPay();
      case COMMAND_TYPES.ISLAND_ROLL:
        return this.#islandRoll();
      case COMMAND_TYPES.TRAVEL:
        return this.#travel(payload);
      case COMMAND_TYPES.SELL:
        return this.#sell(payload);
      case COMMAND_TYPES.AUTO_SELL:
        return this.#autoSell();
      case COMMAND_TYPES.TAKE_LOAN:
        return this.#takeLoan();
      case COMMAND_TYPES.DECLARE_BANKRUPTCY:
        return this.#declareBankruptcy();
      default:
        throw DomainError.invalidArgument(`처리할 수 없는 커맨드입니다: ${type}`);
    }
  }

  #assertTurn(seatId) {
    if (!this.currentPlayerId || this.currentPlayerId !== seatId) {
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
    if (city.isOwned()) {
      throw DomainError.invalidState(`이미 주인이 있는 칸입니다: ${city.name}`);
    }
    if (!player.canPay(city.price)) {
      throw DomainError.insufficientCash(`매입 대금 ${city.price}원이 부족합니다`);
    }
    player.pay(city.price);
    this.#ledger.payToBank(city.price);
    city.buy(player.id);
    this.#emit(EVENT_TYPES.CITY_PURCHASED, {
      playerId: player.id,
      index: city.index,
      name: city.name,
      price: city.price,
    });
    this.#offerBuild(player, city.index);
  }

  #skipBuy() {
    const player = this.#current;
    this.#emit(EVENT_TYPES.PURCHASE_DECLINED, { playerId: player.id, index: player.position });
    this.#endTurn();
  }

  /** 이번 건설 기회에 고를 수 있는 건물과 비용. */
  #buildOptionsOf(city) {
    return city.buildableTypes().map((type) => ({ type, cost: city.buildCost(type) }));
  }

  /** 건설 기회를 열 수 있는지(지을 것이 있고 가장 싼 것을 낼 현금이 있는지). */
  #canOfferBuild(player, city) {
    const options = this.#buildOptionsOf(city);
    return options.length > 0 && player.canPay(Math.min(...options.map((option) => option.cost)));
  }

  /** 건설 기회를 제안한다. 지을 것이 없거나 현금이 없으면 턴을 끝낸다. */
  #offerBuild(player, cityIndex) {
    const city = this.#board.cityAt(cityIndex);
    if (!city.isOwnedBy(player.id) || !this.#canOfferBuild(player, city)) {
      this.#endTurn();
      return;
    }
    this.#turn.buildIndex = cityIndex;
    this.#phase = PHASES.AWAIT_BUILD;
    this.#emit(EVENT_TYPES.BUILD_OFFERED, {
      playerId: player.id,
      index: city.index,
      name: city.name,
      options: this.#buildOptionsOf(city),
    });
  }

  #build({ buildings }) {
    const player = this.#current;
    const city = this.#board.cityAt(this.#turn.buildIndex);
    this.#performBuild(player, city, buildings);
    this.#endTurn();
  }

  #skipBuild() {
    const player = this.#current;
    this.#emit(EVENT_TYPES.BUILD_DECLINED, { playerId: player.id, index: this.#turn.buildIndex });
    this.#endTurn();
  }

  /** 고른 건물 조합을 검증하고 짓는다. */
  #performBuild(player, city, buildings) {
    if (!city.isOwnedBy(player.id)) {
      throw DomainError.invalidArgument(`내 도시가 아닙니다: ${city.index}`);
    }
    city.assertCanBuild(buildings);
    const cost = city.costOf(buildings);
    if (!player.canPay(cost)) {
      throw DomainError.insufficientCash(`건설비 ${cost}원이 부족합니다`);
    }
    player.pay(cost);
    this.#ledger.payToBank(cost);
    city.build(buildings);
    this.#emit(EVENT_TYPES.BUILT, {
      playerId: player.id,
      index: city.index,
      name: city.name,
      buildings: [...buildings],
      cost,
    });
    if (buildings.includes(BUILDING_TYPES.LANDMARK)) {
      this.#emit(EVENT_TYPES.LANDMARK_BUILT, {
        playerId: player.id,
        index: city.index,
        name: city.name,
        cost,
      });
    }
  }

  /** 출발 칸 보너스로 건설할 수 있는 내 도시 목록. */
  #startBuildCandidates(player) {
    return this.#board
      .ownedBy(player.id)
      .filter((city) => this.#canOfferBuild(player, city))
      .map((city) => ({
        index: city.index,
        name: city.name,
        price: city.price,
        options: this.#buildOptionsOf(city),
      }));
  }

  #offerStartBuild(player) {
    const candidates = this.#startBuildCandidates(player);
    if (candidates.length === 0) {
      this.#endTurn();
      return;
    }
    this.#phase = PHASES.AWAIT_START_BUILD;
    this.#emit(EVENT_TYPES.START_BONUS_OFFERED, { playerId: player.id, candidates });
  }

  #startBuild({ cityIndex, buildings }) {
    const player = this.#current;
    if (!Number.isInteger(cityIndex) || !this.#board.isOwnable(cityIndex)) {
      throw DomainError.invalidArgument(`건설할 칸이 올바르지 않습니다: ${cityIndex}`);
    }
    this.#performBuild(player, this.#board.cityAt(cityIndex), buildings);
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
    if (!city.canBeAcquired()) {
      throw DomainError.invalidState(`인수할 수 없는 칸입니다: ${city.name}`);
    }
    const price = city.acquisitionPrice();
    if (!player.canPay(price)) {
      throw DomainError.insufficientCash('인수 대금은 보유 현금으로만 지불할 수 있습니다');
    }
    const owner = this.playerById(city.ownerId);
    player.pay(price);
    if (owner && !owner.eliminated) {
      owner.receive(price);
    } else {
      this.#ledger.payToBank(price);
    }
    city.transferTo(player.id);
    this.#emit(EVENT_TYPES.ACQUIRED, {
      playerId: player.id,
      index: city.index,
      name: city.name,
      fromId: owner?.id ?? null,
      price,
    });
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
    const jackpotBefore = this.#casino.jackpot;
    const result = this.#casino.play({ game, bet, choice }, this.#random);

    player.pay(bet);
    player.receive(result.payout);
    this.#ledger.applyNet(result.payout - bet + result.jackpotAccumulated - result.jackpotWon);

    this.#emit(EVENT_TYPES.CASINO_RESULT, {
      playerId: player.id,
      game: result.game,
      bet: result.bet,
      win: result.win,
      payout: result.payout,
      jackpotWon: result.jackpotWon,
      detail: result.detail,
    });
    if (this.#casino.jackpot !== jackpotBefore) {
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
    player.pay(ISLAND_RESCUE_FEE);
    this.#ledger.payToBank(ISLAND_RESCUE_FEE);
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

  /**
   * 공항 이동권으로 고를 수 없는 칸.
   * 공항 칸 자신과 **지금 서 있는 칸**(0칸 이동은 이동이 아니라 같은 칸 효과의 재발동이다).
   */
  #forbiddenTravelIndexes(player) {
    const airportIndex = this.#board.indexOfKind(SPACE_KINDS.AIRPORT);
    return airportIndex === player.position ? [airportIndex] : [airportIndex, player.position];
  }

  #travel({ destination }) {
    const player = this.#current;
    if (!Number.isInteger(destination) || destination < 0 || destination >= this.#board.size) {
      throw DomainError.invalidArgument(`목적지 칸이 올바르지 않습니다: ${destination}`);
    }
    if (this.#forbiddenTravelIndexes(player).includes(destination)) {
      throw DomainError.invalidArgument(`목적지로 고를 수 없는 칸입니다: ${destination}`);
    }
    player.consumeAirportTicket();
    const from = player.position;
    const steps = this.#board.stepsTo(from, destination);
    this.#emit(EVENT_TYPES.TRAVELED, { playerId: player.id, from, to: destination });
    this.#moveBy(player, steps, 0);
  }

  /**
   * 정리 페이즈 커맨드의 공통 전제: 메워야 할 채무가 실제로 있어야 한다.
   * 스냅샷이 손상되면 AWAIT_LIQUIDATION인데 채무가 비어 있을 수 있는데, 그때
   * 원시 TypeError가 클라이언트 경로까지 올라가면 ERR010(500)이 된다.
   */
  #assertPendingDebt() {
    if (!this.#turn.debt) {
      throw DomainError.invalidState('메워야 할 채무가 없습니다(정리 페이즈 상태가 손상됨)');
    }
  }

  #sell({ cityIndex }) {
    const player = this.#current;
    this.#assertPendingDebt();
    if (!Number.isInteger(cityIndex)) {
      throw DomainError.invalidArgument(`매각할 칸이 올바르지 않습니다: ${cityIndex}`);
    }
    if (!this.#board.isOwnable(cityIndex) || !this.#board.cityAt(cityIndex).isOwnedBy(player.id)) {
      throw DomainError.invalidArgument(`내 소유가 아닌 칸은 매각할 수 없습니다: ${cityIndex}`);
    }
    this.#sellCity(player, this.#board.cityAt(cityIndex));
    this.#afterLiquidationStep();
  }

  // ── 이동과 칸 해석 ──────────────────────────────────────────────────────

  #moveBy(player, steps, depth) {
    const from = player.position;
    const { index, passedStart } = this.#board.advance(from, steps);
    player.moveTo(index);
    this.#emit(EVENT_TYPES.MOVED, { playerId: player.id, from, to: index, steps, passedStart });
    if (passedStart) {
      this.#paySalary(player);
    }
    this.#resolveLanding(player, index, depth);
  }

  /** 월급 지급. 대출 채무가 남아 있으면 먼저 압류된다. */
  #paySalary(player) {
    const { seized, received } = player.seizeSalary(SALARY);
    if (seized > 0) {
      this.#emit(EVENT_TYPES.SALARY_SEIZED, {
        playerId: player.id,
        amount: seized,
        remainingDebt: player.loanDebt,
      });
      if (player.loanDebt === 0) {
        this.#emit(EVENT_TYPES.LOAN_REPAID, { playerId: player.id });
      }
    }
    if (received > 0) {
      this.#ledger.receiveFromBank(received);
      this.#emit(EVENT_TYPES.SALARY_PAID, { playerId: player.id, amount: received });
    }
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

  #applyTicket(player, ticket, depth) {
    const { effect } = ticket;
    switch (effect.type) {
      case TICKET_EFFECTS.GAIN:
        return this.#gainFromBank(player, effect.amount, ticket.id);
      case TICKET_EFFECTS.LOSE:
        return this.#payToBank(player, effect.amount, ticket.id);
      case TICKET_EFFECTS.MOVE_RELATIVE:
        return this.#moveBy(player, effect.steps, depth);
      case TICKET_EFFECTS.MOVE_TO:
        return this.#moveBy(player, this.#board.stepsTo(player.position, effect.index), depth);
      case TICKET_EFFECTS.NEAREST_RESORT:
        return this.#moveBy(
          player,
          this.#board.stepsTo(player.position, this.#board.nearestResortFrom(player.position)),
          depth,
        );
      case TICKET_EFFECTS.TO_ISLAND:
        this.#sendToIsland(player, { teleport: true });
        return this.#endTurn();
      case TICKET_EFFECTS.COLLECT_FROM_ALL:
        return this.#collectFromAll(player, effect.amount, ticket.id);
      case TICKET_EFFECTS.PAY_TO_ALL:
        return this.#payToAll(player, effect.amount, ticket.id);
      case TICKET_EFFECTS.PAY_PER_BUILDING:
        return this.#payToBank(
          player,
          this.#board.buildingCountOf(player.id) * effect.amount,
          ticket.id,
        );
      case TICKET_EFFECTS.GAIN_PER_CITY:
        return this.#gainFromBank(
          player,
          this.#board.cityCountOf(player.id) * effect.amount,
          ticket.id,
        );
      case TICKET_EFFECTS.TAX_RATE:
        return this.#payTicketTax(player, Math.floor(player.cash * effect.rate), ticket.id);
      default:
        return this.#endTurn();
    }
  }

  #gainFromBank(player, amount, ticketId) {
    if (amount > 0) {
      player.receive(amount);
      this.#ledger.receiveFromBank(amount);
      this.#emit(EVENT_TYPES.MONEY_GAINED, {
        playerId: player.id,
        amount,
        reason: MONEY_REASONS.TICKET,
        ticketId,
      });
    }
    this.#endTurn();
  }

  #payToBank(player, amount, ticketId) {
    if (amount <= 0) {
      this.#endTurn();
      return;
    }
    this.#charge({
      items: [{ amount, sink: SINKS.BANK, toPlayerId: null }],
      reason: MONEY_REASONS.TICKET,
      event: {
        type: EVENT_TYPES.MONEY_LOST,
        payload: { playerId: player.id, amount, reason: MONEY_REASONS.TICKET, ticketId },
      },
    });
  }

  #payTicketTax(player, amount, ticketId) {
    if (amount <= 0) {
      this.#endTurn();
      return;
    }
    this.#charge({
      items: [{ amount, sink: SINKS.JACKPOT, toPlayerId: null }],
      reason: MONEY_REASONS.TAX,
      event: {
        type: EVENT_TYPES.TAX_PAID,
        payload: { playerId: player.id, amount, ticketId },
      },
    });
  }

  /**
   * 다른 모든 생존 플레이어에게서 정액을 받는다.
   * 자기 턴이 아닌 플레이어를 정리 페이즈로 보낼 수는 없으므로 보유 현금 한도까지만 받는다.
   */
  #collectFromAll(player, amount, ticketId) {
    let collected = 0;
    for (const other of this.livingPlayers()) {
      if (other.id === player.id) {
        continue;
      }
      const paid = other.pay(Math.min(amount, other.cash));
      collected += paid;
      this.#emit(EVENT_TYPES.MONEY_TRANSFERRED, {
        fromId: other.id,
        toId: player.id,
        amount: paid,
        reason: MONEY_REASONS.TICKET,
        ticketId,
      });
    }
    player.receive(collected);
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

  // ── 지불/정리/파산 ──────────────────────────────────────────────────────

  #debtTotal() {
    return (this.#turn.debt?.items ?? []).reduce((sum, item) => sum + item.amount, 0);
  }

  #primaryCreditorId() {
    return this.#turn.debt?.items.find((item) => item.sink === SINKS.PLAYER)?.toPlayerId ?? null;
  }

  /**
   * 강제 지불. 현금이 부족하면 정리(AWAIT_LIQUIDATION) 페이즈로 들어간다.
   * 현금 부족 자체가 파산은 아니며, 파산은 플레이어가 직접 선언해야 한다.
   */
  #charge({ items, reason, event, next = { kind: CONTINUATIONS.TURN_END } }) {
    const player = this.#current;
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    if (total <= 0) {
      this.#continueAfterPayment(next);
      return;
    }

    this.#turn.debt = { reason, items, event, next };

    if (player.canPay(total)) {
      this.#settleDebt();
      return;
    }

    this.#phase = PHASES.AWAIT_LIQUIDATION;
    this.#emit(EVENT_TYPES.LIQUIDATION_REQUIRED, {
      playerId: player.id,
      amountDue: total,
      creditorId: this.#primaryCreditorId(),
      reason,
    });
  }

  /** 지불이 끝난 뒤 흐름을 이어간다. */
  #continueAfterPayment(next) {
    if (next?.kind === CONTINUATIONS.ACQUIRE) {
      this.#offerAcquire(this.#current, next.cityIndex);
      return;
    }
    this.#endTurn();
  }

  #settleDebt() {
    const player = this.#current;
    const { items, event } = this.#turn.debt;
    const wasLiquidation = this.#phase === PHASES.AWAIT_LIQUIDATION;
    let jackpotChanged = false;

    for (const item of items) {
      player.pay(item.amount);
      if (item.sink === SINKS.PLAYER) {
        const creditor = this.playerById(item.toPlayerId);
        if (creditor && !creditor.eliminated) {
          creditor.receive(item.amount);
        } else {
          this.#ledger.payToBank(item.amount);
        }
      } else if (item.sink === SINKS.JACKPOT) {
        this.#casino.accumulate(item.amount);
        jackpotChanged = true;
      } else {
        this.#ledger.payToBank(item.amount);
      }
    }

    this.#emit(event.type, event.payload);
    if (jackpotChanged) {
      this.#emit(EVENT_TYPES.JACKPOT_CHANGED, { jackpot: this.#casino.jackpot });
    }
    if (wasLiquidation) {
      this.#emit(EVENT_TYPES.DEBT_SETTLED, {
        playerId: player.id,
        amount: items.reduce((sum, item) => sum + item.amount, 0),
      });
    }
    // 인수는 "보유 현금으로만" 가능하다(명세 4장). 정리 페이즈를 거쳐 매각·대출로 돈을
    // 마련한 통행료였다면 그 돈으로 인수하는 셈이 되므로, 제안 없이 턴을 끝낸다.
    const next = wasLiquidation ? { kind: CONTINUATIONS.TURN_END } : this.#turn.debt.next;
    this.#turn.debt = null;
    this.#continueAfterPayment(next);
  }

  /** 정리 페이즈에서 한 걸음 진행한 뒤, 채무를 덮을 수 있으면 자동 정산한다. */
  #afterLiquidationStep() {
    if (this.#current.canPay(this.#debtTotal())) {
      this.#settleDebt();
    }
  }

  #sellCity(player, city) {
    const refund = city.liquidationValue();
    const index = city.index;
    const name = city.name;
    city.reset();
    player.receive(refund);
    this.#ledger.receiveFromBank(refund);
    this.#emit(EVENT_TYPES.PROPERTY_SOLD, { playerId: player.id, index, name, refund });
  }

  #autoSell() {
    const player = this.#current;
    this.#assertPendingDebt();
    const owned = this.#board
      .ownedBy(player.id)
      .sort((a, b) => a.liquidationValue() - b.liquidationValue() || a.index - b.index);
    if (owned.length === 0) {
      throw DomainError.invalidState('매각할 자산이 없습니다');
    }
    const amountDue = this.#debtTotal();
    for (const city of owned) {
      if (player.canPay(amountDue)) {
        break;
      }
      this.#sellCity(player, city);
    }
    this.#afterLiquidationStep();
  }

  #takeLoan() {
    const player = this.#current;
    this.#assertPendingDebt();
    if (!player.canTakeLoan()) {
      throw DomainError.invalidState('대출은 게임당 한 번만 받을 수 있습니다');
    }
    player.takeLoan(LOAN_PRINCIPAL, LOAN_DEBT);
    this.#ledger.receiveFromBank(LOAN_PRINCIPAL);
    this.#emit(EVENT_TYPES.LOAN_TAKEN, {
      playerId: player.id,
      principal: LOAN_PRINCIPAL,
      debt: LOAN_DEBT,
    });
    this.#afterLiquidationStep();
  }

  #declareBankruptcy() {
    this.#assertPendingDebt();
    this.#bankrupt(this.#current);
  }

  /**
   * 파산 시 남은 현금을 받을 살아 있는 채권자들(좌석 순서).
   * `PAY_TO_ALL`처럼 채권자가 여러 명일 수 있으므로 목록으로 다룬다.
   */
  #bankruptcyCreditors(debt) {
    const ids = new Set(
      (debt?.items ?? [])
        .filter((item) => item.sink === SINKS.PLAYER && item.toPlayerId)
        .map((item) => item.toPlayerId),
    );
    return this.#players.filter((candidate) => ids.has(candidate.id) && !candidate.eliminated);
  }

  /** 파산: 남은 현금을 채권자에게 넘기고 모든 자산을 초기화한 뒤 탈락한다. */
  #bankrupt(player) {
    const debt = this.#turn.debt;
    const toJackpot = Boolean(debt?.items.some((item) => item.sink === SINKS.JACKPOT));
    const creditors = this.#bankruptcyCreditors(debt);
    const creditorId = creditors[0]?.id ?? null;
    const remaining = player.cash;

    if (remaining > 0) {
      player.pay(remaining);
      if (creditors.length > 0) {
        this.#splitAmongCreditors(player, creditors, remaining);
      } else if (toJackpot) {
        this.#casino.accumulate(remaining);
        this.#emit(EVENT_TYPES.JACKPOT_CHANGED, { jackpot: this.#casino.jackpot });
      } else {
        this.#ledger.payToBank(remaining);
      }
    }
    const releasedIndexes = this.#board.releaseAllOf(player.id);
    player.eliminate();
    this.#turn.debt = null;
    this.#phase = PHASES.AWAIT_ROLL;
    this.#emit(EVENT_TYPES.BANKRUPT, {
      playerId: player.id,
      creditorId,
      paidAmount: remaining,
      releasedIndexes,
    });

    if (this.#checkGameOver()) {
      return;
    }
    this.#endTurn({ allowExtra: false });
  }

  /**
   * 남은 현금을 채권자들에게 고르게(내림) 나누고, 나머지는 좌석 순서가 앞선 채권자에게 준다.
   * 나눠 준 합계는 항상 남은 현금과 정확히 같아야 한다(돈의 보존 불변식).
   */
  #splitAmongCreditors(player, creditors, remaining) {
    const share = Math.floor(remaining / creditors.length);
    let leftover = remaining - share * creditors.length;
    for (const creditor of creditors) {
      const amount = share + (leftover > 0 ? 1 : 0);
      leftover = Math.max(0, leftover - 1);
      if (amount <= 0) {
        continue;
      }
      creditor.receive(amount);
      this.#emit(EVENT_TYPES.MONEY_TRANSFERRED, {
        fromId: player.id,
        toId: creditor.id,
        amount,
        reason: MONEY_REASONS.BANKRUPTCY,
      });
    }
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

  #advanceTurn() {
    const size = this.#players.length;
    let wrapped = false;
    let found = false;

    for (let step = 1; step <= size; step += 1) {
      const raw = this.#turnIndex + step;
      const candidate = raw % size;
      if (!this.#players[candidate].eliminated) {
        wrapped = raw >= size;
        this.#turnIndex = candidate;
        found = true;
        break;
      }
    }

    if (!found) {
      this.#gameOver(GAME_OVER_REASONS.LAST_SURVIVOR);
      return;
    }

    if (wrapped) {
      this.#round += 1;
      this.#emit(EVENT_TYPES.ROUND_ADVANCED, { round: this.#round });
      const limit = this.#options.roundLimit;
      if (limit && this.#round > limit) {
        this.#gameOver(GAME_OVER_REASONS.ROUND_LIMIT);
        return;
      }
    }

    this.#beginTurn();
  }

  #beginTurn() {
    const player = this.#current;
    // 이전 턴의 흔적(건설/인수 대상 칸까지)을 남기지 않는다.
    this.#turn = { ...EMPTY_TURN };
    player.resetDoubles();
    this.#emit(EVENT_TYPES.TURN_STARTED, { playerId: player.id, round: this.#round });

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

  // ── 영속화 ──────────────────────────────────────────────────────────────

  toSnapshot() {
    return {
      version: this.#version,
      phase: this.#phase,
      turnIndex: this.#turnIndex,
      round: this.#round,
      options: { roundLimit: this.#options.roundLimit },
      initialTotal: this.#initialTotal,
      players: this.#players.map((player) => player.toSnapshot()),
      board: this.#board.toSnapshot(),
      deck: this.#deck.toSnapshot(),
      casino: { jackpot: this.#casino.jackpot },
      ledger: this.#ledger.toSnapshot(),
      turn: {
        rollWasDouble: this.#turn.rollWasDouble,
        casinoRoundsLeft: this.#turn.casinoRoundsLeft,
        debt: this.#turn.debt ? JSON.parse(JSON.stringify(this.#turn.debt)) : null,
        buildIndex: this.#turn.buildIndex,
        acquireIndex: this.#turn.acquireIndex,
      },
    };
  }
}
