import { DomainError } from './DomainError.js';
import { assertAmount, assertSignedAmount } from './Money.js';

/**
 * 돈 이동 사유. 장부의 사유별 내역(`BankLedger.breakdown`)과 이벤트의 `reason` 필드가
 * **같은 목록**을 쓴다. 새 흐름(배당·이자·수수료 등)을 추가할 때 손댈 곳은 여기 한 곳이다.
 */
export const MONEY_REASONS = Object.freeze({
  SALARY: 'SALARY',
  PURCHASE: 'PURCHASE',
  BUILD: 'BUILD',
  TOLL: 'TOLL',
  TAX: 'TAX',
  TICKET: 'TICKET',
  CASINO: 'CASINO',
  ISLAND_RESCUE: 'ISLAND_RESCUE',
  LIQUIDATION: 'LIQUIDATION',
  BANKRUPTCY: 'BANKRUPTCY',
  ACQUISITION: 'ACQUISITION',
  LOAN: 'LOAN',
});

const REASON_LIST = Object.freeze(Object.values(MONEY_REASONS));

/**
 * 돈의 상대방.
 * - `BANK` / `EXCHANGE`: 은행 창구. 총합이 바뀌므로 **장부에 기록**한다(거래소도 은행 창구다).
 * - `JACKPOT`: 카지노 적립금. 총합(현금 + 잭팟)이 그대로라 장부에 남기지 않는다.
 * - `PLAYER`: 좌석 간 이동. 총합이 그대로라 장부에 남기지 않는다.
 */
export const COUNTERPARTIES = Object.freeze({
  BANK: 'BANK',
  EXCHANGE: 'EXCHANGE',
  JACKPOT: 'JACKPOT',
  PLAYER: 'PLAYER',
});

const LEDGER_COUNTERPARTIES = Object.freeze([COUNTERPARTIES.BANK, COUNTERPARTIES.EXCHANGE]);

/**
 * 돈 이동 의사(Value Object). **모든** 돈 이동은 이 한 종류로 표현되고 `Treasury.apply()`만
 * 실제로 적용한다. 서브시스템(시장·대출·파생)은 돈을 직접 만지지 않고 intent 목록만 돌려주므로
 * 돈 흐름의 단일 경로가 구조적으로 강제된다.
 *
 * `amount`는 **주체(playerId) 기준 부호**다: +면 수령, −면 지불.
 */
export class MoneyIntent {
  #playerId;
  #amount;
  #counterparty;
  #otherPlayerId;
  #reason;
  #meta;

  constructor({ playerId, amount, counterparty, otherPlayerId = null, reason, meta = null }) {
    assertSeatId(playerId, '주체 좌석');
    assertSignedAmount(amount, '이동 금액');
    if (!Object.values(COUNTERPARTIES).includes(counterparty)) {
      throw DomainError.invalidArgument(`알 수 없는 상대방입니다: ${String(counterparty)}`);
    }
    if (!REASON_LIST.includes(reason)) {
      throw DomainError.invalidArgument(`알 수 없는 돈 이동 사유입니다: ${String(reason)}`);
    }
    if (counterparty === COUNTERPARTIES.PLAYER) {
      assertSeatId(otherPlayerId, '상대 좌석');
      if (otherPlayerId === playerId) {
        throw DomainError.invalidArgument(`자기 자신에게 돈을 옮길 수 없습니다: ${playerId}`);
      }
    } else if (otherPlayerId !== null) {
      throw DomainError.invalidArgument(`${counterparty} 이동에는 상대 좌석이 없어야 합니다`);
    }
    if (meta !== null && (typeof meta !== 'object' || Array.isArray(meta))) {
      throw DomainError.invalidArgument('meta는 객체여야 합니다');
    }
    this.#playerId = playerId;
    this.#amount = amount;
    this.#counterparty = counterparty;
    this.#otherPlayerId = otherPlayerId;
    this.#reason = reason;
    this.#meta = meta === null ? null : { ...meta };
  }

  get playerId() {
    return this.#playerId;
  }

  /** +면 주체가 수령, −면 주체가 지불. */
  get amount() {
    return this.#amount;
  }

  get counterparty() {
    return this.#counterparty;
  }

  get otherPlayerId() {
    return this.#otherPlayerId;
  }

  get reason() {
    return this.#reason;
  }

  /** 보고/로그용 부가 정보(사본). */
  get meta() {
    return this.#meta === null ? null : { ...this.#meta };
  }

  /** 은행 장부에 기록되는 이동인지(= 돈의 총합을 바꾸는 이동인지). */
  get affectsLedger() {
    return LEDGER_COUNTERPARTIES.includes(this.#counterparty);
  }

  // ── 팩토리(읽는 쪽에서 부호를 헷갈리지 않게 한다) ─────────────────────────

  /** 은행에 지불. */
  static toBank({ playerId, amount, reason, meta }) {
    return MoneyIntent.#signed({ playerId, amount, sign: -1, counterparty: COUNTERPARTIES.BANK, reason, meta });
  }

  /** 은행에서 수령. */
  static fromBank({ playerId, amount, reason, meta }) {
    return MoneyIntent.#signed({ playerId, amount, sign: 1, counterparty: COUNTERPARTIES.BANK, reason, meta });
  }

  /** 거래소에 지불(은행 창구와 같은 장부). */
  static toExchange({ playerId, amount, reason, meta }) {
    return MoneyIntent.#signed({
      playerId,
      amount,
      sign: -1,
      counterparty: COUNTERPARTIES.EXCHANGE,
      reason,
      meta,
    });
  }

  /** 거래소에서 수령. */
  static fromExchange({ playerId, amount, reason, meta }) {
    return MoneyIntent.#signed({
      playerId,
      amount,
      sign: 1,
      counterparty: COUNTERPARTIES.EXCHANGE,
      reason,
      meta,
    });
  }

  /** 잭팟에 적립. */
  static toJackpot({ playerId, amount, reason, meta }) {
    return MoneyIntent.#signed({
      playerId,
      amount,
      sign: -1,
      counterparty: COUNTERPARTIES.JACKPOT,
      reason,
      meta,
    });
  }

  /** 잭팟에서 수령. */
  static fromJackpot({ playerId, amount, reason, meta }) {
    return MoneyIntent.#signed({
      playerId,
      amount,
      sign: 1,
      counterparty: COUNTERPARTIES.JACKPOT,
      reason,
      meta,
    });
  }

  /** 좌석 간 이동(지불자 기준 intent 하나로 양쪽을 함께 옮긴다). */
  static transfer({ fromId, toId, amount, reason, meta }) {
    assertAmount(amount, '이동 금액');
    return new MoneyIntent({
      playerId: fromId,
      amount: amount === 0 ? 0 : -amount,
      counterparty: COUNTERPARTIES.PLAYER,
      otherPlayerId: toId,
      reason,
      meta,
    });
  }

  static #signed({ playerId, amount, sign, counterparty, reason, meta }) {
    assertAmount(amount, '이동 금액');
    // 0에 부호를 붙이면 -0이 되고, -0은 스냅샷·비교에서 0과 다르게 보일 수 있다.
    const signed = amount === 0 ? 0 : sign * amount;
    return new MoneyIntent({ playerId, amount: signed, counterparty, reason, meta });
  }
}

function assertSeatId(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw DomainError.invalidArgument(`${label} 식별자가 올바르지 않습니다: ${String(value)}`);
  }
}
