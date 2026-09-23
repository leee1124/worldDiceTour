/**
 * 정사각 보드(11×11 그리드 외곽 40칸). 칸·건물·말(토큰)을 그리고 한 칸씩 이동 연출을 한다.
 *
 * 칸 정보는 모두 서버 `view.board`에서 온다(클라이언트에 보드 데이터 사본을 두지 않는다).
 *
 * **말은 칸 안에 넣지 않는다.** 폰에서 칸은 35px 남짓이라 칸 안에 말을 넣으면 이름·통행료에
 * 밀려 잘려 나가고, `overflow: hidden`에 먹혀 아예 보이지 않았다. 그래서 보드와 **똑같은
 * 11×11 격자**를 가진 오버레이 층(`.board-tokens`)을 보드 위에 깔고, 말은 그 층의
 * 같은 grid-area에 놓는다 — 칸보다 커도 잘리지 않고, 칸 글자를 덮지도 않는다.
 * 격자 수치를 복제하지 않고 같은 grid 설정을 쓰기 때문에 어떤 화면 폭에서도 자동으로 맞는다.
 */

import { button, clear, el, setText, toggleClass } from '../dom.js';
import { formatCompactWon, formatWon } from '../format.js';
import { cornerOf, gridArea, groupOf, sideOf } from '../domain/boardLayout.js';
import { boardCellShortName, buildingLabel, spaceKindLabel } from '../domain/labels.js';
import { buildingSlotView } from '../domain/buildingSlots.js';
import { MOVE_TIMING } from '../domain/movePlan.js';
import { fanOutTokens } from '../domain/tokenLayout.js';
import { isMySeat, slotOf } from '../store.js';
import { centerOf } from '../animation/effects.js';
import { DURATIONS, nextFrame, prefersReducedMotion, scaled, wait } from '../animation/timing.js';
import { diceIcon, landmarkBadge, spaceKindIcon } from './icons.js';

/** 모서리 칸의 큰 장식(SVG 글리프 + 문구). 이미지 에셋 없이 인라인 SVG만 쓴다. */
const CORNER_ART = Object.freeze({
  START: { caption: '출발', note: '월급 200,000원' },
  ISLAND: { caption: '조난 섬', note: '최대 3턴' },
  CASINO: { caption: '카지노', note: '최대 3판' },
  AIRPORT: { caption: '공항', note: '다음 턴 이동' },
});

/** 도착한 칸을 비추는 시간. */
const SPOTLIGHT_MS = 1200;
/** 플레이어 카드를 눌러 말을 찾을 때 강조하는 시간. */
const FIND_MS = 2000;
/** 돋보기 버튼으로 한 좌석의 도시를 모두 강조하는 시간. */
export const OWNED_HIGHLIGHT_MS = 4000;

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
  // 말 전용 오버레이. 보드와 같은 11×11 격자라 grid-area만 맞추면 칸 위에 정확히 겹친다.
  // 읽어 주는 정보는 칸의 aria-label과 플레이어 카드가 이미 담고 있으므로 여기서는 숨긴다.
  const tokenLayer = el('div', { class: 'board-tokens', 'aria-hidden': 'true' });
  const emblem = el('div', { class: 'board-emblem', 'aria-hidden': 'true' }, [
    el('div', { class: 'emblem-ring' }, [
      el('span', { class: 'emblem-title', text: 'WORLD' }),
      el('span', { class: 'emblem-dice' }, [diceIcon()]),
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
  /** 강조 타이머(중복 실행 시 이전 것을 취소한다). */
  const highlightTimers = new Map();
  /** 지금 이동 연출이 재생 중인 좌석. 렌더가 이 말을 끌어다 놓지 못하게 막는다. */
  const movingSeats = new Set();
  let boardBuilt = false;
  let travelMode = { active: false, forbidden: [], locked: false };
  let selectedIndex = null;
  /** 소유 도시 강조 상태(칸 번호 + 해제 타이머). */
  let ownedFocus = { indexes: [], timer: null };

  function buildCell(space) {
    const index = space.index;
    const corner = cornerOf(index);
    const group = groupOf(index);
    // 칸 안에는 축약 이름만 쓴다(시트·모달·로그·aria-label은 원래 이름을 그대로 쓴다).
    const shortName = boardCellShortName(space.name);
    const band = el('span', { class: 'cell-band', 'aria-hidden': 'true' });
    const name = el('span', { class: ['cell-name', nameSizeClass(shortName)], text: shortName });
    const hint = el('span', { class: 'cell-hint' });
    const builds = el('span', { class: 'cell-builds', 'aria-hidden': 'true' });

    const body = corner
      ? el('span', { class: 'cell-body cell-body--corner' }, [
          el('span', { class: 'corner-icon', 'aria-hidden': 'true' }, [spaceKindIcon(corner)]),
          el('span', { class: ['cell-name', 'cell-name--corner'], text: shortName }),
          el('span', { class: 'corner-note', text: CORNER_ART[corner].note }),
        ])
      : el('span', { class: 'cell-body' }, [
          el('span', { class: 'cell-kind', 'aria-hidden': 'true' }, [spaceKindIcon(space.kind)]),
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
      [band, body],
    );

    // 이 칸의 말이 놓일 오버레이 자리(같은 grid-area).
    const slot = el('div', {
      class: 'token-slot',
      dataset: { index: String(index) },
      style: { gridArea: gridArea(index) },
    });
    tokenLayer.appendChild(slot);

    cells.set(index, { root, band, name, hint, builds, tokens: slot });
    return root;
  }

  function buildBoard(view) {
    clear(boardNode);
    clear(tokenLayer);
    cells.clear();
    boardNode.appendChild(emblem);
    for (const space of view.board) {
      boardNode.appendChild(buildCell(space));
    }
    boardNode.appendChild(tokenLayer);
    boardBuilt = true;
  }

  function buildToken(state, player) {
    const slot = slotOf(state, player.seatId);
    // 바깥 `.token`은 위치·이동(FLIP의 transform) 전용이고, 안쪽 `.token-bob`이 통통 튄다.
    // (둘을 한 요소에 두면 CSS 애니메이션이 인라인 transform을 덮어써 이동 연출이 깨진다.)
    const token = el(
      'span',
      {
        class: ['token', `token--${slot.color}`],
        dataset: { seat: player.seatId, shape: slot.shape },
        title: player.name,
      },
      [
        el('span', { class: 'token-bob' }, [
          el('span', { class: 'token-body' }),
          el('span', { class: 'token-label', text: player.name.slice(0, 1) }),
          el('span', { class: 'token-mine', text: '나' }),
        ]),
      ],
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
        parts.push('관광명소');
      } else {
        const view = buildingSlotView(space);
        const built = view.slots.filter((item) => item.built);
        parts.push(built.length > 0 ? built.map((item) => buildingLabel(item.type)).join(' ') : '건물 없음');
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

  /**
   * 건물 배지. 별장·빌딩·호텔 세 자리를 **늘 그려 두고** 지은 것만 채운다.
   * 좁은 폭에서는 CSS가 글자를 접고 점 세 개로 줄인다(구조는 그대로라 아무것도 사라지지 않는다).
   */
  function renderBuildings(node, space) {
    clear(node);
    const view = buildingSlotView(space);
    if (view.landmark) {
      node.appendChild(landmarkBadge());
      return;
    }
    if (view.slots.length === 0) {
      return;
    }
    for (const slot of view.slots) {
      node.appendChild(
        el(
          'span',
          {
            class: ['build-slot', `build-slot--${slot.type.toLowerCase()}`, slot.built ? 'build-slot--on' : 'build-slot--off'],
            title: `${slot.label} ${slot.built ? '지음' : '없음'}`,
          },
          [el('span', { class: 'build-slot-text', text: slot.short })],
        ),
      );
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
    // 색맹 대비: 소유자 띠에 좌석 모양별 무늬도 넣는다.
    cell.root.dataset.ownerShape = slot ? slot.shape : '';
    setText(cell.hint, owned ? `통행료 ${formatCompactWon(space.toll)}` : space.price ? formatCompactWon(space.price) : '');
    toggleClass(cell.hint, 'cell-hint--toll', owned);
    renderBuildings(cell.builds, space);
    cell.root.setAttribute('aria-label', cellLabel(state, space));

    const selectable = travelMode.active && !travelMode.locked && !travelMode.forbidden.includes(space.index);
    toggleClass(cell.root, 'cell--selectable', selectable);
    toggleClass(cell.root, 'cell--forbidden', travelMode.active && !travelMode.locked && !selectable);
    toggleClass(cell.root, 'cell--selected', selectedIndex === space.index);
  }

  /** 한 칸에 겹친 말들을 서로 가리지 않게 흩어 놓는다(`translate`만 쓴다 — 이동 연출은 `transform`을 쓴다). */
  function layoutTokensIn(slotNode) {
    const items = [...slotNode.children];
    const layout = fanOutTokens(items.length);
    for (const [index, token] of items.entries()) {
      const place = layout[index] ?? { x: 0, y: 0 };
      token.style.setProperty('--fan-x', `${place.x}em`);
      token.style.setProperty('--fan-y', `${place.y}em`);
      // 쌓임 순서는 CSS(.token--turn / .token--found)에 맡긴다 —
      // 인라인 z-index를 주면 "지금 차례" 말이 다른 말 밑에 깔린다.
    }
  }

  /** 말을 슬롯으로 옮기고, 떠난 슬롯과 도착한 슬롯의 겹침 배치를 다시 잡는다. */
  function reseatToken(token, slot) {
    const previousSlot = token.parentElement;
    slot.appendChild(token);
    layoutTokensIn(slot);
    if (previousSlot && previousSlot !== slot) {
      layoutTokensIn(previousSlot);
    }
  }

  /**
   * 한 칸 건너뛰기. FLIP(먼저 옮기고, 원래 자리에서 출발한 것처럼 되돌린 뒤 풀기)으로
   * 실제로 칸과 칸 사이를 지나가는 모습을 만든다.
   */
  async function hopOneCell(token, cell, { animate, stepMs, style }) {
    if (!animate) {
      reseatToken(token, cell.tokens);
      return;
    }

    // 모션 축소: 튀는 대신 칸마다 짧게 사라졌다 나타난다(칸을 건너뛰지는 않는다).
    if (style === 'fade' || prefersReducedMotion()) {
      token.classList.add('token--fade');
      await wait(Math.max(20, Math.round(stepMs / 2)));
      reseatToken(token, cell.tokens);
      token.classList.remove('token--fade');
      await wait(Math.max(20, Math.round(stepMs / 2)));
      return;
    }

    const before = token.getBoundingClientRect();
    reseatToken(token, cell.tokens);
    const after = token.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (dx === 0 && dy === 0) {
      await wait(stepMs);
      return;
    }
    token.style.transition = 'none';
    token.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    await nextFrame();
    token.style.transition = `transform ${stepMs}ms cubic-bezier(0.3, 1.5, 0.5, 1)`;
    token.style.transform = 'translate3d(0, 0, 0)';
    token.style.setProperty('--hop-ms', `${stepMs}ms`);
    token.classList.add('token--hopping');
    await wait(stepMs);
    token.classList.remove('token--hopping');
    token.style.transition = '';
    token.style.transform = '';
  }

  /**
   * 서버 뷰의 위치대로 말을 놓는다.
   *
   * 두 가지를 반드시 지킨다.
   * 1. **이미 제자리에 있는 말은 건드리지 않는다.** 떼었다 붙이면 DOM이 새로 연결되면서
   *    통통 튀는 애니메이션이 매 렌더마다 처음부터 다시 시작한다.
   * 2. **연출이 재생 중인 말은 건드리지 않는다.** 렌더는 잠금·연결 상태·방 이벤트로도 일어나므로,
   *    걷는 도중에 최종 위치로 끌어다 놓으면 남은 경로를 거꾸로 되짚는 것처럼 보인다.
   */
  function placeTokens(state) {
    const view = state.view;
    for (const cell of cells.values()) {
      toggleClass(cell.root, 'cell--turn-here', false);
    }
    const touchedSlots = new Set();
    for (const player of view.players) {
      let token = tokens.get(player.seatId);
      if (!token) {
        token = buildToken(state, player);
      }
      const isCurrent = player.seatId === view.currentSeatId && !view.isOver;
      toggleClass(token, 'token--turn', isCurrent);
      toggleClass(token, 'token--mine', isMySeat(state, player.seatId));
      toggleClass(token, 'token--island', player.islandRemainingTurns > 0);
      if (player.eliminated) {
        const slot = token.parentElement;
        token.remove();
        if (slot) {
          touchedSlots.add(slot);
        }
        continue;
      }
      const cell = cells.get(player.position);
      if (!cell) {
        continue;
      }
      if (isCurrent) {
        // 지금 차례인 사람이 선 칸은 테두리가 숨을 쉬어서 멀리서도 찾을 수 있다.
        toggleClass(cell.root, 'cell--turn-here', true);
      }
      if (movingSeats.has(player.seatId) || token.parentElement === cell.tokens) {
        continue;
      }
      const previousSlot = token.parentElement;
      cell.tokens.appendChild(token);
      touchedSlots.add(cell.tokens);
      if (previousSlot) {
        touchedSlots.add(previousSlot);
      }
    }
    for (const slot of touchedSlots) {
      layoutTokensIn(slot);
    }
  }

  /** 클래스를 잠깐 붙였다 뗀다(같은 대상에 다시 걸면 타이머를 새로 시작한다). */
  function flash(node, className, duration, key) {
    // 대상이 없더라도 **이전 강조는 먼저 끈다** — 아니면 엉뚱한 말이 계속 반짝인다.
    const timerKey = key ?? className;
    const previous = highlightTimers.get(timerKey);
    if (previous) {
      window.clearTimeout(previous.timer);
      previous.node.classList.remove(className);
      highlightTimers.delete(timerKey);
    }
    if (!node) {
      return;
    }
    node.classList.add(className);
    const timer = window.setTimeout(() => {
      node.classList.remove(className);
      highlightTimers.delete(timerKey);
    }, duration);
    highlightTimers.set(timerKey, { timer, node });
  }

  /** 소유 도시 강조를 끈다(다른 좌석을 누르거나 시간이 지났을 때). */
  function clearOwnedFocus() {
    if (ownedFocus.timer !== null) {
      window.clearTimeout(ownedFocus.timer);
    }
    for (const index of ownedFocus.indexes) {
      cells.get(index)?.root.classList.remove('cell--owned-focus');
    }
    ownedFocus = { indexes: [], timer: null };
    stage.classList.remove('board-stage--owned-focus');
    delete stage.dataset.ownedSlot;
  }

  /** 칸을 화면 안으로 끌어온다(폰에서 목록의 한 줄을 눌렀을 때). */
  function scrollCellIntoView(index) {
    cells.get(index)?.root.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
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

    /** 공항 목적지 선택 모드(선택 가능 칸 하이라이트). `locked`면 커맨드가 오가는 중이라 탭을 막는다. */
    setTravelMode({ active, forbidden = [], locked = false }) {
      travelMode = { active, forbidden, locked };
      toggleClass(stage, 'board-stage--picking', active);
      toggleClass(stage, 'board-stage--locked', active && locked);
      if (active) {
        stage.setAttribute('aria-busy', String(locked));
      } else {
        stage.removeAttribute('aria-busy');
      }
    },

    setSelected(index) {
      selectedIndex = index;
      for (const [cellIndex, cell] of cells.entries()) {
        toggleClass(cell.root, 'cell--selected', cellIndex === index);
      }
    },

    /** 보드를 크게 보는 모드(폰에서 칸을 누르기 쉽게 한다). */
    setZoom(zoomed) {
      toggleClass(stage, 'board-stage--zoom', zoomed);
    },

    /**
     * 말을 **한 칸** 옮긴다. FLIP(먼저 옮기고, 원래 자리에서 출발한 것처럼 되돌린 뒤 풀기)으로
     * 실제로 칸과 칸 사이를 지나가는 모습을 만든다.
     *
     * @param {string} seatId
     * @param {number} index 목표 칸
     * @param {{animate?: boolean, stepMs?: number, style?: 'hop'|'fade'}} [options]
     */
    async moveToken(seatId, index, { animate = true, stepMs = DURATIONS.hop, style = 'hop' } = {}) {
      const token = tokens.get(seatId);
      const cell = cells.get(index);
      if (!token || !cell) {
        return;
      }
      movingSeats.add(seatId);
      try {
        await hopOneCell(token, cell, { animate, stepMs, style });
      } finally {
        movingSeats.delete(seatId);
      }
    },

    /**
     * 순간이동(공항 이동 · 조난 이송 · 지정 칸 티켓): 30칸을 걷는 대신 전용 연출을 쓴다.
     * 들어 올렸다가(lift) 사라지고, 목적지에서 내려앉는다(drop) — 걷기와 확실히 구분된다.
     */
    async teleportToken(seatId, index) {
      const token = tokens.get(seatId);
      if (!token) {
        return;
      }
      movingSeats.add(seatId);
      try {
        const half = scaled(MOVE_TIMING.teleportMs / 2);
        token.classList.add('token--lift');
        await wait(half);
        const cell = cells.get(index);
        if (cell) {
          reseatToken(token, cell.tokens);
        }
        token.classList.remove('token--lift');
        token.classList.add('token--drop');
        await wait(half);
        token.classList.remove('token--drop');
      } finally {
        movingSeats.delete(seatId);
      }
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

    /** 이동이 끝난 칸을 잠깐 비춘다(어디에 내렸는지 놓치지 않게). */
    spotlightCell(index) {
      flash(cells.get(index)?.root, 'cell--spotlight', SPOTLIGHT_MS, 'spotlight-cell');
    },

    /** 상황판의 "내 위치"에서 쓴다: 그 사람의 말과 칸을 2초 동안 강조한다. */
    findSeat(seatId, index) {
      flash(tokens.get(seatId) ?? null, 'token--found', FIND_MS, 'find-token');
      if (Number.isInteger(index)) {
        flash(cells.get(index)?.root ?? null, 'cell--found', FIND_MS, 'find-cell');
        scrollCellIntoView(index);
      }
    },

    /**
     * 한 좌석이 가진 칸을 **전부** 강조한다(나머지 칸은 흐리게).
     * 강조는 테두리·색이라 모션 축소에서도 그대로 보인다(움직이는 부분만 CSS가 끈다).
     *
     * @param {number[]} indexes 강조할 칸 번호
     * @param {{color?: string|null, durationMs?: number}} [options] 좌석 색(테두리 색으로 쓴다)
     * @returns {number} 실제로 강조한 칸 수
     */
    highlightOwned(indexes, { color = null, durationMs = OWNED_HIGHLIGHT_MS } = {}) {
      clearOwnedFocus();
      const list = (Array.isArray(indexes) ? indexes : []).filter((index) => cells.has(index));
      if (list.length === 0) {
        return 0;
      }
      if (color) {
        stage.dataset.ownedSlot = color;
      }
      stage.classList.add('board-stage--owned-focus');
      for (const index of list) {
        cells.get(index).root.classList.add('cell--owned-focus');
      }
      ownedFocus = {
        indexes: list,
        timer: window.setTimeout(() => clearOwnedFocus(), durationMs),
      };
      // 폰에서는 강조한 칸 중 첫 칸이 보이도록 끌어온다.
      scrollCellIntoView(list[0]);
      return list.length;
    },

    /** 목록의 한 줄을 눌렀을 때: 그 칸만 반짝이고 화면 안으로 끌어온다. */
    revealCell(index) {
      if (!Number.isInteger(index) || !cells.has(index)) {
        return;
      }
      flash(cells.get(index).root, 'cell--found', FIND_MS, 'find-cell');
      scrollCellIntoView(index);
    },

    clearOwnedHighlight: clearOwnedFocus,

    /**
     * 다른 방으로 옮길 때 보드를 비운다.
     * (말·강조 타이머·확대 상태가 남으면 새 방에 이전 방의 흔적이 보인다.)
     */
    reset() {
      clearOwnedFocus();
      for (const { timer, node } of highlightTimers.values()) {
        window.clearTimeout(timer);
        node.classList.remove('token--found', 'cell--found', 'cell--spotlight');
      }
      highlightTimers.clear();
      movingSeats.clear();
      for (const token of tokens.values()) {
        token.remove();
      }
      tokens.clear();
      clear(boardNode);
      clear(tokenLayer);
      cells.clear();
      boardBuilt = false;
      selectedIndex = null;
      travelMode = { active: false, forbidden: [], locked: false };
      toggleClass(stage, 'board-stage--zoom', false);
      toggleClass(stage, 'board-stage--picking', false);
      toggleClass(stage, 'board-stage--locked', false);
    },

    tokenCenter(seatId) {
      return centerOf(tokens.get(seatId) ?? null);
    },

    /** 칸 버튼에 포커스를 준다(키보드로 목적지를 고를 때). */
    focusCell(index) {
      cells.get(index)?.root.focus();
    },
  };
}
