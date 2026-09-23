import { DomainError } from '../shared/DomainError.js';
import {
  INITIAL_CYCLE_PHASE,
  MIN_PHASE_AGE,
  cycleParamsOf,
  nextCyclePhase,
} from './data/cycle.js';

/**
 * 경기 국면 상태기계(설계서 §2.2).
 *
 * 호황 → 과열 → 침체 → 회복을 순환하며, **최소 2라운드는 머문 뒤** 국면별 확률로 다음 국면에 넘어간다.
 * 국면이 그 라운드의 추세·변동성·뉴스 덱을 모두 정하므로, 이 엔티티가 시장의 "계절"이다.
 *
 * 난수는 `age ≥ MIN_PHASE_AGE`일 때만 **정확히 한 번** 쓴다 — 소비 순서가 흔들리면 같은 시드가
 * 다른 판이 되기 때문이다.
 */
export class BusinessCycle {
  #phase;
  #age;

  constructor({ phase = INITIAL_CYCLE_PHASE, age = 1 } = {}) {
    cycleParamsOf(phase);
    if (!Number.isSafeInteger(age) || age < 1) {
      throw DomainError.invalidArgument(`국면 나이가 올바르지 않습니다: ${describe(age)}`);
    }
    this.#phase = phase;
    this.#age = age;
  }

  get phase() {
    return this.#phase;
  }

  /** 이 국면이 몇 라운드째인지(1부터). */
  get age() {
    return this.#age;
  }

  get params() {
    return cycleParamsOf(this.#phase);
  }

  get label() {
    return this.params.label;
  }

  get driftBp() {
    return this.params.driftBp;
  }

  get volMulPct() {
    return this.params.volMulPct;
  }

  /**
   * 라운드 틱의 첫 단계: 국면 전이 판정.
   * @param {import('../shared/interfaces.js').RandomSource} random
   * @returns {{changed:boolean, from:string, to:string}}
   */
  advance(random) {
    const from = this.#phase;
    if (this.#age < MIN_PHASE_AGE) {
      this.#age += 1;
      return { changed: false, from, to: from };
    }
    if (random.nextInt(1, 100) <= this.params.advanceChance) {
      this.#phase = nextCyclePhase(from);
      this.#age = 1;
      return { changed: true, from, to: this.#phase };
    }
    this.#age += 1;
    return { changed: false, from, to: from };
  }

  viewModel() {
    const params = this.params;
    return {
      phase: this.#phase,
      label: params.label,
      age: this.#age,
      driftBp: params.driftBp,
      volMulPct: params.volMulPct,
    };
  }

  toSnapshot() {
    return { phase: this.#phase, age: this.#age };
  }
}

function describe(value) {
  return typeof value === 'number' ? String(value) : `<${typeof value}>`;
}
