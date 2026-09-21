/**
 * 인수 제안 모달(`AWAIT_ACQUIRE`). pending: `{index, name, ownerId, price}`
 *
 * 통행료를 전액 낸 뒤에만 열리며, **보유 현금으로만** 인수할 수 있다(매각·대출 불가).
 */

import { el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { actionRow, citySummary, moneyRow, noticeLine, primaryButton, quietButton } from './parts.js';

export const ACQUIRE_MODAL_ID = 'acquire';

export function acquireModalSpec({ pending, space, ownerName, cash, locked = false, onAcquire, onSkip }) {
  const affordable = cash >= pending.price;

  return {
    id: ACQUIRE_MODAL_ID,
    title: '도시 인수',
    subtitle: '소유자는 인수를 거절할 수 없습니다.',
    dismissible: false,
    render: () =>
      el('div', { class: 'modal-stack' }, [
        citySummary({
          name: pending.name,
          kind: space?.kind ?? 'CITY',
          buildings: space?.buildings ?? [],
          landmark: Boolean(space?.landmark),
          ownerName,
        }),
        moneyRow('인수 가격', pending.price, { tone: 'out', note: '투자액 × 2' }),
        moneyRow('보유 현금', cash),
        moneyRow('인수 후 현금', Math.max(0, cash - pending.price)),
        moneyRow('앞으로 받을 통행료', space?.toll ?? 0, { tone: 'in' }),
        el('div', { class: 'effect-list' }, [
          el('p', { class: 'effect-title', text: '인수 후 효과' }),
          el('ul', { class: 'bullet-list' }, [
            el('li', { text: '지어진 건물이 그대로 넘어옵니다.' }),
            el('li', { text: '인수 대금은 현재 소유자에게 지급됩니다.' }),
            el('li', { text: '인수 직후 이 도시에 건설 기회가 한 번 열립니다.' }),
          ]),
        ]),
        affordable
          ? null
          : noticeLine(`인수는 보유 현금만 쓸 수 있습니다. ${formatWon(pending.price - cash)} 부족합니다.`),
        actionRow([
          primaryButton(`${formatWon(pending.price)}에 인수`, {
            onClick: onAcquire,
            disabled: !affordable,
            busy: locked,
            focusKey: 'acquire',
          }),
          quietButton('인수 포기', { onClick: onSkip, busy: locked, focusKey: 'skip-acquire' }),
        ]),
      ]),
  };
}
