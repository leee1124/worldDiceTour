/**
 * 슬롯 심볼 계약 테스트.
 *
 * 서버(`src/domain/game/Casino.js`)는 이모지 문자열을 심볼 id로 그대로 이벤트에 실어 보낸다.
 * 화면은 이모지 폰트 대신 SVG/글자 글리프로 그리기 위해 `slotSymbols.js`에서 한 번 옮겨 담는데,
 * 서버 목록이 늘어나거나 바뀌면 이 매핑이 조용히 깨질 수 있으므로 항상 함께 검증한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLOT_SYMBOLS } from '../../src/domain/game/Casino.js';
import { SLOT_SYMBOL_KINDS, slotSymbolKind, slotSymbolLabel } from '../../public/js/domain/slotSymbols.js';

test('슬롯 심볼: 서버가 보내는 심볼마다 화면이 아는 종류가 있다', () => {
  // Given 서버가 실제로 쓰는 슬롯 심볼 목록
  // When 각 심볼의 종류를 조회하면
  // Then 하나도 빠짐없이 'UNKNOWN'이 아니다
  for (const serverSymbol of SLOT_SYMBOLS) {
    const kind = slotSymbolKind(serverSymbol);
    assert.notEqual(kind, 'UNKNOWN', `매핑이 없는 서버 심볼: ${JSON.stringify(serverSymbol)}`);
  }
});

test('슬롯 심볼: 매핑 표에 서버 심볼 개수와 정확히 같은 종류가 있다(중복·누락 없음)', () => {
  // Given 서버 심볼 목록과 클라이언트 매핑 표
  // When 개수를 비교하면
  // Then 서로 정확히 일치한다(하나라도 늘거나 줄면 이 테스트가 먼저 깨진다)
  assert.equal(Object.keys(SLOT_SYMBOL_KINDS).length, SLOT_SYMBOLS.length);
  for (const serverSymbol of SLOT_SYMBOLS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(SLOT_SYMBOL_KINDS, serverSymbol),
      `매핑 표에 없는 서버 심볼: ${JSON.stringify(serverSymbol)}`,
    );
  }
});

test('슬롯 심볼: 알 수 없는 종류는 조회 함수가 예외 없이 안전한 기본값을 준다', () => {
  // Given 서버에 없는 값
  // When 종류·이름을 조회하면
  // Then 예외 없이 기본값이 나온다
  assert.equal(slotSymbolKind('알 수 없는 값'), 'UNKNOWN');
  assert.equal(slotSymbolLabel('알 수 없는 값'), '알 수 없음');
  assert.equal(slotSymbolKind(undefined), 'UNKNOWN');
});

test('슬롯 심볼: 각 심볼마다 화면에 보여 줄 한국어 이름이 있다', () => {
  // Given 서버 심볼 목록
  // When 한국어 이름을 조회하면
  // Then 모두 빈 문자열이 아니다
  for (const serverSymbol of SLOT_SYMBOLS) {
    const label = slotSymbolLabel(serverSymbol);
    assert.equal(typeof label, 'string');
    assert.ok(label.length > 0, `이름이 없는 서버 심볼: ${JSON.stringify(serverSymbol)}`);
  }
});
