import { EVENT_TYPES } from './events.js';
import { MONEY_REASONS, MoneyIntent } from '../shared/MoneyIntent.js';
import { SINKS } from './payment/DebtNote.js';
import { TICKET_EFFECTS } from './data/tickets.js';

/**
 * 행운 티켓 한 장이 요구하는 행동.
 * Game은 이 목록만 보고 상태기계를 움직인다 — 금액·대상·사유를 **계산하지 않는다**.
 */
export const TICKET_ACTIONS = Object.freeze({
  /** 아무 일도 없다(턴 종료). */
  NONE: 'NONE',
  /** 돈이 곧바로 움직인다: `intents`/`events`를 적용한 뒤 턴 종료. */
  SETTLE: 'SETTLE',
  /** 강제 지불(현금이 부족하면 정리 페이즈): `items`/`reason`/`event`가 결제 흐름으로 들어간다. */
  CHARGE: 'CHARGE',
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
   * @param {object} params
   * @param {{id:string, effect:object}} params.ticket
   * @param {import('./Player.js').Player} params.player
   * @param {import('./Board.js').Board} params.board
   * @param {import('./Player.js').Player[]} params.livingPlayers 탈락하지 않은 좌석(좌석 순서)
   * @returns {{action: string, amount?: number, steps?: number, items?: object[], reason?: string, event?: object, intents?: object[], events?: object[]}}
   */
  resolve({ ticket, player, board, livingPlayers = [] }) {
    const { effect } = ticket;
    switch (effect.type) {
      case TICKET_EFFECTS.GAIN:
        return this.#gain({ ticket, player, amount: effect.amount });
      case TICKET_EFFECTS.GAIN_PER_CITY:
        return this.#gain({
          ticket,
          player,
          amount: board.cityCountOf(player.id) * effect.amount,
        });
      case TICKET_EFFECTS.COLLECT_FROM_ALL:
        return this.#collectFromAll({ ticket, player, livingPlayers, amount: effect.amount });
      case TICKET_EFFECTS.PAY_TO_ALL:
        return this.#payToAll({ ticket, player, livingPlayers, amount: effect.amount });
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

  /** 은행에서 수령. 0원이면 아무 일도 일어나지 않는다. */
  #gain({ ticket, player, amount }) {
    if (amount <= 0) {
      return { action: TICKET_ACTIONS.NONE };
    }
    const reason = MONEY_REASONS.TICKET;
    return {
      action: TICKET_ACTIONS.SETTLE,
      amount,
      intents: [
        MoneyIntent.fromBank({
          playerId: player.id,
          amount,
          reason,
          meta: { ticketId: ticket.id },
        }),
      ],
      events: [
        {
          type: EVENT_TYPES.MONEY_GAINED,
          payload: { playerId: player.id, amount, reason, ticketId: ticket.id },
        },
      ],
    };
  }

  /**
   * 「생일 축하」: 다른 모든 생존 좌석에게서 정액을 받는다.
   *
   * **각자 보유 현금 한도까지만** 받는다(명세 D6) — 자기 턴이 아닌 좌석을 정리 페이즈로 보낼 수
   * 없기 때문이다. 이 한도 규칙이 티켓의 규칙이므로 Game이 아니라 여기에 있다.
   * 실제로 낸 금액이 0원이어도 이벤트는 남긴다(누가 얼마를 냈는지 로그에 보여야 한다).
   */
  #collectFromAll({ ticket, player, livingPlayers, amount }) {
    const reason = MONEY_REASONS.TICKET;
    const meta = { ticketId: ticket.id };
    const paid = livingPlayers
      .filter((other) => other.id !== player.id)
      .map((other) => ({ other, amount: Math.min(amount, other.cash) }));

    return {
      action: TICKET_ACTIONS.SETTLE,
      amount: paid.reduce((sum, entry) => sum + entry.amount, 0),
      intents: paid.map((entry) =>
        MoneyIntent.transfer({
          fromId: entry.other.id,
          toId: player.id,
          amount: entry.amount,
          reason,
          meta,
        }),
      ),
      events: paid.map((entry) => ({
        type: EVENT_TYPES.MONEY_TRANSFERRED,
        payload: {
          fromId: entry.other.id,
          toId: player.id,
          amount: entry.amount,
          reason,
          ticketId: ticket.id,
        },
      })),
    };
  }

  /**
   * 「한턱 쏘기」: 다른 모든 생존 좌석에게 정액을 지불한다.
   * 받을 사람 수만큼의 항목을 가진 **하나의 채무**다 — 현금이 부족하면 정리 페이즈로 간다.
   */
  #payToAll({ ticket, player, livingPlayers, amount }) {
    const receivers = livingPlayers.filter((other) => other.id !== player.id);
    if (receivers.length === 0 || amount <= 0) {
      return { action: TICKET_ACTIONS.NONE };
    }
    const reason = MONEY_REASONS.TICKET;
    return {
      action: TICKET_ACTIONS.CHARGE,
      amount: amount * receivers.length,
      items: receivers.map((receiver) => ({
        amount,
        sink: SINKS.PLAYER,
        toPlayerId: receiver.id,
      })),
      reason,
      event: {
        type: EVENT_TYPES.MONEY_LOST,
        payload: {
          playerId: player.id,
          amount: amount * receivers.length,
          reason,
          ticketId: ticket.id,
          toPlayerIds: receivers.map((receiver) => receiver.id),
        },
      },
    };
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
