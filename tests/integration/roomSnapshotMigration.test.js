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

  it('구버전 방을 불러오면 현재 스키마 + 금융 옵션 기본값으로 올라온다', () => {
    // Given
    const snapshot = JSON.parse(legacy('playing'));
    assert.equal(snapshot.options.finance, undefined, '픽스처에는 금융 옵션이 없어야 한다');

    // When
    const room = deserializeRoom(snapshot, new SeededRandomSource(1));
    const upgraded = room.toSnapshot();

    // Then
    assert.equal(upgraded.schemaVersion, CURRENT_ROOM_SCHEMA_VERSION);
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

  it('v1 → 현재 버전 왕복: 승급한 방을 다시 저장하면 그대로 다시 읽힌다', () => {
    // Given
    const room = deserializeRoom(JSON.parse(legacy('playing')), new SeededRandomSource(1));

    // When
    const text = serializeRoom(room);
    const again = parseRoomJson(text, new SeededRandomSource(1));

    // Then
    assert.equal(JSON.parse(text).schemaVersion, CURRENT_ROOM_SCHEMA_VERSION);
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

  it('schemaVersion이 없으면 1로 보고 현재 버전까지 올린다', () => {
    // Given
    const raw = v1();

    // When
    const migrated = migrateRoomSnapshot(raw);

    // Then
    assert.equal(migrated.schemaVersion, CURRENT_ROOM_SCHEMA_VERSION);
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

  it('승급 단계가 전진하지 않거나 버전을 남기지 않으면 부팅이 멈추지 않고 거부된다', () => {
    // Given (목록을 잘못 적으면 while 루프가 영원히 돌아 서버 부팅이 멈춘다 —
    //        그 실수는 예외로 드러나야 한다. 단계 목록이 실제로 전진하는지 계약으로 고정한다.)
    // When / Then
    assert.equal(CURRENT_ROOM_SCHEMA_VERSION, 3);
    const migrated = migrateRoomSnapshot(v1());
    assert.equal(migrated.schemaVersion, CURRENT_ROOM_SCHEMA_VERSION, '단계가 버전을 남겨야 한다');
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

describe('손상된 저장 파일 방어(복원 전에 걸러낸다)', () => {
  const playing = () => JSON.parse(legacy('playing'));

  it('안전 정수가 아니거나 상한을 넘는 금액은 복원 전에 거부한다', () => {
    // Given (Number.isInteger는 1e300도 참이다. 그런 값이 통과하면 복원된 방의 보존
    //        불변식이 처음부터 거짓이 되어 첫 커맨드에서 멈춘다. 2^53+1은 더 나쁘다 —
    //        조용히 다른 값이 된다.)
    const corruptions = [
      ['현금이 안전 정수가 아니면', (game) => { game.players[0].cash = 1e300; }],
      ['현금이 2^53을 넘으면', (game) => { game.players[0].cash = 9_007_199_254_740_993; }],
      ['현금이 금액 상한을 넘으면', (game) => { game.players[0].cash = 2_000_000_000_000; }],
      ['대출 채무가 상한을 넘으면', (game) => { game.players[0].loanDebt = 1e300; }],
      ['잭팟이 안전 정수가 아니면', (game) => { game.casino.jackpot = 1e300; }],
      ['초기 총액이 상한을 넘으면', (game) => { game.initialTotal = 1e300; }],
      ['장부 값이 상한을 넘으면', (game) => { game.ledger.fromBank = 1e300; }],
      ['장부 사유 순액이 안전 정수가 아니면', (game) => { game.ledger.byReason = { TAX: 1e300 }; }],
    ];

    // When / Then
    for (const [label, corrupt] of corruptions) {
      const snapshot = playing();
      corrupt(snapshot.game);
      assert.throws(
        () => deserializeRoom(snapshot, new FakeRandomSource()),
        RoomSchemaError,
        `${label} 거부해야 한다`,
      );
    }
  });

  it('건설·인수 대상이 소유할 수 없는 칸이면 복원 전에 거부한다', () => {
    // Given (범위만 보면 buildIndex: 0(출발 칸)이 통과해 격리되지 않는데, 그 방은
    //        pendingDecision이 매번 터져 조회·SSE·자동 진행이 영구히 실패한다)
    const corruptions = [
      ['건설 칸이 출발 칸이면', (game) => { game.phase = 'AWAIT_BUILD'; game.turn.buildIndex = 0; }],
      ['건설 칸이 티켓 칸이면', (game) => { game.phase = 'AWAIT_BUILD'; game.turn.buildIndex = 2; }],
      ['인수 칸이 카지노 칸이면', (game) => { game.phase = 'AWAIT_ACQUIRE'; game.turn.acquireIndex = 20; }],
    ];

    // When / Then
    for (const [label, corrupt] of corruptions) {
      const snapshot = playing();
      corrupt(snapshot.game);
      assert.throws(
        () => deserializeRoom(snapshot, new FakeRandomSource()),
        RoomSchemaError,
        `${label} 거부해야 한다`,
      );
    }
  });

  it('소유할 수 있는 칸이면 통과한다(거짓 양성 방어)', () => {
    // Given (거짓 양성 하나면 멀쩡한 방이 삭제된다)
    const snapshot = playing();
    snapshot.game.phase = 'AWAIT_BUILD';
    snapshot.game.turn.buildIndex = 39; // 서울(도시)
    snapshot.game.turn.acquireIndex = null;

    // When / Then
    assert.doesNotThrow(() => deserializeRoom(snapshot, new FakeRandomSource()));
  });

  it('초기 총액이 없던 아주 오래된 방도 불변식을 만족한 상태로 복원된다', () => {
    // Given (그냥 현재 총액으로 두면 은행 순유입만큼 어긋나 첫 커맨드에서 멈춘다)
    const snapshot = playing();
    const expected = snapshot.game.initialTotal;
    delete snapshot.game.initialTotal;
    assert.ok(
      snapshot.game.ledger.fromBank - snapshot.game.ledger.toBank !== 0,
      '픽스처의 은행 순유입이 0이 아니어야 의미 있는 검증이 된다',
    );

    // When
    const room = deserializeRoom(snapshot, new FakeRandomSource());
    const report = room.game.moneyReport();

    // Then
    assert.equal(report.balanced, true, JSON.stringify(report));
    assert.equal(report.initialTotal, expected, '보존 불변식에서 역산한 값이 원래 값과 같다');
  });

  it('손상된 값이 오류 메시지를 만들다 원시 TypeError로 새지 않는다', () => {
    // Given (`${value}`는 {"toString":1} 같은 값에서 터진다 — 그러면 규격 RoomSchemaError가
    //        아예 만들어지지 않는다. server/validation.js의 safeText와 같은 방어다.)
    const poison = { toString: 1, valueOf: 1 };
    const fields = [
      (game) => { game.phase = poison; },
      (game) => { game.players[0].cash = poison; },
      (game) => { game.players[0].position = poison; },
      (game) => { game.casino.jackpot = poison; },
      (game) => { game.ledger.fromBank = poison; },
      (game) => { game.turn.buildIndex = poison; },
      (game) => { game.turn.casinoRoundsLeft = poison; },
    ];

    // When / Then
    for (const corrupt of fields) {
      const snapshot = playing();
      corrupt(snapshot.game);
      assert.throws(() => deserializeRoom(snapshot, new FakeRandomSource()), RoomSchemaError);
    }
    // 방 수준 필드도 같다
    const roomLevel = playing();
    roomLevel.status = poison;
    assert.throws(() => deserializeRoom(roomLevel, new FakeRandomSource()), RoomSchemaError);
    const version = playing();
    version.schemaVersion = poison;
    assert.throws(() => migrateRoomSnapshot(version), RoomSchemaError);
  });
});
