import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AutoPlayerPolicy } from '../../src/application/AutoPlayerPolicy.js';
import { toGameViewDto } from '../../src/application/dto.js';
import {
  CURRENT_ROOM_SCHEMA_VERSION,
  RoomSchemaError,
  deserializeRoom,
  migrateRoomSnapshot,
  parseRoomJson,
  serializeRoom,
  validateRoomSnapshot,
} from '../../src/infrastructure/RoomSerializer.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';
import { ROOM_SCHEMA_VERSION, Room } from '../../src/domain/room/Room.js';
import { DEFAULT_FINANCE_OPTIONS } from '../../src/domain/room/FinanceOptions.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';

const NOW = 1_700_000_000_000;

/**
 * 리팩터 **이전**(schemaVersion 개념이 없던 시절) 직렬화기가 만든 실제 저장 파일이다.
 * 손으로 쓴 것이 아니라 그때의 `serializeRoom()` 출력을 그대로 떠 놓은 것이라,
 * "옛날에 저장된 방이 지금도 열리는가"를 진짜로 증명한다.
 */
const legacy = (name) =>
  readFileSync(new URL(`./fixtures/roomSchemaV1.${name}.json`, import.meta.url), 'utf8');

describe('저장 스키마 마이그레이션(구버전 방 파일 호환)', () => {
  it('schemaVersion이 없는 대기실 방 파일을 그대로 불러온다', () => {
    // Given
    const text = legacy('lobby');
    assert.equal(JSON.parse(text).schemaVersion, undefined, '픽스처는 schemaVersion이 없어야 한다');

    // When
    const room = parseRoomJson(text, new SeededRandomSource(1));

    // Then
    assert.equal(room.code, 'AB2C');
    assert.equal(room.status, 'LOBBY');
    assert.equal(room.seats.length, 2);
    assert.equal(room.options.roundLimit, 30);
    assert.equal(room.game, null);
  });

  it('schemaVersion이 없는 진행 중 방 파일을 불러와 이어서 끝까지 진행할 수 있다', () => {
    // Given
    const snapshot = JSON.parse(legacy('playing'));
    assert.equal(snapshot.schemaVersion, undefined, '픽스처는 schemaVersion이 없어야 한다');
    const room = deserializeRoom(snapshot, new SeededRandomSource(20_260_921));
    const policy = new AutoPlayerPolicy();

    // Then (복원 직후 상태가 저장 시점 그대로다)
    assert.equal(room.status, 'PLAYING');
    assert.equal(room.game.phase, 'AWAIT_BUILD');
    assert.equal(room.game.round, 17);
    assert.equal(room.game.version, 140);
    assert.equal(room.game.jackpot, 326_500);
    assert.equal(room.game.moneyReport().balanced, true);

    // When (이어하기)
    let steps = 0;
    while (steps < 5_000 && room.isPlaying() && !room.game.isOver()) {
      const decision = policy.decide(toGameViewDto(room.game));
      assert.ok(decision, `결정할 수 없는 페이즈: ${room.game.phase}`);
      room.executeCommand({
        seatId: room.game.currentPlayerId,
        type: decision.type,
        payload: decision.payload,
        now: NOW,
      });
      assert.equal(room.game.moneyReport().balanced, true, `${steps}번째에서 돈 보존 위반`);
      steps += 1;
    }

    // Then
    assert.ok(steps > 0, '한 수도 두지 못했다');
    assert.equal(room.game.isOver(), true, `커맨드 ${steps}회 안에 끝나지 않았다`);
    assert.equal(room.isFinished(), true);
    assert.equal(room.game.rankings().length, 4);
  });

  it('구버전 방을 불러오면 schemaVersion 2 + 금융 옵션 기본값으로 올라온다', () => {
    // Given
    const snapshot = JSON.parse(legacy('playing'));
    assert.equal(snapshot.options.finance, undefined, '픽스처에는 금융 옵션이 없어야 한다');

    // When
    const room = deserializeRoom(snapshot, new SeededRandomSource(1));
    const upgraded = room.toSnapshot();

    // Then
    assert.equal(upgraded.schemaVersion, 2);
    assert.deepEqual(upgraded.options, {
      roundLimit: 30,
      finance: DEFAULT_FINANCE_OPTIONS,
    });
    assert.equal(snapshot.schemaVersion, undefined, '입력 스냅샷을 변형하지 않는다');
  });

  it('구버전 방의 장부는 사유별 내역이 없어 미분류 순액으로 남는다(불변식 자체는 유지)', () => {
    // Given
    const room = deserializeRoom(JSON.parse(legacy('playing')), new SeededRandomSource(1));

    // When
    const report = room.game.moneyReport();

    // Then
    assert.equal(report.balanced, true, '보존 불변식은 그대로 성립한다');
    assert.deepEqual(report.breakdown, {});
    assert.equal(report.breakdownBalanced, false, '과거 순유입의 사유는 되살릴 수 없다');
  });

  it('v1 → v2 왕복: 승급한 방을 다시 저장하면 그대로 다시 읽힌다', () => {
    // Given
    const room = deserializeRoom(JSON.parse(legacy('playing')), new SeededRandomSource(1));

    // When
    const text = serializeRoom(room);
    const again = parseRoomJson(text, new SeededRandomSource(1));

    // Then
    assert.equal(JSON.parse(text).schemaVersion, 2);
    assert.deepEqual(again.toSnapshot(), room.toSnapshot());
  });
});

describe('migrateRoomSnapshot(스키마 승급)', () => {
  const v1 = () => ({
    code: 'AB2C',
    status: 'LOBBY',
    hostSeatId: 'seat-1',
    seats: [{ id: 'seat-1', name: '하나', kind: 'HUMAN', token: 'a'.repeat(64), autopilot: false }],
    options: { roundLimit: 20 },
    game: null,
    createdAt: NOW,
    updatedAt: NOW,
    seatSequence: 1,
  });

  it('schemaVersion이 없으면 1로 보고 2로 올린다', () => {
    // Given
    const raw = v1();

    // When
    const migrated = migrateRoomSnapshot(raw);

    // Then
    assert.equal(migrated.schemaVersion, 2);
    assert.deepEqual(migrated.options, { roundLimit: 20, finance: DEFAULT_FINANCE_OPTIONS });
    assert.equal(migrated.code, 'AB2C', '다른 필드는 그대로 옮긴다');
    assert.deepEqual(raw, v1(), '입력을 변형하지 않는다');
  });

  it('roundLimit이 없던 파일도 null로 채워 올라온다', () => {
    // Given
    const raw = { ...v1(), options: {} };

    // When
    const migrated = migrateRoomSnapshot(raw);

    // Then
    assert.deepEqual(migrated.options, { roundLimit: null, finance: DEFAULT_FINANCE_OPTIONS });
  });

  it('이미 현재 버전이면 그대로 돌려준다', () => {
    // Given
    const room = Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW });
    const snapshot = room.toSnapshot();

    // When
    const migrated = migrateRoomSnapshot(snapshot);

    // Then
    assert.equal(migrated, snapshot, '승급할 것이 없으면 사본도 만들지 않는다');
    assert.equal(migrated.schemaVersion, CURRENT_ROOM_SCHEMA_VERSION);
  });

  it('미래 스키마 버전은 거부한다(모르는 방을 덮어써서 잃지 않는다)', () => {
    // Given
    const raw = { ...v1(), schemaVersion: CURRENT_ROOM_SCHEMA_VERSION + 1 };

    // When / Then
    assert.throws(() => migrateRoomSnapshot(raw), RoomSchemaError);
    assert.throws(() => deserializeRoom(raw, new FakeRandomSource()), RoomSchemaError);
  });

  it('정수가 아니거나 1보다 작은 스키마 버전은 거부한다', () => {
    // Given / When / Then
    for (const schemaVersion of ['2', 1.5, 0, -1, null]) {
      assert.throws(
        () => migrateRoomSnapshot({ ...v1(), schemaVersion }),
        RoomSchemaError,
        `거부되지 않았다: ${String(schemaVersion)}`,
      );
    }
  });

  it('객체가 아닌 값은 거부한다', () => {
    // Given / When / Then
    for (const raw of [null, undefined, 'room', 7, []]) {
      assert.throws(() => migrateRoomSnapshot(raw), RoomSchemaError);
    }
  });

  it('현재 방 스냅샷은 schemaVersion을 싣고, 검증기는 승급되지 않은 버전을 거부한다', () => {
    // Given
    const room = Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW });

    // When
    const snapshot = room.toSnapshot();

    // Then
    assert.equal(snapshot.schemaVersion, ROOM_SCHEMA_VERSION);
    assert.doesNotThrow(() => validateRoomSnapshot(snapshot));
    assert.throws(
      () => validateRoomSnapshot({ ...snapshot, schemaVersion: 1 }),
      RoomSchemaError,
      '검증기는 승급이 끝난 스냅샷만 받는다',
    );
  });
});
