import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { FileRoomRepository } from '../../src/infrastructure/FileRoomRepository.js';
import {
  RoomSchemaError,
  deserializeRoom,
  validateRoomSnapshot,
} from '../../src/infrastructure/RoomSerializer.js';
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

    it('깨진 파일은 .corrupt로 격리해 유령 방이 남지 않게 한다', async () => {
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
      const entries = await readdir(directory);
      assert.deepEqual(entries, ['AB2C.json.corrupt']);
      assert.ok(logs.some((message) => /격리/.test(message)), logs.join('\n'));
    });

    it('격리된 파일은 같은 코드로 방을 다시 만들 수 있게 비켜준다', async () => {
      // Given
      const repository = newRepository();
      await writeFile(path.join(directory, 'AB2C.json'), 'broken', 'utf8');
      await repository.findByCode('AB2C');

      // When
      await repository.save(Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW }));

      // Then
      const reloaded = await repository.findByCode('AB2C');
      assert.equal(reloaded.code, 'AB2C');
      assert.equal(reloaded.seats.length, 1);
    });

    it('격리 파일은 목록 조회 대상이 아니다', async () => {
      // Given
      const repository = newRepository();
      await repository.save(Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW }));
      await writeFile(path.join(directory, 'DEF2.json'), 'broken', 'utf8');

      // When
      await repository.findAll();
      const rooms = await repository.findAll();

      // Then
      assert.deepEqual(rooms.map((room) => room.code), ['AB2C']);
      assert.deepEqual((await readdir(directory)).sort(), ['AB2C.json', 'DEF2.json.corrupt']);
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

    describe('턴 상태(turn) 검증', () => {
      /** 통행료를 못 내 정리 페이즈에 들어간 방(= turn.debt가 채워진 스냅샷). */
      const liquidationSnapshot = () => {
        const random = new FakeRandomSource([1, 2]);
        const room = Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW });
        room.join({ name: '두리', token: 'b'.repeat(64), now: NOW });
        room.start({ bySeatId: room.hostSeatId, random, now: NOW });
        const snapshot = room.toSnapshot();
        // 3번 칸을 두리 소유(호텔·빌딩·별장)로 만들고 하나의 현금을 통행료 미달로 낮춘다.
        snapshot.game.board = [
          { index: 3, ownerId: 'seat-2', buildings: ['VILLA', 'BUILDING', 'HOTEL'], landmark: false },
        ];
        snapshot.game.players[0].cash = 5_000;
        const restored = deserializeRoom(snapshot, new FakeRandomSource([1, 2]));
        restored.executeCommand({ seatId: 'seat-1', type: COMMAND_TYPES.ROLL, now: NOW });
        return restored.toSnapshot();
      };

      it('정상적인 정리 페이즈 스냅샷은 통과한다', () => {
        // Given
        const snapshot = liquidationSnapshot();

        // Then
        assert.equal(snapshot.game.phase, 'AWAIT_LIQUIDATION');
        assert.notEqual(snapshot.game.turn.debt, null);
        assert.doesNotThrow(() => validateRoomSnapshot(snapshot));
      });

      const corruptions = [
        ['turn이 객체가 아니면', (game) => { game.turn = 'nope'; }],
        ['rollWasDouble가 불리언이 아니면', (game) => { game.turn.rollWasDouble = 1; }],
        ['casinoRoundsLeft가 정수가 아니면', (game) => { game.turn.casinoRoundsLeft = 1.5; }],
        ['casinoRoundsLeft가 음수면', (game) => { game.turn.casinoRoundsLeft = -1; }],
        ['casinoRoundsLeft가 방문 한도를 넘으면', (game) => { game.turn.casinoRoundsLeft = 9; }],
        ['buildIndex가 칸 범위를 벗어나면', (game) => { game.turn.buildIndex = 40; }],
        ['acquireIndex가 칸 범위를 벗어나면', (game) => { game.turn.acquireIndex = -2; }],
        ['debt.items가 배열이 아니면', (game) => { game.turn.debt.items = {}; }],
        ['debt.items가 비어 있으면', (game) => { game.turn.debt.items = []; }],
        ['debt 금액이 정수가 아니면', (game) => { game.turn.debt.items[0].amount = 1.5; }],
        ['debt 금액이 음수면', (game) => { game.turn.debt.items[0].amount = -1; }],
        ['debt sink가 enum이 아니면', (game) => { game.turn.debt.items[0].sink = 'MARS'; }],
        ['debt 채권자가 좌석에 없으면', (game) => { game.turn.debt.items[0].toPlayerId = 'ghost'; }],
        ['debt reason이 enum이 아니면', (game) => { game.turn.debt.reason = 'BECAUSE'; }],
        ['debt event 종류가 enum이 아니면', (game) => { game.turn.debt.event.type = 'HACKED'; }],
        ['debt next.kind가 enum이 아니면', (game) => { game.turn.debt.next.kind = 'ELSEWHERE'; }],
        [
          '인수로 이어지는 debt에 칸 번호가 없으면',
          (game) => { game.turn.debt.next = { kind: 'ACQUIRE' }; },
        ],
        [
          '정리 페이즈인데 채무가 없으면',
          (game) => { game.turn.debt = null; },
        ],
        [
          '채무가 있는데 정리 페이즈가 아니면',
          (game) => { game.phase = 'AWAIT_ROLL'; },
        ],
        ['잭팟이 음수면', (game) => { game.casino.jackpot = -1; }],
        ['장부 값이 정수가 아니면', (game) => { game.ledger.fromBank = 1.5; }],
        ['장부 값이 음수면', (game) => { game.ledger.toBank = -1; }],
        ['initialTotal이 정수가 아니면', (game) => { game.initialTotal = 'many'; }],
      ];

      for (const [label, corrupt] of corruptions) {
        it(`${label} 거부한다`, () => {
          // Given
          const snapshot = liquidationSnapshot();
          corrupt(snapshot.game);

          // When / Then
          assert.throws(() => validateRoomSnapshot(snapshot), RoomSchemaError);
        });
      }

      const phaseCoherence = [
        ['AWAIT_BUILD', 'buildIndex'],
        ['AWAIT_ACQUIRE', 'acquireIndex'],
      ];

      for (const [phase, field] of phaseCoherence) {
        it(`${phase} 페이즈인데 ${field}가 비어 있으면 거부한다`, () => {
          // Given
          const snapshot = liquidationSnapshot();
          snapshot.game.phase = phase;
          snapshot.game.turn.debt = null;
          snapshot.game.turn[field] = null;

          // When / Then
          assert.throws(() => validateRoomSnapshot(snapshot), RoomSchemaError);
        });
      }

      it('AWAIT_CASINO 페이즈인데 남은 판이 0이면 거부한다', () => {
        // Given
        const snapshot = liquidationSnapshot();
        snapshot.game.phase = 'AWAIT_CASINO';
        snapshot.game.turn.debt = null;
        snapshot.game.turn.casinoRoundsLeft = 0;

        // When / Then
        assert.throws(() => validateRoomSnapshot(snapshot), RoomSchemaError);
      });

      it('turn이 깨진 파일은 파일 저장소가 격리한다', async () => {
        // Given
        const repository = newRepository();
        const snapshot = liquidationSnapshot();
        snapshot.game.turn.debt.items[0].sink = 'MARS';
        await writeFile(path.join(directory, 'AB2C.json'), JSON.stringify(snapshot), 'utf8');

        // When
        const room = await repository.findByCode('AB2C');

        // Then
        assert.equal(room, null);
        assert.deepEqual(await readdir(directory), ['AB2C.json.corrupt']);
      });
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
