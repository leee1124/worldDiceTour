/**
 * 칸 상세 시트. 보드의 아무 칸이나 누르면 열린다(관전 중에도 볼 수 있다).
 */

import { el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { BUILDING_ORDER, buildingIcon, buildingLabel, spaceKindIcon, spaceKindLabel } from '../../domain/labels.js';
import { CELL_GROUPS, cornerOf, groupOf } from '../../domain/boardLayout.js';
import { citySummary, infoRow, moneyRow } from './parts.js';

export const CELL_SHEET_ID = 'cell-sheet';

/** 종류별 규칙 안내(모두 고정 문구). */
const KIND_NOTES = Object.freeze({
  START: '정확히 도착하면 월급과 별개로 내 도시 한 곳에 건설 기회를 받습니다.',
  TICKET: '행운 티켓 한 장을 뽑아 즉시 효과를 받습니다.',
  TAX: '보유 현금의 10%를 납부하고, 그 금액은 카지노 잭팟에 쌓입니다.',
  ISLAND: '최대 3턴 동안 조난됩니다. 구조비 200,000원 또는 더블로 탈출합니다.',
  CASINO: '한 방문에 최대 3판. 베팅은 10,000원 단위로 최대 500,000원까지.',
  AIRPORT: '다음 자기 턴에 주사위 대신 원하는 칸으로 이동합니다(공항 칸 제외).',
  RESORT: '건설은 할 수 없고, 통행료는 50,000원 × 소유자가 가진 휴양지 수입니다.',
});

export function cellSheetSpec({ space, ownerName, buildingCosts, onClose }) {
  const corner = cornerOf(space.index);
  const group = groupOf(space.index);
  const groupLabel = group ? CELL_GROUPS[group]?.label : null;
  const ownable = space.price !== undefined && space.price !== null;
  const isCity = space.kind === 'CITY';

  const remaining = isCity && !space.landmark
    ? BUILDING_ORDER.filter((type) => !(space.buildings ?? []).includes(type))
    : [];

  return {
    id: CELL_SHEET_ID,
    title: space.name,
    subtitle: `${space.index}번 · ${spaceKindLabel(space.kind)}${groupLabel ? ` · ${groupLabel}` : ''}`,
    dismissible: true,
    variant: 'sheet',
    render: () =>
      el('div', { class: 'modal-stack' }, [
        el('div', { class: 'sheet-hero' }, [
          el('span', { class: 'sheet-emoji', 'aria-hidden': 'true', text: spaceKindIcon(space.kind) }),
          groupLabel ? el('span', { class: ['sheet-group', `sheet-group--${group}`], text: groupLabel }) : null,
        ]),
        ownable
          ? citySummary({
              name: space.name,
              kind: space.kind,
              buildings: space.buildings ?? [],
              landmark: Boolean(space.landmark),
              ownerName: space.ownerId ? ownerName : null,
            })
          : null,
        ownable ? moneyRow('매입가', space.price) : null,
        space.ownerId ? moneyRow('현재 통행료', space.toll, { tone: 'gold' }) : null,
        space.ownerId ? moneyRow('투자액', space.invested, { note: '매각 환급 = 50%' }) : null,
        space.ownerId
          ? moneyRow('매각 환급', Math.floor((space.invested ?? 0) * 0.5), { tone: 'in' })
          : null,
        space.acquisitionPrice !== null && space.acquisitionPrice !== undefined
          ? moneyRow('인수 가격', space.acquisitionPrice, { note: '투자액 × 2 · 현금만' })
          : ownable && space.ownerId
            ? infoRow('인수', space.landmark ? '랜드마크는 인수 불가' : '휴양지는 인수 불가')
            : null,
        ownable && !space.ownerId ? infoRow('소유', '주인 없음') : null,
        remaining.length > 0
          ? el('div', { class: 'sheet-remaining' }, [
              el('p', { class: 'effect-title', text: '지을 수 있는 건물' }),
              el('div', { class: 'check-list check-list--static' }, remaining.map((type) =>
                el('div', { class: 'check-row check-row--static' }, [
                  el('span', { class: 'check-icon', 'aria-hidden': 'true', text: buildingIcon(type) }),
                  el('span', { class: 'check-label', text: buildingLabel(type) }),
                  el('span', { class: 'check-cost', text: formatWon(buildingCosts?.[type] ?? 0) }),
                ]),
              )),
            ])
          : null,
        isCity && space.buildings?.length === 3 && !space.landmark
          ? el('p', { class: 'modal-help', text: '3종을 모두 갖췄습니다. 다음 건설 기회에 랜드마크로 업그레이드할 수 있습니다.' })
          : null,
        corner || KIND_NOTES[space.kind]
          ? el('p', { class: 'modal-help', text: KIND_NOTES[space.kind] ?? '' })
          : null,
        infoRow('저당', '이 게임에는 저당 규칙이 없습니다'),
        el('div', { class: 'modal-actions' }, [
          el('button', {
            class: 'btn btn--quiet btn--wide',
            type: 'button',
            dataset: { focusKey: 'sheet-close' },
            on: { click: onClose },
            text: '닫기',
          }),
        ]),
      ]),
  };
}
