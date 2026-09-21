import { DomainError } from '../shared/DomainError.js';
import { City } from './City.js';
import { BOARD_SPACES, OWNABLE_KINDS, SPACE_KINDS } from './data/board.js';

/**
 * 40칸 보드. 칸 조회, 전진 계산, 소유 현황 집계를 담당한다.
 */
export class Board {
  /** @type {Array<object|City>} */
  #spaces;

  constructor(spaces) {
    this.#spaces = spaces;
  }

  /** 명세의 기본 보드를 만든다. */
  static createDefault() {
    return new Board(
      BOARD_SPACES.map((space) =>
        OWNABLE_KINDS.includes(space.kind) ? new City({ ...space }) : { ...space },
      ),
    );
  }

  /** 스냅샷(소유자/건물)으로 보드를 복원한다. */
  static restore(citySnapshots = []) {
    const byIndex = new Map(citySnapshots.map((snapshot) => [snapshot.index, snapshot]));
    return new Board(
      BOARD_SPACES.map((space) => {
        if (!OWNABLE_KINDS.includes(space.kind)) {
          return { ...space };
        }
        const snapshot = byIndex.get(space.index);
        return new City({
          ...space,
          ownerId: snapshot?.ownerId ?? null,
          buildings: snapshot?.buildings ?? [],
          landmark: snapshot?.landmark ?? false,
        });
      }),
    );
  }

  get size() {
    return this.#spaces.length;
  }

  #assertIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.#spaces.length) {
      throw DomainError.invalidArgument(`보드 칸 번호가 올바르지 않습니다: ${index}`);
    }
  }

  spaceAt(index) {
    this.#assertIndex(index);
    return this.#spaces[index];
  }

  isOwnable(index) {
    return this.spaceAt(index) instanceof City;
  }

  /** 소유 가능한 칸을 City로 얻는다. */
  cityAt(index) {
    const space = this.spaceAt(index);
    if (!(space instanceof City)) {
      throw DomainError.invalidArgument(`매입할 수 없는 칸입니다: ${index}`);
    }
    return space;
  }

  /** 모든 소유 가능 칸. */
  cities() {
    return this.#spaces.filter((space) => space instanceof City);
  }

  unowned() {
    return this.cities().filter((city) => !city.isOwned());
  }

  ownedBy(playerId) {
    return this.cities().filter((city) => city.isOwnedBy(playerId));
  }

  resortCountOf(playerId) {
    return this.ownedBy(playerId).filter((city) => city.isResort).length;
  }

  cityCountOf(playerId) {
    return this.ownedBy(playerId).filter((city) => !city.isResort).length;
  }

  /** 보유 자산에 지어진 건물 수 합계(랜드마크 포함). */
  buildingCountOf(playerId) {
    return this.ownedBy(playerId).reduce((sum, city) => sum + city.buildingCount(), 0);
  }

  totalAssetValueOf(playerId) {
    return this.ownedBy(playerId).reduce((sum, city) => sum + city.assetValue(), 0);
  }

  releaseAllOf(playerId) {
    const released = this.ownedBy(playerId);
    released.forEach((city) => city.reset());
    return released.map((city) => city.index);
  }

  /**
   * 현재 칸에서 steps 만큼 이동한 결과.
   * @returns {{index:number, passedStart:boolean}} 전진 중 출발 칸을 지나거나 도착했는지 포함
   */
  advance(from, steps) {
    this.#assertIndex(from);
    const size = this.#spaces.length;
    const raw = from + steps;
    const index = ((raw % size) + size) % size;
    const passedStart = steps > 0 && raw >= size;
    return { index, passedStart };
  }

  /** from에서 to까지 앞 방향 걸음 수. */
  stepsTo(from, to) {
    this.#assertIndex(from);
    this.#assertIndex(to);
    const size = this.#spaces.length;
    return ((to - from) % size + size) % size;
  }

  /** 앞 방향으로 가장 가까운 휴양지 칸 번호. */
  nearestResortFrom(index) {
    this.#assertIndex(index);
    const size = this.#spaces.length;
    for (let step = 1; step <= size; step += 1) {
      const candidate = (index + step) % size;
      if (this.#spaces[candidate].kind === SPACE_KINDS.RESORT) {
        return candidate;
      }
    }
    throw DomainError.invalidState('보드에 휴양지가 없습니다');
  }

  /** 해당 종류의 첫 칸 번호. */
  indexOfKind(kind) {
    const found = this.#spaces.find((space) => space.kind === kind);
    if (!found) {
      throw DomainError.invalidState(`보드에 ${kind} 칸이 없습니다`);
    }
    return found.index;
  }

  toSnapshot() {
    return this.cities()
      .filter((city) => city.isOwned())
      .map((city) => city.toSnapshot());
  }
}
