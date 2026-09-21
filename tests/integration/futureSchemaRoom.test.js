import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { FileRoomRepository } from '../../src/infrastructure/FileRoomRepository.js';
import { RoomVersionError, migrateRoomSnapshot } from '../../src/infrastructure/RoomSerializer.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';

const silentLogger = { error: () => {}, warn: () => {}, info: () => {} };

/**
 * 롤백 안전성.
 *
 * `schemaVersion`을 도입한 이유는 "모르는 파일을 덮어써서 판을 잃지 않는 것"이다. 그런데
 * 거부가 곧 **격리(파일 이름 변경)** 로 이어지면 롤백 한 번에 진행 중인 판이 사라진다 —
 * 거부의 목적 자체가 무너진다. 그래서 미래 버전 파일은 **그대로 남아 있어야** 한다.
 */
describe('이 서버보다 새로운 저장 파일(롤백 안전성)', () => {
  const futureRoom = (code) =>
    JSON.stringify({
      schemaVersion: 99,
      code,
      status: 'PLAYING',
      hostSeatId: 'seat-1',
      seats: [{ id: 'seat-1', name: '하나', kind: 'HUMAN', token: 'a'.repeat(64), autopilot: false }],
      options: { roundLimit: null, finance: {}, unknownFutureOption: true },
      game: { somethingThisServerCannotRead: true },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      seatSequence: 1,
    });

  async function repositoryWithFutureRoom(code = 'KD4M') {
    const dir = await mkdtemp(path.join(tmpdir(), 'wdt-future-'));
    const text = futureRoom(code);
    await writeFile(path.join(dir, `${code}.json`), text, 'utf8');
    const repository = new FileRoomRepository({
      directory: dir,
      random: new SeededRandomSource(1),
      logger: silentLogger,
    });
    return { dir, repository, text };
  }

  it('승급기가 미래 버전을 손상과 구별해 알려준다', () => {
    // Given
    const raw = JSON.parse(futureRoom('KD4M'));

    // When / Then
    assert.throws(() => migrateRoomSnapshot(raw), RoomVersionError);
  });

  it('저장소를 띄워도 파일을 격리하지 않고 그대로 남긴다', async () => {
    // Given
    const { dir, repository, text } = await repositoryWithFutureRoom();

    // When
    await repository.init();
    const loaded = await repository.findByCode('KD4M');

    // Then
    assert.equal(loaded, null, '이 서버는 그 방을 열 수 없다');
    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, ['KD4M.json'], `격리되면 안 된다: ${files.join(', ')}`);
    assert.equal(await readFile(path.join(dir, 'KD4M.json'), 'utf8'), text, '내용이 그대로다');
  });

  it('그 방 코드는 예약된 것으로 취급해 새 방이 덮어쓰지 못한다', async () => {
    // Given
    const { repository } = await repositoryWithFutureRoom();
    await repository.init();

    // When / Then
    assert.equal(repository.isCodeReserved('KD4M'), true);
    assert.equal(repository.isCodeReserved('AB2C'), false, '평범한 빈 코드는 쓸 수 있다');
  });

  it('목록 조회에서도 빠지고 다른 방은 정상으로 남는다', async () => {
    // Given
    const { dir, repository } = await repositoryWithFutureRoom();
    await repository.init();

    // When
    const summaries = await repository.findAllSummaries();

    // Then
    assert.deepEqual(summaries, []);
    assert.deepEqual((await readdir(dir)).sort(), ['KD4M.json']);
  });
});
