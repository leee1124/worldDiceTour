import { DomainError } from '../shared/DomainError.js';
import { SPACE_KINDS } from './data/board.js';

/** 도시 건물 단계별 통행료 배율(땅만/Lv1/Lv2/Lv3). */
const CITY_TOLL_MULTIPLIERS = Object.freeze([0.1, 0.5, 1.2, 2.5]);
/** 도시 최대 건물 단계(Lv3 랜드마크). */
const MAX_LEVEL = 3;
/** 건설비 = 가격 × 0.5. */
const BUILD_COST_RATE = 0.5;
/** 정리(매각) 환급률. */
const LIQUIDATION_RATE = 0.5;
/** 휴양지 1개당 통행료 단가. */
const RESORT_TOLL_UNIT = 50_000;

/**
 * 소유 가능한 칸(도시/휴양지). 소유·건설·통행료·매각 규칙을 스스로 판단한다.
 */
export class City {
  #index;
  #name;
  #kind;
  #price;
  #ownerId;
  #level;

  constructor({ index, name, kind, price, ownerId = null, level = 0 }) {
    this.#index = index;
    this.#name = name;
    this.#kind = kind;
    this.#price = price;
    this.#ownerId = ownerId;
    this.#level = level;
  }

  get index() {
    return this.#index;
  }

  get name() {
    return this.#name;
  }

  get kind() {
    return this.#kind;
  }

  get price() {
    return this.#price;
  }

  get ownerId() {
    return this.#ownerId;
  }

  get level() {
    return this.#level;
  }

  get isResort() {
    return this.#kind === SPACE_KINDS.RESORT;
  }

  isOwned() {
    return this.#ownerId !== null;
  }

  isOwnedBy(playerId) {
    return this.#ownerId !== null && this.#ownerId === playerId;
  }

  buy(playerId) {
    if (this.isOwned()) {
      throw DomainError.invalidState(`이미 주인이 있는 칸입니다: ${this.#name}`);
    }
    this.#ownerId = playerId;
    this.#level = 0;
  }

  /** 단계당 건설비. */
  upgradeCost() {
    return Math.floor(this.#price * BUILD_COST_RATE);
  }

  canUpgrade() {
    return this.isOwned() && !this.isResort && this.#level < MAX_LEVEL;
  }

  upgrade() {
    if (!this.canUpgrade()) {
      throw DomainError.invalidState(`건설할 수 없는 칸입니다: ${this.#name}`);
    }
    this.#level += 1;
    return this.upgradeCost();
  }

  /** 누적 건설비. */
  buildCostTotal() {
    return this.upgradeCost() * this.#level;
  }

  /**
   * 통행료. 휴양지는 소유자가 가진 휴양지 수에 비례한다.
   * @param {{resortCount:number}} context 소유자의 휴양지 보유 수
   */
  tollFor({ resortCount = 0 } = {}) {
    if (!this.isOwned()) {
      return 0;
    }
    if (this.isResort) {
      return RESORT_TOLL_UNIT * resortCount;
    }
    return Math.floor(this.#price * CITY_TOLL_MULTIPLIERS[this.#level]);
  }

  /** 은행 매각 환급액. */
  liquidationValue() {
    if (!this.isOwned()) {
      return 0;
    }
    return Math.floor((this.#price + this.buildCostTotal()) * LIQUIDATION_RATE);
  }

  /** 총자산 계산용 가치(매입가 + 누적 건설비). */
  assetValue() {
    if (!this.isOwned()) {
      return 0;
    }
    return this.#price + this.buildCostTotal();
  }

  reset() {
    this.#ownerId = null;
    this.#level = 0;
  }

  /** 영속화용 스냅샷(가격/이름 등 정적 데이터는 보드 정의에서 복원). */
  toSnapshot() {
    return { index: this.#index, ownerId: this.#ownerId, level: this.#level };
  }
}
