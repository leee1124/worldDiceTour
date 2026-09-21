/**
 * 통행료 안내. 강제 지불은 페이즈가 아니라 이벤트로 오기 때문에,
 * 결정 모달과 다투지 않는 짧은 안내 카드로 보여 준다.
 */

import { el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { DURATIONS, nextFrame, prefersReducedMotion, scaled, wait } from '../../animation/timing.js';

/**
 * @param {{payerName: string, ownerName: string, spaceName: string, amount: number, mine: boolean}} toll
 */
export async function playTollNotice({ payerName, ownerName, spaceName, amount, mine = false }) {
  const notice = el(
    'div',
    {
      class: ['toll-notice', mine ? 'toll-notice--mine' : null],
      role: 'status',
      'aria-live': 'polite',
    },
    [
      el('span', { class: 'toll-eyebrow', text: '통행료' }),
      el('p', { class: 'toll-headline' }, [
        el('strong', { text: spaceName }),
        el('span', { text: ' 통과' }),
      ]),
      el('p', { class: 'toll-amount', text: formatWon(amount) }),
      el('p', { class: 'toll-parties', text: `${payerName} → ${ownerName}` }),
    ],
  );
  document.body.appendChild(notice);

  if (!prefersReducedMotion()) {
    await nextFrame();
    notice.classList.add('toll-notice--in');
  }
  await wait(scaled(DURATIONS.toll));
  notice.classList.add('toll-notice--out');
  await wait(prefersReducedMotion() ? 20 : 200);
  notice.remove();
}
