/**
 * 테마(다크/라이트/자동) 선택 순수 로직.
 *
 * DOM · localStorage · matchMedia에는 전혀 손대지 않는다 — 저장/구독/적용은
 * `public/js/theme.js`가 이 표만 보고 하고, 규칙 자체는 여기서만 검증한다.
 *
 * 선택지는 세 가지뿐이다.
 * - `auto`: 시스템(브라우저/OS) 설정을 그대로 따른다(기본값).
 * - `light` / `dark`: 시스템 설정과 무관하게 고정한다.
 */

export const THEME_CHOICES = Object.freeze(['auto', 'light', 'dark']);

/**
 * 저장돼 있던(혹은 사용자가 방금 고른) 원시 값을 표준 선택값으로 맞춘다.
 * 알 수 없는 값·빈 값·잘못된 타입은 모두 가장 안전한 기본값인 `auto`로 떨어진다.
 * @param {*} raw
 * @returns {'auto'|'light'|'dark'}
 */
export function normalizeChoice(raw) {
  if (typeof raw !== 'string') {
    return 'auto';
  }
  const trimmed = raw.trim().toLowerCase();
  return THEME_CHOICES.includes(trimmed) ? trimmed : 'auto';
}

/**
 * 선택값 + 시스템 다크 선호 여부 → 실제로 화면에 입힐 테마.
 * @param {{ choice?: *, systemDark?: boolean }} [input]
 * @returns {'light'|'dark'}
 */
export function resolveTheme({ choice, systemDark = false } = {}) {
  const normalized = normalizeChoice(choice);
  if (normalized === 'light') {
    return 'light';
  }
  if (normalized === 'dark') {
    return 'dark';
  }
  // auto: 시스템 선호를 따른다. systemDark를 알 수 없으면(값이 없거나 boolean이 아니면) light가 기본이다.
  return systemDark === true ? 'dark' : 'light';
}

/**
 * 토글 버튼 한 번 탭에 쓰는 순환: auto → light → dark → auto.
 * @param {*} choice 현재 선택값(정규화되지 않아도 된다)
 * @returns {'auto'|'light'|'dark'}
 */
export function nextChoice(choice) {
  const normalized = normalizeChoice(choice);
  const index = THEME_CHOICES.indexOf(normalized);
  return THEME_CHOICES[(index + 1) % THEME_CHOICES.length];
}
