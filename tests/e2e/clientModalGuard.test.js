/**
 * 결정 모달 안전망(순수 로직) 테스트.
 *
 * 오너 피드백: "카드가 뜰 때(카지노, 조난섬 탈출 등) 안 꺼지는 현상이 있음."
 * 규칙: 서버가 이미 다음 페이즈로 넘어갔다면, 연출 약속이 남아 있어도 결정 모달은 닫는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DECISION_MODAL_PHASES,
  STALE_MODAL_GRACE_MS,
  staleDecisionModalIds,
} from '../../public/js/domain/modalGuard.js';

test('모달 안전망: 페이즈가 카지노를 떠났으면 열려 있는 카지노 모달을 닫을 대상으로 고른다', () => {
  // Given 카지노 모달이 열려 있는데 서버 뷰는 이미 주사위 차례다
  const view = { phase: 'AWAIT_ROLL', pending: null };

  // When
  const stale = staleDecisionModalIds(['casino'], view);

  // Then 카지노 모달을 닫는다
  assert.deepEqual(stale, ['casino']);
});

test('모달 안전망: 같은 페이즈가 이어지는 동안에는 아무것도 닫지 않는다', () => {
  // Given 카지노 페이즈가 그대로다
  const view = { phase: 'AWAIT_CASINO', pending: { roundsLeft: 2 } };

  // When
  // Then 열려 있는 카지노 모달은 유지된다
  assert.deepEqual(staleDecisionModalIds(['casino'], view), []);
  assert.deepEqual(staleDecisionModalIds(['island'], { phase: 'AWAIT_ISLAND_CHOICE', pending: { kind: 'ISLAND' } }), []);
});

test('모달 안전망: 조난 섬 모달도 지불·탈출 뒤 페이즈가 바뀌면 닫는다', () => {
  // Given 구조비를 냈거나 탈출 굴림이 끝나 페이즈가 바뀐 뷰
  for (const phase of ['AWAIT_ROLL', 'AWAIT_BUY', 'AWAIT_BUILD']) {
    // When
    const stale = staleDecisionModalIds(['island'], { phase, pending: null });

    // Then
    assert.deepEqual(stale, ['island'], `${phase}에서 조난 모달이 남는다`);
  }
});

test('모달 안전망: pending 종류가 어긋나면(같은 페이즈라도) 닫는다', () => {
  // Given 건설 페이즈인데 pending은 매입 결정이다(뷰가 앞서 나간 경우)
  const view = { phase: 'AWAIT_BUILD', pending: { kind: 'BUY' } };

  // When
  const stale = staleDecisionModalIds(['build'], view);

  // Then 어긋난 모달은 닫는다
  assert.deepEqual(stale, ['build']);
});

test('모달 안전망: 정보 시트와 게임 종료 모달은 안전망이 건드리지 않는다', () => {
  // Given 칸 상세 시트 · 게임 종료 · 도시 목록 시트가 열려 있다
  const view = { phase: 'AWAIT_ROLL', pending: null };

  // When
  const stale = staleDecisionModalIds(['cell-sheet', 'game-over', 'owned-cities'], view);

  // Then 스스로 닫는 시트들은 그대로 둔다
  assert.deepEqual(stale, []);
});

test('모달 안전망: 게임이 끝나면 열려 있던 결정 모달을 모두 닫는다', () => {
  // Given 게임 종료 뷰
  const view = { phase: 'AWAIT_CASINO', isOver: true, pending: { roundsLeft: 1 } };

  // When
  const stale = staleDecisionModalIds(['casino', 'liquidation', 'cell-sheet'], view);

  // Then 결정 모달만 닫는다
  assert.deepEqual(stale, ['casino', 'liquidation']);
});

test('모달 안전망: 뷰가 없으면(방을 떠남 등) 결정 모달을 모두 닫는다', () => {
  // Given 뷰가 사라진 상태
  // When
  const stale = staleDecisionModalIds(['casino', 'buy', 'cell-sheet'], null);

  // Then
  assert.deepEqual(stale, ['casino', 'buy']);
});

test('모달 안전망: 모든 결정 모달이 감시 표에 등록돼 있다', () => {
  // Given 결정 페이즈를 가진 모달 id들
  const ids = ['buy', 'build', 'start-build', 'acquire', 'island', 'liquidation', 'casino', 'travel-confirm'];

  // When / Then 표에 빠짐없이 들어 있다(새 모달을 추가하면 이 테스트가 먼저 깨진다)
  for (const id of ids) {
    assert.ok(DECISION_MODAL_PHASES[id], `${id}가 안전망 표에 없다`);
  }
});

test('모달 안전망: 유예 시간은 연출을 지켜 주되 3초를 넘지 않는다', () => {
  // Given 검증 하네스는 "페이즈가 바뀐 뒤 3초 이상 열려 있는 결정 모달"을 STUCK으로 본다
  // When / Then 유예 시간이 그보다 짧다
  assert.ok(STALE_MODAL_GRACE_MS > 0);
  assert.ok(STALE_MODAL_GRACE_MS < 3000, `유예 시간이 너무 길다: ${STALE_MODAL_GRACE_MS}ms`);
});

test('모달 안전망: 잘못된 입력에도 예외 없이 빈 목록을 돌려준다', () => {
  // Given / When / Then
  assert.deepEqual(staleDecisionModalIds(), []);
  assert.deepEqual(staleDecisionModalIds(null, null), []);
  assert.deepEqual(staleDecisionModalIds([], { phase: 'AWAIT_ROLL' }), []);
  assert.deepEqual(staleDecisionModalIds(['unknown-modal'], { phase: 'AWAIT_ROLL' }), []);
});
