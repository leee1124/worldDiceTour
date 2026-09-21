import test from 'node:test';
import assert from 'node:assert/strict';

import { inferGameOverReason } from '../../public/js/domain/gameOverReason.js';

test('게임 종료 사유 추정: 아직 끝나지 않은 게임이면 null', () => {
  // Given 진행 중인 게임 뷰
  const view = { isOver: false, round: 3, roundLimit: null, players: [] };

  // When 사유를 추정하면
  // Then 아무 것도 없다
  assert.equal(inferGameOverReason(view), null);
});

test('게임 종료 사유 추정: 뷰가 없어도 예외 없이 null', () => {
  // Given 뷰 자체가 없을 때(재접속 초기)
  // When 사유를 추정하면
  // Then 예외 없이 null
  assert.equal(inferGameOverReason(null), null);
  assert.equal(inferGameOverReason(undefined), null);
});

test('게임 종료 사유 추정: 생존자가 한 명 이하면 마지막 생존자', () => {
  // Given 종료된 게임에서 한 명만 파산하지 않은 상태
  const view = {
    isOver: true,
    round: 5,
    roundLimit: null,
    players: [
      { eliminated: true },
      { eliminated: false },
      { eliminated: true },
    ],
  };

  // When 사유를 추정하면
  // Then LAST_SURVIVOR
  assert.equal(inferGameOverReason(view), 'LAST_SURVIVOR');
});

test('게임 종료 사유 추정: 라운드 제한을 넘겼고 생존자가 여럿이면 라운드 제한', () => {
  // Given 라운드 제한(20)을 넘겨 끝났고 두 명 이상 생존한 상태
  const view = {
    isOver: true,
    round: 21,
    roundLimit: 20,
    players: [
      { eliminated: false },
      { eliminated: false },
    ],
  };

  // When 사유를 추정하면
  // Then ROUND_LIMIT
  assert.equal(inferGameOverReason(view), 'ROUND_LIMIT');
});

test('게임 종료 사유 추정: 생존자 1명 이하가 라운드 제한보다 우선한다', () => {
  // Given 라운드 제한도 넘겼지만 동시에 생존자가 1명뿐인 경우(서버가 먼저 LAST_SURVIVOR로 끝냄)
  const view = {
    isOver: true,
    round: 21,
    roundLimit: 20,
    players: [{ eliminated: false }, { eliminated: true }],
  };

  // When 사유를 추정하면
  // Then LAST_SURVIVOR가 우선한다
  assert.equal(inferGameOverReason(view), 'LAST_SURVIVOR');
});

test('게임 종료 사유 추정: 어느 조건도 안 맞으면 null(호출부가 부제 없이 넘어간다)', () => {
  // Given 종료됐지만 라운드 제한도 없고 생존자도 여럿인 애매한 스냅샷
  const view = {
    isOver: true,
    round: 5,
    roundLimit: null,
    players: [{ eliminated: false }, { eliminated: false }],
  };

  // When 사유를 추정하면
  // Then 알 수 없으므로 null
  assert.equal(inferGameOverReason(view), null);
});
