/**
 * 보드 바로 아래의 "상황판". 폰에서 화면을 스크롤해도 늘 붙어 있다.
 *
 * 폰에서는 보드가 작아 보드만 봐서는 상황을 못 읽는다 — 그래서 한 줄에
 * **지금 누구 차례인지 · 어느 칸에 있는지 · 방금 나온 주사위 눈**을 모아 두고,
 * "내 위치 보기"로 내 말을 바로 찾아갈 수 있게 한다.
 */

import { button, el, setText, toggleClass } from '../dom.js';
import { currentLocationLabel } from '../domain/locationLabel.js';
import { isMySeat, seatNameOf, slotOf, spaceNameOf } from '../store.js';
import { createDicePair } from './diceView.js';

export function createStatusStrip({ onFindMe, onToggleZoom }) {
  const chip = el('span', { class: 'strip-chip', 'aria-hidden': 'true' });
  const nameNode = el('span', { class: 'strip-name' });
  const tagNode = el('span', { class: 'strip-tag' });
  const locationNode = el('span', { class: 'strip-location', text: currentLocationLabel(null) });

  const dice = createDicePair({ labels: ['상황판 주사위 1', '상황판 주사위 2'], variant: 'strip' });

  const findButton = button(
    { class: 'btn btn--primary btn--small strip-btn', on: { click: () => onFindMe() } },
    '🔎 내 위치',
  );
  let zoomed = false;
  const zoomButton = button(
    {
      class: 'btn btn--quiet btn--small strip-btn',
      'aria-pressed': 'false',
      on: {
        click: () => {
          zoomed = !zoomed;
          zoomButton.setAttribute('aria-pressed', String(zoomed));
          setText(zoomButton, zoomed ? '🔍 축소' : '🔍 확대');
          onToggleZoom(zoomed);
        },
      },
    },
    '🔍 확대',
  );

  const element = el('section', { class: 'status-strip', 'aria-label': '현재 상황' }, [
    el('div', { class: 'strip-line' }, [
      el('span', { class: 'strip-who' }, [chip, nameNode, tagNode]),
      locationNode,
    ]),
    el('div', { class: 'strip-line strip-line--tools' }, [dice.element, findButton, zoomButton]),
  ]);

  return {
    element,
    dice,

    update(state) {
      const view = state.view;
      if (!view) {
        return;
      }
      const slot = slotOf(state, view.currentSeatId);
      chip.dataset.slot = slot.color;
      chip.dataset.shape = slot.shape;
      setText(nameNode, view.isOver ? '게임 종료' : seatNameOf(state, view.currentSeatId));
      const mine = isMySeat(state, view.currentSeatId);
      setText(tagNode, view.isOver ? '' : mine ? '내 차례' : '차례');
      toggleClass(tagNode, 'strip-tag--mine', mine && !view.isOver);
      toggleClass(element, 'status-strip--my-turn', mine && !view.isOver);

      const current = view.players.find((player) => player.seatId === view.currentSeatId) ?? null;
      setText(locationNode, currentLocationLabel(current ? spaceNameOf(state, current.position) : null));

      // 이 기기에 좌석이 없으면(순수 관전) "내 위치"는 의미가 없다.
      findButton.disabled = state.mySeats.length === 0;
    },
  };
}
