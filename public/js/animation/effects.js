/**
 * 화면 위를 날아가는 짧은 연출(동전 이동, 떠오르는 금액, 화면 섬광).
 * 보드/패널과 독립된 고정 오버레이 레이어에서만 움직인다.
 */

import { el } from '../dom.js';
import { DURATIONS, nextFrame, prefersReducedMotion, scaled, wait } from './timing.js';

let layer = null;

function effectLayer() {
  if (!layer || !document.body.contains(layer)) {
    layer = el('div', { class: 'fx-layer', 'aria-hidden': 'true' });
    document.body.appendChild(layer);
  }
  return layer;
}

/**
 * 한 점에서 다른 점으로 동전이 날아간다(통행료·인수 대금 등).
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 */
export async function flyCoin(from, to, { label = '', tone = 'gold' } = {}) {
  if (!from || !to || prefersReducedMotion()) {
    return;
  }
  // 동전 얼굴은 이모지 대신 CSS로 그린 원(₩ 표시)이다 — 폰트에 기대지 않는다.
  const coin = el('div', { class: ['fx-coin', `fx-coin--${tone}`] }, [
    el('span', { class: 'fx-coin-face', 'aria-hidden': 'true', text: '₩' }),
    label ? el('span', { class: 'fx-coin-label', text: label }) : null,
  ]);
  coin.style.transform = `translate3d(${from.x}px, ${from.y}px, 0)`;
  effectLayer().appendChild(coin);

  await nextFrame();
  coin.style.transition = `transform ${DURATIONS.coin}ms cubic-bezier(0.34, 0.8, 0.3, 1), opacity 160ms ease-in ${
    DURATIONS.coin - 160
  }ms`;
  coin.style.transform = `translate3d(${to.x}px, ${to.y}px, 0)`;
  coin.style.opacity = '0';

  await wait(DURATIONS.coin);
  coin.remove();
}

/** 금액이 위로 떠오르며 사라진다(+월급 / −통행료). */
export async function floatAmount(point, text, { tone = 'plus' } = {}) {
  if (!point) {
    return;
  }
  // 위치는 CSS 변수로 넘긴다(키프레임이 transform을 쓰기 때문).
  const node = el('div', {
    class: ['fx-amount', `fx-amount--${tone}`],
    text,
    style: { '--fx-x': `${point.x}px`, '--fx-y': `${point.y}px` },
  });
  effectLayer().appendChild(node);

  await nextFrame();
  node.classList.add('fx-amount--rise');
  await wait(scaled(DURATIONS.salary + 260));
  node.remove();
}

/** 화면 전체가 짧게 번쩍인다(잭팟·파산 같은 큰 사건). */
export async function flashScreen(tone = 'gold') {
  if (prefersReducedMotion()) {
    return;
  }
  const node = el('div', { class: ['fx-flash', `fx-flash--${tone}`] });
  effectLayer().appendChild(node);
  await wait(DURATIONS.flash);
  node.remove();
}

/** 요소의 화면 좌표 중심. 요소가 없으면 null. */
export function centerOf(node) {
  if (!node || !node.getBoundingClientRect) {
    return null;
  }
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
