/**
 * 상대 행동 알림(순수 로직) 테스트.
 *
 * 오너 피드백: "상대방이 뭘 하는지 로그 말고 토스트 메시지로 떴으면 좋겠음."
 * 로그는 흘러가 버리니, 남의 좌석이 한 일을 짧은 알림으로 한 번에 하나씩 띄운다.
 * 문구는 로그 포맷터(`eventLog.js`)를 그대로 재사용한다 — 같은 말을 두 곳에서 짓지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACQUIRED_MY_CITY_TTL_MS,
  DEFAULT_TTL_MS,
  coalesceNotices,
  opponentNoticeOf,
} from '../../public/js/domain/opponentNotice.js';

/** 테스트용 문맥: 내 좌석은 s1, 이름·칸 이름은 그대로 돌려준다. */
const ctx = {
  isLocalSeat: (seatId) => seatId === 's1',
  nameOf: (seatId) => ({ s1: '철수', s2: '컴퓨터1', s3: '컴퓨터2' })[seatId] ?? '알 수 없음',
  spaceNameOf: (index) => ({ 5: '부에노스아이레스', 9: '파리', 12: '서울' })[index] ?? `${index}번 칸`,
  ownerOf: (index) => (index === 12 ? 's1' : 's3'),
  lastDiceOf: () => null,
};

test('상대 알림: 내 좌석이 한 일은 알리지 않는다(내 화면에는 이미 모달·카드가 있다)', () => {
  // Given 내 좌석(s1)의 매입
  const event = { type: 'CITY_PURCHASED', playerId: 's1', index: 5, price: 260_000 };

  // When
  // Then 알림을 만들지 않는다
  assert.equal(opponentNoticeOf(event, ctx), null);
});

test('상대 알림: 컴퓨터의 주사위와 도착 칸을 한 줄로 알려 준다', () => {
  // Given 컴퓨터1이 6+3을 굴려 부에노스아이레스에 도착했다
  const event = { type: 'LANDED', playerId: 's2', index: 5 };

  // When 직전 주사위를 함께 넘기면
  const notice = opponentNoticeOf(event, { ...ctx, lastDiceOf: () => ({ die1: 6, die2: 3 }) });

  // Then 한 줄에 주사위와 목적지가 모두 들어간다
  assert.equal(notice.kind, 'move');
  assert.equal(notice.text, '컴퓨터1: 주사위 6+3 → 부에노스아이레스');
  assert.equal(notice.ttl, DEFAULT_TTL_MS);
});

test('상대 알림: 주사위를 모르면 도착 칸만 알려 준다', () => {
  // Given 순간이동(공항·조난 이송)처럼 주사위가 없는 도착
  const notice = opponentNoticeOf({ type: 'LANDED', playerId: 's2', index: 9 }, ctx);

  // When / Then
  assert.equal(notice.text, '컴퓨터1 → 파리');
});

test('상대 알림: 매입·건설·랜드마크는 로그와 같은 문구로 알린다', () => {
  // Given 컴퓨터들의 매입 · 건설 · 랜드마크
  const bought = opponentNoticeOf({ type: 'CITY_PURCHASED', playerId: 's2', index: 5, price: 260_000 }, ctx);
  const built = opponentNoticeOf({ type: 'BUILT', playerId: 's3', index: 9, buildings: ['BUILDING'], cost: 78_000 }, ctx);
  const landmark = opponentNoticeOf({ type: 'LANDMARK_BUILT', playerId: 's3', index: 9, cost: 300_000 }, ctx);

  // When / Then 로그에서 쓰는 말이 그대로 담긴다
  assert.equal(bought.kind, 'buy');
  assert.ok(bought.text.includes('부에노스아이레스'), bought.text);
  assert.ok(bought.text.includes('260,000원'), bought.text);
  assert.equal(built.kind, 'build');
  assert.ok(built.text.includes('파리'), built.text);
  assert.ok(built.text.includes('빌딩'), built.text);
  assert.equal(landmark.kind, 'landmark');
  assert.ok(landmark.text.includes('랜드마크'), landmark.text);
});

test('상대 알림: 내 도시를 인수당하면 경고로 더 오래 띄운다', () => {
  // Given 컴퓨터1이 내 도시(12번 서울)를 인수했다
  const event = { type: 'ACQUIRED', playerId: 's2', fromId: 's1', index: 12, price: 400_000 };

  // When
  const notice = opponentNoticeOf(event, ctx);

  // Then 경고 톤 · 높은 우선순위 · 긴 수명 (이모지 없이 말로 알린다)
  assert.equal(notice.kind, 'acquire');
  assert.equal(notice.tone, 'warn');
  assert.ok(notice.text.includes('내 도시'), notice.text);
  assert.ok(notice.text.includes('서울'), notice.text);
  assert.equal(/\p{Extended_Pictographic}/u.test(notice.text), false, '알림 문구에 이모지가 있으면 안 된다');
  assert.equal(notice.ttl, ACQUIRED_MY_CITY_TTL_MS);
  assert.ok(notice.priority > 1);
});

test('상대 알림: 남의 도시끼리 인수한 것은 보통 알림이다', () => {
  // Given 컴퓨터1이 컴퓨터2의 도시를 인수
  const notice = opponentNoticeOf({ type: 'ACQUIRED', playerId: 's2', fromId: 's3', index: 9, price: 300_000 }, ctx);

  // When / Then
  assert.equal(notice.priority, 1);
  assert.equal(notice.ttl, DEFAULT_TTL_MS);
  assert.equal(notice.tone, 'info');
});

test('상대 알림: 통행료는 이미 전용 카드가 있으므로 토스트로 겹쳐 띄우지 않는다', () => {
  // Given 컴퓨터가 낸 통행료
  const event = { type: 'TOLL_PAID', payerId: 's2', ownerId: 's3', index: 9, amount: 120_000 };

  // When / Then 중복 안내를 만들지 않는다
  assert.equal(opponentNoticeOf(event, ctx), null);
});

test('상대 알림: 카지노 결과는 이기고 진 금액을 함께 알린다', () => {
  // Given 컴퓨터2의 홀짝 승리와 패배
  const won = opponentNoticeOf(
    { type: 'CASINO_RESULT', playerId: 's3', game: 'ODD_EVEN', win: true, payout: 20_000, bet: 10_000, jackpotWon: 0 },
    ctx,
  );
  const lost = opponentNoticeOf(
    { type: 'CASINO_RESULT', playerId: 's3', game: 'SLOT', win: false, payout: 0, bet: 30_000, jackpotWon: 0 },
    ctx,
  );

  // When / Then
  assert.equal(won.kind, 'casino');
  assert.ok(won.text.includes('홀짝'), won.text);
  assert.ok(won.text.includes('+20,000원'), won.text);
  assert.ok(lost.text.includes('−30,000원'), lost.text);
});

test('상대 알림: 잭팟 당첨은 우선순위를 높여 눈에 띄게 한다', () => {
  // Given 잭팟을 받은 카지노 결과
  const notice = opponentNoticeOf(
    { type: 'CASINO_RESULT', playerId: 's3', game: 'SLOT', win: true, payout: 50_000, bet: 10_000, jackpotWon: 700_000 },
    ctx,
  );

  // When / Then
  assert.equal(notice.kind, 'jackpot');
  assert.ok(notice.priority > 1);
  assert.ok(notice.text.includes('잭팟'), notice.text);
});

test('상대 알림: 조난·공항·대출·파산도 한 줄로 알린다', () => {
  // Given 각 사건
  const stranded = opponentNoticeOf({ type: 'STRANDED', playerId: 's2', remainingTurns: 3 }, ctx);
  const airport = opponentNoticeOf({ type: 'AIRPORT_TICKET_GRANTED', playerId: 's2' }, ctx);
  const loan = opponentNoticeOf({ type: 'LOAN_TAKEN', playerId: 's3', principal: 300_000, debt: 360_000 }, ctx);
  const bankrupt = opponentNoticeOf({ type: 'BANKRUPT', playerId: 's3' }, ctx);

  // When / Then 모두 알림이 만들어지고 파산은 우선순위가 높다
  assert.equal(stranded.kind, 'island');
  assert.ok(stranded.text.includes('조난'), stranded.text);
  assert.equal(airport.kind, 'airport');
  assert.equal(loan.kind, 'loan');
  assert.equal(bankrupt.kind, 'bankrupt');
  assert.ok(bankrupt.priority > 1);
});

test('상대 알림: 연출만 있는 이벤트나 모르는 이벤트는 알리지 않는다', () => {
  // Given 턴 시작·주사위 굴림 자체·모르는 타입
  // When / Then 알림이 없다(주사위는 도착 줄에 합쳐 보여 준다)
  assert.equal(opponentNoticeOf({ type: 'TURN_STARTED', playerId: 's2' }, ctx), null);
  assert.equal(opponentNoticeOf({ type: 'DICE_ROLLED', playerId: 's2', die1: 1, die2: 2 }, ctx), null);
  assert.equal(opponentNoticeOf({ type: 'SOMETHING_NEW', playerId: 's2' }, ctx), null);
});

test('상대 알림: 잘못된 입력에도 예외 없이 null을 돌려준다', () => {
  // Given / When / Then
  assert.equal(opponentNoticeOf(), null);
  assert.equal(opponentNoticeOf(null, ctx), null);
  assert.equal(opponentNoticeOf({ type: 'BUILT' }, ctx), null);
});

test('대기열: 같은 종류가 이미 기다리고 있으면 최신 것으로 바꾼다(쌓이지 않는다)', () => {
  // Given 이동 알림이 하나 기다리는 중
  const queued = [{ kind: 'move', text: '컴퓨터1 → 파리', priority: 1, ttl: 2500 }];

  // When 같은 종류의 새 알림이 오면
  const next = coalesceNotices(queued, { kind: 'move', text: '컴퓨터2 → 서울', priority: 1, ttl: 2500 });

  // Then 길이는 그대로고 내용만 최신으로 바뀐다
  assert.equal(next.length, 1);
  assert.equal(next[0].text, '컴퓨터2 → 서울');
});

test('대기열: 한 개만 예약한다 — 넘치면 우선순위가 높은 쪽이 남는다', () => {
  // Given 보통 알림이 기다리는 중
  const queued = [{ kind: 'build', text: '건설', priority: 1, ttl: 2500 }];

  // When 우선순위가 높은 알림(내 도시 인수)이 오면
  const next = coalesceNotices(queued, { kind: 'acquire', text: '인수', priority: 3, ttl: 4000 });

  // Then 한 개만 남고, 남는 것은 높은 쪽이다
  assert.equal(next.length, 1);
  assert.equal(next[0].text, '인수');
});

test('대기열: 낮은 우선순위는 기다리는 높은 알림을 밀어내지 못한다', () => {
  // Given 높은 우선순위가 기다리는 중
  const queued = [{ kind: 'bankrupt', text: '파산', priority: 3, ttl: 2500 }];

  // When 보통 알림이 오면
  const next = coalesceNotices(queued, { kind: 'move', text: '이동', priority: 1, ttl: 2500 });

  // Then 높은 쪽이 그대로 남는다
  assert.equal(next.length, 1);
  assert.equal(next[0].text, '파산');
});

test('대기열: 비어 있으면 그대로 한 개가 들어가고, 잘못된 입력은 무시한다', () => {
  // Given / When / Then
  assert.equal(coalesceNotices([], { kind: 'move', text: '이동', priority: 1, ttl: 2500 }).length, 1);
  assert.deepEqual(coalesceNotices([], null), []);
  assert.deepEqual(coalesceNotices(null, null), []);
});

test('상대 알림: 어떤 알림 문구에도 이모지를 쓰지 않는다(오너 요청)', () => {
  // Given 대표적인 사건들
  const events = [
    { type: 'LANDED', playerId: 's2', index: 5 },
    { type: 'CITY_PURCHASED', playerId: 's2', index: 5, price: 260_000 },
    { type: 'BUILT', playerId: 's3', index: 9, buildings: ['BUILDING'], cost: 78_000 },
    { type: 'LANDMARK_BUILT', playerId: 's3', index: 9, cost: 300_000 },
    { type: 'ACQUIRED', playerId: 's2', fromId: 's1', index: 12, price: 400_000 },
    { type: 'CASINO_RESULT', playerId: 's3', game: 'SLOT', win: true, payout: 50_000, bet: 10_000, jackpotWon: 700_000 },
    { type: 'STRANDED', playerId: 's2', remainingTurns: 3 },
    { type: 'AIRPORT_TICKET_GRANTED', playerId: 's2' },
    { type: 'LOAN_TAKEN', playerId: 's3', principal: 300_000, debt: 360_000 },
    { type: 'BANKRUPT', playerId: 's3' },
  ];

  // When 각각의 알림 문구를 보면
  for (const event of events) {
    const notice = opponentNoticeOf(event, { ...ctx, lastDiceOf: () => ({ die1: 6, die2: 3 }) });

    // Then 이모지가 하나도 없다
    assert.ok(notice, `${event.type} 알림이 없다`);
    assert.equal(
      /\p{Extended_Pictographic}/u.test(notice.text),
      false,
      `${event.type} 문구에 이모지가 있다: ${notice.text}`,
    );
  }
});
