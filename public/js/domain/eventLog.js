/**
 * 도메인 이벤트 → 한국어 로그 문장. 순수 함수(DOM 없음)라 Node에서 그대로 테스트한다.
 *
 * - docs/API.md 7장의 모든 이벤트 종류를 처리한다(증권거래소 19종 포함).
 * - 모르는 종류가 와도 절대 예외를 던지지 않고 기본 문장(`kind: 'unknown'`)으로 넘어간다.
 * - 여기서 만든 문장은 화면에 `textContent`로만 출력한다.
 */

import { formatWon } from '../format.js';
import {
  BUILDING_ORDER,
  ISLAND_ESCAPE_LABELS,
  buildingLabel,
  casinoChoiceLabel,
  casinoGameLabel,
  gameOverReasonLabel,
  moneyReasonLabel,
} from './labels.js';
import { direction, object, subject, to } from './particles.js';

/** 로그 줄의 성격(색/아이콘 구분용). */
export const LINE_KINDS = Object.freeze({
  TURN: 'turn',
  INFO: 'info',
  MOVE: 'move',
  MONEY_IN: 'money-in',
  MONEY_OUT: 'money-out',
  SPECIAL: 'special',
  ALERT: 'alert',
  UNKNOWN: 'unknown',
});

const DEFAULT_CONTEXT = {
  nameOf: (playerId) => (playerId ? String(playerId) : '어떤 플레이어'),
  spaceNameOf: (index) => `${index}번 칸`,
};

const line = (kind, text) => ({ kind, text });

/**
 * 새 바퀴에 들어설 때 함께 알려 줄 해금 안내(명세 4장: 1바퀴 별장 / 2바퀴 빌딩 / 3바퀴 호텔).
 * 서버 도메인 `BuildingUnlocks`와 어긋나면 tests/e2e/clientLogic.test.js가 먼저 깨진다.
 */
export const LAP_UNLOCK_HINTS = Object.freeze({
  2: ' — 이제 빌딩까지 지을 수 있습니다',
  3: ' — 이제 호텔까지 지을 수 있습니다',
});

/** 이벤트 종류별 문장 생성기. 각 함수는 (event, ctx) → {kind, text}. */
const FORMATTERS = {
  /* ── 턴 흐름 ─────────────────────────────────────────────── */
  TURN_STARTED: (event, ctx) =>
    line(LINE_KINDS.TURN, `${event.round}라운드 · ${ctx.name(event.playerId)}의 차례`),

  DICE_ROLLED: (event, ctx) =>
    line(
      LINE_KINDS.INFO,
      `${ctx.name(event.playerId)} 주사위 ${event.die1} + ${event.die2} = ${event.sum}${
        event.isDouble ? ' (더블!)' : ''
      }`,
    ),

  MOVED: (event, ctx) => {
    const who = subject(ctx.name(event.playerId));
    const target = ctx.space(event.to);
    if (!Number.isInteger(event.steps)) {
      return line(LINE_KINDS.MOVE, `${who} ${direction(target)} 이송되었습니다.`);
    }
    const steps = Math.abs(event.steps);
    const heading = event.steps < 0 ? '뒤로' : '앞으로';
    const salary = event.passedStart ? ' (출발 칸 통과)' : '';
    return line(LINE_KINDS.MOVE, `${who} ${heading} ${steps}칸 움직여 ${target}에 섰습니다.${salary}`);
  },

  LANDED: (event, ctx) =>
    line(LINE_KINDS.INFO, `${subject(ctx.name(event.playerId))} ${event.name ?? ctx.space(event.index)}에 도착했습니다.`),

  EXTRA_TURN: (event, ctx) =>
    line(LINE_KINDS.SPECIAL, `더블! ${subject(ctx.name(event.playerId))} 한 번 더 굴립니다.`),

  TURN_ENDED: (event, ctx) => line(LINE_KINDS.INFO, `${ctx.name(event.playerId)}의 턴이 끝났습니다.`),

  ROUND_ADVANCED: (event) => line(LINE_KINDS.TURN, `${event.round}라운드가 시작되었습니다.`),

  GAME_OVER: (event) => {
    const winner = Array.isArray(event.rankings) ? event.rankings[0] : null;
    const reason = gameOverReasonLabel(event.reason);
    const champion = winner?.name ? `${subject(winner.name)} 우승!` : '';
    return line(LINE_KINDS.SPECIAL, `🏆 게임 종료 — ${reason}. ${champion}`.trim());
  },

  LAP_ADVANCED: (event, ctx) =>
    line(
      LINE_KINDS.SPECIAL,
      `🔄 ${subject(ctx.name(event.playerId))} ${event.lap}바퀴에 들어섰습니다${
        LAP_UNLOCK_HINTS[event.lap] ?? ''
      }.`,
    ),

  /* ── 돈 ─────────────────────────────────────────────────── */
  SALARY_PAID: (event, ctx) =>
    line(LINE_KINDS.MONEY_IN, `${subject(ctx.name(event.playerId))} 월급 ${formatWon(event.amount)}을 받았습니다.`),

  SALARY_SEIZED: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_OUT,
      `${ctx.name(event.playerId)}의 월급 ${formatWon(event.amount)}이 채무 상환에 압류되었습니다 (남은 채무 ${formatWon(
        event.remainingDebt,
      )}).`,
    ),

  LOAN_TAKEN: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_IN,
      `${subject(ctx.name(event.playerId))} ${formatWon(event.principal)}을 대출했습니다 (채무 ${formatWon(
        event.debt,
      )}).`,
    ),

  LOAN_REPAID: (event, ctx) =>
    line(LINE_KINDS.MONEY_IN, `${subject(ctx.name(event.playerId))} 대출을 모두 갚았습니다.`),

  TOLL_PAID: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_OUT,
      `${subject(ctx.name(event.payerId))} ${to(ctx.name(event.ownerId))} ${ctx.space(event.index)} 통행료 ${formatWon(
        event.amount,
      )}을 냈습니다.`,
    ),

  TAX_PAID: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_OUT,
      `${subject(ctx.name(event.playerId))} 세금 ${formatWon(event.amount)}을 납부했습니다 (잭팟 적립).`,
    ),

  MONEY_GAINED: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_IN,
      `${subject(ctx.name(event.playerId))} ${direction(moneyReasonLabel(event.reason))} ${formatWon(
        event.amount,
      )}을 받았습니다.`,
    ),

  MONEY_LOST: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_OUT,
      `${subject(ctx.name(event.playerId))} ${direction(moneyReasonLabel(event.reason))} ${formatWon(
        event.amount,
      )}을 냈습니다.`,
    ),

  MONEY_TRANSFERRED: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_OUT,
      `${subject(ctx.name(event.fromId))} ${to(ctx.name(event.toId))} ${formatWon(
        event.amount,
      )}을 건넸습니다 (${moneyReasonLabel(event.reason)}).`,
    ),

  JACKPOT_CHANGED: (event) => line(LINE_KINDS.INFO, `잭팟 적립금 ${formatWon(event.jackpot)}`),

  /* ── 도시 · 건물 · 인수 ──────────────────────────────────── */
  CITY_PURCHASED: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_OUT,
      `${subject(ctx.name(event.playerId))} ${object(event.name ?? ctx.space(event.index))} ${formatWon(
        event.price,
      )}에 매입했습니다.`,
    ),

  PURCHASE_DECLINED: (event, ctx) =>
    line(LINE_KINDS.INFO, `${subject(ctx.name(event.playerId))} ${ctx.space(event.index)} 매입을 포기했습니다.`),

  BUILD_OFFERED: (event, ctx) =>
    line(
      LINE_KINDS.INFO,
      `${to(ctx.name(event.playerId))} ${event.name ?? ctx.space(event.index)} 건설 기회가 열렸습니다.`,
    ),

  BUILT: (event, ctx) => {
    // 서버가 보낸 순서와 무관하게 별장 · 빌딩 · 호텔(· 랜드마크) 순으로 읽히게 정리한다.
    const order = [...BUILDING_ORDER, 'LANDMARK'];
    const built = Array.isArray(event.buildings)
      ? [...event.buildings]
          .sort((a, b) => order.indexOf(a) - order.indexOf(b))
          .map(buildingLabel)
          .join(' · ')
      : '건물';
    return line(
      LINE_KINDS.MONEY_OUT,
      `${subject(ctx.name(event.playerId))} ${event.name ?? ctx.space(event.index)}에 ${built}을 지었습니다 (${formatWon(
        event.cost,
      )}).`,
    );
  },

  LANDMARK_BUILT: (event, ctx) =>
    line(
      LINE_KINDS.SPECIAL,
      `🗼 ${ctx.name(event.playerId)}의 ${event.name ?? ctx.space(event.index)}에 랜드마크가 세워졌습니다 (${formatWon(
        event.cost,
      )}).`,
    ),

  BUILD_DECLINED: (event, ctx) => {
    const who = subject(ctx.name(event.playerId));
    if (!Number.isInteger(event.index)) {
      return line(LINE_KINDS.INFO, `${who} 출발 보너스 건설을 포기했습니다.`);
    }
    return line(LINE_KINDS.INFO, `${who} ${ctx.space(event.index)} 건설을 포기했습니다.`);
  },

  START_BONUS_OFFERED: (event, ctx) => {
    const count = Array.isArray(event.candidates) ? event.candidates.length : 0;
    return line(
      LINE_KINDS.SPECIAL,
      `🚩 ${subject(ctx.name(event.playerId))} 출발 칸에 도착해 건설 기회를 얻었습니다 (후보 ${count}곳).`,
    );
  },

  ACQUIRE_OFFERED: (event, ctx) =>
    line(
      LINE_KINDS.INFO,
      `${subject(ctx.name(event.playerId))} ${object(event.name ?? ctx.space(event.index))} ${formatWon(
        event.price,
      )}에 인수할 수 있습니다.`,
    ),

  ACQUIRED: (event, ctx) =>
    line(
      LINE_KINDS.ALERT,
      `${subject(ctx.name(event.playerId))} ${ctx.name(event.fromId)}의 ${object(
        event.name ?? ctx.space(event.index),
      )} ${formatWon(event.price)}에 인수했습니다.`,
    ),

  ACQUIRE_DECLINED: (event, ctx) =>
    line(LINE_KINDS.INFO, `${subject(ctx.name(event.playerId))} ${ctx.space(event.index)} 인수를 포기했습니다.`),

  /* ── 행운 티켓 · 조난 섬 · 공항 ──────────────────────────── */
  TICKET_DRAWN: (event, ctx) =>
    line(LINE_KINDS.SPECIAL, `🎫 ${ctx.name(event.playerId)} — ${event.text ?? '행운 티켓을 뽑았습니다.'}`),

  STRANDED: (event, ctx) =>
    line(
      LINE_KINDS.ALERT,
      `🏝 ${subject(ctx.name(event.playerId))} 조난 섬에 갇혔습니다 (최대 ${event.remainingTurns}턴).`,
    ),

  ISLAND_RESCUE_PAID: (event, ctx) =>
    line(LINE_KINDS.MONEY_OUT, `${subject(ctx.name(event.playerId))} 구조비 ${formatWon(event.amount)}을 냈습니다.`),

  ISLAND_ESCAPED: (event, ctx) =>
    line(
      LINE_KINDS.SPECIAL,
      `${subject(ctx.name(event.playerId))} 조난 섬을 벗어났습니다 (${ISLAND_ESCAPE_LABELS[event.by] ?? '탈출'}).`,
    ),

  ISLAND_STAY: (event, ctx) =>
    line(LINE_KINDS.ALERT, `${ctx.name(event.playerId)}의 탈출 실패 — 남은 조난 ${event.remainingTurns}턴.`),

  AIRPORT_TICKET_GRANTED: (event, ctx) =>
    line(LINE_KINDS.SPECIAL, `✈️ ${subject(ctx.name(event.playerId))} 세계일주 이동권을 받았습니다 (다음 턴 사용).`),

  AIRPORT_READY: (event, ctx) =>
    line(LINE_KINDS.INFO, `✈️ ${ctx.name(event.playerId)}의 이동권을 쓸 차례입니다.`),

  TRAVELED: (event, ctx) =>
    line(
      LINE_KINDS.MOVE,
      `✈️ ${subject(ctx.name(event.playerId))} ${ctx.space(event.from)}에서 ${direction(
        ctx.space(event.to),
      )} 날아갔습니다.`,
    ),

  /* ── 카지노 ──────────────────────────────────────────────── */
  CASINO_ENTERED: (event, ctx) =>
    line(
      LINE_KINDS.SPECIAL,
      `🎰 ${subject(ctx.name(event.playerId))} 카지노에 입장했습니다 (${event.roundsLeft}판 가능 · 잭팟 ${formatWon(
        event.jackpot,
      )}).`,
    ),

  CASINO_RESULT: (event, ctx) => {
    const who = ctx.name(event.playerId);
    const detail = describeCasinoDetail(event);
    const result = event.win
      ? `${formatWon(event.payout)} 획득`
      : `베팅 ${formatWon(event.bet)} 손실`;
    const jackpot = event.jackpotWon > 0 ? ` 🎉 잭팟 ${formatWon(event.jackpotWon)} 당첨!` : '';
    return line(
      event.win ? LINE_KINDS.MONEY_IN : LINE_KINDS.MONEY_OUT,
      `🎰 ${who} · ${casinoGameLabel(event.game)} ${detail} → ${result}${jackpot}`,
    );
  },

  CASINO_LEFT: (event, ctx) =>
    line(LINE_KINDS.INFO, `${subject(ctx.name(event.playerId))} 카지노에서 나왔습니다.`),

  /* ── 지불 불능 ───────────────────────────────────────────── */
  LIQUIDATION_REQUIRED: (event, ctx) => {
    const creditor = event.creditorId ? ctx.name(event.creditorId) : '은행';
    return line(
      LINE_KINDS.ALERT,
      `⚠️ ${ctx.name(event.playerId)}의 현금이 부족합니다 — ${moneyReasonLabel(event.reason)} ${formatWon(
        event.amountDue,
      )} (채권자: ${creditor}).`,
    );
  },

  PROPERTY_SOLD: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_IN,
      `${subject(ctx.name(event.playerId))} ${object(event.name ?? ctx.space(event.index))} 매각해 ${formatWon(
        event.refund,
      )}을 회수했습니다.`,
    ),

  DEBT_SETTLED: (event, ctx) =>
    line(LINE_KINDS.INFO, `${subject(ctx.name(event.playerId))} ${formatWon(event.amount)}을 모두 정산했습니다.`),

  BANKRUPT: (event, ctx) => {
    const creditor = event.creditorId ? ctx.name(event.creditorId) : '은행';
    const released = Array.isArray(event.releasedIndexes) ? event.releasedIndexes.length : 0;
    return line(
      LINE_KINDS.ALERT,
      `💀 ${subject(ctx.name(event.playerId))} 파산했습니다 — ${to(creditor)} ${formatWon(
        event.paidAmount,
      )} 지급, 자산 ${released}곳 초기화.`,
    );
  },

  /* ── 증권거래소: 거래 창구 ───────────────────────────────── */
  TRADING_OPENED: (event, ctx) =>
    line(
      LINE_KINDS.SPECIAL,
      `📈 ${ctx.name(event.playerId)}의 거래 시간 — 주문 ${event.ordersLeft}건 / 예산 ${formatWon(
        event.notionalLeft,
      )} 남음.`,
    ),

  TRADING_CLOSED: (event, ctx) =>
    line(
      LINE_KINDS.INFO,
      event.reason === 'BUDGET_EXHAUSTED'
        ? `${subject(ctx.name(event.playerId))} 주문 한도를 다 써서 거래를 마쳤습니다.`
        : `${subject(ctx.name(event.playerId))} 거래를 마쳤습니다.`,
    ),

  ORDER_FILLED: (event, ctx) => {
    const who = subject(ctx.name(event.playerId));
    const what = `${event.name ?? event.instrumentId} ${event.quantity}주`;
    const at = `${formatWon(event.price)}에`;
    if (event.kind === 'BUY') {
      return line(
        LINE_KINDS.MONEY_OUT,
        `${who} ${what}를 ${at} 샀습니다 — ${formatWon(event.notional)} + 수수료 ${formatWon(event.fee)}.`,
      );
    }
    const tail = event.viaLiquidation
      ? ' (정리 매각, 수수료 면제)'
      : ` — 수수료 ${formatWon(event.fee)}`;
    return line(
      LINE_KINDS.MONEY_IN,
      `${who} ${what}를 ${at} 팔아 ${formatWon(event.notional)}을 받았습니다${tail}.`,
    );
  },

  DEPOSIT_MADE: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_OUT,
      `${subject(ctx.name(event.playerId))} ${formatWon(event.amount)}을 예금했습니다 (잔액 ${formatWon(
        event.balance,
      )}).`,
    ),

  DEPOSIT_WITHDRAWN: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_IN,
      `${subject(ctx.name(event.playerId))} 예금 ${formatWon(event.amount)}을 찾았습니다 (잔액 ${formatWon(
        event.balance,
      )})${event.viaLiquidation ? ' — 정리 인출' : ''}.`,
    ),

  DEPOSIT_INTEREST_PAID: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_IN,
      `💰 ${ctx.name(event.playerId)}의 예금 이자 ${formatWon(event.amount)} (연 ${formatBp(
        event.baseRateBp,
      )}).`,
    ),

  DIVIDEND_PAID: (event, ctx) =>
    line(
      LINE_KINDS.MONEY_IN,
      `💵 ${ctx.name(event.playerId)}의 ${event.name ?? event.instrumentId} 배당 ${formatWon(
        event.amount,
      )} (1주 ${formatWon(event.perShare)} × ${event.quantity}주).`,
    ),

  /* ── 증권거래소: 시장(라운드 틱) ─────────────────────────── */
  CYCLE_CHANGED: (event) =>
    line(
      LINE_KINDS.SPECIAL,
      `🔄 경기 국면이 ${cyclePhaseLabel(event.from)}에서 ${cyclePhaseLabel(event.to)}으로 바뀌었습니다.`,
    ),

  NEWS_PUBLISHED: (event) =>
    line(
      LINE_KINDS.SPECIAL,
      `📰 ${event.headline} — ${event.explanation}${describeNewsEffects(event.effects)}`,
    ),

  BASE_RATE_CHANGED: (event) =>
    line(
      LINE_KINDS.INFO,
      `🏦 기준금리가 ${formatBp(event.from)}에서 ${formatBp(event.to)}로 ${
        event.changeBp > 0 ? '올랐' : '내렸'
      }습니다.`,
    ),

  PRICES_UPDATED: (event) => {
    const changes = Array.isArray(event.changes) ? event.changes : [];
    if (changes.length === 0) {
      return line(LINE_KINDS.INFO, '시세가 갱신됐습니다.');
    }
    const summary = changes
      .map((change) => `${change.instrumentId} ${formatChangeBp(change.changeBp)}`)
      .join(' · ');
    return line(LINE_KINDS.INFO, `📊 시세 갱신 — ${summary}`);
  },

  INSTRUMENT_DELISTED: (event) =>
    line(
      LINE_KINDS.ALERT,
      `⚠️ ${event.name ?? event.instrumentId}이 상장폐지됐습니다 (${formatWon(event.price)}).`,
    ),

  INSTRUMENT_LISTED: (event) =>
    line(
      LINE_KINDS.SPECIAL,
      `✨ ${event.name ?? event.instrumentId}이 새로 상장됐습니다 (${formatWon(event.price)}).`,
    ),

  HOLDINGS_WIPED: (event, ctx) =>
    line(
      LINE_KINDS.ALERT,
      `💥 ${ctx.name(event.playerId)}의 ${event.instrumentId} ${event.quantity}주가 휴지조각이 됐습니다 (원가 ${formatWon(
        event.costBasis,
      )}).`,
    ),

  /* ── 증권거래소: 예약 주문 ───────────────────────────────── */
  QUEUED_ORDER_PLACED: (event, ctx) =>
    line(
      LINE_KINDS.INFO,
      `🗒️ ${subject(ctx.name(event.playerId))} ${describeQueuedOrder(event)}를 예약했습니다.`,
    ),

  QUEUED_ORDER_CANCELLED: (event, ctx) =>
    line(LINE_KINDS.INFO, `${subject(ctx.name(event.playerId))} 예약 주문을 취소했습니다.`),

  QUEUED_ORDER_EXECUTED: (event, ctx) =>
    line(LINE_KINDS.INFO, `${ctx.name(event.playerId)}의 예약 주문이 체결됩니다.`),

  QUEUED_ORDER_REJECTED: (event, ctx) =>
    line(
      LINE_KINDS.ALERT,
      `${ctx.name(event.playerId)}의 예약 주문이 취소됐습니다 — ${rejectReasonLabel(event.reasonCode)}.`,
    ),
};

/** 경기 국면 이름(서버 `CYCLE_PARAMS.label`과 같은 문구). */
export const CYCLE_PHASE_LABELS = Object.freeze({
  EXPANSION: '호황',
  OVERHEAT: '과열',
  RECESSION: '침체',
  RECOVERY: '회복',
});

/** 섹터 이름(서버 `SECTOR_LABELS`와 같은 문구). */
export const SECTOR_LABELS = Object.freeze({
  AIRLINE: '항공',
  CONSTRUCTION: '건설',
  HOTEL: '호텔·관광',
  ENTERTAINMENT: '카지노·엔터',
  ENERGY: '에너지',
});

/** 주문 거절 사유(서버 `REJECT_REASONS`와 짝). */
export const REJECT_REASON_LABELS = Object.freeze({
  WINDOW_CLOSED: '거래 시간이 끝났습니다',
  INSUFFICIENT_CASH: '현금이 부족합니다',
  NOT_ENOUGH_SHARES: '보유 수량이 부족합니다',
  DELISTED: '상장폐지된 종목입니다',
  UNKNOWN_INSTRUMENT: '없는 종목입니다',
  ORDER_LIMIT: '주문 횟수를 다 썼습니다',
  NOTIONAL_LIMIT: '거래 예산을 넘습니다',
  POSITION_LIMIT: '보유 상한을 넘습니다',
  DEPOSIT_CAP: '예금 한도를 넘습니다',
  INSUFFICIENT_DEPOSIT: '예금 잔액이 부족합니다',
  INVALID_ORDER: '주문 내용이 규칙에 맞지 않습니다',
});

/** 예약 주문 종류. */
const QUEUED_ORDER_LABELS = Object.freeze({
  BUY_STOCK: '매수',
  SELL_STOCK: '매도',
  DEPOSIT: '예금',
  WITHDRAW: '인출',
});

function cyclePhaseLabel(phase) {
  return CYCLE_PHASE_LABELS[phase] ?? '알 수 없는 국면';
}

function sectorLabel(sector) {
  return SECTOR_LABELS[sector] ?? sector ?? '전 종목';
}

function rejectReasonLabel(code) {
  return REJECT_REASON_LABELS[code] ?? '주문을 처리할 수 없습니다';
}

/** bp(1/100%)를 사람이 읽는 퍼센트로. 25bp → "0.25%". */
function formatBp(bp) {
  const value = Number(bp);
  if (!Number.isFinite(value)) {
    return '0%';
  }
  const percent = value / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

/** 등락률을 부호와 함께. 상승/하락을 색 말고 문자로도 알린다(U6 정신). */
function formatChangeBp(bp) {
  const value = Number(bp);
  if (!Number.isFinite(value) || value === 0) {
    return '→ 0%';
  }
  return `${value > 0 ? '▲' : '▼'} ${formatBp(Math.abs(value))}`;
}

/** 뉴스 효과를 한 줄 꼬리말로. 효과가 없으면 빈 문자열. */
function describeNewsEffects(effects) {
  if (!Array.isArray(effects) || effects.length === 0) {
    return '';
  }
  const parts = [];
  for (const effect of effects) {
    if (!effect || effect.bp === 0) {
      continue;
    }
    if (effect.target === 'RATE') {
      parts.push(`기준금리 ${formatChangeBp(effect.bp)}`);
    } else if (effect.target === 'ALL') {
      parts.push(`전 종목 ${formatChangeBp(effect.bp)}`);
    } else {
      parts.push(`${sectorLabel(effect.sector)} ${formatChangeBp(effect.bp)}`);
    }
  }
  return parts.length > 0 ? ` (${parts.join(' · ')})` : '';
}

/** 예약 주문 내용을 한 마디로. */
function describeQueuedOrder(event) {
  const kind = QUEUED_ORDER_LABELS[event.kind] ?? '주문';
  if (event.kind === 'DEPOSIT' || event.kind === 'WITHDRAW') {
    return `${formatWon(event.amount)} ${kind}`;
  }
  return `${event.instrumentId} ${event.quantity}주 ${kind}`;
}

/** 카지노 판정 내용을 한 줄로 요약한다. */
function describeCasinoDetail(event) {
  const detail = event.detail ?? {};
  switch (event.game) {
    case 'ODD_EVEN':
      return `주사위 ${detail.die} (${casinoChoiceLabel(detail.outcome)}) / 선택 ${casinoChoiceLabel(detail.choice)}`;
    case 'HIGH_LOW_SEVEN':
      return `${detail.die1}+${detail.die2}=${detail.sum} (${casinoChoiceLabel(
        detail.outcome,
      )}) / 선택 ${casinoChoiceLabel(detail.choice)}`;
    case 'SLOT': {
      const symbols = Array.isArray(detail.symbols) ? detail.symbols.join(' ') : '';
      return `${symbols} (${detail.matched ?? 1}개 일치)`;
    }
    default:
      return '';
  }
}

/**
 * 이벤트 하나를 로그 한 줄로 바꾼다. 절대 예외를 던지지 않는다.
 * @param {object|null} event 서버 도메인 이벤트
 * @param {{nameOf?: (id: string) => string, spaceNameOf?: (index: number) => string}} [context]
 * @returns {{kind: string, text: string}}
 */
export function formatEventLine(event, context = {}) {
  const ctx = {
    name: context.nameOf ?? DEFAULT_CONTEXT.nameOf,
    space: context.spaceNameOf ?? DEFAULT_CONTEXT.spaceNameOf,
  };
  const type = event?.type;
  const formatter = typeof type === 'string' ? FORMATTERS[type] : undefined;

  if (!formatter) {
    return line(LINE_KINDS.UNKNOWN, `알 수 없는 이벤트: ${type ?? '(없음)'}`);
  }
  try {
    const result = formatter(event, ctx);
    if (!result || typeof result.text !== 'string' || result.text.trim().length === 0) {
      return line(LINE_KINDS.UNKNOWN, `알 수 없는 이벤트: ${type}`);
    }
    return result;
  } catch (error) {
    console.error('[eventLog] 로그 문장 생성 실패', type, error);
    return line(LINE_KINDS.UNKNOWN, `알 수 없는 이벤트: ${type}`);
  }
}

/** 처리할 수 있는 이벤트 종류 목록(테스트·디버깅용). */
export const SUPPORTED_EVENT_TYPES = Object.freeze(Object.keys(FORMATTERS));
