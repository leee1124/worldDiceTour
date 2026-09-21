/**
 * 이벤트 재생기. `game` 메시지의 `events`를 순서대로 연출하고, 큐가 비면 최신 뷰를 그린다.
 *
 * 규칙
 * - 로그는 **받는 즉시** 쌓는다(빨리 감기·상한 초과로 연출을 건너뛰어도 기록은 남는다).
 * - 연출은 어디까지나 장식이고, 화면의 진실은 마지막에 적용하는 `view`다.
 * - 밀리면(컴퓨터 좌석이 0.8초마다 커맨드를 보낸다) 큐가 빨리 감기로 바뀌어 연출을 생략한다.
 */

import { hopPath } from '../domain/boardLayout.js';
import { formatSignedWon, formatWon } from '../format.js';
import { formatEventLine } from '../domain/eventLog.js';
import { playTicketCard } from '../views/modals/ticketOverlay.js';
import { playTollNotice } from '../views/modals/tollOverlay.js';
import { flashScreen, floatAmount, flyCoin } from './effects.js';
import { DURATIONS, scaled, wait } from './timing.js';

/** 이 길이를 넘는 이동은 한 칸씩 밟지 않고 순간이동으로 보여 준다(공항 이동 등). */
const MAX_HOPS = 12;

export function createPlaybackEngine({
  queue,
  board,
  center,
  players,
  log,
  casino,
  isCasinoOpen,
  announce,
  applyView,
  nameOf,
  spaceNameOf,
}) {
  let running = false;

  const logContext = { nameOf, spaceNameOf };

  /** 말/카드 좌표(없으면 null) — 연출 시작·도착점. */
  const tokenPoint = (seatId) => board.tokenCenter(seatId) ?? players.cardCenter(seatId);
  const cardPoint = (seatId) => players.cardCenter(seatId) ?? board.tokenCenter(seatId);

  async function playMove(event) {
    const path = hopPath(event);
    if (path.length === 0) {
      return;
    }
    if (!Number.isInteger(event.steps) || path.length > MAX_HOPS) {
      await board.teleportToken(event.playerId, event.to);
      return;
    }
    for (const index of path) {
      await board.moveToken(event.playerId, index);
    }
  }

  async function playMoneyIn(seatId, amount, { tone = 'plus' } = {}) {
    players.pulse(seatId);
    await floatAmount(cardPoint(seatId), formatSignedWon(amount), { tone });
  }

  async function playMoneyOut(seatId, amount) {
    players.pulse(seatId);
    await floatAmount(cardPoint(seatId), formatSignedWon(-Math.abs(amount)), { tone: 'minus' });
  }

  async function playEvent(event) {
    switch (event.type) {
      case 'TURN_STARTED':
        announce(`${nameOf(event.playerId)}의 차례입니다.`);
        break;

      case 'DICE_ROLLED':
        await center.rollDice(event.die1, event.die2);
        break;

      case 'MOVED':
        await playMove(event);
        break;

      case 'LANDED':
        await board.flashCell(event.index);
        break;

      case 'SALARY_PAID':
        await playMoneyIn(event.playerId, event.amount);
        break;

      case 'SALARY_SEIZED':
        await playMoneyOut(event.playerId, event.amount);
        break;

      case 'TOLL_PAID':
        await Promise.all([
          flyCoin(tokenPoint(event.payerId), cardPoint(event.ownerId), { label: formatWon(event.amount) }),
          playTollNotice({
            payerName: nameOf(event.payerId),
            ownerName: nameOf(event.ownerId),
            spaceName: spaceNameOf(event.index),
            amount: event.amount,
          }),
        ]);
        break;

      case 'TAX_PAID':
        await Promise.all([
          flyCoin(tokenPoint(event.playerId), center.jackpotCenter(), { label: formatWon(event.amount) }),
          playMoneyOut(event.playerId, event.amount),
        ]);
        break;

      case 'MONEY_GAINED':
        await playMoneyIn(event.playerId, event.amount);
        break;

      case 'MONEY_LOST':
        await playMoneyOut(event.playerId, event.amount);
        break;

      case 'MONEY_TRANSFERRED':
        await flyCoin(cardPoint(event.fromId), cardPoint(event.toId), { label: formatWon(event.amount) });
        break;

      case 'JACKPOT_CHANGED':
        center.animateJackpot(event.jackpot);
        break;

      case 'CITY_PURCHASED':
        await Promise.all([board.flashCell(event.index), playMoneyOut(event.playerId, event.price)]);
        break;

      case 'BUILT':
        await Promise.all([board.flashCell(event.index), playMoneyOut(event.playerId, event.cost)]);
        break;

      case 'LANDMARK_BUILT':
        await Promise.all([flashScreen('gold'), board.flashCell(event.index)]);
        break;

      case 'ACQUIRED':
        await Promise.all([
          board.flashCell(event.index),
          flyCoin(cardPoint(event.playerId), cardPoint(event.fromId), { label: formatWon(event.price) }),
        ]);
        break;

      case 'TICKET_DRAWN':
        await playTicketCard({ playerName: nameOf(event.playerId), text: event.text, effect: event.effect });
        break;

      case 'STRANDED':
        await board.flashCell(10);
        players.pulse(event.playerId);
        break;

      case 'ISLAND_RESCUE_PAID':
        await playMoneyOut(event.playerId, event.amount);
        break;

      case 'ISLAND_ESCAPED':
        players.pulse(event.playerId);
        await wait(scaled(180));
        break;

      case 'CASINO_RESULT':
        if (isCasinoOpen()) {
          await casino.playResult(event);
        } else if (event.jackpotWon > 0) {
          await flashScreen('neon');
        }
        break;

      case 'PROPERTY_SOLD':
        await Promise.all([board.flashCell(event.index), playMoneyIn(event.playerId, event.refund)]);
        break;

      case 'LOAN_TAKEN':
        await playMoneyIn(event.playerId, event.principal);
        break;

      case 'BANKRUPT':
        await flashScreen('crimson');
        players.pulse(event.playerId);
        await wait(scaled(DURATIONS.bankrupt));
        break;

      case 'GAME_OVER':
        await flashScreen('gold');
        break;

      default:
        // 나머지 이벤트는 로그로만 남긴다(연출 없음).
        break;
    }
  }

  async function pump() {
    if (running) {
      return;
    }
    running = true;
    try {
      do {
        while (queue.size > 0) {
          const event = queue.shift();
          if (!event) {
            break;
          }
          if (queue.fastForward) {
            continue; // 밀렸으면 연출을 버리고 최신 상태로 달려간다.
          }
          try {
            await playEvent(event);
          } catch (error) {
            console.error('[playback] 연출 중 오류', event.type, error);
          }
        }
        if (queue.targetView) {
          applyView(queue.targetView);
        }
      } while (queue.size > 0);
    } finally {
      running = false;
    }
  }

  return {
    /** `game` 메시지(SSE 또는 커맨드 응답)를 받아 로그를 쌓고 재생을 시작한다. */
    accept(message) {
      if (!queue.accept(message)) {
        return false;
      }
      const events = Array.isArray(message.events) ? message.events : [];
      if (events.length > 0) {
        log.append(events.map((event) => formatEventLine(event, logContext)));
      }
      void pump();
      return true;
    },

    /** 재접속 스냅샷: 연출을 버리고 바로 현재 상태를 그린다. */
    resetTo(view) {
      queue.reset(view);
      if (queue.targetView) {
        applyView(queue.targetView);
      }
    },

    get busy() {
      return running;
    },
  };
}
