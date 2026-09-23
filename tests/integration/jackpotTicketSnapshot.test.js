import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  deserializeRoom,
  migrateRoomSnapshot,
  validateRoomSnapshot,
} from '../../src/infrastructure/RoomSerializer.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { TICKETS } from '../../src/domain/game/data/tickets.js';
import { toGameViewDto } from '../../src/application/dto.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { buildGame } from '../support/gameBuilder.js';

const NOW = 1_700_000_000_000;

/** 잭팟 수령 티켓이 없던 20장 시절의 저장 파일(덱에 T21·T22가 없다). */
const OLD_DECK_SNAPSHOT = JSON.parse(
  readFileSync(new URL('./fixtures/roomOldDeck.playing.json', import.meta.url), 'utf8'),
);

const NEW_TICKET_IDS = Object.freeze(['T21', 'T22']);

describe('잭팟 수령 티켓과 저장 스냅샷', () => {
  it('새 티켓이 담긴 덱 스냅샷은 스키마 검증을 통과한다', () => {
    // Given (22장 전부가 남아 있는 덱)
    const snapshot = structuredClone(OLD_DECK_SNAPSHOT);
    snapshot.game.deck.drawPile = TICKETS.map((ticket) => ticket.id);

    // When / Then
    // 이 픽스처는 증권거래소가 들어오기 전(스키마 2) 저장 파일이다.
    // `validateRoomSnapshot`은 **승급을 마친** 스냅샷을 검사하는 함수이므로 먼저 승급한다.
    validateRoomSnapshot(migrateRoomSnapshot(snapshot));
    const room = deserializeRoom(snapshot, new SeededRandomSource(7));
    assert.deepEqual(room.game.toSnapshot().deck.drawPile, TICKETS.map((ticket) => ticket.id));
  });

  it('새 티켓만 남은 덱도 왕복 후 그대로 복원된다', () => {
    // Given
    const snapshot = structuredClone(OLD_DECK_SNAPSHOT);
    snapshot.game.deck.drawPile = [...NEW_TICKET_IDS];

    // When
    const room = deserializeRoom(snapshot, new SeededRandomSource(7));
    const again = deserializeRoom(room.toSnapshot(), new SeededRandomSource(7));

    // Then
    assert.deepEqual(again.game.toSnapshot().deck.drawPile, [...NEW_TICKET_IDS]);
  });

  it('새 티켓이 없는 예전 저장 방도 그대로 열린다', () => {
    // Given / When
    const room = deserializeRoom(structuredClone(OLD_DECK_SNAPSHOT), new SeededRandomSource(11));

    // Then (저장 시점 상태가 그대로다 — 덱은 아직 20장이다)
    assert.equal(room.status, 'PLAYING');
    assert.equal(room.game.round, 4);
    assert.equal(room.game.jackpot, 240_000);
    const drawPile = room.game.toSnapshot().deck.drawPile;
    assert.equal(drawPile.length, 20);
    assert.deepEqual(
      drawPile.filter((id) => NEW_TICKET_IDS.includes(id)),
      [],
      '예전 덱에는 새 티켓이 없다',
    );
  });

  it('예전 덱을 다 쓰면 다음 재섞기에서 새 티켓이 들어와 잭팟을 지급한다', () => {
    // Given (예전 덱의 마지막 한 장만 남은 방. 잭팟은 240,000원 쌓여 있다)
    const snapshot = structuredClone(OLD_DECK_SNAPSHOT);
    snapshot.game.deck.drawPile = ['T05'];
    // 1+2 = 3 → 4번 칸의 하나가 7번 티켓 칸으로. 마지막 T05를 뽑아 덱이 빈다.
    // 이어서 2+3 = 5 → 17번 칸의 두리가 22번 티켓 칸으로. 여기서 22장으로 다시 채워지고
    // 21번 자리(T21 잭팟 당첨권)를 뽑는다.
    const room = deserializeRoom(snapshot, new FakeRandomSource([1, 2, 0, 2, 3, 20]));

    // When
    const first = room.executeCommand({
      seatId: 'seat-1',
      type: COMMAND_TYPES.ROLL,
      payload: {},
      now: NOW,
    });

    // Then (예전 덱이 소진됐다)
    assert.equal(first.find((event) => event.type === EVENT_TYPES.TICKET_DRAWN).ticketId, 'T05');
    assert.equal(room.game.toSnapshot().deck.drawPile.length, 0);

    // When (다음 사람이 티켓 칸에 도착하면 카탈로그 전체로 다시 채워진다)
    const second = room.executeCommand({
      seatId: 'seat-2',
      type: COMMAND_TYPES.ROLL,
      payload: {},
      now: NOW,
    });

    // Then (예전 방도 새 규칙을 그대로 따른다)
    assert.equal(second.find((event) => event.type === EVENT_TYPES.TICKET_DRAWN).ticketId, 'T21');
    assert.equal(
      second.find((event) => event.type === EVENT_TYPES.JACKPOT_CLAIMED).amount,
      240_000,
    );
    assert.equal(room.game.jackpot, 0);
    assert.equal(room.game.toSnapshot().deck.drawPile.length, 21);
    assert.equal(room.game.moneyReport().balanced, true);
  });

  it('뷰 DTO는 새 필드 없이 잭팟 숫자와 현금만 달라진다', () => {
    // Given (잭팟 당첨권 한 장만 남긴 덱)
    const game = buildGame({
      positions: { s1: 4 },
      jackpot: 240_000,
      drawPile: ['T21'],
      random: new FakeRandomSource([1, 2, 0]),
    });
    const before = toGameViewDto(game);

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);
    const after = toGameViewDto(game);

    // Then (DTO 모양은 그대로다 — 새 필드를 만들지 않았다)
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    assert.deepEqual(
      Object.keys(after.players[0]).sort(),
      Object.keys(before.players[0]).sort(),
    );
    assert.equal(before.jackpot, 240_000);
    assert.equal(after.jackpot, 0, '달라진 값은 잭팟 숫자다');
    assert.equal(after.players[0].cash, before.players[0].cash + 240_000);
  });
});
