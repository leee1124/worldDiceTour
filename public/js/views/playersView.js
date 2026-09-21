/**
 * 플레이어 패널: 색·모양 · 이름 · 현금(증감 카운트) · 총자산 · 상태 배지 · 현재 차례 강조.
 * 호스트 도구(오프라인 좌석 자동 진행 전환)와 자기 좌석의 "직접 플레이로 복귀"도 여기서 제공한다.
 */

import { button, clear, el, setText, toggleClass } from '../dom.js';
import { formatWon } from '../format.js';
import { lapLabel } from '../domain/buildRules.js';
import { countTo } from '../animation/timing.js';
import { centerOf } from '../animation/effects.js';
import { isHostSeatMine, isMySeat, slotOf } from '../store.js';

function badge(text, tone) {
  return el('span', { class: ['badge', `badge--${tone}`], text });
}

export function createPlayersView({ onSetAutopilot }) {
  const listNode = el('div', { class: 'player-list' });
  const element = el('section', { class: 'panel panel--players' }, [
    el('h2', { class: 'panel-title' }, ['👥 플레이어']),
    listNode,
  ]);

  /** @type {Map<string, {root: HTMLElement, cash: HTMLElement, assets: HTMLElement, badges: HTMLElement, tools: HTMLElement, holdings: HTMLElement}>} */
  const cards = new Map();
  /** @type {Map<string, number>} */
  const lastCash = new Map();
  let renderedSeatIds = '';

  function buildCard(state, player) {
    const slot = slotOf(state, player.seatId);
    const cash = el('span', { class: 'player-cash' });
    const assets = el('span', { class: 'player-assets' });
    const holdings = el('span', { class: 'player-holdings' });
    const badges = el('div', { class: 'badge-row' });
    const tools = el('div', { class: 'player-tools' });

    const root = el('article', { class: 'player-card', dataset: { seat: player.seatId, slot: slot.color } }, [
      el('div', { class: 'player-head' }, [
        el('span', {
          class: ['player-mark', `player-mark--${slot.color}`],
          dataset: { shape: slot.shape },
          role: 'img',
          'aria-label': `${slot.shapeLabel} 모양 말`,
        }, [el('span', { class: 'player-mark-label', text: player.name.slice(0, 1) })]),
        el('div', { class: 'player-identity' }, [
          el('span', { class: 'player-name', text: player.name }),
          holdings,
        ]),
      ]),
      el('div', { class: 'player-money' }, [
        el('span', { class: 'player-money-label', text: '현금' }),
        cash,
        el('span', { class: 'player-money-label', text: '총자산' }),
        assets,
      ]),
      badges,
      tools,
    ]);

    cards.set(player.seatId, { root, cash, assets, badges, tools, holdings });
    return root;
  }

  function renderBadges(node, state, player, seat) {
    clear(node);
    // 지을 수 있는 건물이 바퀴 수로 정해지므로(1바퀴 별장 / 2바퀴 빌딩 / 3바퀴 호텔) 함께 보여 준다.
    // 탈락한 좌석에는 더 이상 의미가 없어 달지 않는다.
    if (player.eliminated) {
      node.appendChild(badge('💀 파산', 'danger'));
    } else {
      node.appendChild(badge(`🔄 ${lapLabel(player.lap)}`, 'muted'));
    }
    if (isMySeat(state, player.seatId)) {
      node.appendChild(badge('이 기기', 'mine'));
    }
    if (seat?.kind === 'COMPUTER') {
      node.appendChild(badge('🤖 컴퓨터', 'muted'));
    }
    if (seat?.autopilot) {
      node.appendChild(badge('자동 진행', 'warn'));
    }
    if (seat && !seat.online && seat.kind === 'HUMAN') {
      node.appendChild(badge('오프라인', 'muted'));
    }
    if (player.islandRemainingTurns > 0) {
      node.appendChild(badge(`🏝 조난 ${player.islandRemainingTurns}턴`, 'danger'));
    }
    if (player.airportPending) {
      node.appendChild(badge('✈️ 이동권', 'info'));
    }
    if (player.loanDebt > 0) {
      node.appendChild(badge(`대출 중 · 채무 ${formatWon(player.loanDebt)}`, 'warn'));
    } else if (player.loanUsed) {
      node.appendChild(badge('대출 완납', 'muted'));
    }
  }

  function renderTools(node, state, player, seat) {
    clear(node);
    if (!seat || seat.kind === 'COMPUTER' || state.view?.isOver) {
      return;
    }
    const mine = isMySeat(state, player.seatId);

    // 자기 좌석이 자동 진행 중이면(재접속 직후) 직접 플레이로 돌아올 수 있다.
    if (mine && seat.autopilot) {
      node.appendChild(
        button(
          {
            class: 'btn btn--primary btn--small',
            on: { click: () => onSetAutopilot(seat.id, false) },
          },
          '▶ 직접 플레이로 복귀',
        ),
      );
      return;
    }
    if (!isHostSeatMine(state) || mine) {
      return;
    }
    if (seat.autopilot) {
      node.appendChild(
        button({ class: 'btn btn--quiet btn--small', on: { click: () => onSetAutopilot(seat.id, false) } }, '자동 진행 끄기'),
      );
      return;
    }
    if (!seat.online) {
      node.appendChild(
        button({ class: 'btn btn--quiet btn--small', on: { click: () => onSetAutopilot(seat.id, true) } }, '자동 진행 맡기기'),
      );
    }
  }

  return {
    element,

    update(state) {
      const view = state.view;
      if (!view) {
        return;
      }
      const seatKey = view.players.map((player) => player.seatId).join('|');
      if (seatKey !== renderedSeatIds) {
        clear(listNode);
        cards.clear();
        for (const player of view.players) {
          listNode.appendChild(buildCard(state, player));
        }
        renderedSeatIds = seatKey;
      }

      for (const player of view.players) {
        const card = cards.get(player.seatId);
        if (!card) {
          continue;
        }
        const seat = state.room?.seats.find((item) => item.id === player.seatId) ?? null;

        const previous = lastCash.get(player.seatId);
        lastCash.set(player.seatId, player.cash);
        if (previous === undefined) {
          setText(card.cash, formatWon(player.cash));
        } else if (previous !== player.cash) {
          card.cash.classList.add(player.cash > previous ? 'player-cash--up' : 'player-cash--down');
          window.setTimeout(() => card.cash.classList.remove('player-cash--up', 'player-cash--down'), 700);
          countTo({ from: previous, to: player.cash, onStep: (value) => setText(card.cash, formatWon(value)) });
        }

        setText(card.assets, formatWon(player.totalAssets));
        setText(card.holdings, `도시 ${player.cityCount} · 휴양지 ${player.resortCount}`);
        renderBadges(card.badges, state, player, seat);
        renderTools(card.tools, state, player, seat);
        toggleClass(card.root, 'player-card--turn', player.seatId === view.currentSeatId && !view.isOver);
        toggleClass(card.root, 'player-card--mine', isMySeat(state, player.seatId));
        toggleClass(card.root, 'player-card--out', player.eliminated);
      }
    },

    /** 현금 카드 좌표(동전 연출 도착점). */
    cardCenter(seatId) {
      return centerOf(cards.get(seatId)?.cash ?? null);
    },

    /** 카드를 짧게 강조한다. */
    pulse(seatId) {
      const card = cards.get(seatId);
      if (!card) {
        return;
      }
      card.root.classList.add('player-card--pulse');
      window.setTimeout(() => card.root.classList.remove('player-card--pulse'), 600);
    },
  };
}
