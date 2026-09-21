import { DomainError } from '../shared/DomainError.js';

/**
 * 금융 확장용 방 옵션(구조화된 객체).
 *
 * 다섯 갈래 확장(주식·대출·코인·파생·성적표)이 각자 옵션을 하나씩 추가하면
 * `Room`·`validation`·`RoomSerializer`를 매번 다시 설계해야 한다. 그래서 처음부터
 * **`options.finance` 한 덩어리**로 묶고, 값 목록만 늘어나게 만든다.
 *
 * 모든 기능의 기본값은 **꺼짐**이다 — 저장된 방이 업데이트 뒤에 갑자기 다른 게임이 되면 안 된다.
 */
export const DEFAULT_FINANCE_OPTIONS = Object.freeze({
  /** 투자 모드: `OFF` | (예정) `STOCKS` | `STOCKS_CRYPTO` | `ADVANCED` */
  investmentMode: 'OFF',
  /** 금융 시스템: `BASIC`(지금의 1회 대출) | (예정) `ADVANCED` */
  financeSystem: 'BASIC',
  /** 거래 창구 타이머(초). `0`은 사용하지 않음 | (예정) `30` | `45` */
  tradeTimerSec: 0,
  /** 시나리오 프리셋: `STANDARD` | (예정) `BUBBLE` | `DEPRESSION` */
  scenario: 'STANDARD',
});

export const FINANCE_OPTION_KEYS = Object.freeze(Object.keys(DEFAULT_FINANCE_OPTIONS));

/**
 * 지금 **실제로 구현된** 값만 허용한다.
 *
 * 설계서에는 `STOCKS`·`ADVANCED`·`30`·`BUBBLE` 같은 값이 있지만 그 기능은 아직 없다.
 * 받아만 두고 아무 일도 하지 않으면 "켰는데 왜 안 되지?"가 되므로, 기능이 들어올 때
 * 이 목록에 값을 **추가**하는 방식으로 연다. 그때 손댈 곳은 이 배열뿐이다.
 */
export const ALLOWED_FINANCE_OPTIONS = Object.freeze({
  investmentMode: Object.freeze(['OFF']),
  financeSystem: Object.freeze(['BASIC']),
  tradeTimerSec: Object.freeze([0]),
  scenario: Object.freeze(['STANDARD']),
});

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 금융 옵션을 화이트리스트로 검증하고 빠진 값은 기본값으로 채운다.
 * @param {unknown} raw
 * @param {{base?: object}} [options] `base`는 부분 변경의 기준값(기본은 전부 꺼짐)
 * @returns {object} 새 객체(호출자가 마음대로 보관해도 안전하다)
 */
export function normalizeFinanceOptions(raw, { base = DEFAULT_FINANCE_OPTIONS } = {}) {
  if (raw === undefined || raw === null) {
    return { ...base };
  }
  if (!isPlainObject(raw)) {
    throw DomainError.invalidArgument('금융 옵션이 객체가 아닙니다');
  }
  for (const key of Object.keys(raw)) {
    if (!FINANCE_OPTION_KEYS.includes(key)) {
      throw DomainError.invalidArgument(`알 수 없는 금융 옵션입니다: ${key}`);
    }
  }

  const normalized = {};
  for (const key of FINANCE_OPTION_KEYS) {
    const value = raw[key] === undefined ? base[key] : raw[key];
    if (!ALLOWED_FINANCE_OPTIONS[key].includes(value)) {
      throw DomainError.invalidArgument(
        `아직 선택할 수 없는 금융 옵션입니다: ${key}=${String(value)}`,
      );
    }
    normalized[key] = value;
  }
  return normalized;
}
