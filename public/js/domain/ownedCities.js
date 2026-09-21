/**
 * "○○의 도시" 뷰모델(순수 로직). DOM을 모른다.
 *
 * 오너 요청: 돋보기(🔎)는 상대방 **말의 위치**가 아니라 상대방이 **가진 도시**를 찾는 도구다.
 * 보드에서 강조할 칸 번호와, 시트에 뿌릴 목록(이름 · 건물 배지 · 현재 통행료 · 합계)을 한곳에서 만든다.
 *
 * 건물 배지는 보드 칸·모달과 **같은 표**(`buildingSlots`)를 쓴다 — 화면마다 다른 표시가 나오지 않게.
 */

import { buildingSlotView } from './buildingSlots.js';
import { spaceKindLabel } from './labels.js';

/** 소유 가능한 칸 종류(서버 DTO에 price/ownerId가 붙는 칸). */
const OWNABLE_KINDS = Object.freeze(['CITY', 'RESORT']);

function isOwnedBy(space, seatId) {
  return Boolean(space) && Boolean(seatId) && space.ownerId === seatId && OWNABLE_KINDS.includes(space.kind);
}

/** 보드에서 강조할 칸 번호만 뽑는다(칸 번호 순). */
export function ownedIndexesOf(board, seatId) {
  if (!Array.isArray(board) || !seatId) {
    return [];
  }
  return board
    .filter((space) => isOwnedBy(space, seatId))
    .map((space) => space.index)
    .sort((left, right) => left - right);
}

/** 한 칸의 건물 상태를 한 줄 글자로. 랜드마크는 ★, 도시가 아니면 종류 이름. */
function buildingTextOf(space, slots, landmark) {
  if (landmark) {
    return '★ 랜드마크';
  }
  if (slots.length === 0) {
    // 휴양지처럼 건설할 수 없는 칸은 "건물 없음"이라고 하면 오해를 준다.
    return spaceKindLabel(space.kind);
  }
  const built = slots.filter((slot) => slot.built).map((slot) => slot.short);
  return built.length > 0 ? built.join('·') : '건물 없음';
}

/**
 * 한 좌석이 가진 칸 목록과 합계.
 *
 * @param {{board?: object[]|null, seatId?: string|null, ownerName?: string|null}} [options]
 * @returns {{seatId: string|null, ownerName: string|null, empty: boolean, count: number,
 *   totalToll: number, indexes: number[], items: Array<{
 *     index: number, name: string, kind: string, kindLabel: string, toll: number,
 *     landmark: boolean, buildingText: string, slots: object[],
 *   }>}}
 */
export function ownedCitiesOf({ board = [], seatId = null, ownerName = null } = {}) {
  const spaces = Array.isArray(board) ? board.filter((space) => isOwnedBy(space, seatId)) : [];
  spaces.sort((left, right) => left.index - right.index);

  const items = spaces.map((space) => {
    const landmark = Boolean(space.landmark);
    const { slots } = buildingSlotView(space);
    const toll = Number.isFinite(space.toll) ? space.toll : 0;
    return {
      index: space.index,
      name: space.name ?? `${space.index}번 칸`,
      kind: space.kind,
      kindLabel: spaceKindLabel(space.kind),
      toll,
      landmark,
      buildingText: buildingTextOf(space, slots, landmark),
      slots,
    };
  });

  return {
    seatId: seatId ?? null,
    ownerName: ownerName ?? null,
    empty: items.length === 0,
    count: items.length,
    totalToll: items.reduce((sum, item) => sum + item.toll, 0),
    indexes: items.map((item) => item.index),
    items,
  };
}
