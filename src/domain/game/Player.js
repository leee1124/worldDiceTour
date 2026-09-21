import { DomainError } from '../shared/DomainError.js';
import { BuildingUnlocks, FIRST_LAP } from './buildings.js';

/** 시작 자금. */
export const STARTING_CASH = 3_000_000;
/** 출발 칸 통과/도착 시 월급. */
export const SALARY = 200_000;
/** 조난 섬에 갇히는 최대 턴 수. */
export const ISLAND_TURNS = 3;
/** 조난 섬 구조비. */
export const ISLAND_RESCUE_FEE = 200_000;
/** 3연속 더블이면 조난. */
export const MAX_CONSECUTIVE_DOUBLES = 3;
/** 대출 원금(게임당 1회). */
export const LOAN_PRINCIPAL = 1_000_000;
/** 대출 채무(원금 + 이자). 월급으로 상환한다. */
export const LOAN_DEBT = 1_200_000;

/**
 * 플레이어. 현금 입출과 자신의 상태(위치/조난/공항 이동권/연속 더블/바퀴 수)를 스스로 관리한다.
 */
export class Player {
  #id;
  #name;
  #cash;
  #position;
  #eliminated;
  #islandRemainingTurns;
  #airportPending;
  #consecutiveDoubles;
  #loanUsed;
  #loanDebt;
  #lap;

  constructor({
    id,
    name,
    cash = STARTING_CASH,
    position = 0,
    eliminated = false,
    islandRemainingTurns = 0,
    airportPending = false,
    consecutiveDoubles = 0,
    loanUsed = false,
    loanDebt = 0,
    lap = FIRST_LAP,
  }) {
    this.#id = id;
    this.#name = name;
    this.#cash = cash;
    this.#position = position;
    this.#eliminated = eliminated;
    this.#islandRemainingTurns = islandRemainingTurns;
    this.#airportPending = airportPending;
    this.#consecutiveDoubles = consecutiveDoubles;
    this.#loanUsed = loanUsed;
    this.#loanDebt = loanDebt;
    // 바퀴 수가 없는 예전 스냅샷은 1바퀴로 복원된다(명세 10장 D24).
    this.#lap = BuildingUnlocks.assertLap(lap);
  }

  get id() {
    return this.#id;
  }

  get name() {
    return this.#name;
  }

  get cash() {
    return this.#cash;
  }

  get position() {
    return this.#position;
  }

  get eliminated() {
    return this.#eliminated;
  }

  get islandRemainingTurns() {
    return this.#islandRemainingTurns;
  }

  get airportPending() {
    return this.#airportPending;
  }

  get consecutiveDoubles() {
    return this.#consecutiveDoubles;
  }

  get loanUsed() {
    return this.#loanUsed;
  }

  get loanDebt() {
    return this.#loanDebt;
  }

  /** 지금 몇 바퀴째인지(1부터). 지을 수 있는 건물이 여기서 결정된다. */
  get lap() {
    return this.#lap;
  }

  /** 출발 칸을 앞으로 지나거나 도착해 월급을 받는 순간 한 바퀴를 마친다. */
  advanceLap() {
    this.#lap += 1;
    return this.#lap;
  }

  canTakeLoan() {
    return !this.#loanUsed;
  }

  /** 은행에서 원금을 받고 채무를 진다(게임당 1회). */
  takeLoan(principal, debt) {
    if (!this.canTakeLoan()) {
      throw DomainError.invalidState('대출은 게임당 한 번만 받을 수 있습니다');
    }
    this.#loanUsed = true;
    this.#loanDebt = debt;
    this.receive(principal);
    return { principal, debt };
  }

  /**
   * 월급을 받는다. 대출 채무가 남아 있으면 채무 상환에 먼저 압류된다.
   * @returns {{seized:number, received:number}}
   */
  seizeSalary(amount) {
    this.#assertAmount(amount);
    const seized = Math.min(this.#loanDebt, amount);
    this.#loanDebt -= seized;
    const received = amount - seized;
    if (received > 0) {
      this.receive(received);
    }
    return { seized, received };
  }

  #assertAmount(amount) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw DomainError.invalidArgument(`금액이 올바르지 않습니다: ${amount}`);
    }
  }

  canPay(amount) {
    return this.#cash >= amount;
  }

  pay(amount) {
    this.#assertAmount(amount);
    if (!this.canPay(amount)) {
      throw DomainError.insufficientCash(`현금 ${this.#cash}원으로 ${amount}원을 지불할 수 없습니다`);
    }
    this.#cash -= amount;
    return amount;
  }

  receive(amount) {
    this.#assertAmount(amount);
    this.#cash += amount;
    return amount;
  }

  moveTo(index) {
    this.#position = index;
  }

  strand(turns = ISLAND_TURNS) {
    this.#islandRemainingTurns = turns;
  }

  isStranded() {
    return this.#islandRemainingTurns > 0;
  }

  /** 탈출 실패 턴 소모. */
  spendIslandTurn() {
    if (this.#islandRemainingTurns > 0) {
      this.#islandRemainingTurns -= 1;
    }
    return this.#islandRemainingTurns;
  }

  leaveIsland() {
    this.#islandRemainingTurns = 0;
  }

  grantAirportTicket() {
    this.#airportPending = true;
  }

  consumeAirportTicket() {
    this.#airportPending = false;
  }

  recordDouble() {
    this.#consecutiveDoubles += 1;
    return this.#consecutiveDoubles;
  }

  resetDoubles() {
    this.#consecutiveDoubles = 0;
  }

  eliminate() {
    this.#eliminated = true;
    this.#cash = 0;
  }

  toSnapshot() {
    return {
      id: this.#id,
      name: this.#name,
      cash: this.#cash,
      position: this.#position,
      eliminated: this.#eliminated,
      islandRemainingTurns: this.#islandRemainingTurns,
      airportPending: this.#airportPending,
      consecutiveDoubles: this.#consecutiveDoubles,
      loanUsed: this.#loanUsed,
      loanDebt: this.#loanDebt,
      lap: this.#lap,
    };
  }
}
