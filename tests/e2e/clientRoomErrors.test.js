import test from 'node:test';
import assert from 'node:assert/strict';

import { isRoomGoneError } from '../../public/js/domain/roomErrors.js';

test('방 소멸 판별: ERR004면 방이 사라진 것이다', () => {
  // Given 서버가 준 방 없음 에러
  const error = { code: 'ERR004', message: '방을 찾을 수 없습니다.' };

  // When 판별하면
  // Then true
  assert.equal(isRoomGoneError(error), true);
});

test('방 소멸 판별: 다른 에러 코드는 아니다', () => {
  // Given 다른 규격 에러(예: 내 차례가 아님)
  const error = { code: 'ERR006', message: '당신의 차례가 아닙니다.' };

  // When 판별하면
  // Then false
  assert.equal(isRoomGoneError(error), false);
});

test('방 소멸 판별: 에러가 없거나 코드가 없어도 예외 없이 false', () => {
  // Given 에러 객체 자체가 없거나 code가 없는 경우
  // When 판별하면
  // Then 예외 없이 false
  assert.equal(isRoomGoneError(null), false);
  assert.equal(isRoomGoneError(undefined), false);
  assert.equal(isRoomGoneError({}), false);
});
