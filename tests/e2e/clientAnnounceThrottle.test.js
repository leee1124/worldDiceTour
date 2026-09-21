import test from 'node:test';
import assert from 'node:assert/strict';

import { THROTTLE_MS, createTurnAnnouncer } from '../../public/js/domain/announceThrottle.js';

test('턴 안내 제한: 이 기기의 좌석 차례는 매번 즉시 알린다', () => {
  // Given 새 안내기
  const announcer = createTurnAnnouncer();

  // When 내 좌석 차례가 연달아 여러 번 와도
  const first = announcer.shouldAnnounceTurn({ isLocalSeat: true, now: 1000 });
  const second = announcer.shouldAnnounceTurn({ isLocalSeat: true, now: 1001 });

  // Then 매번 알린다
  assert.equal(first, true);
  assert.equal(second, true);
});

test('턴 안내 제한: 다른 기기/컴퓨터 차례는 첫 번은 알리고 이후 제한 시간 안에는 막는다', () => {
  // Given 새 안내기
  const announcer = createTurnAnnouncer();

  // When 원격 차례가 짧은 간격으로 연달아 오면
  const first = announcer.shouldAnnounceTurn({ isLocalSeat: false, now: 0 });
  const second = announcer.shouldAnnounceTurn({ isLocalSeat: false, now: 800 });
  const third = announcer.shouldAnnounceTurn({ isLocalSeat: false, now: 1600 });

  // Then 처음만 알리고 나머지는 막는다(1초마다 오는 컴퓨터 진행 상황)
  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(third, false);
});

test('턴 안내 제한: 제한 시간이 지나면 원격 차례를 다시 한 번 알린다', () => {
  // Given 방금 원격 차례를 알린 안내기
  const announcer = createTurnAnnouncer();
  announcer.shouldAnnounceTurn({ isLocalSeat: false, now: 0 });

  // When 제한 시간(THROTTLE_MS)이 지난 뒤 다시 원격 차례가 오면
  const afterThrottle = announcer.shouldAnnounceTurn({ isLocalSeat: false, now: THROTTLE_MS });

  // Then 다시 알린다(burst당 최소 간격 조건 충족)
  assert.equal(afterThrottle, true);
});

test('턴 안내 제한: reset 후에는 원격 차례를 즉시 다시 알린다', () => {
  // Given 원격 차례를 막 알려서 제한 구간에 들어간 안내기
  const announcer = createTurnAnnouncer();
  announcer.shouldAnnounceTurn({ isLocalSeat: false, now: 0 });
  assert.equal(announcer.shouldAnnounceTurn({ isLocalSeat: false, now: 100 }), false);

  // When 게임 종료 등으로 reset하면
  announcer.reset();

  // Then 바로 다음 원격 차례는 다시 알린다
  assert.equal(announcer.shouldAnnounceTurn({ isLocalSeat: false, now: 150 }), true);
});
