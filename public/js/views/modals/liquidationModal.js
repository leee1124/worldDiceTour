/**
 * 정리 페이즈 모달(`AWAIT_LIQUIDATION`).
 *
 * pending.sellable 항목은 자산군이 섞여 온다(API.md 6장). 모든 자산군이 같은 키를 쓴다:
 * `{ assetKind: 'PROPERTY'|'STOCK'|'DEPOSIT', assetId, name, label, refund,
 *    quantity, heldQuantity, maxQuantity, unitValue, index? }`
 * - `PROPERTY`는 통째로 하나(수량 1). 옛 서버(assetKind 없음)에서는 `SELL { cityIndex }`로 떨어진다.
 * - `STOCK`은 수량을, `DEPOSIT`은 금액을 골라 일부만 팔 수 있다(`SELL_ASSET { quantity }`).
 * - 정리·파산 중 매각에는 **거래 수수료가 없다**(refund가 그대로 들어온다).
 * - **`maxQuantity`는 "지금 팔 수 있는 최대"**다. 서버가 부족액을 덮는 양까지만 허용하므로
 *   (그보다 많이 보내면 `ERR018`) 보유량(`heldQuantity`)보다 작을 수 있다. 스테퍼의 기본값과
 *   상한을 `maxQuantity`로 두면 화면이 규칙을 저절로 지킨다 — 수량 규칙은 서버가 안다.
 *
 * 현금이 지불액에 닿는 순간 서버가 자동으로 지불을 마치고 흐름을 이어 준다.
 * 파산 선언은 되돌릴 수 없으므로 두 단계 확인을 받는다.
 */

import { button, el, replaceChildren, setText } from '../../dom.js';
import { formatWon } from '../../format.js';
import { normalizeRules } from '../../domain/marketRules.js';
import { actionRow, infoRow, moneyRow, quietButton } from './parts.js';

export const LIQUIDATION_MODAL_ID = 'liquidation';

// 대출 금액은 서버 pending(`loanPrincipal`/`loanDebt`)이 알려 준다. 필드가 없는 예전 서버만 이 값으로 그린다.
const FALLBACK_LOAN_PRINCIPAL = 1_500_000;
const FALLBACK_LOAN_DEBT = 1_800_000;
const loanPrincipalOf = (pending) => Number.isInteger(pending?.loanPrincipal) ? pending.loanPrincipal : FALLBACK_LOAN_PRINCIPAL;
const loanDebtOf = (pending) => Number.isInteger(pending?.loanDebt) ? pending.loanDebt : FALLBACK_LOAN_DEBT;

const SECTIONS = Object.freeze([
  { kind: 'PROPERTY', title: '부동산', help: '환급액은 투자액의 50%입니다. 건물도 함께 사라집니다.' },
  {
    kind: 'STOCK',
    title: '주식',
    // 서버는 부족액을 덮는 수량까지만 받는다(그래서 스테퍼 상한이 보유량보다 작을 수 있다).
    help: '현재가로 팝니다. 수수료는 없고, 모자란 금액을 메울 만큼만 팔 수 있습니다.',
  },
  {
    kind: 'DEPOSIT',
    title: '예금',
    help: '정해진 단위로만 뺄 수 있고, 모자란 금액을 메울 만큼만 뺍니다.',
  },
]);

/**
 * 부분 매각 수량 초안. 모달 본문이 다시 그려져도(서버 뷰가 바뀔 때마다 그린다) 사용자가 맞춘
 * 수량이 날아가지 않게 모듈 수준에 둔다. 값은 렌더할 때마다 최신 `maxQuantity`로 다시 묶는다.
 * @type {Map<string, number>}
 */
const drafts = new Map();

const draftKey = (item) => `${item.assetKind ?? 'PROPERTY'}:${item.assetId ?? item.index}`;

function clampDraft(item, unit) {
  const max = Number.isInteger(item.maxQuantity) && item.maxQuantity > 0 ? item.maxQuantity : 1;
  const stored = drafts.get(draftKey(item));
  const raw = Number.isInteger(stored) ? stored : max;
  if (unit <= 1) {
    return Math.min(max, Math.max(1, raw));
  }
  // 예금은 단위의 배수여야 한다. 잔액이 단위보다 작으면 전액(잔액)만 가능하다.
  const ceiling = Math.floor(max / unit) * unit;
  if (ceiling < unit) {
    return max;
  }
  return Math.min(ceiling, Math.max(unit, Math.floor(raw / unit) * unit));
}

/** 자산군별 한 행. 수량을 고를 수 있는 자산은 스테퍼를 함께 준다. */
function sellRow(item, { locked, unit, onSellAsset, onSellProperty }) {
  const isProperty = (item.assetKind ?? 'PROPERTY') === 'PROPERTY';
  const label = item.label ?? item.name ?? '자산';
  const maxQuantity = Number.isInteger(item.maxQuantity) && item.maxQuantity > 0 ? item.maxQuantity : 1;
  const heldQuantity =
    Number.isInteger(item.heldQuantity) && item.heldQuantity > 0 ? item.heldQuantity : maxQuantity;
  const capped = heldQuantity > maxQuantity;
  const unitValue = Number.isInteger(item.unitValue) && item.unitValue > 0 ? item.unitValue : null;
  const pickable = !isProperty && maxQuantity > 1;

  // 수량을 고르는 행은 폰에서 한 줄에 다 들어가지 않는다 — 두 줄짜리 격자로 그린다.
  const row = el('div', { class: ['sell-row', pickable ? 'sell-row--pick' : null] });

  if (!pickable) {
    replaceChildren(row, [
      el('span', { class: 'sell-name', text: label }),
      el('span', { class: 'sell-refund', text: `+${formatWon(item.refund)}` }),
      button(
        {
          class: 'btn btn--ghost btn--small',
          disabled: locked,
          'aria-busy': locked ? 'true' : undefined,
          dataset: { focusKey: `sell-${draftKey(item)}` },
          on: {
            click: () =>
              isProperty && item.assetKind === undefined ? onSellProperty(item.index) : onSellAsset(item, maxQuantity),
          },
        },
        '매각',
      ),
    ]);
    return row;
  }

  let quantity = clampDraft(item, unit);
  const step = unit > 1 ? unit : 1;
  const suffix = unit > 1 ? '' : '주';

  const draw = () => {
    drafts.set(draftKey(item), quantity);
    const refund = unitValue ? unitValue * quantity : item.refund;
    replaceChildren(row, [
      el('div', { class: 'sell-main' }, [
        el('span', { class: 'sell-name', text: label }),
        el('span', {
          class: 'sell-unit',
          text: unit > 1
            ? capped
              ? `잔액 ${formatWon(heldQuantity)} · 필요한 ${formatWon(maxQuantity)}까지`
              : `잔액 ${formatWon(heldQuantity)}`
            : capped
              ? `${formatWon(unitValue ?? 0)} · 보유 ${heldQuantity}주 중 ${maxQuantity}주까지`
              : `${formatWon(unitValue ?? 0)} × 최대 ${maxQuantity}주`,
        }),
      ]),
      el('div', { class: 'sell-stepper' }, [
        button(
          {
            class: 'trade-step',
            'aria-label': '줄이기',
            disabled: locked || quantity <= step,
            on: {
              click: () => {
                quantity = Math.max(step, quantity - step);
                draw();
              },
            },
          },
          '−',
        ),
        el('span', {
          class: 'sell-quantity',
          text: unit > 1 ? formatWon(quantity) : `${quantity}${suffix}`,
        }),
        button(
          {
            class: 'trade-step',
            'aria-label': '늘리기',
            disabled: locked || quantity >= maxQuantity,
            on: {
              click: () => {
                quantity = Math.min(maxQuantity, quantity + step);
                draw();
              },
            },
          },
          '＋',
        ),
        button(
          {
            class: 'btn btn--chip',
            disabled: locked || quantity >= maxQuantity,
            on: {
              click: () => {
                quantity = maxQuantity;
                draw();
              },
            },
          },
          '전량',
        ),
      ]),
      el('div', { class: 'sell-tail' }, [
        el('span', { class: 'sell-refund', text: `+${formatWon(refund)}` }),
        button(
          {
            class: 'btn btn--ghost btn--small',
            disabled: locked,
            'aria-busy': locked ? 'true' : undefined,
            dataset: { focusKey: `sell-${draftKey(item)}` },
            on: { click: () => onSellAsset(item, quantity) },
          },
          '매각',
        ),
      ]),
    ]);
  };
  draw();
  return row;
}

export function liquidationModalSpec({
  pending,
  cash,
  creditorName,
  keepBody,
  locked = false,
  rules,
  onSell,
  onSellAsset,
  onAutoSell,
  onTakeLoan,
  onDeclareBankruptcy,
}) {
  const shortfall = Math.max(0, pending.amountDue - cash);
  const depositUnit = normalizeRules(rules).depositUnit;
  const sellable = Array.isArray(pending.sellable) ? pending.sellable : [];

  return {
    id: LIQUIDATION_MODAL_ID,
    title: '지불 정리',
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

      const sections = [];
      for (const section of SECTIONS) {
        // 옛 서버는 `assetKind`를 보내지 않는다 — 그때는 전부 부동산이다.
        const items = sellable.filter((item) => (item.assetKind ?? 'PROPERTY') === section.kind);
        if (items.length === 0) {
          continue;
        }
        sections.push(
          el('section', { class: 'liq-section' }, [
            el('h3', { class: 'liq-title', text: `${section.title} 매각` }),
            el('p', { class: 'modal-help', text: section.help }),
            el(
              'div',
              { class: 'sell-list' },
              items.map((item) =>
                sellRow(item, {
                  locked,
                  unit: section.kind === 'DEPOSIT' ? depositUnit : 1,
                  onSellAsset,
                  onSellProperty: onSell,
                }),
              ),
            ),
          ]),
        );
      }
      if (sections.length === 0) {
        sections.push(
          el('section', { class: 'liq-section' }, [
            el('h3', { class: 'liq-title', text: '선택 매각' }),
            el('p', { class: 'empty-note', text: '팔 수 있는 자산이 없습니다.' }),
          ]),
        );
      }

      return el('div', { class: 'modal-stack' }, [
        moneyRow('내야 할 금액', pending.amountDue, { tone: 'out' }),
        moneyRow('보유 현금', cash),
        moneyRow('부족한 금액', shortfall, { tone: 'out' }),
        infoRow('채권자', pending.creditorId ? creditorName : '은행 (잭팟 적립)'),

        ...sections,

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
              '자동 매각',
            ),
            button(
              {
                class: 'btn btn--ghost',
                disabled: !pending.canLoan || locked,
                'aria-busy': locked ? 'true' : undefined,
                dataset: { focusKey: 'take-loan' },
                on: { click: onTakeLoan },
              },
              `대출 받기 (+${formatWon(loanPrincipalOf(pending))})`,
            ),
          ]),
          el('p', {
            class: 'modal-help',
            text: '자동 매각 순서: 주식 → 예금 → 부동산. 같은 자산군에서는 환급액이 낮은 것부터 팔고, 현금이 지불액에 닿으면 멈춥니다.',
          }),
          el('p', {
            class: 'modal-help',
            text: pending.canLoan
              ? `대출은 게임당 1회입니다. 현금 ${formatWon(loanPrincipalOf(pending))}을 받고 채무 ${formatWon(
                  loanDebtOf(pending),
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
