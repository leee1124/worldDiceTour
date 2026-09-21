import { DomainError } from './DomainError.js';

/**
 * 금액 단위 규칙(순수 함수).
 *
 * 이 게임의 모든 금액은 **원 단위 정수**다. 소수·`NaN`·지수 표기·`-0`·안전 정수 범위를 넘는 값이
 * 도메인 안으로 들어오면 반올림 오차로 돈이 생기거나 사라진다. 금액을 만드는 모든 지점이 이 함수를
 * 거치도록 해 그런 값이 애초에 존재하지 못하게 한다.
 */

/**
 * 한 번의 이동이나 한 좌석의 보유액이 넘을 수 없는 상한(1조 원).
 *
 * 정상적인 판에서는 절대 닿지 않는다(최대 통행료 2,800,000원 × 판 길이). 상한의 목적은
 * 손상된 스냅샷이나 앞으로 추가될 금융 상품의 계산 실수가 안전 정수 경계까지 커지는 것을
 * **그 자리에서** 멈추는 것이다.
 */
export const MAX_MONEY = 1_000_000_000_000;

/**
 * 지불/수령 금액: 0 이상의 안전 정수이며 상한 이내.
 * @returns {number} 검증을 통과한 같은 값
 */
export function assertAmount(amount, label = '금액') {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw DomainError.invalidArgument(`${label}이 올바르지 않습니다: ${describe(amount)}`);
  }
  if (amount > MAX_MONEY) {
    throw DomainError.invalidArgument(`${label}이 상한(${MAX_MONEY})을 넘습니다: ${amount}`);
  }
  return amount;
}

/**
 * 부호 있는 금액(+수령 / −지불): 안전 정수이며 절댓값이 상한 이내.
 * @returns {number} 검증을 통과한 같은 값
 */
export function assertSignedAmount(amount, label = '금액') {
  if (!Number.isSafeInteger(amount)) {
    throw DomainError.invalidArgument(`${label}이 올바르지 않습니다: ${describe(amount)}`);
  }
  if (Math.abs(amount) > MAX_MONEY) {
    throw DomainError.invalidArgument(`${label}이 상한(${MAX_MONEY})을 넘습니다: ${amount}`);
  }
  return amount;
}

/** 오류 메시지에 값을 안전하게 싣는다(도메인은 외부 문자열화 유틸에 의존하지 않는다). */
function describe(value) {
  return typeof value === 'number' ? String(value) : `<${typeof value}>`;
}
