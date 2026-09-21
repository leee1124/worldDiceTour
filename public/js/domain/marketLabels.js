/**
 * 증권거래소 enum → 화면 문구 사전. `domain/labels.js`와 같은 원칙:
 * **모르는 값이 와도 예외 없이** 읽을 수 있는 문구를 돌려준다(서버가 새 코드를 늘려도 안 깨진다).
 */

const lookup = (table, key, fallback) => table[key] ?? fallback ?? String(key ?? '');

/* ── 경기 국면 ─────────────────────────────────────────────── */

/** 국면 4종. `tone`은 CSS 색 계열, `hint`는 "지금 무슨 뜻인지" 한 줄. */
export const CYCLE_VIEWS = Object.freeze({
  EXPANSION: Object.freeze({
    label: '호황',
    icon: '🌤',
    tone: 'expansion',
    hint: '경기가 꾸준히 오르는 국면입니다. 대체로 오르지만 뉴스가 뒤집을 수 있습니다.',
  }),
  OVERHEAT: Object.freeze({
    label: '과열',
    icon: '🔥',
    tone: 'overheat',
    hint: '많이 올랐고 흔들림도 큽니다. 다음 국면이 침체로 꺾이기 쉽습니다.',
  }),
  RECESSION: Object.freeze({
    label: '침체',
    icon: '🌧',
    tone: 'recession',
    hint: '값이 내리는 국면입니다. 예금 이자가 상대적으로 든든해집니다.',
  }),
  RECOVERY: Object.freeze({
    label: '회복',
    icon: '🌱',
    tone: 'recovery',
    hint: '바닥을 지나 다시 오르기 시작하는 국면입니다.',
  }),
});

const UNKNOWN_CYCLE = Object.freeze({
  label: '경기 국면',
  icon: '📊',
  tone: 'expansion',
  hint: '서버가 알려 준 새 국면입니다.',
});

/**
 * 국면 화면 모델. **서버가 준 `label`이 있으면 그것을 쓴다**(서버가 유일한 권위).
 * @param {{phase?: string, label?: string|null, age?: number, driftBp?: number, volMulPct?: number}|null} cycle
 */
export function cycleView(cycle) {
  const phase = cycle?.phase ?? null;
  const preset = CYCLE_VIEWS[phase] ?? UNKNOWN_CYCLE;
  const serverLabel = typeof cycle?.label === 'string' && cycle.label.length > 0 ? cycle.label : null;
  return {
    phase: phase ?? 'UNKNOWN',
    label: serverLabel ?? preset.label,
    icon: preset.icon,
    tone: preset.tone,
    hint: preset.hint,
    age: Number.isInteger(cycle?.age) ? cycle.age : null,
    driftBp: Number.isFinite(cycle?.driftBp) ? Math.trunc(cycle.driftBp) : 0,
    volMulPct: Number.isFinite(cycle?.volMulPct) ? Math.trunc(cycle.volMulPct) : 100,
  };
}

/** 국면 이름만(배너·로그용). */
export function cyclePhaseLabel(phase) {
  return CYCLE_VIEWS[phase]?.label ?? UNKNOWN_CYCLE.label;
}

/* ── 섹터 ─────────────────────────────────────────────────── */

export const SECTOR_LABELS = Object.freeze({
  AIRLINE: '항공',
  CONSTRUCTION: '건설',
  HOTEL: '호텔·관광',
  ENTERTAINMENT: '카지노·엔터',
  ENERGY: '에너지',
});

export function sectorLabel(sector) {
  return lookup(SECTOR_LABELS, sector, '기타 업종');
}

/* ── 주문 ─────────────────────────────────────────────────── */

export const ORDER_KIND_LABELS = Object.freeze({
  BUY_STOCK: '매수',
  SELL_STOCK: '매도',
  DEPOSIT: '예치',
  WITHDRAW: '인출',
  // 이벤트(`ORDER_FILLED.kind`)는 짧은 이름으로 온다.
  BUY: '매수',
  SELL: '매도',
});

export function orderKindLabel(kind) {
  return lookup(ORDER_KIND_LABELS, kind, '주문');
}

/** 예약 주문 자동 체결이 실패한 이유(`reasonCode`). */
export const REJECT_REASON_LABELS = Object.freeze({
  WINDOW_CLOSED: '거래 창구가 닫혀 있었습니다',
  INSUFFICIENT_CASH: '현금이 부족했습니다',
  NOT_ENOUGH_SHARES: '보유 수량이 부족했습니다',
  DELISTED: '상장폐지된 종목입니다',
  UNKNOWN_INSTRUMENT: '목록에 없는 종목입니다',
  ORDER_LIMIT: '창구 주문 건수를 넘었습니다',
  NOTIONAL_LIMIT: '창구 예산을 넘었습니다',
  POSITION_LIMIT: '종목 보유 상한을 넘었습니다',
  DEPOSIT_CAP: '예금 한도를 넘었습니다',
  INSUFFICIENT_DEPOSIT: '예금 잔액이 부족했습니다',
});

export function rejectReasonLabel(code) {
  return lookup(REJECT_REASON_LABELS, code, '조건이 맞지 않았습니다');
}

/* ── 거래 에러 ─────────────────────────────────────────────── */

/**
 * 거래 커맨드가 실패했을 때의 안내와 쿨다운.
 * `ERR019`(429)는 **즉시 재시도하면 안 되므로**(API.md 변경 31) 잠깐 버튼을 잠근다.
 */
export function tradeErrorHint(code) {
  switch (code) {
    case 'ERR018':
      return { message: '한도에 걸렸습니다 — 주문 건수·창구 예산·보유 상한을 확인하세요.', cooldownMs: 0 };
    case 'ERR019':
      return { message: '주문이 너무 잦습니다 — 잠시 뒤 다시 눌러 주세요.', cooldownMs: 2_000 };
    case 'ERR008':
      return { message: '현금·보유 수량·예금 잔액이 부족합니다.', cooldownMs: 0 };
    case 'ERR005':
      return { message: '지금은 거래할 수 있는 순서가 아닙니다.', cooldownMs: 0 };
    case 'ERR006':
      return { message: '내 차례가 아닙니다.', cooldownMs: 0 };
    default:
      return { message: '주문을 처리할 수 없습니다. 화면의 최신 시세로 다시 시도해 주세요.', cooldownMs: 0 };
  }
}

/** 창구를 닫은 이유(`TRADING_CLOSED.reason`). */
export const TRADING_CLOSE_REASONS = Object.freeze({
  PLAYER: '거래를 마쳤습니다',
  BUDGET_EXHAUSTED: '창구 예산을 다 써서 자동으로 닫혔습니다',
});

export function tradingCloseReasonLabel(reason) {
  return lookup(TRADING_CLOSE_REASONS, reason, '거래 창구가 닫혔습니다');
}
