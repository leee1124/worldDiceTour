/**
 * 출발 보너스 모달(`AWAIT_START_BUILD`). pending: `{candidates: [{index, name, price, options}]}`
 *
 * 내 도시 하나를 고르고, 그 도시에서 지을 건물 조합을 고른다.
 */

import { button, clear, el, replaceChildren, setText, toggleClass } from '../../dom.js';
import { formatWon } from '../../format.js';
import { actionRow, moneyRow, primaryButton, quietButton } from './parts.js';
import { createBuildingPicker } from './buildModal.js';

export const START_BUILD_MODAL_ID = 'start-build';

export function startBuildModalSpec({ pending, boardOf, cash, keepBody, onStartBuild, onSkip }) {
  const candidates = pending.candidates ?? [];

  return {
    id: START_BUILD_MODAL_ID,
    title: '출발 보너스',
    subtitle: '출발 칸에 정확히 도착했습니다. 내 도시 한 곳에 건설 기회를 씁니다.',
    dismissible: false,
    keepBody,
    render: () => {
      const pickerSlot = el('div', { class: 'candidate-picker' });
      const confirmButton = primaryButton('건설하기', { onClick: () => {}, disabled: true, focusKey: 'start-build' });
      const cityButtons = new Map();
      let chosenIndex = candidates[0]?.index ?? null;
      let picker = null;

      function renderPicker() {
        const candidate = candidates.find((item) => item.index === chosenIndex);
        if (!candidate) {
          replaceChildren(pickerSlot, el('p', { class: 'empty-note', text: '건설할 도시를 고르세요.' }));
          confirmButton.disabled = true;
          return;
        }
        const space = boardOf(candidate.index);
        picker = createBuildingPicker({
          options: candidate.options ?? [],
          price: candidate.price ?? space?.price ?? 0,
          buildings: space?.buildings ?? [],
          landmark: Boolean(space?.landmark),
          cash,
          onValidityChange: ({ ok, cost }) => {
            confirmButton.disabled = !ok;
            setText(confirmButton, cost > 0 ? `${formatWon(cost)} 들여 건설` : '건설하기');
          },
        });
        replaceChildren(pickerSlot, picker.element);
        picker.refresh();
      }

      function selectCity(index) {
        chosenIndex = index;
        for (const [cityIndex, node] of cityButtons.entries()) {
          const on = cityIndex === index;
          toggleClass(node, 'candidate-row--on', on);
          node.setAttribute('aria-pressed', String(on));
        }
        renderPicker();
      }

      const list = el('div', { class: 'candidate-list' });
      clear(list);
      for (const candidate of candidates) {
        const space = boardOf(candidate.index);
        const row = button(
          {
            class: 'candidate-row',
            'aria-pressed': 'false',
            dataset: { focusKey: `candidate-${candidate.index}` },
            on: { click: () => selectCity(candidate.index) },
          },
          [
            el('span', { class: 'candidate-name', text: candidate.name }),
            el('span', {
              class: 'candidate-meta',
              text: `매입가 ${formatWon(candidate.price ?? space?.price ?? 0)} · 통행료 ${formatWon(space?.toll ?? 0)}`,
            }),
          ],
        );
        cityButtons.set(candidate.index, row);
        list.appendChild(row);
      }

      confirmButton.addEventListener('click', () => {
        if (chosenIndex === null || !picker) {
          return;
        }
        onStartBuild(chosenIndex, picker.selected());
      });

      const body = el('div', { class: 'modal-stack' }, [
        moneyRow('보유 현금', cash),
        el('p', { class: 'modal-help', text: '랜드마크가 완성된 도시는 후보에 나오지 않습니다.' }),
        list,
        pickerSlot,
        actionRow([confirmButton, quietButton('보너스 포기', { onClick: onSkip, focusKey: 'skip-start-build' })]),
      ]);

      if (chosenIndex !== null) {
        selectCity(chosenIndex);
      }
      return body;
    },
  };
}
