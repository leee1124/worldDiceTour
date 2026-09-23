/**
 * `view.market` · `view.players[]`를 화면이 그대로 그릴 수 있는 모델로 바꾼다.
 * DOM에 의존하지 않으므로 Node에서 그대로 테스트된다.
 *
 * 증권거래소에는 **비밀 정보가 없다**(API.md 9장) — 전원의 보유·예금·예약·다음 틱 압력이 모두
 * 공개 DTO다. 그래서 이 모듈은 무엇도 숨기지 않고, 내 것만 "조작 가능"으로 표시한다.
 */

import { formatChangeBp, formatRateBp, formatSignedBpPercent } from './marketFormat.js';
import { orderKindLabel, sectorLabel } from './marketLabels.js';
import { sparklineLabel, sparklinePath } from './marketSparkline.js';

function toInt(value) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function won(value) {
  return `${toInt(value).toLocaleString('ko-KR')}원`;
}

/** 한 좌석의 한 종목 보유. 없으면 null. */
export function holdingOf(market, seatId, instrumentId) {
  const list = market?.holdings?.[seatId];
  if (!Array.isArray(list)) {
    return null;
  }
  return list.find((item) => item?.instrumentId === instrumentId) ?? null;
}

/** 한 좌석의 예금 잔액. */
export function depositOf(market, seatId) {
  return toInt(market?.deposits?.[seatId]);
}

/**
 * 평가손익. `profitBp`는 원가 대비 수익률(bp, 절댓값 내림).
 * @param {{qty?: number, avgCost?: number}|null} holding
 * @param {number} price 현재가
 */
export function holdingPnl(holding, price) {
  const qty = toInt(holding?.qty);
  const avgCost = toInt(holding?.avgCost);
  const value = qty * toInt(price);
  const cost = qty * avgCost;
  const profit = value - cost;
  const profitBp = cost > 0 ? Math.trunc((profit / cost) * 10_000) : 0;
  const tone = profit > 0 ? 'up' : profit < 0 ? 'down' : 'flat';
  // 사람이 읽는 문구 — 평단가는 "내가 얼마에 샀나"의 유일한 단서라 반드시 같이 보여 준다.
  const holdingText = qty > 0 ? `보유 ${qty}주 · 평단 ${won(avgCost)}` : '';
  const pnlText = qty > 0 ? `${profit < 0 ? '-' : '+'}${won(Math.abs(profit))} (${formatSignedBpPercent(profitBp)})` : '';
  return { qty, avgCost, value, cost, profit, profitBp, tone, holdingText, pnlText };
}

/**
 * 총자산 내역 행. 서버의 `players[].netWorth`(단일 출처 `NetWorth`)를 그대로 분해한다.
 * 예전 서버(필드 없음)에서는 현금 한 줄로 떨어진다.
 */
export function netWorthRows(player) {
  if (!player || typeof player !== 'object') {
    return [];
  }
  const breakdown = player.netWorth;
  if (!breakdown || typeof breakdown !== 'object') {
    return [{ key: 'cash', label: '현금', amount: toInt(player.cash), tone: 'in' }];
  }
  const rows = [
    { key: 'cash', label: '현금', amount: toInt(breakdown.cash), tone: 'in' },
    { key: 'property', label: '부동산', amount: toInt(breakdown.property), tone: 'in' },
    { key: 'stock', label: '주식', amount: toInt(breakdown.stock), tone: 'in' },
    { key: 'deposit', label: '예금', amount: toInt(breakdown.deposit), tone: 'in' },
  ];
  const debt = toInt(breakdown.loanDebt);
  if (debt > 0) {
    rows.push({ key: 'loanDebt', label: '대출 채무', amount: -debt, tone: 'out' });
  }
  return rows;
}

/** 뉴스 효과 칩(섹터 / 전 종목 / 기준금리). */
export function newsChips(news) {
  const effects = news?.effects;
  if (!Array.isArray(effects)) {
    return [];
  }
  return effects
    .filter((effect) => effect && typeof effect === 'object')
    .map((effect) => {
      const bp = toInt(effect.bp);
      const change = formatChangeBp(bp);
      let label;
      if (effect.target === 'ALL') {
        label = '전 종목';
      } else if (effect.target === 'RATE') {
        label = '기준금리';
      } else {
        label = sectorLabel(effect.sector);
      }
      return {
        target: effect.target ?? 'SECTOR',
        sector: effect.sector ?? null,
        label,
        bp,
        tone: change.tone,
        arrow: change.arrow,
        text: formatSignedBpPercent(bp),
        ariaLabel: `${label} ${change.label}`,
      };
    });
}

/** 다음 라운드 틱에 반영될 보드 압력(전원 공개 — 내부정보를 만들지 않는다). */
export function nudgeRows(market) {
  const nudges = market?.pendingNudges;
  if (!Array.isArray(nudges)) {
    return [];
  }
  return nudges
    .filter((nudge) => nudge && typeof nudge === 'object')
    .map((nudge) => {
      const bp = toInt(nudge.bp);
      const change = formatChangeBp(bp);
      const label = typeof nudge.label === 'string' && nudge.label.length > 0 ? nudge.label : sectorLabel(nudge.sector);
      return {
        sector: nudge.sector ?? null,
        label,
        bp,
        tone: change.tone,
        arrow: change.arrow,
        text: formatSignedBpPercent(bp),
        ariaLabel: `다음 라운드 ${label} ${change.label} 예정`,
      };
    });
}

/** 예약 주문 한 건을 사람이 읽는 한 줄로. */
function queueDetail(order, instrumentName) {
  if (order.kind === 'DEPOSIT' || order.kind === 'WITHDRAW') {
    return won(order.amount);
  }
  const name = instrumentName ?? order.instrumentId ?? '종목';
  return `${name} ${toInt(order.quantity)}주`;
}

/**
 * 전원의 예약 주문 목록(등록 순서 그대로). 내 좌석 것만 `cancellable`이다.
 * @param {object|null} market
 * @param {{mySeatIds: string[], seatNameOf: (seatId: string) => string}} context
 */
export function queueRows(market, { mySeatIds = [], seatNameOf = () => '' } = {}) {
  const queue = market?.orderQueue;
  if (!Array.isArray(queue)) {
    return [];
  }
  const nameById = new Map(
    (Array.isArray(market?.instruments) ? market.instruments : []).map((item) => [item?.id, item?.name]),
  );
  const mine = new Set(mySeatIds);
  return queue
    .filter((order) => order && typeof order === 'object')
    .map((order) => {
      const isMine = mine.has(order.seatId);
      return {
        orderId: order.id,
        seatId: order.seatId,
        seatName: seatNameOf(order.seatId),
        kind: order.kind,
        kindLabel: orderKindLabel(order.kind),
        instrumentId: order.instrumentId ?? null,
        quantity: order.quantity ?? null,
        amount: order.amount ?? null,
        detail: queueDetail(order, nameById.get(order.instrumentId)),
        mine: isMine,
        cancellable: isMine,
      };
    });
}

/** 내 좌석이 예약한 건수(한도 검사용). */
export function queuedCountOf(market, seatId) {
  const queue = market?.orderQueue;
  if (!Array.isArray(queue)) {
    return 0;
  }
  return queue.filter((order) => order?.seatId === seatId).length;
}

/**
 * 종목 카드 모델. 이름·업종·시세·등락·보유·평가손익·배당·스파크라인·상장폐지를 한 번에 담는다.
 * @param {object|null} market
 * @param {string|null} seatId 보유·손익을 볼 좌석(없으면 보유 0)
 */
export function instrumentCards(market, seatId) {
  const instruments = market?.instruments;
  if (!Array.isArray(instruments)) {
    return [];
  }
  return instruments
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const delisted = item.state === 'DELISTED';
      const holding = seatId ? holdingOf(market, seatId, item.id) : null;
      const pnl = holdingPnl(holding, item.price);
      const change = formatChangeBp(item.changeBp);
      const spark = sparklinePath(item.series, { width: 108, height: 34 });
      const dividendBp = toInt(item.dividendBp);
      const sectorText =
        typeof item.sectorLabel === 'string' && item.sectorLabel.length > 0
          ? item.sectorLabel
          : sectorLabel(item.sector);
      return {
        id: item.id,
        name: typeof item.name === 'string' ? item.name : String(item.id ?? ''),
        sector: item.sector ?? null,
        sectorLabel: sectorText,
        price: toInt(item.price),
        prevPrice: toInt(item.prevPrice),
        basePrice: toInt(item.basePrice),
        tickUnit: Math.max(1, toInt(item.tickUnit)),
        change,
        qty: pnl.qty,
        pnl,
        delisted,
        tradable: !delisted,
        dividendBp,
        dividendText: dividendBp > 0 ? formatRateBp(dividendBp) : '없음',
        spark,
        sparkLabel: sparklineLabel({ name: item.name, series: item.series }),
        ariaLabel: `${item.name} ${sectorText} ${won(item.price)} ${change.label}${
          pnl.qty > 0 ? ` ${pnl.holdingText} 손익 ${pnl.pnlText}` : ''
        }${delisted ? ' 상장폐지' : ''}`,
      };
    });
}

/** 시장 한 줄 요약(상황판·스크린리더용). */
export function marketSummaryLine(market) {
  if (!market) {
    return '';
  }
  const rate = formatRateBp(market.baseRateBp);
  const headline = market.news?.headline;
  return headline ? `기준금리 ${rate} · ${headline}` : `기준금리 ${rate}`;
}
