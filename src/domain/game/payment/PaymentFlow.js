import { DomainError } from '../../shared/DomainError.js';
import { EVENT_TYPES } from '../events.js';
import { CONTINUATIONS, DebtNote } from './DebtNote.js';

/** 강제 지불 한 걸음의 결과. */
export const PAYMENT_OUTCOMES = Object.freeze({
  /** 낼 것이 없었다 — 채무를 만들지 않고 흐름만 이어간다. */
  NOTHING_DUE: 'NOTHING_DUE',
  /** 정산이 끝났다 — `next`로 흐름을 이어간다. */
  SETTLED: 'SETTLED',
  /** 현금이 부족하다 — 정리(AWAIT_LIQUIDATION) 페이즈가 필요하다. */
  LIQUIDATION_REQUIRED: 'LIQUIDATION_REQUIRED',
});

/**
 * 강제 지불 흐름: **지불 → (부족하면) 정리 → 정산 → 이어하기**.
 *
 * 진행 중인 채무 증서(`DebtNote`)를 쥐고 있으며, 돈은 `Treasury`로만 옮긴다. 페이즈 전이는
 * 하지 않고 "무엇이 필요한지"(결과 종류 + 발행할 이벤트 + 이어갈 흐름)만 돌려준다 —
 * 상태기계는 Game의 몫이다. 앞으로 주식·예금·파생이 정리 대상에 더해져도 이 흐름은 그대로다.
 */
export class PaymentFlow {
  /** @type {import('../Treasury.js').Treasury} */
  #treasury;
  #findPlayer;
  /** @type {DebtNote|null} */
  #note = null;

  constructor({ treasury, findPlayer }) {
    this.#treasury = treasury;
    this.#findPlayer = findPlayer;
  }

  get hasDebt() {
    return this.#note !== null;
  }

  /** @type {DebtNote|null} */
  get note() {
    return this.#note;
  }

  get amountDue() {
    return this.#note?.total ?? 0;
  }

  get primaryCreditorId() {
    return this.#note?.primaryCreditorId ?? null;
  }

  /**
   * 정리 페이즈 커맨드의 공통 전제: 메워야 할 채무가 실제로 있어야 한다.
   * 손상된 스냅샷이 "정리 페이즈인데 채무 없음"으로 들어오면 원시 TypeError가 클라이언트까지
   * 올라가 ERR010(500)이 되므로, 여기서 규격 도메인 오류로 막는다.
   */
  assertPendingDebt() {
    if (!this.#note) {
      throw DomainError.invalidState('메워야 할 채무가 없습니다(정리 페이즈 상태가 손상됨)');
    }
    return this.#note;
  }

  /**
   * 강제 지불을 시작한다.
   * @param {{payer: object, items: object[], reason: string, event: object, next?: object, inLiquidation?: boolean}} params
   * @returns {{outcome:string, events:object[], next?:object, amountDue?:number, creditorId?:string|null}}
   */
  charge({ payer, items, reason, event, next = { kind: CONTINUATIONS.TURN_END }, inLiquidation = false }) {
    const total = items.reduce((sum, item) => sum + (item?.amount ?? 0), 0);
    if (total <= 0) {
      return { outcome: PAYMENT_OUTCOMES.NOTHING_DUE, events: [], next };
    }

    this.#note = new DebtNote({ reason, items, event, next });

    if (payer.canPay(total)) {
      return this.settle({ payer, inLiquidation });
    }

    return {
      outcome: PAYMENT_OUTCOMES.LIQUIDATION_REQUIRED,
      events: [
        {
          type: EVENT_TYPES.LIQUIDATION_REQUIRED,
          payload: {
            playerId: payer.id,
            amountDue: total,
            creditorId: this.#note.primaryCreditorId,
            reason,
          },
        },
      ],
      amountDue: total,
      creditorId: this.#note.primaryCreditorId,
    };
  }

  /**
   * 채무를 정산한다.
   *
   * `inLiquidation`(정리 페이즈를 거친 지불)이면 `DEBT_SETTLED`를 남기고 이어하기를
   * **턴 종료로 바꾼다** — 인수는 보유 현금으로만 할 수 있으므로(명세 4장) 매각·대출로 만든
   * 돈으로 인수하는 길을 막는다.
   */
  settle({ payer, inLiquidation = false }) {
    const note = this.assertPendingDebt();
    const { jackpotChanged } = this.#treasury.apply(
      note.toIntents({ payerId: payer.id, findPlayer: this.#findPlayer }),
    );

    const events = [{ type: note.event.type, payload: note.event.payload }];
    if (jackpotChanged) {
      events.push({
        type: EVENT_TYPES.JACKPOT_CHANGED,
        payload: { jackpot: this.#treasury.jackpot },
      });
    }
    if (inLiquidation) {
      events.push({
        type: EVENT_TYPES.DEBT_SETTLED,
        payload: { playerId: payer.id, amount: note.total },
      });
    }

    const next = inLiquidation ? { kind: CONTINUATIONS.TURN_END } : note.next;
    this.#note = null;
    return { outcome: PAYMENT_OUTCOMES.SETTLED, events, next };
  }

  /**
   * 정리 페이즈에서 한 걸음 진행한 뒤 호출한다. 채무를 덮을 수 있으면 자동 정산하고,
   * 아직 부족하면 `null`을 돌려준다(정리 페이즈를 계속한다).
   */
  settleIfAffordable({ payer, inLiquidation = true }) {
    const note = this.assertPendingDebt();
    return payer.canPay(note.total) ? this.settle({ payer, inLiquidation }) : null;
  }

  clear() {
    this.#note = null;
  }

  restore(raw) {
    this.#note = raw === null || raw === undefined ? null : DebtNote.restore(raw);
  }

  toSnapshot() {
    return this.#note ? this.#note.toSnapshot() : null;
  }
}
