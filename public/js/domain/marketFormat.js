/**
 * 등락 표기. bp(1bp = 0.01%)를 사람이 읽는 퍼센트로 바꾼다.
 *
 * **색만으로 방향을 말하지 않는다**(SPEC U6의 정신): 화살표 문자와 부호를
 * 항상 함께 붙이므로 흑백 화면·색약에서도 오름/내림이 읽힌다.
 */

const ARROWS = Object.freeze({ up: '▲', down: '▼', flat: '—' });

function toBp(value) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** bp의 방향. 0과 숫자가 아닌 값은 모두 flat. */
export function changeTone(bp) {
  const amount = toBp(bp);
  if (amount > 0) {
    return 'up';
  }
  if (amount < 0) {
    return 'down';
  }
  return 'flat';
}

/** 절댓값 bp를 "6.66" 같은 소수 두 자리 문자열로. */
function percentText(bp) {
  return (Math.abs(toBp(bp)) / 100).toFixed(2);
}

/** 125 → "1.25%" (기준금리·배당률처럼 부호가 없는 비율). */
export function formatRateBp(bp) {
  return `${percentText(bp)}%`;
}

/** 600 → "+6.00%" · −1400 → "-14.00%" · 0 → "0.00%" (뉴스 효과·압력). */
export function formatSignedBpPercent(bp) {
  const amount = toBp(bp);
  if (amount === 0) {
    return '0.00%';
  }
  return `${amount > 0 ? '+' : '-'}${percentText(amount)}%`;
}

/**
 * 등락률 표기 묶음.
 * @returns {{tone: 'up'|'down'|'flat', arrow: string, sign: string, percent: string, text: string, label: string}}
 */
export function formatChangeBp(bp) {
  const tone = changeTone(bp);
  const arrow = ARROWS[tone];
  const percent = formatSignedBpPercent(bp);
  return {
    tone,
    arrow,
    sign: tone === 'up' ? '+' : tone === 'down' ? '-' : '',
    percent,
    text: `${arrow} ${percent}`,
    // 스크린리더는 화살표 문자를 잘 읽지 않으므로 말로도 적어 둔다.
    label: `${tone === 'up' ? '상승' : tone === 'down' ? '하락' : '보합'} ${percent}`,
  };
}
