/**
 * 주문 폼 검증과 미리보기.
 *
 * 원칙
 * - **서버가 유일한 권위다.** 여기서 통과한 주문도 서버가 거절할 수 있다(그때는 에러 토스트를 띄우고 뷰를 되돌린다).
 *   반대로 여기서 막는 이유는 모두 서버 계약(API.md 9.3 · 9.4)에 적힌 것과 짝이 맞는다.
 * - **"왜 못 누르는지"를 언제나 말한다.** 비활성 버튼 옆에 이유 문구를 함께 내보내기 위해
 *   거절 코드와 한국어 문구를 같은 곳에서 만든다.
 * - 예약 주문(`QUEUE_ORDER`)은 **지금 창구의 예산을 쓰지 않는다** — 내 차례에 전면 재검증된다.
 */

import {
  buyTotalOf,
  feeOf,
  normalizeRules,
  notionalOf,
  sellProceedsOf,
} from './marketRules.js';

/** 서버 커맨드 이름과 같은 주문 종류(API.md 9.4). */
export const ORDER_KINDS = Object.freeze(['BUY_STOCK', 'SELL_STOCK', 'DEPOSIT', 'WITHDRAW']);

const STOCK_KINDS = new Set(['BUY_STOCK', 'SELL_STOCK']);

function won(value) {
  return `${Number(value).toLocaleString('ko-KR')}원`;
}

function toInt(value) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/**
 * 거절 코드 → 사람이 읽는 이유. 한도 숫자는 **서버가 준 rules**에서 읽는다.
 * @param {string} code
 * @param {{rules?: object}} [context]
 */
export function orderReasonText(code, context = {}) {
  const rules = normalizeRules(context.rules);
  switch (code) {
    case 'NONE':
      return '';
    case 'NO_INSTRUMENT':
      return '먼저 종목을 고르세요.';
    case 'DELISTED':
      return '상장폐지된 종목은 사고팔 수 없습니다.';
    case 'QUANTITY_RANGE':
      return `수량은 ${rules.minQuantity}주부터 ${rules.maxQuantity}주까지입니다.`;
    case 'INSUFFICIENT_CASH':
      return '현금이 부족합니다(수수료까지 포함해 계산합니다).';
    case 'NOT_ENOUGH_SHARES':
      return '가진 수량보다 많이 팔 수 없습니다.';
    case 'POSITION_LIMIT':
      return `한 종목은 ${rules.maxPositionPerInstrument}주까지만 가질 수 있습니다.`;
    case 'ORDER_LIMIT':
      return `이번 창구의 주문 ${rules.maxOrdersPerWindow}건을 모두 썼습니다. 거래를 마치고 주사위를 굴리세요.`;
    case 'NOTIONAL_LIMIT':
      return '이번 창구에 남은 예산보다 큰 주문입니다.';
    case 'ORDER_NOTIONAL_LIMIT':
      return `주문 한 건은 ${won(rules.maxNotionalPerOrder)}까지입니다.`;
    case 'DEPOSIT_UNIT':
      return `예금은 ${won(rules.depositUnit)} 단위로만 넣고 뺄 수 있습니다.`;
    case 'DEPOSIT_CAP':
      return `예금 잔액은 ${won(rules.depositCap)}까지입니다.`;
    case 'INSUFFICIENT_DEPOSIT':
      return '예금 잔액보다 많이 뺄 수 없습니다.';
    case 'WINDOW_CLOSED':
      return '지금은 거래 창구가 열려 있지 않습니다. 예약 주문으로 담아 두세요.';
    case 'QUEUE_FULL':
      return `예약은 ${rules.maxQueuedOrders}건까지입니다. 하나를 취소한 뒤 다시 담아 주세요.`;
    default:
      return '지금은 이 주문을 보낼 수 없습니다.';
  }
}

function reject(code, context, extra = {}) {
  return {
    ok: false,
    reason: code,
    reasonText: orderReasonText(code, context),
    note: '',
    notional: 0,
    fee: 0,
    total: 0,
    cashAfter: toInt(context.cash),
    depositAfter: toInt(context.deposit),
    ordersLeftAfter: null,
    ...extra,
  };
}

/**
 * 주문 하나를 미리 계산한다.
 *
 * @param {object} input
 * @param {'BUY_STOCK'|'SELL_STOCK'|'DEPOSIT'|'WITHDRAW'} input.kind
 * @param {object|null} [input.instrument] `market.instruments`의 항목(주식 주문일 때)
 * @param {number} [input.quantity] 주식 수량
 * @param {number} [input.amount] 예금 금액
 * @param {number} input.cash 현금
 * @param {number} input.deposit 예금 잔액
 * @param {number} [input.held] 그 종목의 보유 수량
 * @param {object} input.rules `market.rules`
 * @param {object} input.budget `market.budget` 또는 `pending.budget`
 * @param {boolean} [input.queueMode] 예약 주문인지
 * @param {number} [input.queuedCount] 내 좌석이 이미 예약한 건수
 */
export function previewOrder(input) {
  const {
    kind,
    instrument = null,
    quantity = 0,
    amount = 0,
    cash = 0,
    deposit = 0,
    held = 0,
    rules,
    budget,
    queueMode = false,
    queuedCount = 0,
  } = input ?? {};

  const limits = normalizeRules(rules);
  const context = { rules: limits, cash: toInt(cash), deposit: toInt(deposit) };
  const note = queueMode
    ? '예약 주문은 내 차례가 시작될 때 자동으로 체결되며, 그때 현금·한도를 다시 검증합니다.'
    : '';

  if (!ORDER_KINDS.includes(kind)) {
    return reject('UNKNOWN_KIND', context);
  }

  const open = budget?.open === true;
  const ordersLeft = Number.isInteger(budget?.ordersLeft) ? budget.ordersLeft : limits.maxOrdersPerWindow;
  const notionalLeft = Number.isInteger(budget?.notionalLeft) ? budget.notionalLeft : limits.maxNotionalPerWindow;

  /* ── 주식 ─────────────────────────────────────────────── */
  if (STOCK_KINDS.has(kind)) {
    if (!instrument) {
      return reject('NO_INSTRUMENT', context);
    }
    if (instrument.state === 'DELISTED') {
      return reject('DELISTED', context);
    }
    // 수량과 무관한 이유(창구가 닫혔다·건수를 다 썼다)를 **먼저** 본다.
    // 예산이 0이면 고를 수 있는 수량도 0이 되는데, 그때 "수량 범위"라고 말하면 진짜 이유를 가린다.
    if (!queueMode && !open) {
      return reject('WINDOW_CLOSED', context);
    }
    if (queueMode && toInt(queuedCount) >= limits.maxQueuedOrders) {
      return reject('QUEUE_FULL', context);
    }
    if (!queueMode && ordersLeft <= 0) {
      return reject('ORDER_LIMIT', context);
    }
    const qty = toInt(quantity);
    if (qty < limits.minQuantity || qty > limits.maxQuantity) {
      return reject('QUANTITY_RANGE', context);
    }

    const notional = notionalOf(qty, instrument.price);
    const fee = feeOf(notional, limits);

    if (kind === 'BUY_STOCK') {
      if (toInt(held) + qty > limits.maxPositionPerInstrument) {
        return reject('POSITION_LIMIT', context);
      }
      if (notional > limits.maxNotionalPerOrder) {
        return reject('ORDER_NOTIONAL_LIMIT', context);
      }
      if (!queueMode && notional > notionalLeft) {
        return reject('NOTIONAL_LIMIT', context);
      }
      const total = buyTotalOf(notional, limits);
      if (total > context.cash) {
        return reject('INSUFFICIENT_CASH', context, { notional, fee, total });
      }
      return {
        ok: true,
        reason: 'NONE',
        reasonText: '',
        note,
        notional,
        fee,
        total,
        cashAfter: context.cash - total,
        depositAfter: context.deposit,
        ordersLeftAfter: queueMode ? null : Math.max(0, ordersLeft - 1),
      };
    }

    // 매도
    if (qty > toInt(held)) {
      return reject('NOT_ENOUGH_SHARES', context);
    }
    if (notional > limits.maxNotionalPerOrder) {
      return reject('ORDER_NOTIONAL_LIMIT', context);
    }
    if (!queueMode && notional > notionalLeft) {
      return reject('NOTIONAL_LIMIT', context);
    }
    const proceeds = sellProceedsOf(notional, limits);
    return {
      ok: true,
      reason: 'NONE',
      reasonText: '',
      // 최소 수수료(1,000원) 탓에 아주 작은 매도는 받는 돈이 더 적어질 수 있다 — 미리 알려 준다.
      note: proceeds <= 0 ? '수수료가 판매대금보다 많습니다. 수량을 늘리는 편이 낫습니다.' : note,
      notional,
      fee,
      total: proceeds,
      cashAfter: context.cash + proceeds,
      depositAfter: context.deposit,
      ordersLeftAfter: queueMode ? null : Math.max(0, ordersLeft - 1),
    };
  }

  /* ── 예금 ─────────────────────────────────────────────── */
  if (!queueMode && !open) {
    return reject('WINDOW_CLOSED', context);
  }
  if (queueMode && toInt(queuedCount) >= limits.maxQueuedOrders) {
    return reject('QUEUE_FULL', context);
  }
  if (!queueMode && ordersLeft <= 0) {
    return reject('ORDER_LIMIT', context);
  }
  const money = toInt(amount);
  if (money <= 0 || money % limits.depositUnit !== 0) {
    return reject('DEPOSIT_UNIT', context);
  }

  if (kind === 'DEPOSIT') {
    if (money > context.cash) {
      return reject('INSUFFICIENT_CASH', context, { notional: money, total: money });
    }
    if (context.deposit + money > limits.depositCap) {
      return reject('DEPOSIT_CAP', context, { notional: money, total: money });
    }
    return {
      ok: true,
      reason: 'NONE',
      reasonText: '',
      note,
      notional: money,
      fee: 0,
      total: money,
      cashAfter: context.cash - money,
      depositAfter: context.deposit + money,
      ordersLeftAfter: queueMode ? null : Math.max(0, ordersLeft - 1),
    };
  }

  // 인출
  if (money > context.deposit) {
    return reject('INSUFFICIENT_DEPOSIT', context, { notional: money, total: money });
  }
  return {
    ok: true,
    reason: 'NONE',
    reasonText: '',
    note,
    notional: money,
    fee: 0,
    total: money,
    cashAfter: context.cash + money,
    depositAfter: context.deposit - money,
    ordersLeftAfter: queueMode ? null : Math.max(0, ordersLeft - 1),
  };
}
