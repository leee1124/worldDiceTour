/**
 * 금액·숫자 표기. DOM에 의존하지 않는 순수 함수만 둔다.
 */

const TEN_THOUSAND = 10_000;

/** 숫자가 아닌 값은 0으로 본다(서버 필드 누락 방어). */
function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 1234567 → "1,234,567" */
export function formatMoney(value) {
  return toNumber(value).toLocaleString('ko-KR');
}

/** 1234567 → "1,234,567원" */
export function formatWon(value) {
  return `${formatMoney(value)}원`;
}

/** 부호를 항상 붙인다. 0은 부호 없이 "0원". */
export function formatSignedWon(value) {
  const amount = toNumber(value);
  if (amount === 0) {
    return '0원';
  }
  const sign = amount > 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(amount))}원`;
}

/** 보드 칸처럼 폭이 좁은 곳에 쓰는 만 단위 축약. 70000 → "7만", 28000 → "2.8만" */
export function formatCompactWon(value) {
  const amount = toNumber(value);
  const absolute = Math.abs(amount);
  if (absolute < TEN_THOUSAND) {
    return formatMoney(amount);
  }
  const inTenThousands = amount / TEN_THOUSAND;
  const rounded = Math.round(inTenThousands * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}만`;
}

/** 1 → "1번째" 같은 순위 표기. */
export function formatRank(rank) {
  return `${toNumber(rank)}위`;
}
