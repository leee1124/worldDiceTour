/**
 * 테마 적용기(다크/라이트/자동). 규칙 자체는 `domain/themePreference.js`(순수 함수, 테스트됨)를
 * 그대로 따르고, 여기서는 DOM · localStorage · matchMedia만 다룬다.
 *
 * - 저장: `localStorage['wdt.theme']`에 `auto`/`light`/`dark` 중 하나. 실패해도(사파리 프라이빗
 *   모드 등) 화면이 죽지 않게 모든 접근을 try/catch로 감싼다(`storage.js`와 같은 원칙).
 * - 적용: 수동 선택(`light`/`dark`)일 때만 `<html data-theme>`을 심는다. `auto`일 때는 속성을
 *   지워서 CSS의 `@media (prefers-color-scheme: dark)` 규칙이 그대로 먹히게 둔다
 *   (`base.css`: `:root`는 라이트 기본값, 다크는 미디어쿼리 또는 `[data-theme="dark"]`에서만 켠다).
 * - 브라우저 강제 다크(삼성 인터넷 · 크롬 자동 다크 등) 대응: `<meta name="color-scheme">`과
 *   CSS `color-scheme` 값을 실제 테마에 맞춰 명시한다 — "라이트로 그렸는데 브라우저가 또
 *   반전시켜 이중 반전되는" 현상을 막는다.
 * - main.js가 화면을 그리기 **전에** 가장 먼저 호출해야 깜빡임(FOUC)이 줄어든다.
 */

import { nextChoice, normalizeChoice, resolveTheme } from './domain/themePreference.js';

const STORAGE_KEY = 'wdt.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

let currentChoice = 'auto';
let mediaQuery = null;
const listeners = new Set();

function readStoredChoice() {
  try {
    return normalizeChoice(window.localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    console.error('[theme] 저장된 테마를 읽지 못했습니다', error.name);
    return 'auto';
  }
}

function writeStoredChoice(choice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch (error) {
    console.error('[theme] 테마를 저장하지 못했습니다', error.name);
  }
}

function systemPrefersDark() {
  try {
    return Boolean(mediaQuery?.matches ?? window.matchMedia?.(DARK_QUERY).matches);
  } catch (error) {
    console.error('[theme] 시스템 다크 모드 여부를 확인하지 못했습니다', error.name);
    return false;
  }
}

/** 실제로 화면에 입혀질 테마('light'|'dark'). */
export function resolvedTheme() {
  return resolveTheme({ choice: currentChoice, systemDark: systemPrefersDark() });
}

export function themeChoice() {
  return currentChoice;
}

/**
 * `<html>`에 테마를 반영한다.
 * - 수동 선택이면 `data-theme`을 심어 CSS가 시스템 설정보다 이 값을 우선하게 만든다.
 * - `auto`면 속성을 지운다(미디어쿼리에 맡긴다).
 * - `color-scheme`(meta + 인라인 스타일)을 실제 테마로 맞춰 브라우저 강제 다크의 이중 반전을 막는다.
 */
function applyToDocument() {
  const root = document.documentElement;
  if (currentChoice === 'light' || currentChoice === 'dark') {
    root.dataset.theme = currentChoice;
  } else {
    delete root.dataset.theme;
  }

  const resolved = resolvedTheme();
  root.style.colorScheme = resolved;

  try {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) {
      meta.setAttribute('content', resolved);
    }
  } catch (error) {
    console.error('[theme] color-scheme meta를 갱신하지 못했습니다', error.name);
  }

  for (const listener of listeners) {
    try {
      listener({ choice: currentChoice, resolved });
    } catch (error) {
      console.error('[theme] 구독자 콜백에서 오류가 났습니다', error.name);
    }
  }
}

/** 테마를 명시적으로 고른다(`auto`/`light`/`dark`). 저장 + 즉시 반영까지 한다. */
export function setThemeChoice(raw) {
  currentChoice = normalizeChoice(raw);
  writeStoredChoice(currentChoice);
  applyToDocument();
}

/** 토글 버튼 한 번 탭: auto → light → dark → auto. */
export function cycleTheme() {
  setThemeChoice(nextChoice(currentChoice));
  return currentChoice;
}

/** 테마가 바뀔 때마다 알림받는다({choice, resolved}). 구독 해제 함수를 돌려준다. */
export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 부팅 시 한 번 호출한다(가능한 한 이르게 — `main.js` 맨 앞). 저장된 선택을 읽고,
 * 시스템 설정 변화를 구독하고, 즉시 반영한다.
 */
export function initTheme() {
  currentChoice = readStoredChoice();
  try {
    mediaQuery = window.matchMedia?.(DARK_QUERY) ?? null;
    mediaQuery?.addEventListener?.('change', () => {
      // auto일 때만 시스템 변화가 실제로 화면에 영향을 준다 — 그래도 재계산해서 알려 준다.
      applyToDocument();
    });
  } catch (error) {
    console.error('[theme] 시스템 다크 모드 변화를 구독하지 못했습니다', error.name);
  }
  applyToDocument();
}
