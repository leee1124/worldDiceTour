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
import { playInfoNotice } from '../views/modals/noticeCard.js';
import { NOTICE_KINDS } from '../domain/noticeTiming.js';
import { dividendNoticeModel } from '../domain/dividendNotice.js';
import { opponentNoticeOf } from '../domain/opponentNotice.js';
import { LAP_RULE_TEXT, lapLabel } from '../domain/buildRules.js';
import { flashScreen, floatAmount, flyCoin } from './effects.js';
import { DURATIONS, prefersReducedMotion, scaled, wait } from './timing.js';

export function createPlaybackEngine({
  queue,
  board,
  center,
  players,
  log,
  casino,
  market = null,
  isCasinoOpen,
  announce,
  applyView,
  nameOf,
  spaceNameOf,
  isLocalSeat = () => false,
  /** 상대 행동 알림 줄(없으면 알리지 않는다). */
  opponentToasts = null,
  onGameOver = () => {},
  notify = () => {},
  /** 메시지가 도착한 즉시(연출 전에) 최신 뷰를 알린다 — 어긋난 결정 모달을 닫기 위한 안전망. */
  onViewArrived = () => {},
}) {
  let running = false;
  const turnAnnouncer = createTurnAnnouncer();
  /** 좌석별 마지막 주사위 눈. 도착 알림 한 줄에 "주사위 6+3 → 부에노스"로 합쳐 쓴다. */
  const lastDice = new Map();

  /**
   * 상대(다른 좌석)가 한 일을 짧은 알림 한 줄로 띄운다.
   * 문구·판단은 모두 `domain/opponentNotice.js`가 정한다(여기서는 전달만 한다).
   */
  function notifyOpponent(event) {
    if (!opponentToasts) {
      return;
    }
    if (event.type === 'DICE_ROLLED') {
      lastDice.set(event.playerId, { die1: event.die1, die2: event.die2 });
    }
    const item = opponentNoticeOf(event, {
      isLocalSeat,
      nameOf,
      spaceNameOf,
      lastDiceOf: (seatId) => lastDice.get(seatId) ?? null,
    });
    if (item) {
      opponentToasts.push(item);
    }
  }

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
    // 남의 좌석이 한 일은 연출과 별개로 한 줄 알림을 남긴다(로그만으로는 놓친다).
    notifyOpponent(event);

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

      case 'LAP_ADVANCED':
        // 바퀴가 오르면 지을 수 있는 건물이 늘어난다 — 놓치면 안 되는 정보라 안내를 남긴다.
        await playInfoNotice({
          kind: NOTICE_KINDS.LAP,
          mine: isLocalSeat(event.playerId),
          tone: 'lap',
          eyebrow: '새 바퀴',
          headline: `${nameOf(event.playerId)} · ${lapLabel(event.lap)}`,
          note: LAP_RULE_TEXT,
        });
        break;

      case 'SALARY_PAID':
        await Promise.all([
          playMoneyIn(event.playerId, event.amount),
          playInfoNotice({
            kind: NOTICE_KINDS.SALARY,
            mine: isLocalSeat(event.playerId),
            tone: 'plus',
            eyebrow: '월급',
            headline: `${nameOf(event.playerId)} 월급 수령`,
            amount: formatSignedWon(event.amount),
          }),
        ]);
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
            // 내가 내거나 내가 받는 통행료는 더 오래 보여 준다(내 돈이 오간 일).
            mine: isLocalSeat(event.payerId) || isLocalSeat(event.ownerId),
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
        await playTicketCard({
          playerName: nameOf(event.playerId),
          text: event.text,
          effect: event.effect,
          // 내 티켓은 3.5초 이상, 남의 티켓은 2.5초 이상 보여 준다(noticeTiming).
          mine: isLocalSeat(event.playerId),
        });
        break;

      case 'STRANDED':
        await board.flashCell(10);
        players.pulse(event.playerId);
        break;

      case 'ISLAND_RESCUE_PAID':
        await Promise.all([
          playMoneyOut(event.playerId, event.amount),
          playInfoNotice({
            kind: NOTICE_KINDS.ISLAND,
            mine: isLocalSeat(event.playerId),
            tone: 'minus',
            eyebrow: '조난 섬',
            headline: `${nameOf(event.playerId)} 구조비 지불`,
            amount: formatSignedWon(-Math.abs(event.amount)),
            note: '같은 턴에 바로 주사위를 굴립니다.',
          }),
        ]);
        break;

      case 'ISLAND_ESCAPED':
        players.pulse(event.playerId);
        await playInfoNotice({
          kind: NOTICE_KINDS.ISLAND,
          mine: isLocalSeat(event.playerId),
          tone: 'win',
          eyebrow: '조난 탈출',
          headline: `${nameOf(event.playerId)} 조난 섬을 벗어났습니다`,
          note: event.by === 'PAY' ? '구조비 지불' : '더블 성공',
        });
        break;

      case 'ISLAND_STAY':
        await playInfoNotice({
          kind: NOTICE_KINDS.ISLAND,
          mine: isLocalSeat(event.playerId),
          tone: 'lose',
          eyebrow: '탈출 실패',
          headline: `${nameOf(event.playerId)} 더블이 나오지 않았습니다`,
          note: `남은 조난 ${event.remainingTurns}턴`,
        });
        break;

      case 'CASINO_RESULT':
        if (isCasinoOpen()) {
          await casino.playResult(event);
        } else if (event.jackpotWon > 0) {
          // 카지노 화면을 보고 있지 않은 사람에게도 잭팟은 알려 준다(섬광만으로는 무슨 일인지 모른다).
          await Promise.all([
            flashScreen('neon'),
            playInfoNotice({
              kind: NOTICE_KINDS.JACKPOT,
              mine: isLocalSeat(event.playerId),
              tone: 'jackpot',
              eyebrow: '잭팟',
              headline: `${nameOf(event.playerId)} 잭팟 당첨!`,
              amount: formatSignedWon(event.jackpotWon),
            }),
          ]);
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
        // 여기서는 뉴스 카드와 시세 갱신이 "이어지는 두 장면"으로 읽히게 짧은 박자만 두고,
        // 종목마다 "뉴스 +10%인데 실제는 +2.5%(운 −9)" 내역을 몇 초 보여 준다.
        market?.showBreakdown?.(event.changes, { cyclePhase: event.cyclePhase });
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

      case 'DIVIDEND_PAID': {
        // 월급과 같은 급으로 알린다. 금액 플로트만으로는 "배당이 안 들어온다"고 느꼈다(오너 피드백).
        // 같은 좌석의 연속 배당(종목마다 한 건)은 **카드 하나**로 합친다 — 종목 수만큼 카드를 띄우면
        // 내 차례가 종목 × 2.5초 동안 멈춘다.
        const batch = [
          event,
          ...queue.shiftWhile((next) => next.type === 'DIVIDEND_PAID' && next.playerId === event.playerId),
        ];
        const notice = dividendNoticeModel(batch, { nameOf });
        await Promise.all([
          playMoneyIn(event.playerId, notice.total),
          playInfoNotice({
            kind: NOTICE_KINDS.DIVIDEND,
            mine: isLocalSeat(event.playerId),
            tone: 'plus',
            eyebrow: '배당',
            headline: notice.headline,
            amount: notice.amount,
            note: notice.note,
          }),
        ]);
        break;
      }

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

  /**
   * 빨리 감기 중에도 **정보는 버리지 않는다** — 전체 화면 카드 대신 한 줄 안내만 남긴다.
   * 기다리지 않는다(빨리 감기의 목적이 "최신 상태로 달려가기"이므로).
   */
  function noteWhileFastForward(event) {
    switch (event.type) {
      case 'TICKET_DRAWN':
        void playTicketCard({
          playerName: nameOf(event.playerId),
          text: event.text,
          effect: event.effect,
          mine: isLocalSeat(event.playerId),
          fastForward: true,
        });
        break;

      case 'TOLL_PAID':
        void playTollNotice({
          payerName: nameOf(event.payerId),
          ownerName: nameOf(event.ownerId),
          spaceName: spaceNameOf(event.index),
          amount: event.amount,
          mine: isLocalSeat(event.payerId) || isLocalSeat(event.ownerId),
          fastForward: true,
        });
        break;

      case 'ISLAND_ESCAPED':
        void playInfoNotice({
          kind: NOTICE_KINDS.ISLAND,
          mine: isLocalSeat(event.playerId),
          fastForward: true,
          eyebrow: '조난 탈출',
          headline: nameOf(event.playerId),
        });
        break;

      default:
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
              continue;
            }
            // 연출은 버리지만 큰 사건은 한 줄 안내로 남긴다(정보를 버리지 않는다).
            noteWhileFastForward(event);
            notifyOpponent(event);
            opponentToasts?.keepLatestOnly();
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
      // 연출보다 먼저 "서버는 이미 여기까지 왔다"를 알린다.
      // 연출이 멈춰도 어긋난 결정 모달이 화면에 남지 않게 하는 안전망이다.
      onViewArrived(queue.targetView);
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
        onViewArrived(queue.targetView);
        applyView(queue.targetView);
      }
    },

    get busy() {
      return running;
    },
  };
}
