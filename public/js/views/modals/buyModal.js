/**
 * 구매 모달(`AWAIT_BUY`). pending: `{index, name, price}`
 */

import { el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { predictToll } from '../../domain/buildRules.js';
import { actionRow, citySummary, moneyRow, noticeLine, primaryButton, quietButton } from './parts.js';

export const BUY_MODAL_ID = 'buy';

export function buyModalSpec({ pending, space, cash, locked = false, onBuy, onSkip }) {
  const affordable = cash >= pending.price;
  const isResort = space?.kind === 'RESORT';

  return {
    id: BUY_MODAL_ID,
    title: '도시 매입',
    subtitle: '주인이 없는 칸입니다.',
    dismissible: false,
    render: () =>
      el('div', { class: 'modal-stack' }, [
        citySummary({ name: pending.name, kind: space?.kind ?? 'CITY' }),
        moneyRow('매입가', pending.price, { tone: 'out' }),
        moneyRow('보유 현금', cash),
        moneyRow('매입 후 현금', Math.max(0, cash - pending.price)),
        isResort
          ? moneyRow('통행료', 50_000, { note: '보유 휴양지 수 × 50,000원' })
          : moneyRow('땅만 있을 때 통행료', predictToll({ price: pending.price }), {
              note: '건설하면 크게 올라갑니다',
            }),
        el('p', {
          class: 'modal-help',
          text: isResort
            ? '휴양지는 건설할 수 없지만, 여러 곳을 모으면 통행료가 배로 오릅니다.'
            : '매입하면 같은 턴에 별장 · 빌딩 · 호텔을 골라 지을 기회가 바로 열립니다.',
        }),
        affordable ? null : noticeLine(`현금이 ${formatWon(pending.price - cash)} 부족합니다.`),
        actionRow([
          primaryButton(`${formatWon(pending.price)}에 매입`, {
            onClick: onBuy,
            disabled: !affordable,
            busy: locked,
            focusKey: 'buy',
          }),
          quietButton('매입 포기', { onClick: onSkip, busy: locked, focusKey: 'skip-buy' }),
        ]),
      ]),
  };
}
