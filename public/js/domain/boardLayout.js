/**
 * 보드 40칸 ↔ 11×11 그리드 좌표 매핑과 이동 경로 계산. 순수 함수만 둔다.
 *
 * 배치 규칙(반시계 방향이 아니라 "오른쪽으로 출발"하는 읽기 순서):
 * - 0 출발(왼쪽 아래 모서리) → 1~9 아래 변을 오른쪽으로
 * - 10 조난 섬(오른쪽 아래) → 11~19 오른쪽 변을 위로
 * - 20 카지노(오른쪽 위) → 21~29 위쪽 변을 왼쪽으로
 * - 30 공항(왼쪽 위) → 31~39 왼쪽 변을 아래로 → 다시 0
 */

export const BOARD_SIZE = 40;
export const GRID_SIZE = 11;

/** 한 변의 칸 수(모서리 제외). */
const SIDE_LENGTH = 9;

/** 모서리 칸 번호 → 칸 종류(서버 board 정의와 같은 값). */
const CORNERS = Object.freeze({
  0: 'START',
  10: 'ISLAND',
  20: 'CASINO',
  30: 'AIRPORT',
});

/** 네 변의 색 그룹. 이름은 화면 안내와 범례에 쓴다. */
export const CELL_GROUPS = Object.freeze({
  ASIA: { id: 'ASIA', label: '아시아 · 아프리카' },
  EUROPE: { id: 'EUROPE', label: '유럽' },
  AMERICA: { id: 'AMERICA', label: '아메리카' },
  PACIFIC: { id: 'PACIFIC', label: '오세아니아 · 메가시티' },
});

const GROUP_BY_SIDE = Object.freeze({
  BOTTOM: CELL_GROUPS.ASIA.id,
  RIGHT: CELL_GROUPS.EUROPE.id,
  TOP: CELL_GROUPS.AMERICA.id,
  LEFT: CELL_GROUPS.PACIFIC.id,
});

const isValidIndex = (index) => Number.isInteger(index) && index >= 0 && index < BOARD_SIZE;

/** 보드 번호를 0~39로 정규화한다. */
export function normalizeIndex(index) {
  const value = Number(index);
  if (!Number.isInteger(value)) {
    return 0;
  }
  return ((value % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
}

/** 모서리 칸이면 칸 종류, 아니면 null. */
export function cornerOf(index) {
  return CORNERS[index] ?? null;
}

export function isCorner(index) {
  return cornerOf(index) !== null;
}

/** 칸이 속한 변. 모서리는 시작하는 변에 속한다. */
export function sideOf(index) {
  if (!isValidIndex(index)) {
    return 'BOTTOM';
  }
  if (index <= 10) {
    return 'BOTTOM';
  }
  if (index <= 20) {
    return 'RIGHT';
  }
  if (index <= 30) {
    return 'TOP';
  }
  return 'LEFT';
}

/** 칸의 색 그룹 id. 모서리는 그룹이 없다. */
export function groupOf(index) {
  if (!isValidIndex(index) || isCorner(index)) {
    return null;
  }
  return GROUP_BY_SIDE[sideOf(index)];
}

/**
 * 11×11 그리드에서의 1-based 좌표.
 * @returns {{row: number, col: number}}
 */
export function cellPosition(index) {
  const value = isValidIndex(index) ? index : 0;
  const last = GRID_SIZE;

  if (value === 0) {
    return { row: last, col: 1 };
  }
  if (value <= SIDE_LENGTH) {
    return { row: last, col: 1 + value };
  }
  if (value === 10) {
    return { row: last, col: last };
  }
  if (value <= 19) {
    return { row: last - (value - 10), col: last };
  }
  if (value === 20) {
    return { row: 1, col: last };
  }
  if (value <= 29) {
    return { row: 1, col: last - (value - 20) };
  }
  if (value === 30) {
    return { row: 1, col: 1 };
  }
  return { row: 1 + (value - 30), col: 1 };
}

/** CSS grid-area 문자열(`row / col / row+1 / col+1`). */
export function gridArea(index) {
  const { row, col } = cellPosition(index);
  return `${row} / ${col} / ${row + 1} / ${col + 1}`;
}

/**
 * MOVED 이벤트를 한 칸씩 밟는 경로로 바꾼다(출발 칸 제외, 도착 칸 포함).
 * `steps`가 null이면 순간이동으로 보고 도착 칸만 돌려준다.
 * 계산 결과가 서버의 `to`와 다르면(방어) 순간이동으로 되돌린다.
 */
export function hopPath({ from, to, steps }) {
  const target = normalizeIndex(to);
  if (!Number.isInteger(steps)) {
    return [target];
  }
  if (steps === 0) {
    return [];
  }
  if (Math.abs(steps) > BOARD_SIZE) {
    return [target];
  }

  const start = normalizeIndex(from);
  const direction = steps > 0 ? 1 : -1;
  const path = [];
  for (let taken = 1; taken <= Math.abs(steps); taken += 1) {
    path.push(normalizeIndex(start + direction * taken));
  }
  if (path[path.length - 1] !== target) {
    return [target];
  }
  return path;
}
