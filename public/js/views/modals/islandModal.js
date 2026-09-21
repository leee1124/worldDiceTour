/**
 * 조난 섬 선택 모달(`AWAIT_ISLAND_CHOICE`). pending: `{remainingTurns, fee, canPayFee}`
 */

import { el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { actionRow, infoRow, moneyRow, noticeLine, primaryButton, quietButton } from './parts.js';

export const ISLAND_MODAL_ID = 'island';

export function islandModalSpec({ pending, cash, locked = false, onPay, onRoll }) {
  return {
    id: ISLAND_MODAL_ID,
    title: '🏝 조난 섬',
    subtitle: '구조비를 내고 정상 진행하거나, 더블을 노려 탈출합니다.',
    dismissible: false,
    render: () =>
      el('div', { class: 'modal-stack modal-stack--island' }, [
        el('div', { class: 'island-art', 'aria-hidden': 'true' }, [
          el('span', { class: 'island-wave' }),
          el('span', { class: 'island-palm', text: '🏝' }),
        ]),
        infoRow('남은 조난 턴', `${pending.remainingTurns}턴`),
        moneyRow('구조비', pending.fee, { tone: 'out' }),
        moneyRow('보유 현금', cash),
        el('ul', { class: 'bullet-list' }, [
          el('li', { text: '구조비를 내면 같은 턴에 바로 주사위를 굴립니다.' }),
          el('li', { text: '굴려서 더블이 나오면 그 눈만큼 이동합니다(추가 턴 없음).' }),
          el('li', { text: '실패하면 남은 조난 턴이 하나 줄고 턴이 끝납니다.' }),
          el('li', { text: '조난 중에도 내 도시의 통행료는 계속 받습니다.' }),
        ]),
        pending.canPayFee ? null : noticeLine(`구조비를 내려면 ${formatWon(pending.fee - cash)}이 더 필요합니다.`),
        actionRow([
          primaryButton(`구조비 ${formatWon(pending.fee)} 지불`, {
            onClick: onPay,
            disabled: !pending.canPayFee,
            busy: locked,
            focusKey: 'island-pay',
          }),
          quietButton('🎲 주사위로 탈출 시도', { onClick: onRoll, busy: locked, focusKey: 'island-roll' }),
        ]),
      ]),
  };
}
