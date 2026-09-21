/**
 * 정리 페이즈 모달(`AWAIT_LIQUIDATION`).
 * pending: `{amountDue, creditorId, canSell, canLoan, sellable: [{index, name, refund}]}`
 *
 * 현금이 지불액에 닿는 순간 서버가 자동으로 지불을 마치고 흐름을 이어 준다.
 * 파산 선언은 되돌릴 수 없으므로 두 단계 확인을 받는다.
 */

import { button, el, setText } from '../../dom.js';
import { formatWon } from '../../format.js';
import { actionRow, infoRow, moneyRow, quietButton } from './parts.js';

export const LIQUIDATION_MODAL_ID = 'liquidation';

const LOAN_PRINCIPAL = 1_000_000;
const LOAN_DEBT = 1_200_000;

export function liquidationModalSpec({
  pending,
  cash,
  creditorName,
  keepBody,
  locked = false,
  onSell,
  onAutoSell,
  onTakeLoan,
  onDeclareBankruptcy,
}) {
  const shortfall = Math.max(0, pending.amountDue - cash);

  return {
    id: LIQUIDATION_MODAL_ID,
    title: '⚠️ 지불 정리',
    subtitle: '현금이 부족합니다. 자산을 팔거나 대출로 메우세요.',
    dismissible: false,
    keepBody,
    render: () => {
      const bankruptcySlot = el('div', { class: 'bankruptcy-slot' });

      const askBankruptcy = () => {
        setText(bankruptcySlot, '');
        bankruptcySlot.appendChild(
          el('div', { class: 'confirm-box', role: 'group', 'aria-label': '파산 선언 확인' }, [
            el('p', {
              class: 'confirm-text',
              text: '파산하면 남은 현금을 채권자에게 넘기고 모든 자산이 초기화되며 탈락합니다. 되돌릴 수 없습니다.',
            }),
            el('div', { class: 'confirm-actions' }, [
              button(
                {
                  class: 'btn btn--danger',
                  disabled: locked,
                  'aria-busy': locked ? 'true' : undefined,
                  dataset: { focusKey: 'bankrupt-confirm' },
                  on: { click: onDeclareBankruptcy },
                },
                '정말 파산을 선언합니다',
              ),
              button(
                {
                  class: 'btn btn--quiet',
                  dataset: { focusKey: 'bankrupt-cancel' },
                  on: { click: () => setText(bankruptcySlot, '') },
                },
                '취소',
              ),
            ]),
          ]),
        );
        bankruptcySlot.querySelector('[data-focus-key="bankrupt-confirm"]')?.focus();
      };

      const sellList = el('div', { class: 'sell-list' });
      if (pending.sellable.length === 0) {
        sellList.appendChild(el('p', { class: 'empty-note', text: '팔 수 있는 자산이 없습니다.' }));
      } else {
        for (const item of pending.sellable) {
          sellList.appendChild(
            el('div', { class: 'sell-row' }, [
              el('span', { class: 'sell-name', text: item.name }),
              el('span', { class: 'sell-refund', text: `+${formatWon(item.refund)}` }),
              button(
                {
                  class: 'btn btn--ghost btn--small',
                  disabled: locked,
                  'aria-busy': locked ? 'true' : undefined,
                  dataset: { focusKey: `sell-${item.index}` },
                  on: { click: () => onSell(item.index) },
                },
                '매각',
              ),
            ]),
          );
        }
      }

      return el('div', { class: 'modal-stack' }, [
        moneyRow('내야 할 금액', pending.amountDue, { tone: 'out' }),
        moneyRow('보유 현금', cash),
        moneyRow('부족한 금액', shortfall, { tone: 'out' }),
        infoRow('채권자', pending.creditorId ? creditorName : '은행 (잭팟 적립)'),

        el('section', { class: 'liq-section' }, [
          el('h3', { class: 'liq-title', text: '선택 매각' }),
          el('p', { class: 'modal-help', text: '환급액은 투자액의 50%입니다. 건물도 함께 사라집니다.' }),
          sellList,
        ]),

        el('section', { class: 'liq-section' }, [
          el('h3', { class: 'liq-title', text: '빠른 수단' }),
          el('div', { class: 'liq-actions' }, [
            button(
              {
                class: 'btn btn--ghost',
                disabled: !pending.canSell || locked,
                'aria-busy': locked ? 'true' : undefined,
                dataset: { focusKey: 'auto-sell' },
                on: { click: onAutoSell },
              },
              '자동 매각 (환급 낮은 순)',
            ),
            button(
              {
                class: 'btn btn--ghost',
                disabled: !pending.canLoan || locked,
                'aria-busy': locked ? 'true' : undefined,
                dataset: { focusKey: 'take-loan' },
                on: { click: onTakeLoan },
              },
              `대출 받기 (+${formatWon(LOAN_PRINCIPAL)})`,
            ),
          ]),
          el('p', {
            class: 'modal-help',
            text: pending.canLoan
              ? `대출은 게임당 1회입니다. 현금 ${formatWon(LOAN_PRINCIPAL)}을 받고 채무 ${formatWon(
                  LOAN_DEBT,
                )}이 생기며, 이후 월급이 전액 채무 상환에 압류됩니다.`
              : '대출은 게임당 1회만 가능하며 이미 사용했습니다.',
          }),
        ]),

        el('section', { class: 'liq-section liq-section--danger' }, [
          el('h3', { class: 'liq-title', text: '파산 선언' }),
          el('p', { class: 'modal-help', text: '이 페이즈에서는 언제든 선택할 수 있습니다.' }),
          actionRow([
            quietButton('파산 선언…', { onClick: askBankruptcy, focusKey: 'bankrupt-open' }),
          ]),
          bankruptcySlot,
        ]),
      ]);
    },
  };
}
