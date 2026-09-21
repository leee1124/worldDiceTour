/**
 * 안내 카드 시간표. DOM을 모른다(그래서 Node에서 그대로 테스트된다).
 *
 * **왜 별도 모듈인가**: 예전에는 `animation/timing.js`의 `scaled()`가 카드의 수명까지 줄였다.
 * 그 함수는 "움직임"을 줄이는 용도인데 카드의 **읽는 시간**에도 쓰여서,
 * 모션 축소를 켜면 행운 티켓이 60ms만 떴다가 사라졌다(= 아무것도 읽을 수 없었다).
 * 그래서 읽는 시간은 여기서만 정하고, **모션 축소로 절대 줄이지 않는다**.
 *
 * 규칙
 * - 내 좌석의 티켓은 3.5초 이상, 남/컴퓨터의 티켓은 2.5초 이상.
 * - 통행료는 2.5초 이상, 조난 결과·월급·바퀴·잭팟은 2초 이상.
 * - 모션 축소는 **진행 바의 움직임만** 끄고(남은 시간은 글자로 알린다) 시간은 그대로 둔다.
 * - 재생이 밀렸으면(빨리 감기) 카드를 버리지 않고 **한 줄 안내**로 줄인다(정보는 남긴다).
 * - 어떤 경우에도 `failsafeMs`가 `readMs`보다 길다 — 연출이 멈춰도 카드를 강제로 걷어 낸다.
 */

/** 안내 종류. */
export const NOTICE_KINDS = Object.freeze({
  TICKET: 'ticket',
  TOLL: 'toll',
  ISLAND: 'island',
  SALARY: 'salary',
  LAP: 'lap',
  JACKPOT: 'jackpot',
});

/** 남·컴퓨터 차례에 보여 줄 때의 최소 읽는 시간. */
export const MIN_READ_MS = Object.freeze({
  ticket: 2500,
  toll: 2500,
  island: 2000,
  salary: 2000,
  lap: 2000,
  jackpot: 2000,
});

/** 내 좌석의 일이면 더 오래 보여 준다(내 돈이 오간 일은 확인할 시간이 필요하다). */
export const MINE_READ_MS = Object.freeze({
  ticket: 3500,
  toll: 3000,
  island: 2500,
  salary: 2000,
  lap: 2000,
  jackpot: 2500,
});

/** 모르는 종류가 와도 최소 이만큼은 보여 준다. */
export const DEFAULT_READ_MS = 2000;

/** 한 줄 안내(빨리 감기·남의 잔돈 이동)의 수명. */
export const LINE_READ_MS = 1600;

/** 페일세이프 여유와 상한. 상한은 검증 하네스의 LINGER 기준(6초)과 맞춘다. */
export const FAILSAFE_MARGIN_MS = 2000;
export const FAILSAFE_MAX_MS = 6000;

/** 탭으로 닫을 수 있다는 것을 늘 알려 준다. */
export const DISMISS_HINT = '탭하면 닫힘';

/** 남의 차례일 때는 한 줄로 줄이는 종류(컴퓨터 턴이 늘어지지 않게). */
export const LINE_KINDS_WHEN_OTHERS = Object.freeze(['salary', 'lap']);

function readMsOf(kind, mine) {
  const table = mine ? MINE_READ_MS : MIN_READ_MS;
  const ms = table[kind];
  return Number.isFinite(ms) ? ms : DEFAULT_READ_MS;
}

/**
 * 한 안내의 시간표.
 *
 * @param {{kind?: string, mine?: boolean, fastForward?: boolean, reducedMotion?: boolean}} [options]
 * @returns {{kind: string, mine: boolean, mode: 'card'|'line', readMs: number,
 *   failsafeMs: number, showProgress: boolean, hint: string}}
 */
export function noticeTiming({ kind = '', mine = false, fastForward = false, reducedMotion = false } = {}) {
  const isMine = Boolean(mine);
  const asLine = Boolean(fastForward) || (!isMine && LINE_KINDS_WHEN_OTHERS.includes(kind));
  const readMs = asLine ? LINE_READ_MS : readMsOf(kind, isMine);
  return {
    kind: String(kind),
    mine: isMine,
    mode: asLine ? 'line' : 'card',
    readMs,
    failsafeMs: Math.min(FAILSAFE_MAX_MS, readMs + FAILSAFE_MARGIN_MS),
    // 모션 축소: 움직이는 진행 바 대신 남은 시간을 글자로 알린다(시간 자체는 그대로).
    showProgress: !reducedMotion,
    hint: DISMISS_HINT,
  };
}

/** "3.5초 후 닫힘" 같은 안내 문구(모션 축소에서 진행 바 대신 쓴다). */
export function remainingLabel(ms) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 100) / 10);
  const text = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return `${text}초 후 닫힘`;
}
