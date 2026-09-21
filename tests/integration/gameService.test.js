import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { createAppFixture, startedRoom } from '../support/appFixture.js';

/** 방 코드 생성용 난수 + 주사위 결과를 순서대로 준비한다. */
const scriptedRandom = (diceValues = []) =>
  new FakeRandomSource([3, 3, 3, 3, ...diceValues]);

describe('GameService(게임 커맨드 유스케이스)', () => {
  it('커맨드를 처리하고 게임 뷰와 이벤트를 브로드캐스트한다', async () => {
    // Given
    const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
    const started = await startedRoom(fixture, { guestCount: 1 });
    fixture.publisher.reset();

    // When
    const result = await fixture.gameService.execute({
      code: started.code,
      token: started.host.seatToken,
      seatId: started.host.seatId,
      type: COMMAND_TYPES.ROLL,
    });

    // Then
    assert.equal(result.view.version, 1);
    assert.equal(result.view.phase, PHASES.AWAIT_BUY);
    assert.ok(result.events.some((event) => event.type === 'DICE_ROLLED'));
    assert.equal(fixture.publisher.games.length, 1);
    assert.deepEqual(fixture.publisher.lastGame.events, result.events);
  });

  it('게임 뷰에는 좌석 토큰이 들어가지 않는다', async () => {
    // Given
    const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
    const started = await startedRoom(fixture, { guestCount: 1 });

    // When
    const result = await fixture.gameService.execute({
      code: started.code,
      token: started.host.seatToken,
      type: COMMAND_TYPES.ROLL,
    });

    // Then
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(started.host.seatToken), false);
    assert.equal(serialized.includes(started.guests[0].seatToken), false);
  });

  it('바뀐 게임 상태가 저장소에 저장된다', async () => {
    // Given
    const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
    const started = await startedRoom(fixture, { guestCount: 1 });

    // When
    await fixture.gameService.execute({
      code: started.code,
      token: started.host.seatToken,
      type: COMMAND_TYPES.ROLL,
    });

    // Then
    const saved = await fixture.repository.findByCode(started.code);
    assert.equal(saved.game.version, 1);
    assert.equal(saved.game.phase, PHASES.AWAIT_BUY);
  });

  describe('권한 검증', () => {
    it('토큰이 없으면 인증 에러이고 상태가 변하지 않는다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assert.rejects(
        () => fixture.gameService.execute({ code: started.code, type: COMMAND_TYPES.ROLL }),
        { code: 'ERR002' },
      );
      const saved = await fixture.repository.findByCode(started.code);
      assert.equal(saved.game.version, 0);
    });

    it('다른 좌석의 토큰으로는 내 차례를 대신 진행할 수 없다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assert.rejects(
        () =>
          fixture.gameService.execute({
            code: started.code,
            token: started.guests[0].seatToken,
            type: COMMAND_TYPES.ROLL,
          }),
        { code: 'ERR006' },
      );
      const saved = await fixture.repository.findByCode(started.code);
      assert.equal(saved.game.version, 0);
    });

    it('본문의 seatId가 토큰의 좌석과 다르면 거부한다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assert.rejects(
        () =>
          fixture.gameService.execute({
            code: started.code,
            token: started.host.seatToken,
            seatId: started.guests[0].seatId,
            type: COMMAND_TYPES.ROLL,
          }),
        { code: 'ERR003' },
      );
    });

    it('현재 페이즈에서 허용되지 않은 커맨드는 거부한다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assert.rejects(
        () =>
          fixture.gameService.execute({
            code: started.code,
            token: started.host.seatToken,
            type: COMMAND_TYPES.BUY,
          }),
        { code: 'ERR005' },
      );
    });

    it('알 수 없는 커맨드는 거부한다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assert.rejects(
        () =>
          fixture.gameService.execute({
            code: started.code,
            token: started.host.seatToken,
            type: 'HACK',
          }),
        { code: 'ERR001' },
      );
    });

    it('없는 방이면 방을 찾을 수 없다는 에러다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([]) });

      // When / Then
      await assert.rejects(
        () => fixture.gameService.execute({ code: 'ZZZZ', token: 'f'.repeat(64), type: COMMAND_TYPES.ROLL }),
        { code: 'ERR004' },
      );
    });

    it('대기실 상태에서는 커맨드를 받지 않는다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([]) });
      const host = await fixture.roomService.createRoom({ hostName: '하나' });

      // When / Then
      await assert.rejects(
        () =>
          fixture.gameService.execute({
            code: host.room.code,
            token: host.seatToken,
            type: COMMAND_TYPES.ROLL,
          }),
        { code: 'ERR005' },
      );
    });
  });

  describe('저장소 왕복', () => {
    it('저장된 스냅샷에서 복원해 다음 커맨드를 이어서 처리한다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });
      await fixture.gameService.execute({
        code: started.code,
        token: started.host.seatToken,
        type: COMMAND_TYPES.ROLL,
      });

      // When
      const result = await fixture.gameService.execute({
        code: started.code,
        token: started.host.seatToken,
        type: COMMAND_TYPES.BUY,
      });

      // Then
      assert.equal(result.view.version, 2);
      const bangkok = result.view.board.find((space) => space.index === 3);
      assert.equal(bangkok.ownerId, started.host.seatId);
    });
  });
});
