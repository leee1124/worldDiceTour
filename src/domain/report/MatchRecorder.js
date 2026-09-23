import { EVENT_TYPES } from '../game/events.js';

/** 하이라이트 보관 상한(설계서 §6.1). 넘으면 오래된 것부터 버린다. */
export const MAX_HIGHLIGHTS = 200;

/**
 * 라운드별 자산 스냅샷 보관 상한.
 *
 * 방 파일은 **커맨드마다 전량 다시 쓰인다**. 라운드 제한 없음(`null`)이 실제 선택지이므로
 * 상한이 없으면 200라운드 판에서 100KB가 매 커맨드마다 fsync된다(쓰기 증폭).
 * 라운드 제한의 최대값(30)보다 넉넉히 두어 정상적인 판은 한 건도 잃지 않으면서,
 * 긴 판에서는 최근 구간만 남긴다(성적표의 자산 추이는 최근이 중요하다).
 */
export const MAX_ROUND_SNAPSHOTS = 60;

/** 하이라이트로 남길 사건과 기준. */
export const HIGHLIGHT_TYPES = Object.freeze({
  BIG_TOLL: 'BIG_TOLL',
  LANDMARK: 'LANDMARK',
  JACKPOT: 'JACKPOT',
  BIG_TRADE: 'BIG_TRADE',
  DIVIDEND: 'DIVIDEND',
  DELISTED: 'DELISTED',
  BANKRUPT: 'BANKRUPT',
});

/** "큰 통행료"의 기준(원). D47 보드 경제 1.5배에 맞춰 500,000 → 750,000. */
export const BIG_TOLL_AMOUNT = 750_000;
/** "큰 거래"의 기준(명목금액, 원). */
export const BIG_TRADE_NOTIONAL = 500_000;

/**
 * 최종 성적표용 자료 수집기(설계서 §9.1 항목 7).
 *
 * **Phase 1부터 가동한다.** 나중에 켜면 그 전에 진행된 판의 자료가 없어 성적표를 만들 수 없으므로,
 * 수집만 먼저 시작해 두는 것이 이 클래스의 존재 이유다. 조립(ReportBuilder)과 화면은 Phase 5다.
 *
 * 모으는 것 세 가지:
 * 1. **라운드별 자산 스냅샷** — 라운드 틱의 돈이 반영된 뒤에 찍는다(`RoundClock`의 post-tick 훅).
 * 2. **사유별 손익** — `Treasury`가 적용하는 모든 `MoneyIntent`를 관찰한다. 돈이 움직이는 길이
 *    하나뿐이므로(R2) 어떤 흐름도 이 집계를 빠져나갈 수 없다.
 * 3. **하이라이트** — 결정적 순간(큰 통행료·랜드마크·잭팟·큰 거래·배당·상장폐지·파산), 상한 200.
 *
 * 이 자료는 **스냅샷에만 저장되고 `view`에는 실리지 않는다**(설계서 §6.1). 판이 끝날 때까지
 * 클라이언트가 볼 이유가 없고, 매 커맨드의 SSE 페이로드를 키울 이유도 없다.
 */
export class MatchRecorder {
  /** @type {Array<{round:number, players:Array<object>}>} */
  #snapshots;
  /** @type {Array<{round:number, type:string, playerId:string|null, amount:number}>} */
  #highlights;
  /** @type {Map<string, Map<string, number>>} 좌석 → 사유 → 순액 */
  #pnl;

  constructor({ snapshots = [], highlights = [], pnl = {} } = {}) {
    this.#snapshots = Array.isArray(snapshots)
      ? snapshots.slice(-MAX_ROUND_SNAPSHOTS).map((entry) => cloneSnapshot(entry))
      : [];
    this.#highlights = Array.isArray(highlights)
      ? highlights.slice(-MAX_HIGHLIGHTS).map((entry) => ({ ...entry }))
      : [];
    this.#pnl = new Map();
    if (pnl && typeof pnl === 'object' && !Array.isArray(pnl)) {
      for (const [seatId, byReason] of Object.entries(pnl)) {
        if (!byReason || typeof byReason !== 'object' || Array.isArray(byReason)) {
          continue;
        }
        const map = new Map();
        for (const [reason, net] of Object.entries(byReason)) {
          if (Number.isSafeInteger(net) && net !== 0) {
            map.set(reason, net);
          }
        }
        if (map.size > 0) {
          this.#pnl.set(seatId, map);
        }
      }
    }
  }

  /**
   * 돈이 움직일 때마다 사유별 손익을 쌓는다(`Treasury`의 관찰자).
   *
   * `Treasury`가 **좌석 기준으로** 부른다 — 좌석 간 이동은 지불 측과 수령 측을 각각 한 번씩
   * 알려 주므로, 같은 사유의 합이 0이 되어 "손익 합 + 현금 = 순자산"이 성립한다.
   *
   * 실패해도 게임을 멈추면 안 되는 **부가 기능**이므로 어떤 검증도 던지지 않는다.
   */
  onMoneyMoved(playerId, reason, amount) {
    const map = this.#pnl.get(playerId) ?? new Map();
    const next = (map.get(reason) ?? 0) + amount;
    if (next === 0) {
      map.delete(reason);
    } else {
      map.set(reason, next);
    }
    if (map.size === 0) {
      this.#pnl.delete(playerId);
      return;
    }
    this.#pnl.set(playerId, map);
  }

  /** 라운드별 자산 스냅샷(라운드 틱이 끝난 뒤). 상한을 넘으면 오래된 라운드부터 버린다. */
  recordRound({ round, players, netWorth }) {
    this.#snapshots.push({
      round,
      players: players.map((player) => ({
        id: player.id,
        ...netWorth.breakdownOf(player),
      })),
    });
    if (this.#snapshots.length > MAX_ROUND_SNAPSHOTS) {
      this.#snapshots.shift();
    }
    return { intents: [], events: [] };
  }

  /** 이번 커맨드의 이벤트에서 결정적 순간만 골라 담는다. */
  observeEvents({ round, events }) {
    for (const event of events) {
      const highlight = highlightOf(event);
      if (highlight) {
        this.#push({ round, ...highlight });
      }
    }
  }

  /** 수집 상태(테스트·Phase 5용 읽기 모델). */
  snapshotView() {
    return this.toSnapshot();
  }

  get highlightCount() {
    return this.#highlights.length;
  }

  toSnapshot() {
    // 좌석 id로 키를 만드는 객체는 프로토타입 없이 만든다(`Holdings.toSnapshot` 참고 —
    // `__proto__` 좌석의 손익이 조용히 사라지지 않게).
    const pnl = Object.create(null);
    for (const seatId of [...this.#pnl.keys()].sort()) {
      pnl[seatId] = Object.fromEntries(this.#pnl.get(seatId));
    }
    return {
      snapshots: this.#snapshots.map((entry) => cloneSnapshot(entry)),
      highlights: this.#highlights.map((entry) => ({ ...entry })),
      pnl,
    };
  }

  #push(highlight) {
    this.#highlights.push(highlight);
    if (this.#highlights.length > MAX_HIGHLIGHTS) {
      this.#highlights.shift();
    }
  }
}

/** 이벤트 하나가 하이라이트가 될지 판단한다(되지 않으면 null). */
function highlightOf(event) {
  switch (event.type) {
    case EVENT_TYPES.TOLL_PAID:
      return event.amount >= BIG_TOLL_AMOUNT
        ? { type: HIGHLIGHT_TYPES.BIG_TOLL, playerId: event.payerId, amount: event.amount }
        : null;
    case EVENT_TYPES.LANDMARK_BUILT:
      return { type: HIGHLIGHT_TYPES.LANDMARK, playerId: event.playerId, amount: event.cost ?? 0 };
    case EVENT_TYPES.CASINO_RESULT:
      return (event.jackpotWon ?? 0) > 0
        ? { type: HIGHLIGHT_TYPES.JACKPOT, playerId: event.playerId, amount: event.jackpotWon }
        : null;
    case EVENT_TYPES.ORDER_FILLED:
      return (event.notional ?? 0) >= BIG_TRADE_NOTIONAL
        ? { type: HIGHLIGHT_TYPES.BIG_TRADE, playerId: event.playerId, amount: event.notional }
        : null;
    case EVENT_TYPES.DIVIDEND_PAID:
      return { type: HIGHLIGHT_TYPES.DIVIDEND, playerId: event.playerId, amount: event.amount };
    case EVENT_TYPES.INSTRUMENT_DELISTED:
      return { type: HIGHLIGHT_TYPES.DELISTED, playerId: null, amount: event.price ?? 0 };
    case EVENT_TYPES.BANKRUPT:
      return { type: HIGHLIGHT_TYPES.BANKRUPT, playerId: event.playerId, amount: event.paidAmount ?? 0 };
    default:
      return null;
  }
}

function cloneSnapshot(entry) {
  return {
    round: entry.round,
    players: (entry.players ?? []).map((player) => ({ ...player })),
  };
}
