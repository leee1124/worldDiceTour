import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { assertRejectedWithoutChange, createAppFixture, startedRoom } from '../support/appFixture.js';

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
      await assertRejectedWithoutChange(fixture, started.code, 'ERR002', () =>
        fixture.gameService.execute({ code: started.code, type: COMMAND_TYPES.ROLL }),
      );
    });

    it('엉뚱한 토큰이면 인증 에러이고 상태가 변하지 않는다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assertRejectedWithoutChange(fixture, started.code, 'ERR002', () =>
        fixture.gameService.execute({
          code: started.code,
          token: 'f'.repeat(64),
          type: COMMAND_TYPES.ROLL,
        }),
      );
    });

    it('다른 좌석의 토큰으로는 내 차례를 대신 진행할 수 없고 상태가 변하지 않는다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assertRejectedWithoutChange(fixture, started.code, 'ERR006', () =>
        fixture.gameService.execute({
          code: started.code,
          token: started.guests[0].seatToken,
          type: COMMAND_TYPES.ROLL,
        }),
      );
    });

    it('본문의 seatId가 토큰의 좌석과 다르면 거부하고 상태가 변하지 않는다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assertRejectedWithoutChange(fixture, started.code, 'ERR003', () =>
        fixture.gameService.execute({
          code: started.code,
          token: started.host.seatToken,
          seatId: started.guests[0].seatId,
          type: COMMAND_TYPES.ROLL,
        }),
      );
    });

    it('자동 진행 중인 좌석의 커맨드는 그 좌석 토큰으로도 거부한다', async () => {
      // Given (호스트 좌석을 자동 진행으로 돌린다 — 지금이 호스트 차례다)
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });
      fixture.driver.stop();
      await fixture.roomService.hostAction({
        code: started.code,
        token: started.host.seatToken,
        action: { type: 'SET_AUTOPILOT', seatId: started.host.seatId, enabled: true },
      });

      // When / Then
      await assertRejectedWithoutChange(fixture, started.code, 'ERR003', () =>
        fixture.gameService.execute({
          code: started.code,
          token: started.host.seatToken,
          type: COMMAND_TYPES.ROLL,
        }),
      );
      const saved = await fixture.repository.findByCode(started.code);
      assert.equal(saved.game.phase, PHASES.AWAIT_ROLL);
    });

    it('자동 진행을 해제하면 다시 사람이 커맨드를 보낼 수 있다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });
      fixture.driver.stop();
      for (const enabled of [true, false]) {
        await fixture.roomService.hostAction({
          code: started.code,
          token: started.host.seatToken,
          action: { type: 'SET_AUTOPILOT', seatId: started.host.seatId, enabled },
        });
      }

      // When
      const result = await fixture.gameService.execute({
        code: started.code,
        token: started.host.seatToken,
        type: COMMAND_TYPES.ROLL,
      });

      // Then
      assert.equal(result.view.version, 1);
    });

    it('현재 페이즈에서 허용되지 않은 커맨드는 거부하고 상태가 변하지 않는다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assertRejectedWithoutChange(fixture, started.code, 'ERR005', () =>
        fixture.gameService.execute({
          code: started.code,
          token: started.host.seatToken,
          type: COMMAND_TYPES.BUY,
        }),
      );
    });

    it('알 수 없는 커맨드는 거부하고 상태가 변하지 않는다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assertRejectedWithoutChange(fixture, started.code, 'ERR001', () =>
        fixture.gameService.execute({
          code: started.code,
          token: started.host.seatToken,
          type: 'HACK',
        }),
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

  describe('자동 진행 예약', () => {
    /** 예약/취소 호출만 기록하는 드라이버 대역. */
    const recordingDriver = () => {
      const calls = { scheduled: [], cancelled: [] };
      return {
        calls,
        driver: {
          schedule: (code) => calls.scheduled.push(code),
          cancelTimer: (code) => calls.cancelled.push(code),
          cancel: (code) => calls.cancelled.push(code),
        },
      };
    };

    it('다음 턴이 사람 좌석이면 자동 진행을 예약하지 않는다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });
      const { calls, driver } = recordingDriver();
      fixture.gameService.attachAutoPlayerDriver(driver);

      // When (호스트가 굴리고 매입을 포기해 두리 차례가 된다 — 둘 다 사람)
      await fixture.gameService.execute({
        code: started.code,
        token: started.host.seatToken,
        type: COMMAND_TYPES.ROLL,
      });
      await fixture.gameService.execute({
        code: started.code,
        token: started.host.seatToken,
        type: COMMAND_TYPES.SKIP_BUY,
      });

      // Then
      assert.deepEqual(calls.scheduled, []);
    });

    it('다음 턴이 컴퓨터 좌석이면 자동 진행을 예약한다', async () => {
      // Given
      const fixture = createAppFixture({ random: scriptedRandom([1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 0, computerCount: 1 });
      const { calls, driver } = recordingDriver();
      fixture.gameService.attachAutoPlayerDriver(driver);

      // When
      await fixture.gameService.execute({
        code: started.code,
        token: started.host.seatToken,
        type: COMMAND_TYPES.ROLL,
      });
      await fixture.gameService.execute({
        code: started.code,
        token: started.host.seatToken,
        type: COMMAND_TYPES.SKIP_BUY,
      });

      // Then (컴퓨터 차례가 된 마지막 커맨드에서만 예약된다)
      assert.deepEqual(calls.scheduled, [started.code]);
    });

    it('사람 커맨드와 서버 대행이 같은 좌석에 동시에 적용되지 않는다', async () => {
      // Given (호스트 좌석을 자동 진행으로 켠 뒤, 사람 커맨드와 드라이버 스텝을 동시에 던진다)
      const fixture = createAppFixture({ random: scriptedRandom([1, 2, 1, 2, 1, 2]) });
      const started = await startedRoom(fixture, { guestCount: 1 });
      fixture.driver.stop();
      await fixture.roomService.hostAction({
        code: started.code,
        token: started.host.seatToken,
        action: { type: 'SET_AUTOPILOT', seatId: started.host.seatId, enabled: true },
      });

      // When
      const results = await Promise.allSettled([
        fixture.gameService.execute({
          code: started.code,
          token: started.host.seatToken,
          type: COMMAND_TYPES.ROLL,
        }),
        fixture.gameService.executeAsServer({
          code: started.code,
          seatId: started.host.seatId,
          type: COMMAND_TYPES.ROLL,
        }),
      ]);

      // Then (서버 대행만 성공하고, 사람 커맨드는 ERR003으로 막힌다)
      assert.equal(results[0].status, 'rejected');
      assert.equal(results[0].reason.code, 'ERR003');
      assert.equal(results[1].status, 'fulfilled');
      const saved = await fixture.repository.findByCode(started.code);
      assert.equal(saved.game.version, 1);
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
