import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { FileRoomRepository } from '../../src/infrastructure/FileRoomRepository.js';
import { RoomSchemaError, validateRoomSnapshot } from '../../src/infrastructure/RoomSerializer.js';
import { Room, ROOM_STATUS } from '../../src/domain/room/Room.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';

const NOW = 1_700_000_000_000;
let directory;
const silentLogger = { error: () => {} };

const newRepository = (random = new FakeRandomSource([1, 2, 3, 4])) =>
  new FileRoomRepository({ directory, random, logger: silentLogger });

const playingRoom = (random) => {
  const room = Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW });
  room.join({ name: '두리', token: 'b'.repeat(64), now: NOW });
  room.start({ bySeatId: room.hostSeatId, random, now: NOW });
  return room;
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'wdt-rooms-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('FileRoomRepository(파일 저장소)', () => {
  it('방을 저장하고 같은 상태로 불러온다', async () => {
    // Given
    const random = new FakeRandomSource([1, 2]);
    const repository = newRepository(random);
    const room = playingRoom(random);
    room.executeCommand({ seatId: room.hostSeatId, type: COMMAND_TYPES.ROLL, now: NOW });

    // When
    await repository.save(room);
    const loaded = await repository.findByCode('AB2C');

    // Then
    assert.deepEqual(loaded.toSnapshot(), room.toSnapshot());
    assert.equal(loaded.status, ROOM_STATUS.PLAYING);
    assert.equal(loaded.game.version, 1);
  });

  it('저장 파일은 방 코드 이름의 JSON이다', async () => {
    // Given
    const repository = newRepository();
    const room = Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW });

    // When
    await repository.save(room);

    // Then
    const text = await readFile(path.join(directory, 'AB2C.json'), 'utf8');
    assert.equal(JSON.parse(text).code, 'AB2C');
  });

  it('없는 방은 null을 돌려준다', async () => {
    // Given
    const repository = newRepository();

    // When / Then
    assert.equal(await repository.findByCode('ZZZZ'), null);
  });

  it('형식이 잘못된 방 코드는 조회하지 않는다', async () => {
    // Given
    const repository = newRepository();

    // When / Then
    assert.equal(await repository.findByCode('../secret'), null);
  });

  it('방 목록을 모두 불러온다', async () => {
    // Given
    const repository = newRepository();
    await repository.save(Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW }));
    await repository.save(Room.create({ code: 'DEF2', hostName: '두리', token: 'b'.repeat(64), now: NOW }));

    // When
    const rooms = await repository.findAll();

    // Then
    assert.deepEqual(rooms.map((room) => room.code).sort(), ['AB2C', 'DEF2']);
  });

  it('방을 삭제한다', async () => {
    // Given
    const repository = newRepository();
    await repository.save(Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW }));

    // When
    await repository.delete('AB2C');

    // Then
    assert.equal(await repository.findByCode('AB2C'), null);
  });

  it('없는 방을 삭제해도 예외가 나지 않는다', async () => {
    // Given
    const repository = newRepository();

    // When / Then
    await assert.doesNotReject(() => repository.delete('ZZZZ'));
  });

  describe('스키마 검증', () => {
    it('깨진 JSON 파일은 건너뛰고 로그를 남긴다', async () => {
      // Given
      const logs = [];
      const repository = new FileRoomRepository({
        directory,
        random: new FakeRandomSource(),
        logger: { error: (message) => logs.push(message) },
      });
      await writeFile(path.join(directory, 'AB2C.json'), '{ not json', 'utf8');

      // When
      const room = await repository.findByCode('AB2C');

      // Then
      assert.equal(room, null);
      assert.match(logs[0], /스키마 오류/);
    });

    it('스키마에 맞지 않는 파일은 버린다', async () => {
      // Given
      const logs = [];
      const repository = new FileRoomRepository({
        directory,
        random: new FakeRandomSource(),
        logger: { error: (message) => logs.push(message) },
      });
      await writeFile(
        path.join(directory, 'AB2C.json'),
        JSON.stringify({ code: 'AB2C', status: 'HACKED', seats: [] }),
        'utf8',
      );

      // When
      const room = await repository.findByCode('AB2C');

      // Then
      assert.equal(room, null);
      assert.match(logs[0], /방 상태 오류/);
    });

    it('목록 조회는 깨진 파일을 제외하고 돌려준다', async () => {
      // Given
      const repository = new FileRoomRepository({
        directory,
        random: new FakeRandomSource(),
        logger: silentLogger,
      });
      await repository.save(Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW }));
      await writeFile(path.join(directory, 'DEF2.json'), 'broken', 'utf8');

      // When
      const rooms = await repository.findAll();

      // Then
      assert.deepEqual(rooms.map((room) => room.code), ['AB2C']);
    });

    it('좌석 수가 한도를 넘는 스냅샷을 거부한다', () => {
      // Given
      const snapshot = {
        code: 'AB2C',
        status: ROOM_STATUS.LOBBY,
        hostSeatId: 'seat-1',
        seats: Array.from({ length: 5 }, (_unused, index) => ({
          id: `seat-${index + 1}`,
          name: '이름',
          kind: 'HUMAN',
          token: 'a'.repeat(64),
          autopilot: false,
        })),
        options: { roundLimit: null },
        game: null,
        createdAt: NOW,
        updatedAt: NOW,
      };

      // When / Then
      assert.throws(() => validateRoomSnapshot(snapshot), RoomSchemaError);
    });

    it('좌석에 없는 플레이어가 게임에 있으면 거부한다', () => {
      // Given
      const random = new FakeRandomSource([1, 2]);
      const room = playingRoom(random);
      const snapshot = room.toSnapshot();
      snapshot.game.players[0].id = 'ghost';

      // When / Then
      assert.throws(() => validateRoomSnapshot(snapshot), RoomSchemaError);
    });

    it('대기실 상태인데 게임이 들어 있으면 거부한다', () => {
      // Given
      const random = new FakeRandomSource([1, 2]);
      const room = playingRoom(random);
      const snapshot = room.toSnapshot();
      snapshot.status = ROOM_STATUS.LOBBY;

      // When / Then
      assert.throws(() => validateRoomSnapshot(snapshot), RoomSchemaError);
    });
  });
});
