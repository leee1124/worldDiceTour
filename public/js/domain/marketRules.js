/**
 * 거래 수수료·명목금액·한도 계산.
 *
 * **숫자는 하나도 화면에 하드코딩하지 않는다.** 모든 상수는 서버가 준
 * `view.market.rules`(API.md 9.1)에서 오고, 이 모듈은 필드가 빠졌을 때만
 * 기본값으로 버틴다. 서버가 규칙을 바꾸면 화면이 저절로 따라간다.
 */

/** `rules`가 통째로 없을 때만 쓰는 최후의 기본값(API.md 9.3 기준). */
export const DEFAULT_MARKET_RULES = Object.freeze({
  feeBp: 100,
  feeMin: 1_000,
  maxOrdersPerWindow: 3,
  maxNotionalPerWindow: 2_000_000,
  maxNotionalPerOrder: 1_000_000,
  minQuantity: 1,
  maxQuantity: 200,
  maxPositionPerInstrument: 500,
  depositUnit: 10_000,
  depositCap: 10_000_000,
  maxQueuedOrders: 3,
  baseRateMinBp: 25,
  baseRateMaxBp: 400,
  seriesLength: 30,
});

/** 0 이상 정수만 통과. 그 밖에는 기본값. */
function positiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** `null`을 "상한 없음"(Infinity)으로 읽어도 되는 규칙 키. */
const UNLIMITED_OK = new Set(['maxOrdersPerWindow', 'maxNotionalPerWindow', 'maxNotionalPerOrder']);

/** 서버 규칙을 안전한 숫자 묶음으로 정리한다(누락·음수·문자열 방어). */
export function normalizeRules(rules) {
  const source = rules && typeof rules === 'object' ? rules : {};
  const normalized = {};
  for (const [key, fallback] of Object.entries(DEFAULT_MARKET_RULES)) {
    // 상한 키는 서버가 `null`을 주면 "상한 없음"이다(D46). 기본값으로 되돌려 옛 한도를 몰래 되살리면 안 된다.
    if (UNLIMITED_OK.has(key) && source[key] === null) {
      normalized[key] = Infinity;
      continue;
    }
    normalized[key] = positiveInt(source[key], fallback);
  }
  // 최소 수량만 0을 허용할 이유가 없다(서버 계약도 1 이상).
  normalized.minQuantity = Math.max(1, normalized.minQuantity);
  normalized.maxQuantity = Math.max(normalized.minQuantity, normalized.maxQuantity);
  return normalized;
}

function toInt(value) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** 명목금액 = 수량 × 현재가. */
export function notionalOf(quantity, price) {
  const qty = Math.max(0, toInt(quantity));
  const unit = Math.max(0, toInt(price));
  return qty * unit;
}

/**
 * 거래 수수료 = `max(feeMin, ceil(명목금액 × feeBp / 10000))`.
 * 매수·매도 양방향으로 같은 식이다(그래서 같은 창구 왕복은 언제나 손실이다).
 * 명목금액이 0이면 수수료도 0(주문이 아니다).
 */
export function feeOf(notional, rules) {
  const { feeBp, feeMin } = normalizeRules(rules);
  const amount = Math.max(0, toInt(notional));
  if (amount === 0) {
    return 0;
  }
  return Math.max(feeMin, Math.ceil((amount * feeBp) / 10_000));
}

/** 매수 실제 지출 = 명목금액 + 수수료. */
export function buyTotalOf(notional, rules) {
  return Math.max(0, toInt(notional)) + feeOf(notional, rules);
}

/** 매도 실제 수령 = 명목금액 − 수수료(최소 수수료 탓에 음수가 될 수 있다). */
export function sellProceedsOf(notional, rules) {
  return Math.max(0, toInt(notional)) - feeOf(notional, rules);
}

/** 창구 예산을 안전한 값으로 정리한다. 창구가 없으면 최대치로 본다. */
function normalizeBudget(budget, rules) {
  const limits = normalizeRules(rules);
  const source = budget && typeof budget === 'object' ? budget : {};
  // `null` = 상한 없음(D46). 정수가 아니면 규칙의 상한(그 역시 Infinity일 수 있다)으로 본다.
  const ordersLeft = source.ordersLeft === null ? Infinity
    : Number.isInteger(source.ordersLeft) ? Math.max(0, source.ordersLeft) : limits.maxOrdersPerWindow;
  const notionalLeft = source.notionalLeft === null ? Infinity
    : Number.isInteger(source.notionalLeft) ? Math.max(0, source.notionalLeft) : limits.maxNotionalPerWindow;
  return { open: source.open === true, ordersLeft, notionalLeft };
}

/**
 * 지금 살 수 있는 최대 수량.
 * 현금(수수료 포함) · 창구 잔여 예산 · 1건 명목금액 한도 · 1회 수량 한도 · 종목 보유 상한을
 * **모두** 만족하는 가장 큰 수량이다.
 */
export function maxBuyQuantity({ price, cash, rules, budget, held = 0, queueMode = false }) {
  const limits = normalizeRules(rules);
  const unit = Math.max(0, toInt(price));
  if (unit === 0) {
    return 0;
  }
  const window = normalizeBudget(budget, rules);
  const positionRoom = Math.max(0, limits.maxPositionPerInstrument - Math.max(0, toInt(held)));

  // 예약 주문은 다음 창구에서 체결되므로 지금 창구의 잔여 예산으로 묶지 않는다.
  const notionalCap = queueMode
    ? Math.min(limits.maxNotionalPerOrder, limits.maxNotionalPerWindow)
    : Math.min(limits.maxNotionalPerOrder, window.notionalLeft);

  let quantity = Math.min(limits.maxQuantity, positionRoom, Math.floor(notionalCap / unit));
  const budgetCash = Math.max(0, toInt(cash));
  // 수수료가 계단식(최소 1,000원 + 1% 올림)이라 나눗셈 한 번으로는 정확하지 않다.
  // 위에서부터 한 단계씩만 내려오면 되므로 반복 횟수는 사실상 1~2회다.
  let guard = 0;
  while (quantity > 0 && buyTotalOf(notionalOf(quantity, unit), rules) > budgetCash && guard < limits.maxQuantity + 2) {
    const over = buyTotalOf(notionalOf(quantity, unit), rules) - budgetCash;
    quantity -= Math.max(1, Math.floor(over / unit));
    guard += 1;
  }
  return Math.max(0, quantity);
}

/** 지금 팔 수 있는 최대 수량(보유 수량과 1회 수량 한도 중 작은 값). */
export function maxSellQuantity({ held, rules }) {
  const limits = normalizeRules(rules);
  return Math.max(0, Math.min(limits.maxQuantity, toInt(held)));
}

/** 수량을 `[minQuantity, max]`(또는 0) 안으로 맞춘다. */
export function clampQuantity(raw, { rules, max }) {
  const limits = normalizeRules(rules);
  const ceiling = Math.max(0, Math.min(limits.maxQuantity, toInt(max)));
  if (ceiling === 0) {
    return 0;
  }
  const value = toInt(raw);
  return Math.min(ceiling, Math.max(limits.minQuantity, value));
}

/** ±1 / ±10 스테퍼. 언제나 허용 범위 안에 머문다. */
export function stepQuantity(current, delta, { rules, max }) {
  return clampQuantity(clampQuantity(current, { rules, max }) + toInt(delta), { rules, max });
}

/** 예금 금액을 단위로 내림하고 `[depositUnit, max]` 안에 둔다. 넣을 수 없으면 0. */
export function quantizeAmount(raw, { rules, max }) {
  const limits = normalizeRules(rules);
  const unit = limits.depositUnit;
  const ceiling = Math.floor(Math.max(0, toInt(max)) / unit) * unit;
  if (ceiling < unit) {
    return 0;
  }
  const floored = Math.floor(Math.max(0, toInt(raw)) / unit) * unit;
  return Math.min(ceiling, Math.max(unit, floored));
}

/** 예금 빠른 선택 칩(단위 배수만, 오름차순, 중복 없음). */
export function depositChips(max, rules) {
  const limits = normalizeRules(rules);
  const unit = limits.depositUnit;
  const ceiling = Math.floor(Math.max(0, toInt(max)) / unit) * unit;
  if (ceiling < unit) {
    return [];
  }
  const half = Math.floor(ceiling / 2 / unit) * unit;
  const candidates = [unit, unit * 10, unit * 50, half, ceiling];
  return [...new Set(candidates.filter((value) => value >= unit && value <= ceiling))].sort((a, b) => a - b);
}
