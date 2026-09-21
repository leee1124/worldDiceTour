/**
 * 통행료 안내. 강제 지불은 페이즈가 아니라 이벤트로 오기 때문에,
 * 결정 모달과 다투지 않는 짧은 안내 카드로 보여 준다.
 *
 * 수명·닫기·페일세이프는 `noticeCard.js`가 맡는다 — 이 파일은 모양만 만든다.
 */

import { el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { NOTICE_KINDS } from '../../domain/noticeTiming.js';
import { showNotice } from './noticeCard.js';

/**
 * @param {{payerName: string, ownerName: string, spaceName: string, amount: number,
 *   mine?: boolean, fastForward?: boolean}} toll
 * @returns {Promise<void>}
 */
export function playTollNotice({ payerName, ownerName, spaceName, amount, mine = false, fastForward = false }) {
  return showNotice({
    kind: NOTICE_KINDS.TOLL,
    mine,
    fastForward,
    variant: 'toll',
    line: `💸 ${spaceName} 통행료 ${formatWon(amount)} · ${payerName} → ${ownerName}`,
    card: () =>
      el('div', { class: ['toll-notice', mine ? 'toll-notice--mine' : null] }, [
        el('span', { class: 'toll-eyebrow', text: '통행료' }),
        el('p', { class: 'toll-headline' }, [
          el('strong', { text: spaceName }),
          el('span', { text: ' 통과' }),
        ]),
        el('p', { class: 'toll-amount', text: formatWon(amount) }),
        el('p', { class: 'toll-parties', text: `${payerName} → ${ownerName}` }),
      ]),
  });
}
