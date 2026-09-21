/**
 * 모달 본문에서 되풀이되는 작은 조각들.
 */

import { button, el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { BUILDING_ORDER, buildingIcon, buildingLabel, spaceKindLabel } from '../../domain/labels.js';

/** 라벨 + 금액 한 줄. */
export function moneyRow(label, amount, { tone = '', note = '' } = {}) {
  return el('div', { class: ['money-row', tone ? `money-row--${tone}` : null] }, [
    el('span', { class: 'money-row-label', text: label }),
    el('span', { class: 'money-row-value', text: formatWon(amount) }),
    note ? el('span', { class: 'money-row-note', text: note }) : null,
  ]);
}

/** 라벨 + 임의 텍스트 한 줄. */
export function infoRow(label, value) {
  return el('div', { class: 'money-row' }, [
    el('span', { class: 'money-row-label', text: label }),
    el('span', { class: 'money-row-value money-row-value--text', text: value }),
  ]);
}

/** 도시 요약 카드(칸 이름 · 종류 · 건물 상태). */
export function citySummary({ name, kind, buildings = [], landmark = false, ownerName = null }) {
  const builtIcons = landmark
    ? [el('span', { class: 'build-icon build-icon--landmark', text: buildingIcon('LANDMARK') })]
    : BUILDING_ORDER.filter((type) => buildings.includes(type)).map((type) =>
        el('span', { class: 'build-icon', title: buildingLabel(type), text: buildingIcon(type) }),
      );

  return el('div', { class: 'city-summary' }, [
    el('div', { class: 'city-summary-head' }, [
      el('span', { class: 'city-summary-name', text: name }),
      el('span', { class: 'city-summary-kind', text: spaceKindLabel(kind ?? 'CITY') }),
    ]),
    ownerName ? el('p', { class: 'city-summary-owner', text: `소유: ${ownerName}` }) : null,
    el('div', { class: 'city-summary-builds' }, builtIcons.length > 0 ? builtIcons : [el('span', { class: 'city-summary-empty', text: '건물 없음' })]),
  ]);
}

/** 모달 하단 버튼 줄. */
export function actionRow(children) {
  return el('div', { class: 'modal-actions' }, children);
}

/**
 * 주 버튼.
 * @param {{busy?: boolean}} [opts.busy] 커맨드 응답을 기다리는 중이면 true(버튼을 잠그고 `aria-busy`를 켠다)
 */
export function primaryButton(label, { onClick, disabled = false, busy = false, focusKey = 'primary', tone = 'primary' }) {
  return button(
    {
      class: ['btn', `btn--${tone}`, 'btn--wide'],
      disabled: disabled || busy,
      'aria-busy': busy ? 'true' : undefined,
      dataset: { focusKey },
      on: { click: onClick },
    },
    label,
  );
}

/** 보조(포기) 버튼. `busy`는 primaryButton과 같은 뜻. */
export function quietButton(label, { onClick, disabled = false, busy = false, focusKey = 'quiet' }) {
  return button(
    {
      class: 'btn btn--quiet btn--wide',
      disabled: disabled || busy,
      'aria-busy': busy ? 'true' : undefined,
      dataset: { focusKey },
      on: { click: onClick },
    },
    label,
  );
}

/** 현금 부족 등 안내 문구. */
export function noticeLine(text, tone = 'warn') {
  return el('p', { class: ['modal-notice', `modal-notice--${tone}`], text });
}
