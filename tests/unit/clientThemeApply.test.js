/**
 * 테마 적용기(`public/js/theme.js`) 테스트 — DOM · localStorage · matchMedia를 최소한의
 * 가짜 객체로 흉내 내어 검증한다(브라우저 없이, `node --test`만으로).
 *
 * 규칙 자체(auto/light/dark 계산)는 `domain/themePreference.js`가 순수 함수로 이미
 * 검증하므로(`clientTheme.test.js`), 여기서는 그 규칙을 DOM에 "제대로 옮겨 붙이는지"만 본다.
 *
 * 주의 1: `theme.js`는 모듈 하나에 상태(currentChoice · mediaQuery 등)를 담는 싱글턴이라
 * 이 파일의 모든 테스트가 같은 인스턴스를 공유한다.
 * 주의 2: `mediaQuery`(구독 중인 MediaQueryList)는 `initTheme()`을 호출해야만 새로 고쳐진다
 * — 그래서 모든 테스트는 `setGlobals()`로 가짜 window/document를 심은 뒤 반드시
 * `initTheme()`을 먼저 불러 "이번 테스트의" matchMedia로 상태를 리셋하고 시작한다
 * (그러지 않으면 이전 테스트의 시스템 다크 설정이 새어 들어온다).
 * 주의 3: `onThemeChange` 구독은 테스트가 끝나면 반드시 해지한다(다음 테스트로 새지 않게).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { cycleTheme, initTheme, onThemeChange, resolvedTheme, setThemeChoice, themeChoice } from '../../public/js/theme.js';

/** 가짜 localStorage. `throwOn`을 지정하면 그 메서드 호출 시 예외를 던진다(사파리 프라이빗 모드 흉내). */
function fakeLocalStorage({ initial = null, throwOn = null } = {}) {
  let stored = initial;
  return {
    getItem(key) {
      if (throwOn === 'getItem') {
        throw new DOMException('private mode', 'SecurityError');
      }
      return key === 'wdt.theme' ? stored : null;
    },
    setItem(key, value) {
      if (throwOn === 'setItem') {
        throw new DOMException('private mode', 'SecurityError');
      }
      if (key === 'wdt.theme') {
        stored = value;
      }
    },
  };
}

/** 가짜 matchMedia. */
function fakeMatchMedia(systemDark) {
  const listeners = [];
  return {
    query: {
      matches: systemDark,
      addEventListener: (type, cb) => listeners.push(cb),
    },
    fire() {
      for (const cb of listeners) {
        cb();
      }
    },
  };
}

/** 가짜 document. */
function fakeDocument() {
  const meta = { content: 'light dark', setAttribute(name, value) { this.content = value; } };
  const root = { dataset: {}, style: {} };
  return {
    documentElement: root,
    querySelector: (selector) => (selector === 'meta[name="color-scheme"]' ? meta : null),
    _meta: meta,
    _root: root,
  };
}

/**
 * 가짜 window/document를 심고 `initTheme()`으로 모듈 상태(currentChoice · mediaQuery)를
 * 이번 테스트 것으로 리셋한다. 그 뒤 필요하면 `setThemeChoice()`로 원하는 선택을 덮어쓴다.
 */
function setGlobals({ systemDark = false, storage = fakeLocalStorage() } = {}) {
  const doc = fakeDocument();
  const media = fakeMatchMedia(systemDark);
  globalThis.window = { localStorage: storage, matchMedia: () => media.query };
  globalThis.document = doc;
  initTheme();
  return { doc, media, storage };
}

test('테마 적용: 수동으로 dark를 고르면 html에 data-theme="dark"가 심긴다', () => {
  // Given 시스템은 라이트를 선호하는 상태
  const { doc } = setGlobals({ systemDark: false });

  // When 수동으로 dark를 고르면
  setThemeChoice('dark');

  // Then data-theme이 dark로 심기고, color-scheme도 dark로 맞춰진다
  assert.equal(doc._root.dataset.theme, 'dark');
  assert.equal(doc._root.style.colorScheme, 'dark');
  assert.equal(doc._meta.content, 'dark');
});

test('테마 적용: 수동으로 light를 고르면 data-theme="light"가 심긴다', () => {
  // Given 시스템은 다크를 선호하는 상태(수동 선택이 이겨야 한다)
  const { doc } = setGlobals({ systemDark: true });

  // When 수동으로 light를 고르면
  setThemeChoice('light');

  // Then 시스템 설정과 무관하게 light로 고정된다
  assert.equal(doc._root.dataset.theme, 'light');
  assert.equal(doc._root.style.colorScheme, 'light');
  assert.equal(doc._meta.content, 'light');
});

test('테마 적용: auto를 고르면 data-theme 속성 자체를 지운다(미디어쿼리에 맡긴다)', () => {
  // Given 앞서 수동으로 dark를 골라 data-theme이 남아 있는 상태
  const { doc } = setGlobals({ systemDark: false });
  setThemeChoice('dark');
  assert.equal(doc._root.dataset.theme, 'dark');

  // When auto로 되돌리면
  setThemeChoice('auto');

  // Then data-theme 속성이 사라진다
  assert.equal(doc._root.dataset.theme, undefined);
});

test('테마 적용: auto일 때는 시스템 다크 선호를 그대로 따른다', () => {
  // Given 시스템이 다크를 선호함
  const { doc } = setGlobals({ systemDark: true });

  // When auto로 두면
  setThemeChoice('auto');

  // Then 실제로는 dark로 반영된다(색-scheme도 dark)
  assert.equal(doc._root.dataset.theme, undefined);
  assert.equal(doc._root.style.colorScheme, 'dark');
  assert.equal(resolvedTheme(), 'dark');
});

test('초기화: localStorage에 저장된 값이 없으면 auto로 시작한다', () => {
  // Given 저장된 적 없는 첫 방문(빈 스토리지), 시스템은 라이트 선호
  // When 부팅 시 초기화하면(setGlobals 안에서 initTheme을 호출한다)
  setGlobals({ systemDark: false, storage: fakeLocalStorage({ initial: null }) });

  // Then 선택값은 auto이고, 실제 반영은 라이트(시스템을 따름)
  assert.equal(themeChoice(), 'auto');
  assert.equal(resolvedTheme(), 'light');
});

test('초기화: 저장된 값이 dark면 그대로 이어받는다', () => {
  // Given 지난번에 dark를 저장해 둔 상태, 시스템은 라이트 선호
  // When 초기화하면
  setGlobals({ systemDark: false, storage: fakeLocalStorage({ initial: 'dark' }) });

  // Then dark를 그대로 이어받는다(시스템이 라이트를 선호해도)
  assert.equal(themeChoice(), 'dark');
  assert.equal(resolvedTheme(), 'dark');
});

test('초기화: 저장된 값이 알 수 없는 값(구버전·오타)이면 auto로 취급한다', () => {
  // Given 손상된 저장값, 시스템은 다크 선호
  // When 초기화하면
  setGlobals({ systemDark: true, storage: fakeLocalStorage({ initial: 'sepia' }) });

  // Then auto로 정규화되고, 시스템(다크)을 따른다
  assert.equal(themeChoice(), 'auto');
  assert.equal(resolvedTheme(), 'dark');
});

test('초기화: localStorage 읽기가 예외를 던져도(프라이빗 모드) 죽지 않고 auto로 안전하게 떨어진다', () => {
  // Given getItem이 예외를 던지는 스토리지(사파리 프라이빗 모드 흉내)
  const doc = fakeDocument();
  const media = fakeMatchMedia(false);
  globalThis.window = { localStorage: fakeLocalStorage({ throwOn: 'getItem' }), matchMedia: () => media.query };
  globalThis.document = doc;

  // When / Then 예외 없이 초기화되고 auto로 떨어진다
  assert.doesNotThrow(() => initTheme());
  assert.equal(themeChoice(), 'auto');
});

test('저장 실패: localStorage 쓰기가 예외를 던져도 화면 반영은 계속된다', () => {
  // Given setItem이 예외를 던지는 스토리지
  const doc = fakeDocument();
  const media = fakeMatchMedia(false);
  globalThis.window = { localStorage: fakeLocalStorage({ throwOn: 'setItem' }), matchMedia: () => media.query };
  globalThis.document = doc;
  initTheme();

  // When / Then 예외 없이 선택이 적용된다(저장만 실패, 화면 반영은 살아 있다)
  assert.doesNotThrow(() => setThemeChoice('dark'));
  assert.equal(doc._root.dataset.theme, 'dark');
});

test('순환: 버튼을 계속 누르면 auto → light → dark → auto로 돌고, 매번 저장된다', () => {
  // Given auto로 시작
  const { storage } = setGlobals({ systemDark: false });
  setThemeChoice('auto');

  // When 세 번 순환시키면
  const first = cycleTheme();
  const second = cycleTheme();
  const third = cycleTheme();

  // Then auto → light → dark → auto 순서이고, 마지막 값이 저장돼 있다
  assert.deepEqual([first, second, third], ['light', 'dark', 'auto']);
  assert.equal(storage.getItem('wdt.theme'), 'auto');
});

test('구독: onThemeChange 콜백이 선택값과 실제 반영 테마를 함께 받는다', () => {
  // Given 시스템은 다크를 선호
  setGlobals({ systemDark: true });
  const received = [];
  const unsubscribe = onThemeChange((payload) => received.push(payload));

  try {
    // When auto 상태에서 light로 바꾸면
    setThemeChoice('auto');
    setThemeChoice('light');

    // Then 콜백이 두 번 불리고, 각각 선택값·반영 테마가 맞다
    assert.deepEqual(received.at(-2), { choice: 'auto', resolved: 'dark' });
    assert.deepEqual(received.at(-1), { choice: 'light', resolved: 'light' });
  } finally {
    unsubscribe();
  }
});

test('구독 해지: unsubscribe 이후에는 콜백이 더 이상 불리지 않는다', () => {
  // Given 구독했다가 바로 해지한 상태
  setGlobals({ systemDark: false });
  let callCount = 0;
  const unsubscribe = onThemeChange(() => {
    callCount += 1;
  });
  unsubscribe();

  // When 테마를 바꿔도
  setThemeChoice('dark');
  setThemeChoice('light');

  // Then 콜백은 한 번도 불리지 않는다
  assert.equal(callCount, 0);
});

test('시스템 변화 구독: addEventListener가 없는 오래된 MediaQueryList도(addListener) 지원한다', () => {
  // Given addEventListener 없이 addListener만 있는 예전 MediaQueryList 흉내
  const listeners = [];
  const legacyQuery = {
    matches: false,
    addListener: (cb) => listeners.push(cb),
  };
  globalThis.window = {
    localStorage: fakeLocalStorage({ initial: 'auto' }),
    matchMedia: () => legacyQuery,
  };
  globalThis.document = fakeDocument();

  // When 초기화하면(예외 없이 addListener 경로를 타야 한다)
  assert.doesNotThrow(() => initTheme());

  // Then 실제로 리스너가 등록된다
  assert.equal(listeners.length, 1);
});
