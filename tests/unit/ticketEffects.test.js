import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Board } from '../../src/domain/game/Board.js';
import { Casino } from '../../src/domain/game/Casino.js';
import { Player } from '../../src/domain/game/Player.js';
import { TICKET_ACTIONS, TicketEffects } from '../../src/domain/game/TicketEffects.js';
import { SINKS } from '../../src/domain/game/payment/DebtNote.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { COUNTERPARTIES, MONEY_REASONS } from '../../src/domain/shared/MoneyIntent.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';
import { TICKET_EFFECTS } from '../../src/domain/game/data/tickets.js';

const effects = new TicketEffects();
const ticket = (effect, id = 'T01') => ({ id, text: '테스트 티켓', effect });

function scene({
  cash = { s1: 1_000_000, s2: 1_000_000, s3: 1_000_000 },
  cities = [],
  positions = {},
  jackpot = 0,
} = {}) {
  const players = Object.entries(cash).map(
    ([id, amount]) =>
      new Player({ id, name: id, cash: amount, position: positions[id] ?? 0 }),
  );
  return {
    players,
    board: Board.restore(cities),
    casino: new Casino({ jackpot }),
    byId: (id) => players.find((player) => player.id === id),
  };
}

const resolve = (effect, { player, board, players, casino, ticketId = 'T01' }) =>
  effects.resolve({
    ticket: ticket(effect, ticketId),
    player,
    board,
    casino,
    livingPlayers: players,
  });

describe('TicketEffects(행운 티켓 효과 규칙)', () => {
  describe('수령', () => {
    it('정액 수령은 은행에서 오는 돈이다', () => {
      // Given
      const { byId, board, players } = scene();

      // When
      const action = resolve({ type: TICKET_EFFECTS.GAIN, amount: 100_000 }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then
      assert.equal(action.action, TICKET_ACTIONS.SETTLE);
      assert.equal(action.intents[0].amount, 100_000);
      assert.equal(action.intents[0].reason, MONEY_REASONS.TICKET);
      assert.equal(action.events[0].type, EVENT_TYPES.MONEY_GAINED);
      assert.equal(action.events[0].payload.ticketId, 'T01');
    });

    it('도시 수만큼 받는 티켓은 보유 도시 수를 곱한다(휴양지는 제외)', () => {
      // Given (1·39는 도시, 5는 휴양지)
      const { byId, board, players } = scene({
        cities: [
          { index: 1, ownerId: 's1', buildings: [], landmark: false },
          { index: 39, ownerId: 's1', buildings: [], landmark: false },
          { index: 5, ownerId: 's1', buildings: [], landmark: false },
        ],
      });

      // When
      const action = resolve({ type: TICKET_EFFECTS.GAIN_PER_CITY, amount: 30_000 }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then
      assert.equal(action.intents[0].amount, 60_000);
    });

    it('금액이 0이면 아무 일도 일어나지 않는다', () => {
      // Given
      const { byId, board, players } = scene();

      // When
      const action = resolve({ type: TICKET_EFFECTS.GAIN_PER_CITY, amount: 30_000 }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then
      assert.equal(action.action, TICKET_ACTIONS.NONE);
    });
  });

  describe('「생일 축하」: 다른 모두에게서 받기', () => {
    it('각자 보유 현금 한도까지만 받는다(명세 D6)', () => {
      // Given (자기 턴이 아닌 좌석을 정리 페이즈로 보낼 수 없으므로 현금 한도가 상한이다)
      const { byId, board, players } = scene({ cash: { s1: 0, s2: 20_000, s3: 1_000_000 } });

      // When
      const action = resolve({ type: TICKET_EFFECTS.COLLECT_FROM_ALL, amount: 50_000 }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then
      assert.equal(action.action, TICKET_ACTIONS.SETTLE);
      assert.deepEqual(
        action.intents.map((intent) => [intent.playerId, intent.otherPlayerId, intent.amount]),
        [
          ['s2', 's1', -20_000],
          ['s3', 's1', -50_000],
        ],
      );
      assert.equal(action.amount, 70_000, '실제로 걷힌 합계');
    });

    it('현금이 0원인 좌석도 이벤트는 남긴다(누가 얼마 냈는지 로그에 보인다)', () => {
      // Given
      const { byId, board, players } = scene({ cash: { s1: 0, s2: 0, s3: 10_000 } });

      // When
      const action = resolve({ type: TICKET_EFFECTS.COLLECT_FROM_ALL, amount: 50_000 }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then
      assert.deepEqual(
        action.events.map((event) => [event.payload.fromId, event.payload.amount]),
        [
          ['s2', 0],
          ['s3', 10_000],
        ],
      );
      assert.equal(
        action.events.every((event) => event.type === EVENT_TYPES.MONEY_TRANSFERRED),
        true,
      );
    });

    it('자기 자신에게서는 걷지 않는다', () => {
      // Given
      const { byId, board, players } = scene();

      // When
      const action = resolve({ type: TICKET_EFFECTS.COLLECT_FROM_ALL, amount: 50_000 }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then
      assert.equal(
        action.intents.some((intent) => intent.playerId === 's1'),
        false,
      );
      assert.equal(action.intents.length, 2);
    });
  });

  describe('「한턱 쏘기」: 다른 모두에게 주기', () => {
    it('받을 사람 수만큼의 항목을 가진 하나의 채무가 된다', () => {
      // Given
      const { byId, board, players } = scene();

      // When
      const action = resolve({ type: TICKET_EFFECTS.PAY_TO_ALL, amount: 30_000 }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then (현금이 부족하면 정리 페이즈로 가야 하므로 CHARGE다)
      assert.equal(action.action, TICKET_ACTIONS.CHARGE);
      assert.equal(action.amount, 60_000);
      assert.deepEqual(action.items, [
        { amount: 30_000, sink: SINKS.PLAYER, toPlayerId: 's2' },
        { amount: 30_000, sink: SINKS.PLAYER, toPlayerId: 's3' },
      ]);
      assert.equal(action.event.type, EVENT_TYPES.MONEY_LOST);
      assert.deepEqual(action.event.payload.toPlayerIds, ['s2', 's3']);
      assert.equal(action.event.payload.amount, 60_000, '이벤트 금액은 합계다');
    });

    it('받을 사람이 없으면 아무 일도 일어나지 않는다', () => {
      // Given
      const { byId, board, players } = scene({ cash: { s1: 1_000_000 } });

      // When
      const action = resolve({ type: TICKET_EFFECTS.PAY_TO_ALL, amount: 30_000 }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then
      assert.equal(action.action, TICKET_ACTIONS.NONE);
    });
  });

  describe('지불', () => {
    it('은행에 내는 지불과 잭팟에 쌓이는 세무조사는 사유와 이벤트가 다르다', () => {
      // Given
      const { byId, board, players } = scene({ cash: { s1: 1_000_000, s2: 1 } });

      // When
      const lose = resolve({ type: TICKET_EFFECTS.LOSE, amount: 50_000 }, {
        player: byId('s1'),
        board,
        players,
      });
      const tax = resolve({ type: TICKET_EFFECTS.TAX_RATE, rate: 0.05 }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then
      assert.equal(lose.items[0].sink, SINKS.BANK);
      assert.equal(lose.reason, MONEY_REASONS.TICKET);
      assert.equal(lose.event.type, EVENT_TYPES.MONEY_LOST);

      assert.equal(tax.items[0].sink, SINKS.JACKPOT, '세무조사 납부는 잭팟에 쌓인다(D13)');
      assert.equal(tax.reason, MONEY_REASONS.TAX);
      assert.equal(tax.event.type, EVENT_TYPES.TAX_PAID);
      assert.equal(tax.amount, 50_000, '현금의 5%(내림)');
    });

    it('건물 수만큼 내는 티켓은 랜드마크까지 센다', () => {
      // Given (별장·빌딩·호텔·랜드마크 = 4)
      const { byId, board, players } = scene({
        cities: [
          { index: 1, ownerId: 's1', buildings: ['VILLA', 'BUILDING', 'HOTEL'], landmark: true },
        ],
      });

      // When
      const action = resolve({ type: TICKET_EFFECTS.PAY_PER_BUILDING, amount: 40_000 }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then
      assert.equal(action.amount, 160_000);
    });
  });

  describe('「잭팟 당첨권」·「잭팟 나눔 행사」: 적립금 수령', () => {
    it('지분 100%는 적립금 전액을 받고 적립금을 비운다', () => {
      // Given
      const { byId, board, players, casino } = scene({ jackpot: 326_500 });

      // When
      const action = resolve(
        { type: TICKET_EFFECTS.CLAIM_JACKPOT, share: 100 },
        { player: byId('s1'), board, players, casino, ticketId: 'T21' },
      );

      // Then
      assert.equal(action.action, TICKET_ACTIONS.SETTLE);
      assert.equal(action.amount, 326_500);
      assert.equal(action.intents.length, 1);
      assert.equal(action.intents[0].amount, 326_500);
      assert.equal(action.intents[0].counterparty, COUNTERPARTIES.JACKPOT);
      assert.equal(action.intents[0].reason, MONEY_REASONS.TICKET);
      assert.deepEqual(action.events, [
        {
          type: EVENT_TYPES.JACKPOT_CLAIMED,
          payload: { playerId: 's1', amount: 326_500, share: 100, remaining: 0 },
        },
      ]);
    });

    it('지분 50%는 내림으로 받고 나머지는 적립금에 남는다', () => {
      // Given (홀수 금액)
      const { byId, board, players, casino } = scene({ jackpot: 125_001 });

      // When
      const action = resolve(
        { type: TICKET_EFFECTS.CLAIM_JACKPOT, share: 50 },
        { player: byId('s1'), board, players, casino, ticketId: 'T22' },
      );

      // Then
      assert.equal(action.amount, 62_500);
      assert.equal(action.events[0].payload.remaining, 62_501);
      assert.equal(action.events[0].payload.share, 50);
    });

    it('카지노 없이 수령 티켓을 해석하려 하면 도메인 오류로 막는다', () => {
      // Given (협력자를 빠뜨린 호출 — 500이 아니라 규격 오류로 드러나야 한다)
      const { byId, board, players } = scene({ jackpot: 100_000 });

      // When / Then
      assert.throws(
        () =>
          effects.resolve({
            ticket: { id: 'T21', text: '테스트 티켓', effect: { type: TICKET_EFFECTS.CLAIM_JACKPOT, share: 100 } },
            player: byId('s1'),
            board,
            livingPlayers: players,
          }),
        DomainError,
      );
    });

    it('적립금이 0원이면 돈은 움직이지 않고 금액 0원 이벤트만 남긴다', () => {
      // Given (위로금은 없다 — 경제를 깨끗하게 유지한다)
      const { byId, board, players, casino } = scene({ jackpot: 0 });

      // When
      const action = resolve(
        { type: TICKET_EFFECTS.CLAIM_JACKPOT, share: 100 },
        { player: byId('s1'), board, players, casino, ticketId: 'T21' },
      );

      // Then
      assert.equal(action.action, TICKET_ACTIONS.SETTLE);
      assert.equal(action.amount, 0);
      assert.deepEqual(action.intents, []);
      assert.deepEqual(action.events, [
        {
          type: EVENT_TYPES.JACKPOT_CLAIMED,
          payload: { playerId: 's1', amount: 0, share: 100, remaining: 0 },
        },
      ]);
    });
  });

  describe('이동', () => {
    it('상대 이동은 걸음 수를 그대로 전달한다', () => {
      // Given
      const { byId, board, players } = scene();

      // When
      const action = resolve({ type: TICKET_EFFECTS.MOVE_RELATIVE, steps: 3 }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then
      assert.deepEqual(action, { action: TICKET_ACTIONS.MOVE, steps: 3 });
    });

    it('특정 칸/가장 가까운 휴양지는 앞 방향 걸음 수로 바뀐다', () => {
      // Given (지금 3번 칸. 가장 가까운 휴양지는 5번)
      const { byId, board, players } = scene({ positions: { s1: 3 } });

      // When
      const moveTo = resolve({ type: TICKET_EFFECTS.MOVE_TO, index: 0 }, {
        player: byId('s1'),
        board,
        players,
      });
      const resort = resolve({ type: TICKET_EFFECTS.NEAREST_RESORT }, {
        player: byId('s1'),
        board,
        players,
      });

      // Then
      assert.equal(moveTo.steps, 37, '출발 칸으로 직행(앞 방향이라 월급을 받는다)');
      assert.equal(resort.steps, 2);
    });

    it('조난 이송과 알 수 없는 효과는 각자 제 행동으로 바뀐다', () => {
      // Given
      const { byId, board, players } = scene();

      // When / Then
      assert.equal(
        resolve({ type: TICKET_EFFECTS.TO_ISLAND }, { player: byId('s1'), board, players }).action,
        TICKET_ACTIONS.TO_ISLAND,
      );
      assert.equal(
        resolve({ type: 'FUTURE_EFFECT' }, { player: byId('s1'), board, players }).action,
        TICKET_ACTIONS.NONE,
      );
    });
  });
});
