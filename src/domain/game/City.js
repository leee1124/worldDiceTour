import { DomainError } from '../shared/DomainError.js';
import { BASIC_BUILDINGS, BUILDING_TYPES, BuildingUnlocks } from './buildings.js';
import { SPACE_KINDS } from './data/board.js';

// 건물 종류와 바퀴별 해금 규칙은 buildings.js가 갖는다. 기존 사용처를 위해 그대로 다시 내보낸다.
// (새 코드는 `./buildings.js`에서 직접 가져올 것 — 이 재수출은 하위호환용이다.)
export { BASIC_BUILDINGS, BUILDING_TYPES };

/** 건설비 = 가격 × (10분의 n). 별장 0.3 / 빌딩 0.6 / 호텔 0.9 / 랜드마크 1.0 */
const BUILD_COST_TENTHS = Object.freeze({
  [BUILDING_TYPES.VILLA]: 3,
  [BUILDING_TYPES.BUILDING]: 6,
  [BUILDING_TYPES.HOTEL]: 9,
  [BUILDING_TYPES.LANDMARK]: 10,
});

/** 통행료 배율(10분의 n). 땅만 0.1에 건물별 배율을 더하고, 랜드마크는 3.5 고정. */
const LAND_TOLL_TENTHS = 1;
const TOLL_TENTHS = Object.freeze({
  [BUILDING_TYPES.VILLA]: 3,
  [BUILDING_TYPES.BUILDING]: 6,
  [BUILDING_TYPES.HOTEL]: 10,
});
const LANDMARK_TOLL_TENTHS = 35;

/** 인수 가격 = 투자액 × 2. */
const ACQUISITION_MULTIPLIER = 2;
/** 매각 환급 = 투자액 × 0.5. */
const LIQUIDATION_RATE = 0.5;
/** 휴양지 1개당 통행료 단가. */
const RESORT_TOLL_UNIT = 50_000;

/**
 * 소유 가능한 칸(도시/휴양지).
 * 소유·건설 기회·통행료·투자액·매각·인수 규칙을 스스로 판단한다.
 */
export class City {
  #index;
  #name;
  #kind;
  #price;
  #ownerId;
  /** @type {Set<string>} */
  #buildings;
  #landmark;

  constructor({ index, name, kind, price, ownerId = null, buildings = [], landmark = false }) {
    this.#index = index;
    this.#name = name;
    this.#kind = kind;
    this.#price = price;
    this.#ownerId = ownerId;
    this.#buildings = new Set(buildings.filter((type) => BASIC_BUILDINGS.includes(type)));
    this.#landmark = Boolean(landmark);
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

  /** 지어진 독립 건물 목록(정해진 순서). */
  get buildings() {
    return BASIC_BUILDINGS.filter((type) => this.#buildings.has(type));
  }

  get landmark() {
    return this.#landmark;
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
    this.#buildings = new Set();
    this.#landmark = false;
  }

  /** 인수: 건물을 그대로 유지한 채 주인만 바뀐다. */
  transferTo(playerId) {
    if (!this.isOwned()) {
      throw DomainError.invalidState(`주인이 없는 칸은 인수할 수 없습니다: ${this.#name}`);
    }
    this.#ownerId = playerId;
  }

  hasBuilding(type) {
    return type === BUILDING_TYPES.LANDMARK ? this.#landmark : this.#buildings.has(type);
  }

  hasAllBasicBuildings() {
    return BASIC_BUILDINGS.every((type) => this.#buildings.has(type));
  }

  buildCost(type) {
    const tenths = BUILD_COST_TENTHS[type];
    if (!tenths) {
      throw DomainError.invalidArgument(`알 수 없는 건물입니다: ${type}`);
    }
    return Math.floor((this.#price * tenths) / 10);
  }

  costOf(types) {
    return types.reduce((sum, type) => sum + this.buildCost(type), 0);
  }

  /**
   * 이번 건설 기회에 지을 수 있는 건물 목록.
   * 건설자의 바퀴 수에 따라 열린 건물만 제안한다(1바퀴 별장 / 2바퀴 빌딩 / 3바퀴부터 호텔).
   * 3종을 이미 모두 가진 경우에만 랜드마크를 제안한다(같은 기회에 3종+랜드마크는 불가).
   * 랜드마크는 바퀴로 막지 않는다 — 인수로 넘겨받은 건물이 섞여 3종이 채워지면 바퀴와 무관하게 제안된다(D23).
   * @param {{lap:number}} builder 건설자의 바퀴 수(빠뜨리면 규칙 우회가 되므로 필수)
   */
  buildableTypes({ lap } = {}) {
    BuildingUnlocks.assertLap(lap);
    if (!this.isOwned() || this.isResort || this.#landmark) {
      return [];
    }
    if (this.hasAllBasicBuildings()) {
      return [BUILDING_TYPES.LANDMARK];
    }
    return BuildingUnlocks.unlockedTypes(lap).filter((type) => !this.#buildings.has(type));
  }

  /**
   * 아직 바퀴가 모자라 지을 수 없는 건물 목록(화면에 "2바퀴부터"를 보여 주기 위한 정보).
   * @param {{lap:number}} builder
   */
  lockedTypes({ lap } = {}) {
    BuildingUnlocks.assertLap(lap);
    if (!this.isOwned() || this.isResort || this.#landmark || this.hasAllBasicBuildings()) {
      return [];
    }
    return BuildingUnlocks.lockedTypes(lap).filter((type) => !this.#buildings.has(type));
  }

  /** 이번 건설 기회에 고를 수 있는 건물과 비용. */
  /**
   * 이번 건설 기회의 선택지.
   *
   * `options`는 **지금 고를 수 있는** 건물, `lockedOptions`는 아직 바퀴가 모자라 고를 수 없는
   * 건물이다(화면에 "2바퀴부터"를 보여 주기 위한 정보이며 커맨드로는 고를 수 없다).
   * 각 항목은 `locked`와 `unlockLap`을 함께 담아, 클라이언트가 규칙을 다시 구현하지 않아도 되게 한다.
   *
   * @param {{lap:number}} builder 건설자의 바퀴 수(빠뜨리면 규칙 우회가 되므로 필수)
   */
  buildOffer({ lap } = {}) {
    const describe = (type, locked) => ({
      type,
      cost: this.buildCost(type),
      locked,
      unlockLap: BuildingUnlocks.unlockLapOf(type),
    });
    return {
      options: this.buildableTypes({ lap }).map((type) => describe(type, false)),
      lockedOptions: this.lockedTypes({ lap }).map((type) => describe(type, true)),
    };
  }

  /**
   * 그 바퀴에 지을 것이 있고 가장 싼 것을 낼 현금이 있는지.
   * 잠긴 건물은 세지 않는다 — 열리지 않은 건물 때문에 빈 건설 기회를 열지 않기 위해서다.
   */
  canOfferBuildWith(cash, { lap } = {}) {
    const { options } = this.buildOffer({ lap });
    return options.length > 0 && cash >= Math.min(...options.map((option) => option.cost));
  }

  /** 건설 가능 여부만 검증한다(상태 변경 없음). */
  assertCanBuild(types, { lap } = {}) {
    BuildingUnlocks.assertLap(lap);
    if (!Array.isArray(types) || types.length === 0) {
      throw DomainError.invalidArgument('지을 건물을 하나 이상 골라야 합니다');
    }
    if (new Set(types).size !== types.length) {
      throw DomainError.invalidArgument('같은 건물을 중복으로 지을 수 없습니다');
    }
    const options = this.buildableTypes({ lap });
    const locked = this.lockedTypes({ lap });
    for (const type of types) {
      if (locked.includes(type)) {
        throw DomainError.invalidArgument(
          `${BuildingUnlocks.unlockLapOf(type)}바퀴부터 지을 수 있는 건물입니다: ${type}`,
        );
      }
      if (!options.includes(type)) {
        throw DomainError.invalidArgument(`지금 지을 수 없는 건물입니다: ${type}`);
      }
    }
  }

  /** 고른 건물들을 한 번에 짓고 합계 건설비를 돌려준다. */
  build(types, { lap } = {}) {
    this.assertCanBuild(types, { lap });
    const cost = this.costOf(types);
    for (const type of types) {
      if (type === BUILDING_TYPES.LANDMARK) {
        this.#landmark = true;
      } else {
        this.#buildings.add(type);
      }
    }
    return cost;
  }

  /**
   * 통행료. 휴양지는 소유자가 가진 휴양지 수에 비례한다.
   * @param {{resortCount?:number}} context
   */
  tollFor({ resortCount = 0 } = {}) {
    if (!this.isOwned()) {
      return 0;
    }
    if (this.isResort) {
      return RESORT_TOLL_UNIT * resortCount;
    }
    if (this.#landmark) {
      return Math.floor((this.#price * LANDMARK_TOLL_TENTHS) / 10);
    }
    const tenths = this.buildings.reduce((sum, type) => sum + TOLL_TENTHS[type], LAND_TOLL_TENTHS);
    return Math.floor((this.#price * tenths) / 10);
  }

  /** 투자액 = 매입가 + 정가 기준 건설비 합계(인수 후에도 정가 기준을 유지). */
  invested() {
    if (!this.isOwned()) {
      return 0;
    }
    const buildingCost = this.buildings.reduce((sum, type) => sum + this.buildCost(type), 0);
    const landmarkCost = this.#landmark ? this.buildCost(BUILDING_TYPES.LANDMARK) : 0;
    return this.#price + buildingCost + landmarkCost;
  }

  /** 은행 매각 환급액. */
  liquidationValue() {
    return Math.floor(this.invested() * LIQUIDATION_RATE);
  }

  /** 인수 가격. */
  acquisitionPrice() {
    return this.invested() * ACQUISITION_MULTIPLIER;
  }

  canBeAcquired() {
    return this.isOwned() && !this.isResort && !this.#landmark;
  }

  /** 총자산 계산용 가치. */
  assetValue() {
    return this.invested();
  }

  /** 지어진 건물 수(랜드마크 포함). */
  buildingCount() {
    return this.buildings.length + (this.#landmark ? 1 : 0);
  }

  reset() {
    this.#ownerId = null;
    this.#buildings = new Set();
    this.#landmark = false;
  }

  /** 영속화용 스냅샷(이름/가격 등 정적 데이터는 보드 정의에서 복원). */
  toSnapshot() {
    return {
      index: this.#index,
      ownerId: this.#ownerId,
      buildings: this.buildings,
      landmark: this.#landmark,
    };
  }
}
