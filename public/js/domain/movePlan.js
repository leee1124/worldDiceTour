/**
 * 말 이동 연출 계획. 순수 함수만 둔다(화면 없이 테스트된다).
 *
 * 왜 필요한가: "바로 순간이동 하지 말고 걸어가면 좋겠다"는 요청 때문이다.
 * 주사위 이동은 반드시 **칸을 하나씩 밟아야** 하고, 공항·조난 이송처럼 칸 수가 없는 이동만
 * 순간이동으로 보여 준다. 다만 아무리 멀어도 연출이 한없이 길어지면 안 되므로
 * 칸당 시간을 줄여 총 시간 상한을 지킨다.
 */

import { hopPath, normalizeIndex } from './boardLayout.js';

export const MOVE_TIMING = Object.freeze({
  /**
   * 칸 하나를 지나는 시간. 오너 결정: **누구든, 어떤 설정이든 0.1초에 1칸**
   * (사람·컴퓨터·모션 축소 모두 같고, 긴 이동도 가속하지 않는다 — 12칸이면 1.2초).
   */
  stepMs: 100,
  /** 순간이동(들어 올림 → 호를 그리며 사라짐 → 내려놓기) 전체 시간. */
  teleportMs: 560,
  /** 여기까지만 걸어서 보여 준다. 더 멀면 순간이동. */
  maxWalkSteps: 14,
});

const EMPTY_PLAN = Object.freeze({ kind: 'none', path: [], stepMs: 0, totalMs: 0, style: 'none' });

function walkStepMs() {
  return MOVE_TIMING.stepMs;
}

/**
 * MOVED 이벤트 하나를 어떻게 보여 줄지 정한다.
 *
 * @param {{from?: number, to?: number, steps?: number|null, reducedMotion?: boolean, fast?: boolean}} [event]
 * @returns {{kind: 'walk'|'teleport'|'none', path: number[], stepMs: number, totalMs: number, style: 'hop'|'fade'|'arc'|'none'}}
 */
export function planMove(event) {
  if (!event || typeof event !== 'object') {
    return { ...EMPTY_PLAN };
  }
  // `fast`(컴퓨터 차례)는 호출부 호환을 위해 받기만 한다 — 속도는 누구에게나 같다.
  const { from, to, steps, reducedMotion = false } = event;
  const target = normalizeIndex(to);

  // 칸 수를 모르거나 너무 멀면 걷지 않는다(30칸을 걸어가면 연출이 아니라 기다림이다).
  const tooFar = Number.isInteger(steps) && Math.abs(steps) > MOVE_TIMING.maxWalkSteps;
  if (!Number.isInteger(steps) || tooFar) {
    return { kind: 'teleport', path: [target], stepMs: 0, totalMs: MOVE_TIMING.teleportMs, style: 'arc' };
  }
  if (steps === 0) {
    return { ...EMPTY_PLAN };
  }

  const path = hopPath({ from, to, steps });
  // hopPath가 서버 목적지와 어긋난다고 판단하면 도착 칸만 돌려준다 → 그때도 순간이동이 맞다.
  if (path.length !== Math.abs(steps)) {
    return { kind: 'teleport', path: [target], stepMs: 0, totalMs: MOVE_TIMING.teleportMs, style: 'arc' };
  }

  const stepMs = walkStepMs();
  return {
    kind: 'walk',
    path,
    stepMs,
    totalMs: stepMs * path.length,
    style: reducedMotion ? 'fade' : 'hop',
  };
}
