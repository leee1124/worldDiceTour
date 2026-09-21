/**
 * 카지노 베팅액 규칙. 한도는 언제나 서버(`pending.limits`)가 준 값이 권위이며,
 * 클라이언트는 조작 UI가 잘못된 값을 만들지 않도록 맞추기만 한다.
 */

const DEFAULT_LIMITS = Object.freeze({ min: 10_000, max: 0, unit: 10_000 });

/** 서버 한도를 안전한 숫자로 정리한다. */
function normalizeLimits(limits) {
  const source = limits ?? DEFAULT_LIMITS;
  const unit = Number.isInteger(source.unit) && source.unit > 0 ? source.unit : DEFAULT_LIMITS.unit;
  const min = Number.isInteger(source.min) && source.min > 0 ? source.min : unit;
  const max = Number.isInteger(source.max) && source.max > 0 ? source.max : 0;
  return { min, max, unit };
}

/** 지금 베팅할 수 있는지(현금이 최소 베팅액 이상인지). */
export function canBet(limits) {
  const { min, max } = normalizeLimits(limits);
  return max >= min;
}

/** 어떤 입력이든 단위로 내림하고 한도 안으로 맞춘다. 베팅 불가면 0. */
export function clampBet(raw, limits) {
  const { min, max, unit } = normalizeLimits(limits);
  if (max < min) {
    return 0;
  }
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : min;
  const floored = Math.floor(value / unit) * unit;
  return Math.min(max, Math.max(min, floored));
}

/** −/+ 버튼. delta는 금액(보통 unit의 배수). */
export function stepBet(current, delta, limits) {
  const { unit } = normalizeLimits(limits);
  const move = Number.isFinite(delta) ? delta : unit;
  return clampBet(clampBet(current, limits) + move, limits);
}

/** 빠른 선택 칩(최소 · 중간값들 · 최대). 한도 안의 서로 다른 값만 오름차순으로. */
export function quickChips(limits) {
  const { min, max, unit } = normalizeLimits(limits);
  if (max < min) {
    return [];
  }
  const candidates = [min, 50_000, 100_000, Math.floor(max / 2 / unit) * unit, max];
  const chips = candidates
    .filter((value) => Number.isInteger(value) && value >= min && value <= max && value % unit === 0)
    .sort((a, b) => a - b);
  return [...new Set(chips)];
}
