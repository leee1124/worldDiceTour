import test from 'node:test';
import assert from 'node:assert/strict';

import { isMySeat, isMySeatOnAutopilot, isMyTurn } from '../../public/js/store.js';

/** 행동 버튼 활성화의 유일한 기준(store.js 주석)이 되는 세 선택자를 검증한다. */

function makeState({ mySeatIds = [], seats = [], currentSeatId = null, isOver = false }) {
  return {
    mySeats: mySeatIds.map((seatId) => ({ seatId, name: seatId })),
    room: { seats },
    view: { currentSeatId, isOver },
  };
}

test('내 좌석 선택자: 이 기기가 가진 좌석이면 true', () => {
  // Given 이 기기가 seat-1을 가진 상태
  const state = makeState({ mySeatIds: ['seat-1'] });

  // When 내 좌석인지 물으면
  // Then seat-1만 true다
  assert.equal(isMySeat(state, 'seat-1'), true);
  assert.equal(isMySeat(state, 'seat-2'), false);
});

test('내 좌석 선택자: 좌석 id가 없으면 false', () => {
  // Given 이 기기가 아무 좌석도 없는 상태
  const state = makeState({ mySeatIds: [] });

  // When null/undefined 좌석을 물으면
  // Then 항상 false(예외 없이)
  assert.equal(isMySeat(state, null), false);
  assert.equal(isMySeat(state, undefined), false);
});

test('내 차례 선택자: 내 좌석 + 내 차례면 true', () => {
  // Given 이 기기가 가진 seat-1이 지금 차례이고 자동 진행이 아닌 상태
  const state = makeState({
    mySeatIds: ['seat-1'],
    seats: [{ id: 'seat-1', autopilot: false }],
    currentSeatId: 'seat-1',
  });

  // When 내 차례인지 물으면
  // Then true
  assert.equal(isMyTurn(state), true);
  assert.equal(isMySeatOnAutopilot(state), false);
});

test('내 차례 선택자: 내 좌석이지만 자동 진행이면 조작할 수 없다', () => {
  // Given 이 기기가 가진 seat-1이 차례지만 자동 진행에 맡겨진 상태
  const state = makeState({
    mySeatIds: ['seat-1'],
    seats: [{ id: 'seat-1', autopilot: true }],
    currentSeatId: 'seat-1',
  });

  // When 내 차례인지 물으면
  // Then 조작은 못 하지만(false) 자동 진행 중임은 알 수 있다(true)
  assert.equal(isMyTurn(state), false);
  assert.equal(isMySeatOnAutopilot(state), true);
});

test('내 차례 선택자: 다른 기기 좌석의 차례는 false', () => {
  // Given 다른 기기가 가진 seat-2가 지금 차례인 상태
  const state = makeState({
    mySeatIds: ['seat-1'],
    seats: [
      { id: 'seat-1', autopilot: false },
      { id: 'seat-2', autopilot: false },
    ],
    currentSeatId: 'seat-2',
  });

  // When 내 차례인지 물으면
  // Then 세 선택자 모두 false다(내 좌석이 아니므로)
  assert.equal(isMySeat(state, 'seat-2'), false);
  assert.equal(isMyTurn(state), false);
  assert.equal(isMySeatOnAutopilot(state), false);
});

test('내 차례 선택자: 게임이 끝났으면 내 좌석 차례여도 false', () => {
  // Given 게임이 끝났지만 currentSeatId가 여전히 내 좌석으로 남아 있는 스냅샷
  const state = makeState({
    mySeatIds: ['seat-1'],
    seats: [{ id: 'seat-1', autopilot: false }],
    currentSeatId: 'seat-1',
    isOver: true,
  });

  // When 내 차례인지 물으면
  // Then false(더 이상 조작할 차례가 없다)
  assert.equal(isMyTurn(state), false);
});

test('내 차례 선택자: 핫시트(이 기기에 좌석이 여럿)에서도 각 좌석을 올바르게 구분한다', () => {
  // Given 이 기기가 seat-1과 seat-3을 함께 가진 핫시트 상태, 지금은 seat-3 차례
  const state = makeState({
    mySeatIds: ['seat-1', 'seat-3'],
    seats: [
      { id: 'seat-1', autopilot: false },
      { id: 'seat-2', autopilot: false },
      { id: 'seat-3', autopilot: false },
    ],
    currentSeatId: 'seat-3',
  });

  // When 두 로컬 좌석과 남의 좌석을 각각 물으면
  // Then 이 기기가 가진 좌석은 모두 내 좌석이고, 그중 지금 차례인 seat-3만 내 차례다
  assert.equal(isMySeat(state, 'seat-1'), true);
  assert.equal(isMySeat(state, 'seat-3'), true);
  assert.equal(isMySeat(state, 'seat-2'), false);
  assert.equal(isMyTurn(state), true);
});
