import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TicketDeck } from '../../src/domain/game/TicketDeck.js';
import { TICKETS, TICKET_EFFECTS } from '../../src/domain/game/data/tickets.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';

describe('TicketDeck(행운 티켓 덱)', () => {
  it('티켓은 22장이며 모두 고유 id와 한국어 문구를 가진다', () => {
    // Given
    const ids = TICKETS.map((ticket) => ticket.id);

    // When / Then
    assert.equal(TICKETS.length, 22);
    assert.equal(new Set(ids).size, 22);
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
    assert.equal(deck.remaining, 21);
  });

  it('뽑은 티켓은 더미에서 빠지므로 같은 자리를 다시 뽑아도 다른 티켓이 나온다', () => {
    // Given (같은 인덱스를 두 번 요청해도 더미가 줄어 다른 티켓이 나온다)
    const deck = TicketDeck.createDefault();
    const random = new FakeRandomSource([0, 0]);

    // When
    const first = deck.draw(random);
    const second = deck.draw(random);

    // Then
    assert.equal(first.id, TICKETS[0].id);
    assert.equal(second.id, TICKETS[1].id);
    assert.equal(deck.remaining, 20);
  });

  it('덱을 모두 소진하면 다시 22장으로 채운다', () => {
    // Given (항상 첫 자리를 뽑으면 정의된 순서대로 22장이 나온다)
    const deck = TicketDeck.createDefault();
    const random = new FakeRandomSource(new Array(23).fill(0));

    // When
    const drawn = Array.from({ length: 22 }, () => deck.draw(random).id);
    assert.equal(deck.remaining, 0, '22장을 다 써서 더미가 비었다');
    const afterRefill = deck.draw(random);

    // Then (22장이 겹치지 않게 모두 나왔고, 다시 채운 뒤 첫 장부터 다시 나온다)
    assert.deepEqual(drawn, TICKETS.map((ticket) => ticket.id));
    assert.equal(new Set(drawn).size, 22);
    assert.equal(afterRefill.id, TICKETS[0].id);
    assert.equal(deck.remaining, 21);
  });

  it('다시 채운 직후에는 직전에 뽑은 티켓도 다시 나올 수 있다(연속 금지 규칙은 없다)', () => {
    // Given (21장을 버리고 마지막 한 장만 남긴다)
    const deck = TicketDeck.createDefault();
    const random = new FakeRandomSource(new Array(23).fill(0));
    for (let index = 0; index < 21; index += 1) {
      deck.draw(random);
    }
    const last = deck.draw(random);

    // When (더미가 비었으므로 다음 뽑기에서 22장을 다시 채운다)
    assert.equal(deck.remaining, 0);
    const refilled = TicketDeck.createDefault();
    const sameAgain = refilled.draw(
      new FakeRandomSource([TICKETS.findIndex((ticket) => ticket.id === last.id)]),
    );

    // Then
    assert.equal(sameAgain.id, last.id);
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
    assert.equal(restored.remaining, 21);
  });

  it('새 카드가 없는 예전 덱 스냅샷도 그대로 복원되고, 다시 채울 때 새 카드가 들어온다', () => {
    // Given (잭팟 수령 티켓이 없던 20장 시절의 저장 덱)
    const legacyIds = TICKETS.map((ticket) => ticket.id).filter(
      (id) => id !== 'T21' && id !== 'T22',
    );
    assert.equal(legacyIds.length, 20, '예전 덱은 20장이었다');
    const deck = TicketDeck.restore({ drawPile: legacyIds });

    // When (예전 카드를 전부 소진하면 카탈로그 전체로 다시 채워진다)
    const random = new FakeRandomSource(new Array(21).fill(0));
    const drawn = Array.from({ length: 20 }, () => deck.draw(random).id);
    assert.equal(deck.remaining, 0);
    deck.draw(random);

    // Then (예전 덱에서는 새 카드가 나오지 않고, 다시 채운 뒤에는 22장이 된다)
    assert.equal(drawn.includes('T21'), false);
    assert.equal(drawn.includes('T22'), false);
    assert.equal(deck.remaining, 21, '22장으로 다시 채우고 한 장을 뽑았다');
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
