import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ROOM_STATUS } from '../../src/domain/room/Room.js';
import { SEAT_KINDS } from '../../src/domain/room/Seat.js';
import { AppError } from '../../src/application/errors.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { createAppFixture, startedRoom } from '../support/appFixture.js';

/** 방 코드 생성용 난수. 방마다 다른 코드가 나오도록 0~31을 순환한다. */
const codeRandom = () => new FakeRandomSource(Array.from({ length: 200 }, (_unused, index) => index % 32));

describe('RoomService(방 유스케이스)', () => {
  describe('방 만들기', () => {
    it('방을 만들면 방 DTO와 좌석 토큰을 돌려준다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });

      // When
      const result = await roomService.createRoom({ hostName: '하나' });

      // Then
      assert.match(result.room.code, /^[A-HJ-NP-Z2-9]{4}$/);
      assert.equal(result.room.status, ROOM_STATUS.LOBBY);
      assert.equal(result.room.seats.length, 1);
      assert.equal(result.room.seats[0].isHost, true);
      assert.equal(typeof result.seatToken, 'string');
      assert.equal(result.seatId, result.room.seats[0].id);
    });

    it('방 DTO에는 좌석 토큰이 들어가지 않는다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });

      // When
      const result = await roomService.createRoom({ hostName: '하나' });

      // Then
      assert.equal(JSON.stringify(result.room).includes(result.seatToken), false);
      assert.equal(Object.hasOwn(result.room.seats[0], 'token'), false);
    });

    it('만든 방은 저장소에 저장된다', async () => {
      // Given
      const { roomService, repository } = createAppFixture({ random: codeRandom() });

      // When
      const result = await roomService.createRoom({ hostName: '하나' });

      // Then
      const saved = await repository.findByCode(result.room.code);
      assert.equal(saved.code, result.room.code);
    });

    it('이름 형식이 잘못되면 거부한다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });

      // When / Then
      await assert.rejects(() => roomService.createRoom({ hostName: '' }), (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, 'ERR001');
        return true;
      });
    });
  });

  describe('방 목록', () => {
    it('참가할 수 있는 대기실만 보여준다', async () => {
      // Given
      const fixture = createAppFixture({ random: codeRandom() });
      const lobby = await fixture.roomService.createRoom({ hostName: '하나' });
      const playing = await startedRoom(fixture, { guestCount: 1 });

      // When
      const rooms = await fixture.roomService.listRooms();

      // Then
      const codes = rooms.map((room) => room.code);
      assert.ok(codes.includes(lobby.room.code));
      assert.equal(codes.includes(playing.code), false);
      assert.equal(Object.hasOwn(rooms[0], 'seats'), false);
      assert.equal(rooms[0].seatCount, 1);
    });
  });

  describe('좌석 참가와 퇴장', () => {
    it('좌석에 참가하면 토큰을 발급하고 방 변경을 브로드캐스트한다', async () => {
      // Given
      const { roomService, publisher } = createAppFixture({ random: codeRandom() });
      const host = await roomService.createRoom({ hostName: '하나' });
      publisher.reset();

      // When
      const guest = await roomService.joinSeat({ code: host.room.code, name: '두리' });

      // Then
      assert.equal(guest.room.seats.length, 2);
      assert.notEqual(guest.seatToken, host.seatToken);
      assert.equal(publisher.rooms.length, 1);
      assert.equal(publisher.lastRoom.seats.length, 2);
    });

    it('없는 방에 참가하면 방을 찾을 수 없다는 에러다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });

      // When / Then
      await assert.rejects(() => roomService.joinSeat({ code: 'ZZZZ', name: '두리' }), { code: 'ERR004' });
    });

    it('본인 토큰으로 퇴장할 수 있다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });
      const host = await roomService.createRoom({ hostName: '하나' });
      const guest = await roomService.joinSeat({ code: host.room.code, name: '두리' });

      // When
      const room = await roomService.leaveSeat({
        code: host.room.code,
        seatId: guest.seatId,
        token: guest.seatToken,
      });

      // Then
      assert.equal(room.seats.length, 1);
    });

    it('남의 좌석을 토큰 없이 강퇴할 수 없다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });
      const host = await roomService.createRoom({ hostName: '하나' });
      const guest = await roomService.joinSeat({ code: host.room.code, name: '두리' });

      // When / Then
      await assert.rejects(
        () => roomService.leaveSeat({ code: host.room.code, seatId: host.seatId, token: guest.seatToken }),
        { code: 'ERR003' },
      );
    });

    it('게임이 진행 중이면 퇴장 요청을 ERR005로 거부하고 방은 그대로 남는다', async () => {
      // Given
      const fixture = createAppFixture({ random: codeRandom() });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assert.rejects(
        () =>
          fixture.roomService.leaveSeat({
            code: started.code,
            seatId: started.guests[0].seatId,
            token: started.guests[0].seatToken,
          }),
        { code: 'ERR005' },
      );
      const room = await fixture.roomService.getRoom({ code: started.code });
      assert.equal(room.status, ROOM_STATUS.PLAYING);
      assert.equal(room.seats.length, 2);
    });

    it('게임이 진행 중이면 호스트의 강퇴도 ERR005로 거부한다', async () => {
      // Given
      const fixture = createAppFixture({ random: codeRandom() });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When / Then
      await assert.rejects(
        () =>
          fixture.roomService.leaveSeat({
            code: started.code,
            seatId: started.guests[0].seatId,
            token: started.host.seatToken,
          }),
        { code: 'ERR005' },
      );
      const room = await fixture.roomService.getRoom({ code: started.code });
      assert.equal(room.seats.length, 2);
    });

    it('마지막 좌석이 나가면 방이 삭제된다', async () => {
      // Given
      const { roomService, repository } = createAppFixture({ random: codeRandom() });
      const host = await roomService.createRoom({ hostName: '하나' });

      // When
      await roomService.leaveSeat({ code: host.room.code, seatId: host.seatId, token: host.seatToken });

      // Then
      assert.equal(await repository.findByCode(host.room.code), null);
    });
  });

  describe('오래된 방 정리', () => {
    it('24시간 넘게 방치된 방을 서버 시작 시 지운다', async () => {
      // Given
      const day = 24 * 60 * 60 * 1000;
      let now = 1_700_000_000_000;
      const fixture = createAppFixture({ random: codeRandom() });
      // clock을 앞으로 돌릴 수 있도록 서비스가 쓰는 시계를 교체한다.
      const movableClock = { now: () => now };
      const roomService = new (await import('../../src/application/RoomService.js')).RoomService({
        repository: fixture.repository,
        random: codeRandom(),
        authenticator: fixture.authenticator,
        publisher: fixture.publisher,
        clock: movableClock,
        tokenFactory: fixture.tokenFactory,
        logger: { error: () => {} },
      });
      const oldRoom = await roomService.createRoom({ hostName: '옛방' });
      now += day + 1_000;
      const freshRoom = await roomService.createRoom({ hostName: '새방' });

      // When
      const removed = await roomService.cleanupStaleRooms();

      // Then
      assert.deepEqual(removed, [oldRoom.room.code]);
      assert.equal(await fixture.repository.findByCode(oldRoom.room.code), null);
      assert.notEqual(await fixture.repository.findByCode(freshRoom.room.code), null);
    });

    it('정리할 방이 없으면 빈 목록을 돌려준다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });
      await roomService.createRoom({ hostName: '하나' });

      // When
      const removed = await roomService.cleanupStaleRooms();

      // Then
      assert.deepEqual(removed, []);
    });
  });

  describe('호스트 동작', () => {
    it('호스트는 컴퓨터 좌석을 추가할 수 있다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });
      const host = await roomService.createRoom({ hostName: '하나' });

      // When
      const room = await roomService.hostAction({
        code: host.room.code,
        token: host.seatToken,
        action: { type: 'ADD_COMPUTER', name: '컴퓨터1' },
      });

      // Then
      assert.equal(room.seats.length, 2);
      assert.equal(room.seats[1].kind, SEAT_KINDS.COMPUTER);
    });

    it('호스트는 라운드 제한을 설정할 수 있다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });
      const host = await roomService.createRoom({ hostName: '하나' });

      // When
      const room = await roomService.hostAction({
        code: host.room.code,
        token: host.seatToken,
        action: { type: 'SET_OPTIONS', roundLimit: 20 },
      });

      // Then
      assert.equal(room.options.roundLimit, 20);
    });

    it('호스트가 아니면 호스트 동작이 거부되고 상태가 그대로다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });
      const host = await roomService.createRoom({ hostName: '하나' });
      const guest = await roomService.joinSeat({ code: host.room.code, name: '두리' });

      // When / Then
      await assert.rejects(
        () =>
          roomService.hostAction({
            code: host.room.code,
            token: guest.seatToken,
            action: { type: 'ADD_COMPUTER', name: '컴퓨터1' },
          }),
        { code: 'ERR003' },
      );
      const room = await roomService.getRoom({ code: host.room.code });
      assert.equal(room.seats.length, 2);
    });

    it('토큰이 없으면 인증 에러다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });
      const host = await roomService.createRoom({ hostName: '하나' });

      // When / Then
      await assert.rejects(
        () => roomService.hostAction({ code: host.room.code, token: undefined, action: { type: 'START' } }),
        { code: 'ERR002' },
      );
    });

    it('엉뚱한 토큰이면 인증 에러다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });
      const host = await roomService.createRoom({ hostName: '하나' });

      // When / Then
      await assert.rejects(
        () =>
          roomService.hostAction({
            code: host.room.code,
            token: 'f'.repeat(64),
            action: { type: 'START' },
          }),
        { code: 'ERR002' },
      );
    });

    it('알 수 없는 호스트 동작은 거부한다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });
      const host = await roomService.createRoom({ hostName: '하나' });

      // When / Then
      await assert.rejects(
        () =>
          roomService.hostAction({
            code: host.room.code,
            token: host.seatToken,
            action: { type: 'DROP_DATABASE' },
          }),
        { code: 'ERR001' },
      );
    });

    it('좌석이 2명 미만이면 시작할 수 없다', async () => {
      // Given
      const { roomService } = createAppFixture({ random: codeRandom() });
      const host = await roomService.createRoom({ hostName: '하나' });

      // When / Then
      await assert.rejects(
        () => roomService.hostAction({ code: host.room.code, token: host.seatToken, action: { type: 'START' } }),
        { code: 'ERR013' },
      );
    });

    it('시작하면 게임 스냅샷을 브로드캐스트한다', async () => {
      // Given
      const fixture = createAppFixture({ random: codeRandom() });
      const { roomService, publisher } = fixture;
      const host = await roomService.createRoom({ hostName: '하나' });
      await roomService.joinSeat({ code: host.room.code, name: '두리' });
      publisher.reset();

      // When
      const room = await roomService.hostAction({
        code: host.room.code,
        token: host.seatToken,
        action: { type: 'START' },
      });

      // Then
      assert.equal(room.status, ROOM_STATUS.PLAYING);
      assert.equal(publisher.games.length, 1);
      assert.equal(publisher.lastGame.view.phase, 'AWAIT_ROLL');
      assert.equal(publisher.lastGame.view.currentSeatId, host.seatId);
    });

    it('호스트는 좌석을 자동 진행으로 바꿀 수 있다', async () => {
      // Given
      const fixture = createAppFixture({ random: codeRandom() });
      const started = await startedRoom(fixture, { guestCount: 1 });

      // When
      const room = await fixture.roomService.hostAction({
        code: started.code,
        token: started.host.seatToken,
        action: { type: 'SET_AUTOPILOT', seatId: started.guests[0].seatId, enabled: true },
      });

      // Then
      assert.equal(room.seats[1].autopilot, true);
    });
  });
});
