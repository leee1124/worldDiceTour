import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Room, ROOM_STATUS, MAX_SEATS } from '../../src/domain/room/Room.js';
import { SEAT_KINDS } from '../../src/domain/room/Seat.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { buildGame } from '../support/gameBuilder.js';

let tokenCounter = 0;
const nextToken = () => `token-${(tokenCounter += 1)}`;
const NOW = new Date('2026-09-21T10:00:00.000Z').getTime();

const createRoom = (hostName = '하나') =>
  Room.create({ code: 'AB2C', hostName, token: nextToken(), now: NOW });

/** 호스트 + 참가자 1명이 있는 대기실. */
const roomWithTwoSeats = () => {
  const room = createRoom();
  const guest = room.join({ name: '두리', token: nextToken(), now: NOW });
  return { room, host: room.seatById(room.hostSeatId), guest };
};

describe('Room(방 Aggregate)', () => {
  describe('방 만들기', () => {
    it('방을 만들면 호스트 좌석이 생기고 대기 상태가 된다', () => {
      // Given / When
      const room = createRoom('하나');

      // Then
      assert.equal(room.code, 'AB2C');
      assert.equal(room.status, ROOM_STATUS.LOBBY);
      assert.equal(room.seats.length, 1);
      assert.equal(room.seats[0].name, '하나');
      assert.equal(room.seats[0].kind, SEAT_KINDS.HUMAN);
      assert.equal(room.hostSeatId, room.seats[0].id);
    });

    it('좌석 이름이 비어 있으면 만들 수 없다', () => {
      // Given / When / Then
      assert.throws(() => Room.create({ code: 'AB2C', hostName: '   ', token: nextToken(), now: NOW }), {
        code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      });
    });

    it('기본 옵션은 라운드 제한 없음이다', () => {
      // Given / When
      const room = createRoom();

      // Then
      assert.equal(room.options.roundLimit, null);
    });
  });

  describe('좌석 참가와 퇴장', () => {
    it('대기실에 좌석을 추가할 수 있다', () => {
      // Given
      const room = createRoom();

      // When
      const seat = room.join({ name: '두리', token: nextToken(), now: NOW });

      // Then
      assert.equal(room.seats.length, 2);
      assert.equal(seat.name, '두리');
      assert.notEqual(seat.id, room.hostSeatId);
    });

    it('좌석이 4개면 더 참가할 수 없다', () => {
      // Given
      const room = createRoom();
      room.join({ name: '두리', token: nextToken(), now: NOW });
      room.join({ name: '세찌', token: nextToken(), now: NOW });
      room.join({ name: '네찌', token: nextToken(), now: NOW });

      // When / Then
      assert.equal(room.seats.length, MAX_SEATS);
      assert.equal(room.isFull(), true);
      assert.throws(() => room.join({ name: '다섯', token: nextToken(), now: NOW }), {
        code: DOMAIN_ERROR_CODES.ROOM_FULL,
      });
    });

    it('게임이 시작된 뒤에는 참가할 수 없다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();
      room.start({ bySeatId: host.id, random: new FakeRandomSource(), now: NOW });

      // When / Then
      assert.throws(() => room.join({ name: '세찌', token: nextToken(), now: NOW }), {
        code: DOMAIN_ERROR_CODES.INVALID_STATE,
      });
    });

    it('본인 좌석은 스스로 나갈 수 있다', () => {
      // Given
      const { room, guest } = roomWithTwoSeats();

      // When
      room.removeSeat({ seatId: guest.id, bySeatId: guest.id, now: NOW });

      // Then
      assert.equal(room.seats.length, 1);
    });

    it('호스트는 다른 좌석을 강퇴할 수 있다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();

      // When
      room.removeSeat({ seatId: guest.id, bySeatId: host.id, now: NOW });

      // Then
      assert.equal(room.seats.length, 1);
    });

    it('호스트가 아니면 남의 좌석을 강퇴할 수 없다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();

      // When / Then
      assert.throws(() => room.removeSeat({ seatId: host.id, bySeatId: guest.id, now: NOW }), {
        code: DOMAIN_ERROR_CODES.NOT_HOST,
      });
      assert.equal(room.seats.length, 2);
    });

    it('호스트가 나가면 다음 좌석이 호스트를 이어받는다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();

      // When
      room.removeSeat({ seatId: host.id, bySeatId: host.id, now: NOW });

      // Then
      assert.equal(room.hostSeatId, guest.id);
    });

    it('모든 좌석이 나가면 빈 방이 된다', () => {
      // Given
      const room = createRoom();

      // When
      room.removeSeat({ seatId: room.hostSeatId, bySeatId: room.hostSeatId, now: NOW });

      // Then
      assert.equal(room.isEmpty(), true);
    });

    it('없는 좌석은 제거할 수 없다', () => {
      // Given
      const room = createRoom();

      // When / Then
      assert.throws(() => room.removeSeat({ seatId: 'nope', bySeatId: room.hostSeatId, now: NOW }), {
        code: DOMAIN_ERROR_CODES.SEAT_NOT_FOUND,
      });
    });

    it('게임이 시작된 뒤에는 스스로 나갈 수 없다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();
      room.start({ bySeatId: host.id, random: new FakeRandomSource(), now: NOW });

      // When / Then
      assert.throws(() => room.removeSeat({ seatId: guest.id, bySeatId: guest.id, now: NOW }), {
        code: DOMAIN_ERROR_CODES.INVALID_STATE,
      });
      assert.equal(room.seats.length, 2);
      assert.equal(room.game.players.length, 2);
    });

    it('게임이 시작된 뒤에는 호스트도 좌석을 강퇴할 수 없다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();
      room.start({ bySeatId: host.id, random: new FakeRandomSource(), now: NOW });

      // When / Then
      assert.throws(() => room.removeSeat({ seatId: guest.id, bySeatId: host.id, now: NOW }), {
        code: DOMAIN_ERROR_CODES.INVALID_STATE,
      });
      assert.equal(room.seats.length, 2);
    });

    it('종료된 방에서도 좌석을 제거할 수 없다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();
      room.start({ bySeatId: host.id, random: new FakeRandomSource(), now: NOW });
      room.finish(NOW);

      // When / Then
      assert.throws(() => room.removeSeat({ seatId: guest.id, bySeatId: guest.id, now: NOW }), {
        code: DOMAIN_ERROR_CODES.INVALID_STATE,
      });
      assert.equal(room.seats.length, 2);
    });
  });

  describe('방 요약(로비 목록용)', () => {
    it('목록에 필요한 값만 담은 요약을 만든다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();
      room.setOptions({ roundLimit: 20, bySeatId: host.id, now: NOW });

      // When
      const summary = room.toSummary();

      // Then
      assert.deepEqual(summary, {
        code: 'AB2C',
        status: ROOM_STATUS.LOBBY,
        hostName: '하나',
        seatCount: 2,
        roundLimit: 20,
        updatedAt: NOW,
      });
    });

    it('요약에는 좌석 토큰이나 게임 상태가 들어가지 않는다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();
      room.start({ bySeatId: host.id, random: new FakeRandomSource([1, 2]), now: NOW });

      // When
      const serialized = JSON.stringify(room.toSummary());

      // Then
      assert.equal(serialized.includes('token'), false);
      assert.equal(serialized.includes('game'), false);
      assert.equal(serialized.includes('seats'), false);
    });

    it('빈 방의 호스트 이름은 null이다', () => {
      // Given
      const room = createRoom();
      room.removeSeat({ seatId: room.hostSeatId, bySeatId: room.hostSeatId, now: NOW });

      // When / Then
      assert.equal(room.toSummary().hostName, null);
    });
  });

  describe('호스트 권한', () => {
    it('호스트만 컴퓨터 좌석을 추가할 수 있다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();

      // When
      const computer = room.addComputer({ name: '컴퓨터1', token: nextToken(), bySeatId: host.id, now: NOW });

      // Then
      assert.equal(computer.kind, SEAT_KINDS.COMPUTER);
      assert.equal(computer.isAutoControlled(), true);
      assert.throws(
        () => room.addComputer({ name: '컴퓨터2', token: nextToken(), bySeatId: guest.id, now: NOW }),
        { code: DOMAIN_ERROR_CODES.NOT_HOST },
      );
    });

    it('호스트만 라운드 제한을 바꿀 수 있다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();

      // When
      room.setOptions({ roundLimit: 20, bySeatId: host.id, now: NOW });

      // Then
      assert.equal(room.options.roundLimit, 20);
      assert.throws(() => room.setOptions({ roundLimit: 30, bySeatId: guest.id, now: NOW }), {
        code: DOMAIN_ERROR_CODES.NOT_HOST,
      });
    });

    it('허용되지 않은 라운드 제한 값은 거부한다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();

      // When / Then
      assert.throws(() => room.setOptions({ roundLimit: 7, bySeatId: host.id, now: NOW }), {
        code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      });
    });

    it('호스트만 좌석을 자동 진행으로 전환하거나 되돌릴 수 있다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();

      // When
      room.setAutopilot({ seatId: guest.id, enabled: true, bySeatId: host.id, onlineSeatIds: [], now: NOW });

      // Then
      assert.equal(room.seatById(guest.id).autopilot, true);
      assert.equal(room.seatById(guest.id).isAutoControlled(), true);
      room.setAutopilot({ seatId: guest.id, enabled: false, bySeatId: host.id, onlineSeatIds: [], now: NOW });
      assert.equal(room.seatById(guest.id).isAutoControlled(), false);
      assert.throws(
        () =>
          room.setAutopilot({
            seatId: host.id,
            enabled: true,
            bySeatId: guest.id,
            onlineSeatIds: [],
            now: NOW,
          }),
        { code: DOMAIN_ERROR_CODES.NOT_HOST },
      );
    });
  });

  describe('자동 진행 전환(이중 조종 방지)', () => {
    it('접속 중인 사람 좌석은 자동 진행으로 바꿀 수 없다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();

      // When / Then
      assert.throws(
        () =>
          room.setAutopilot({
            seatId: guest.id,
            enabled: true,
            bySeatId: host.id,
            onlineSeatIds: [guest.id],
            now: NOW,
          }),
        { code: DOMAIN_ERROR_CODES.INVALID_STATE },
      );
      assert.equal(room.seatById(guest.id).autopilot, false);
    });

    it('오프라인 좌석은 자동 진행으로 바꿀 수 있다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();

      // When
      room.setAutopilot({
        seatId: guest.id,
        enabled: true,
        bySeatId: host.id,
        onlineSeatIds: [host.id],
        now: NOW,
      });

      // Then
      assert.equal(room.seatById(guest.id).autopilot, true);
    });

    it('자동 진행 해제는 그 좌석 본인도 할 수 있다(돌아왔을 때 스스로 조종권 회수)', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();
      room.setAutopilot({ seatId: guest.id, enabled: true, bySeatId: host.id, onlineSeatIds: [], now: NOW });

      // When (돌아온 좌석은 온라인이지만 해제는 막지 않는다)
      room.setAutopilot({
        seatId: guest.id,
        enabled: false,
        bySeatId: guest.id,
        onlineSeatIds: [guest.id],
        now: NOW,
      });

      // Then
      assert.equal(room.seatById(guest.id).autopilot, false);
    });

    it('남의 좌석 자동 진행을 해제하려면 호스트여야 한다', () => {
      // Given (세 좌석: 호스트, 두리, 세찌)
      const { room, host, guest } = roomWithTwoSeats();
      const third = room.join({ name: '세찌', token: nextToken(), now: NOW });
      room.setAutopilot({ seatId: third.id, enabled: true, bySeatId: host.id, onlineSeatIds: [], now: NOW });

      // When / Then
      assert.throws(
        () =>
          room.setAutopilot({
            seatId: third.id,
            enabled: false,
            bySeatId: guest.id,
            onlineSeatIds: [],
            now: NOW,
          }),
        { code: DOMAIN_ERROR_CODES.NOT_HOST },
      );
      assert.equal(room.seatById(third.id).autopilot, true);
    });

    it('본인이라도 자기 좌석을 스스로 자동 진행으로 켤 수는 없다(호스트 전용)', () => {
      // Given
      const { room, guest } = roomWithTwoSeats();

      // When / Then
      assert.throws(
        () =>
          room.setAutopilot({
            seatId: guest.id,
            enabled: true,
            bySeatId: guest.id,
            onlineSeatIds: [],
            now: NOW,
          }),
        { code: DOMAIN_ERROR_CODES.NOT_HOST },
      );
    });

    it('컴퓨터 좌석의 자동 진행 설정은 바꿀 수 없다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();
      const computer = room.addComputer({ name: '컴퓨터1', token: nextToken(), bySeatId: host.id, now: NOW });

      // When / Then
      assert.throws(
        () =>
          room.setAutopilot({
            seatId: computer.id,
            enabled: false,
            bySeatId: host.id,
            onlineSeatIds: [],
            now: NOW,
          }),
        { code: DOMAIN_ERROR_CODES.INVALID_STATE },
      );
    });

    it('자동 진행 중인 좌석의 커맨드는 사람이 직접 보낼 수 없다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();
      room.start({ bySeatId: host.id, random: new FakeRandomSource([1, 2]), now: NOW });
      room.setAutopilot({ seatId: guest.id, enabled: true, bySeatId: host.id, onlineSeatIds: [], now: NOW });

      // When / Then
      assert.throws(() => room.assertManualControl(guest.id), {
        code: DOMAIN_ERROR_CODES.FORBIDDEN,
      });
      assert.doesNotThrow(() => room.assertManualControl(host.id));
    });

    it('현재 턴 좌석이 자동 진행 대상인지 알려준다', () => {
      // Given
      const { room, host, guest } = roomWithTwoSeats();
      room.start({ bySeatId: host.id, random: new FakeRandomSource([1, 2]), now: NOW });

      // When / Then (첫 턴은 호스트)
      assert.equal(room.currentSeatIsAutoControlled(), false);
      room.setAutopilot({ seatId: host.id, enabled: true, bySeatId: host.id, onlineSeatIds: [], now: NOW });
      assert.equal(room.currentSeatIsAutoControlled(), true);
      assert.equal(room.seatById(guest.id).isAutoControlled(), false);
    });
  });

  describe('게임 시작', () => {
    it('호스트가 시작하면 게임이 생성되고 진행 상태가 된다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();

      // When
      room.start({ bySeatId: host.id, random: new FakeRandomSource(), now: NOW });

      // Then
      assert.equal(room.status, ROOM_STATUS.PLAYING);
      assert.equal(room.game.phase, PHASES.AWAIT_ROLL);
      assert.equal(room.game.players.length, 2);
    });

    it('라운드 제한 옵션이 게임에 전달된다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();
      room.setOptions({ roundLimit: 20, bySeatId: host.id, now: NOW });

      // When
      room.start({ bySeatId: host.id, random: new FakeRandomSource(), now: NOW });

      // Then
      assert.equal(room.game.options.roundLimit, 20);
    });

    it('좌석이 2개 미만이면 시작할 수 없다', () => {
      // Given
      const room = createRoom();

      // When / Then
      assert.throws(() => room.start({ bySeatId: room.hostSeatId, random: new FakeRandomSource(), now: NOW }), {
        code: DOMAIN_ERROR_CODES.NOT_ENOUGH_SEATS,
      });
    });

    it('호스트가 아니면 시작할 수 없다', () => {
      // Given
      const { room, guest } = roomWithTwoSeats();

      // When / Then
      assert.throws(() => room.start({ bySeatId: guest.id, random: new FakeRandomSource(), now: NOW }), {
        code: DOMAIN_ERROR_CODES.NOT_HOST,
      });
      assert.equal(room.status, ROOM_STATUS.LOBBY);
    });

    it('이미 시작된 방은 다시 시작할 수 없다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();
      room.start({ bySeatId: host.id, random: new FakeRandomSource(), now: NOW });

      // When / Then
      assert.throws(() => room.start({ bySeatId: host.id, random: new FakeRandomSource(), now: NOW }), {
        code: DOMAIN_ERROR_CODES.INVALID_STATE,
      });
    });
  });

  describe('커맨드 중계', () => {
    it('진행 중인 게임에 커맨드를 전달한다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();
      room.start({ bySeatId: host.id, random: new FakeRandomSource([1, 2]), now: NOW });

      // When
      const events = room.executeCommand({ seatId: host.id, type: COMMAND_TYPES.ROLL, now: NOW });

      // Then
      assert.ok(events.length > 0);
      assert.equal(room.game.version, 1);
    });

    it('대기실에서는 게임 커맨드를 받지 않는다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();

      // When / Then
      assert.throws(() => room.executeCommand({ seatId: host.id, type: COMMAND_TYPES.ROLL, now: NOW }), {
        code: DOMAIN_ERROR_CODES.INVALID_STATE,
      });
    });

    it('게임이 끝나면 방이 종료 상태가 된다', () => {
      // Given (정리 페이즈까지 진행된 게임을 가진 방)
      const game = buildGame({
        cash: { s1: 5_000 },
        cities: [{ index: 3, ownerId: 's2', buildings: ['VILLA', 'BUILDING', 'HOTEL'] }],
        random: new FakeRandomSource([1, 2]),
      });
      game.execute('s1', COMMAND_TYPES.ROLL);
      const room = Room.restore(
        {
          code: 'AB2C',
          status: ROOM_STATUS.PLAYING,
          hostSeatId: 's1',
          options: { roundLimit: null },
          seats: [
            { id: 's1', name: '하나', kind: SEAT_KINDS.HUMAN, token: 'tok-1', autopilot: false },
            { id: 's2', name: '두리', kind: SEAT_KINDS.HUMAN, token: 'tok-2', autopilot: false },
          ],
          game: game.toSnapshot(),
          createdAt: NOW,
          updatedAt: NOW,
        },
        new FakeRandomSource(),
      );

      // When
      room.executeCommand({ seatId: 's1', type: COMMAND_TYPES.DECLARE_BANKRUPTCY, now: NOW });

      // Then
      assert.equal(room.status, ROOM_STATUS.FINISHED);
      assert.equal(room.isFinished(), true);
    });
  });

  describe('토큰 해석', () => {
    it('토큰으로 좌석을 찾는다', () => {
      // Given
      const token = nextToken();
      const room = Room.create({ code: 'AB2C', hostName: '하나', token, now: NOW });
      const compare = (a, b) => a === b;

      // When
      const seatId = room.findSeatIdByToken(token, compare);

      // Then
      assert.equal(seatId, room.hostSeatId);
    });

    it('모르는 토큰이면 null을 돌려준다', () => {
      // Given
      const room = createRoom();

      // When
      const seatId = room.findSeatIdByToken('bogus', (a, b) => a === b);

      // Then
      assert.equal(seatId, null);
    });

    it('토큰 비교는 주입된 비교 함수만 사용한다', () => {
      // Given
      const token = nextToken();
      const room = Room.create({ code: 'AB2C', hostName: '하나', token, now: NOW });
      const calls = [];
      const compare = (a, b) => {
        calls.push([a, b]);
        return false;
      };

      // When
      room.findSeatIdByToken(token, compare);

      // Then
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], [token, token]);
    });
  });

  describe('오래된 방 정리', () => {
    it('종료된 방은 24시간이 지나면 정리 대상이다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();
      room.start({ bySeatId: host.id, random: new FakeRandomSource(), now: NOW });
      room.finish(NOW);

      // When / Then
      assert.equal(room.isStale(NOW + 24 * 60 * 60 * 1000 + 1), true);
      assert.equal(room.isStale(NOW + 1000), false);
    });

    it('오래 방치된 대기실도 정리 대상이다', () => {
      // Given
      const room = createRoom();

      // When / Then
      assert.equal(room.isStale(NOW + 25 * 60 * 60 * 1000), true);
    });
  });

  describe('직렬화', () => {
    it('스냅샷으로 저장하고 복원하면 상태가 같다', () => {
      // Given
      const { room, host } = roomWithTwoSeats();
      room.setOptions({ roundLimit: 30, bySeatId: host.id, now: NOW });
      room.start({ bySeatId: host.id, random: new FakeRandomSource([1, 2]), now: NOW });
      room.executeCommand({ seatId: host.id, type: COMMAND_TYPES.ROLL, now: NOW });

      // When
      const snapshot = room.toSnapshot();
      const restored = Room.restore(snapshot, new FakeRandomSource());

      // Then
      assert.deepEqual(restored.toSnapshot(), snapshot);
      assert.equal(restored.game.version, room.game.version);
    });

    it('좌석 토큰은 스냅샷에만 담기고 별도 조회로는 노출되지 않는다', () => {
      // Given
      const token = nextToken();
      const room = Room.create({ code: 'AB2C', hostName: '하나', token, now: NOW });

      // When
      const snapshot = room.toSnapshot();

      // Then
      assert.equal(snapshot.seats[0].token, token);
      assert.equal(Object.hasOwn(room.seats[0], 'token'), false);
      assert.equal(JSON.stringify(room.seats[0]).includes(token), false);
    });
  });
});
