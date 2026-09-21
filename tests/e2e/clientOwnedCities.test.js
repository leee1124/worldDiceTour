/**
 * "○○의 도시" 뷰모델(순수 로직) 테스트.
 *
 * 오너 피드백: "돋보기 눌렀을 때, 상대방 위치 찾는 게 아니라 상대방이 가진 도시를 찾을 수 있었으면."
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ownedCitiesOf, ownedIndexesOf } from '../../public/js/domain/ownedCities.js';

/** 테스트용 보드 한 조각. 서버 board DTO와 같은 모양만 쓴다. */
function board() {
  return [
    { index: 0, name: '출발', kind: 'START' },
    { index: 1, name: '제주 올레길', kind: 'CITY', price: 50_000, ownerId: 's1', buildings: ['VILLA'], landmark: false, toll: 12_000 },
    { index: 2, name: '방콕', kind: 'CITY', price: 60_000, ownerId: null, buildings: [], landmark: false, toll: 3_000 },
    { index: 3, name: '카리브 크루즈', kind: 'RESORT', price: 100_000, ownerId: 's1', buildings: [], landmark: false, toll: 40_000 },
    { index: 5, name: '파리', kind: 'CITY', price: 200_000, ownerId: 's2', buildings: ['VILLA', 'BUILDING'], landmark: false, toll: 90_000 },
    { index: 9, name: '뉴욕', kind: 'CITY', price: 300_000, ownerId: 's1', buildings: [], landmark: true, toll: 500_000 },
    { index: 10, name: '조난 섬', kind: 'ISLAND' },
  ];
}

test('내 도시 목록: 소유한 칸이 없으면 "없다"고 분명히 알려 준다', () => {
  // Given 아무 칸도 갖지 않은 좌석
  // When 목록을 만들면
  const holdings = ownedCitiesOf({ board: board(), seatId: 's9', ownerName: '영희' });

  // Then 빈 목록이고 개수·합계가 0이다
  assert.equal(holdings.empty, true);
  assert.equal(holdings.count, 0);
  assert.equal(holdings.totalToll, 0);
  assert.deepEqual(holdings.items, []);
  assert.equal(holdings.ownerName, '영희');
});

test('내 도시 목록: 도시와 휴양지를 칸 번호 순으로 모은다', () => {
  // Given s1이 1·3·9번을 갖고 있다
  // When
  const holdings = ownedCitiesOf({ board: board(), seatId: 's1', ownerName: '철수' });

  // Then 칸 번호 순서 그대로 도시와 휴양지가 함께 들어간다
  assert.equal(holdings.empty, false);
  assert.deepEqual(holdings.items.map((item) => item.index), [1, 3, 9]);
  assert.deepEqual(holdings.items.map((item) => item.name), ['제주 올레길', '카리브 크루즈', '뉴욕']);
  assert.deepEqual(holdings.items.map((item) => item.kind), ['CITY', 'RESORT', 'CITY']);
});

test('내 도시 목록: 개수와 통행료 합계(통행료 총력)를 함께 알려 준다', () => {
  // Given
  // When
  const holdings = ownedCitiesOf({ board: board(), seatId: 's1' });

  // Then 12,000 + 40,000 + 500,000
  assert.equal(holdings.count, 3);
  assert.equal(holdings.totalToll, 552_000);
});

test('내 도시 목록: 랜드마크는 ★ 하나로, 지은 건물은 별·빌·호 배지로 보여 준다', () => {
  // Given 랜드마크(9번)와 별장만 지은 도시(1번)
  // When
  const items = ownedCitiesOf({ board: board(), seatId: 's1' }).items;
  const jeju = items.find((item) => item.index === 1);
  const newYork = items.find((item) => item.index === 9);

  // Then 랜드마크는 ★, 별장만 지은 곳은 "별"만 채워져 있다
  assert.equal(newYork.landmark, true);
  assert.equal(newYork.buildingText, '★ 랜드마크');
  assert.equal(jeju.landmark, false);
  assert.equal(jeju.buildingText, '별');
  assert.deepEqual(jeju.slots.filter((slot) => slot.built).map((slot) => slot.short), ['별']);
  assert.equal(jeju.slots.length, 3);
});

test('내 도시 목록: 건물을 여러 개 지으면 순서대로 이어 붙인다', () => {
  // Given 별장 + 빌딩을 지은 s2의 파리
  // When
  const paris = ownedCitiesOf({ board: board(), seatId: 's2' }).items[0];

  // Then
  assert.equal(paris.buildingText, '별·빌');
});

test('내 도시 목록: 건물을 하나도 안 지은 도시는 "건물 없음"으로 적는다', () => {
  // Given 건물 없는 도시만 가진 좌석
  const cities = [{ index: 4, name: '도쿄', kind: 'CITY', ownerId: 's3', buildings: [], landmark: false, toll: 8_000 }];

  // When
  const item = ownedCitiesOf({ board: cities, seatId: 's3' }).items[0];

  // Then
  assert.equal(item.buildingText, '건물 없음');
});

test('내 도시 목록: 휴양지는 건물 슬롯이 없고 종류 이름으로 설명한다', () => {
  // Given s1의 휴양지
  // When
  const resort = ownedCitiesOf({ board: board(), seatId: 's1' }).items.find((item) => item.kind === 'RESORT');

  // Then 건물 슬롯은 비어 있고 종류 라벨이 붙는다
  assert.deepEqual(resort.slots, []);
  assert.equal(resort.kindLabel, '휴양지');
  assert.equal(resort.buildingText, '휴양지');
});

test('내 도시 목록: 남의 칸과 주인 없는 칸은 절대 섞이지 않는다', () => {
  // Given 주인 없는 방콕(2번)과 s2의 파리(5번)
  // When s1의 목록을 만들면
  const holdings = ownedCitiesOf({ board: board(), seatId: 's1' });

  // Then 둘 다 빠진다
  assert.equal(holdings.items.some((item) => item.index === 2), false);
  assert.equal(holdings.items.some((item) => item.index === 5), false);
});

test('내 도시 목록: 보드에서 강조할 칸 번호만 따로 뽑을 수 있다', () => {
  // Given / When
  const indexes = ownedIndexesOf(board(), 's1');

  // Then 목록과 같은 칸 번호다
  assert.deepEqual(indexes, [1, 3, 9]);
  assert.deepEqual(ownedIndexesOf(board(), 's9'), []);
});

test('내 도시 목록: 잘못된 입력(보드 없음·좌석 없음)에도 예외 없이 빈 목록을 돌려준다', () => {
  // Given / When / Then
  assert.equal(ownedCitiesOf().empty, true);
  assert.equal(ownedCitiesOf({ board: null, seatId: null }).count, 0);
  assert.deepEqual(ownedCitiesOf({ board: [undefined, null], seatId: 's1' }).items, []);
  assert.deepEqual(ownedIndexesOf(null, null), []);
});

test('내 도시 목록: 통행료 값이 없는 칸도 합계를 깨뜨리지 않는다', () => {
  // Given toll이 빠진 칸
  const cities = [{ index: 6, name: '로마', kind: 'CITY', ownerId: 's4', buildings: [], landmark: false }];

  // When
  const holdings = ownedCitiesOf({ board: cities, seatId: 's4' });

  // Then 0으로 세고 예외는 없다
  assert.equal(holdings.totalToll, 0);
  assert.equal(holdings.items[0].toll, 0);
});
