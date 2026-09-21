import { DomainError } from '../shared/DomainError.js';

/** 기준금리 하한(bp = 0.01%). */
export const BASE_RATE_MIN_BP = 25;
/** 기준금리 상한(bp). */
export const BASE_RATE_MAX_BP = 400;

/**
 * 판이 시작될 때의 기준금리(bp/라운드).
 *
 * 설계서 원안은 100bp였다. 오너 결정("장기투자 하면 자산이 꾸준히 오르는 시스템")에 따라 주식의
 * 기대수익을 올렸으므로, **무위험 자산이 주식의 기대수익을 따라붙지 않도록** 시작 금리를 50bp로 낮췄다.
 * 범위(25~400bp)와 "뉴스만이 금리를 움직인다"는 규칙은 그대로다.
 */
export const INITIAL_BASE_RATE_BP = 50;

/**
 * 기준금리(Value Object). 예금 이자율이며 **뉴스 카드만이 이 값을 움직인다**(단일 출처).
 * 값은 언제나 하한·상한 안으로 묶이고, 변화는 새 VO를 만든다.
 */
export class BaseRate {
  #bp;

  constructor(bp = INITIAL_BASE_RATE_BP) {
    if (!Number.isSafeInteger(bp)) {
      throw DomainError.invalidArgument(`기준금리가 올바르지 않습니다: ${describe(bp)}`);
    }
    this.#bp = clamp(bp);
  }

  get bp() {
    return this.#bp;
  }

  /** 변화를 적용한 **새** 기준금리(범위 밖은 경계에서 멈춘다). */
  shift(bp) {
    if (!Number.isSafeInteger(bp)) {
      throw DomainError.invalidArgument(`기준금리 변화가 올바르지 않습니다: ${describe(bp)}`);
    }
    return new BaseRate(this.#bp + bp);
  }

  /** 이자(내림). 플레이어에게 유리한 산출이므로 내림이다(설계서 §3.8). */
  interestOn(amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return 0;
    }
    return Math.floor((amount * this.#bp) / 10_000);
  }

  toSnapshot() {
    return this.#bp;
  }
}

function clamp(bp) {
  return Math.min(BASE_RATE_MAX_BP, Math.max(BASE_RATE_MIN_BP, bp));
}

function describe(value) {
  return typeof value === 'number' ? String(value) : `<${typeof value}>`;
}
