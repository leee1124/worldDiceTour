/**
 * 상대(다른 좌석)가 한 일을 짧은 알림 한 줄로 바꾸는 순수 로직. DOM을 모른다.
 *
 * 오너 피드백: "상대방이 뭘 하는지 로그 말고 토스트 메시지로 떴으면 좋겠음."
 * 로그는 흘러가 버리고 폰에서는 접혀 있기까지 하다 — 그래서 **눈에 띄는 한 줄**로 따로 알린다.
 *
 * 규칙
 * - 내 좌석이 한 일은 알리지 않는다(내 화면에는 이미 결정 모달과 안내 카드가 있다).
 * - 통행료는 전용 카드(tollOverlay)가 이미 있으므로 중복해서 띄우지 않는다.
 * - 내 도시를 인수당한 것처럼 **나에게 불리한 사건**은 우선순위를 올리고 더 오래 띄운다.
 * - 이모지는 쓰지 않는다(오너 요청). 아이콘이 필요하면 화면 쪽에서 SVG로 그린다.
 */

import { formatWon } from '../format.js';
import { buildingLabel, casinoGameLabel, BUILDING_ORDER } from './labels.js';

/** 보통 알림이 머무는 시간. */
export const DEFAULT_TTL_MS = 2500;
/** 내 도시를 인수당한 것처럼 놓치면 안 되는 알림. */
export const ACQUIRED_MY_CITY_TTL_MS = 4000;

/** 우선순위: 큰 값이 이긴다. */
export const PRIORITY = Object.freeze({ NORMAL: 1, HIGH: 3 });

/** 알림 하나를 만든다(기본값을 한곳에서 채운다). */
function notice(kind, text, { priority = PRIORITY.NORMAL, ttl = DEFAULT_TTL_MS, tone = 'info' } = {}) {
  return { kind, text, priority, ttl, tone };
}

/** 지은 건물 이름(별장 · 빌딩 · 호텔 순서로 정리). 로그와 같은 순서를 쓴다. */
function builtLabel(buildings) {
  const order = [...BUILDING_ORDER, 'LANDMARK'];
  if (!Array.isArray(buildings) || buildings.length === 0) {
    return '건물';
  }
  return [...buildings]
    .sort((left, right) => order.indexOf(left) - order.indexOf(right))
    .map(buildingLabel)
    .join(' · ');
}

/**
 * 이벤트 하나를 상대 행동 알림으로 바꾼다. 알릴 것이 없으면 null.
 *
 * @param {object} event 서버 이벤트
 * @param {{
 *   isLocalSeat: (seatId: string) => boolean,
 *   nameOf: (seatId: string) => string,
 *   spaceNameOf: (index: number) => string,
 *   lastDiceOf?: (seatId: string) => {die1: number, die2: number}|null,
 * }} ctx
 * @returns {{kind: string, text: string, priority: number, ttl: number, tone: string}|null}
 */
export function opponentNoticeOf(event, ctx) {
  if (!event || typeof event !== 'object' || !ctx) {
    return null;
  }
  const actor = event.playerId ?? null;
  if (!actor || ctx.isLocalSeat(actor)) {
    // 내 좌석의 일은 모달·카드가 이미 보여 준다.
    return null;
  }
  const who = ctx.nameOf(actor);
  const place = (index) => (Number.isInteger(index) ? ctx.spaceNameOf(index) : '');

  switch (event.type) {
    case 'LANDED': {
      const where = place(event.index);
      if (!where) {
        return null;
      }
      const dice = ctx.lastDiceOf?.(actor) ?? null;
      const roll = dice && Number.isFinite(dice.die1) && Number.isFinite(dice.die2)
        ? `: 주사위 ${dice.die1}+${dice.die2} `
        : ' ';
      return notice('move', `${who}${roll}→ ${where}`);
    }

    case 'CITY_PURCHASED':
      return notice('buy', `${who}이(가) ${place(event.index)}을(를) ${formatWon(event.price)}에 샀습니다`);

    case 'BUILT':
      return notice('build', `${who}: ${place(event.index)}에 ${builtLabel(event.buildings)} 건설`);

    case 'LANDMARK_BUILT':
      return notice('landmark', `${who}: ${place(event.index)}에 랜드마크 완성`, { priority: PRIORITY.HIGH });

    case 'ACQUIRED': {
      const mine = Boolean(event.fromId) && ctx.isLocalSeat(event.fromId);
      if (mine) {
        return notice('acquire', `${who}이(가) 내 도시 ${place(event.index)}을(를) 인수했습니다`, {
          priority: PRIORITY.HIGH,
          ttl: ACQUIRED_MY_CITY_TTL_MS,
          tone: 'warn',
        });
      }
      return notice('acquire', `${who}이(가) ${ctx.nameOf(event.fromId)}의 ${place(event.index)}을(를) 인수했습니다`);
    }

    case 'CASINO_RESULT': {
      const game = casinoGameLabel(event.game);
      if (event.jackpotWon > 0) {
        return notice('jackpot', `${who} 카지노 잭팟 당첨 ${formatWon(event.jackpotWon)}`, {
          priority: PRIORITY.HIGH,
          tone: 'good',
        });
      }
      const amount = event.win ? `+${formatWon(event.payout)}` : `−${formatWon(event.bet)}`;
      return notice('casino', `${who} 카지노 ${game} ${amount}`, { tone: event.win ? 'good' : 'info' });
    }

    case 'STRANDED':
      return notice('island', `${who}이(가) 조난 섬에 갇혔습니다 (최대 ${event.remainingTurns ?? 3}턴)`);

    case 'ISLAND_ESCAPED':
      return notice('island', `${who}이(가) 조난 섬을 벗어났습니다`);

    case 'AIRPORT_TICKET_GRANTED':
      return notice('airport', `${who}이(가) 세계일주 이동권을 받았습니다`);

    case 'TRAVELED':
      return notice('airport', `${who}이(가) ${place(event.to ?? event.index)}으로 이동했습니다`);

    case 'LOAN_TAKEN':
      return notice('loan', `${who}이(가) ${formatWon(event.principal)}을 대출했습니다`);

    case 'BANKRUPT':
      return notice('bankrupt', `${who}이(가) 파산했습니다`, { priority: PRIORITY.HIGH, tone: 'warn' });

    default:
      // 통행료(TOLL_PAID)는 전용 카드가 있고, 주사위·턴 시작은 도착 줄에 합쳐 보여 준다.
      return null;
  }
}

/**
 * 대기열에 알림 하나를 넣는다. **최대 한 개만** 기다린다.
 * - 같은 종류가 기다리고 있으면 최신 내용으로 바꾼다(버스트가 쌓이지 않는다).
 * - 자리가 겹치면 우선순위가 높은 쪽이 남는다.
 *
 * @param {Array<object>} pending
 * @param {object|null} next
 * @returns {Array<object>}
 */
export function coalesceNotices(pending, next) {
  const queue = Array.isArray(pending) ? [...pending] : [];
  if (!next || typeof next !== 'object') {
    return queue;
  }
  const sameKindAt = queue.findIndex((item) => item.kind === next.kind);
  if (sameKindAt >= 0) {
    queue[sameKindAt] = next;
    return queue;
  }
  if (queue.length === 0) {
    return [next];
  }
  // 한 개만 예약한다 — 낮은 우선순위는 기다리는 높은 알림을 밀어내지 못한다.
  const waiting = queue[queue.length - 1];
  return [(next.priority ?? PRIORITY.NORMAL) > (waiting.priority ?? PRIORITY.NORMAL) ? next : waiting];
}
