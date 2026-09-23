/**
 * 화면 · 서버 · 연출을 잇는 컨트롤러.
 *
 * 흐름: 사용자 입력 → 커맨드 POST → (응답 또는 SSE로 온) `{view, events}` → 재생 큐 → 최신 뷰 렌더.
 * 실패하면 서버가 준 `{code, message}`만 토스트로 보여 주고, 화면은 서버 뷰로 되돌린다.
 */

import * as api from './api.js';
import * as storage from './storage.js';
import {
  CONNECTION,
  SCREENS,
  actingSeatId,
  createStore,
  isHostSeatMine,
  isMyActingTurn,
  isMySeat,
  isMyTurn,
  isPlayingRoom,
  seatNameOf,
  slotOf,
  spaceNameOf,
} from './store.js';
import { setHidden } from './dom.js';
import { buildCostOf } from './domain/buildRules.js';
import { createCommandLock } from './domain/commandLock.js';
import { inferGameOverReason } from './domain/gameOverReason.js';
import { isRoomGoneError } from './domain/roomErrors.js';
import { tradeErrorHint } from './domain/marketLabels.js';
import { TUTORIAL_CARDS, firstUnseenCard } from './domain/tutorialCards.js';
import { STALE_MODAL_GRACE_MS, partitionStaleModals } from './domain/modalGuard.js';
import { ownedCitiesOf } from './domain/ownedCities.js';
import { LOCATION_PREFIX, playerCellLabel } from './domain/locationLabel.js';
import { EventPlaybackQueue } from './animation/EventQueue.js';
import { createPlaybackEngine } from './animation/playback.js';
import { createToastHost } from './views/toast.js';
import { createOpponentToastHost } from './views/opponentToastHost.js';
import { createHomeView } from './views/homeView.js';
import { createLobbyView } from './views/lobbyView.js';
import { createBoardView } from './views/boardView.js';
import { createCenterView } from './views/centerView.js';
import { createPlayersView } from './views/playersView.js';
import { createLogView } from './views/logView.js';
import { createGameView } from './views/gameView.js';
import { createStatusStrip } from './views/statusStrip.js';
import { createLegendView } from './views/legendView.js';
import { createMarketView } from './views/marketView.js';
import { createTradeView, TRADE_MODAL_ID, tradeModalSpec } from './views/tradeView.js';
import { createCasinoView, CASINO_MODAL_ID, casinoModalSpec } from './views/casinoView.js';
import { createModalHost } from './views/modals/modalHost.js';
import { BUY_MODAL_ID, buyModalSpec } from './views/modals/buyModal.js';
import { BUILD_MODAL_ID, buildModalSpec } from './views/modals/buildModal.js';
import { START_BUILD_MODAL_ID, startBuildModalSpec } from './views/modals/startBuildModal.js';
import { ACQUIRE_MODAL_ID, acquireModalSpec } from './views/modals/acquireModal.js';
import { ISLAND_MODAL_ID, islandModalSpec } from './views/modals/islandModal.js';
import { LIQUIDATION_MODAL_ID, liquidationModalSpec } from './views/modals/liquidationModal.js';
import { GAME_OVER_MODAL_ID, gameOverModalSpec } from './views/modals/gameOverModal.js';
import { TRAVEL_MODAL_ID, travelConfirmSpec } from './views/modals/travelModal.js';
import { CELL_SHEET_ID, cellSheetSpec } from './views/modals/cellSheet.js';
import { TUTORIAL_MODAL_ID, tutorialModalSpec } from './views/modals/tutorialModal.js';
import { newsCardSpec, NEWS_MODAL_ID } from './views/modals/newsCardModal.js';
import { OWNED_CITIES_SHEET_ID, ownedCitiesSheetSpec } from './views/modals/ownedCitiesSheet.js';
import { OWNED_HIGHLIGHT_MS } from './views/boardView.js';
import { clearNotices } from './views/modals/noticeCard.js';

/** 방 목록 자동 새로고침 주기. */
const ROOM_LIST_INTERVAL_MS = 3000;
/** SSE가 거절당했을 때의 재연결 대기 시간(점점 늘린다). */
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000];

export function createGameController({ appRoot, overlayRoot }) {
  const store = createStore();
  const toast = createToastHost(overlayRoot);
  const modalHost = createModalHost(overlayRoot);
  // 상대가 무엇을 했는지 한 줄로 알려 주는 줄(결정 모달보다 아래 층에 그린다).
  const opponentToasts = createOpponentToastHost(overlayRoot);
  const queue = new EventPlaybackQueue();

  let roomCode = null;
  let stream = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let roomListTimer = null;
  const commandLock = createCommandLock();
  /** 마지막 GAME_OVER 이벤트의 종료 사유. 재접속 스냅샷에는 이벤트가 없으므로 뷰에서 추정한다. */
  let gameOverReason = null;

  /**
   * 거래 시트 상태. `null`이면 시트가 닫혀 있다(보드를 보는 중).
   * 창구가 열려도 **닫아 둘 수 있어야** 하므로 "페이즈"가 아니라 이 화면 상태가 시트를 결정한다.
   * @type {{mode: 'TRADE'|'QUEUE', seatId: string}|null}
   */
  let tradeSheet = null;
  /** 지금 창구(좌석+라운드). 창구가 새로 열리면 시트를 한 번 자동으로 띄운다. */
  let tradeWindowKey = null;
  /** 뉴스 전문 시트를 열어 뒀는지. */
  let newsSheetOpen = false;

  /** 잠금 상태가 바뀔 때마다 화면에 반영한다(모든 커맨드 버튼의 disabled/aria-busy 기준). */
  function syncLock() {
    store.patch({ locked: commandLock.locked });
  }

  /* ── 뷰 구성 ──────────────────────────────────────────────── */

  const homeView = createHomeView({
    onCreateRoom: (name) => void createRoom(name),
    onJoinRoom: (code, name) => void joinRoom(code, name),
    onReconnect: (code) => void enterRoom(code),
    onForget: (code) => {
      storage.forgetRoom(code);
      store.patch({ savedRooms: storage.savedRooms() });
    },
  });

  const lobbyView = createLobbyView({
    onAddLocalPlayer: (name) => void joinSeat(name),
    onLeaveSeat: (seatId) => void leaveSeat(seatId),
    onKickSeat: (seatId) => void kickSeat(seatId),
    onAddComputer: (name) => void sendHostAction({ type: 'ADD_COMPUTER', name }),
    onSetRoundLimit: (roundLimit) => void sendHostAction({ type: 'SET_OPTIONS', roundLimit }),
    onSetInvestmentMode: (investmentMode) =>
      // `finance`의 나머지 키는 생략하면 서버가 기존 값을 유지한다(API.md 변경 20).
      void sendHostAction({ type: 'SET_OPTIONS', finance: { investmentMode } }),
    onStart: () => void sendHostAction({ type: 'START' }),
    onExit: () => void leaveRoomFromLobby(),
  });

  const boardView = createBoardView({ onCellActivate: (index) => onCellActivate(index) });
  const marketView = createMarketView({
    onOpenTrade: () => openTradeSheet(),
    onOpenQueue: () => openQueueSheet(),
    onOpenNews: () => openNewsSheet(),
    onOpenTutorial: () => showTutorial({ force: true }),
    onCancelQueued: (seatId, orderId) => void sendSeatCommand(seatId, 'CANCEL_QUEUED_ORDER', { orderId }),
  });
  const tradeView = createTradeView({
    onOrder: (type, payload) => void sendCommand(type, payload),
    onCloseTrading: () => void sendCommand('CLOSE_TRADING'),
    onQueueOrder: (seatId, payload) => void sendSeatCommand(seatId, 'QUEUE_ORDER', payload),
    onCancelQueued: (seatId, orderId) => void sendSeatCommand(seatId, 'CANCEL_QUEUED_ORDER', { orderId }),
  });
  const centerView = createCenterView({
    onRoll: () => void sendCommand('ROLL'),
    onOpenDecision: () => syncModals(),
    onShowRankings: () => showRankings(),
    onLeaveGame: () => leaveGameScreen(),
    onResumeControl: (seatId) => void setAutopilot(seatId, false),
    onOpenTrade: () => openTradeSheet(),
    marketView,
  });
  const playersView = createPlayersView({
    onSetAutopilot: (seatId, enabled) => void setAutopilot(seatId, enabled),
    // 카드의 돋보기 버튼은 그 사람이 **가진 도시**를 보드에서 찾아 준다(말의 위치는 시트의 보조 줄로).
    onShowHoldings: (seatId) => showOwnedCities(seatId),
  });
  const logView = createLogView();
  const statusStrip = createStatusStrip({
    onFindMe: () => findMyToken(),
    onOpenTrade: () => openTradeSheet(),
    onToggleZoom: (zoomed) => {
      boardView.setZoom(zoomed);
      if (zoomed) {
        findMyToken();
      }
    },
  });
  const legendView = createLegendView();
  const casinoView = createCasinoView({
    onBet: (bet) => void sendCommand('CASINO_BET', bet),
    onLeave: () => void sendCommand('CASINO_LEAVE'),
  });
  const gameView = createGameView({
    boardView,
    centerView,
    playersView,
    logView,
    statusStrip,
    legendView,
    onReconnectNow: () => void resyncAndReconnect(),
  });

  // 상황판의 주사위도 중앙 코어와 똑같은 눈을 보여 준다(값의 출처는 DICE_ROLLED 하나뿐).
  centerView.attachDiceMirror(statusStrip.dice);

  appRoot.append(homeView.element, lobbyView.element, gameView.element);

  /* ── "내 말 찾기" ─────────────────────────────────────────── */

  /** 한 좌석의 말과 그 칸을 잠깐 강조한다. */
  function focusSeatOnBoard(seatId) {
    const player = store.state.view?.players.find((item) => item.seatId === seatId) ?? null;
    if (!player || player.eliminated) {
      toast.info('보드 위에 없는 좌석입니다.');
      return;
    }
    boardView.findSeat(seatId, player.position);
  }

  /**
   * 한 좌석이 가진 도시를 보드에서 모두 강조하고 목록 시트를 연다.
   * (말의 위치는 시트 안의 "현재 위치" 줄로만 남긴다 — 오너 요청.)
   */
  function showOwnedCities(seatId) {
    const state = store.state;
    const view = state.view;
    const player = view?.players.find((item) => item.seatId === seatId) ?? null;
    if (!player) {
      toast.info('좌석 정보를 찾을 수 없습니다.');
      return;
    }
    const holdings = ownedCitiesOf({
      board: view.board,
      seatId,
      ownerName: seatNameOf(state, seatId),
    });
    const slot = slotOf(state, seatId);
    boardView.highlightOwned(holdings.indexes, { color: slot.color });
    modalHost.present(
      ownedCitiesSheetSpec({
        holdings,
        // 칸 이름은 찾지 못하면 null로 넘긴다(대체 문구는 locationLabel이 한 곳에서 만든다).
        positionLabel: `${LOCATION_PREFIX}: ${playerCellLabel({
          index: player.position,
          spaceName: view.board?.[player.position]?.name ?? null,
          islandRemainingTurns: player.islandRemainingTurns,
          eliminated: player.eliminated,
        })}`,
        slotColor: slot.color,
        highlightSeconds: Math.round(OWNED_HIGHLIGHT_MS / 1000),
        onFocusCell: (index) => boardView.revealCell(index),
        onClose: () => {
          modalHost.close(OWNED_CITIES_SHEET_ID);
          boardView.clearOwnedHighlight();
        },
      }),
    );
  }

  /** 이 기기의 좌석 중 지금 차례인 좌석을(없으면 첫 좌석을) 찾아 비춘다. */
  function findMyToken() {
    const state = store.state;
    const mine = state.mySeats.map((seat) => seat.seatId);
    if (mine.length === 0) {
      toast.info('이 기기에는 좌석이 없습니다.');
      return;
    }
    const current = state.view?.currentSeatId;
    focusSeatOnBoard(mine.includes(current) ? current : mine[0]);
  }

  /* ── 재생 엔진 ────────────────────────────────────────────── */

  const playback = createPlaybackEngine({
    queue,
    board: boardView,
    center: centerView,
    players: playersView,
    log: logView,
    casino: casinoView,
    market: marketView,
    isCasinoOpen: () => modalHost.isOpen(CASINO_MODAL_ID),
    announce: (text) => gameView.announce(text),
    applyView: (view) => {
      // 실제로 최신 뷰가 반영된 순간에만 잠금을 푼다(연출이 끝날 때까지는 이중 전송을 막는다).
      // 뷰와 잠금을 한 번에 반영해야 한다: 뷰를 먼저 그리면 새 결정 모달이 잠긴 채로 만들어진다.
      commandLock.onView(view?.version);
      store.patch({ view, locked: commandLock.locked });
    },
    isLocalSeat: (seatId) => isMySeat(store.state, seatId),
    opponentToasts,
    onViewArrived: (view) => scheduleStaleModalSweep(view),
    onGameOver: (reason) => {
      gameOverReason = reason;
    },
    nameOf: (seatId) => seatNameOf(store.state, seatId),
    spaceNameOf: (index) => spaceNameOf(store.state, index),
    // 예약 주문 체결/거절처럼 "연출은 없지만 반드시 알려야 하는" 결과를 토스트로 전한다.
    notify: ({ tone, message }) => {
      if (tone === 'success') {
        toast.success(message, '예약 주문');
      } else {
        toast.info(message, '예약 주문');
      }
    },
  });

  /* ── 렌더링 ───────────────────────────────────────────────── */

  store.subscribe((state) => render(state));

  function render(state) {
    setHidden(homeView.element, state.screen !== SCREENS.HOME);
    setHidden(lobbyView.element, state.screen !== SCREENS.LOBBY);
    setHidden(gameView.element, state.screen !== SCREENS.GAME);

    if (state.screen === SCREENS.HOME) {
      homeView.update(state);
      modalHost.closeOthers([]);
      return;
    }
    if (state.screen === SCREENS.LOBBY) {
      lobbyView.update(state);
      modalHost.closeOthers([]);
      return;
    }

    const market = marketContext(state);
    gameView.update(state, market);
    if (state.view) {
      // 목적지 선택 모드를 먼저 정해야 한다: 칸의 선택 가능/금지 표시는 boardView.update가 그 모드를 읽어 그린다.
      syncTravelMode(state);
      boardView.update(state);
      centerView.update(state);
      centerView.animateJackpot(state.view.jackpot);
      playersView.update(state);
      marketView.update(state, market);
      syncModals(state);
    }
  }

  /* ── 증권거래소 ───────────────────────────────────────────── */

  /** 시장 패널·상황판·거래 시트가 함께 쓰는 "지금 내가 거래할 수 있는지" 계산. */
  function marketContext(state) {
    const view = state.view;
    const market = view?.market ?? null;
    if (!market) {
      return { hasMarket: false, canTrade: false, mySeatId: null, mySeatIds: [], tradingSeatName: null };
    }
    const acting = actingSeatId(state);
    const mineActing = isMyActingTurn(state);
    const seatIds = state.mySeats.map((seat) => seat.seatId);
    const tradingOpen = view.phase === 'AWAIT_TRADE';
    return {
      hasMarket: true,
      canTrade: tradingOpen && mineActing,
      // 보유·손익은 "지금 결정하는 내 좌석"(없으면 이 기기의 첫 좌석) 기준으로 보여 준다.
      mySeatId: mineActing ? acting : seatIds[0] ?? null,
      mySeatIds: seatIds,
      tradingSeatName: tradingOpen ? seatNameOf(state, acting) : null,
      seatNameOf: (seatId) => seatNameOf(state, seatId),
    };
  }

  /** 지금 창구를 식별하는 키(좌석 + 라운드). 창구가 새로 열렸는지 판단한다. */
  function tradeWindowKeyOf(state) {
    const view = state.view;
    if (!view || view.phase !== 'AWAIT_TRADE') {
      return null;
    }
    return `${actingSeatId(state)}:${view.round}`;
  }

  function openTradeSheet() {
    const state = store.state;
    if (!isMyActingTurn(state) || state.view?.phase !== 'AWAIT_TRADE') {
      openQueueSheet();
      return;
    }
    tradeSheet = { mode: 'TRADE', seatId: actingSeatId(state) };
    syncModals();
    // 처음 거래하는 사람에게만 안내 카드를 얹는다(읽었으면 다시 뜨지 않는다).
    showTutorial();
  }

  function openQueueSheet(seatId = null) {
    const state = store.state;
    const seats = state.mySeats;
    if (seats.length === 0) {
      toast.info('이 기기에는 좌석이 없습니다.');
      return;
    }
    if (!state.view?.market) {
      return;
    }
    tradeSheet = { mode: 'QUEUE', seatId: seatId ?? seats[0].seatId };
    tradeView.resetForm();
    syncModals();
    showTutorial();
  }

  function openNewsSheet() {
    newsSheetOpen = true;
    syncModals();
  }

  function closeNewsSheet() {
    newsSheetOpen = false;
    modalHost.close(NEWS_MODAL_ID);
  }

  /* ── 첫 사용 안내 ─────────────────────────────────────────── */

  /** 다음에 보여 줄 안내 카드 index(0부터). `force`면 이미 읽었어도 처음부터 보여 준다. */
  let tutorialIndex = 0;

  function showTutorial({ force = false } = {}) {
    if (force) {
      tutorialIndex = 0;
    } else {
      const next = firstUnseenCard(storage.seenTutorials());
      if (!next) {
        return;
      }
      tutorialIndex = TUTORIAL_CARDS.indexOf(next);
    }
    presentTutorial();
  }

  function presentTutorial() {
    const card = TUTORIAL_CARDS[tutorialIndex];
    if (!card) {
      modalHost.close(TUTORIAL_MODAL_ID);
      return;
    }
    modalHost.present(
      tutorialModalSpec({
        card,
        index: tutorialIndex,
        total: TUTORIAL_CARDS.length,
        onNext: () => {
          storage.markTutorialSeen(card.id);
          tutorialIndex += 1;
          if (tutorialIndex >= TUTORIAL_CARDS.length) {
            modalHost.close(TUTORIAL_MODAL_ID);
            return;
          }
          presentTutorial();
        },
        onSkip: () => {
          // "다시 보지 않기"는 강제로 열었을 때도 안전하다(이미 읽은 것으로 표시할 뿐이다).
          storage.markAllTutorialsSeen(TUTORIAL_CARDS.map((item) => item.id));
          modalHost.close(TUTORIAL_MODAL_ID);
        },
        // 닫기 버튼/Esc로 닫으면 지금 카드만 읽은 것으로 본다(나머지는 다음에 다시 뜬다).
        onDismiss: () => storage.markTutorialSeen(card.id),
      }),
    );
  }

  /**
   * 거래 시트를 페이즈·좌석에 맞춰 띄우거나 닫는다.
   * @returns {boolean} 이 시트가 지금 화면의 주 모달인지
   */
  function syncTradeSheet(state, keep) {
    const view = state.view;
    const market = view?.market ?? null;
    if (!market) {
      tradeSheet = null;
      tradeWindowKey = null;
      return false;
    }

    // 창구가 새로 열렸다면 한 번은 자동으로 띄운다(닫은 뒤에는 다시 띄우지 않는다).
    const windowKey = tradeWindowKeyOf(state);
    if (windowKey !== tradeWindowKey) {
      tradeWindowKey = windowKey;
      if (windowKey && isMyActingTurn(state)) {
        tradeSheet = { mode: 'TRADE', seatId: actingSeatId(state) };
        tradeView.resetForm();
        // 처음 거래하는 사람에게 안내 카드를 한 번 얹는다. 지금 그리는 중이라
        // 이 렌더가 끝난 뒤에 띄운다(같은 렌더에서 열면 closeOthers가 곧바로 닫는다).
        window.setTimeout(() => showTutorial(), 0);
      } else if (tradeSheet?.mode === 'TRADE') {
        tradeSheet = null;
      }
    }

    if (!tradeSheet) {
      return false;
    }

    // 내 창구가 열렸는데 예약 모드로 열려 있으면 거래 모드로 승격한다(같은 폼을 쓴다).
    if (view.phase === 'AWAIT_TRADE' && isMyActingTurn(state) && tradeSheet.mode === 'QUEUE') {
      tradeSheet = { mode: 'TRADE', seatId: actingSeatId(state) };
    }
    // 창구가 닫혔으면 거래 모드를 유지할 수 없다.
    if (tradeSheet.mode === 'TRADE' && (view.phase !== 'AWAIT_TRADE' || !isMyActingTurn(state))) {
      tradeSheet = null;
      modalHost.close(TRADE_MODAL_ID);
      return false;
    }
    // 내 결정(매입·건설·정리 등)이 기다리고 있으면 예약 주문 시트가 그것을 가려서는 안 된다.
    if (tradeSheet.mode === 'QUEUE' && isMyTurn(state) && view.pending && view.pending.kind !== 'TRADE') {
      tradeSheet = null;
      modalHost.close(TRADE_MODAL_ID);
      return false;
    }

    const seatId = tradeSheet.seatId;
    const trading = tradeSheet.mode === 'TRADE';
    const pending = trading && view.pending?.kind === 'TRADE' ? view.pending : null;
    const player = view.players.find((item) => item.seatId === seatId) ?? null;

    tradeView.update({
      market,
      // 창구 예산은 `pending`이 가장 정확하고(내 창구), 없으면 공개 스냅샷을 쓴다.
      budget: pending?.budget ?? (market.budget?.seatId === seatId ? market.budget : { ...market.budget, open: false }),
      cash: pending?.cash ?? player?.cash ?? 0,
      deposit: pending?.deposit ?? market.deposits?.[seatId] ?? 0,
      seatId,
      seatName: seatNameOf(state, seatId),
      mode: tradeSheet.mode,
      interactive: trading ? isMyActingTurn(state) : true,
      locked: Boolean(state.locked),
      afterTrade: pending?.afterTrade ?? 'ROLL',
      seatNameOf: (id) => seatNameOf(state, id),
      mySeatIds: state.mySeats.map((seat) => seat.seatId),
      queueSeats: state.mySeats,
      onSelectSeat: (nextSeatId) => openQueueSheet(nextSeatId),
    });

    modalHost.present(
      tradeModalSpec({
        tradeView,
        seatName: seatNameOf(state, seatId),
        mode: tradeSheet.mode,
        onDismiss: () => {
          tradeSheet = null;
        },
      }),
    );
    modalHost.closeOthers([TRADE_MODAL_ID, ...keep]);
    return true;
  }

  /* ── 결정 모달 안전망 ─────────────────────────────────────── */

  /**
   * 서버가 이미 다음 페이즈로 넘어갔는데도 열려 있는 결정 모달을 닫는다.
   *
   * 평소에는 최신 뷰를 그릴 때(`syncModals`) 닫히지만, 그 시점은 **연출 큐가 다 비워진 뒤**다.
   * 연출 약속이 멈추면(예외·멈춘 타이머·백그라운드 탭) 모달이 화면에 남는다 —
   * 폰에서 "카드가 안 꺼진다"는 신고의 가장 그럴듯한 경로여서 도착 시점 기준으로 한 번 더 막는다.
   *
   * 곧바로 닫지 않고 짧게 기다리는 이유: 카지노 3판째 결과처럼 **지금 재생 중인 연출**을
   * 사용자가 보기도 전에 모달을 치워 버리면 무슨 일이 있었는지 알 수 없다.
   */
  let staleSweepTimer = null;
  function scheduleStaleModalSweep(view) {
    // ① 자기 연출이 없는 모달(조난·매입·건설·인수·정리…)은 **기다릴 이유가 없다**.
    //    안내 카드가 재생되는 동안 결정 모달이 화면에 남는 일을 여기서 끊는다.
    const { immediate } = partitionStaleModals(modalHost.openIds, view);
    for (const id of immediate) {
      modalHost.close(id);
    }

    // ② 카지노처럼 본문에서 연출이 도는 모달만 유예 뒤에 다시 본다.
    //    이미 예약돼 있으면 **다시 미루지 않는다**. 컴퓨터 좌석이 0.3초마다 메시지를 보내는 동안
    //    타이머를 계속 뒤로 밀면 안전망이 영영 동작하지 않는다(그때가 바로 필요한 순간이다).
    if (staleSweepTimer !== null) {
      return;
    }
    staleSweepTimer = window.setTimeout(() => {
      staleSweepTimer = null;
      // 그새 최신 뷰가 반영됐다면 그 뷰를 기준으로 다시 판단한다.
      const latest = store.state.view ?? view;
      const target = (latest?.version ?? -1) >= (view?.version ?? -1) ? latest : view;
      const stale = partitionStaleModals(modalHost.openIds, target);
      for (const id of [...stale.immediate, ...stale.graced]) {
        console.error('[controller] 페이즈가 어긋난 결정 모달을 안전망으로 닫았습니다', id, target?.phase ?? null);
        modalHost.close(id);
      }
    }, STALE_MODAL_GRACE_MS);
  }

  /* ── 모달 동기화 (phase + pending) ─────────────────────────── */

  function syncTravelMode(state) {
    const view = state.view;
    const picking = view?.phase === 'AWAIT_TRAVEL' && isMyTurn(state);
    // 선택 가능한 칸은 서버가 준 금지 목록으로만 판단한다.
    boardView.setTravelMode({
      active: picking,
      forbidden: picking ? view.pending?.forbiddenIndexes ?? [] : [],
      locked: Boolean(state.locked),
    });
  }

  function syncModals(state = store.state) {
    const view = state.view;
    if (!view || state.screen !== SCREENS.GAME) {
      modalHost.closeOthers([]);
      return;
    }

    if (view.isOver) {
      tradeSheet = null;
      presentGameOver(state);
      modalHost.closeOthers([GAME_OVER_MODAL_ID, CELL_SHEET_ID, OWNED_CITIES_SHEET_ID]);
      return;
    }

    const pending = view.pending;
    // 스스로 닫는 정보 시트(칸 상세 · 도시 목록)는 페이즈가 바뀌어도 남겨 둔다.
    // 목적지 확인 시트는 공항 선택 페이즈에서만 남겨 둔다.
    const sheets = [CELL_SHEET_ID, OWNED_CITIES_SHEET_ID];
    const keep = view.phase === 'AWAIT_TRAVEL' ? [...sheets, TRAVEL_MODAL_ID] : [...sheets];
    // 시장 설명 시트들은 어느 페이즈에서든 읽는 중일 수 있다(게임 진행을 막지 않는다).
    if (newsSheetOpen) {
      modalHost.present(newsCardSpec({ market: view.market, onClose: () => closeNewsSheet() }));
      keep.push(NEWS_MODAL_ID);
    }
    if (modalHost.isOpen(TUTORIAL_MODAL_ID)) {
      keep.push(TUTORIAL_MODAL_ID);
    }

    // 거래 창구/예약 주문 시트가 열려 있으면 그것이 주 모달이다.
    if (syncTradeSheet(state, keep)) {
      return;
    }

    // 카지노는 관전자도 함께 본다(조작은 자기 차례에만).
    if (view.phase === 'AWAIT_CASINO' && pending) {
      const playerName = seatNameOf(state, view.currentSeatId);
      casinoView.update({
        pending,
        cash: currentPlayer(state)?.cash ?? 0,
        myTurn: isMyTurn(state),
        locked: Boolean(state.locked),
        playerName,
      });
      modalHost.present(casinoModalSpec({ casinoView, playerName }));
      modalHost.closeOthers([CASINO_MODAL_ID, ...keep]);
      return;
    }

    if (!isMyTurn(state) || !pending) {
      modalHost.closeOthers(keep);
      return;
    }

    const spec = decisionSpec(state, pending);
    if (!spec) {
      modalHost.closeOthers(keep);
      return;
    }
    modalHost.present(spec);
    modalHost.closeOthers([spec.id, ...keep]);
  }

  function decisionSpec(state, pending) {
    const view = state.view;
    const cash = currentPlayer(state)?.cash ?? 0;
    const spaceAt = (index) => view.board?.[index] ?? null;
    const locked = Boolean(state.locked);

    switch (pending.kind) {
      case 'BUY':
        return buyModalSpec({
          pending,
          space: spaceAt(pending.index),
          cash,
          locked,
          onBuy: () => void sendCommand('BUY'),
          onSkip: () => void sendCommand('SKIP_BUY'),
        });

      case 'BUILD': {
        const signature = `${signatureOfBuild(pending, cash)}:${locked}`;
        const keepBody = modalHost.isOpen(BUILD_MODAL_ID) && buildSignature === signature;
        buildSignature = signature;
        return buildModalSpec({
          pending,
          space: spaceAt(pending.index),
          cash,
          keepBody,
          locked,
          onBuild: (buildings) => void sendCommand('BUILD', { buildings }),
          onSkip: () => void sendCommand('SKIP_BUILD'),
        });
      }

      case 'START_BUILD': {
        const spec = startBuildModalSpec({
          pending,
          boardOf: spaceAt,
          cash,
          // 잠금 상태가 바뀌면 버튼의 disabled를 다시 그려야 하므로 본문을 유지하지 않는다.
          keepBody: modalHost.isOpen(START_BUILD_MODAL_ID) && startBuildLocked === locked,
          locked,
          onStartBuild: (cityIndex, buildings) => void sendCommand('START_BUILD', { cityIndex, buildings }),
          onSkip: () => void sendCommand('SKIP_START_BUILD'),
        });
        startBuildLocked = locked;
        return spec;
      }

      case 'ACQUIRE':
        return acquireModalSpec({
          pending,
          space: spaceAt(pending.index),
          ownerName: seatNameOf(state, pending.ownerId),
          cash,
          locked,
          onAcquire: () => void sendCommand('ACQUIRE'),
          onSkip: () => void sendCommand('SKIP_ACQUIRE'),
        });

      case 'ISLAND':
        return islandModalSpec({
          pending,
          cash,
          locked,
          onPay: () => void sendCommand('ISLAND_PAY'),
          onRoll: () => void sendCommand('ISLAND_ROLL'),
        });

      case 'LIQUIDATION':
        return liquidationModalSpec({
          pending,
          cash,
          creditorName: seatNameOf(state, pending.creditorId),
          keepBody: false,
          locked,
          rules: view.market?.rules,
          // 옛 서버(assetKind 없음)를 위해 부동산은 `SELL { cityIndex }` 경로를 그대로 남긴다.
          onSell: (cityIndex) => void sendCommand('SELL', { cityIndex }),
          onSellAsset: (item, quantity) =>
            void sendCommand('SELL_ASSET', {
              assetKind: item.assetKind,
              assetId: item.assetId,
              // 전량이면 quantity를 생략한다(서버 기본값이 전량이다).
              ...(quantity < item.maxQuantity ? { quantity } : {}),
            }),
          onAutoSell: () => void sendCommand('AUTO_SELL'),
          onTakeLoan: () => void sendCommand('TAKE_LOAN'),
          onDeclareBankruptcy: () => void sendCommand('DECLARE_BANKRUPTCY'),
        });

      // 거래 창구(`TRADE`)는 결정 모달이 아니라 전용 시트로 띄운다(syncTradeSheet).
      case 'TRADE':
      default:
        return null;
    }
  }

  /** 건설 모달은 체크 상태를 지키기 위해 같은 기회일 때 본문을 다시 만들지 않는다. */
  let buildSignature = null;
  /** 출발 보너스 모달 본문을 마지막으로 그렸을 때의 잠금 상태. */
  let startBuildLocked = null;
  function signatureOfBuild(pending, cash) {
    return `${pending.index}:${(pending.options ?? []).map((option) => `${option.type}${option.cost}`).join(',')}:${cash}`;
  }

  function presentGameOver(state) {
    modalHost.present(
      gameOverModalSpec({
        rankings: state.view.rankings ?? [],
        // 이번 세션에서 GAME_OVER 이벤트를 받았으면 그 사유를, 재접속 스냅샷이라 못 받았으면 뷰에서 추정한다.
        reason: gameOverReason ?? inferGameOverReason(state.view),
        slotOfSeat: (seatId) => slotOf(state, seatId),
        // 순위에는 총자산 내역이 없다(현금·채무만) — 내역은 players[].netWorth에서 찾는다.
        playerOfSeat: (seatId) => state.view.players.find((player) => player.seatId === seatId) ?? null,
        withMarket: Boolean(state.view.market),
        onBackToRoom: () => {
          modalHost.close(GAME_OVER_MODAL_ID);
        },
        onNewGame: () => {
          modalHost.close(GAME_OVER_MODAL_ID);
          leaveGameScreen();
        },
      }),
    );
  }

  function showRankings() {
    if (store.state.view?.isOver) {
      presentGameOver(store.state);
    }
  }

  function currentPlayer(state) {
    return state.view?.players.find((player) => player.seatId === state.view.currentSeatId) ?? null;
  }

  /* ── 보드 칸 누름 ─────────────────────────────────────────── */

  function onCellActivate(index) {
    const state = store.state;
    const space = state.view?.board?.[index];
    if (!space) {
      return;
    }

    const picking = state.view.phase === 'AWAIT_TRAVEL' && isMyTurn(state);
    const forbidden = state.view.pending?.forbiddenIndexes ?? [];
    if (picking) {
      if (state.locked) {
        // 커맨드가 오가는 중에는 목적지 탭도 잠긴다(이중 전송 방지).
        return;
      }
      if (forbidden.includes(index)) {
        toast.info('이 칸은 목적지로 고를 수 없습니다.');
        return;
      }
      boardView.setSelected(index);
      modalHost.present(
        travelConfirmSpec({
          space,
          ownerName: space.ownerId ? seatNameOf(state, space.ownerId) : null,
          locked: Boolean(state.locked),
          onConfirm: () => {
            modalHost.close(TRAVEL_MODAL_ID);
            boardView.setSelected(null);
            void sendCommand('TRAVEL', { destination: index });
          },
          onCancel: () => {
            modalHost.close(TRAVEL_MODAL_ID);
            boardView.setSelected(null);
          },
        }),
      );
      return;
    }

    const costs = space.price
      ? { VILLA: buildCostOf(space.price, 'VILLA'), BUILDING: buildCostOf(space.price, 'BUILDING'), HOTEL: buildCostOf(space.price, 'HOTEL') }
      : {};
    boardView.setSelected(index);
    modalHost.present(
      cellSheetSpec({
        space,
        ownerName: space.ownerId ? seatNameOf(state, space.ownerId) : null,
        buildingCosts: costs,
        onClose: () => {
          modalHost.close(CELL_SHEET_ID);
          boardView.setSelected(null);
        },
      }),
    );
  }

  /* ── 방 참가/생성 흐름 ───────────────────────────────────── */

  async function createRoom(hostName) {
    store.patch({ busy: true });
    try {
      const { room, seatId, seatToken } = await api.createRoom(hostName);
      storage.saveSeat(room.code, { seatId, seatToken, name: hostName });
      await enterRoom(room.code);
      toast.success(`방 ${room.code}을(를) 만들었습니다.`, '방 생성');
    } catch (error) {
      reportError(error);
    } finally {
      store.patch({ busy: false });
    }
  }

  async function joinRoom(code, name) {
    store.patch({ busy: true });
    try {
      const { room, seatId, seatToken } = await api.joinSeat(code, name);
      storage.saveSeat(room.code, { seatId, seatToken, name });
      await enterRoom(room.code);
    } catch (error) {
      reportError(error);
    } finally {
      store.patch({ busy: false });
    }
  }

  /** 핫시트: 이 기기에 좌석을 하나 더 만든다. presence가 바뀌므로 스트림을 다시 연다. */
  async function joinSeat(name) {
    if (!roomCode) {
      return;
    }
    try {
      const { room, seatId, seatToken } = await api.joinSeat(roomCode, name);
      storage.saveSeat(roomCode, { seatId, seatToken, name });
      store.patch({ room, mySeats: storage.publicSeatsOf(roomCode) });
      connectStream();
      toast.success(`${name} 좌석을 이 기기에 추가했습니다.`);
    } catch (error) {
      reportError(error);
    }
  }

  async function enterRoom(code) {
    stopRoomListPolling();
    roomCode = code;
    // 방마다 view.version이 1부터 다시 시작하므로 버전 기억까지 비운다.
    queue.forget();
    logView.clear();
    // 이전 방의 말·주사위 눈이 새 방에 남지 않게 보드도 비우고 다시 만든다.
    boardView.reset();
    centerView.resetDice();
    gameOverReason = null;

    try {
      applyRoomState(await api.getRoom(code));
      connectStream();
    } catch (error) {
      if (isRoomGoneError(error)) {
        // 저장돼 있던 방이 이미 사라졌다 — 홈 화면의 저장된 방 목록에서도 지운다.
        storage.forgetRoom(code);
      }
      reportError(error);
      goHome();
    }
  }

  function applyRoomState({ room, game }) {
    const mySeats = storage.publicSeatsOf(room.code);
    for (const seat of room.seats) {
      if (mySeats.some((mine) => mine.seatId === seat.id)) {
        storage.renameSeat(room.code, seat.id, seat.name);
      }
    }
    store.patch({
      room,
      mySeats: storage.publicSeatsOf(room.code),
      screen: isPlayingRoom(room) ? SCREENS.GAME : SCREENS.LOBBY,
      view: game ?? store.state.view,
    });
    if (game) {
      playback.resetTo(game);
    }
    // 스냅샷으로 화면을 통째로 맞춘 것이므로 커맨드 잠금도 버전 비교 없이 즉시 푼다.
    commandLock.onResync();
    syncLock();
  }

  /* ── 좌석 떠나기 ─────────────────────────────────────────── */

  async function leaveSeat(seatId) {
    if (!roomCode) {
      return;
    }
    const token = storage.tokenOf(roomCode, seatId);
    if (!token) {
      return;
    }
    try {
      const { room } = await api.leaveSeat(roomCode, seatId, token);
      storage.removeSeat(roomCode, seatId);
      const mySeats = storage.publicSeatsOf(roomCode);
      store.patch({ room, mySeats });
      if (mySeats.length === 0) {
        goHome();
      } else {
        connectStream();
      }
    } catch (error) {
      reportError(error);
    }
  }

  async function kickSeat(seatId) {
    const hostToken = hostTokenOrNull();
    if (!hostToken) {
      return;
    }
    try {
      const { room } = await api.leaveSeat(roomCode, seatId, hostToken);
      store.patch({ room });
    } catch (error) {
      reportError(error);
    }
  }

  /** 대기실에서 방을 완전히 떠난다(가진 좌석 모두 비우기). */
  async function leaveRoomFromLobby() {
    const code = roomCode;
    if (!code) {
      goHome();
      return;
    }
    for (const seat of storage.publicSeatsOf(code)) {
      const token = storage.tokenOf(code, seat.seatId);
      if (!token) {
        continue;
      }
      try {
        await api.leaveSeat(code, seat.seatId, token);
      } catch (error) {
        // 이미 사라진 좌석일 수 있다. 기록만 남기고 계속 정리한다.
        console.error('[controller] 좌석 퇴장 실패', seat.seatId, error.code ?? error);
      }
      storage.removeSeat(code, seat.seatId);
    }
    storage.forgetRoom(code);
    goHome();
  }

  /**
   * 게임 중 나가기. 진행 중인 방에서는 좌석을 지우지 않는다(서버도 허용하지 않는다).
   * 좌석 토큰을 그대로 남겨 두어 "재접속"으로 돌아올 수 있게 한다.
   */
  function leaveGameScreen() {
    toast.info('좌석은 그대로 남습니다. 홈의 "이 기기에 저장된 방"에서 다시 들어올 수 있습니다.', '관전 종료');
    goHome();
  }

  function goHome() {
    disconnectStream();
    roomCode = null;
    queue.forget();
    // 보드·주사위에는 이전 방의 말과 눈이 남아 있다 — 방을 떠날 때 함께 비운다.
    boardView.reset();
    centerView.resetDice();
    gameOverReason = null;
    commandLock.onResync();
    modalHost.closeAll();
    // 화면을 떠날 때 떠 있던 안내 카드·상대 알림도 함께 걷어 낸다(다음 화면에 남지 않게).
    clearNotices();
    opponentToasts.clear();
    store.resetRoom();
    store.patch({ screen: SCREENS.HOME, savedRooms: storage.savedRooms(), connection: CONNECTION.IDLE, locked: false });
    startRoomListPolling();
  }

  /* ── 호스트 동작 ─────────────────────────────────────────── */

  function hostTokenOrNull() {
    const state = store.state;
    if (!roomCode || !state.room) {
      return null;
    }
    if (!isHostSeatMine(state)) {
      toast.info('호스트만 할 수 있는 동작입니다.');
      return null;
    }
    return storage.tokenOf(roomCode, state.room.hostSeatId);
  }

  async function sendHostAction(action) {
    const token = hostTokenOrNull();
    if (!token) {
      return;
    }
    store.patch({ busy: true });
    try {
      const { room } = await api.hostAction(roomCode, action, token);
      store.patch({ room });
    } catch (error) {
      reportError(error);
    } finally {
      store.patch({ busy: false });
    }
  }

  /**
   * 자동 진행 전환. 켜는 것은 호스트만, 끄는 것은 그 좌석의 토큰으로도 할 수 있다.
   * 서버가 아직 자기 좌석 해제를 허용하지 않으면 규격 에러를 그대로 안내한다.
   */
  async function setAutopilot(seatId, enabled) {
    if (!roomCode) {
      return;
    }
    const ownToken = !enabled ? storage.tokenOf(roomCode, seatId) : null;
    const token = ownToken ?? hostTokenOrNull();
    if (!token) {
      return;
    }
    try {
      const { room } = await api.hostAction(roomCode, { type: 'SET_AUTOPILOT', seatId, enabled }, token);
      store.patch({ room });
      toast.success(enabled ? '자동 진행으로 넘겼습니다.' : '직접 플레이로 돌아왔습니다.');
    } catch (error) {
      reportError(error);
    }
  }

  /* ── 게임 커맨드 ─────────────────────────────────────────── */

  async function sendCommand(type, payload) {
    const state = store.state;
    if (!roomCode || !state.view) {
      return;
    }
    if (commandLock.locked) {
      return;
    }
    // "지금 결정하는 좌석"으로 보낸다(오늘은 currentSeatId와 같지만 앞날에 안전하다 — API.md 변경 18).
    const seatId = actingSeatId(state);
    if (!isMySeat(state, seatId)) {
      toast.info('지금은 내 차례가 아닙니다.');
      return;
    }
    await postCommand(seatId, type, payload);
  }

  /**
   * 좌석을 지정해 보내는 커맨드. 예약 주문(`QUEUE_ORDER`/`CANCEL_QUEUED_ORDER`)은
   * **내 차례가 아니어도** 자기 좌석에 대해 허용된다(API.md 변경 25).
   */
  async function sendSeatCommand(seatId, type, payload) {
    const state = store.state;
    if (!roomCode || !state.view || commandLock.locked) {
      return;
    }
    if (!isMySeat(state, seatId)) {
      toast.info('이 좌석은 이 기기의 좌석이 아닙니다.');
      return;
    }
    await postCommand(seatId, type, payload);
  }

  async function postCommand(seatId, type, payload) {
    const state = store.state;
    const token = storage.tokenOf(roomCode, seatId);
    if (!token) {
      toast.info('이 좌석의 권한이 이 기기에 없습니다.');
      return;
    }

    commandLock.onSend(state.view.version);
    syncLock();
    try {
      const command = payload === undefined ? { type, seatId } : { type, seatId, payload };
      const result = await api.sendCommand(roomCode, command, token);
      // 성공했어도 연출이 끝나 최신 뷰가 실제로 반영될 때까지는 잠금을 유지한다(commandLock.onView가 푼다).
      commandLock.onSuccess();
      syncLock();
      playback.accept(result);
    } catch (error) {
      commandLock.onError();
      syncLock();
      // 레이트 리밋(ERR019)은 즉시 재시도하면 또 막힌다 — 주문 버튼을 잠깐 잠근다.
      if (!applyTradeCooldown(error)) {
        reportError(error);
      }
      // 서버 뷰가 유일한 진실이므로 현재 상태를 다시 받아 화면을 되돌린다.
      await refreshRoomState();
    }
  }

  /**
   * 거래 에러에 쿨다운이 필요한지 보고, 필요하면 안내까지 마친다.
   * @returns {boolean} 안내를 여기서 처리했는지
   */
  function applyTradeCooldown(error) {
    if (!(error instanceof api.ApiError)) {
      return false;
    }
    const hint = tradeErrorHint(error.code);
    if (hint.cooldownMs <= 0) {
      return false;
    }
    tradeView.startCooldown(hint.cooldownMs);
    toast.info(hint.message, '잠시 뒤 다시');
    return true;
  }

  async function refreshRoomState() {
    if (!roomCode) {
      return;
    }
    try {
      const snapshot = await api.getRoom(roomCode);
      applyRoomState(snapshot);
    } catch (error) {
      console.error('[controller] 상태 재조회 실패', error.code ?? error);
    }
  }

  /* ── SSE 연결 ────────────────────────────────────────────── */

  function connectStream() {
    if (!roomCode) {
      return;
    }
    disconnectStream();
    store.patch({ connection: CONNECTION.CONNECTING });
    stream = api.openRoomStream({
      code: roomCode,
      presence: storage.presenceParam(roomCode),
      onRoom: (room) => onRoomEvent(room),
      onGame: (message) => playback.accept(message),
      onOpen: () => {
        reconnectAttempt = 0;
        store.patch({ connection: CONNECTION.OPEN });
      },
      onDisconnected: (closed) => {
        if (!closed) {
          store.patch({ connection: CONNECTION.RECONNECTING });
          return;
        }
        store.patch({ connection: CONNECTION.CLOSED });
        scheduleReconnect();
      },
    });
  }

  function disconnectStream() {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (stream) {
      stream.close();
      stream = null;
    }
  }

  /** 서버가 스트림을 거절했을 때(구독 한도 등) 점점 늘어나는 간격으로 다시 시도한다. */
  function scheduleReconnect() {
    if (reconnectTimer !== null || !roomCode) {
      return;
    }
    const delay = RECONNECT_BACKOFF_MS[Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void resyncAndReconnect();
    }, delay);
  }

  /** 재접속: 스냅샷을 먼저 받아 화면을 맞추고(연출 재생 없음) 스트림을 다시 연다. */
  async function resyncAndReconnect() {
    if (!roomCode) {
      return;
    }
    disconnectStream();
    try {
      const snapshot = await api.getRoom(roomCode);
      applyRoomState(snapshot);
      connectStream();
    } catch (error) {
      if (isRoomGoneError(error)) {
        // 재접속하려던 방이 그새 사라졌다 — 저장된 방 목록에서 지운다.
        storage.forgetRoom(roomCode);
      }
      reportError(error);
      store.patch({ connection: CONNECTION.CLOSED });
      scheduleReconnect();
    }
  }

  function onRoomEvent(room) {
    const state = store.state;
    const wasPlaying = isPlayingRoom(state.room);
    const mySeats = storage.publicSeatsOf(room.code);

    // 내 좌석이 사라졌다면(강퇴/퇴장) 기록을 정리한다.
    for (const mine of mySeats) {
      if (!room.seats.some((seat) => seat.id === mine.seatId)) {
        storage.removeSeat(room.code, mine.seatId);
        toast.info(`${mine.name} 좌석이 방에서 사라졌습니다.`);
      }
    }
    const remaining = storage.publicSeatsOf(room.code);
    store.patch({
      room,
      mySeats: remaining,
      screen: isPlayingRoom(room) ? SCREENS.GAME : SCREENS.LOBBY,
    });
    if (remaining.length === 0) {
      goHome();
      return;
    }
    if (!wasPlaying && isPlayingRoom(room)) {
      toast.success('게임이 시작되었습니다!', '시작');
    }
  }

  /* ── 방 목록 자동 새로고침 ───────────────────────────────── */

  async function refreshRoomList() {
    try {
      const { rooms } = await api.listRooms();
      store.patch({ roomList: rooms, roomListError: null });
    } catch (error) {
      console.error('[controller] 방 목록 조회 실패', error.code ?? error);
      store.patch({ roomListError: error.message ?? '방 목록을 불러올 수 없습니다.' });
    }
  }

  function startRoomListPolling() {
    stopRoomListPolling();
    void refreshRoomList();
    roomListTimer = window.setInterval(() => {
      if (store.state.screen === SCREENS.HOME) {
        void refreshRoomList();
      }
    }, ROOM_LIST_INTERVAL_MS);
  }

  function stopRoomListPolling() {
    if (roomListTimer !== null) {
      window.clearInterval(roomListTimer);
      roomListTimer = null;
    }
  }

  /* ── 에러 안내 ───────────────────────────────────────────── */

  /** 화면에는 서버가 준 message만. 자세한 내용은 콘솔로만 남긴다. */
  function reportError(error) {
    if (error instanceof api.ApiError) {
      toast.error(error);
      return;
    }
    console.error('[controller] 예기치 못한 오류', error);
    toast.error({ code: 'ERR_CLIENT', message: '요청을 처리할 수 없습니다.' });
  }

  /* ── 키보드 ──────────────────────────────────────────────── */

  function onKeyDown(event) {
    if (event.defaultPrevented || modalHost.hasModal) {
      return;
    }
    if (event.key !== ' ' && event.key !== 'Enter') {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'SUMMARY', 'A'].includes(target.tagName)) {
      return;
    }
    const state = store.state;
    if (state.screen !== SCREENS.GAME || !isMyTurn(state) || state.view?.phase !== 'AWAIT_ROLL' || state.locked) {
      return;
    }
    event.preventDefault();
    void sendCommand('ROLL');
  }

  /* ── 시작 ────────────────────────────────────────────────── */

  return {
    async start() {
      document.addEventListener('keydown', onKeyDown);
      window.addEventListener('beforeunload', () => disconnectStream());

      store.patch({ savedRooms: storage.savedRooms() });
      startRoomListPolling();

      try {
        const serverInfo = await api.getServerInfo();
        store.patch({ serverInfo });
      } catch (error) {
        console.error('[controller] 서버 정보 조회 실패', error.code ?? error);
      }

      // ?room=CODE 로 들어오면 바로 그 방으로(같은 기기 좌석이 있으면 재접속).
      const params = new URLSearchParams(window.location.search);
      const code = params.get('room');
      if (code && storage.publicSeatsOf(code.toUpperCase()).length > 0) {
        await enterRoom(code.toUpperCase());
      }
      render(store.state);
    },
  };
}
