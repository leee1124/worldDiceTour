/**
 * 연출 시간표. `prefers-reduced-motion`을 존중해 0에 가깝게 줄인다.
 */

export const DURATIONS = Object.freeze({
  dice: 640,
  hop: 150,
  teleport: 420,
  coin: 540,
  salary: 480,
  ticket: 1600,
  toll: 1500,
  reel: 1100,
  jackpot: 700,
  cash: 520,
  flash: 420,
  bankrupt: 900,
});

/** 사용자가 모션 축소를 켰는지. */
export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (error) {
    console.error('[timing] 모션 설정을 확인하지 못했습니다', error);
    return false;
  }
}

/** 모션 축소 시 아주 짧게 줄인 시간. */
export function scaled(ms) {
  return prefersReducedMotion() ? Math.min(60, Math.round(ms / 8)) : ms;
}

export function wait(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** 다음 프레임까지 기다린다(FLIP 애니메이션용). */
export function nextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

/**
 * 숫자를 부드럽게 세는 애니메이션. 모션 축소면 즉시 최종값을 그린다.
 * @param {{from: number, to: number, duration?: number, onStep: (value: number) => void}} options
 */
export function countTo({ from, to, duration = DURATIONS.cash, onStep }) {
  if (from === to) {
    onStep(to);
    return;
  }
  if (prefersReducedMotion()) {
    onStep(to);
    return;
  }
  const started = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - started) / duration);
    // easeOutCubic
    const eased = 1 - (1 - progress) ** 3;
    onStep(Math.round(from + (to - from) * eased));
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}
