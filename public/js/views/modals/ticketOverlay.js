/**
 * 행운 티켓 카드 뒤집기 연출. 서버가 준 `text`를 그대로(textContent) 보여 준다.
 *
 * 수명·닫기·페일세이프는 모두 `noticeCard.js`가 맡는다 — 이 파일은 **모양만** 만든다.
 * 뒤집기 연출은 장식이므로 실패해도 카드는 제 시간에 닫히고, 앞면은 반드시 보이게 된다.
 */

import { el } from '../../dom.js';
import { ticketEffectLabel } from '../../domain/labels.js';
import { NOTICE_KINDS } from '../../domain/noticeTiming.js';
import { prefersReducedMotion } from '../../animation/timing.js';
import { showNotice } from './noticeCard.js';

/** 앞면으로 넘기는 시점. rAF에 기대지 않고 타이머로만 건다(두 번 걸어 확실히 넘긴다). */
const FLIP_AT_MS = 40;
const FLIP_GUARD_MS = 420;

/**
 * @param {{playerName: string, text: string, effect: object, mine?: boolean, fastForward?: boolean}} ticket
 * @returns {Promise<void>} 카드가 사라지면 resolve (연출이 깨져도 반드시 resolve된다)
 */
export function playTicketCard({ playerName, text, effect, mine = false, fastForward = false }) {
  let card = null;

  return showNotice({
    kind: NOTICE_KINDS.TICKET,
    mine,
    fastForward,
    variant: 'ticket',
    line: `${playerName} · 행운 티켓 — ${text}`,
    card: () => {
      card = el('div', { class: 'ticket-card' }, [
        el('div', { class: 'ticket-face ticket-face--back', 'aria-hidden': 'true' }, [
          el('span', { class: 'ticket-back-title', text: '행운 티켓' }),
        ]),
        el('div', { class: 'ticket-face ticket-face--front' }, [
          el('span', { class: 'ticket-eyebrow', text: `${playerName} · 행운 티켓` }),
          el('p', { class: 'ticket-text', text }),
          el('span', { class: 'ticket-effect', text: ticketEffectLabel(effect?.type) }),
        ]),
      ]);
      // 모션 축소면 뒤집는 움직임 없이 앞면부터 보여 준다(읽는 시간은 그대로).
      if (prefersReducedMotion()) {
        card.classList.add('ticket-card--flipped');
      }
      return card;
    },
    onShown: () => {
      if (!card || prefersReducedMotion()) {
        return;
      }
      const flip = () => card?.classList.add('ticket-card--flipped');
      window.setTimeout(flip, FLIP_AT_MS);
      // 첫 타이머가 밀려도(백그라운드 탭 등) 앞면은 반드시 보이게 한 번 더 건다.
      window.setTimeout(flip, FLIP_GUARD_MS);
    },
  });
}
