import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BUILDING_TYPES, City } from '../../src/domain/game/City.js';
import { SPACE_KINDS } from '../../src/domain/game/data/board.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

const { VILLA, BUILDING, HOTEL, LANDMARK } = BUILDING_TYPES;

const seoul = (overrides = {}) =>
  new City({ index: 39, name: '서울', kind: SPACE_KINDS.CITY, price: 800_000, ...overrides });
const jeju = (overrides = {}) =>
  new City({ index: 5, name: '제주 올레길', kind: SPACE_KINDS.RESORT, price: 200_000, ...overrides });

describe('City(도시/휴양지 칸)', () => {
  describe('매입', () => {
    it('주인 없는 칸은 매입할 수 있다', () => {
      // Given
      const city = seoul();

      // When
      city.buy('p1');

      // Then
      assert.equal(city.isOwned(), true);
      assert.equal(city.isOwnedBy('p1'), true);
      assert.deepEqual(city.buildings, []);
    });

    it('이미 주인이 있는 칸은 매입할 수 없다', () => {
      // Given
      const city = seoul();
      city.buy('p1');

      // When / Then
      assert.throws(() => city.buy('p2'), DomainError);
    });
  });

  describe('건설비', () => {
    it('별장 30%, 빌딩 60%, 호텔 90%, 랜드마크 100%다', () => {
      // Given
      const city = seoul({ ownerId: 'p1' });

      // When / Then
      assert.equal(city.buildCost(VILLA), 240_000);
      assert.equal(city.buildCost(BUILDING), 480_000);
      assert.equal(city.buildCost(HOTEL), 720_000);
      assert.equal(city.buildCost(LANDMARK), 800_000);
    });

    it('건설비는 원 단위로 내림한다', () => {
      // Given
      const city = new City({ index: 3, name: '방콕', kind: SPACE_KINDS.CITY, price: 70_000, ownerId: 'p1' });

      // When / Then
      assert.equal(city.buildCost(VILLA), 21_000);
      assert.equal(city.costOf([VILLA, BUILDING, HOTEL]), 21_000 + 42_000 + 63_000);
    });
  });

  describe('건설 기회', () => {
    it('아직 짓지 않은 별장/빌딩/호텔을 제안한다', () => {
      // Given
      const city = seoul({ ownerId: 'p1', buildings: [VILLA] });

      // When
      const options = city.buildableTypes();

      // Then
      assert.deepEqual(options, [BUILDING, HOTEL]);
    });

    it('원하는 조합을 한 번에 지을 수 있다', () => {
      // Given
      const city = seoul({ ownerId: 'p1' });

      // When
      const cost = city.build([VILLA, HOTEL]);

      // Then
      assert.equal(cost, 240_000 + 720_000);
      assert.equal(city.hasBuilding(VILLA), true);
      assert.equal(city.hasBuilding(HOTEL), true);
      assert.equal(city.hasBuilding(BUILDING), false);
    });

    it('3종이 모두 있으면 랜드마크만 제안한다', () => {
      // Given
      const city = seoul({ ownerId: 'p1', buildings: [VILLA, BUILDING, HOTEL] });

      // When / Then
      assert.deepEqual(city.buildableTypes(), [LANDMARK]);
    });

    it('3종을 완성하는 기회에서 랜드마크를 함께 지을 수 없다', () => {
      // Given
      const city = seoul({ ownerId: 'p1' });

      // When / Then
      assert.throws(() => city.build([VILLA, BUILDING, HOTEL, LANDMARK]), DomainError);
      assert.equal(city.landmark, false);
    });

    it('랜드마크를 지으면 더 건설할 수 없다', () => {
      // Given
      const city = seoul({ ownerId: 'p1', buildings: [VILLA, BUILDING, HOTEL] });

      // When
      city.build([LANDMARK]);

      // Then
      assert.equal(city.landmark, true);
      assert.deepEqual(city.buildableTypes(), []);
      assert.throws(() => city.build([LANDMARK]), DomainError);
    });

    it('이미 지은 건물은 다시 지을 수 없다', () => {
      // Given
      const city = seoul({ ownerId: 'p1', buildings: [VILLA] });

      // When / Then
      assert.throws(() => city.build([VILLA]), DomainError);
    });

    it('같은 건물을 중복으로 요청할 수 없다', () => {
      // Given
      const city = seoul({ ownerId: 'p1' });

      // When / Then
      assert.throws(() => city.build([VILLA, VILLA]), DomainError);
    });

    it('빈 목록이나 알 수 없는 건물은 거부한다', () => {
      // Given
      const city = seoul({ ownerId: 'p1' });

      // When / Then
      assert.throws(() => city.build([]), DomainError);
      assert.throws(() => city.build(['CASTLE']), DomainError);
    });

    it('주인 없는 칸에는 건설할 수 없다', () => {
      // Given
      const city = seoul();

      // When / Then
      assert.deepEqual(city.buildableTypes(), []);
      assert.throws(() => city.build([VILLA]), DomainError);
    });

    it('휴양지는 건설할 수 없다', () => {
      // Given
      const resort = jeju({ ownerId: 'p1' });

      // When / Then
      assert.deepEqual(resort.buildableTypes(), []);
      assert.throws(() => resort.build([VILLA]), DomainError);
    });
  });

  describe('통행료', () => {
    it('땅만 있으면 가격의 10%다', () => {
      // Given
      const city = seoul({ ownerId: 'p1' });

      // When / Then
      assert.equal(city.tollFor({ resortCount: 0 }), 80_000);
    });

    it('별장 +0.3, 빌딩 +0.6, 호텔 +1.0 배율이 더해진다', () => {
      // Given
      const price = 160_000;
      const base = { index: 13, name: '아테네', kind: SPACE_KINDS.CITY, price, ownerId: 'p1' };

      // When
      const villa = new City({ ...base, buildings: [VILLA] }).tollFor({});
      const withBuilding = new City({ ...base, buildings: [VILLA, BUILDING] }).tollFor({});
      const all = new City({ ...base, buildings: [VILLA, BUILDING, HOTEL] }).tollFor({});

      // Then
      assert.equal(villa, 64_000);
      assert.equal(withBuilding, 160_000);
      assert.equal(all, 320_000);
    });

    it('랜드마크는 3.5배 고정이다', () => {
      // Given
      const city = seoul({ ownerId: 'p1', buildings: [VILLA, BUILDING, HOTEL], landmark: true });

      // When / Then
      assert.equal(city.tollFor({}), 2_800_000);
    });

    it('휴양지 통행료는 소유자가 가진 휴양지 수 × 50,000원이다', () => {
      // Given
      const resort = jeju({ ownerId: 'p1' });

      // When / Then
      assert.equal(resort.tollFor({ resortCount: 3 }), 150_000);
    });

    it('주인이 없으면 통행료는 0원이다', () => {
      // Given / When / Then
      assert.equal(seoul().tollFor({}), 0);
    });
  });

  describe('투자액·매각·인수', () => {
    it('투자액은 매입가와 정가 기준 건설비의 합이다', () => {
      // Given
      const city = seoul({ ownerId: 'p1', buildings: [VILLA, BUILDING] });

      // When / Then
      assert.equal(city.invested(), 800_000 + 240_000 + 480_000);
      assert.equal(city.assetValue(), 1_520_000);
    });

    it('매각 환급액은 투자액의 50%다', () => {
      // Given
      const city = seoul({ ownerId: 'p1', buildings: [VILLA] });

      // When / Then
      assert.equal(city.liquidationValue(), Math.floor(1_040_000 / 2));
    });

    it('인수 가격은 투자액의 2배다', () => {
      // Given
      const city = seoul({ ownerId: 'p1', buildings: [VILLA] });

      // When / Then
      assert.equal(city.acquisitionPrice(), 2_080_000);
    });

    it('랜드마크 도시와 휴양지는 인수할 수 없다', () => {
      // Given
      const landmarkCity = seoul({ ownerId: 'p1', buildings: [VILLA, BUILDING, HOTEL], landmark: true });
      const resort = jeju({ ownerId: 'p1' });

      // When / Then
      assert.equal(landmarkCity.canBeAcquired(), false);
      assert.equal(resort.canBeAcquired(), false);
      assert.equal(seoul({ ownerId: 'p1' }).canBeAcquired(), true);
    });

    it('인수하면 건물이 그대로 새 주인에게 넘어가고 투자액은 정가 기준을 유지한다', () => {
      // Given
      const city = seoul({ ownerId: 'p1', buildings: [VILLA, BUILDING] });

      // When
      city.transferTo('p2');

      // Then
      assert.equal(city.isOwnedBy('p2'), true);
      assert.deepEqual(city.buildings, [VILLA, BUILDING]);
      assert.equal(city.invested(), 1_520_000);
    });
  });

  it('초기화하면 주인과 건물이 모두 사라진다', () => {
    // Given
    const city = seoul({ ownerId: 'p1', buildings: [VILLA, BUILDING, HOTEL], landmark: true });

    // When
    city.reset();

    // Then
    assert.equal(city.isOwned(), false);
    assert.deepEqual(city.buildings, []);
    assert.equal(city.landmark, false);
    assert.equal(city.assetValue(), 0);
  });

  it('스냅샷으로 저장하고 복원할 수 있다', () => {
    // Given
    const city = seoul({ ownerId: 'p1', buildings: [HOTEL, VILLA] });

    // When
    const snapshot = city.toSnapshot();

    // Then
    assert.deepEqual(snapshot, { index: 39, ownerId: 'p1', buildings: [VILLA, HOTEL], landmark: false });
  });
});
