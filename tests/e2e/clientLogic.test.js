import test from 'node:test';
import assert from 'node:assert/strict';

import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { BUILDING_TYPES, City } from '../../src/domain/game/City.js';
import { BASIC_BUILDINGS, BuildingUnlocks } from '../../src/domain/game/buildings.js';
import { BOARD_SPACES, SPACE_KINDS } from '../../src/domain/game/data/board.js';
import { TICKET_EFFECTS } from '../../src/domain/game/data/tickets.js';

import { formatCompactWon, formatMoney, formatSignedWon, formatWon } from '../../public/js/format.js';
import {
  BOARD_SIZE,
  GRID_SIZE,
  cellPosition,
  cornerOf,
  groupOf,
  hopPath,
  sideOf,
} from '../../public/js/domain/boardLayout.js';
import { LAP_UNLOCK_HINTS, formatEventLine } from '../../public/js/domain/eventLog.js';
import { ticketEffectLabel } from '../../public/js/domain/labels.js';
import { canBet, clampBet, quickChips, stepBet } from '../../public/js/domain/betRules.js';
import {
  LAP_RULE_TEXT,
  buildCostOf,
  buildRows,
  comboCost,
  lapLabel,
  predictToll,
  unlockNotice,
  validateSelection,
} from '../../public/js/domain/buildRules.js';
import { EventPlaybackQueue } from '../../public/js/animation/EventQueue.js';
import { direction, object, subject, topic } from '../../public/js/domain/particles.js';

/* ------------------------------------------------------------------ */
/* 금액 표기                                                            */
/* ------------------------------------------------------------------ */

test('금액 표기: 원 단위 천 단위 구분과 부호를 붙인다', () => {
  // Given 서버가 준 정수 금액
  // When 표기 함수를 적용하면
  // Then 한국어 통화 관례에 맞는 문자열이 된다
  assert.equal(formatMoney(3_000_000), '3,000,000');
  assert.equal(formatWon(200_000), '200,000원');
  assert.equal(formatSignedWon(200_000), '+200,000원');
  assert.equal(formatSignedWon(-60_000), '-60,000원');
  assert.equal(formatSignedWon(0), '0원');
});

test('금액 표기: 보드 칸용 축약 표기는 만 단위로 줄인다', () => {
  // Given 보드 칸에 들어갈 좁은 폭의 금액
  // When 축약 표기를 적용하면
  // Then 만 단위로 줄어들고 만 원 미만은 그대로 남는다
  assert.equal(formatCompactWon(60_000), '6만');
  assert.equal(formatCompactWon(800_000), '80만');
  assert.equal(formatCompactWon(28_000), '2.8만');
  assert.equal(formatCompactWon(5_000), '5,000');
  assert.equal(formatCompactWon(0), '0');
});

test('금액 표기: 숫자가 아닌 값에도 깨지지 않는다', () => {
  // Given 값이 비어 있거나 숫자가 아닌 경우
  // When 표기 함수를 적용하면
  // Then 예외 대신 0원으로 처리한다
  assert.equal(formatWon(undefined), '0원');
  assert.equal(formatWon(null), '0원');
  assert.equal(formatWon(Number.NaN), '0원');
  assert.equal(formatCompactWon(undefined), '0');
});

/* ------------------------------------------------------------------ */
/* 보드 좌표 매핑                                                       */
/* ------------------------------------------------------------------ */

test('보드 좌표: 40칸이 11×11 그리드 외곽에 1:1로 배치된다', () => {
  // Given 11×11 그리드와 40칸 보드
  assert.equal(BOARD_SIZE, BOARD_SPACES.length);
  assert.equal(GRID_SIZE, 11);

  // When 모든 칸의 좌표를 구하면
  const positions = Array.from({ length: BOARD_SIZE }, (_unused, index) => cellPosition(index));

  // Then 좌표는 서로 겹치지 않고 모두 외곽에 있다
  const keys = new Set(positions.map(({ row, col }) => `${row},${col}`));
  assert.equal(keys.size, BOARD_SIZE);
  for (const { row, col } of positions) {
    const onEdge = row === 1 || row === GRID_SIZE || col === 1 || col === GRID_SIZE;
    assert.ok(onEdge, `외곽이 아닌 좌표: ${row},${col}`);
    assert.ok(row >= 1 && row <= GRID_SIZE && col >= 1 && col <= GRID_SIZE);
  }
});

test('보드 좌표: 이웃한 칸은 그리드에서도 한 칸 차이로 붙어 있다', () => {
  // Given 보드 순회 순서
  // When 연속한 두 칸의 좌표 차를 구하면
  // Then 항상 가로 또는 세로로 1칸만 이동한다(마지막 칸 → 출발 칸 포함)
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const here = cellPosition(index);
    const next = cellPosition((index + 1) % BOARD_SIZE);
    const distance = Math.abs(here.row - next.row) + Math.abs(here.col - next.col);
    assert.equal(distance, 1, `${index} → ${(index + 1) % BOARD_SIZE} 사이가 붙어 있지 않다`);
  }
});

test('보드 좌표: 네 모서리는 출발·조난 섬·카지노·공항이다', () => {
  // Given 서버 보드 정의
  // When 모서리 종류를 물으면
  // Then 명세의 네 모서리 칸과 일치한다
  assert.equal(cornerOf(0), SPACE_KINDS.START);
  assert.equal(cornerOf(10), SPACE_KINDS.ISLAND);
  assert.equal(cornerOf(20), SPACE_KINDS.CASINO);
  assert.equal(cornerOf(30), SPACE_KINDS.AIRPORT);
  assert.equal(cornerOf(7), null);

  for (const index of [0, 10, 20, 30]) {
    assert.equal(BOARD_SPACES[index].kind, cornerOf(index));
  }
});

test('보드 좌표: 한 변의 아홉 칸이 같은 색 그룹으로 묶인다', () => {
  // Given 모서리를 제외한 네 변
  // When 각 칸의 그룹을 물으면
  // Then 같은 변의 칸은 같은 그룹이고 모서리는 그룹이 없다
  const groups = new Set();
  for (const [start, end] of [
    [1, 9],
    [11, 19],
    [21, 29],
    [31, 39],
  ]) {
    const group = groupOf(start);
    assert.ok(group, `그룹이 없는 칸: ${start}`);
    groups.add(group);
    for (let index = start; index <= end; index += 1) {
      assert.equal(groupOf(index), group);
    }
  }
  assert.equal(groups.size, 4);
  assert.equal(groupOf(0), null);
  assert.equal(sideOf(0), 'BOTTOM');
  assert.equal(sideOf(15), 'RIGHT');
  assert.equal(sideOf(25), 'TOP');
  assert.equal(sideOf(35), 'LEFT');
});

test('보드 좌표: 이동 경로는 전진·후진·순간이동을 구분한다', () => {
  // Given MOVED 이벤트의 from/to/steps
  // When 경로를 계산하면
  // Then 전진은 한 칸씩, 후진은 역순, steps가 null이면 순간이동이다
  assert.deepEqual(hopPath({ from: 0, to: 3, steps: 3 }), [1, 2, 3]);
  assert.deepEqual(hopPath({ from: 38, to: 2, steps: 4 }), [39, 0, 1, 2]);
  assert.deepEqual(hopPath({ from: 5, to: 3, steps: -2 }), [4, 3]);
  assert.deepEqual(hopPath({ from: 1, to: 39, steps: -2 }), [0, 39]);
  assert.deepEqual(hopPath({ from: 7, to: 10, steps: null }), [10]);
  assert.deepEqual(hopPath({ from: 7, to: 7, steps: 0 }), []);
});

test('보드 좌표: 경로 계산 결과가 도착 칸과 맞지 않으면 순간이동으로 되돌린다', () => {
  // Given steps와 to가 서로 맞지 않는 방어적 입력
  // When 경로를 계산하면
  // Then 서버가 알려준 도착 칸 하나만 남는다
  assert.deepEqual(hopPath({ from: 0, to: 12, steps: 3 }), [12]);
  assert.deepEqual(hopPath({ from: 0, to: 5, steps: 999 }), [5]);
});

/* ------------------------------------------------------------------ */
/* 게임 로그 문장 만들기                                                 */
/* ------------------------------------------------------------------ */

const NAMES = { 'seat-1': '하나', 'seat-2': '두리', 'seat-3': '세찌' };
const LOG_CONTEXT = {
  nameOf: (id) => NAMES[id] ?? '알 수 없는 좌석',
  spaceNameOf: (index) => BOARD_SPACES[index]?.name ?? `${index}번 칸`,
};

/** 45종 이벤트의 대표 필드를 담은 표본. */
const EVENT_SAMPLES = {
  TURN_STARTED: { playerId: 'seat-1', round: 2 },
  DICE_ROLLED: { playerId: 'seat-1', die1: 3, die2: 3, sum: 6, isDouble: true },
  MOVED: { playerId: 'seat-1', from: 0, to: 6, steps: 6, passedStart: false },
  LAP_ADVANCED: { playerId: 'seat-1', lap: 2 },
  SALARY_PAID: { playerId: 'seat-1', amount: 200_000 },
  LANDED: { playerId: 'seat-1', index: 6, kind: 'CITY', name: '뭄바이' },
  CITY_PURCHASED: { playerId: 'seat-1', index: 6, name: '뭄바이', price: 100_000 },
  PURCHASE_DECLINED: { playerId: 'seat-1', index: 6 },
  BUILD_OFFERED: { playerId: 'seat-1', index: 6, name: '뭄바이', options: [{ type: 'VILLA', cost: 30_000 }] },
  BUILT: { playerId: 'seat-1', index: 6, name: '뭄바이', buildings: ['VILLA', 'HOTEL'], cost: 120_000 },
  LANDMARK_BUILT: { playerId: 'seat-1', index: 6, name: '뭄바이', cost: 100_000 },
  BUILD_DECLINED: { playerId: 'seat-1', index: 6 },
  START_BONUS_OFFERED: { playerId: 'seat-1', candidates: [{ index: 6, name: '뭄바이' }] },
  ACQUIRE_OFFERED: { playerId: 'seat-2', index: 6, name: '뭄바이', ownerId: 'seat-1', price: 260_000 },
  ACQUIRED: { playerId: 'seat-2', index: 6, name: '뭄바이', fromId: 'seat-1', price: 260_000 },
  ACQUIRE_DECLINED: { playerId: 'seat-2', index: 6 },
  TOLL_PAID: { payerId: 'seat-2', ownerId: 'seat-1', index: 6, amount: 40_000 },
  TAX_PAID: { playerId: 'seat-1', amount: 30_000 },
  TICKET_DRAWN: {
    playerId: 'seat-1',
    ticketId: 'T01',
    text: '복권 소액 당첨! 100,000원을 받습니다.',
    effect: { type: 'GAIN', amount: 100_000 },
  },
  MONEY_GAINED: { playerId: 'seat-1', amount: 100_000, reason: 'TICKET', ticketId: 'T01' },
  MONEY_LOST: { playerId: 'seat-1', amount: 80_000, reason: 'TICKET', ticketId: 'T07' },
  MONEY_TRANSFERRED: { fromId: 'seat-2', toId: 'seat-1', amount: 50_000, reason: 'TICKET' },
  STRANDED: { playerId: 'seat-1', remainingTurns: 3 },
  ISLAND_RESCUE_PAID: { playerId: 'seat-1', amount: 200_000 },
  ISLAND_ESCAPED: { playerId: 'seat-1', by: 'DOUBLE' },
  ISLAND_STAY: { playerId: 'seat-1', remainingTurns: 2 },
  CASINO_ENTERED: { playerId: 'seat-1', roundsLeft: 3, jackpot: 120_000 },
  CASINO_RESULT: {
    playerId: 'seat-1',
    game: 'SLOT',
    bet: 10_000,
    win: true,
    payout: 100_000,
    jackpotWon: 0,
    detail: { symbols: ['🍒', '🍒', '🍒'], matched: 3, jackpotSymbol: false },
  },
  CASINO_LEFT: { playerId: 'seat-1' },
  JACKPOT_CHANGED: { jackpot: 125_000 },
  JACKPOT_CLAIMED: { playerId: 'seat-1', amount: 326_500, share: 100, remaining: 0 },
  AIRPORT_TICKET_GRANTED: { playerId: 'seat-1' },
  AIRPORT_READY: { playerId: 'seat-1' },
  TRAVELED: { playerId: 'seat-1', from: 30, to: 39 },
  LIQUIDATION_REQUIRED: { playerId: 'seat-2', amountDue: 400_000, creditorId: 'seat-1', reason: 'TOLL' },
  PROPERTY_SOLD: { playerId: 'seat-2', index: 3, name: '방콕', refund: 35_000 },
  DEBT_SETTLED: { playerId: 'seat-2', amount: 400_000 },
  LOAN_TAKEN: { playerId: 'seat-2', principal: 1_000_000, debt: 1_200_000 },
  LOAN_REPAID: { playerId: 'seat-2' },
  SALARY_SEIZED: { playerId: 'seat-2', amount: 200_000, remainingDebt: 1_000_000 },
  BANKRUPT: { playerId: 'seat-2', creditorId: 'seat-1', paidAmount: 12_000, releasedIndexes: [3, 4] },
  EXTRA_TURN: { playerId: 'seat-1' },
  TURN_ENDED: { playerId: 'seat-1' },
  ROUND_ADVANCED: { round: 3 },
  GAME_OVER: {
    reason: 'LAST_SURVIVOR',
    rankings: [{ playerId: 'seat-1', name: '하나', rank: 1, totalAssets: 5_000_000 }],
  },
};

test('게임 로그: 서버의 45종 도메인 이벤트 전부에 한국어 문장이 있다', () => {
  // Given 서버가 정의한 모든 이벤트 종류
  const types = Object.keys(EVENT_TYPES);
  assert.equal(types.length, 45);

  // When 각 이벤트를 로그 문장으로 바꾸면
  for (const type of types) {
    const sample = EVENT_SAMPLES[type];
    assert.ok(sample, `표본이 없는 이벤트: ${type}`);
    const line = formatEventLine({ type, ...sample }, LOG_CONTEXT);

    // Then 비어 있지 않은 문장이 나오고 미확인 처리로 떨어지지 않는다
    assert.equal(typeof line.text, 'string');
    assert.ok(line.text.trim().length > 0, `문장이 빈 이벤트: ${type}`);
    assert.notEqual(line.kind, 'unknown', `문장이 없는 이벤트: ${type}`);
  }
});

test('게임 로그: 모르는 이벤트 종류가 와도 기본 문장으로 넘어간다', () => {
  // Given 클라이언트가 모르는 새 이벤트
  // When 로그 문장을 만들면
  // Then 예외 없이 기본 문장을 돌려준다
  const line = formatEventLine({ type: 'STOCK_TRADED', playerId: 'seat-1' }, LOG_CONTEXT);
  assert.equal(line.kind, 'unknown');
  assert.ok(line.text.includes('STOCK_TRADED'));

  // And 이벤트가 아예 없어도 깨지지 않는다
  assert.equal(typeof formatEventLine(null).text, 'string');
  assert.equal(typeof formatEventLine({}).text, 'string');
});

test('게임 로그: 잭팟 수령은 금액과 남은 적립금을 알리고, 빈 적립금은 따로 안내한다', () => {
  // Given 잭팟을 전액 수령한 이벤트와 적립금이 비어 있던 이벤트
  const won = formatEventLine(
    { type: 'JACKPOT_CLAIMED', playerId: 'seat-1', amount: 326_500, share: 100, remaining: 0 },
    LOG_CONTEXT,
  );
  const half = formatEventLine(
    { type: 'JACKPOT_CLAIMED', playerId: 'seat-1', amount: 62_500, share: 50, remaining: 62_501 },
    LOG_CONTEXT,
  );
  const empty = formatEventLine(
    { type: 'JACKPOT_CLAIMED', playerId: 'seat-2', amount: 0, share: 50, remaining: 0 },
    LOG_CONTEXT,
  );

  // When / Then 수령액은 문장에 그대로 담기고, 0원이면 비어 있었다고 알린다
  assert.ok(won.text.includes('하나'));
  assert.ok(won.text.includes('326,500원'));
  assert.equal(won.kind, 'special');

  // And 절반만 받았으면 남은 적립금까지 알린다
  assert.ok(half.text.includes('62,500원'), `수령액이 없다: ${half.text}`);
  assert.ok(half.text.includes('62,501원'), `남은 적립금이 없다: ${half.text}`);
  assert.equal(half.kind, 'special');

  assert.ok(empty.text.includes('두리'));
  assert.ok(empty.text.includes('비어'), `빈 적립금 안내가 없다: ${empty.text}`);
  assert.equal(empty.text.includes('326,500원'), false);
  assert.notEqual(empty.kind, 'unknown');
});

test('행운 티켓 효과 라벨: 서버가 정의한 모든 효과 종류에 한국어 라벨이 있다', () => {
  // Given 서버의 티켓 효과 종류 전부
  const types = Object.values(TICKET_EFFECTS);

  // When / Then 모르는 값에 쓰는 기본 문구로 떨어지지 않는다
  for (const type of types) {
    const label = ticketEffectLabel(type);
    assert.ok(label.length > 0, `라벨이 빈 효과: ${type}`);
    assert.notEqual(label, '즉시 효과', `라벨이 없는 효과: ${type}`);
    assert.notEqual(label, type, `라벨이 없는 효과: ${type}`);
  }

  // And 잭팟 수령 티켓 두 장은 지분에 따라 서로 다른 문구가 된다
  assert.equal(
    ticketEffectLabel('CLAIM_JACKPOT', { type: 'CLAIM_JACKPOT', share: 100 }),
    '잭팟 적립금 전액 수령',
  );
  assert.equal(
    ticketEffectLabel('CLAIM_JACKPOT', { type: 'CLAIM_JACKPOT', share: 50 }),
    '잭팟 적립금 절반 수령',
  );

  // And 모르는 효과는 기본 문구로 안전하게 넘어간다
  assert.equal(ticketEffectLabel('STOCK_DIVIDEND'), '즉시 효과');
});

test('게임 로그: 이름과 금액이 문장에 그대로 반영된다', () => {
  // Given 통행료 이벤트
  // When 로그 문장을 만들면
  // Then 지불자·소유자 이름과 금액, 칸 이름이 담긴다
  const line = formatEventLine({ type: 'TOLL_PAID', ...EVENT_SAMPLES.TOLL_PAID }, LOG_CONTEXT);
  assert.ok(line.text.includes('두리'));
  assert.ok(line.text.includes('하나'));
  assert.ok(line.text.includes('뭄바이'));
  assert.ok(line.text.includes('40,000원'));
  assert.equal(line.kind, 'money-out');

  // And 알 수 없는 좌석 id는 안전한 대체 이름이 된다
  const unknown = formatEventLine({ type: 'TURN_STARTED', playerId: 'seat-9', round: 1 }, LOG_CONTEXT);
  assert.ok(unknown.text.includes('알 수 없는 좌석'));
});

/* ------------------------------------------------------------------ */
/* 카지노 베팅액 규칙                                                    */
/* ------------------------------------------------------------------ */

const LIMITS = { min: 10_000, max: 500_000, unit: 10_000 };

test('카지노 베팅액: 서버가 준 한도와 단위로 항상 맞춰진다', () => {
  // Given 서버가 알려준 베팅 한도
  // When 임의의 값을 넣으면
  // Then 단위로 내림되고 한도 안으로 들어온다
  assert.equal(clampBet(123_456, LIMITS), 120_000);
  assert.equal(clampBet(0, LIMITS), 10_000);
  assert.equal(clampBet(-50_000, LIMITS), 10_000);
  assert.equal(clampBet(9_999_999, LIMITS), 500_000);
  assert.equal(clampBet(Number.NaN, LIMITS), 10_000);
});

test('카지노 베팅액: 현금이 최소 베팅액보다 적으면 베팅할 수 없다', () => {
  // Given 현금이 부족해 max가 0인 한도
  const broke = { min: 10_000, max: 0, unit: 10_000 };
  // When 베팅 가능 여부와 값을 물으면
  // Then 베팅은 불가하고 값은 0이다
  assert.equal(canBet(broke), false);
  assert.equal(clampBet(50_000, broke), 0);
  assert.equal(canBet(LIMITS), true);
});

test('카지노 베팅액: −/+ 버튼은 10,000원 단위로 움직이고 한도에서 멈춘다', () => {
  // Given 현재 베팅액
  // When 단위만큼 올리거나 내리면
  // Then 한도를 넘지 않는다
  assert.equal(stepBet(50_000, 10_000, LIMITS), 60_000);
  assert.equal(stepBet(10_000, -10_000, LIMITS), 10_000);
  assert.equal(stepBet(500_000, 10_000, LIMITS), 500_000);
});

test('카지노 베팅액: 빠른 선택 칩은 한도 안의 서로 다른 값만 준다', () => {
  // Given 최대 70,000원까지만 걸 수 있는 한도
  const chips = quickChips({ min: 10_000, max: 70_000, unit: 10_000 });
  // When 빠른 선택 칩을 만들면
  // Then 모두 한도 안이고 중복이 없으며 오름차순이다
  assert.ok(chips.length > 0);
  assert.deepEqual(chips, [...new Set(chips)]);
  assert.deepEqual(chips, [...chips].sort((a, b) => a - b));
  for (const chip of chips) {
    assert.ok(chip >= 10_000 && chip <= 70_000, `한도를 벗어난 칩: ${chip}`);
    assert.equal(chip % 10_000, 0);
  }
  assert.deepEqual(quickChips({ min: 10_000, max: 0, unit: 10_000 }), []);
});

/* ------------------------------------------------------------------ */
/* 건설 조합 비용·통행료 미리보기                                          */
/* ------------------------------------------------------------------ */

test('건설 미리보기: 고른 건물의 합계 비용을 서버 옵션대로 더한다', () => {
  // Given 서버가 준 건설 옵션
  const options = [
    { type: 'VILLA', cost: 30_000 },
    { type: 'BUILDING', cost: 60_000 },
    { type: 'HOTEL', cost: 90_000 },
  ];
  // When 두 개를 고르면
  // Then 합계는 두 비용의 합이다
  assert.equal(comboCost(options, ['VILLA', 'HOTEL']), 120_000);
  assert.equal(comboCost(options, []), 0);
  assert.equal(comboCost(options, ['LANDMARK']), 0);
});

test('건설 미리보기: 건설 후 통행료가 서버의 계산과 일치한다', () => {
  // Given 서버 도메인의 도시와 같은 조건
  const price = 100_000;
  const cases = [
    { buildings: [], selected: [] },
    { buildings: [], selected: ['VILLA'] },
    { buildings: ['VILLA'], selected: ['BUILDING'] },
    { buildings: ['VILLA', 'BUILDING'], selected: ['HOTEL'] },
    { buildings: ['VILLA', 'BUILDING', 'HOTEL'], selected: [] },
  ];

  for (const { buildings, selected } of cases) {
    // When 클라이언트가 건설 후 통행료를 미리 계산하면
    const predicted = predictToll({ price, buildings, landmark: false, selected });

    // Then 같은 상태의 서버 도시가 계산한 통행료와 같다
    const city = new City({
      index: 6,
      name: '뭄바이',
      kind: SPACE_KINDS.CITY,
      price,
      ownerId: 'seat-1',
      buildings: [...buildings, ...selected],
    });
    assert.equal(predicted, city.tollFor(), `조합 ${[...buildings, ...selected].join('+')}`);
  }
});

test('건설 미리보기: 관광명소 통행료는 가격의 3.5배로 고정된다', () => {
  // Given 3종을 모두 지은 도시
  const price = 200_000;
  const landmarkCity = new City({
    index: 17,
    name: '암스테르담',
    kind: SPACE_KINDS.CITY,
    price,
    ownerId: 'seat-1',
    buildings: ['VILLA', 'BUILDING', 'HOTEL'],
    landmark: true,
  });

  // When 관광명소 업그레이드를 고르면
  // Then 서버와 같은 고정 배율이 나온다
  assert.equal(
    predictToll({ price, buildings: ['VILLA', 'BUILDING', 'HOTEL'], landmark: false, selected: ['LANDMARK'] }),
    landmarkCity.tollFor(),
  );
  assert.equal(predictToll({ price, buildings: [], landmark: true, selected: [] }), 700_000);
});

test('건설 미리보기: 정가 기준 건설비가 서버 도메인과 같다', () => {
  // Given 서버가 옵션을 주지 않는 화면(칸 상세 시트)에서 보여 줄 건설비
  const price = 300_000;
  const city = new City({ index: 28, name: '시카고', kind: SPACE_KINDS.CITY, price, ownerId: 'seat-1' });

  // When 정가 기준 건설비를 계산하면
  // Then 서버 City.buildCost()와 같다
  for (const type of ['VILLA', 'BUILDING', 'HOTEL']) {
    assert.equal(buildCostOf(price, type), city.buildCost(type), type);
  }
  assert.equal(buildCostOf(price, 'UNKNOWN'), 0);
  assert.equal(buildCostOf(undefined, 'VILLA'), 0);
});

test('건설 미리보기: 관광명소는 단독 선택만 허용한다', () => {
  // Given 관광명소만 제안된 건설 기회
  const landmarkOnly = [{ type: BUILDING_TYPES.LANDMARK, cost: 200_000 }];
  // When 다른 건물과 함께 고르면
  // Then 유효하지 않다고 알려준다
  assert.equal(validateSelection(['LANDMARK'], landmarkOnly).ok, true);
  assert.equal(validateSelection(['LANDMARK', 'VILLA'], landmarkOnly).ok, false);
  assert.equal(validateSelection([], landmarkOnly).ok, false);
  assert.equal(
    validateSelection(['HOTEL'], [{ type: 'VILLA', cost: 1 }]).ok,
    false,
    '서버가 제안하지 않은 건물은 고를 수 없다',
  );
});

test('건설 미리보기: 바퀴로 잠긴 건물은 잠긴 행으로 만들어 준다', () => {
  // Given 1바퀴 플레이어에게 서버가 준 선택지
  const pending = {
    options: [{ type: 'VILLA', cost: 21_000, locked: false, unlockLap: 1 }],
    lockedOptions: [
      { type: 'BUILDING', cost: 42_000, locked: true, unlockLap: 2 },
      { type: 'HOTEL', cost: 63_000, locked: true, unlockLap: 3 },
    ],
  };

  // When 모달에 그릴 행 목록을 만들면
  const rows = buildRows(pending);

  // Then 별장 · 빌딩 · 호텔 순서로 나오고 잠긴 행에는 안내 문구가 붙는다
  assert.deepEqual(rows, [
    { type: 'VILLA', cost: 21_000, locked: false, unlockLap: 1, notice: '' },
    { type: 'BUILDING', cost: 42_000, locked: true, unlockLap: 2, notice: '2바퀴부터 지을 수 있습니다' },
    { type: 'HOTEL', cost: 63_000, locked: true, unlockLap: 3, notice: '3바퀴부터 지을 수 있습니다' },
  ]);
});

test('건설 미리보기: 관광명소 기회와 잠긴 것이 없는 기회에는 잠긴 행이 없다', () => {
  // Given
  const landmarkOffer = { options: [{ type: 'LANDMARK', cost: 70_000 }], lockedOptions: [] };
  const openOffer = {
    options: [
      { type: 'VILLA', cost: 21_000 },
      { type: 'BUILDING', cost: 42_000 },
      { type: 'HOTEL', cost: 63_000 },
    ],
  };

  // When / Then
  assert.deepEqual(buildRows(landmarkOffer), [
    { type: 'LANDMARK', cost: 70_000, locked: false, unlockLap: 1, notice: '' },
  ]);
  assert.equal(buildRows(openOffer).length, 3);
  assert.equal(
    buildRows(openOffer).every((row) => row.locked === false),
    true,
  );
});

test('건설 미리보기: 선택지가 비어 있거나 망가져도 빈 목록으로 넘어간다', () => {
  // Given / When / Then
  assert.deepEqual(buildRows(undefined), []);
  assert.deepEqual(buildRows({}), []);
  assert.deepEqual(buildRows({ options: 'nope', lockedOptions: 7 }), []);
  assert.deepEqual(buildRows({ options: [{ cost: 1 }] }), []);
});

test('건설 미리보기: 잠긴 건물은 고를 수 없다', () => {
  // Given 1바퀴 기회(호텔은 잠김)
  const options = [{ type: 'VILLA', cost: 21_000, locked: false, unlockLap: 1 }];

  // When / Then 서버가 제안하지 않은 건물이므로 유효하지 않다
  assert.equal(validateSelection(['HOTEL'], options).ok, false);
  assert.equal(validateSelection(['VILLA', 'BUILDING'], options).ok, false);
  assert.equal(validateSelection(['VILLA'], options).ok, true);
});

test('건설 미리보기: 클라이언트 안내 문구가 서버 해금 규칙과 어긋나지 않는다', () => {
  // Given 서버 도메인의 해금 표(BuildingUnlocks)
  // When 클라이언트가 화면에 쓰는 문구를 만들면
  // Then 건물마다 서버가 정한 해금 바퀴가 그대로 들어 있다
  for (const type of BASIC_BUILDINGS) {
    const lap = BuildingUnlocks.unlockLapOf(type);
    assert.ok(
      LAP_RULE_TEXT.includes(`${lap}바퀴`),
      `${type}의 해금 바퀴 ${lap}이 안내 문구에 없다: ${LAP_RULE_TEXT}`,
    );
    assert.equal(unlockNotice(lap), lap > 1 ? `${lap}바퀴부터 지을 수 있습니다` : '');
  }

  // 로그의 해금 힌트는 "새로 열리는 바퀴"와 정확히 같은 키를 갖는다
  assert.deepEqual(
    Object.keys(LAP_UNLOCK_HINTS).map(Number).sort((a, b) => a - b),
    [...new Set(BASIC_BUILDINGS.map((type) => BuildingUnlocks.unlockLapOf(type)))]
      .filter((lap) => lap > 1)
      .sort((a, b) => a - b),
  );
});

test('건설 미리보기: 바퀴 안내 문구는 규칙을 그대로 옮긴다', () => {
  // Given / When / Then
  assert.equal(LAP_RULE_TEXT, '1바퀴: 별장 · 2바퀴: 빌딩 · 3바퀴부터: 호텔');
  assert.equal(unlockNotice(2), '2바퀴부터 지을 수 있습니다');
  assert.equal(unlockNotice(1), '');
  assert.equal(unlockNotice(undefined), '');
  assert.equal(lapLabel(3), '3바퀴');
  assert.equal(lapLabel(undefined), '1바퀴');
});

/* ------------------------------------------------------------------ */
/* 이벤트 재생 큐                                                        */
/* ------------------------------------------------------------------ */

const message = (version, count = 1) => ({
  view: { version, phase: 'AWAIT_ROLL' },
  events: Array.from({ length: count }, (_unused, index) => ({ type: 'TURN_ENDED', playerId: `e${version}-${index}` })),
});

test('이벤트 큐: 받은 이벤트를 순서대로 꺼내고 마지막 뷰를 목표로 삼는다', () => {
  // Given 빈 재생 큐
  const queue = new EventPlaybackQueue();

  // When 두 개의 game 메시지를 넣으면
  assert.equal(queue.accept(message(1, 2)), true);
  assert.equal(queue.accept(message(2, 1)), true);

  // Then 이벤트는 도착 순서대로 나오고 목표 뷰는 최신 버전이다
  assert.equal(queue.size, 3);
  assert.equal(queue.targetView.version, 2);
  assert.equal(queue.shift().playerId, 'e1-0');
  assert.equal(queue.shift().playerId, 'e1-1');
  assert.equal(queue.shift().playerId, 'e2-0');
  assert.equal(queue.shift(), null);
  assert.equal(queue.size, 0);
});

test('이벤트 큐: 오래된 버전과 같은 버전의 중복 메시지를 버린다', () => {
  // Given 버전 5까지 반영한 큐 (커맨드 응답과 SSE 방송이 같은 내용을 두 번 준다)
  const queue = new EventPlaybackQueue();
  queue.accept(message(5, 1));

  // When 같은 버전이나 더 낮은 버전이 다시 오면
  // Then 받아들이지 않고 이벤트도 늘지 않는다
  assert.equal(queue.accept(message(5, 1)), false);
  assert.equal(queue.accept(message(4, 3)), false);
  assert.equal(queue.size, 1);
  assert.equal(queue.latestVersion, 5);
});

test('이벤트 큐: 같은 버전의 스냅샷(이벤트 없음)은 재생 없이 반영한다', () => {
  // Given 버전 7까지 반영한 큐 (재접속 직후 서버가 같은 버전 스냅샷을 다시 보낸다)
  const queue = new EventPlaybackQueue();
  queue.accept(message(7, 1));
  const snapshot = { view: { version: 7, phase: 'AWAIT_BUY' }, events: [] };

  // When 이벤트가 없는 스냅샷이 오면
  assert.equal(queue.accept(snapshot), true);

  // Then 목표 뷰만 갱신되고 재생할 이벤트는 늘지 않는다
  assert.equal(queue.targetView.phase, 'AWAIT_BUY');
  assert.equal(queue.size, 1);
});

test('이벤트 큐: 재접속하면 쌓인 이벤트를 버리고 스냅샷만 그린다', () => {
  // Given 재생하지 못한 이벤트가 쌓인 큐
  const queue = new EventPlaybackQueue();
  queue.accept(message(3, 5));
  assert.equal(queue.size, 5);

  // When 재접속 스냅샷으로 초기화하면
  queue.reset({ version: 9, phase: 'AWAIT_ROLL' });

  // Then 이벤트 큐는 비고 목표 뷰는 스냅샷이 된다
  assert.equal(queue.size, 0);
  assert.equal(queue.latestVersion, 9);
  assert.equal(queue.targetView.version, 9);
  assert.equal(queue.accept(message(9, 1)), false, '스냅샷보다 오래된 메시지는 무시한다');
});

test('이벤트 큐: 밀린 이벤트가 많으면 빨리 감기로 전환한다', () => {
  // Given 임계치가 낮은 큐 (컴퓨터 좌석이 0.8초마다 커맨드를 보낸 상황)
  const queue = new EventPlaybackQueue({ maxEvents: 10, fastForwardThreshold: 3 });

  // When 임계치 이하로 쌓이면
  queue.accept(message(1, 3));
  // Then 평소 속도로 재생한다
  assert.equal(queue.fastForward, false);

  // When 임계치를 넘기면
  queue.accept(message(2, 2));
  // Then 빨리 감기로 전환한다
  assert.equal(queue.fastForward, true);
});

test('이벤트 큐: 큐 상한을 넘으면 오래된 이벤트를 버려 최신 상태로 수렴한다', () => {
  // Given 상한이 4인 큐
  const queue = new EventPlaybackQueue({ maxEvents: 4, fastForwardThreshold: 2 });

  // When 상한을 넘겨 이벤트가 들어오면
  queue.accept(message(1, 3));
  queue.accept(message(2, 3));

  // Then 큐 길이는 상한을 넘지 않고 가장 최근 이벤트가 남는다
  assert.equal(queue.size, 4);
  assert.equal(queue.shift().playerId, 'e1-2');
  assert.equal(queue.targetView.version, 2);
});

test('이벤트 큐: 뷰가 없는 메시지도 이벤트만 받아 재생한다', () => {
  // Given 빈 큐
  const queue = new EventPlaybackQueue();
  // When 뷰 없이 이벤트만 오면(방어적 입력)
  assert.equal(queue.accept({ events: [{ type: 'TURN_ENDED' }] }), true);
  // Then 이벤트는 재생 대상이 되고 목표 뷰는 그대로 비어 있다
  assert.equal(queue.size, 1);
  assert.equal(queue.targetView, null);
  assert.equal(queue.accept(null), false);
});

/* ------------------------------------------------------------------ */
/* 한국어 조사                                                          */
/* ------------------------------------------------------------------ */

test('한국어 조사: 받침 유무에 따라 조사를 골라 붙인다', () => {
  // Given 받침이 있는 말과 없는 말
  // When 조사를 붙이면
  // Then 자연스러운 한국어가 된다
  assert.equal(subject('하나'), '하나가');
  assert.equal(subject('두리'), '두리가');
  assert.equal(subject('서울'), '서울이');
  assert.equal(object('방콕'), '방콕을');
  assert.equal(object('파리'), '파리를');
  assert.equal(direction('방콕'), '방콕으로');
  assert.equal(direction('서울'), '서울로', 'ㄹ 받침 뒤에는 "로"를 쓴다');
  assert.equal(direction('파리'), '파리로');
  assert.equal(topic('서울'), '서울은');
});

test('한국어 조사: 숫자로 끝나는 이름은 숫자의 읽는 소리를 따른다', () => {
  // Given 컴퓨터 좌석 이름처럼 숫자로 끝나는 이름
  // When 주격 조사를 붙이면
  // Then 숫자를 읽은 소리(일·이·삼…)의 받침을 따른다
  assert.equal(subject('컴퓨터1'), '컴퓨터1이');
  assert.equal(subject('컴퓨터2'), '컴퓨터2가');
  assert.equal(subject('컴퓨터3'), '컴퓨터3이');
  assert.equal(subject('컴퓨터4'), '컴퓨터4가');
  assert.equal(subject('컴퓨터5'), '컴퓨터5가');
  assert.equal(subject('컴퓨터6'), '컴퓨터6이');
  assert.equal(direction('컴퓨터1'), '컴퓨터1로', '"일"은 ㄹ 받침');
});

test('게임 로그: 돈 이동 사유에도 조사를 붙여 문장을 다듬는다', () => {
  // Given 행운 티켓으로 현금을 받은 이벤트
  const line = formatEventLine(
    { type: 'MONEY_GAINED', playerId: 'seat-1', amount: 60_000, reason: 'TICKET' },
    LOG_CONTEXT,
  );
  // When 로그 문장을 만들면
  // Then "(으)로" 같은 표기 없이 자연스럽게 읽힌다
  assert.ok(line.text.includes('행운 티켓으로'), line.text);
  assert.ok(!line.text.includes('(으)로'));
  assert.ok(
    formatEventLine({ type: 'MONEY_LOST', playerId: 'seat-1', amount: 1, reason: 'CASINO' }, LOG_CONTEXT).text.includes(
      '카지노로',
    ),
  );
});

test('게임 로그: 지은 건물은 별장 · 빌딩 · 호텔 순서로 정리해 보여 준다', () => {
  // Given 서버가 임의 순서로 보낸 건설 목록
  const line = formatEventLine(
    { type: 'BUILT', playerId: 'seat-1', index: 19, name: '바르셀로나', buildings: ['HOTEL', 'BUILDING', 'VILLA'], cost: 396_000 },
    LOG_CONTEXT,
  );
  // When 로그 문장을 만들면
  // Then 항상 같은 순서로 읽힌다
  assert.ok(line.text.includes('별장 · 빌딩 · 호텔'), line.text);
});

test('이벤트 큐: 다른 방으로 옮기면 이전 방의 버전 기억을 버린다', () => {
  // Given 버전이 한참 올라간 방에서 플레이하던 큐
  const queue = new EventPlaybackQueue();
  queue.accept(message(120, 2));
  assert.equal(queue.latestVersion, 120);

  // When 다른 방(또는 새 게임)으로 들어가며 큐를 초기화하면
  queue.forget();

  // Then 버전 기억과 목표 뷰가 비워져, 버전 1부터 다시 시작하는 방도 정상 반영된다
  assert.equal(queue.size, 0);
  assert.equal(queue.targetView, null);
  assert.equal(queue.accept(message(1, 1)), true);
  assert.equal(queue.targetView.version, 1);
});
