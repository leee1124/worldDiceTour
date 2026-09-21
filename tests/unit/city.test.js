import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { City } from '../../src/domain/game/City.js';
import { SPACE_KINDS } from '../../src/domain/game/data/board.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

const seoul = () => new City({ index: 39, name: '서울', kind: SPACE_KINDS.CITY, price: 800_000 });
const jeju = () => new City({ index: 5, name: '제주 올레길', kind: SPACE_KINDS.RESORT, price: 200_000 });

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
      assert.equal(city.level, 0);
    });

    it('이미 주인이 있는 칸은 매입할 수 없다', () => {
      // Given
      const city = seoul();
      city.buy('p1');

      // When / Then
      assert.throws(() => city.buy('p2'), DomainError);
    });
  });

  describe('건설(업그레이드)', () => {
    it('도시는 3단계까지 올릴 수 있고 단계당 건설비는 가격의 50%다', () => {
      // Given
      const city = seoul();
      city.buy('p1');

      // When
      const cost = city.upgradeCost();
      city.upgrade();

      // Then
      assert.equal(cost, 400_000);
      assert.equal(city.level, 1);
      assert.equal(city.canUpgrade(), true);
    });

    it('3단계(랜드마크)에 도달하면 더 올릴 수 없다', () => {
      // Given
      const city = seoul();
      city.buy('p1');
      city.upgrade();
      city.upgrade();
      city.upgrade();

      // When / Then
      assert.equal(city.level, 3);
      assert.equal(city.canUpgrade(), false);
      assert.throws(() => city.upgrade(), DomainError);
    });

    it('휴양지는 건설할 수 없다', () => {
      // Given
      const resort = jeju();
      resort.buy('p1');

      // When / Then
      assert.equal(resort.canUpgrade(), false);
      assert.throws(() => resort.upgrade(), DomainError);
    });

    it('주인 없는 칸은 건설할 수 없다', () => {
      // Given
      const city = seoul();

      // When / Then
      assert.equal(city.canUpgrade(), false);
    });
  });

  describe('통행료', () => {
    it('땅만 있으면 가격의 10%다', () => {
      // Given
      const city = seoul();
      city.buy('p1');

      // When
      const toll = city.tollFor({ resortCount: 0 });

      // Then
      assert.equal(toll, 80_000);
    });

    it('건물 단계에 따라 0.5 / 1.2 / 2.5 배율을 적용하고 원 단위로 내림한다', () => {
      // Given
      const city = new City({ index: 13, name: '아테네', kind: SPACE_KINDS.CITY, price: 160_000 });
      city.buy('p1');

      // When
      city.upgrade();
      const lv1 = city.tollFor({ resortCount: 0 });
      city.upgrade();
      const lv2 = city.tollFor({ resortCount: 0 });
      city.upgrade();
      const lv3 = city.tollFor({ resortCount: 0 });

      // Then
      assert.equal(lv1, 80_000);
      assert.equal(lv2, 192_000);
      assert.equal(lv3, 400_000);
    });

    it('휴양지 통행료는 소유자가 가진 휴양지 수 × 50,000원이다', () => {
      // Given
      const resort = jeju();
      resort.buy('p1');

      // When
      const toll = resort.tollFor({ resortCount: 3 });

      // Then
      assert.equal(toll, 150_000);
    });

    it('주인이 없으면 통행료는 0원이다', () => {
      // Given
      const city = seoul();

      // When / Then
      assert.equal(city.tollFor({ resortCount: 0 }), 0);
    });
  });

  describe('정리(매각) 가치', () => {
    it('환급액은 (매입가 + 누적 건설비)의 50%다', () => {
      // Given
      const city = seoul();
      city.buy('p1');
      city.upgrade();
      city.upgrade();

      // When
      const refund = city.liquidationValue();

      // Then
      assert.equal(city.buildCostTotal(), 800_000);
      assert.equal(refund, 800_000);
    });

    it('총자산 계산용 자산가치는 매입가 + 누적 건설비다', () => {
      // Given
      const city = seoul();
      city.buy('p1');
      city.upgrade();

      // When / Then
      assert.equal(city.assetValue(), 1_200_000);
    });
  });

  it('파산 시 초기화하면 주인 없고 건물 없는 상태가 된다', () => {
    // Given
    const city = seoul();
    city.buy('p1');
    city.upgrade();

    // When
    city.reset();

    // Then
    assert.equal(city.isOwned(), false);
    assert.equal(city.level, 0);
    assert.equal(city.assetValue(), 0);
  });
});
