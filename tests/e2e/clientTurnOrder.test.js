/**
 * "이번 라운드 남은 차례"(순수 로직) 테스트.
 *
 * 오너 피드백: 라운드가 언제 넘어가는지, 내 차례까지 몇 명 남았는지 화면에서 알 수 없었다.
 * 좌석 순서(`view.players`)와 지금 차례(`currentSeatId`)만으로 남은 차례를 만든다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { remainingTurnsOf, roundStartLine } from '../../public/js/domain/turnOrder.js';

const players = [
  { seatId: 's1', name: '철수' },
  { seatId: 's2', name: '영희' },
  { seatId: 's3', name: '민수' },
  { seatId: 's4', name: '지우' },
];

test('남은 차례: 지금 차례 뒤에 올 좌석을 순서대로 알려 준다', () => {
  // Given 네 명 중 두 번째(영희) 차례
  // When
  const remaining = remainingTurnsOf({ players, currentSeatId: 's2' });

  // Then 영희 뒤의 민수·지우가 순서대로 남는다(영희 자신은 지금 차례라 빠진다)
  assert.deepEqual(remaining.names, ['민수', '지우']);
  assert.equal(remaining.isLast, false);
  assert.equal(remaining.label, '이번 라운드 남은 차례: 민수, 지우');
});

test('남은 차례: 마지막 좌석 차례면 "이번 라운드 마지막 차례"라고 알려 준다', () => {
  // Given 마지막 좌석(지우) 차례
  // When
  const remaining = remainingTurnsOf({ players, currentSeatId: 's4' });

  // Then 남은 사람이 없다
  assert.deepEqual(remaining.names, []);
  assert.equal(remaining.isLast, true);
  assert.equal(remaining.label, '이번 라운드 마지막 차례');
});

test('남은 차례: 파산해 빠진 좌석은 세지 않는다', () => {
  // Given 민수가 파산했다
  const withDropout = [
    { seatId: 's1', name: '철수' },
    { seatId: 's2', name: '영희' },
    { seatId: 's3', name: '민수', eliminated: true },
    { seatId: 's4', name: '지우' },
  ];

  // When 영희 차례의 남은 차례를 보면
  const remaining = remainingTurnsOf({ players: withDropout, currentSeatId: 's2' });

  // Then 지우만 남는다
  assert.deepEqual(remaining.names, ['지우']);
  assert.equal(remaining.label, '이번 라운드 남은 차례: 지우');
});

test('남은 차례: 첫 좌석 차례에는 나머지 전원이 남는다', () => {
  // Given / When
  const remaining = remainingTurnsOf({ players, currentSeatId: 's1' });

  // Then
  assert.deepEqual(remaining.names, ['영희', '민수', '지우']);
  assert.equal(remaining.isLast, false);
});

test('남은 차례: 게임이 끝났으면 남은 차례를 말하지 않는다', () => {
  // Given 종료된 게임
  // When
  const remaining = remainingTurnsOf({ players, currentSeatId: 's2', isOver: true });

  // Then 빈 문구를 돌려준다(화면에서 줄 자체를 감춘다)
  assert.deepEqual(remaining.names, []);
  assert.equal(remaining.label, '');
});

test('남은 차례: 알 수 없는 좌석이나 빈 입력에도 예외 없이 안전한 값을 돌려준다', () => {
  // Given / When / Then
  assert.equal(remainingTurnsOf().label, '');
  assert.deepEqual(remainingTurnsOf({ players, currentSeatId: 'nope' }).names, []);
  assert.deepEqual(remainingTurnsOf({ players: null, currentSeatId: 's1' }).names, []);
  assert.equal(remainingTurnsOf({ players: [], currentSeatId: 's1' }).label, '');
});

test('남은 차례: 이름이 없는 좌석도 자리를 지킨다(빈 문자열로 사라지지 않는다)', () => {
  // Given 이름이 비어 온 좌석
  const odd = [{ seatId: 's1', name: '철수' }, { seatId: 's2' }];

  // When
  const remaining = remainingTurnsOf({ players: odd, currentSeatId: 's1' });

  // Then 대체 이름으로 한 자리를 차지한다
  assert.equal(remaining.names.length, 1);
  assert.equal(remaining.label, '이번 라운드 남은 차례: 이름 없음');
});

test('라운드 시작 로그: "N라운드 시작 · 전원 한 바퀴 완료"로 읽힌다', () => {
  // Given 3라운드로 넘어간 이벤트
  // When
  // Then 오너가 요청한 문구 그대로다
  assert.equal(roundStartLine(3), '3라운드 시작 · 전원 한 바퀴 완료');
  assert.equal(roundStartLine(1), '1라운드 시작 · 전원 한 바퀴 완료');
});

test('라운드 시작 로그: 라운드 값이 이상해도 문장이 깨지지 않는다', () => {
  // Given / When / Then
  assert.equal(roundStartLine(undefined), '새 라운드 시작 · 전원 한 바퀴 완료');
  assert.equal(roundStartLine(0), '새 라운드 시작 · 전원 한 바퀴 완료');
});
