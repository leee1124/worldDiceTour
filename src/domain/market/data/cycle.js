import { DomainError } from '../../shared/DomainError.js';

/**
 * 경기 국면 데이터(설계서 §3.2 + 오너 밸런스 결정).
 *
 * 국면은 **호황 → 과열 → 침체 → 회복**을 순환하며, 각 국면이 그 라운드의 기본 추세(`driftBp`)와
 * 변동성 배수(`volMulPct`)를 정한다. 뉴스 덱도 국면별로 나뉘어 있어 **뉴스는 독립 난수가 아니라
 * 국면의 함수**다(`data/news.js`).
 */

/** 국면. */
export const CYCLE_PHASES = Object.freeze({
  EXPANSION: 'EXPANSION',
  OVERHEAT: 'OVERHEAT',
  RECESSION: 'RECESSION',
  RECOVERY: 'RECOVERY',
});

/** 순환 순서. */
export const CYCLE_ORDER = Object.freeze([
  CYCLE_PHASES.EXPANSION,
  CYCLE_PHASES.OVERHEAT,
  CYCLE_PHASES.RECESSION,
  CYCLE_PHASES.RECOVERY,
]);

/** 설계서 §3.2가 처음 적은 국면별 추세(bp/라운드). 튜닝의 기준점으로 남겨 둔다. */
export const DESIGN_DRIFT_BP = Object.freeze({
  [CYCLE_PHASES.EXPANSION]: 150,
  [CYCLE_PHASES.OVERHEAT]: 50,
  [CYCLE_PHASES.RECESSION]: -200,
  [CYCLE_PHASES.RECOVERY]: 100,
});

/**
 * 전 국면에 **균일하게** 더하는 추세 가산(bp/라운드).
 *
 * 오너 결정: "등락은 있어도 장기투자 하면 자산이 꾸준히 오르는 시스템 / 1바퀴 평균 6~7% 상승".
 * 설계서 원안의 기대수익은 라운드당 약 +0.37%(1바퀴 ≈ +2%)로 목표에 못 미쳤다.
 *
 * **국면마다 다른 값을 주지 않고 같은 값을 더하는 이유**: 국면의 성격(어느 국면이 좋고 나쁜지,
 * 침체가 얼마나 매서운지)은 설계서가 정한 게임 규칙이다. 균일 가산은 기대수익만 평행이동시키므로
 * 국면 간 상대 관계·타이밍의 중요성·뉴스 카드 문구를 하나도 건드리지 않는다.
 *
 * 값 50bp는 시뮬레이션으로 고른 것이다(300시드 × 25라운드, 보드 압력 제외):
 * 라운드당 평균 +1.10% → **1바퀴(5.5라운드) +6.2%**, 25라운드 +31%, 25라운드 손실 확률 12%,
 * 1바퀴 구간이 하락일 확률 35%. 검증은 `tests/e2e/marketBalance.test.js`가 한다.
 */
export const DRIFT_TUNING_BP = 50;

/**
 * 국면별 파라미터.
 * - `driftBp`: 그 라운드 전 종목 공통 추세(bp)
 * - `volMulPct`: 종목 기본 변동성에 곱하는 배수(%)
 * - `advanceChance`: `age ≥ MIN_PHASE_AGE`일 때 다음 국면으로 넘어갈 확률(%)
 *
 * 평균 국면 길이 = `1 + 100/advanceChance` 라운드(호황 3.9 / 과열 3.0 / 침체 3.9 / 회복 3.5)이므로
 * 한 순환이 약 14라운드, 25라운드 판에서 5~6국면을 지난다.
 */
export const CYCLE_PARAMS = Object.freeze({
  [CYCLE_PHASES.EXPANSION]: Object.freeze({
    label: '호황',
    driftBp: DESIGN_DRIFT_BP[CYCLE_PHASES.EXPANSION] + DRIFT_TUNING_BP,
    volMulPct: 100,
    advanceChance: 35,
  }),
  [CYCLE_PHASES.OVERHEAT]: Object.freeze({
    label: '과열',
    driftBp: DESIGN_DRIFT_BP[CYCLE_PHASES.OVERHEAT] + DRIFT_TUNING_BP,
    volMulPct: 140,
    advanceChance: 50,
  }),
  [CYCLE_PHASES.RECESSION]: Object.freeze({
    label: '침체',
    driftBp: DESIGN_DRIFT_BP[CYCLE_PHASES.RECESSION] + DRIFT_TUNING_BP,
    volMulPct: 130,
    advanceChance: 35,
  }),
  [CYCLE_PHASES.RECOVERY]: Object.freeze({
    label: '회복',
    driftBp: DESIGN_DRIFT_BP[CYCLE_PHASES.RECOVERY] + DRIFT_TUNING_BP,
    volMulPct: 80,
    advanceChance: 40,
  }),
});

/** 한 국면에 최소한 머무는 라운드 수(이 나이가 되기 전에는 전이 판정을 하지 않는다). */
export const MIN_PHASE_AGE = 2;

/**
 * 판이 시작될 때의 국면.
 * 회복에서 시작하면 첫 몇 라운드가 완만한 상승이라 규칙을 배우는 동안 큰 손실을 보지 않는다.
 */
export const INITIAL_CYCLE_PHASE = CYCLE_PHASES.RECOVERY;

/** 다음 국면. */
export function nextCyclePhase(phase) {
  const at = CYCLE_ORDER.indexOf(phase);
  if (at < 0) {
    throw DomainError.invalidArgument(`알 수 없는 경기 국면입니다: ${String(phase)}`);
  }
  return CYCLE_ORDER[(at + 1) % CYCLE_ORDER.length];
}

/** 국면 파라미터(없는 국면은 거부 — 손상 스냅샷 방어). */
export function cycleParamsOf(phase) {
  const params = CYCLE_PARAMS[phase];
  if (!params) {
    throw DomainError.invalidArgument(`알 수 없는 경기 국면입니다: ${String(phase)}`);
  }
  return params;
}
