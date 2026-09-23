/**
 * 첫 사용 안내 카드. **한 화면에 한 주제**만 담고, 읽었으면 다시 뜨지 않는다(localStorage).
 * 문구는 `domain/tutorialCards.js`에 있다(화면은 그리기만 한다).
 */

import { el } from '../../dom.js';
import { actionRow, primaryButton, quietButton } from './parts.js';

export const TUTORIAL_MODAL_ID = 'market-tutorial';

/**
 * @param {object} input
 * @param {{id: string, icon: string, title: string, paragraphs: string[], points: string[]}} input.card
 * @param {number} input.index 0부터
 * @param {number} input.total
 * @param {() => void} input.onNext 다음 카드(또는 닫기)
 * @param {() => void} input.onSkip 전부 그만 보기
 * @param {() => void} input.onDismiss 직접 닫기(이 카드만 읽은 것으로 표시한다)
 */
export function tutorialModalSpec({ card, index, total, onNext, onSkip, onDismiss }) {
  const last = index >= total - 1;
  return {
    id: TUTORIAL_MODAL_ID,
    title: card.title,
    subtitle: `처음 보는 사람을 위한 안내 · ${index + 1} / ${total}`,
    dismissible: true,
    variant: 'sheet',
    onDismiss: onDismiss ?? onSkip,
    render: () =>
      el('div', { class: 'modal-stack tutorial' }, [
        ...card.paragraphs.map((text) => el('p', { class: 'tutorial-text', text })),
        el('ul', { class: 'tutorial-points' }, card.points.map((text) => el('li', { class: 'tutorial-point', text }))),
        actionRow([
          primaryButton(last ? '알겠습니다' : '다음 →', { onClick: onNext, focusKey: 'tutorial-next' }),
          quietButton('다시 보지 않기', { onClick: onSkip, focusKey: 'tutorial-skip' }),
        ]),
      ]),
  };
}
