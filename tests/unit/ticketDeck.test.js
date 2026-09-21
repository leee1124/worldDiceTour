import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TicketDeck } from '../../src/domain/game/TicketDeck.js';
import { TICKETS, TICKET_EFFECTS } from '../../src/domain/game/data/tickets.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';

describe('TicketDeck(행운 티켓 덱)', () => {
  it('티켓은 20장이며 모두 고유 id와 한국어 문구를 가진다', () => {
    // Given
    const ids = TICKETS.map((ticket) => ticket.id);

    // When / Then
    assert.equal(TICKETS.length, 20);
    assert.equal(new Set(ids).size, 20);
    assert.equal(
      TICKETS.every((ticket) => typeof ticket.text === 'string' && ticket.text.length > 0),
      true,
    );
  });

  it('모든 티켓 효과는 정의된 효과 종류 중 하나다', () => {
    // Given
    const known = new Set(Object.values(TICKET_EFFECTS));

    // When / Then
    assert.equal(
      TICKETS.every((ticket) => known.has(ticket.effect.type)),
      true,
    );
  });

  it('난수로 고른 위치의 티켓을 뽑고 덱에서 제거한다', () => {
    // Given
    const deck = TicketDeck.createDefault();
    const random = new FakeRandomSource([0]);

    // When
    const ticket = deck.draw(random);

    // Then
    assert.equal(ticket.id, TICKETS[0].id);
    assert.equal(deck.remaining, 19);
  });

  it('같은 티켓을 연달아 뽑지 않는다', () => {
    // Given
    const deck = TicketDeck.createDefault();
    const random = new FakeRandomSource([0, 0]);

    // When
    const first = deck.draw(random);
    const second = deck.draw(random);

    // Then
    assert.notEqual(first.id, second.id);
    assert.equal(deck.remaining, 18);
  });

  it('덱을 모두 소진하면 다시 20장으로 채운다', () => {
    // Given
    const deck = TicketDeck.createDefault();
    const random = new FakeRandomSource(new Array(21).fill(0));

    // When
    for (let i = 0; i < 20; i += 1) {
      deck.draw(random);
    }
    const afterExhausted = deck.draw(random);

    // Then
    assert.equal(afterExhausted !== null, true);
    assert.equal(deck.remaining, 19);
  });

  it('남은 덱 순서를 스냅샷으로 저장하고 복원한다', () => {
    // Given
    const deck = TicketDeck.createDefault();
    deck.draw(new FakeRandomSource([3]));

    // When
    const snapshot = deck.toSnapshot();
    const restored = TicketDeck.restore(snapshot);

    // Then
    assert.deepEqual(restored.toSnapshot(), snapshot);
    assert.equal(restored.remaining, 19);
  });

  it('알 수 없는 티켓 id가 섞인 스냅샷은 무시하고 복원한다', () => {
    // Given
    const snapshot = { drawPile: ['T01', 'UNKNOWN', 'T02'] };

    // When
    const restored = TicketDeck.restore(snapshot);

    // Then
    assert.equal(restored.remaining, 2);
  });
});
