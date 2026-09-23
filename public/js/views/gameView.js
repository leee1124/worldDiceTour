/**
 * 게임 화면 껍데기: 상단 바(방 코드 · 연결 상태) · 보드(+중앙 코어) · 오른쪽(모바일은 아래) 패널.
 */

import { button, el, setHidden, setText, toggleClass } from '../dom.js';
import { CONNECTION, isHostSeatMine } from '../store.js';

const CONNECTION_LABELS = Object.freeze({
  [CONNECTION.IDLE]: '연결 준비',
  [CONNECTION.CONNECTING]: '연결 중…',
  [CONNECTION.OPEN]: '실시간 연결됨',
  [CONNECTION.RECONNECTING]: '재연결 중…',
  [CONNECTION.CLOSED]: '연결 끊김 — 다시 시도 중…',
});

/** 코어가 보드 아래로 내려가는 폭(board.css의 68rem 분기와 같다). */
const PHONE_QUERY = '(max-width: 68rem)';

export function createGameView({
  boardView,
  centerView,
  playersView,
  logView,
  statusStrip,
  legendView,
  onReconnectNow,
  marketView = null,
}) {
  // 보드 중앙 코어는 보드와 같은 무대 안에 둔다(넓은 화면에서는 겹쳐 놓이고, 세로에서는 아래로 내려간다).
  boardView.element.appendChild(centerView.element);

  // 시장 패널은 코어 **밖**에 둔다(U19): 코어 안에 넣으면 넓은 화면에서 코어가 보드 안쪽을 다 덮어
  // 엠블럼이 가려진다. 넓은 화면은 옆 칸 맨 위, 폰은 코어 바로 아래 — 화면 폭이 바뀌면 옮긴다.
  const marketSlot = el('div', { class: 'market-slot' });
  const sideNode = el('div', { class: 'game-side' }, [playersView.element, logView.element]);
  function mountMarket(phone) {
    if (!marketView) {
      return;
    }
    if (phone) {
      marketSlot.appendChild(marketView.element);
    } else {
      sideNode.insertBefore(marketView.element, sideNode.firstChild);
    }
  }
  try {
    const phoneQuery = window.matchMedia(PHONE_QUERY);
    mountMarket(phoneQuery.matches);
    phoneQuery.addEventListener('change', (event) => mountMarket(event.matches));
  } catch (error) {
    console.error('[game] 화면 폭을 확인하지 못해 시장 패널을 옆 칸에 둡니다', error?.name);
    mountMarket(false);
  }

  const codeNode = el('strong', { class: 'topbar-code' });
  const statusNode = el('span', { class: 'topbar-status' });
  const connectionNode = el('span', { class: 'conn-pill' }, [
    el('span', { class: 'conn-dot', 'aria-hidden': 'true' }),
    el('span', { class: 'conn-text' }),
  ]);
  const retryButton = button({ class: 'btn btn--quiet btn--small', on: { click: () => onReconnectNow() } }, '지금 재연결');
  const announcer = el('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const stalledBanner = el('div', { class: 'banner banner--warn', role: 'status' }, [
    el('span', {
      text: '자동 진행이 멈췄습니다 — 자동 진행을 해제하거나 다시 켜 주세요.',
    }),
  ]);

  const element = el('div', { class: 'screen screen--game' }, [
    el('header', { class: 'game-topbar' }, [
      el('div', { class: 'topbar-left' }, [
        el('span', { class: 'topbar-label', text: '방' }),
        codeNode,
        statusNode,
      ]),
      el('div', { class: 'topbar-right' }, [connectionNode, retryButton]),
    ]),
    stalledBanner,
    announcer,
    el('div', { class: 'game-layout' }, [
      // 보드만 가로로 넘칠 수 있게 감싼다(게임 열 자체가 스크롤 상자가 되면 상황판의 sticky가 죽는다).
      el('div', { class: 'game-main' }, [
        el('div', { class: 'board-scroll' }, [boardView.element]),
        // 폰에서 시장 패널이 앉는 자리(코어 바로 아래, 상황판 위) — 예전 코어 안 배치와 같은 순서.
        marketSlot,
        statusStrip.element,
        legendView.element,
      ]),
      sideNode,
    ]),
  ]);

  return {
    element,

    update(state, context = {}) {
      if (state.view) {
        statusStrip.update(state, context);
        legendView.update(state);
      }
      setText(codeNode, state.room?.code ?? '----');
      setText(statusNode, state.room?.status === 'FINISHED' ? '게임 종료' : '진행 중');
      const connection = state.connection ?? CONNECTION.IDLE;
      setText(connectionNode.querySelector('.conn-text'), CONNECTION_LABELS[connection] ?? '');
      connectionNode.dataset.state = connection;
      setHidden(retryButton, connection === CONNECTION.OPEN || connection === CONNECTION.CONNECTING);
      toggleClass(element, 'screen--offline', connection === CONNECTION.CLOSED);
      setHidden(stalledBanner, !(state.room?.autoStalled && isHostSeatMine(state)));
    },

    /** 턴 안내 등을 스크린리더에 전달한다. */
    announce(text) {
      setText(announcer, text);
    },
  };
}
