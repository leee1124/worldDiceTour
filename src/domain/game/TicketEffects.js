import { EVENT_TYPES } from './events.js';
import { MONEY_REASONS } from '../shared/MoneyIntent.js';
import { SINKS } from './payment/DebtNote.js';
import { TICKET_EFFECTS } from './data/tickets.js';

/**
 * 행운 티켓 한 장이 요구하는 행동.
 * Game은 이 목록만 보고 상태기계를 움직인다 — 금액·대상·사유를 **계산하지 않는다**.
 */
export const TICKET_ACTIONS = Object.freeze({
  /** 아무 일도 없다(턴 종료). */
  NONE: 'NONE',
  /** 은행에서 수령: `amount` */
  GAIN: 'GAIN',
  /** 강제 지불: `items`/`reason`/`event`가 그대로 결제 흐름으로 들어간다. */
  CHARGE: 'CHARGE',
  /** 다른 모든 생존 좌석에게서 정액 징수: `amount` */
  COLLECT_FROM_ALL: 'COLLECT_FROM_ALL',
  /** 다른 모든 생존 좌석에게 정액 지불: `amount` */
  PAY_TO_ALL: 'PAY_TO_ALL',
  /** 앞으로 `steps`칸 이동(도착 칸 효과 정상 적용). */
  MOVE: 'MOVE',
  /** 조난 섬으로 이송. */
  TO_ISLAND: 'TO_ISLAND',
});

/** 세무조사 납부는 잭팟에 적립된다(명세 D13). */
const TAX_SINK = SINKS.JACKPOT;

/**
 * 행운 티켓 효과 해석기.
 *
 * "이 카드가 얼마를 어디로 움직이는가"를 계산하는 **순수 도메인 서비스**다. 상태를 바꾸지 않고
 * 행동 지시만 돌려주므로, 티켓이 20장에서 40장이 되어도 Game은 바뀌지 않는다.
 */
export class TicketEffects {
  /**
   * @param {{ticket: {id:string, effect:object}, player: import('./Player.js').Player, board: import('./Board.js').Board}} params
   * @returns {{action: string, amount?: number, steps?: number, items?: object[], reason?: string, event?: object}}
   */
  resolve({ ticket, player, board }) {
    const { effect } = ticket;
    switch (effect.type) {
      case TICKET_EFFECTS.GAIN:
        return { action: TICKET_ACTIONS.GAIN, amount: effect.amount };
      case TICKET_EFFECTS.GAIN_PER_CITY:
        return {
          action: TICKET_ACTIONS.GAIN,
          amount: board.cityCountOf(player.id) * effect.amount,
        };
      case TICKET_EFFECTS.LOSE:
        return this.#charge({ ticket, player, amount: effect.amount, sink: SINKS.BANK });
      case TICKET_EFFECTS.PAY_PER_BUILDING:
        return this.#charge({
          ticket,
          player,
          amount: board.buildingCountOf(player.id) * effect.amount,
          sink: SINKS.BANK,
        });
      case TICKET_EFFECTS.TAX_RATE:
        return this.#charge({
          ticket,
          player,
          amount: Math.floor(player.cash * effect.rate),
          sink: TAX_SINK,
        });
      case TICKET_EFFECTS.COLLECT_FROM_ALL:
        return { action: TICKET_ACTIONS.COLLECT_FROM_ALL, amount: effect.amount };
      case TICKET_EFFECTS.PAY_TO_ALL:
        return { action: TICKET_ACTIONS.PAY_TO_ALL, amount: effect.amount };
      case TICKET_EFFECTS.MOVE_RELATIVE:
        return { action: TICKET_ACTIONS.MOVE, steps: effect.steps };
      case TICKET_EFFECTS.MOVE_TO:
        return {
          action: TICKET_ACTIONS.MOVE,
          steps: board.stepsTo(player.position, effect.index),
        };
      case TICKET_EFFECTS.NEAREST_RESORT:
        return {
          action: TICKET_ACTIONS.MOVE,
          steps: board.stepsTo(player.position, board.nearestResortFrom(player.position)),
        };
      case TICKET_EFFECTS.TO_ISLAND:
        return { action: TICKET_ACTIONS.TO_ISLAND };
      default:
        return { action: TICKET_ACTIONS.NONE };
    }
  }

  /**
   * 지불 지시. 잭팟으로 가는 지불(세무조사)은 사유와 이벤트가 다르다 —
   * 이 구분이 티켓의 규칙이므로 Game이 아니라 여기서 정한다.
   */
  #charge({ ticket, player, amount, sink }) {
    const isTax = sink === TAX_SINK;
    const reason = isTax ? MONEY_REASONS.TAX : MONEY_REASONS.TICKET;
    return {
      action: TICKET_ACTIONS.CHARGE,
      amount,
      items: [{ amount, sink, toPlayerId: null }],
      reason,
      event: isTax
        ? {
            type: EVENT_TYPES.TAX_PAID,
            payload: { playerId: player.id, amount, ticketId: ticket.id },
          }
        : {
            type: EVENT_TYPES.MONEY_LOST,
            payload: { playerId: player.id, amount, reason, ticketId: ticket.id },
          },
    };
  }
}
