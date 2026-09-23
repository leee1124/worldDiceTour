/**
 * 건설 기회 모달(`AWAIT_BUILD`).
 * pending: `{index, name, options:[{type,cost}], lockedOptions:[{type,cost,unlockLap}], buildings, landmark}`
 *
 * - 별장/빌딩/호텔은 원하는 조합을 한 번에 고른다(합계 비용 · 건설 후 통행료 미리보기).
 * - 바퀴가 모자라 아직 못 짓는 건물은 `lockedOptions`로 와서 잠긴 행(자물쇠 아이콘)으로만 보여 준다.
 * - 3종을 이미 가진 기회라면 서버가 `LANDMARK` 하나만 제안한다 → 관광명소 업그레이드 화면.
 */

import { el, setText } from '../../dom.js';
import { formatWon } from '../../format.js';
import {
  LAP_RULE_TEXT,
  buildRows,
  comboCost,
  isLandmarkOffer,
  predictToll,
  validateSelection,
} from '../../domain/buildRules.js';
import { buildingLabel } from '../../domain/labels.js';
import { buildingTypeIcon, lockIcon } from '../icons.js';
import { actionRow, citySummary, moneyRow, noticeLine, primaryButton, quietButton } from './parts.js';

export const BUILD_MODAL_ID = 'build';

/**
 * 건물 조합 선택기. 체크박스 상태는 DOM이 들고 있고, 합계·통행료·버튼 상태를 즉시 갱신한다.
 * @returns {{element: HTMLElement, selected: () => string[], refresh: () => void}}
 */
export function createBuildingPicker({
  options,
  lockedOptions = [],
  price,
  buildings,
  landmark,
  cash,
  onValidityChange,
}) {
  // 잠긴 건물은 서버가 고를 수 없게 막으므로, 화면에서도 체크박스를 비활성화해 보여 준다.
  const boxes = buildRows({ options, lockedOptions }).map((row) => {
    const input = el('input', {
      class: 'check-input',
      type: 'checkbox',
      id: `build-${row.type}`,
      value: row.type,
      disabled: row.locked,
    });
    const rowNode = el(
      'label',
      {
        class: row.locked ? ['check-row', 'check-row--static', 'check-row--locked'] : 'check-row',
        for: `build-${row.type}`,
      },
      [
        input,
        el('span', { class: 'check-icon', 'aria-hidden': 'true' }, [
          row.locked ? lockIcon() : buildingTypeIcon(row.type),
        ]),
        el('span', { class: 'check-label', text: buildingLabel(row.type) }),
        row.locked ? el('span', { class: 'check-note', text: row.notice }) : null,
        el('span', { class: 'check-cost', text: formatWon(row.cost) }),
      ],
    );
    return { option: row, input, row: rowNode, locked: row.locked };
  });

  const totalNode = el('span', { class: 'summary-value' });
  const tollNode = el('span', { class: 'summary-value summary-value--gold' });
  const noticeNode = el('p', { class: 'modal-notice modal-notice--warn' });

  const currentToll = predictToll({ price, buildings, landmark, selected: [] });
  const summary = el('div', { class: 'build-summary' }, [
    el('div', { class: 'summary-row' }, [el('span', { class: 'summary-label', text: '합계 건설비' }), totalNode]),
    el('div', { class: 'summary-row' }, [
      el('span', { class: 'summary-label', text: '건설 후 통행료' }),
      el('span', { class: 'summary-from', text: formatWon(currentToll) }),
      el('span', { class: 'summary-arrow', 'aria-hidden': 'true', text: '→' }),
      tollNode,
    ]),
  ]);

  const element = el('div', { class: 'build-picker' }, [
    el('div', { class: 'check-list' }, boxes.map((box) => box.row)),
    summary,
    noticeNode,
  ]);

  function selected() {
    return boxes.filter((box) => !box.locked && box.input.checked).map((box) => box.option.type);
  }

  function refresh() {
    const chosen = selected();
    const cost = comboCost(options, chosen);
    setText(totalNode, formatWon(cost));
    setText(tollNode, formatWon(predictToll({ price, buildings, landmark, selected: chosen })));

    const validity = validateSelection(chosen, options);
    const affordable = cost <= cash;
    let message = '';
    if (chosen.length === 0) {
      message = '지을 건물을 하나 이상 고르세요.';
    } else if (!validity.ok) {
      message = validity.reason;
    } else if (!affordable) {
      message = `현금이 ${formatWon(cost - cash)} 부족합니다.`;
    }
    setText(noticeNode, message);
    noticeNode.hidden = message.length === 0;
    onValidityChange?.({ ok: validity.ok && affordable, cost, chosen });
  }

  for (const box of boxes) {
    if (!box.locked) {
      box.input.addEventListener('change', refresh);
    }
  }

  return { element, selected, refresh };
}

export function buildModalSpec({ pending, space, cash, keepBody, locked = false, onBuild, onSkip }) {
  const landmarkOffer = isLandmarkOffer(pending.options);
  const price = space?.price ?? 0;

  return {
    id: BUILD_MODAL_ID,
    title: landmarkOffer ? '관광명소 업그레이드' : '건설 기회',
    subtitle: landmarkOffer
      ? '3종 건물을 모두 갖춘 도시입니다.'
      : '원하는 건물을 한 번에 골라 지을 수 있습니다.',
    dismissible: false,
    keepBody,
    render: () => {
      const confirmButton = primaryButton('건설하기', { onClick: () => {}, disabled: true, busy: locked, focusKey: 'build' });
      const picker = createBuildingPicker({
        options: pending.options,
        lockedOptions: pending.lockedOptions,
        price,
        buildings: pending.buildings ?? [],
        landmark: Boolean(pending.landmark),
        cash,
        onValidityChange: ({ ok, cost }) => {
          confirmButton.disabled = !ok || locked;
          setText(confirmButton, cost > 0 ? `${formatWon(cost)} 들여 건설` : '건설하기');
        },
      });
      confirmButton.addEventListener('click', () => onBuild(picker.selected()));

      const body = el('div', { class: 'modal-stack' }, [
        citySummary({
          name: pending.name,
          kind: space?.kind ?? 'CITY',
          buildings: pending.buildings ?? [],
          landmark: Boolean(pending.landmark),
        }),
        el('p', { class: 'modal-help', text: LAP_RULE_TEXT }),
        moneyRow('보유 현금', cash),
        landmarkOffer
          ? el('p', {
              class: 'modal-help',
              text: '관광명소를 세우면 통행료가 매입가의 3.5배로 고정되고, 더 이상 인수당하지 않습니다.',
            })
          : el('p', {
              class: 'modal-help',
              text: '세 종류를 모두 지으면 다음 기회에 관광명소로 업그레이드할 수 있습니다.',
            }),
        picker.element,
        cash <= 0 ? noticeLine('현금이 없어 건설할 수 없습니다.') : null,
        actionRow([confirmButton, quietButton('건설 포기', { onClick: onSkip, busy: locked, focusKey: 'skip-build' })]),
      ]);
      picker.refresh();
      return body;
    },
  };
}
