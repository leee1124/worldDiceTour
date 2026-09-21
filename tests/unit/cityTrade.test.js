import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Board } from '../../src/domain/game/Board.js';
import { CityTrade } from '../../src/domain/game/CityTrade.js';
import { Player } from '../../src/domain/game/Player.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { MONEY_REASONS } from '../../src/domain/shared/MoneyIntent.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';

const types = (events) => events.map((event) => event.type);

function build({ cities = [], cash = { s1: 1_000_000, s2: 1_000_000 }, eliminated = [] } = {}) {
  const players = Object.entries(cash).map(
    ([id, amount]) => new Player({ id, name: id, cash: amount, eliminated: eliminated.includes(id) }),
  );
  const board = Board.restore(cities);
  const trade = new CityTrade({
    findPlayer: (id) => players.find((player) => player.id === id) ?? null,
  });
  return { trade, board, byId: (id) => players.find((player) => player.id === id) };
}

describe('CityTrade(도시 매입·건설·인수 규칙)', () => {
  describe('매입', () => {
    it('매입가를 은행에 내고 소유자가 된다', () => {
      // Given (1번 하노이 60,000)
      const { trade, board, byId } = build();

      // When
      const { intents, events } = trade.buy({ player: byId('s1'), city: board.cityAt(1) });

      // Then
      assert.equal(board.cityAt(1).isOwnedBy('s1'), true);
      assert.equal(intents[0].amount, -60_000);
      assert.equal(intents[0].reason, MONEY_REASONS.PURCHASE);
      assert.deepEqual(types(events), [EVENT_TYPES.CITY_PURCHASED]);
      assert.equal(events[0].payload.price, 60_000);
    });

    it('이미 주인이 있으면 거부한다', () => {
      // Given
      const { trade, board, byId } = build({
        cities: [{ index: 1, ownerId: 's2', buildings: [], landmark: false }],
      });

      // When / Then
      assert.throws(() => trade.buy({ player: byId('s1'), city: board.cityAt(1) }), {
        code: DOMAIN_ERROR_CODES.INVALID_STATE,
      });
    });

    it('현금이 부족하면 정리 페이즈로 가지 않고 거부한다(자발적 행동, 명세 D7)', () => {
      // Given
      const { trade, board, byId } = build({ cash: { s1: 10_000, s2: 0 } });

      // When / Then
      assert.throws(() => trade.buy({ player: byId('s1'), city: board.cityAt(1) }), {
        code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH,
      });
      assert.equal(board.cityAt(1).isOwned(), false, '거부되면 상태가 그대로다');
    });
  });

  describe('건설', () => {
    it('건설비를 은행에 내고 건물을 짓는다', () => {
      // Given (1번 하노이 60,000 → 별장 18,000)
      const { trade, board, byId } = build({
        cities: [{ index: 1, ownerId: 's1', buildings: [], landmark: false }],
      });

      // When
      const { intents, events } = trade.build({
        player: byId('s1'),
        city: board.cityAt(1),
        buildings: ['VILLA'],
      });

      // Then
      assert.deepEqual(board.cityAt(1).buildings, ['VILLA']);
      assert.equal(intents[0].amount, -18_000);
      assert.equal(intents[0].reason, MONEY_REASONS.BUILD);
      assert.deepEqual(types(events), [EVENT_TYPES.BUILT]);
    });

    it('랜드마크를 지으면 LANDMARK_BUILT가 함께 발생한다', () => {
      // Given
      const { trade, board, byId } = build({
        cities: [{ index: 1, ownerId: 's1', buildings: ['VILLA', 'BUILDING', 'HOTEL'], landmark: false }],
      });

      // When
      const { events } = trade.build({
        player: byId('s1'),
        city: board.cityAt(1),
        buildings: ['LANDMARK'],
      });

      // Then
      assert.deepEqual(types(events), [EVENT_TYPES.BUILT, EVENT_TYPES.LANDMARK_BUILT]);
      assert.equal(board.cityAt(1).landmark, true);
    });

    it('내 도시가 아니면 거부한다', () => {
      // Given
      const { trade, board, byId } = build({
        cities: [{ index: 1, ownerId: 's2', buildings: [], landmark: false }],
      });

      // When / Then
      assert.throws(
        () => trade.build({ player: byId('s1'), city: board.cityAt(1), buildings: ['VILLA'] }),
        { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
      );
    });

    it('건설비가 부족하면 거부하고 아무것도 짓지 않는다', () => {
      // Given
      const { trade, board, byId } = build({
        cash: { s1: 1_000, s2: 0 },
        cities: [{ index: 1, ownerId: 's1', buildings: [], landmark: false }],
      });

      // When / Then
      assert.throws(
        () => trade.build({ player: byId('s1'), city: board.cityAt(1), buildings: ['VILLA'] }),
        { code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH },
      );
      assert.deepEqual(board.cityAt(1).buildings, []);
    });
  });

  describe('인수', () => {
    it('인수 대금은 기존 소유자에게 간다', () => {
      // Given (하노이 투자액 60,000 → 인수가 120,000)
      const { trade, board, byId } = build({
        cities: [{ index: 1, ownerId: 's2', buildings: [], landmark: false }],
      });

      // When
      const { intents, events } = trade.acquire({ player: byId('s1'), city: board.cityAt(1) });

      // Then
      assert.equal(board.cityAt(1).isOwnedBy('s1'), true);
      assert.equal(intents[0].playerId, 's1');
      assert.equal(intents[0].otherPlayerId, 's2');
      assert.equal(intents[0].amount, -120_000);
      assert.deepEqual(types(events), [EVENT_TYPES.ACQUIRED]);
      assert.equal(events[0].payload.fromId, 's2');
    });

    it('소유자가 탈락했으면 은행이 받는다', () => {
      // Given
      const { trade, board, byId } = build({
        cash: { s1: 1_000_000, s2: 0 },
        eliminated: ['s2'],
        cities: [{ index: 1, ownerId: 's2', buildings: [], landmark: false }],
      });

      // When
      const { intents } = trade.acquire({ player: byId('s1'), city: board.cityAt(1) });

      // Then
      assert.equal(intents[0].otherPlayerId, null);
      assert.equal(intents[0].affectsLedger, true);
    });

    it('랜드마크 도시는 인수할 수 없다', () => {
      // Given
      const { trade, board, byId } = build({
        cities: [{ index: 1, ownerId: 's2', buildings: ['VILLA', 'BUILDING', 'HOTEL'], landmark: true }],
      });

      // When / Then
      assert.throws(() => trade.acquire({ player: byId('s1'), city: board.cityAt(1) }), {
        code: DOMAIN_ERROR_CODES.INVALID_STATE,
      });
    });

    it('보유 현금으로 낼 수 없으면 거부한다(매각·대출로 인수하지 못하게)', () => {
      // Given
      const { trade, board, byId } = build({
        cash: { s1: 10_000, s2: 0 },
        cities: [{ index: 1, ownerId: 's2', buildings: [], landmark: false }],
      });

      // When / Then
      assert.throws(() => trade.acquire({ player: byId('s1'), city: board.cityAt(1) }), {
        code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH,
      });
      assert.equal(board.cityAt(1).isOwnedBy('s2'), true);
    });
  });
});
