/**
 * 이모지를 대신하는 인라인 SVG 글리프 모음.
 *
 * 이 게임은 "세계 여행" 톤이다 — 국기(출발) · 섬(조난) · 주사위(카지노) · 비행기(공항) ·
 * 집·빌딩·호텔(건물) · 별(랜드마크)을 이미지 에셋 없이 획 굵기를 통일한 선 그림으로 그린다.
 * 모두 `width/height: 1em`이라 부모의 `font-size`만 바꾸면 칸·버튼 크기에 맞춰 함께 커진다.
 *
 * 이모지 폰트에 기대지 않으므로 OS·브라우저가 달라도 항상 같은 모양으로 보인다.
 */

import { el, svg } from '../dom.js';

const VIEWBOX = '0 0 16 16';

/** 공통 SVG 캔버스. */
function icon(children, { fill = 'none' } = {}) {
  return svg('svg', { viewBox: VIEWBOX, width: '1em', height: '1em', fill, 'aria-hidden': 'true', focusable: 'false' }, children);
}

function strokePath(d, extra = {}) {
  return svg('path', { d, stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none', ...extra });
}

function fillPath(d, extra = {}) {
  return svg('path', { d, fill: 'currentColor', ...extra });
}

function strokeLine(x1, y1, x2, y2, extra = {}) {
  return svg('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', ...extra });
}

function dot(cx, cy, r = 0.9) {
  return svg('circle', { cx, cy, r, fill: 'currentColor' });
}

function strokeRect(x, y, width, height, extra = {}) {
  return svg('rect', { x, y, width, height, stroke: 'currentColor', 'stroke-width': 1.3, fill: 'none', ...extra });
}

/** 출발 칸: 깃발. */
export function flagIcon() {
  return icon([
    strokeLine(3, 1.5, 3, 14.5, { 'stroke-width': 1.4 }),
    fillPath('M3.4 2 L11.5 4.2 L3.4 6.4 Z'),
  ]);
}

/** 조난 섬 · 휴양지 배경의 야자수(모래섬 위). */
export function islandIcon() {
  return icon([
    strokePath('M2 13.5 C4 11.7 12 11.7 14 13.5', { 'stroke-width': 1.3 }),
    strokeLine(8, 11, 8.8, 5, { 'stroke-width': 1.3 }),
    strokePath('M8.8 5 C6.5 3.6 4.5 4 3.3 5.8', { 'stroke-width': 1.15 }),
    strokePath('M8.8 5 C8.6 2.8 10.3 1.8 12.2 2.3', { 'stroke-width': 1.15 }),
    strokePath('M8.8 5 C10.8 4.4 12.6 5.6 13.2 7.6', { 'stroke-width': 1.15 }),
  ]);
}

/** 휴양지: 파라솔. */
export function resortIcon() {
  return icon([
    fillPath('M2.2 7.6 A5.8 5.2 0 0 1 13.8 7.6 Z'),
    strokeLine(8, 7.6, 8, 14, { 'stroke-width': 1.3 }),
    strokePath('M8 14 Q6.4 14 5.9 12.6', { 'stroke-width': 1.05 }),
  ]);
}

/** 카지노 · 주사위 굴리기: 주사위(눈 5). */
export function diceIcon() {
  return icon([
    strokeRect(2, 2, 12, 12, { rx: 2.5, 'stroke-width': 1.4 }),
    dot(4.7, 4.7),
    dot(11.3, 4.7),
    dot(8, 8),
    dot(4.7, 11.3),
    dot(11.3, 11.3),
  ]);
}

/** 공항: 종이비행기 실루엣. */
export function planeIcon() {
  return icon([
    strokeLine(8, 1.5, 8, 10, { 'stroke-width': 1.4 }),
    strokeLine(8, 4.3, 2, 8.3, { 'stroke-width': 1.3 }),
    strokeLine(8, 4.3, 14, 8.3, { 'stroke-width': 1.3 }),
    strokeLine(8, 10, 5.6, 13, { 'stroke-width': 1.3 }),
    strokeLine(8, 10, 10.4, 13, { 'stroke-width': 1.3 }),
  ]);
}

/** 별장(VILLA): 작은 집. */
export function villaIcon() {
  return icon([
    strokePath('M2 8.2 L8 2.8 L14 8.2', { 'stroke-width': 1.4 }),
    strokeRect(3.6, 8.2, 8.8, 5.6),
    strokeRect(6.8, 10.3, 2.4, 3.5, { 'stroke-width': 1.1 }),
  ]);
}

/** 빌딩(BUILDING) · 도시 칸: 창문 있는 사무 빌딩. */
export function buildingGlyphIcon() {
  const windowAt = (x, y) => svg('rect', { x, y, width: 1.3, height: 1.3, fill: 'currentColor' });
  return icon([
    strokeRect(4, 2, 8, 12),
    windowAt(5.4, 3.8),
    windowAt(9.3, 3.8),
    windowAt(5.4, 6.6),
    windowAt(9.3, 6.6),
    windowAt(5.4, 9.4),
    windowAt(9.3, 9.4),
  ]);
}

/** 호텔(HOTEL): 지붕이 있는 큰 건물. */
export function hotelIcon() {
  const windowAt = (x, y) => svg('rect', { x, y, width: 1.3, height: 1.3, fill: 'currentColor' });
  return icon([
    strokePath('M3 5.5 L8 1.8 L13 5.5'),
    strokeRect(3.6, 5.5, 8.8, 8.5),
    windowAt(5.4, 7.4),
    windowAt(9.3, 7.4),
    windowAt(5.4, 10.2),
    windowAt(9.3, 10.2),
  ]);
}

/** 5각 별(채워짐) — 랜드마크. */
export function starIcon() {
  return icon(
    [fillPath('M8.0 1.7 L9.59 5.82 L13.99 6.05 L10.57 8.83 L11.7 13.1 L8.0 10.7 L4.3 13.1 L5.43 8.83 L2.01 6.05 L6.41 5.82 Z')],
  );
}

/** 행운 티켓: 절취선이 있는 표. */
export function ticketIcon() {
  return icon([
    strokeRect(1.6, 4.2, 12.8, 7.6, { rx: 1.4 }),
    strokeLine(8, 4.6, 8, 11.4, { 'stroke-width': 1, 'stroke-dasharray': '1.5 1.4' }),
    dot(4.6, 8, 0.6),
  ]);
}

/** 세관/세금: 승인 도장(원 + 체크). */
export function customsIcon() {
  return icon([
    svg('circle', { cx: 8, cy: 8, r: 5.6, stroke: 'currentColor', 'stroke-width': 1.3, fill: 'none' }),
    strokePath('M5.4 8.2 L7.1 10 L10.8 5.8', { 'stroke-width': 1.4 }),
  ]);
}

/** 자리표시자 위치 핀(알 수 없는 칸 종류). */
export function pinIcon() {
  return icon([
    strokePath('M8 1.6 C11 1.6 13 3.9 13 6.6 C13 10.4 8 14.4 8 14.4 C8 14.4 3 10.4 3 6.6 C3 3.9 5 1.6 8 1.6 Z', { 'stroke-width': 1.2 }),
    dot(8, 6.6, 1.9),
  ]);
}

/** 잠긴 건설 칸(아직 바퀴가 모자람): 자물쇠. */
export function lockIcon() {
  return icon([
    strokePath('M5.2 7 V5.2 A2.8 2.8 0 0 1 10.8 5.2 V7', { 'stroke-width': 1.4 }),
    strokeRect(4, 7, 8, 6.4, { rx: 1.2 }),
    dot(8, 9.6, 0.85),
    svg('rect', { x: 7.6, y: 10.1, width: 0.8, height: 1.9, fill: 'currentColor' }),
  ]);
}

/** 닫기(X). */
export function closeIcon() {
  return icon([
    strokeLine(4, 4, 12, 12, { 'stroke-width': 1.6 }),
    strokeLine(12, 4, 4, 12, { 'stroke-width': 1.6 }),
  ]);
}

/** 돋보기(찾기·확대). `playersView`의 "가진 도시 찾기" 버튼과 같은 그림을 쓴다. */
export function magnifierIcon() {
  return icon([
    svg('circle', { cx: 7, cy: 7, r: 4.4, stroke: 'currentColor', 'stroke-width': 1.6 }),
    strokeLine(10.4, 10.4, 14, 14, { 'stroke-width': 1.8 }),
  ]);
}

/** 하이로우세븐: 과녁. */
export function targetIcon() {
  return icon([
    svg('circle', { cx: 8, cy: 8, r: 6, stroke: 'currentColor', 'stroke-width': 1.2, fill: 'none' }),
    svg('circle', { cx: 8, cy: 8, r: 3.6, stroke: 'currentColor', 'stroke-width': 1.2, fill: 'none' }),
    dot(8, 8, 1.2),
  ]);
}

/** 슬롯머신(탭 아이콘 · 릴 자리표시자). */
export function slotMachineIcon() {
  return icon([
    strokeRect(2, 2, 10, 12, { rx: 1.2 }),
    strokeRect(3.5, 4, 7, 4, { 'stroke-width': 1.1 }),
    strokeLine(6, 4, 6, 8, { 'stroke-width': 0.9 }),
    strokeLine(8, 4, 8, 8, { 'stroke-width': 0.9 }),
    svg('rect', { x: 6.5, y: 9.5, width: 3, height: 1, rx: 0.5, fill: 'currentColor' }),
    strokeLine(13, 3, 13, 9, { 'stroke-width': 1.4 }),
    dot(13, 2.4, 1.1),
  ]);
}

/* ── 슬롯 심볼(서버가 보낸 이모지 id → 화면 글리프) ─────────────────── */

function cherryIcon() {
  return icon([
    dot(5.6, 11, 2),
    dot(9.6, 11.4, 2),
    strokePath('M6.1 9.3 Q6.7 5 9 3.2', { 'stroke-width': 1 }),
    strokePath('M9.7 9.5 Q9.4 6.4 9 3.2', { 'stroke-width': 1 }),
    fillPath('M9 3.2 Q10.6 2.3 11.5 3.6 Q10 4.5 9 3.2 Z'),
  ]);
}

function lemonIcon() {
  return icon([
    svg('ellipse', { cx: 8, cy: 8, rx: 5, ry: 3.6, fill: 'currentColor', transform: 'rotate(-24 8 8)' }),
  ]);
}

function bellIcon() {
  return icon([
    fillPath('M8 2.4 C10.4 2.4 11.6 4.3 11.6 6.8 C11.6 9.7 12.6 10.6 12.6 10.9 L3.4 10.9 C3.4 10.6 4.4 9.7 4.4 6.8 C4.4 4.3 5.6 2.4 8 2.4 Z'),
    svg('rect', { x: 6.8, y: 1, width: 2.4, height: 1.4, rx: 0.6, fill: 'currentColor' }),
    svg('rect', { x: 2.6, y: 10.9, width: 10.8, height: 1.1, rx: 0.5, fill: 'currentColor' }),
    dot(8, 12.6, 1.1),
  ]);
}

function gemIcon() {
  return icon([
    fillPath('M8 1.6 L13.2 6 L8 14.4 L2.8 6 Z'),
  ]);
}

function sevenGlyph() {
  return el('span', { class: 'slot-seven', 'aria-hidden': 'true', text: '7' });
}

/** 서버 슬롯 심볼 id(`domain/slotSymbols.js`가 아는 종류) → 화면에 그릴 노드. */
const SLOT_SYMBOL_ICONS = Object.freeze({
  CHERRY: cherryIcon,
  LEMON: lemonIcon,
  BELL: bellIcon,
  STAR: starIcon,
  GEM: gemIcon,
  SEVEN: sevenGlyph,
});

/** @param {string} kind `domain/slotSymbols.js`의 `slotSymbolKind()` 결과 */
export function slotSymbolIcon(kind) {
  const build = SLOT_SYMBOL_ICONS[kind] ?? pinIcon;
  return build();
}

/* ── 칸 종류 · 건물 종류 글리프 조회(라벨과 짝지어 쓴다) ───────────────── */

/** 칸 종류(`labels.js`의 `SPACE_KIND_LABELS`와 같은 키) → 글리프. 모서리 칸도 같은 표를 쓴다. */
const SPACE_KIND_ICONS = Object.freeze({
  START: flagIcon,
  CITY: buildingGlyphIcon,
  RESORT: resortIcon,
  TICKET: ticketIcon,
  TAX: customsIcon,
  ISLAND: islandIcon,
  CASINO: diceIcon,
  AIRPORT: planeIcon,
});

export function spaceKindIcon(kind) {
  const build = SPACE_KIND_ICONS[kind] ?? pinIcon;
  return build();
}

/** 건물 종류(VILLA/BUILDING/HOTEL/LANDMARK) → 글리프. */
const BUILDING_TYPE_ICONS = Object.freeze({
  VILLA: villaIcon,
  BUILDING: buildingGlyphIcon,
  HOTEL: hotelIcon,
  LANDMARK: starIcon,
});

export function buildingTypeIcon(type) {
  const build = BUILDING_TYPE_ICONS[type] ?? pinIcon;
  return build();
}

/** 랜드마크 배지(별 + "랜드마크" 글자). 보드·칸 시트·모달·시트가 모두 같은 조각을 쓴다. */
export function landmarkBadge() {
  return el('span', { class: 'build-landmark' }, [
    el('span', { class: 'build-landmark-star' }, [starIcon()]),
    el('span', { class: 'build-landmark-text', text: '랜드마크' }),
  ]);
}
