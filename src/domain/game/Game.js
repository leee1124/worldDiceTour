import { DomainError } from '../shared/DomainError.js';
import { BankLedger } from './BankLedger.js';
import { Board } from './Board.js';
import { Casino } from './Casino.js';
import { Dice } from './Dice.js';
import {
  ISLAND_RESCUE_FEE,
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
/** 한 커맨드 안에서 티켓이 연쇄될 수 있는 최대 횟수(무한 루프 방지). */
const MAX_TICKET_CHAIN = 3;
/** 돈이 향하는 곳. */
const SINKS = Object.freeze({ PLAYER: 'PLAYER', BANK: 'BANK', JACKPOT: 'JACKPOT' });

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
    turn = { rollWasDouble: false, casinoRoundsLeft: 0, debt: null },
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

  /** 스냅샷에서 복원한다. */
  static restore(snapshot, random) {
    if (!snapshot || !Array.isArray(snapshot.players)) {
      throw DomainError.invalidArgument('게임 스냅샷 구조가 올바르지 않습니다');
    }
    const players = snapshot.players.map((player) => new Player({ ...player }));
    return new Game({
      board: Board.restore(snapshot.board ?? []),
      players,
      deck: TicketDeck.restore(snapshot.deck ?? {}),
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
      turn: snapshot.turn ?? { rollWasDouble: false, casinoRoundsLeft: 0, debt: null },
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
        const city = this.#board.cityAt(player.position);
        return {
          kind: 'BUILD',
          index: city.index,
          name: city.name,
          cost: city.upgradeCost(),
          currentLevel: city.level,
          nextLevel: city.level + 1,
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
        return { kind: 'TRAVEL', forbiddenIndexes: [this.#board.indexOfKind(SPACE_KINDS.AIRPORT)] };
      case PHASES.AWAIT_LIQUIDATION:
        return {
          kind: 'LIQUIDATION',
          debt: this.#debtTotal(),
          creditorId: this.#turn.debt?.items.find((item) => item.sink === SINKS.PLAYER)?.toPlayerId ?? null,
          sellable: this.#board.ownedBy(player.id).map((city) => ({
            index: city.index,
            name: city.name,
            refund: city.liquidationValue(),
          })),
        };
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
      totalAssets: player.eliminated ? 0 : player.cash + this.#board.totalAssetValueOf(player.id),
    }));
    scored.sort((a, b) => {
      if (a.eliminated !== b.eliminated) {
        return a.eliminated ? 1 : -1;
      }
      return b.totalAssets - a.totalAssets;
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
        return this.#build();
      case COMMAND_TYPES.SKIP_BUILD:
        return this.#skipBuild();
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
    this.#endTurn();
  }

  #skipBuy() {
    const player = this.#current;
    this.#emit(EVENT_TYPES.PURCHASE_DECLINED, { playerId: player.id, index: player.position });
    this.#endTurn();
  }

  #build() {
    const player = this.#current;
    const city = this.#board.cityAt(player.position);
    if (!city.isOwnedBy(player.id)) {
      throw DomainError.invalidState('내 도시에서만 건설할 수 있습니다');
    }
    if (!city.canUpgrade()) {
      throw DomainError.invalidState(`더 건설할 수 없습니다: ${city.name}`);
    }
    const cost = city.upgradeCost();
    if (!player.canPay(cost)) {
      throw DomainError.insufficientCash(`건설비 ${cost}원이 부족합니다`);
    }
    player.pay(cost);
    this.#ledger.payToBank(cost);
    city.upgrade();
    this.#emit(EVENT_TYPES.CITY_UPGRADED, {
      playerId: player.id,
      index: city.index,
      name: city.name,
      level: city.level,
      cost,
    });
    this.#endTurn();
  }

  #skipBuild() {
    const player = this.#current;
    this.#emit(EVENT_TYPES.BUILD_DECLINED, { playerId: player.id, index: player.position });
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

  #travel({ destination }) {
    const player = this.#current;
    if (!Number.isInteger(destination) || destination < 0 || destination >= this.#board.size) {
      throw DomainError.invalidArgument(`목적지 칸이 올바르지 않습니다: ${destination}`);
    }
    if (destination === this.#board.indexOfKind(SPACE_KINDS.AIRPORT)) {
      throw DomainError.invalidArgument('공항 칸은 목적지로 고를 수 없습니다');
    }
    player.consumeAirportTicket();
    const from = player.position;
    const steps = this.#board.stepsTo(from, destination);
    this.#emit(EVENT_TYPES.TRAVELED, { playerId: player.id, from, to: destination });
    this.#moveBy(player, steps, 0);
  }

  #sell({ cityIndex }) {
    const player = this.#current;
    if (!Number.isInteger(cityIndex) || !this.#turn.debt) {
      throw DomainError.invalidArgument(`매각할 칸이 올바르지 않습니다: ${cityIndex}`);
    }
    if (!this.#board.isOwnable(cityIndex) || !this.#board.cityAt(cityIndex).isOwnedBy(player.id)) {
      throw DomainError.invalidArgument(`내 소유가 아닌 칸은 매각할 수 없습니다: ${cityIndex}`);
    }
    const city = this.#board.cityAt(cityIndex);
    const refund = city.liquidationValue();
    city.reset();
    player.receive(refund);
    this.#ledger.receiveFromBank(refund);
    this.#emit(EVENT_TYPES.ASSET_SOLD, {
      playerId: player.id,
      index: city.index,
      name: city.name,
      refund,
    });

    const total = this.#debtTotal();
    if (player.canPay(total)) {
      this.#settleDebt();
      return;
    }
    if (this.#board.ownedBy(player.id).length === 0) {
      this.#bankrupt(player, this.#primaryCreditorId());
    }
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

  #paySalary(player) {
    player.receive(SALARY);
    this.#ledger.receiveFromBank(SALARY);
    this.#emit(EVENT_TYPES.SALARY_PAID, { playerId: player.id, amount: SALARY });
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
        return this.#endTurn();
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
      if (city.canUpgrade() && player.canPay(city.upgradeCost())) {
        this.#phase = PHASES.AWAIT_BUILD;
        return;
      }
      this.#endTurn();
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
          this.#board.buildingLevelSumOf(player.id) * effect.amount,
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
   * 강제 지불. 현금이 부족하면 정리 페이즈로, 매각해도 부족하면 즉시 파산으로 이어진다.
   */
  #charge({ items, reason, event }) {
    const player = this.#current;
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    if (total <= 0) {
      this.#endTurn();
      return;
    }

    this.#turn.debt = { reason, items, event };

    if (player.canPay(total)) {
      this.#settleDebt();
      return;
    }

    const raisable = this.#board
      .ownedBy(player.id)
      .reduce((sum, city) => sum + city.liquidationValue(), 0);
    if (player.cash + raisable < total) {
      this.#bankrupt(player, this.#primaryCreditorId());
      return;
    }

    this.#phase = PHASES.AWAIT_LIQUIDATION;
    this.#emit(EVENT_TYPES.LIQUIDATION_REQUIRED, {
      playerId: player.id,
      debt: total,
      creditorId: this.#primaryCreditorId(),
      reason,
    });
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
    this.#turn.debt = null;
    this.#endTurn();
  }

  #bankrupt(player, creditorId) {
    const remaining = player.cash;
    if (remaining > 0) {
      player.pay(remaining);
      const creditor = creditorId ? this.playerById(creditorId) : null;
      if (creditor && !creditor.eliminated) {
        creditor.receive(remaining);
        this.#emit(EVENT_TYPES.MONEY_TRANSFERRED, {
          fromId: player.id,
          toId: creditor.id,
          amount: remaining,
          reason: MONEY_REASONS.BANKRUPTCY,
        });
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
      creditorId: creditorId ?? null,
      paidAmount: remaining,
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
    this.#turn = { rollWasDouble: false, casinoRoundsLeft: 0, debt: null };
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
        debt: this.#turn.debt ? structuredClone(this.#turn.debt) : null,
      },
    };
  }
}
