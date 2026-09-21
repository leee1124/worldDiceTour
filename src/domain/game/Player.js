import { DomainError } from '../shared/DomainError.js';
import { assertAmount } from '../shared/Money.js';

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
 * 플레이어. 현금 잔액과 자신의 상태(위치/조난/공항 이동권/연속 더블)를 스스로 관리한다.
 *
 * `pay()`/`receive()`는 **`Treasury`만 호출한다.** 현금 이동의 상대(은행·잭팟·다른 좌석)를
 * 알아야 장부와 보존 불변식이 맞는데, 플레이어는 그것을 모르기 때문이다.
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

  canTakeLoan() {
    return !this.#loanUsed;
  }

  /**
   * 대출 채무를 진다(게임당 1회).
   * 현금 입금은 하지 않는다 — 원금은 은행에서 오는 돈이므로 `Treasury`가 옮긴다.
   * @returns {{principal:number, debt:number}} 은행이 내줘야 할 원금과 새로 생긴 채무
   */
  takeLoan(principal, debt) {
    if (!this.canTakeLoan()) {
      throw DomainError.invalidState('대출은 게임당 한 번만 받을 수 있습니다');
    }
    this.#assertAmount(principal);
    this.#assertAmount(debt);
    this.#loanUsed = true;
    this.#loanDebt = debt;
    return { principal, debt };
  }

  /**
   * 월급에서 대출 채무 상환분을 압류한다.
   * 현금 입금은 하지 않는다 — 실제 수령액(`received`)은 `Treasury`가 은행에서 옮긴다.
   * @returns {{seized:number, received:number}} 압류된 금액과 손에 남는 금액
   */
  seizeSalary(amount) {
    this.#assertAmount(amount);
    const seized = Math.min(this.#loanDebt, amount);
    this.#loanDebt -= seized;
    return { seized, received: amount - seized };
  }

  #assertAmount(amount) {
    return assertAmount(amount);
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
    };
  }
}
