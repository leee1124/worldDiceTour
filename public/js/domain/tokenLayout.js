/**
 * 한 칸에 여러 말이 겹쳤을 때의 부채꼴 배치.
 *
 * 좁은 폰 화면에서는 칸이 35px 안팎이라 말을 나란히 세우면 서로를 가리거나 칸 이름을 덮는다.
 * 그래서 말은 칸 아래쪽 경계에 **겹치되 조금씩 어긋나게** 놓는다 — 어떤 말도 완전히 가려지지 않고,
 * 칸 이름 영역(칸 위쪽)도 침범하지 않는다.
 *
 * 좌표 단위는 `em`(말 크기 기준)이고 CSS의 `translate` 속성으로 쓴다.
 * `transform`은 이동 연출(FLIP)이 쓰므로 건드리지 않는다.
 */

/** 이 게임의 최대 좌석 수. 여기까지는 손으로 다듬은 배치를 쓴다. */
export const MAX_FANNED_TOKENS = 4;

/** 1~4개일 때의 배치(좌우 대칭 · 서로 다른 자리 · 칸 반경 안). */
const PRESET_LAYOUTS = Object.freeze({
  1: [{ x: 0, y: 0 }],
  2: [
    { x: -0.4, y: 0 },
    { x: 0.4, y: 0 },
  ],
  3: [
    { x: -0.54, y: 0.1 },
    { x: 0, y: -0.2 },
    { x: 0.54, y: 0.1 },
  ],
  4: [
    { x: -0.46, y: -0.22 },
    { x: 0.46, y: -0.22 },
    { x: -0.46, y: 0.24 },
    { x: 0.46, y: 0.24 },
  ],
});

/** 5개 이상(있을 수 없지만 방어적으로): 원형으로 흩어 놓는다. */
function circleLayout(count) {
  const radius = 0.5;
  return Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count - Math.PI / 2;
    return {
      x: Number((radius * Math.cos(angle)).toFixed(4)),
      y: Number((radius * Math.sin(angle)).toFixed(4)),
    };
  });
}

/**
 * 한 칸에 선 말 개수에 맞는 자리 목록.
 * @param {number} count
 * @returns {Array<{index: number, x: number, y: number}>} 앞에서부터 차례로 쓸 자리
 */
export function fanOutTokens(count) {
  const total = Number.isFinite(count) ? Math.floor(count) : 0;
  if (total <= 0) {
    return [];
  }
  const preset = PRESET_LAYOUTS[total] ?? circleLayout(total);
  return preset.map((slot, index) => ({ index, x: slot.x, y: slot.y }));
}
