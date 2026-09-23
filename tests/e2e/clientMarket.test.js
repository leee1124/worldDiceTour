/**
 * 증권거래소 클라이언트 도메인 로직 테스트(DOM 없음).
 *
 * 화면이 숫자를 하드코딩하지 않는다는 계약(API.md 9.1 `market.rules`)을 지키는지,
 * 주문 폼이 "왜 못 누르는지"를 언제나 말해 주는지, 스파크라인이 극단값에서도 깨지지 않는지를 본다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MARKET_RULES,
  buyTotalOf,
  depositChips,
  feeOf,
  maxBuyQuantity,
  maxSellQuantity,
  normalizeRules,
  notionalOf,
  quantizeAmount,
  sellProceedsOf,
  stepQuantity,
} from '../../public/js/domain/marketRules.js';
import { ORDER_KINDS, orderReasonText, previewOrder } from '../../public/js/domain/marketOrder.js';
import { sparklineLabel, sparklinePath } from '../../public/js/domain/marketSparkline.js';
import {
  changeTone,
  formatChangeBp,
  formatRateBp,
  formatSignedBpPercent,
} from '../../public/js/domain/marketFormat.js';
import {
  cycleView,
  orderKindLabel,
  rejectReasonLabel,
  sectorLabel,
  tradeErrorHint,
} from '../../public/js/domain/marketLabels.js';
import {
  holdingOf,
  holdingPnl,
  instrumentCards,
  netWorthRows,
  newsChips,
  priceBreakdownText,
  nudgeRows,
  queueRows,
} from '../../public/js/domain/marketModel.js';
import { TUTORIAL_CARDS, tutorialCard } from '../../public/js/domain/tutorialCards.js';
import { dividendNoticeModel } from '../../public/js/domain/dividendNotice.js';

/* ------------------------------------------------------------------ */
/* 고정 입력 (docs/fixtures/marketView.sample.json 과 같은 모양)          */
/* ------------------------------------------------------------------ */

const RULES = Object.freeze({
  feeBp: 100,
  feeMin: 1000,
  maxOrdersPerWindow: 3,
  maxNotionalPerWindow: 2_000_000,
  maxNotionalPerOrder: 1_000_000,
  minQuantity: 1,
  maxQuantity: 200,
  maxPositionPerInstrument: 500,
  depositUnit: 10_000,
  depositCap: 10_000_000,
  maxQueuedOrders: 3,
  baseRateMinBp: 25,
  baseRateMaxBp: 400,
  seriesLength: 30,
});

const AIR = Object.freeze({
  id: 'AIR',
  name: '한빛항공',
  sector: 'AIRLINE',
  sectorLabel: '항공',
  klass: 'STOCK',
  state: 'LISTED',
  price: 12_800,
  prevPrice: 12_000,
  changeBp: 666,
  basePrice: 12_000,
  tickUnit: 100,
  dividendBp: 150,
  series: [12_000, 12_300, 12_100, 12_000, 12_800],
});

const ENT = Object.freeze({ ...AIR, id: 'ENT', name: '네온엔터카지노', sector: 'ENTERTAINMENT', sectorLabel: '카지노·엔터', state: 'DELISTED', price: 0, changeBp: -1428, dividendBp: 0, series: [6000, 1400, 1200] });

const OPEN_BUDGET = Object.freeze({
  seatId: 'seat-1',
  open: true,
  ordersUsed: 1,
  ordersLeft: 2,
  ordersMax: 3,
  notionalUsed: 512_000,
  notionalLeft: 1_488_000,
  notionalMax: 2_000_000,
});

const MARKET = Object.freeze({
  investmentMode: 'STOCKS',
  cycle: { phase: 'EXPANSION', label: '호황', age: 2, driftBp: 150, volMulPct: 100 },
  baseRateBp: 125,
  news: {
    id: 'NE1',
    headline: '국제선 좌석이 모자란다',
    explanation: '여행 수요가 늘어난 좌석 공급을 앞질렀습니다.',
    round: 5,
    cyclePhase: 'EXPANSION',
    effects: [
      { target: 'SECTOR', sector: 'AIRLINE', bp: 600 },
      { target: 'SECTOR', sector: 'HOTEL', bp: 400 },
      { target: 'ALL', bp: -100 },
      { target: 'RATE', bp: 25 },
    ],
  },
  pendingNudges: [
    { sector: 'CONSTRUCTION', bp: 300, label: '건설' },
    { sector: 'ENTERTAINMENT', bp: -500, label: '카지노·엔터' },
  ],
  instruments: [AIR],
  holdings: {
    'seat-1': [{ instrumentId: 'AIR', qty: 40, avgCost: 12_000, marketValue: 512_000 }],
    'seat-2': [],
  },
  deposits: { 'seat-1': 500_000, 'seat-2': 0 },
  orderQueue: [
    { id: 'ord-2', seatId: 'seat-2', kind: 'BUY_STOCK', instrumentId: 'AIR', quantity: 20, amount: null },
    { id: 'ord-5', seatId: 'seat-1', kind: 'WITHDRAW', instrumentId: null, quantity: null, amount: 200_000 },
  ],
  budget: OPEN_BUDGET,
  rules: RULES,
});

/* ------------------------------------------------------------------ */
/* 수수료 · 명목금액 (규칙은 전부 DTO에서 온다)                            */
/* ------------------------------------------------------------------ */

test('시세 규칙: 명목금액과 수수료는 서버가 준 rules로만 계산한다', () => {
  // Given 서버가 준 수수료 규칙(1%, 최소 1,000원)
  // When 40주 × 12,800원을 주문하면
  const notional = notionalOf(40, AIR.price);
  // Then 명목금액 512,000원 · 수수료 5,120원이 된다(API.md 9.3 예시와 같다)
  assert.equal(notional, 512_000);
  assert.equal(feeOf(notional, RULES), 5_120);
  assert.equal(buyTotalOf(notional, RULES), 517_120);
  assert.equal(sellProceedsOf(notional, RULES), 506_880);
});

test('시세 규칙: 수수료는 올림이고 최소 수수료가 바닥이다', () => {
  // Given 아주 작은 명목금액
  // When 수수료를 계산하면
  // Then 1%를 올림한 값과 최소 수수료 중 큰 값이 나온다
  assert.equal(feeOf(1, RULES), 1_000);
  assert.equal(feeOf(100_000, RULES), 1_000);
  assert.equal(feeOf(100_001, RULES), 1_001);
  assert.equal(feeOf(0, RULES), 0);
});

test('시세 규칙: 같은 창구에서 사고팔면 언제나 손실이다(수수료 양방향)', () => {
  // Given 가격이 고정된 한 창구 안
  for (const quantity of [1, 7, 33, 199, 200]) {
    // When 같은 수량을 사고 곧바로 팔면
    const notional = notionalOf(quantity, AIR.price);
    const spent = buyTotalOf(notional, RULES);
    const received = sellProceedsOf(notional, RULES);
    // Then 받은 돈이 쓴 돈보다 항상 적다
    assert.ok(received < spent, `${quantity}주에서 손실이 아니다`);
  }
});

test('시세 규칙: rules가 비었거나 망가져도 기본값으로 버틴다', () => {
  // Given 서버 필드가 누락된 rules
  // When 정규화하면
  const rules = normalizeRules({ feeBp: -5, maxQuantity: 'x', depositUnit: 0 });
  // Then 모든 값이 기본값(양수 정수)으로 채워진다
  assert.equal(rules.feeBp, DEFAULT_MARKET_RULES.feeBp);
  assert.equal(rules.maxQuantity, DEFAULT_MARKET_RULES.maxQuantity);
  assert.equal(rules.depositUnit, DEFAULT_MARKET_RULES.depositUnit);
  assert.equal(normalizeRules(null).feeMin, DEFAULT_MARKET_RULES.feeMin);
});

/* ------------------------------------------------------------------ */
/* 최대 수량 계산                                                        */
/* ------------------------------------------------------------------ */

test('최대 수량: 현금·창구 예산·보유 상한 중 가장 좁은 한도를 따른다', () => {
  // Given 현금 1,480,000원 · 남은 예산 1,488,000원 · 이미 40주 보유
  // When 최대 매수 수량을 구하면
  const max = maxBuyQuantity({ price: AIR.price, cash: 1_480_000, rules: RULES, budget: OPEN_BUDGET, held: 40 });
  // Then 수수료까지 낸 뒤에도 현금이 남는 수량이 나온다
  assert.ok(max > 0);
  const notional = notionalOf(max, AIR.price);
  assert.ok(buyTotalOf(notional, RULES) <= 1_480_000, '현금을 넘는다');
  const over = notionalOf(max + 1, AIR.price);
  assert.ok(
    buyTotalOf(over, RULES) > 1_480_000 || over > RULES.maxNotionalPerOrder || max + 1 > RULES.maxQuantity,
    '한 주 더 살 수 있는데 멈췄다',
  );
});

test('최대 수량: 주문 1건 명목금액 한도(1,000,000원)를 넘지 않는다', () => {
  // Given 현금이 아주 많은 좌석
  // When 최대 매수 수량을 구하면
  const max = maxBuyQuantity({ price: AIR.price, cash: 900_000_000, rules: RULES, budget: OPEN_BUDGET, held: 0 });
  // Then 1건 한도와 창구 잔여 예산을 모두 지킨다
  assert.ok(notionalOf(max, AIR.price) <= RULES.maxNotionalPerOrder);
  assert.ok(notionalOf(max, AIR.price) <= OPEN_BUDGET.notionalLeft);
});

test('최대 수량: 종목별 보유 상한(500주)에 닿으면 0이다', () => {
  // Given 이미 500주를 가진 좌석
  // When 최대 매수 수량을 구하면
  const max = maxBuyQuantity({ price: AIR.price, cash: 900_000_000, rules: RULES, budget: OPEN_BUDGET, held: 500 });
  // Then 더 살 수 없다
  assert.equal(max, 0);
});

test('최대 수량: 매도는 보유 수량과 1회 수량 상한 중 작은 값이다', () => {
  // Given 보유 수량이 상한보다 많은 경우와 적은 경우
  // When 최대 매도 수량을 구하면
  // Then 각각 상한과 보유 수량으로 묶인다
  assert.equal(maxSellQuantity({ held: 320, rules: RULES }), 200);
  assert.equal(maxSellQuantity({ held: 12, rules: RULES }), 12);
  assert.equal(maxSellQuantity({ held: 0, rules: RULES }), 0);
});

test('수량 스테퍼: ±1/±10은 언제나 허용 범위 안에 머문다', () => {
  // Given 1~200 범위와 최대 47주
  // When 크게 더하거나 빼면
  // Then 범위를 벗어나지 않는다
  assert.equal(stepQuantity(45, 10, { rules: RULES, max: 47 }), 47);
  assert.equal(stepQuantity(3, -10, { rules: RULES, max: 47 }), 1);
  assert.equal(stepQuantity(0, 0, { rules: RULES, max: 0 }), 0);
});

test('예금 금액: 10,000원 단위로 내림하고 한도 안에 둔다', () => {
  // Given 단위에 맞지 않는 입력
  // When 금액을 정리하면
  // Then 단위로 내려가고 최대치를 넘지 않는다
  assert.equal(quantizeAmount(37_500, { rules: RULES, max: 500_000 }), 30_000);
  assert.equal(quantizeAmount(900_000, { rules: RULES, max: 500_000 }), 500_000);
  assert.equal(quantizeAmount(5_000, { rules: RULES, max: 500_000 }), 10_000);
  assert.equal(quantizeAmount(50_000, { rules: RULES, max: 0 }), 0);
});

test('예금 칩: 단위의 배수만, 오름차순으로, 중복 없이 준다', () => {
  // Given 잔여 한도 500,000원
  const chips = depositChips(500_000, RULES);
  // When 빠른 선택 칩을 만들면
  // Then 모두 단위의 배수이고 한도 안이며 오름차순이다
  assert.ok(chips.length > 0);
  assert.deepEqual(chips, [...new Set(chips)].sort((a, b) => a - b));
  for (const chip of chips) {
    assert.equal(chip % RULES.depositUnit, 0);
    assert.ok(chip > 0 && chip <= 500_000);
  }
  assert.deepEqual(depositChips(0, RULES), []);
});

/* ------------------------------------------------------------------ */
/* 주문 폼 검증과 "못 누르는 이유"                                        */
/* ------------------------------------------------------------------ */

const base = {
  rules: RULES,
  budget: OPEN_BUDGET,
  cash: 1_480_000,
  deposit: 500_000,
  held: 40,
  queuedCount: 0,
};

test('주문 폼: 정상 매수는 지출·수수료·잔여 현금을 미리 보여 준다', () => {
  // Given 40주 매수
  // When 미리보기를 만들면
  const preview = previewOrder({ ...base, kind: 'BUY_STOCK', instrument: AIR, quantity: 40 });
  // Then 총지출 = 명목 + 수수료이고 주문 뒤 현금이 계산된다
  assert.equal(preview.ok, true);
  assert.equal(preview.reason, 'NONE');
  assert.equal(preview.notional, 512_000);
  assert.equal(preview.fee, 5_120);
  assert.equal(preview.total, 517_120);
  assert.equal(preview.cashAfter, 1_480_000 - 517_120);
  assert.equal(preview.ordersLeftAfter, 1);
});

test('주문 폼: 정상 매도는 수수료를 뺀 수령액을 보여 준다', () => {
  // Given 보유 40주 중 10주 매도
  // When 미리보기를 만들면
  const preview = previewOrder({ ...base, kind: 'SELL_STOCK', instrument: AIR, quantity: 10 });
  // Then 수령액 = 명목 − 수수료이고 현금이 늘어난다
  assert.equal(preview.ok, true);
  assert.equal(preview.notional, 128_000);
  assert.equal(preview.fee, 1_280);
  assert.equal(preview.total, 126_720);
  assert.equal(preview.cashAfter, 1_480_000 + 126_720);
});

test('주문 폼: 현금이 부족하면 이유를 말하고 막는다', () => {
  // Given 현금 10,000원
  // When 40주 매수를 미리보면
  const preview = previewOrder({ ...base, cash: 10_000, kind: 'BUY_STOCK', instrument: AIR, quantity: 40 });
  // Then 거절 이유가 현금 부족이고 사람이 읽을 문구가 함께 온다
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, 'INSUFFICIENT_CASH');
  assert.ok(preview.reasonText.includes('현금'), preview.reasonText);
});

test('주문 폼: 보유 수량보다 많이 팔 수 없다', () => {
  // Given 40주 보유
  // When 41주 매도를 미리보면
  const preview = previewOrder({ ...base, kind: 'SELL_STOCK', instrument: AIR, quantity: 41 });
  // Then 보유 수량 부족으로 막힌다
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, 'NOT_ENOUGH_SHARES');
});

test('주문 폼: 종목별 보유 상한을 넘는 매수는 막힌다', () => {
  // Given 이미 450주 보유(상한 500주)
  // When 60주를 더 사려 하면
  const preview = previewOrder({
    ...base,
    cash: 900_000_000,
    held: 450,
    kind: 'BUY_STOCK',
    instrument: AIR,
    quantity: 60,
  });
  // Then 보유 상한 위반으로 막힌다(서버 ERR018과 같은 이유)
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, 'POSITION_LIMIT');
});

test('주문 폼: 창구 잔여 예산과 1건 한도를 각각 구분해 알려 준다', () => {
  // Given 남은 예산이 100,000원뿐인 창구
  const tight = { ...OPEN_BUDGET, notionalLeft: 100_000 };
  // When 예산을 넘는 주문을 미리보면
  const overWindow = previewOrder({ ...base, cash: 900_000_000, budget: tight, kind: 'BUY_STOCK', instrument: AIR, quantity: 40 });
  // Then 창구 예산 초과로 막히고
  assert.equal(overWindow.reason, 'NOTIONAL_LIMIT');

  // When 1건 한도(1,000,000원)만 넘는 주문이면
  const overOrder = previewOrder({ ...base, cash: 900_000_000, kind: 'BUY_STOCK', instrument: AIR, quantity: 100 });
  // Then 1건 한도 초과로 구분해 막는다
  assert.equal(overOrder.reason, 'ORDER_NOTIONAL_LIMIT');
});

test('주문 폼: 주문 건수를 다 쓰면 모든 주문이 막힌다', () => {
  // Given 3건을 모두 쓴 창구
  const used = { ...OPEN_BUDGET, ordersUsed: 3, ordersLeft: 0 };
  // When 주문을 미리보면
  const preview = previewOrder({ ...base, budget: used, kind: 'BUY_STOCK', instrument: AIR, quantity: 1 });
  // Then 주문 한도 초과로 막힌다
  assert.equal(preview.reason, 'ORDER_LIMIT');
});

test('주문 폼: 예산이 바닥나 수량이 0이 돼도 진짜 이유(주문 한도)를 말한다', () => {
  // Given 주문 3건을 모두 쓴 창구(고를 수 있는 수량이 0이 된다)
  const spent = { ...OPEN_BUDGET, ordersUsed: 3, ordersLeft: 0, notionalLeft: 0 };
  // When 수량 0으로 미리보면
  const stock = previewOrder({ ...base, budget: spent, kind: 'BUY_STOCK', instrument: AIR, quantity: 0 });
  const deposit = previewOrder({ ...base, budget: spent, kind: 'DEPOSIT', amount: 0 });
  // Then "수량 범위"가 아니라 "주문 한도"라고 말한다(수량이 0인 것은 결과이지 원인이 아니다)
  assert.equal(stock.reason, 'ORDER_LIMIT');
  assert.equal(deposit.reason, 'ORDER_LIMIT');
});

test('주문 폼: 창구가 닫혀 있으면 즉시 주문은 막고 예약 주문은 허용한다', () => {
  // Given 창구가 닫힌 예산(남의 턴)
  const closed = { ...OPEN_BUDGET, open: false };
  // When 즉시 주문을 미리보면
  assert.equal(previewOrder({ ...base, budget: closed, kind: 'BUY_STOCK', instrument: AIR, quantity: 1 }).reason, 'WINDOW_CLOSED');
  // Then 예약 모드에서는 같은 주문이 통과한다(체결은 내 차례에 재검증된다)
  const queued = previewOrder({ ...base, budget: closed, queueMode: true, kind: 'BUY_STOCK', instrument: AIR, quantity: 1 });
  assert.equal(queued.ok, true);
});

test('주문 폼: 예약은 좌석당 3건까지다', () => {
  // Given 이미 3건을 예약한 좌석
  // When 네 번째 예약을 미리보면
  const preview = previewOrder({ ...base, queueMode: true, queuedCount: 3, kind: 'BUY_STOCK', instrument: AIR, quantity: 1 });
  // Then 예약 한도 초과로 막힌다
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, 'QUEUE_FULL');
});

test('주문 폼: 예약 모드에서는 창구 예산을 미리 소진했다고 보지 않는다', () => {
  // Given 창구 예산을 다 쓴 상태에서의 예약(체결은 다음 창구에서 일어난다)
  const spent = { ...OPEN_BUDGET, open: false, ordersLeft: 0, notionalLeft: 0 };
  // When 예약 주문을 미리보면
  const preview = previewOrder({ ...base, budget: spent, queueMode: true, kind: 'BUY_STOCK', instrument: AIR, quantity: 20 });
  // Then 통과하고, 안내 문구로 재검증 사실을 알린다
  assert.equal(preview.ok, true);
  assert.ok(preview.note.includes('재검증') || preview.note.includes('내 차례'), preview.note);
});

test('주문 폼: 상장폐지 종목은 사고팔 수 없다', () => {
  // Given 상장폐지된 종목
  // When 주문을 미리보면
  const preview = previewOrder({ ...base, kind: 'BUY_STOCK', instrument: ENT, quantity: 1 });
  // Then 상장폐지 이유로 막힌다
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, 'DELISTED');
});

test('주문 폼: 종목을 고르지 않으면 고르라고 말한다', () => {
  // Given 종목 미선택
  // When 주문을 미리보면
  const preview = previewOrder({ ...base, kind: 'BUY_STOCK', instrument: null, quantity: 1 });
  // Then 종목 선택을 요구한다
  assert.equal(preview.reason, 'NO_INSTRUMENT');
});

test('주문 폼: 수량 0은 범위 밖으로 막고 200주 초과도 막는다', () => {
  // Given 범위를 벗어난 수량
  // When 주문을 미리보면
  // Then 수량 범위 위반으로 막힌다
  assert.equal(previewOrder({ ...base, kind: 'BUY_STOCK', instrument: AIR, quantity: 0 }).reason, 'QUANTITY_RANGE');
  assert.equal(previewOrder({ ...base, kind: 'SELL_STOCK', instrument: AIR, quantity: 201 }).reason, 'QUANTITY_RANGE');
});

test('주문 폼: 예치는 단위·한도·현금을 모두 본다', () => {
  // Given 예금 잔액 500,000원 · 한도 10,000,000원
  // When 단위에 맞지 않는 금액이면
  assert.equal(previewOrder({ ...base, kind: 'DEPOSIT', amount: 15_000 }).reason, 'DEPOSIT_UNIT');
  // When 현금보다 많은 금액이면
  assert.equal(previewOrder({ ...base, kind: 'DEPOSIT', amount: 2_000_000 }).reason, 'INSUFFICIENT_CASH');
  // When 예금 한도를 넘기면
  assert.equal(
    previewOrder({ ...base, cash: 900_000_000, deposit: 9_990_000, kind: 'DEPOSIT', amount: 20_000 }).reason,
    'DEPOSIT_CAP',
  );
  // Then 정상 금액은 통과하고 예금 잔액 변화를 보여 준다
  const ok = previewOrder({ ...base, kind: 'DEPOSIT', amount: 100_000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.fee, 0);
  assert.equal(ok.total, 100_000);
  assert.equal(ok.cashAfter, 1_380_000);
  assert.equal(ok.depositAfter, 600_000);
});

test('주문 폼: 인출은 예금 잔액을 넘을 수 없다', () => {
  // Given 예금 500,000원
  // When 600,000원을 인출하려 하면
  const preview = previewOrder({ ...base, kind: 'WITHDRAW', amount: 600_000 });
  // Then 예금 부족으로 막힌다
  assert.equal(preview.reason, 'INSUFFICIENT_DEPOSIT');
  // Then 잔액 안의 금액은 통과하고 현금이 늘어난다
  const ok = previewOrder({ ...base, kind: 'WITHDRAW', amount: 200_000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.cashAfter, 1_680_000);
  assert.equal(ok.depositAfter, 300_000);
});

test('주문 폼: 모든 거절 이유에 한국어 문구가 있다', () => {
  // Given 클라이언트가 만들 수 있는 모든 거절 코드
  const codes = [
    'NONE', 'NO_INSTRUMENT', 'DELISTED', 'QUANTITY_RANGE', 'INSUFFICIENT_CASH', 'NOT_ENOUGH_SHARES',
    'POSITION_LIMIT', 'ORDER_LIMIT', 'NOTIONAL_LIMIT', 'ORDER_NOTIONAL_LIMIT', 'DEPOSIT_UNIT',
    'DEPOSIT_CAP', 'INSUFFICIENT_DEPOSIT', 'WINDOW_CLOSED', 'QUEUE_FULL',
  ];
  for (const code of codes) {
    // When 문구를 찾으면
    const text = orderReasonText(code, { rules: RULES });
    // Then 비어 있지 않다(NONE만 빈 문자열)
    if (code === 'NONE') {
      assert.equal(text, '');
    } else {
      assert.ok(text.length > 0, code);
    }
  }
  assert.ok(orderReasonText('언젠가 생길 새 코드', { rules: RULES }).length > 0);
});

test('주문 폼: 주문 종류 목록은 서버 커맨드 이름과 같다', () => {
  // Given 클라이언트가 보낼 수 있는 주문 종류
  // When 목록을 보면
  // Then API.md 9.4의 커맨드 이름과 일치한다
  assert.deepEqual([...ORDER_KINDS], ['BUY_STOCK', 'SELL_STOCK', 'DEPOSIT', 'WITHDRAW']);
});

/* ------------------------------------------------------------------ */
/* 스파크라인                                                           */
/* ------------------------------------------------------------------ */

test('스파크라인: 일반 시세는 좌→우로 이어지는 경로가 된다', () => {
  // Given 5개 가격
  // When 경로를 만들면
  const line = sparklinePath(AIR.series, { width: 100, height: 32 });
  // Then 점이 5개이고 가장 낮은 값이 바닥, 가장 높은 값이 천장에 닿는다
  assert.equal(line.points.length, 5);
  assert.equal(line.empty, false);
  assert.equal(line.flat, false);
  assert.equal(line.min, 12_000);
  assert.equal(line.max, 12_800);
  assert.equal(line.points[0].x, 0);
  assert.equal(line.points[4].x, 100);
  assert.ok(line.path.startsWith('M'));
  for (const point of line.points) {
    assert.ok(point.y >= 0 && point.y <= 32, `y=${point.y}`);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }
});

test('스파크라인: 값이 하나뿐이어도 선이 생긴다(0으로 나누지 않는다)', () => {
  // Given 값 하나
  // When 경로를 만들면
  const line = sparklinePath([8_000], { width: 100, height: 32 });
  // Then 가운데 높이의 수평선이 되고 좌우 끝을 모두 채운다
  assert.equal(line.flat, true);
  assert.equal(line.points.length, 2);
  assert.equal(line.points[0].y, line.points[1].y);
  assert.equal(line.points[0].x, 0);
  assert.equal(line.points[1].x, 100);
  assert.ok(!line.path.includes('NaN'));
});

test('스파크라인: 완전히 평평한 시세도 NaN을 만들지 않는다', () => {
  // Given 같은 값이 반복되는 시세
  // When 경로를 만들면
  const line = sparklinePath([5_000, 5_000, 5_000], { width: 100, height: 32 });
  // Then flat으로 표시되고 모든 y가 같다
  assert.equal(line.flat, true);
  assert.ok(!line.path.includes('NaN'));
  assert.equal(new Set(line.points.map((point) => point.y)).size, 1);
});

test('스파크라인: 빈 시세와 이상한 값은 빈 경로로 막는다', () => {
  // Given 비어 있거나 숫자가 아닌 시세
  // When 경로를 만들면
  // Then empty가 되고 경로 문자열이 비어 있다
  for (const series of [[], null, undefined, ['x', null]]) {
    const line = sparklinePath(series, { width: 100, height: 32 });
    assert.equal(line.empty, true, JSON.stringify(series));
    assert.equal(line.path, '');
  }
});

test('스파크라인: 음수·거대한 값에서도 경계를 벗어나지 않는다', () => {
  // Given 극단적인 시세
  // When 경로를 만들면
  const line = sparklinePath([-100, 0, 9_999_999], { width: 60, height: 20 });
  // Then 모든 좌표가 상자 안에 있다
  for (const point of line.points) {
    assert.ok(point.x >= 0 && point.x <= 60);
    assert.ok(point.y >= 0 && point.y <= 20);
  }
});

test('스파크라인: 스크린리더 설명은 종목·구간·시작·끝을 말한다', () => {
  // Given 종목 이름과 시세
  // When aria-label 문구를 만들면
  const label = sparklineLabel({ name: '한빛항공', series: AIR.series });
  // Then 이름·라운드 수·시작가·현재가가 담긴다
  assert.ok(label.includes('한빛항공'), label);
  assert.ok(label.includes('12,000'), label);
  assert.ok(label.includes('12,800'), label);
  assert.ok(label.includes('5'), label);
  // Then 시세가 없으면 없다고 말한다
  assert.ok(sparklineLabel({ name: '한빛항공', series: [] }).includes('한빛항공'));
});

/* ------------------------------------------------------------------ */
/* 등락 표기 (색만으로 구분하지 않는다)                                   */
/* ------------------------------------------------------------------ */

test('등락 표기: bp를 퍼센트로 바꾸고 부호와 화살표를 함께 붙인다', () => {
  // Given 서버가 준 등락률(bp)
  // When 표기를 만들면
  const up = formatChangeBp(666);
  const down = formatChangeBp(-862);
  const flat = formatChangeBp(0);
  // Then 색 없이도 방향을 읽을 수 있다(화살표 + 부호)
  assert.equal(up.tone, 'up');
  assert.equal(up.arrow, '▲');
  assert.equal(up.text, '▲ +6.66%');
  assert.equal(down.tone, 'down');
  assert.equal(down.arrow, '▼');
  assert.equal(down.text, '▼ -8.62%');
  assert.equal(flat.tone, 'flat');
  assert.equal(flat.text, '— 0.00%');
});

test('등락 표기: 기준금리와 뉴스 효과는 부호 있는 퍼센트로 읽는다', () => {
  // Given 기준금리 125bp와 뉴스 효과 +600bp / −1400bp
  // When 표기를 만들면
  // Then 사람이 읽는 퍼센트가 된다
  assert.equal(formatRateBp(125), '1.25%');
  assert.equal(formatRateBp(0), '0.00%');
  assert.equal(formatSignedBpPercent(600), '+6.00%');
  assert.equal(formatSignedBpPercent(-1_400), '-14.00%');
  assert.equal(formatSignedBpPercent(0), '0.00%');
});

test('등락 표기: 숫자가 아닌 값도 평평한 값으로 다룬다', () => {
  // Given 서버 필드 누락
  // When 표기를 만들면
  // Then 예외 없이 flat이 된다
  assert.equal(changeTone(undefined), 'flat');
  assert.equal(formatChangeBp(null).tone, 'flat');
  assert.equal(formatRateBp('x'), '0.00%');
});

/* ------------------------------------------------------------------ */
/* 라벨                                                                */
/* ------------------------------------------------------------------ */

test('라벨: 경기 국면 4종은 아이콘·색·설명을 함께 갖는다', () => {
  // Given 서버의 국면 코드 4종
  for (const phase of ['EXPANSION', 'OVERHEAT', 'RECESSION', 'RECOVERY']) {
    // When 화면 모델을 만들면
    const view = cycleView({ phase, label: null, age: 3, driftBp: 100, volMulPct: 120 });
    // Then 이름·아이콘·톤·한 줄 설명이 모두 있다
    assert.ok(view.label.length > 0, phase);
    assert.ok(view.icon.length > 0, phase);
    assert.ok(view.tone.length > 0, phase);
    assert.ok(view.hint.length > 0, phase);
  }
  // Then 서버가 준 label이 있으면 그것을 쓴다(서버가 유일한 권위)
  assert.equal(cycleView({ phase: 'EXPANSION', label: '호황' }).label, '호황');
  // Then 모르는 국면도 예외 없이 그려진다
  assert.ok(cycleView({ phase: 'FUTURE_PHASE' }).label.length > 0);
  assert.ok(cycleView(null).label.length > 0);
});

test('라벨: 섹터·주문 종류·거절 사유에 한국어가 있다', () => {
  // Given 계약에 적힌 코드들
  // When 라벨을 찾으면
  assert.equal(sectorLabel('AIRLINE'), '항공');
  assert.equal(sectorLabel('ENERGY'), '에너지');
  assert.equal(orderKindLabel('BUY_STOCK'), '매수');
  assert.equal(orderKindLabel('WITHDRAW'), '인출');
  for (const code of [
    'WINDOW_CLOSED', 'INSUFFICIENT_CASH', 'NOT_ENOUGH_SHARES', 'DELISTED', 'UNKNOWN_INSTRUMENT',
    'ORDER_LIMIT', 'NOTIONAL_LIMIT', 'POSITION_LIMIT', 'DEPOSIT_CAP', 'INSUFFICIENT_DEPOSIT',
  ]) {
    assert.ok(rejectReasonLabel(code).length > 0, code);
  }
  // Then 모르는 코드도 빈 문자열이 아니다
  assert.ok(sectorLabel('NEW_SECTOR').length > 0);
  assert.ok(orderKindLabel('NEW_KIND').length > 0);
  assert.ok(rejectReasonLabel('NEW_REASON').length > 0);
});

test('라벨: 거래 에러 코드는 재시도 방법까지 안내한다', () => {
  // Given 서버 에러 코드
  // When 힌트를 찾으면
  const limit = tradeErrorHint('ERR018');
  const rate = tradeErrorHint('ERR019');
  // Then 한도 초과와 레이트 리밋을 구분하고, 레이트 리밋은 잠깐 기다리라고 한다
  assert.ok(limit.message.length > 0);
  assert.equal(limit.cooldownMs, 0);
  assert.ok(rate.cooldownMs >= 1000, '레이트 리밋에는 쿨다운이 있어야 한다');
  // Then 모르는 코드는 일반 안내로 떨어진다
  assert.ok(tradeErrorHint('ERR999').message.length > 0);
  assert.equal(tradeErrorHint(undefined).cooldownMs, 0);
});

/* ------------------------------------------------------------------ */
/* 화면 모델                                                            */
/* ------------------------------------------------------------------ */

test('보유 모델: 좌석별 보유를 찾고 없으면 null이다', () => {
  // Given 전원의 보유 목록
  // When 좌석과 종목으로 찾으면
  // Then 있으면 항목을, 없으면 null을 준다
  assert.equal(holdingOf(MARKET, 'seat-1', 'AIR').qty, 40);
  assert.equal(holdingOf(MARKET, 'seat-2', 'AIR'), null);
  assert.equal(holdingOf(MARKET, '없는좌석', 'AIR'), null);
  assert.equal(holdingOf(null, 'seat-1', 'AIR'), null);
});

test('보유 모델: 평가손익은 평균단가와 현재가로 계산한다', () => {
  // Given 평균단가 12,000원에 40주, 현재가 12,800원
  // When 손익을 계산하면
  const pnl = holdingPnl({ qty: 40, avgCost: 12_000 }, 12_800);
  // Then 평가액·원가·손익·수익률(bp)이 나온다
  assert.equal(pnl.value, 512_000);
  assert.equal(pnl.cost, 480_000);
  assert.equal(pnl.profit, 32_000);
  assert.equal(pnl.profitBp, 666);
  assert.equal(pnl.tone, 'up');
  // Then 보유가 없으면 0으로 떨어진다
  assert.equal(holdingPnl(null, 12_800).profit, 0);
  assert.equal(holdingPnl({ qty: 10, avgCost: 0 }, 100).profitBp, 0);
});

test('총자산 내역: 현금·부동산·주식·예금·대출을 순서대로 분해한다', () => {
  // Given 서버가 준 netWorth 내역
  const player = {
    cash: 1_480_000,
    totalAssets: 3_072_000,
    netWorth: { cash: 1_480_000, property: 580_000, stock: 512_000, deposit: 500_000, loanDebt: 0, total: 3_072_000 },
  };
  // When 표시용 행으로 바꾸면
  const rows = netWorthRows(player);
  // Then 현금·부동산·주식·예금 네 줄이 순서대로 있고 합이 총자산과 같다
  assert.deepEqual(rows.map((row) => row.key), ['cash', 'property', 'stock', 'deposit']);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 3_072_000);

  // When 대출 채무가 있으면
  const debtor = netWorthRows({
    cash: 0,
    netWorth: { cash: 100, property: 0, stock: 0, deposit: 0, loanDebt: 1_200_000, total: -1_199_900 },
  });
  // Then 채무 줄이 음수 톤으로 추가된다
  const debt = debtor.find((row) => row.key === 'loanDebt');
  assert.ok(debt);
  assert.equal(debt.amount, -1_200_000);
  assert.equal(debt.tone, 'out');
});

test('총자산 내역: netWorth가 없는 예전 서버에서도 현금만으로 버틴다', () => {
  // Given netWorth 필드가 없는 뷰(투자 모드 OFF의 예전 응답)
  // When 행을 만들면
  const rows = netWorthRows({ cash: 300_000, totalAssets: 300_000 });
  // Then 현금 줄만 남고 예외가 없다
  assert.deepEqual(rows.map((row) => row.key), ['cash']);
  assert.equal(rows[0].amount, 300_000);
  assert.deepEqual(netWorthRows(null), []);
});

test('뉴스 칩: 섹터·전체·금리 효과를 각각 다른 칩으로 만든다', () => {
  // Given 섹터 2개 · 전 종목 · 금리 효과가 섞인 뉴스
  // When 칩 모델을 만들면
  const chips = newsChips(MARKET.news);
  // Then 4개가 나오고 각각 이름·부호 문구·톤을 갖는다
  assert.equal(chips.length, 4);
  assert.equal(chips[0].label, '항공');
  assert.equal(chips[0].tone, 'up');
  assert.equal(chips[0].text, '+6.00% 압력');
  assert.equal(chips[2].label, '전 종목');
  assert.equal(chips[2].tone, 'down');
  assert.equal(chips[3].label, '기준금리');
  // Then 뉴스가 없으면 빈 배열이다
  assert.deepEqual(newsChips(null), []);
  assert.deepEqual(newsChips({ effects: null }), []);
});

test('압력 칩: 다음 틱에 반영될 보드 압력을 읽을 수 있게 만든다', () => {
  // Given 건설 +300bp · 카지노 −500bp 압력
  // When 칩 모델을 만들면
  const rows = nudgeRows(MARKET);
  // Then 섹터 이름과 부호 문구가 함께 오고 톤이 갈린다
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, '건설');
  assert.equal(rows[0].text, '+3.00%');
  assert.equal(rows[0].tone, 'up');
  assert.equal(rows[1].tone, 'down');
  assert.deepEqual(nudgeRows(null), []);
  assert.deepEqual(nudgeRows({ pendingNudges: [] }), []);
});

test('예약 목록: 전원의 예약을 순서대로 보여 주고 내 것만 취소할 수 있다', () => {
  // Given 다른 좌석과 내 좌석의 예약이 섞인 큐
  // When 목록 모델을 만들면
  const rows = queueRows(MARKET, {
    mySeatIds: ['seat-1'],
    seatNameOf: (seatId) => (seatId === 'seat-1' ? '하나' : '두리'),
  });
  // Then 등록 순서가 유지되고, 내 예약만 취소 가능으로 표시된다
  assert.equal(rows.length, 2);
  assert.equal(rows[0].orderId, 'ord-2');
  assert.equal(rows[0].seatName, '두리');
  assert.equal(rows[0].mine, false);
  assert.equal(rows[0].cancellable, false);
  assert.equal(rows[1].orderId, 'ord-5');
  assert.equal(rows[1].mine, true);
  assert.equal(rows[1].cancellable, true);
  // Then 주식 예약은 수량, 예금 예약은 금액을 읽어 준다
  assert.ok(rows[0].detail.includes('20'), rows[0].detail);
  assert.ok(rows[1].detail.includes('200,000'), rows[1].detail);
  assert.deepEqual(queueRows(null, { mySeatIds: [], seatNameOf: () => '' }), []);
});

test('종목 카드: 이름·시세·등락·보유·배당·상장폐지를 한 모델로 모은다', () => {
  // Given 시장 스냅샷과 내 좌석
  // When 카드 모델을 만들면
  const cards = instrumentCards(MARKET, 'seat-1');
  // Then 종목 수만큼 나오고 등락·보유·스파크라인이 함께 담긴다
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.id, 'AIR');
  assert.equal(card.name, '한빛항공');
  assert.equal(card.sectorLabel, '항공');
  assert.equal(card.price, 12_800);
  assert.equal(card.change.tone, 'up');
  assert.equal(card.qty, 40);
  assert.equal(card.pnl.profit, 32_000);
  assert.equal(card.delisted, false);
  assert.equal(card.dividendText, '1.50%');
  assert.equal(card.spark.points.length, 5);
  assert.ok(card.ariaLabel.includes('한빛항공'));

  // Then 상장폐지 종목은 거래 불가로 표시된다
  const delisted = instrumentCards({ ...MARKET, instruments: [ENT], rules: RULES }, 'seat-1')[0];
  assert.equal(delisted.delisted, true);
  assert.equal(delisted.tradable, false);
  assert.equal(delisted.dividendText, '없음');

  // Then 시장이 없으면 빈 배열이다(투자 모드 OFF)
  assert.deepEqual(instrumentCards(null, 'seat-1'), []);
});

/* ------------------------------------------------------------------ */
/* 튜토리얼 카드                                                        */
/* ------------------------------------------------------------------ */

test('튜토리얼: 세 장의 카드가 제목·본문·핵심 요약을 갖는다', () => {
  // Given 첫 사용 안내 카드 3종
  // When 목록을 보면
  assert.equal(TUTORIAL_CARDS.length, 3);
  for (const card of TUTORIAL_CARDS) {
    // Then 각 카드에 id·제목·본문 문단·요약 항목이 있다
    assert.ok(card.id.length > 0);
    assert.ok(card.title.length > 0);
    assert.ok(card.paragraphs.length > 0);
    assert.ok(card.points.length > 0);
    for (const paragraph of card.paragraphs) {
      assert.equal(typeof paragraph, 'string');
      assert.ok(paragraph.length > 0);
    }
  }
  // Then id로 찾을 수 있고 없는 id는 null이다
  assert.equal(tutorialCard('STOCK').id, 'STOCK');
  assert.equal(tutorialCard('없는카드'), null);
});

test('보유 손익: 평단가와 수익률을 사람이 읽을 문구로 만든다', () => {
  // Given — 40주를 평균 12,000원에 샀고 지금 12,800원
  const pnl = holdingPnl({ qty: 40, avgCost: 12_000 }, 12_800);

  // When / Then — 평단·수익 금액·수익률(원가 대비)이 한 줄로 읽힌다
  assert.equal(pnl.avgCost, 12_000);
  assert.equal(pnl.holdingText, '보유 40주 · 평단 12,000원');
  assert.equal(pnl.pnlText, '+32,000원 (+6.66%)');
});

test('보유 손익: 손실이면 음수 부호와 하락률로 적고, 보유가 없으면 빈 문구다', () => {
  // Given
  const loss = holdingPnl({ qty: 10, avgCost: 10_000 }, 9_000);
  const none = holdingPnl(null, 9_000);

  // Then
  assert.equal(loss.pnlText, '-10,000원 (-10.00%)');
  assert.equal(none.holdingText, '');
  assert.equal(none.pnlText, '');
});

test('종목 카드: 보유 중이면 평단가 문구가 카드에 실린다', () => {
  // Given
  const cards = instrumentCards(MARKET, 'seat-1');
  const held = cards.find((card) => card.qty > 0);

  // Then
  assert.ok(held, '픽스처에 보유 종목이 있어야 한다');
  assert.match(held.pnl.holdingText, /^보유 \d+주 · 평단 [\d,]+원$/);
  assert.match(held.ariaLabel, /평단/);
});

test('시세 분해 문구: 실제 등락을 뉴스·경기 추세·운으로 나눠 읽어 준다', () => {
  // Given — 서버가 준 한 종목의 변화(+10% 뉴스, 회복 +1.5% 추세, 운 −9%)
  const change = { instrumentId: 'ENT', changeBp: 250, breakdown: { newsBp: 1_000, driftBp: 150, nudgeBp: 0, shockBp: -900 } };

  // When
  const text = priceBreakdownText(change, { cyclePhase: 'RECOVERY' });

  // Then — 뉴스가 +10%라도 실제는 +2.5%였음이 한 줄로 보인다
  assert.equal(text, '▲ +2.50% (뉴스 +10 · 회복 +1.5 · 운 -9)');
});

test('시세 분해 문구: 보드 압력이 있으면 항목이 하나 더 붙고, 분해가 없으면 등락만 적는다', () => {
  // Given
  const withNudge = { instrumentId: 'CON', changeBp: 420, breakdown: { newsBp: 0, driftBp: 200, nudgeBp: 300, shockBp: -80 } };
  const legacy = { instrumentId: 'AIR', changeBp: -300 };

  // Then
  assert.equal(priceBreakdownText(withNudge, { cyclePhase: 'EXPANSION' }), '▲ +4.20% (호황 +2 · 보드 +3 · 운 -0.8)');
  assert.equal(priceBreakdownText(legacy, { cyclePhase: 'EXPANSION' }), '▼ -3.00%');
});

test('뉴스 칩: 효과는 확정 수익이 아니라 "압력"으로 표기한다', () => {
  // Given
  const chips = newsChips({ effects: [{ target: 'SECTOR', sector: 'ENTERTAINMENT', bp: 1_000 }] });

  // Then
  assert.equal(chips[0].text, '+10.00% 압력');
});

test('한도 해제: rules에 상한이 없으면 살 수 있는 최대 수량은 현금과 종목 보유 상한만으로 정해진다', () => {
  // Given — 서버가 한도 없음을 알림(max null), 현금 10,000,000원, 12,000원짜리 종목
  // 금액·건수 한도만 풀렸다(D46). 1회 수량 1~200주와 종목당 500주 보유 상한은 그대로다.
  const rules = { feeBp: 100, feeMin: 1_000, maxNotionalPerOrder: null, maxNotionalPerWindow: null, maxOrdersPerWindow: null, maxPositionPerInstrument: 500, maxQuantity: 200 };
  const budget = { open: true, ordersLeft: null, notionalLeft: null, unlimited: true };

  // When — 예전 1건 명목 한도(1,000,000)로는 83주가 최대였다
  const qty = maxBuyQuantity({ price: 12_000, cash: 10_000_000, rules, budget, held: 0 });

  // Then — 이제 1회 수량 상한(200주)이 벽이다(200 × 12,000 = 2,400,000 + 수수료 < 현금)
  assert.equal(qty, 200);
});

test('한도 해제: 주문 검증은 건수·명목 한도를 사유로 거절하지 않는다', () => {
  // Given
  const rules = { ...RULES, maxNotionalPerOrder: null, maxNotionalPerWindow: null, maxOrdersPerWindow: null };
  const budget = { ...OPEN_BUDGET, ordersLeft: null, notionalLeft: null, ordersMax: null, notionalMax: null, unlimited: true };

  // When — AIR 12,800원 × 200주 = 2,560,000원 매수(예전 1건 한도 1,000,000의 2.5배, 수량은 상한 200주 안)
  const preview = previewOrder({ ...base, rules, budget, cash: 10_000_000, held: 0, kind: 'BUY_STOCK', instrument: AIR, quantity: 200 });

  // Then
  assert.equal(preview.ok, true, preview.reasonText ?? '');
  assert.equal(preview.reason, 'NONE');
  assert.equal(preview.notional, 2_560_000);
  assert.equal(preview.ordersLeftAfter, null, '한도가 없으면 남은 건수도 없다');
});

test('종목 카드: 출발 칸을 지날 때 받을 배당을 1주 금액과 합계로 알려 준다(D48)', () => {
  // Given 한빛항공 12,800원 · 배당률 1.50% · 40주 보유
  // When 카드 모델을 만들면
  const card = instrumentCards(MARKET, 'seat-1')[0];

  // Then 서버와 같은 규칙(1주 배당 = 내림(시세 × 배당률))으로 1주·합계를 계산한다
  assert.equal(card.dividendPerShare, 192);
  assert.equal(card.nextDividend, 7_680);
  assert.ok(card.nextDividendText.includes('7,680'), card.nextDividendText);
  assert.ok(card.nextDividendText.includes('192'), card.nextDividendText);
  assert.ok(card.dividendDetailText.includes('1주 192원'), card.dividendDetailText);

  // Then 보유가 없으면 합계는 0이고 문구는 1주 금액만 말한다
  const notHeld = instrumentCards(MARKET, 'seat-9')[0];
  assert.equal(notHeld.nextDividend, 0);
  assert.equal(notHeld.nextDividendText, '');

  // Then 무배당·상장폐지 종목은 "없음"이다
  const delisted = instrumentCards({ ...MARKET, instruments: [ENT], rules: RULES }, 'seat-1')[0];
  assert.equal(delisted.dividendPerShare, 0);
  assert.equal(delisted.dividendDetailText, '없음');
});

test('배당 안내 묶음: 한 바퀴의 배당 여러 건을 카드 하나로 합친다(D48 리뷰 반영)', () => {
  // Given 같은 좌석의 배당 2건
  const events = [
    { type: 'DIVIDEND_PAID', playerId: 'seat-1', instrumentId: 'AIR', name: '한빛항공', quantity: 40, perShare: 192, amount: 7_680 },
    { type: 'DIVIDEND_PAID', playerId: 'seat-1', instrumentId: 'NRG', name: '청해에너지', quantity: 100, perShare: 700, amount: 70_000 },
  ];

  // When 안내 모델을 만들면
  const notice = dividendNoticeModel(events, { nameOf: () => '하나' });

  // Then 합계와 종목 수가 제목에, 종목별 내역이 설명에 담긴다
  assert.equal(notice.total, 77_680);
  assert.equal(notice.amount, '+77,680원');
  assert.ok(notice.headline.includes('하나'), notice.headline);
  assert.ok(notice.headline.includes('2종목'), notice.headline);
  assert.ok(notice.note.includes('한빛항공 40주 +7,680원'), notice.note);
  assert.ok(notice.note.includes('청해에너지 100주 +70,000원'), notice.note);

  // Then 한 건이면 종목 이름과 주수가 제목에 바로 온다
  const single = dividendNoticeModel([events[0]], { nameOf: () => '하나' });
  assert.ok(single.headline.includes('한빛항공 40주'), single.headline);
  assert.ok(single.note.includes('1주 192원'), single.note);
  assert.equal(dividendNoticeModel([], { nameOf: () => '' }).total, 0);
});
