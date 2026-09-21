/**
 * 건설 조합의 합계 비용과 "건설 후 통행료" 미리보기.
 *
 * 통행료 배율은 서버 도메인(`City`)과 같은 값을 거울처럼 들고 있다(명세 4장).
 * 실제 판정은 언제나 서버가 하며, 여기 값은 화면 미리보기 전용이다.
 * 서버와 어긋나면 tests/e2e/clientLogic.test.js 가 먼저 깨진다.
 */

export const LANDMARK = 'LANDMARK';
export const BASIC_BUILDINGS = Object.freeze(['VILLA', 'BUILDING', 'HOTEL']);

/** 통행료 배율(10분의 n). 땅만 0.1 + 건물별 가산, 랜드마크는 3.5 고정. */
const LAND_TOLL_TENTHS = 1;
const TOLL_TENTHS = Object.freeze({ VILLA: 3, BUILDING: 6, HOTEL: 10 });
const LANDMARK_TOLL_TENTHS = 35;

const toArray = (value) => (Array.isArray(value) ? value : []);

/** 서버가 준 옵션(`[{type, cost}]`)에서 고른 건물들의 합계 비용. */
export function comboCost(options, selected) {
  const costByType = new Map(toArray(options).map((option) => [option.type, option.cost]));
  return toArray(selected).reduce((sum, type) => sum + (costByType.get(type) ?? 0), 0);
}

/**
 * 건설 후 통행료 미리보기.
 * @param {{price:number, buildings?:string[], landmark?:boolean, selected?:string[]}} input
 */
export function predictToll({ price, buildings = [], landmark = false, selected = [] }) {
  const base = typeof price === 'number' && Number.isFinite(price) ? price : 0;
  const willBeLandmark = landmark || toArray(selected).includes(LANDMARK);
  if (willBeLandmark) {
    return Math.floor((base * LANDMARK_TOLL_TENTHS) / 10);
  }
  const owned = new Set([...toArray(buildings), ...toArray(selected)]);
  const tenths = BASIC_BUILDINGS.reduce(
    (sum, type) => sum + (owned.has(type) ? TOLL_TENTHS[type] : 0),
    LAND_TOLL_TENTHS,
  );
  return Math.floor((base * tenths) / 10);
}

/** 건설비 배율(10분의 n). 별장 0.3 / 빌딩 0.6 / 호텔 0.9 / 랜드마크 1.0 */
const BUILD_COST_TENTHS = Object.freeze({ VILLA: 3, BUILDING: 6, HOTEL: 9, LANDMARK: 10 });

/** 정가 기준 건설비(서버가 옵션을 주지 않는 화면 — 칸 상세 시트 — 에서만 쓴다). */
export function buildCostOf(price, type) {
  const base = typeof price === 'number' && Number.isFinite(price) ? price : 0;
  const tenths = BUILD_COST_TENTHS[type] ?? 0;
  return Math.floor((base * tenths) / 10);
}

/**
 * 바퀴 규칙 한 줄 요약(건설 모달 상단 안내).
 * 서버 도메인(`BuildingUnlocks`)과 같은 값을 거울처럼 들고 있다 — 판정은 언제나 서버가 한다.
 */
export const LAP_RULE_TEXT = '1바퀴: 별장 · 2바퀴: 빌딩 · 3바퀴부터: 호텔';

/** 모달에 그릴 건물 순서. */
const ROW_ORDER = Object.freeze([...BASIC_BUILDINGS, LANDMARK]);

/** 플레이어 패널/모달에 쓰는 "n바퀴" 표기. */
export function lapLabel(lap) {
  const value = Number.isInteger(lap) && lap >= 1 ? lap : 1;
  return `${value}바퀴`;
}

/** 잠긴 건물 안내 문구(1바퀴부터 열리는 건물은 안내하지 않는다). */
export function unlockNotice(unlockLap) {
  return Number.isInteger(unlockLap) && unlockLap > 1 ? `${unlockLap}바퀴부터 지을 수 있습니다` : '';
}

function toRow(option, lockedList) {
  if (!option || typeof option.type !== 'string' || !ROW_ORDER.includes(option.type)) {
    return null;
  }
  const unlockLap = Number.isInteger(option.unlockLap) && option.unlockLap >= 1 ? option.unlockLap : 1;
  const locked = lockedList || Boolean(option.locked);
  return {
    type: option.type,
    cost: typeof option.cost === 'number' && Number.isFinite(option.cost) ? option.cost : 0,
    locked,
    unlockLap,
    notice: locked ? unlockNotice(unlockLap) : '',
  };
}

/**
 * 건설 기회의 선택지를 모달 행 목록으로 바꾼다.
 * 서버가 준 `options`(고를 수 있는 것)와 `lockedOptions`(바퀴가 모자란 것)를 합쳐
 * 별장 · 빌딩 · 호텔 · 랜드마크 순서로 정렬한다.
 * @param {{options?: Array<object>, lockedOptions?: Array<object>}} [pending]
 * @returns {Array<{type:string, cost:number, locked:boolean, unlockLap:number, notice:string}>}
 */
export function buildRows(pending) {
  return [
    ...toArray(pending?.options).map((option) => toRow(option, false)),
    ...toArray(pending?.lockedOptions).map((option) => toRow(option, true)),
  ]
    .filter((row) => row !== null)
    .sort((a, b) => ROW_ORDER.indexOf(a.type) - ROW_ORDER.indexOf(b.type));
}

/** 이 건설 기회가 랜드마크 업그레이드 전용인지. */
export function isLandmarkOffer(options) {
  const types = toArray(options).map((option) => option.type);
  return types.length === 1 && types[0] === LANDMARK;
}

/**
 * 고른 조합이 서버 규칙(옵션 안의 값, 중복 불가, 랜드마크는 단독)에 맞는지.
 * @returns {{ok: boolean, reason: string}}
 */
export function validateSelection(selected, options) {
  const chosen = toArray(selected);
  if (chosen.length === 0) {
    return { ok: false, reason: '지을 건물을 하나 이상 고르세요.' };
  }
  if (new Set(chosen).size !== chosen.length) {
    return { ok: false, reason: '같은 건물을 중복으로 지을 수 없습니다.' };
  }
  const allowed = new Set(toArray(options).map((option) => option.type));
  for (const type of chosen) {
    if (!allowed.has(type)) {
      return { ok: false, reason: '지금 지을 수 없는 건물이 포함되어 있습니다.' };
    }
  }
  if (chosen.includes(LANDMARK) && chosen.length > 1) {
    return { ok: false, reason: '랜드마크는 단독으로만 지을 수 있습니다.' };
  }
  return { ok: true, reason: '' };
}
