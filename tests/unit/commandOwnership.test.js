import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_COMMAND_TYPES,
  COMMAND_OWNERSHIP,
  COMMAND_OWNERSHIPS,
  COMMAND_PHASES,
  COMMAND_TYPES,
} from '../../src/domain/game/commands.js';
import { toGameViewDto } from '../../src/application/dto.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { buildGame } from '../support/gameBuilder.js';

describe('COMMAND_OWNERSHIP(행동 주체 표)', () => {
  it('모든 커맨드가 허용 페이즈와 행동 주체를 함께 선언한다', () => {
    // Given / When / Then
    for (const type of ALL_COMMAND_TYPES) {
      assert.ok(COMMAND_PHASES[type], `${type}에 허용 페이즈가 없다`);
      assert.ok(COMMAND_OWNERSHIP[type], `${type}에 행동 주체가 없다`);
    }
    assert.deepEqual(
      Object.keys(COMMAND_OWNERSHIP).sort(),
      [...ALL_COMMAND_TYPES].sort(),
      '표에 빠진 커맨드나 남는 커맨드가 있다',
    );
  });

  it('예약 주문만 자기 좌석 상시 허용이고 나머지는 모두 현재 턴 플레이어 소유다', () => {
    // Given (게임 상태를 바꾸지 않는 커맨드만 상시 허용이 될 자격이 있다 — 예약 큐만 바꾼다)
    const ownSeatAnytime = ALL_COMMAND_TYPES.filter(
      (type) => COMMAND_OWNERSHIP[type] === COMMAND_OWNERSHIPS.OWN_SEAT_ANYTIME,
    );

    // When / Then
    assert.deepEqual(ownSeatAnytime.sort(), [
      COMMAND_TYPES.CANCEL_QUEUED_ORDER,
      COMMAND_TYPES.QUEUE_ORDER,
    ]);
    for (const type of ALL_COMMAND_TYPES) {
      if (ownSeatAnytime.includes(type)) {
        continue;
      }
      assert.equal(
        COMMAND_OWNERSHIP[type],
        COMMAND_OWNERSHIPS.CURRENT_PLAYER,
        `${type}이 현재 턴 플레이어 소유가 아니다`,
      );
    }
  });

  it('남의 차례에 보낸 커맨드는 NOT_YOUR_TURN으로 거부된다', () => {
    // Given
    const game = buildGame({ random: new FakeRandomSource([1, 2]) });

    // When / Then
    assert.throws(() => game.execute('s2', COMMAND_TYPES.ROLL), {
      code: DOMAIN_ERROR_CODES.NOT_YOUR_TURN,
    });
  });

  it('핸들러가 없는 커맨드는 알 수 없는 커맨드로 거부된다', () => {
    // Given
    const game = buildGame({ random: new FakeRandomSource() });

    // When / Then
    assert.throws(() => game.execute('s1', 'HACK_THE_BANK'), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });
});

describe('actingSeatId(행동 주체 좌석)', () => {
  it('오늘은 항상 턴 소유자와 같다', () => {
    // Given
    const game = buildGame({ turnIndex: 1, random: new FakeRandomSource() });

    // When / Then
    assert.equal(game.actingSeatId, 's2');
    assert.equal(game.actingSeatId, game.currentPlayerId);
  });

  it('게임 뷰 DTO에 currentSeatId와 함께 실린다(가산 필드)', () => {
    // Given
    const game = buildGame({ random: new FakeRandomSource() });

    // When
    const view = toGameViewDto(game);

    // Then
    assert.equal(view.actingSeatId, 's1');
    assert.equal(view.currentSeatId, 's1');
    assert.ok(Object.keys(view).includes('actingSeatId'));
  });

  it('게임이 끝나면 행동 주체가 사라지지 않고 마지막 좌석을 가리킨다(계약 유지)', () => {
    // Given
    const game = buildGame({
      turnIndex: 1,
      round: 20,
      roundLimit: 20,
      cash: { s2: 0 },
      random: new FakeRandomSource([1, 2]),
    });

    // When
    game.execute('s2', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.isOver(), true);
    assert.equal(game.actingSeatId, game.currentPlayerId);
  });
});
