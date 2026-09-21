/**
 * 칸에 그릴 건물 배지의 뷰모델.
 *
 * 보드 칸에서는 "무엇이 지어졌는지"가 한눈에 보여야 한다 — 그래서 지은 건물만 아이콘으로
 * 찍지 않고, **별장·빌딩·호텔 세 칸을 늘 그려 두고** 지은 것만 채운다(빈 칸은 옅은 윤곽).
 * 랜드마크는 세 칸을 대신하는 전용 표시다.
 *
 * 이 모듈은 DOM을 모른다 — 보드 칸(boardView)과 칸 상세 시트(cellSheet)가 같은 표를 쓴다.
 */

import { BUILDING_ORDER, buildingIcon, buildingLabel } from './labels.js';

/** 좁은 칸에서도 읽히는 한 글자 라벨(색맹 대비: 색 + 아이콘 + 글자). */
export const BUILDING_SHORT_LABELS = Object.freeze({
  VILLA: '별',
  BUILDING: '빌',
  HOTEL: '호',
});

/** 건물 슬롯을 그리는 칸 종류(도시만 건설할 수 있다). */
const BUILDABLE_KINDS = Object.freeze(['CITY']);

/** 한 글자 라벨. 모르는 값이면 빈 문자열(예외를 던지지 않는다). */
export function buildingShortLabel(type) {
  return BUILDING_SHORT_LABELS[type] ?? '';
}

/**
 * 칸 하나의 건물 배지 뷰모델을 만든다.
 *
 * @param {{kind?: string, buildings?: string[], landmark?: boolean}} [space] 서버 board 항목
 * @returns {{landmark: boolean, builtCount: number, slots: Array<{
 *   type: string, label: string, short: string, icon: string, built: boolean,
 * }>}}
 */
export function buildingSlotView(space = {}) {
  const landmark = Boolean(space.landmark);
  if (landmark) {
    // 랜드마크는 세 건물을 모두 흡수한 최종 형태다 — 슬롯 대신 리본 하나로 보여 준다.
    return { landmark: true, builtCount: BUILDING_ORDER.length, slots: [] };
  }
  if (!BUILDABLE_KINDS.includes(space.kind)) {
    // 건설할 수 없는 칸에 빈 슬롯을 그리면 "지을 수 있다"는 오해를 준다.
    return { landmark: false, builtCount: 0, slots: [] };
  }

  const built = new Set(Array.isArray(space.buildings) ? space.buildings : []);
  const slots = BUILDING_ORDER.map((type) => ({
    type,
    label: buildingLabel(type),
    short: buildingShortLabel(type),
    icon: buildingIcon(type),
    built: built.has(type),
  }));
  return { landmark: false, builtCount: slots.filter((slot) => slot.built).length, slots };
}
