import { DomainError } from '../shared/DomainError.js';

/** 건물 종류. 별장/빌딩/호텔은 서로 독립적이며, 랜드마크는 3종을 모두 지은 뒤의 최종 업그레이드다. */
export const BUILDING_TYPES = Object.freeze({
  VILLA: 'VILLA',
  BUILDING: 'BUILDING',
  HOTEL: 'HOTEL',
  LANDMARK: 'LANDMARK',
});

/** 독립 건물 3종(짓는 순서 무관). */
export const BASIC_BUILDINGS = Object.freeze([
  BUILDING_TYPES.VILLA,
  BUILDING_TYPES.BUILDING,
  BUILDING_TYPES.HOTEL,
]);

/** 모든 플레이어가 시작하는 바퀴 수. */
export const FIRST_LAP = 1;

/**
 * 건물이 열리는 바퀴. 1바퀴 별장 → 2바퀴 빌딩 → 3바퀴부터 호텔(명세 4장).
 * 랜드마크는 바퀴가 아니라 "3종 완성" 조건으로만 열리므로 표에 없다.
 */
const UNLOCK_LAP = Object.freeze({
  [BUILDING_TYPES.VILLA]: 1,
  [BUILDING_TYPES.BUILDING]: 2,
  [BUILDING_TYPES.HOTEL]: 3,
});

/**
 * 바퀴별 건물 해금 규칙(값 객체, 상태 없음).
 * 이 규칙은 도메인에만 존재하며 서비스/클라이언트는 결과만 받아 쓴다.
 */
export class BuildingUnlocks {
  /** 바퀴 수는 1 이상 정수여야 한다. 빠뜨린 호출을 규칙 우회로 만들지 않기 위해 반드시 검증한다. */
  static assertLap(lap) {
    if (!Number.isInteger(lap) || lap < FIRST_LAP) {
      throw DomainError.invalidArgument(`바퀴 수가 올바르지 않습니다: ${String(lap)}`);
    }
    return lap;
  }

  /** 이 건물이 열리는 바퀴(랜드마크처럼 바퀴로 막지 않는 건물은 첫 바퀴). */
  static unlockLapOf(type) {
    return UNLOCK_LAP[type] ?? FIRST_LAP;
  }

  static isUnlockedAt(type, lap) {
    return BuildingUnlocks.assertLap(lap) >= BuildingUnlocks.unlockLapOf(type);
  }

  /** 그 바퀴에 열려 있는 독립 건물 3종(정해진 순서). */
  static unlockedTypes(lap) {
    BuildingUnlocks.assertLap(lap);
    return BASIC_BUILDINGS.filter((type) => BuildingUnlocks.isUnlockedAt(type, lap));
  }

  /** 그 바퀴에 아직 열리지 않은 독립 건물(정해진 순서). */
  static lockedTypes(lap) {
    BuildingUnlocks.assertLap(lap);
    return BASIC_BUILDINGS.filter((type) => !BuildingUnlocks.isUnlockedAt(type, lap));
  }
}
