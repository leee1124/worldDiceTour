/**
 * 게임 종료 순위 모달. `view.rankings`(서버가 정한 순위)만 그린다.
 */

import { el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { gameOverReasonLabel } from '../../domain/labels.js';
import { actionRow, primaryButton, quietButton } from './parts.js';

export const GAME_OVER_MODAL_ID = 'game-over';

const MEDALS = ['🥇', '🥈', '🥉'];

export function gameOverModalSpec({ rankings, reason, slotOfSeat, onBackToRoom, onNewGame }) {
  return {
    id: GAME_OVER_MODAL_ID,
    title: '🏆 최종 순위',
    subtitle: reason ? gameOverReasonLabel(reason) : '',
    dismissible: true,
    variant: 'trophy',
    render: () =>
      el('div', { class: 'modal-stack' }, [
        el('ol', { class: 'ranking-list' }, (rankings ?? []).map((entry, order) => {
          const slot = slotOfSeat(entry.playerId);
          return el('li', { class: ['ranking-row', order === 0 ? 'ranking-row--champion' : null] }, [
            el('span', { class: 'ranking-medal', 'aria-hidden': 'true', text: MEDALS[order] ?? `${entry.rank}` }),
            el('span', {
              class: ['player-mark', `player-mark--${slot.color}`],
              dataset: { shape: slot.shape },
              'aria-hidden': 'true',
            }, [el('span', { class: 'player-mark-label', text: entry.name.slice(0, 1) })]),
            el('div', { class: 'ranking-main' }, [
              el('span', { class: 'ranking-name', text: entry.name }),
              el('span', {
                class: 'ranking-detail',
                text: `${entry.rank}위 · ${entry.eliminated ? '파산 탈락' : '생존'}`,
              }),
            ]),
            el('div', { class: 'ranking-assets' }, [
              el('span', { class: 'ranking-total', text: formatWon(entry.totalAssets) }),
              el('span', {
                class: 'ranking-breakdown',
                text: `현금 ${formatWon(entry.cash)}${entry.loanDebt > 0 ? ` · 채무 −${formatWon(entry.loanDebt)}` : ''}`,
              }),
            ]),
          ]);
        })),
        el('p', {
          class: 'modal-help',
          text: '총자산 = 현금 + 도시·휴양지 투자액 − 남은 대출 채무. 파산한 플레이어는 0원으로 계산합니다.',
        }),
        actionRow([
          primaryButton('새 게임 (홈으로)', { onClick: onNewGame, focusKey: 'new-game' }),
          quietButton('방 정보 보기', { onClick: onBackToRoom, focusKey: 'back-room' }),
        ]),
      ]),
  };
}
