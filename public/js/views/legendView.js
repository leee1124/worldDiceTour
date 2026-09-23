/**
 * 보드 범례(凡例). 칸 위의 배지와 색이 무엇을 뜻하는지 알려 준다.
 *
 * 폰에서는 접어 두고(`<details>`) 필요할 때만 펼친다 — 보드가 이미 좁기 때문이다.
 */

import { el, clear } from '../dom.js';
import { BUILDING_ORDER, buildingLabel } from '../domain/labels.js';
import { buildingShortLabel } from '../domain/buildingSlots.js';
import { starIcon } from './icons.js';
import { slotOf } from '../store.js';

function buildingLegendItem(type) {
  return el('span', { class: 'legend-item' }, [
    el('span', {
      class: ['build-slot', `build-slot--${type.toLowerCase()}`, 'build-slot--on'],
      'aria-hidden': 'true',
    }, [el('span', { class: 'build-slot-text', text: buildingShortLabel(type) })]),
    el('span', { class: 'legend-text', text: buildingLabel(type) }),
  ]);
}

export function createLegendView() {
  const ownersNode = el('div', { class: 'legend-row legend-row--owners' });
  const element = el('details', { class: 'legend' }, [
    el('summary', { class: 'legend-summary' }, [
      el('span', { text: '범례' }),
      el('span', { class: 'legend-hint', text: '칸 표시 읽는 법' }),
    ]),
    el('div', { class: 'legend-body' }, [
      el('div', { class: 'legend-row' }, [
        ...BUILDING_ORDER.map((type) => buildingLegendItem(type)),
        el('span', { class: 'legend-item' }, [
          el('span', { class: ['build-slot', 'build-slot--off'], 'aria-hidden': 'true' }),
          el('span', { class: 'legend-text', text: '아직 안 지음' }),
        ]),
        el('span', { class: 'legend-item' }, [
          el('span', { class: 'build-landmark', 'aria-hidden': 'true' }, [
            el('span', { class: 'build-landmark-star' }, [starIcon()]),
          ]),
          el('span', { class: 'legend-text', text: '관광명소(통행료 최대)' }),
        ]),
      ]),
      ownersNode,
      el('p', { class: 'legend-note', text: '칸 위 띠와 옅은 색은 소유자 색입니다. 칸을 누르면 통행료·매입가·건물 상태를 모두 볼 수 있습니다.' }),
    ]),
  ]);

  return {
    element,

    update(state) {
      const players = state.view?.players ?? [];
      clear(ownersNode);
      for (const player of players) {
        const slot = slotOf(state, player.seatId);
        ownersNode.appendChild(
          el('span', { class: 'legend-item' }, [
            el('span', {
              class: ['legend-owner', `legend-owner--${slot.color}`],
              dataset: { shape: slot.shape },
              'aria-hidden': 'true',
            }),
            el('span', { class: 'legend-text', text: `${player.name} (${slot.shapeLabel})` }),
          ]),
        );
      }
    },
  };
}
