import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASIC_BUILDINGS,
  BUILDING_TYPES,
  BuildingUnlocks,
  FIRST_LAP,
} from '../../src/domain/game/buildings.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';

const { VILLA, BUILDING, HOTEL, LANDMARK } = BUILDING_TYPES;

describe('BuildingUnlocks(바퀴별 건물 해금 규칙)', () => {
  it('첫 바퀴는 1이고 별장 1바퀴 · 빌딩 2바퀴 · 호텔 3바퀴부터 열린다', () => {
    // Given / When / Then
    assert.equal(FIRST_LAP, 1);
    assert.equal(BuildingUnlocks.unlockLapOf(VILLA), 1);
    assert.equal(BuildingUnlocks.unlockLapOf(BUILDING), 2);
    assert.equal(BuildingUnlocks.unlockLapOf(HOTEL), 3);
  });

  it('관광명소는 바퀴로 막지 않는다(3종 완성 여부로만 결정된다)', () => {
    // Given / When / Then
    assert.equal(BuildingUnlocks.unlockLapOf(LANDMARK), FIRST_LAP);
    assert.equal(BuildingUnlocks.isUnlockedAt(LANDMARK, 1), true);
  });

  it('바퀴 경계 1 / 2 / 3 / 10에서 열린 건물이 누적된다', () => {
    // Given / When / Then
    assert.deepEqual(BuildingUnlocks.unlockedTypes(1), [VILLA]);
    assert.deepEqual(BuildingUnlocks.unlockedTypes(2), [VILLA, BUILDING]);
    assert.deepEqual(BuildingUnlocks.unlockedTypes(3), [VILLA, BUILDING, HOTEL]);
    assert.deepEqual(BuildingUnlocks.unlockedTypes(10), [VILLA, BUILDING, HOTEL]);
  });

  it('아직 잠긴 건물 목록은 열린 목록의 나머지다', () => {
    // Given / When / Then
    assert.deepEqual(BuildingUnlocks.lockedTypes(1), [BUILDING, HOTEL]);
    assert.deepEqual(BuildingUnlocks.lockedTypes(2), [HOTEL]);
    assert.deepEqual(BuildingUnlocks.lockedTypes(3), []);
    assert.deepEqual(BuildingUnlocks.lockedTypes(10), []);
  });

  it('건물 3종의 순서와 해금 표의 순서가 어긋나지 않는다', () => {
    // Given / When / Then
    assert.deepEqual(BuildingUnlocks.unlockedTypes(3), [...BASIC_BUILDINGS]);
  });

  it('바퀴 수가 1 이상 정수가 아니면 도메인 에러다', () => {
    // Given
    const invalid = [0, -1, 1.5, '2', null, undefined, Number.NaN];

    // When / Then
    for (const lap of invalid) {
      assert.throws(
        () => BuildingUnlocks.assertLap(lap),
        { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
        `바퀴 값 ${String(lap)}을 통과시켰다`,
      );
    }
    assert.equal(BuildingUnlocks.assertLap(1), 1);
    assert.equal(BuildingUnlocks.assertLap(7), 7);
  });
});
