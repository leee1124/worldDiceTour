import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRoomRepository } from '../../src/infrastructure/InMemoryRoomRepository.js';
import { Room } from '../../src/domain/room/Room.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';

const NOW = 1_700_000_000_000;
const silentLogger = { error: () => {} };

const lobbyRoom = (code, hostName = '하나') =>
  Room.create({ code, hostName, token: 'a'.repeat(64), now: NOW });

const newRepository = (logger = silentLogger) =>
  new InMemoryRoomRepository({ random: new FakeRandomSource(), logger });

describe('InMemoryRoomRepository(테스트용 저장소)', () => {
  it('저장한 방을 같은 상태로 불러온다', async () => {
    // Given
    const repository = newRepository();

    // When
    await repository.save(lobbyRoom('AB2C'));

    // Then
    const loaded = await repository.findByCode('AB2C');
    assert.equal(loaded.code, 'AB2C');
    assert.equal(loaded.seats.length, 1);
  });

  it('해석할 수 없는 방은 목록에서 건너뛰고 로그를 남긴다', async () => {
    // Given
    const logs = [];
    const repository = newRepository({ error: (message) => logs.push(message) });
    await repository.save(lobbyRoom('AB2C'));
    repository.seedRaw('DEF2', '{ not json');

    // When
    const rooms = await repository.findAll();

    // Then
    assert.deepEqual(rooms.map((room) => room.code), ['AB2C']);
    assert.ok(logs.some((message) => /DEF2/.test(message)), logs.join('\n'));
  });

  it('해석할 수 없는 방을 코드로 조회하면 null이고 저장소에서 사라진다', async () => {
    // Given
    const repository = newRepository();
    repository.seedRaw('DEF2', '{ not json');

    // When
    const room = await repository.findByCode('DEF2');

    // Then
    assert.equal(room, null);
    assert.equal(repository.size, 0);
  });

  it('스키마를 위반한 방도 같은 방식으로 건너뛴다', async () => {
    // Given
    const repository = newRepository();
    repository.seedRaw('DEF2', JSON.stringify({ code: 'DEF2', status: 'HACKED', seats: [] }));

    // When
    const rooms = await repository.findAll();

    // Then
    assert.deepEqual(rooms, []);
  });
});
