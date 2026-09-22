/**
 * 이벤트 재생기. `game` 메시지의 `events`를 순서대로 연출하고, 큐가 비면 최신 뷰를 그린다.
 *
 * 규칙
 * - 로그는 **받는 즉시** 쌓는다(빨리 감기·상한 초과로 연출을 건너뛰어도 기록은 남는다).
 * - 연출은 어디까지나 장식이고, 화면의 진실은 마지막에 적용하는 `view`다.
 * - 밀리면(컴퓨터 좌석이 0.8초마다 커맨드를 보낸다) 큐가 빨리 감기로 바뀌어 연출을 생략한다.
 */

import { planMove } from '../domain/movePlan.js';
import { formatSignedWon, formatWon } from '../format.js';
import { formatEventLine } from '../domain/eventLog.js';
import { gameOverReasonLabel } from '../domain/labels.js';
import { createTurnAnnouncer } from '../domain/announceThrottle.js';
import { playTicketCard } from '../views/modals/ticketOverlay.js';
import { playTollNotice } from '../views/modals/tollOverlay.js';
import { playCycleBanner, playDelistingCard, playNewsCard } from '../views/modals/newsOverlay.js';
import { orderKindLabel, rejectReasonLabel, tradingCloseReasonLabel } from '../domain/marketLabels.js';
import { flashScreen, floatAmount, flyCoin } from './effects.js';
import { DURATIONS, prefersReducedMotion, scaled, wait } from './timing.js';

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
  isLocalSeat = () => false,
  onGameOver = () => {},
  notify = () => {},
}) {
  let running = false;
  const turnAnnouncer = createTurnAnnouncer();

  const logContext = { nameOf, spaceNameOf };

  /** 말/카드 좌표(없으면 null) — 연출 시작·도착점. */
  const tokenPoint = (seatId) => board.tokenCenter(seatId) ?? players.cardCenter(seatId);
  const cardPoint = (seatId) => players.cardCenter(seatId) ?? board.tokenCenter(seatId);

  /**
   * 이동 연출. 주사위 이동은 **반드시 한 칸씩 밟아서** 보여 주고(뒤로 가는 티켓도 마찬가지),
   * 칸 수를 모르는 이동(공항·조난 이송)만 순간이동으로 보여 준다.
   */
  async function playMove(event) {
    const plan = planMove({
      from: event.from,
      to: event.to,
      steps: event.steps,
      reducedMotion: prefersReducedMotion(),
      // 컴퓨터/자동 진행 좌석은 같은 경로를 더 빠르게 지나간다(기다림을 줄이되 걷는 모습은 남긴다).
      fast: !isLocalSeat(event.playerId),
    });
    if (plan.kind === 'none') {
      return;
    }
    if (plan.kind === 'teleport') {
      await board.teleportToken(event.playerId, plan.path[0]);
      return;
    }
    for (const index of plan.path) {
      await board.moveToken(event.playerId, index, { stepMs: plan.stepMs, style: plan.style });
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
      case 'TURN_STARTED': {
        // 컴퓨터/자동 진행끼리 주고받는 턴은 초당 한 번꼴로 온다 — 내 좌석 차례만 매번 알리고,
        // 나머지는 burst당 한 번으로 줄인다(aria-live 스팸 방지).
        const local = isLocalSeat(event.playerId);
        if (turnAnnouncer.shouldAnnounceTurn({ isLocalSeat: local })) {
          announce(local ? `${nameOf(event.playerId)}의 차례입니다.` : '컴퓨터 진행 중…');
        }
        break;
      }

      case 'DICE_ROLLED':
        await center.rollDice(event.die1, event.die2, { isDouble: event.isDouble });
        break;

      case 'MOVED':
        await playMove(event);
        break;

      case 'LANDED':
        // 도착 칸은 한 번 튕기고(flashCell) 잠깐 더 비춘다(spotlight) — 어디 내렸는지 놓치지 않게.
        board.spotlightCell(event.index);
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

      /* ── 증권거래소(투자 모드 STOCKS에서만 온다) ─────────── */

      case 'CYCLE_CHANGED':
        // 뉴스와 뜻이 다른 사건이므로 카드가 아니라 배너로 구분해 보여 준다.
        await playCycleBanner(event);
        break;

      case 'NEWS_PUBLISHED':
        await playNewsCard(event);
        break;

      case 'PRICES_UPDATED':
        // 시세 숫자는 큐가 비고 최신 뷰가 반영될 때 카운트업으로 움직인다(marketView).
        // 여기서는 뉴스 카드와 시세 갱신이 "이어지는 두 장면"으로 읽히게 짧은 박자만 둔다.
        await wait(scaled(220));
        break;

      case 'INSTRUMENT_DELISTED':
        await Promise.all([
          flashScreen('crimson'),
          playDelistingCard({ name: event.name, price: event.price }),
        ]);
        break;

      case 'HOLDINGS_WIPED':
        players.pulse(event.playerId);
        // 현금은 움직이지 않는다 — 주식 수량이 사라졌다는 사실만 말한다.
        await floatAmount(cardPoint(event.playerId), `−${event.quantity}주`, { tone: 'minus' });
        break;

      case 'DIVIDEND_PAID':
      case 'DEPOSIT_INTEREST_PAID':
        await playMoneyIn(event.playerId, event.amount);
        break;

      case 'ORDER_FILLED':
        // 금액 연출은 함께 오는 MONEY_LOST / MONEY_GAINED가 담당한다(두 번 띄우지 않는다).
        players.pulse(event.playerId);
        await wait(scaled(120));
        break;

      case 'TRADING_OPENED':
        if (isLocalSeat(event.playerId)) {
          announce(`${nameOf(event.playerId)}의 거래 창구가 열렸습니다.`);
        }
        break;

      case 'TRADING_CLOSED':
        if (isLocalSeat(event.playerId) && event.reason === 'BUDGET_EXHAUSTED') {
          notify({ tone: 'info', message: tradingCloseReasonLabel(event.reason) });
        }
        break;

      case 'QUEUED_ORDER_EXECUTED':
        if (isLocalSeat(event.playerId)) {
          notify({ tone: 'success', message: `예약한 ${orderKindLabel(event.kind)} 주문이 체결되었습니다.` });
        }
        break;

      case 'QUEUED_ORDER_REJECTED':
        if (isLocalSeat(event.playerId)) {
          notify({
            tone: 'info',
            message: `예약 주문이 실행되지 않았습니다 — ${rejectReasonLabel(event.reasonCode)}.`,
          });
        }
        break;

      case 'GAME_OVER':
        // 게임 종료는 burst 제한과 무관하게 항상 알리고, 다음 원격 차례 안내 제한도 새로 시작한다.
        turnAnnouncer.reset();
        onGameOver(event.reason);
        announce(`게임 종료 — ${gameOverReasonLabel(event.reason)}`);
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
            // 밀렸으면 연출은 버리지만, **주사위 눈은 상태**라서 버리면 안 된다.
            // (이 값이 화면에서 사라지면 보는 기기마다 다른 눈이 남는다.)
            if (event.type === 'DICE_ROLLED') {
              center.showDice(event.die1, event.die2, { isDouble: event.isDouble });
            }
            continue; // 그 밖의 연출은 버리고 최신 상태로 달려간다.
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
