import { DomainError } from '../../shared/DomainError.js';
import { MONEY_REASONS, MoneyIntent } from '../../shared/MoneyIntent.js';
import { assertAmount } from '../../shared/Money.js';

/** 돈이 향하는 곳. 저장 스냅샷 검증(RoomSerializer)도 이 목록을 쓴다. */
export const SINKS = Object.freeze({ PLAYER: 'PLAYER', BANK: 'BANK', JACKPOT: 'JACKPOT' });

/** 지불이 끝난 뒤 이어질 흐름. 저장 스냅샷 검증도 이 목록을 쓴다. */
export const CONTINUATIONS = Object.freeze({ TURN_END: 'TURN_END', ACQUIRE: 'ACQUIRE' });

const SINK_LIST = Object.freeze(Object.values(SINKS));
const REASON_LIST = Object.freeze(Object.values(MONEY_REASONS));

/**
 * 채무 증서(Value Object). "누가 얼마를 누구에게 내야 하고, 다 내면 무엇으로 이어지는가"를 담는다.
 *
 * 한 건의 강제 지불이 여러 항목일 수 있다(「한턱 쏘기」처럼 채권자가 여러 명). 증서는
 * 합계·대표 채권자·돈 이동 의사를 스스로 계산하며, 저장 형태(`toSnapshot`)를 고정한다.
 */
export class DebtNote {
  #reason;
  #items;
  #event;
  #next;

  constructor({ reason, items, event, next = { kind: CONTINUATIONS.TURN_END } }) {
    if (!REASON_LIST.includes(reason)) {
      throw DomainError.invalidArgument(`알 수 없는 채무 사유입니다: ${String(reason)}`);
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw DomainError.invalidArgument('채무 항목이 비어 있습니다');
    }
    for (const item of items) {
      assertAmount(item?.amount, '채무 금액');
      if (!SINK_LIST.includes(item.sink)) {
        throw DomainError.invalidArgument(`알 수 없는 채무 대상입니다: ${String(item?.sink)}`);
      }
    }
    if (!event || typeof event.type !== 'string' || typeof event.payload !== 'object') {
      throw DomainError.invalidArgument('채무에는 발행할 이벤트가 필요합니다');
    }
    if (!next || !Object.values(CONTINUATIONS).includes(next.kind)) {
      throw DomainError.invalidArgument(`알 수 없는 이어하기입니다: ${String(next?.kind)}`);
    }
    this.#reason = reason;
    this.#items = items.map((item) => ({
      amount: item.amount,
      sink: item.sink,
      toPlayerId: item.toPlayerId ?? null,
    }));
    this.#event = event;
    this.#next = next;
  }

  /** 저장 스냅샷에서 복원한다. */
  static restore(raw) {
    return new DebtNote({
      reason: raw.reason,
      items: raw.items,
      event: raw.event,
      next: raw.next ?? { kind: CONTINUATIONS.TURN_END },
    });
  }

  get reason() {
    return this.#reason;
  }

  get items() {
    return this.#items.map((item) => ({ ...item }));
  }

  get event() {
    return this.#event;
  }

  get next() {
    return { ...this.#next };
  }

  /** 메워야 하는 총액. */
  get total() {
    return this.#items.reduce((sum, item) => sum + item.amount, 0);
  }

  /**
   * 대표 채권자(기존 DTO/이벤트 계약). 은행·잭팟 채무면 `null`이다.
   * 여러 명일 수 있으므로 "대표"이며, 실제 분배는 `MONEY_TRANSFERRED` 이벤트들에 있다.
   */
  get primaryCreditorId() {
    return this.#items.find((item) => item.sink === SINKS.PLAYER)?.toPlayerId ?? null;
  }

  /** 항목 중 잭팟으로 가는 것이 있는지(파산 시 남은 현금의 행선지 판단에 쓴다). */
  get hasJackpotSink() {
    return this.#items.some((item) => item.sink === SINKS.JACKPOT);
  }

  /** 돈을 받을 좌석 id 목록(중복 제거, 등장 순서). */
  creditorIds() {
    const ids = [];
    for (const item of this.#items) {
      if (item.sink === SINKS.PLAYER && item.toPlayerId && !ids.includes(item.toPlayerId)) {
        ids.push(item.toPlayerId);
      }
    }
    return ids;
  }

  /**
   * 돈 이동 의사로 바꾼다. 받을 사람이 탈락했거나 없으면 **은행이 받는다**
   * (탈락한 좌석에 돈을 주면 `eliminate()`에서 사라져 보존 불변식이 깨진다).
   * @param {{payerId:string, findPlayer:(id:string)=>object|null}} params
   */
  toIntents({ payerId, findPlayer }) {
    return this.#items.map((item) => {
      if (item.sink === SINKS.JACKPOT) {
        return MoneyIntent.toJackpot({ playerId: payerId, amount: item.amount, reason: this.#reason });
      }
      if (item.sink === SINKS.PLAYER) {
        const creditor = findPlayer(item.toPlayerId);
        if (creditor && !creditor.eliminated) {
          return MoneyIntent.transfer({
            fromId: payerId,
            toId: creditor.id,
            amount: item.amount,
            reason: this.#reason,
          });
        }
      }
      return MoneyIntent.toBank({ playerId: payerId, amount: item.amount, reason: this.#reason });
    });
  }

  /** 저장 형태(깊은 사본). 스냅샷 검증기가 이 모양을 검사한다. */
  toSnapshot() {
    return {
      reason: this.#reason,
      items: this.#items.map((item) => ({ ...item })),
      event: { type: this.#event.type, payload: { ...this.#event.payload } },
      next: { ...this.#next },
    };
  }
}
