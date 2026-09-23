/**
 * 배당 안내 카드 모델. 한 바퀴에 종목마다 `DIVIDEND_PAID`가 따로 오는데, 카드를 종목 수만큼
 * 띄우면 내 차례가 종목 × 2.5초 동안 멈춘다(리뷰 지적). 그래서 같은 좌석의 연속 배당을
 * **카드 하나**로 합친다. DOM을 모른다(Node에서 그대로 테스트된다).
 */

import { formatSignedWon, formatWon } from '../format.js';

const toInt = (value) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);

/**
 * @param {Array<{playerId:string, name?:string, instrumentId?:string, quantity:number, perShare:number, amount:number}>} events
 * @param {{nameOf: (seatId: string) => string}} ctx
 * @returns {{playerId: string|null, total: number, amount: string, headline: string, note: string, count: number}}
 */
export function dividendNoticeModel(events, { nameOf }) {
  const items = (Array.isArray(events) ? events : []).filter((event) => event && typeof event === 'object');
  const playerId = items[0]?.playerId ?? null;
  const total = items.reduce((sum, event) => sum + toInt(event.amount), 0);
  const who = playerId ? nameOf(playerId) : '';
  const label = (event) => `${event.name ?? event.instrumentId ?? ''} ${toInt(event.quantity)}주`;
  if (items.length === 1) {
    const [only] = items;
    return {
      playerId,
      count: 1,
      total,
      amount: formatSignedWon(total),
      headline: `${who} · ${label(only)}`,
      note: `1주 ${formatWon(toInt(only.perShare))} × ${toInt(only.quantity)}주 · 출발 칸을 지날 때마다 받습니다`,
    };
  }
  return {
    playerId,
    count: items.length,
    total,
    amount: formatSignedWon(total),
    headline: items.length === 0 ? who : `${who} · ${items.length}종목 배당`,
    note: items.map((event) => `${label(event)} ${formatSignedWon(toInt(event.amount))}`).join(' · '),
  };
}
