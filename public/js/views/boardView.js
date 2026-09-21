/**
 * 정사각 보드(11×11 그리드 외곽 40칸). 칸·건물·말(토큰)을 그리고 한 칸씩 이동 연출을 한다.
 *
 * 칸 정보는 모두 서버 `view.board`에서 온다(클라이언트에 보드 데이터 사본을 두지 않는다).
 */

import { button, clear, el, setText, toggleClass } from '../dom.js';
import { formatCompactWon, formatWon } from '../format.js';
import { cellPosition, cornerOf, gridArea, groupOf, sideOf } from '../domain/boardLayout.js';
import { BUILDING_ORDER, buildingIcon, buildingLabel, spaceKindIcon, spaceKindLabel } from '../domain/labels.js';
import { slotOf } from '../store.js';
import { centerOf } from '../animation/effects.js';
import { DURATIONS, nextFrame, prefersReducedMotion, scaled, wait } from '../animation/timing.js';

/** 모서리 칸의 큰 장식(이모지 + 문구). 이미지 에셋 없이 CSS/이모지만 사용한다. */
const CORNER_ART = Object.freeze({
  START: { emoji: '🚩', caption: '출발', note: '월급 200,000원' },
  ISLAND: { emoji: '🏝', caption: '조난 섬', note: '최대 3턴' },
  CASINO: { emoji: '🎰', caption: '카지노', note: '최대 3판' },
  AIRPORT: { emoji: '✈️', caption: '공항', note: '다음 턴 이동' },
});

function nameSizeClass(name) {
  const length = String(name ?? '').length;
  if (length >= 9) {
    return 'cell-name--tiny';
  }
  if (length >= 6) {
    return 'cell-name--tight';
  }
  return null;
}

export function createBoardView({ onCellActivate }) {
  const boardNode = el('div', { class: 'board', role: 'grid', 'aria-label': '월드 다이스 투어 보드' });
  const emblem = el('div', { class: 'board-emblem', 'aria-hidden': 'true' }, [
    el('div', { class: 'emblem-ring' }, [
      el('span', { class: 'emblem-title', text: 'WORLD' }),
      el('span', { class: 'emblem-dice', text: '🎲' }),
      el('span', { class: 'emblem-title', text: 'DICE TOUR' }),
    ]),
    el('div', { class: 'emblem-compass' }, [
      el('span', { class: 'compass-n', text: 'N' }),
      el('span', { class: 'compass-needle' }),
    ]),
  ]);
  const stage = el('div', { class: 'board-stage' }, [boardNode]);

  /** @type {Map<number, {root: HTMLElement, band: HTMLElement, name: HTMLElement, hint: HTMLElement, builds: HTMLElement, tokens: HTMLElement}>} */
  const cells = new Map();
  /** @type {Map<string, HTMLElement>} */
  const tokens = new Map();
  let boardBuilt = false;
  let travelMode = { active: false, forbidden: [] };
  let selectedIndex = null;

  function buildCell(space) {
    const index = space.index;
    const corner = cornerOf(index);
    const group = groupOf(index);
    const band = el('span', { class: 'cell-band', 'aria-hidden': 'true' });
    const name = el('span', { class: ['cell-name', nameSizeClass(space.name)], text: space.name });
    const hint = el('span', { class: 'cell-hint' });
    const builds = el('span', { class: 'cell-builds', 'aria-hidden': 'true' });
    const tokenLayer = el('span', { class: 'cell-tokens' });

    const body = corner
      ? el('span', { class: 'cell-body cell-body--corner' }, [
          el('span', { class: 'corner-emoji', 'aria-hidden': 'true', text: CORNER_ART[corner].emoji }),
          el('span', { class: ['cell-name', 'cell-name--corner'], text: space.name }),
          el('span', { class: 'corner-note', text: CORNER_ART[corner].note }),
        ])
      : el('span', { class: 'cell-body' }, [
          el('span', { class: 'cell-kind', 'aria-hidden': 'true', text: spaceKindIcon(space.kind) }),
          name,
          hint,
          builds,
        ]);

    const root = button(
      {
        class: ['cell', `cell--${space.kind.toLowerCase()}`, corner ? 'cell--corner' : null],
        role: 'gridcell',
        dataset: { index: String(index), group: group ?? 'CORNER', side: sideOf(index) },
        style: { gridArea: gridArea(index) },
        on: { click: () => onCellActivate(index) },
      },
      [band, body, tokenLayer],
    );

    cells.set(index, { root, band, name, hint, builds, tokens: tokenLayer });
    return root;
  }

  function buildBoard(view) {
    clear(boardNode);
    cells.clear();
    boardNode.appendChild(emblem);
    for (const space of view.board) {
      boardNode.appendChild(buildCell(space));
    }
    boardBuilt = true;
  }

  function buildToken(state, player) {
    const slot = slotOf(state, player.seatId);
    const token = el(
      'span',
      {
        class: ['token', `token--${slot.color}`],
        dataset: { seat: player.seatId, shape: slot.shape },
        title: player.name,
      },
      [el('span', { class: 'token-label', text: player.name.slice(0, 1) })],
    );
    tokens.set(player.seatId, token);
    return token;
  }

  /** 칸 설명(스크린리더용). 서버 문자열만 조합한다. */
  function cellLabel(state, space) {
    const parts = [`${space.index}번`, space.name, spaceKindLabel(space.kind)];
    if (space.price) {
      parts.push(`매입가 ${formatWon(space.price)}`);
    }
    if (space.ownerId) {
      const ownerName = state.view.players.find((player) => player.seatId === space.ownerId)?.name ?? '다른 플레이어';
      parts.push(`소유 ${ownerName}`, `통행료 ${formatWon(space.toll)}`);
      if (space.landmark) {
        parts.push('랜드마크');
      } else if (space.buildings?.length) {
        parts.push(space.buildings.map((type) => buildingLabel(type)).join(' '));
      }
    } else if (space.price) {
      parts.push('주인 없음');
    }
    const standing = state.view.players
      .filter((player) => !player.eliminated && player.position === space.index)
      .map((player) => player.name);
    if (standing.length > 0) {
      parts.push(`${standing.join(', ')} 위치`);
    }
    return parts.join(', ');
  }

  function renderBuildings(node, space) {
    clear(node);
    if (space.landmark) {
      node.appendChild(el('span', { class: 'build-icon build-icon--landmark', text: buildingIcon('LANDMARK') }));
      return;
    }
    for (const type of BUILDING_ORDER) {
      if (space.buildings?.includes(type)) {
        node.appendChild(el('span', { class: ['build-icon', `build-icon--${type.toLowerCase()}`], text: buildingIcon(type) }));
      }
    }
  }

  function renderCell(state, space) {
    const cell = cells.get(space.index);
    if (!cell) {
      return;
    }
    const owned = Boolean(space.ownerId);
    const slot = owned ? slotOf(state, space.ownerId) : null;

    toggleClass(cell.root, 'cell--owned', owned);
    toggleClass(cell.root, 'cell--landmark', Boolean(space.landmark));
    cell.root.dataset.ownerSlot = slot ? slot.color : '';
    setText(cell.hint, owned ? `통행료 ${formatCompactWon(space.toll)}` : space.price ? formatCompactWon(space.price) : '');
    toggleClass(cell.hint, 'cell-hint--toll', owned);
    renderBuildings(cell.builds, space);
    cell.root.setAttribute('aria-label', cellLabel(state, space));

    const selectable = travelMode.active && !travelMode.forbidden.includes(space.index);
    toggleClass(cell.root, 'cell--selectable', selectable);
    toggleClass(cell.root, 'cell--forbidden', travelMode.active && !selectable);
    toggleClass(cell.root, 'cell--selected', selectedIndex === space.index);
  }

  function placeTokens(state) {
    const view = state.view;
    for (const cell of cells.values()) {
      clear(cell.tokens);
    }
    for (const player of view.players) {
      let token = tokens.get(player.seatId);
      if (!token) {
        token = buildToken(state, player);
      }
      toggleClass(token, 'token--eliminated', player.eliminated);
      toggleClass(token, 'token--turn', player.seatId === view.currentSeatId);
      toggleClass(token, 'token--island', player.islandRemainingTurns > 0);
      if (player.eliminated) {
        token.remove();
        continue;
      }
      cells.get(player.position)?.tokens.appendChild(token);
    }
  }

  return {
    element: stage,
    boardElement: boardNode,

    update(state) {
      if (!state.view) {
        return;
      }
      if (!boardBuilt) {
        buildBoard(state.view);
      }
      for (const space of state.view.board) {
        renderCell(state, space);
      }
      placeTokens(state);
    },

    /** 공항 목적지 선택 모드(선택 가능 칸 하이라이트). */
    setTravelMode({ active, forbidden = [] }) {
      travelMode = { active, forbidden };
      toggleClass(stage, 'board-stage--picking', active);
    },

    setSelected(index) {
      selectedIndex = index;
      for (const [cellIndex, cell] of cells.entries()) {
        toggleClass(cell.root, 'cell--selected', cellIndex === index);
      }
    },

    /** 말을 목표 칸으로 옮긴다. FLIP 방식으로 한 칸 이동을 보여 준다. */
    async moveToken(seatId, index, { animate = true } = {}) {
      const token = tokens.get(seatId);
      const cell = cells.get(index);
      if (!token || !cell) {
        return;
      }
      if (!animate || prefersReducedMotion()) {
        cell.tokens.appendChild(token);
        return;
      }
      const before = token.getBoundingClientRect();
      cell.tokens.appendChild(token);
      const after = token.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (dx === 0 && dy === 0) {
        return;
      }
      token.style.transition = 'none';
      token.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      await nextFrame();
      token.style.transition = `transform ${DURATIONS.hop}ms cubic-bezier(0.3, 1.4, 0.5, 1)`;
      token.style.transform = 'translate3d(0, 0, 0)';
      token.classList.add('token--hopping');
      await wait(DURATIONS.hop);
      token.classList.remove('token--hopping');
      token.style.transition = '';
      token.style.transform = '';
    },

    /** 순간이동(조난 이송 등): 사라지고 나타난다. */
    async teleportToken(seatId, index) {
      const token = tokens.get(seatId);
      if (!token) {
        return;
      }
      token.classList.add('token--vanish');
      await wait(scaled(DURATIONS.teleport / 2));
      cells.get(index)?.tokens.appendChild(token);
      token.classList.remove('token--vanish');
      token.classList.add('token--appear');
      await wait(scaled(DURATIONS.teleport / 2));
      token.classList.remove('token--appear');
    },

    async flashCell(index) {
      const cell = cells.get(index);
      if (!cell) {
        return;
      }
      cell.root.classList.add('cell--landing');
      await wait(scaled(DURATIONS.flash));
      cell.root.classList.remove('cell--landing');
    },

    /** 칸/말의 화면 좌표(동전 연출 시작·도착점). */
    cellCenter(index) {
      return centerOf(cells.get(index)?.root ?? null);
    },

    tokenCenter(seatId) {
      return centerOf(tokens.get(seatId) ?? null);
    },

    /** 칸 버튼에 포커스를 준다(키보드로 목적지를 고를 때). */
    focusCell(index) {
      cells.get(index)?.root.focus();
    },

    /** 그리드 좌표(디버깅·툴팁용). */
    positionOf(index) {
      return cellPosition(index);
    },
  };
}
