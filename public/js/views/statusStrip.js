/**
 * 보드 바로 아래의 "상황판". 폰에서 화면을 스크롤해도 늘 붙어 있다.
 *
 * 폰에서는 보드가 작아 보드만 봐서는 상황을 못 읽는다 — 그래서 한 줄에
 * **지금 누구 차례인지 · 어느 칸에 있는지 · 방금 나온 주사위 눈**을 모아 두고,
 * "내 위치 보기"로 내 말을 바로 찾아갈 수 있게 한다.
 */

import { button, el, setHidden, setText, toggleClass } from '../dom.js';
import { currentLocationLabel } from '../domain/locationLabel.js';
import { remainingTurnsOf } from '../domain/turnOrder.js';
import { isMySeat, seatNameOf, slotOf, spaceOf } from '../store.js';
import { createDicePair } from './diceView.js';
import { exchangeIcon, magnifierIcon } from './icons.js';

export function createStatusStrip({ onFindMe, onToggleZoom, onOpenTrade = () => {} }) {
  const chip = el('span', { class: 'strip-chip', 'aria-hidden': 'true' });
  const nameNode = el('span', { class: 'strip-name' });
  const tagNode = el('span', { class: 'strip-tag' });
  const locationNode = el('span', { class: 'strip-location', text: currentLocationLabel(null) });
  // "내 차례까지 몇 명 남았지?"를 글자로 알려 준다(좌석 순서 = 차례 순서).
  const queueNode = el('span', { class: 'strip-queue' });

  const dice = createDicePair({ labels: ['상황판 주사위 1', '상황판 주사위 2'], variant: 'strip' });

  const findButton = button(
    { class: 'btn btn--primary btn--small strip-btn', on: { click: () => onFindMe() } },
    [magnifierIcon(), ' 내 위치'],
  );
  let zoomed = false;
  const zoomLabelNode = el('span', { text: '확대' });
  const zoomButton = button(
    {
      class: 'btn btn--quiet btn--small strip-btn',
      'aria-pressed': 'false',
      on: {
        click: () => {
          zoomed = !zoomed;
          zoomButton.setAttribute('aria-pressed', String(zoomed));
          setText(zoomLabelNode, zoomed ? '축소' : '확대');
          onToggleZoom(zoomed);
        },
      },
    },
    [magnifierIcon(), zoomLabelNode],
  );

  // 거래 창구를 닫아 두고 보드를 보다가 여기서 다시 열 수 있다(폰에서 늘 손가락이 닿는 자리).
  const tradeButton = button(
    { class: 'btn btn--primary btn--small strip-btn strip-btn--trade', on: { click: () => onOpenTrade() } },
    [exchangeIcon(), ' 거래 창구 열기'],
  );

  const element = el('section', { class: 'status-strip', 'aria-label': '현재 상황' }, [
    el('div', { class: 'strip-line' }, [
      el('span', { class: 'strip-who' }, [chip, nameNode, tagNode]),
      locationNode,
    ]),
    tradeButton,
    queueNode,
    el('div', { class: 'strip-line strip-line--tools' }, [dice.element, findButton, zoomButton]),
  ]);
  setHidden(tradeButton, true);

  return {
    element,
    dice,

    /**
     * @param {object} state
     * @param {{canTrade?: boolean}} [context] 거래 창구를 열 수 있는 차례인지
     */
    update(state, context = {}) {
      const view = state.view;
      if (!view) {
        return;
      }
      setHidden(tradeButton, !context.canTrade);
      tradeButton.disabled = Boolean(state.locked);

      const slot = slotOf(state, view.currentSeatId);
      chip.dataset.slot = slot.color;
      chip.dataset.shape = slot.shape;
      setText(nameNode, view.isOver ? '게임 종료' : seatNameOf(state, view.currentSeatId));
      const mine = isMySeat(state, view.currentSeatId);
      setText(tagNode, view.isOver ? '' : mine ? '내 차례' : '차례');
      toggleClass(tagNode, 'strip-tag--mine', mine && !view.isOver);
      toggleClass(element, 'status-strip--my-turn', mine && !view.isOver);

      const current = view.players.find((player) => player.seatId === view.currentSeatId) ?? null;
      setText(locationNode, currentLocationLabel(current ? spaceOf(state, current.position)?.name ?? null : null));

      const remaining = remainingTurnsOf({
        players: view.players,
        currentSeatId: view.currentSeatId,
        isOver: view.isOver,
      });
      setText(queueNode, remaining.label);
      queueNode.hidden = remaining.label === '';

      // 이 기기에 좌석이 없으면(순수 관전) "내 위치"는 의미가 없다.
      findButton.disabled = state.mySeats.length === 0;
    },
  };
}
