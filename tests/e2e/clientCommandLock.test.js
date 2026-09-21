import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandLock } from '../../public/js/domain/commandLock.js';

test('커맨드 잠금: 전송하면 즉시 잠긴다', () => {
  // Given 막 만든 잠금
  const lock = createCommandLock();
  assert.equal(lock.locked, false);

  // When 커맨드를 보내면
  lock.onSend(5);

  // Then 잠긴다
  assert.equal(lock.locked, true);
});

test('커맨드 잠금: 성공해도 더 최신 버전이 올 때까지 잠금이 유지된다', () => {
  // Given 버전 5에서 커맨드를 보내 성공 응답을 받은 상태
  const lock = createCommandLock();
  lock.onSend(5);
  lock.onSuccess();
  assert.equal(lock.locked, true);

  // When 같은 버전(아직 연출/스트림 반영 전)이 도착하면
  lock.onView(5);

  // Then 여전히 잠겨 있다
  assert.equal(lock.locked, true);

  // When 실제로 더 최신 버전이 도착하면
  lock.onView(6);

  // Then 그제서야 풀린다
  assert.equal(lock.locked, false);
});

test('커맨드 잠금: 실패하면 즉시 풀린다', () => {
  // Given 커맨드가 전송된 상태
  const lock = createCommandLock();
  lock.onSend(5);

  // When 서버가 에러를 돌려주면
  lock.onError();

  // Then 바로 풀려서 다시 시도할 수 있다
  assert.equal(lock.locked, false);
});

test('커맨드 잠금: 스냅샷 재동기화가 오면 버전과 무관하게 즉시 풀린다', () => {
  // Given 성공 응답을 받고 다음 버전을 기다리는 중
  const lock = createCommandLock();
  lock.onSend(5);
  lock.onSuccess();
  assert.equal(lock.locked, true);

  // When 재접속 스냅샷으로 화면을 강제로 맞추면(다음 버전이 아직 안 왔어도)
  lock.onResync();

  // Then 즉시 풀린다
  assert.equal(lock.locked, false);
});

test('커맨드 잠금: 보낼 때보다 오래되거나 같은 버전은 무시한다', () => {
  // Given 버전 10에서 보내 성공한 상태
  const lock = createCommandLock();
  lock.onSend(10);
  lock.onSuccess();

  // When 더 오래된 버전(재정렬된 SSE)이 도착하면
  lock.onView(3);

  // Then 무시하고 계속 잠겨 있다
  assert.equal(lock.locked, true);

  // When 정수가 아닌 값이 도착해도
  lock.onView(undefined);

  // Then 역시 무시한다
  assert.equal(lock.locked, true);
});

test('커맨드 잠금: 보내기 전(IDLE)에 뷰가 와도 아무 효과가 없다', () => {
  // Given 아무 커맨드도 보내지 않은 상태
  const lock = createCommandLock();

  // When 뷰 갱신이 도착해도
  lock.onView(99);

  // Then 계속 풀려 있다(전송한 적이 없으므로 잠글 이유가 없다)
  assert.equal(lock.locked, false);
});

test('SSE의 새 버전이 POST 응답보다 먼저 도착해도 잠금이 영구히 남지 않는다', () => {
  // Given — 버전 3에서 커맨드를 보냈다
  const lock = createCommandLock();
  lock.onSend(3);

  // When — 응답보다 먼저 SSE로 버전 4가 반영되고, 그 뒤에 POST 성공 응답이 도착한다
  lock.onView(4);
  lock.onSuccess();

  // Then — 이미 새 버전을 봤으므로 더 기다릴 것이 없다
  assert.equal(lock.locked, false);
});

test('응답이 먼저 오고 새 버전이 나중에 오는 순서에서는 새 버전이 올 때까지 잠근다', () => {
  // Given
  const lock = createCommandLock();
  lock.onSend(3);

  // When
  lock.onSuccess();

  // Then
  assert.equal(lock.locked, true);
  lock.onView(4);
  assert.equal(lock.locked, false);
});
