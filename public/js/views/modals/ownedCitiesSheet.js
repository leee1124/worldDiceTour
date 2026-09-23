/**
 * "○○의 도시" 시트. 플레이어 카드의 돋보기 버튼을 누르면 열린다.
 *
 * 오너 요청: 돋보기는 상대방 **말의 위치**가 아니라 상대방이 **가진 도시**를 찾는 도구다.
 * 그래서 이 시트는 소유 목록(이름 · 건물 배지 · 현재 통행료)과 합계를 보여 주고,
 * 말의 위치는 **보조 줄**("현재 위치: …")로만 남긴다.
 *
 * 한 줄을 누르면 그 칸이 보드에서 반짝이고(폰에서는 그 칸으로 스크롤한다), 시트는 열린 채로 남는다
 * — 여러 칸을 차례로 확인하는 것이 이 화면의 목적이기 때문이다.
 */

import { button, el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { landmarkBadge } from '../icons.js';
import { quietButton } from './parts.js';

export const OWNED_CITIES_SHEET_ID = 'owned-cities';

/** 목록 한 줄의 건물 배지(보드 칸·모달과 같은 배지 언어). */
function buildBadges(item) {
  if (item.landmark) {
    return landmarkBadge();
  }
  if (item.slots.length === 0) {
    return el('span', { class: 'owned-row-kind', text: item.kindLabel });
  }
  return el(
    'span',
    { class: 'owned-row-builds' },
    item.slots.map((slot) =>
      el(
        'span',
        {
          class: ['build-slot', `build-slot--${slot.type.toLowerCase()}`, slot.built ? 'build-slot--on' : 'build-slot--off'],
          title: `${slot.label} ${slot.built ? '지음' : '아직 안 지음'}`,
        },
        [el('span', { class: 'build-slot-text', text: slot.short })],
      ),
    ),
  );
}

function ownedRow(item, onFocusCell) {
  return button(
    {
      class: 'owned-row',
      // 버튼 이름에 "무엇을 하는지"까지 담는다(목록만으로는 이름·금액만 읽힌다).
      'aria-label': `${item.name} · ${item.buildingText} · 통행료 ${formatWon(item.toll)} — 보드에서 이 칸 보기`,
      on: { click: () => onFocusCell(item.index) },
    },
    [
      el('span', { class: 'owned-row-main' }, [
        el('span', { class: 'owned-row-name', text: item.name }),
        buildBadges(item),
      ]),
      el('span', { class: 'owned-row-side' }, [
        el('span', { class: 'owned-row-toll', text: formatWon(item.toll) }),
        el('span', { class: 'owned-row-tolllabel', text: '통행료' }),
      ]),
    ],
  );
}

/**
 * @param {{
 *   holdings: object, positionLabel: string, slotColor?: string|null,
 *   highlightSeconds?: number, onFocusCell: (index: number) => void, onClose: () => void,
 * }} options `holdings`는 `domain/ownedCities.js`가 만든 뷰모델
 */
export function ownedCitiesSheetSpec({
  holdings,
  positionLabel,
  slotColor = null,
  highlightSeconds = 4,
  onFocusCell,
  onClose,
}) {
  return {
    id: OWNED_CITIES_SHEET_ID,
    title: `${holdings.ownerName ?? '플레이어'}의 도시`,
    subtitle: holdings.empty
      ? '아직 가진 도시가 없습니다.'
      : `${holdings.count}곳 · 통행료 합계 ${formatWon(holdings.totalToll)}`,
    dismissible: true,
    variant: 'sheet',
    render: () =>
      el('div', { class: 'modal-stack modal-stack--owned' }, [
        el('p', { class: 'owned-position', text: positionLabel }),
        holdings.empty
          ? el('p', { class: 'owned-empty', text: '가진 도시가 없습니다. 도시를 매입하면 여기에 모입니다.' })
          : el('p', {
              class: 'owned-help',
              text: `보드에서 ${highlightSeconds}초 동안 강조됩니다. 한 줄을 누르면 그 칸을 다시 비춥니다.`,
            }),
        holdings.empty
          ? null
          : el(
              'div',
              { class: ['owned-list', slotColor ? `owned-list--${slotColor}` : null], role: 'list' },
              holdings.items.map((item) => ownedRow(item, onFocusCell)),
            ),
        holdings.empty
          ? null
          : el('div', { class: 'owned-total' }, [
              el('span', { class: 'owned-total-label', text: '통행료 총력' }),
              el('span', { class: 'owned-total-value', text: formatWon(holdings.totalToll) }),
            ]),
        // 정보 시트에도 눈에 보이는 닫기 수단을 둔다(머리의 닫기 버튼만으로는 폰에서 놓치기 쉽다).
        el('div', { class: 'modal-actions' }, [
          quietButton('닫기', { onClick: onClose, focusKey: 'owned-close' }),
        ]),
      ]),
  };
}
