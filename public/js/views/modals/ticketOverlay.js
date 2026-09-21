/**
 * 행운 티켓 카드 뒤집기 연출. 서버가 준 `text`를 그대로(textContent) 보여 준다.
 * 모달 스택과는 별개의 짧은 오버레이라 포커스를 가로채지 않는다.
 */

import { el } from '../../dom.js';
import { ticketEffectLabel } from '../../domain/labels.js';
import { DURATIONS, nextFrame, prefersReducedMotion, scaled, wait } from '../../animation/timing.js';

/**
 * @param {{playerName: string, text: string, effect: object}} ticket
 * @returns {Promise<void>} 카드가 사라지면 resolve
 */
export async function playTicketCard({ playerName, text, effect }) {
  const card = el('div', { class: 'ticket-card' }, [
    el('div', { class: 'ticket-face ticket-face--back', 'aria-hidden': 'true' }, [
      el('span', { class: 'ticket-back-mark', text: '🎫' }),
      el('span', { class: 'ticket-back-title', text: '행운 티켓' }),
    ]),
    el('div', { class: 'ticket-face ticket-face--front' }, [
      el('span', { class: 'ticket-eyebrow', text: `${playerName} · 행운 티켓` }),
      el('p', { class: 'ticket-text', text }),
      el('span', { class: 'ticket-effect', text: ticketEffectLabel(effect?.type, effect) }),
    ]),
  ]);

  const overlay = el(
    'div',
    { class: 'ticket-overlay', role: 'status', 'aria-live': 'polite' },
    [card],
  );
  document.body.appendChild(overlay);

  const lifetime = scaled(DURATIONS.ticket);
  let done = false;
  const finish = () => {
    done = true;
  };
  overlay.addEventListener('click', finish);

  if (!prefersReducedMotion()) {
    await nextFrame();
    card.classList.add('ticket-card--flipped');
    await wait(520);
  } else {
    card.classList.add('ticket-card--flipped');
  }

  const started = performance.now();
  while (!done && performance.now() - started < lifetime) {
    await wait(80);
  }

  overlay.classList.add('ticket-overlay--leaving');
  await wait(prefersReducedMotion() ? 20 : 220);
  overlay.remove();
}
