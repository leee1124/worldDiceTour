/**
 * 안내 카드 시간표(순수 로직) 테스트.
 *
 * 오너 피드백: "PC 버전은 너무 빠르게 지나가서 뭐가 뭔지 확인이 잘 안 됨."
 * 규칙: **읽는 시간은 모션 축소로 줄이지 않는다**(모션 축소는 움직임만 없앤다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISMISS_HINT,
  FAILSAFE_MAX_MS,
  LINE_READ_MS,
  NOTICE_KINDS,
  noticeTiming,
  remainingLabel,
} from '../../public/js/domain/noticeTiming.js';

test('안내 시간표: 내 좌석의 행운 티켓 카드는 3.5초 이상 읽을 시간을 준다', () => {
  // Given 내 좌석이 뽑은 행운 티켓
  // When 시간표를 물어보면
  const timing = noticeTiming({ kind: NOTICE_KINDS.TICKET, mine: true });

  // Then 카드로 보여 주고 읽는 시간은 3.5초 이상이다
  assert.equal(timing.mode, 'card');
  assert.ok(timing.readMs >= 3500, `내 티켓 카드가 너무 짧다: ${timing.readMs}ms`);
});

test('안내 시간표: 남·컴퓨터의 티켓 카드도 2.5초 이상 보여 준다', () => {
  // Given 다른 좌석(컴퓨터 포함)이 뽑은 티켓
  // When
  const timing = noticeTiming({ kind: NOTICE_KINDS.TICKET, mine: false });

  // Then
  assert.equal(timing.mode, 'card');
  assert.ok(timing.readMs >= 2500, `남의 티켓 카드가 너무 짧다: ${timing.readMs}ms`);
});

test('안내 시간표: 통행료 안내는 2.5초 이상 머문다', () => {
  // Given 통행료 안내
  // When
  const others = noticeTiming({ kind: NOTICE_KINDS.TOLL, mine: false });
  const mine = noticeTiming({ kind: NOTICE_KINDS.TOLL, mine: true });

  // Then 내가 낸 통행료는 더 길게, 남의 것도 2.5초 이상
  assert.ok(others.readMs >= 2500, `통행료 안내가 너무 짧다: ${others.readMs}ms`);
  assert.ok(mine.readMs >= others.readMs);
});

test('안내 시간표: 조난 결과·월급·바퀴·잭팟 안내는 2초 이상 머문다', () => {
  // Given 금액/상태 변화 안내들
  for (const kind of [NOTICE_KINDS.ISLAND, NOTICE_KINDS.SALARY, NOTICE_KINDS.LAP, NOTICE_KINDS.JACKPOT]) {
    // When 내 좌석 기준 시간표를 물어보면
    const timing = noticeTiming({ kind, mine: true });

    // Then 2초 이상이다
    assert.ok(timing.readMs >= 2000, `${kind} 안내가 너무 짧다: ${timing.readMs}ms`);
  }
});

test('안내 시간표: 모션 축소를 켜도 읽는 시간은 절대 줄어들지 않는다(예전 버그)', () => {
  // Given 같은 안내를 모션 축소 켬/끔으로 각각 물어본다
  for (const kind of Object.values(NOTICE_KINDS)) {
    for (const mine of [true, false]) {
      // When
      const normal = noticeTiming({ kind, mine, reducedMotion: false });
      const reduced = noticeTiming({ kind, mine, reducedMotion: true });

      // Then 읽는 시간과 페일세이프가 똑같다(모션 축소는 움직임만 없앤다)
      assert.equal(reduced.readMs, normal.readMs, `${kind}/${mine} 읽는 시간이 줄었다`);
      assert.equal(reduced.failsafeMs, normal.failsafeMs, `${kind}/${mine} 페일세이프가 줄었다`);
    }
  }
});

test('안내 시간표: 모션 축소에서는 진행 바 애니메이션만 끄고 남은 시간을 글자로 알린다', () => {
  // Given 모션 축소 설정
  // When
  const reduced = noticeTiming({ kind: NOTICE_KINDS.TICKET, mine: true, reducedMotion: true });
  const normal = noticeTiming({ kind: NOTICE_KINDS.TICKET, mine: true, reducedMotion: false });

  // Then 진행 바는 움직이지 않지만 시간은 그대로다
  assert.equal(normal.showProgress, true);
  assert.equal(reduced.showProgress, false);
  assert.equal(reduced.readMs, normal.readMs);
});

test('안내 시간표: 빨리 감기 중에는 카드 대신 한 줄 안내로 바꿔 정보를 버리지 않는다', () => {
  // Given 재생이 밀려 빨리 감기로 전환된 상태
  // When
  const timing = noticeTiming({ kind: NOTICE_KINDS.TICKET, mine: true, fastForward: true });

  // Then 전체 화면 카드가 아니라 한 줄로 보여 준다(정보는 남는다)
  assert.equal(timing.mode, 'line');
  assert.equal(timing.readMs, LINE_READ_MS);
});

test('안내 시간표: 남의 월급·바퀴 안내는 한 줄로 줄여 컴퓨터 턴의 속도를 지킨다', () => {
  // Given 남(컴퓨터)의 월급·바퀴 안내
  for (const kind of [NOTICE_KINDS.SALARY, NOTICE_KINDS.LAP]) {
    // When
    const others = noticeTiming({ kind, mine: false });
    const mine = noticeTiming({ kind, mine: true });

    // Then 남의 것은 한 줄, 내 것은 카드다
    assert.equal(others.mode, 'line', `${kind}: 남의 안내가 카드다`);
    assert.equal(mine.mode, 'card', `${kind}: 내 안내가 카드가 아니다`);
  }
});

test('안내 시간표: 페일세이프는 읽는 시간보다 항상 길고 6초를 넘지 않는다', () => {
  // Given 모든 종류 · 내 것/남의 것 · 빨리 감기 조합
  for (const kind of Object.values(NOTICE_KINDS)) {
    for (const mine of [true, false]) {
      for (const fastForward of [true, false]) {
        // When
        const timing = noticeTiming({ kind, mine, fastForward });

        // Then 페일세이프가 읽는 시간보다 길고 상한을 넘지 않는다
        assert.ok(timing.failsafeMs > timing.readMs, `${kind} 페일세이프가 읽는 시간보다 짧다`);
        assert.ok(timing.failsafeMs <= FAILSAFE_MAX_MS, `${kind} 페일세이프가 상한을 넘었다`);
      }
    }
  }
});

test('안내 시간표: 모르는 종류가 와도 예외 없이 안전한 기본값을 돌려준다', () => {
  // Given 서버가 새 종류를 보냈다고 가정
  // When
  const timing = noticeTiming({ kind: 'SOMETHING_NEW', mine: true });

  // Then 카드 · 2초 이상 · 페일세이프가 있다
  assert.equal(timing.mode, 'card');
  assert.ok(timing.readMs >= 2000);
  assert.ok(timing.failsafeMs > timing.readMs);
});

test('안내 시간표: 인자가 없어도 예외 없이 동작한다', () => {
  // Given 잘못된 호출
  // When / Then
  assert.ok(noticeTiming().readMs >= 2000);
  assert.equal(noticeTiming().hint, DISMISS_HINT);
});

test('안내 시간표: 닫힘 안내 문구는 "탭하면 닫힘"이다', () => {
  // Given / When / Then 탭으로 닫을 수 있다는 것을 늘 알려 준다
  assert.equal(DISMISS_HINT, '탭하면 닫힘');
  assert.equal(noticeTiming({ kind: NOTICE_KINDS.TOLL }).hint, DISMISS_HINT);
});

test('안내 시간표: 남은 시간 글자는 초 단위로 읽기 쉽게 만든다', () => {
  // Given 3.5초 · 2초
  // When / Then
  assert.equal(remainingLabel(3500), '3.5초 후 닫힘');
  assert.equal(remainingLabel(2000), '2초 후 닫힘');
});
