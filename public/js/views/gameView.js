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

export function createGameView({ boardView, centerView, playersView, logView, onReconnectNow }) {
  // 보드 중앙 코어는 보드와 같은 무대 안에 둔다(넓은 화면에서는 겹쳐 놓이고, 세로에서는 아래로 내려간다).
  boardView.element.appendChild(centerView.element);

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
      el('div', { class: 'game-main' }, [boardView.element]),
      el('div', { class: 'game-side' }, [playersView.element, logView.element]),
    ]),
  ]);

  return {
    element,

    update(state) {
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
