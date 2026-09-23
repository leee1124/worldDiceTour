/**
 * 테마(다크/라이트/자동) 선택 로직(순수 함수) 테스트.
 *
 * 왜 순수 함수로 분리하는가: `resolveTheme`/`normalizeChoice`/`nextChoice`는 DOM·localStorage·
 * matchMedia에 전혀 손대지 않는다 — 실제 적용(`public/js/theme.js`)은 이 표를 그대로 따르기만
 * 하면 되고, 규칙 자체는 브라우저 없이도 여기서 전부 검증할 수 있다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeChoice, nextChoice, resolveTheme } from '../../public/js/domain/themePreference.js';

/* ── resolveTheme ───────────────────────────────────────────── */

test('테마 결정: choice가 dark이면 시스템 설정과 무관하게 항상 dark다', () => {
  // Given 사용자가 다크를 직접 골랐다
  // When 시스템이 라이트든 다크든
  // Then 항상 dark
  assert.equal(resolveTheme({ choice: 'dark', systemDark: true }), 'dark');
  assert.equal(resolveTheme({ choice: 'dark', systemDark: false }), 'dark');
});

test('테마 결정: choice가 light이면 시스템 설정과 무관하게 항상 light다', () => {
  // Given 사용자가 라이트를 직접 골랐다
  // When 시스템이 라이트든 다크든
  // Then 항상 light
  assert.equal(resolveTheme({ choice: 'light', systemDark: true }), 'light');
  assert.equal(resolveTheme({ choice: 'light', systemDark: false }), 'light');
});

test('테마 결정: choice가 auto이면 시스템 설정을 그대로 따른다', () => {
  // Given 사용자가 자동을 골랐다(기본값)
  // When 시스템이 다크를 선호하면 / Then dark
  assert.equal(resolveTheme({ choice: 'auto', systemDark: true }), 'dark');
  // When 시스템이 라이트를 선호하면(또는 선호를 모르면) / Then light
  assert.equal(resolveTheme({ choice: 'auto', systemDark: false }), 'light');
});

test('테마 결정: 잘못되거나 알 수 없는 choice는 auto처럼 시스템을 따른다', () => {
  // Given 저장된 값이 깨졌거나(오타·구버전) 아예 없는 경우
  // When 시스템이 다크를 선호하면 / Then 자동과 같은 결과(dark)
  assert.equal(resolveTheme({ choice: 'sepia', systemDark: true }), 'dark');
  assert.equal(resolveTheme({ choice: undefined, systemDark: true }), 'dark');
  assert.equal(resolveTheme({ choice: null, systemDark: false }), 'light');
});

test('테마 결정: systemDark이 없거나 예외적인 값이어도 light로 안전하게 떨어진다', () => {
  // Given systemDark 인자가 비어 있음(matchMedia를 못 쓰는 환경)
  // When auto로 판단하면
  // Then light를 기본으로 삼는다(예외를 던지지 않는다)
  assert.equal(resolveTheme({ choice: 'auto' }), 'light');
  assert.equal(resolveTheme({}), 'light');
  assert.equal(resolveTheme(), 'light');
});

/* ── normalizeChoice ────────────────────────────────────────── */

test('선택값 정규화: auto/light/dark는 그대로 통과한다', () => {
  // Given / When / Then
  assert.equal(normalizeChoice('auto'), 'auto');
  assert.equal(normalizeChoice('light'), 'light');
  assert.equal(normalizeChoice('dark'), 'dark');
});

test('선택값 정규화: 대소문자·공백이 섞여도 알아본다', () => {
  // Given localStorage에 사람이 손으로 넣었거나 과거 포맷이 섞인 값
  // When 정규화하면
  // Then 표준 값으로 맞춰진다
  assert.equal(normalizeChoice('DARK'), 'dark');
  assert.equal(normalizeChoice(' Light '), 'light');
  assert.equal(normalizeChoice('Auto'), 'auto');
});

test('선택값 정규화: 알 수 없는 값·빈 값·잘못된 타입은 auto로 떨어진다', () => {
  // Given 손상된 저장값(구버전 키, 오타, null 등)
  // When 정규화하면
  // Then 항상 auto(가장 안전한 기본값)
  assert.equal(normalizeChoice('sepia'), 'auto');
  assert.equal(normalizeChoice(''), 'auto');
  assert.equal(normalizeChoice(null), 'auto');
  assert.equal(normalizeChoice(undefined), 'auto');
  assert.equal(normalizeChoice(42), 'auto');
  assert.equal(normalizeChoice({}), 'auto');
});

/* ── nextChoice(순환) ───────────────────────────────────────── */

test('선택 순환: auto → light → dark → auto 순서로 돈다', () => {
  // Given 순환 시작점
  // When 한 단계씩 다음 값을 물으면
  // Then auto → light → dark → auto로 돌아온다
  assert.equal(nextChoice('auto'), 'light');
  assert.equal(nextChoice('light'), 'dark');
  assert.equal(nextChoice('dark'), 'auto');
});

test('선택 순환: 알 수 없는 값에서 시작해도 auto 다음(light)으로 안전하게 이어진다', () => {
  // Given 손상된 선택값
  // When 다음 값을 물으면
  // Then 정규화를 거쳐 auto로 취급되고 그 다음인 light가 나온다
  assert.equal(nextChoice('sepia'), 'light');
  assert.equal(nextChoice(undefined), 'light');
});

test('선택 순환: 세 번 돌리면 원래 값으로 돌아온다', () => {
  // Given 임의의 시작 값들
  for (const start of ['auto', 'light', 'dark']) {
    // When 세 번 nextChoice를 적용하면
    const cycled = nextChoice(nextChoice(nextChoice(start)));
    // Then 제자리로 돌아온다
    assert.equal(cycled, start, `${start}에서 세 바퀴 돌았는데 제자리가 아니다`);
  }
});
