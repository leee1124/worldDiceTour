import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { toGameViewDto } from '../../src/application/dto.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { BUILDING_TYPES } from '../../src/domain/game/City.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { buildGame } from '../support/gameBuilder.js';

const { VILLA, BUILDING, HOTEL, LANDMARK } = BUILDING_TYPES;

/** 0번 칸에서 1+2로 3번 방콕(105,000원)에 도착시킨다. */
const rollToBangkok = () => new FakeRandomSource([1, 2]);

describe('GameViewDto(바퀴 수와 건설 선택지)', () => {
  it('플레이어마다 현재 바퀴 수를 알려 준다', () => {
    // Given
    const game = buildGame({ laps: { s1: 3, s2: 1 }, random: rollToBangkok() });

    // When
    const view = toGameViewDto(game);

    // Then
    assert.deepEqual(
      view.players.map((player) => player.lap),
      [3, 1],
    );
  });

  it('건설 기회의 options에는 지금 고를 수 있는 건물만 담긴다(기존 계약 유지)', () => {
    // Given (1바퀴)
    const game = buildGame({
      laps: { s1: 1 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const { pending } = toGameViewDto(game);

    // Then
    assert.equal(pending.kind, 'BUILD');
    assert.deepEqual(pending.options, [{ type: VILLA, cost: 31_500, locked: false, unlockLap: 1 }]);
  });

  it('건설 기회의 lockedOptions는 잠긴 건물과 열리는 바퀴를 알려 준다', () => {
    // Given (1바퀴)
    const game = buildGame({
      laps: { s1: 1 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const { pending } = toGameViewDto(game);

    // Then
    assert.deepEqual(pending.lockedOptions, [
      { type: BUILDING, cost: 63_000, locked: true, unlockLap: 2 },
      { type: HOTEL, cost: 94_500, locked: true, unlockLap: 3 },
    ]);
  });

  it('3바퀴에는 잠긴 건물이 없다', () => {
    // Given
    const game = buildGame({
      laps: { s1: 3 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const { pending } = toGameViewDto(game);

    // Then
    assert.deepEqual(
      pending.options.map((option) => option.type),
      [VILLA, BUILDING, HOTEL],
    );
    assert.deepEqual(pending.lockedOptions, []);
  });

  it('관광명소 업그레이드 기회에는 잠긴 건물이 없다', () => {
    // Given
    const game = buildGame({
      laps: { s1: 1 },
      cities: [{ index: 3, ownerId: 's1', buildings: [VILLA, BUILDING, HOTEL] }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const { pending } = toGameViewDto(game);

    // Then
    assert.deepEqual(pending.options, [{ type: LANDMARK, cost: 105_000, locked: false, unlockLap: 1 }]);
    assert.deepEqual(pending.lockedOptions, []);
  });

  it('출발 보너스 후보도 options와 lockedOptions를 함께 담는다', () => {
    // Given (37 + 3 = 출발 칸 → 2바퀴가 된다)
    const game = buildGame({
      positions: { s1: 37 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: new FakeRandomSource([1, 2]),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);
    const { pending, players } = toGameViewDto(game);

    // Then
    assert.equal(pending.kind, 'START_BUILD');
    assert.equal(players[0].lap, 2);
    assert.deepEqual(
      pending.candidates[0].options.map((option) => option.type),
      [VILLA, BUILDING],
    );
    assert.deepEqual(pending.candidates[0].lockedOptions, [
      { type: HOTEL, cost: 94_500, locked: true, unlockLap: 3 },
    ]);
  });
});
