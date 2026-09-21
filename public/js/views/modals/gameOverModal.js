/**
 * 게임 종료 순위 모달. `view.rankings`(서버가 정한 순위)만 그린다.
 */

import { el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { gameOverReasonLabel } from '../../domain/labels.js';
import { netWorthRows } from '../../domain/marketModel.js';
import { actionRow, primaryButton, quietButton } from './parts.js';

export const GAME_OVER_MODAL_ID = 'game-over';

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * 총자산 내역 한 줄. `rankings`에는 내역이 없으므로(현금·채무만) `view.players`의
 * `netWorth`를 찾아 쓴다. 투자 모드가 꺼진 방에는 그 필드가 없어 현금·채무만 남는다.
 */
function breakdownText(entry, player) {
  const rows = netWorthRows(player);
  if (rows.length > 1) {
    return rows
      .filter((row) => row.amount !== 0)
      .map((row) => `${row.label} ${formatWon(row.amount)}`)
      .join(' · ');
  }
  return `현금 ${formatWon(entry.cash)}${entry.loanDebt > 0 ? ` · 채무 −${formatWon(entry.loanDebt)}` : ''}`;
}

/**
 * @param {object} input
 * @param {(seatId: string) => object|null} [input.playerOfSeat] 총자산 내역을 찾을 플레이어 조회
 * @param {boolean} [input.withMarket] 투자 모드가 켜진 판인지(설명 문구가 달라진다)
 */
export function gameOverModalSpec({
  rankings,
  reason,
  slotOfSeat,
  playerOfSeat = () => null,
  withMarket = false,
  onBackToRoom,
  onNewGame,
}) {
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
                text: breakdownText(entry, playerOfSeat(entry.playerId)),
              }),
            ]),
          ]);
        })),
        el('p', {
          class: 'modal-help',
          text: withMarket
            ? '총자산 = 현금 + 도시·휴양지 투자액 + 주식 평가액 + 예금 − 남은 대출 채무. 파산한 플레이어는 0원으로 계산합니다.'
            : '총자산 = 현금 + 도시·휴양지 투자액 − 남은 대출 채무. 파산한 플레이어는 0원으로 계산합니다.',
        }),
        actionRow([
          primaryButton('새 게임 (홈으로)', { onClick: onNewGame, focusKey: 'new-game' }),
          quietButton('방 정보 보기', { onClick: onBackToRoom, focusKey: 'back-room' }),
        ]),
      ]),
  };
}
