/**
 * 슬롯머신 심볼 계약. 서버(`src/domain/game/Casino.js`의 `SLOT_SYMBOLS`)는 이모지 문자열을
 * 심볼 id로 그대로 이벤트(`CASINO_RESULT.detail.symbols`)에 실어 보낸다 — 이 계약은 바꾸지 않는다.
 *
 * 화면에는 이모지 폰트 대신 SVG 글리프/글자를 그리고 싶으므로, 서버가 보낸 값을 이 모듈이 아는
 * "종류"로 한 번 옮겨 담는다. 서버 심볼 목록이 바뀌면 이 표만 고치면 된다.
 *
 * 이 모듈은 DOM을 모른다 — 실제 그리기는 `views/icons.js`가 맡는다.
 *
 * **이 파일에는 이모지 글자를 직접 적지 않는다.** 화면 코드에서 이모지를 걷어내는 작업 중에도
 * 서버 계약과 값이 정확히 같아야 하므로, 유니코드 이스케이프로 같은 문자열을 만든다
 * (바이트는 동일하고, 소스 코드에는 이모지 문자가 나타나지 않는다).
 */

/** 서버 심볼(이모지 id, `src/domain/game/Casino.js`의 `SLOT_SYMBOLS`) → 화면이 아는 종류. */
export const SLOT_SYMBOL_KINDS = Object.freeze({
  '\u{1F352}': 'CHERRY', // U+1F352 체리
  '\u{1F34B}': 'LEMON', // U+1F34B 레몬
  '\u{1F514}': 'BELL', // U+1F514 종
  '\u{2B50}': 'STAR', // U+2B50 별
  '\u{1F48E}': 'GEM', // U+1F48E 보석
  '7\u{FE0F}\u{20E3}': 'SEVEN', // '7' + U+FE0F + U+20E3 (키캡 세븐)
});

/** 종류 → 한국어 이름(로그 문장 등 글자만 필요한 곳에서 쓴다). */
const SLOT_SYMBOL_LABELS = Object.freeze({
  CHERRY: '체리',
  LEMON: '레몬',
  BELL: '종',
  STAR: '별',
  GEM: '보석',
  SEVEN: '세븐',
});

/** 화면이 그릴 수 있는 모든 종류(테스트: 서버 심볼이 하나도 빠지지 않았는지 확인용). */
export const SLOT_SYMBOL_KIND_LIST = Object.freeze(Object.values(SLOT_SYMBOL_KINDS));

/** @param {string} serverSymbol 서버가 보낸 심볼(이모지 id) */
export function slotSymbolKind(serverSymbol) {
  return SLOT_SYMBOL_KINDS[serverSymbol] ?? 'UNKNOWN';
}

/** @param {string} serverSymbol 서버가 보낸 심볼(이모지 id) */
export function slotSymbolLabel(serverSymbol) {
  return SLOT_SYMBOL_LABELS[slotSymbolKind(serverSymbol)] ?? '알 수 없음';
}
