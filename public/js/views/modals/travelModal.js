/**
 * 공항 목적지 확인 시트(`AWAIT_TRAVEL`).
 *
 * 목적지는 보드 칸을 직접 눌러 고르고, 이 시트는 마지막 확인만 받는다.
 * 선택 가능한 칸은 **서버가 준 `pending.forbiddenIndexes`** 로만 판단한다.
 */

import { el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { spaceKindLabel } from '../../domain/labels.js';
import { actionRow, infoRow, moneyRow, primaryButton, quietButton } from './parts.js';

export const TRAVEL_MODAL_ID = 'travel-confirm';

export function travelConfirmSpec({ space, ownerName, locked = false, onConfirm, onCancel }) {
  const ownable = space.price !== undefined && space.price !== null;

  return {
    id: TRAVEL_MODAL_ID,
    title: '✈️ 이 칸으로 이동할까요?',
    subtitle: '앞 방향으로 이동하므로 출발 칸을 지나면 월급을 받습니다.',
    dismissible: true,
    render: () =>
      el('div', { class: 'modal-stack' }, [
        el('div', { class: 'travel-target' }, [
          el('span', { class: 'travel-index', text: `${space.index}번` }),
          el('span', { class: 'travel-name', text: space.name }),
          el('span', { class: 'travel-kind', text: spaceKindLabel(space.kind) }),
        ]),
        ownable ? moneyRow('매입가', space.price) : null,
        space.ownerId ? infoRow('소유자', ownerName ?? '다른 플레이어') : null,
        space.ownerId ? moneyRow('통행료', space.toll, { tone: 'out' }) : null,
        !space.ownerId && ownable ? el('p', { class: 'modal-help', text: '주인이 없는 칸입니다. 도착하면 매입할 수 있습니다.' }) : null,
        space.ownerId ? el('p', { class: 'modal-help', text: `도착하면 통행료 ${formatWon(space.toll)}을 냅니다.` }) : null,
        actionRow([
          primaryButton('이 칸으로 이동', { onClick: onConfirm, busy: locked, focusKey: 'travel-confirm' }),
          quietButton('다시 고르기', { onClick: onCancel, focusKey: 'travel-cancel' }),
        ]),
      ]),
  };
}
