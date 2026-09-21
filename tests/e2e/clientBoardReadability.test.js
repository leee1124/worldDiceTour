/**
 * 보드 가독성용 순수 뷰모델 테스트.
 * - 건물 배지 슬롯(별장·빌딩·호텔 3칸 + 랜드마크)
 * - 한 칸에 겹친 말(1~4개)의 부채꼴 배치
 * - "현재 위치" 문구 파생
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILDING_SHORT_LABELS,
  buildingShortLabel,
  buildingSlotView,
} from '../../public/js/domain/buildingSlots.js';
import { MAX_FANNED_TOKENS, fanOutTokens } from '../../public/js/domain/tokenLayout.js';
import { LOCATION_PREFIX, currentLocationLabel, playerCellLabel } from '../../public/js/domain/locationLabel.js';
import { BUILDING_ORDER } from '../../public/js/domain/labels.js';

/* ── 건물 배지 슬롯 ─────────────────────────────────────────── */

test('건물 배지: 아무것도 짓지 않은 도시는 세 칸이 모두 빈 슬롯이다', () => {
  // Given 소유만 하고 건물은 없는 도시 칸
  const space = { kind: 'CITY', buildings: [], landmark: false };

  // When 배지 뷰모델을 만들면
  const view = buildingSlotView(space);

  // Then 별장·빌딩·호텔 세 슬롯이 순서대로 있고 모두 비어 있다
  assert.equal(view.landmark, false);
  assert.equal(view.builtCount, 0);
  assert.deepEqual(
    view.slots.map((slot) => slot.type),
    [...BUILDING_ORDER],
  );
  assert.ok(view.slots.every((slot) => slot.built === false));
});

test('건물 배지: 지은 건물만 채워지고 한 글자 라벨(별·빌·호)이 붙는다', () => {
  // Given 별장과 호텔만 지은 도시
  const space = { kind: 'CITY', buildings: ['VILLA', 'HOTEL'], landmark: false };

  // When 배지 뷰모델을 만들면
  const view = buildingSlotView(space);

  // Then 지은 것만 built=true가 되고 슬롯 순서는 그대로다
  assert.equal(view.builtCount, 2);
  assert.deepEqual(
    view.slots.map((slot) => [slot.type, slot.built, slot.short]),
    [
      ['VILLA', true, '별'],
      ['BUILDING', false, '빌'],
      ['HOTEL', true, '호'],
    ],
  );

  // And 각 슬롯은 아이콘과 전체 이름도 함께 가진다(색만으로 구분하지 않는다)
  assert.equal(view.slots[0].label, '별장');
  assert.ok(view.slots[0].icon.length > 0);
});

test('건물 배지: 랜드마크는 세 슬롯을 대신하는 전용 표시가 된다', () => {
  // Given 랜드마크까지 올라간 도시
  const space = { kind: 'CITY', buildings: ['VILLA', 'BUILDING', 'HOTEL'], landmark: true };

  // When 배지 뷰모델을 만들면
  const view = buildingSlotView(space);

  // Then 슬롯 대신 랜드마크 표시를 쓰라고 알려 준다
  assert.equal(view.landmark, true);
  assert.deepEqual(view.slots, []);
  assert.equal(view.builtCount, BUILDING_ORDER.length);
});

test('건물 배지: 건설할 수 없는 칸(휴양지·특수 칸)은 슬롯이 없다', () => {
  // Given 건설 규칙이 없는 칸들
  // When 배지 뷰모델을 만들면
  // Then 빈 슬롯도 그리지 않는다(빈 슬롯이 "지을 수 있다"는 오해를 준다)
  for (const kind of ['RESORT', 'TICKET', 'TAX', 'START', 'ISLAND', 'CASINO', 'AIRPORT']) {
    const view = buildingSlotView({ kind, buildings: [], landmark: false });
    assert.deepEqual(view.slots, [], `${kind} 칸에 슬롯이 생겼다`);
    assert.equal(view.landmark, false);
  }
});

test('건물 배지: 인자가 없거나 buildings가 비어 있어도 예외 없이 빈 슬롯을 돌려준다', () => {
  // Given 아직 서버 뷰가 오지 않은 상태
  // When 배지 뷰모델을 만들면
  // Then 예외 없이 안전한 기본값이 나온다
  assert.deepEqual(buildingSlotView().slots, []);
  assert.deepEqual(buildingSlotView({ kind: 'CITY' }).slots.map((slot) => slot.built), [false, false, false]);
});

test('건물 배지: 한 글자 라벨 조회는 모르는 값에도 빈 문자열을 준다', () => {
  // Given 건물 3종과 알 수 없는 값
  // When 한 글자 라벨을 조회하면
  // Then 3종은 별·빌·호, 나머지는 빈 문자열이다
  assert.equal(buildingShortLabel('VILLA'), '별');
  assert.equal(buildingShortLabel('BUILDING'), '빌');
  assert.equal(buildingShortLabel('HOTEL'), '호');
  assert.equal(buildingShortLabel('LANDMARK'), '');
  assert.equal(buildingShortLabel(undefined), '');
  assert.deepEqual(Object.keys(BUILDING_SHORT_LABELS), [...BUILDING_ORDER]);
});

/* ── 말 부채꼴 배치 ─────────────────────────────────────────── */

test('말 배치: 칸에 말이 없으면 배치도 없다', () => {
  // Given 말이 없는 칸
  // When 배치를 계산하면
  // Then 빈 배열이다
  assert.deepEqual(fanOutTokens(0), []);
  assert.deepEqual(fanOutTokens(-3), []);
});

test('말 배치: 말이 하나면 칸 가운데에 그대로 놓인다', () => {
  // Given 말 한 개
  // When 배치를 계산하면
  const layout = fanOutTokens(1);

  // Then 치우침 없이 가운데다
  assert.equal(layout.length, 1);
  assert.deepEqual(layout[0], { index: 0, x: 0, y: 0 });
});

test('말 배치: 1~4개 모두 서로 다른 자리에 놓여 어떤 말도 완전히 가려지지 않는다', () => {
  // Given 한 칸에 1~4명이 함께 선 경우
  for (let count = 1; count <= MAX_FANNED_TOKENS; count += 1) {
    // When 배치를 계산하면
    const layout = fanOutTokens(count);

    // Then 개수만큼 나오고, 자리가 모두 다르며, 인덱스는 0부터 차례대로다
    assert.equal(layout.length, count);
    const seen = new Set(layout.map((slot) => `${slot.x},${slot.y}`));
    assert.equal(seen.size, count, `${count}개일 때 겹치는 자리가 있다`);
    assert.deepEqual(
      layout.map((slot) => slot.index),
      Array.from({ length: count }, (_, index) => index),
    );
  }
});

test('말 배치: 좌우 대칭이고 칸 밖으로 크게 벗어나지 않는다', () => {
  // Given 2~4개의 말
  for (let count = 2; count <= MAX_FANNED_TOKENS; count += 1) {
    // When 배치를 계산하면
    const layout = fanOutTokens(count);
    const sumX = layout.reduce((total, slot) => total + slot.x, 0);

    // Then 가로 중심이 유지되고(대칭) 한 칸 반경을 넘지 않는다
    assert.ok(Math.abs(sumX) < 1e-9, `${count}개 배치가 좌우로 치우쳤다`);
    for (const slot of layout) {
      assert.ok(Math.abs(slot.x) <= 0.7, `${count}개 배치의 x(${slot.x})가 너무 멀다`);
      assert.ok(Math.abs(slot.y) <= 0.5, `${count}개 배치의 y(${slot.y})가 너무 멀다`);
    }
  }
});

test('말 배치: 좌석 수보다 많아도(관전 확장 대비) 개수만큼 자리를 만든다', () => {
  // Given 정해진 최대 좌석 수를 넘는 말
  const layout = fanOutTokens(MAX_FANNED_TOKENS + 2);

  // When 배치를 계산하면
  // Then 개수만큼 나오고 자리는 여전히 서로 다르다
  assert.equal(layout.length, MAX_FANNED_TOKENS + 2);
  assert.equal(new Set(layout.map((slot) => `${slot.x},${slot.y}`)).size, MAX_FANNED_TOKENS + 2);
});

/* ── 현재 위치 문구 ─────────────────────────────────────────── */

test('현재 위치: 칸 이름을 받으면 📍 접두어가 붙은 한 줄이 된다', () => {
  // Given 현재 플레이어가 선 칸 이름
  // When 안내 문구를 만들면
  const text = currentLocationLabel('이스탄불');

  // Then 📍 현재 위치: 이스탄불 형태가 된다
  assert.equal(text, `${LOCATION_PREFIX}: 이스탄불`);
});

test('현재 위치: 칸 이름을 모르면 자리표시자를 쓰고 접두어는 유지한다', () => {
  // Given 아직 뷰가 없어 칸 이름을 모르는 경우
  // When 안내 문구를 만들면
  // Then 접두어는 그대로 두고 값만 자리표시자가 된다
  assert.equal(currentLocationLabel(null), `${LOCATION_PREFIX}: —`);
  assert.equal(currentLocationLabel(''), `${LOCATION_PREFIX}: —`);
  assert.equal(currentLocationLabel(undefined), `${LOCATION_PREFIX}: —`);
});

test('플레이어 카드 위치: 칸 번호와 이름을 함께 보여 준다', () => {
  // Given 12번 칸에 선 플레이어
  // When 카드에 쓸 위치 문구를 만들면
  const text = playerCellLabel({ index: 12, spaceName: '이스탄불' });

  // Then 번호와 이름이 한 줄로 나온다
  assert.equal(text, '12번 · 이스탄불');
});

test('플레이어 카드 위치: 조난 중이면 남은 턴을 덧붙이고, 파산하면 위치 대신 탈락을 알린다', () => {
  // Given 조난된 플레이어와 파산한 플레이어
  // When 각각의 위치 문구를 만들면 / Then 상태가 문구에 드러난다
  assert.equal(
    playerCellLabel({ index: 10, spaceName: '조난 섬', islandRemainingTurns: 2 }),
    '10번 · 조난 섬 · 조난 2턴',
  );
  assert.equal(playerCellLabel({ index: 3, spaceName: '방콕', eliminated: true }), '파산 — 게임에서 빠졌습니다');
});

test('플레이어 카드 위치: 칸 이름을 모르면 번호만으로도 문구가 만들어진다', () => {
  // Given 칸 이름을 찾지 못한 경우
  // When 위치 문구를 만들면
  // Then 번호만 남고 빈 구분자가 생기지 않는다
  assert.equal(playerCellLabel({ index: 7 }), '7번 칸');
  assert.equal(playerCellLabel({}), '위치 확인 중');
});
