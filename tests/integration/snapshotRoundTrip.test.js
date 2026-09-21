import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AutoPlayerPolicy } from '../../src/application/AutoPlayerPolicy.js';
import { InMemoryRoomRepository } from '../../src/infrastructure/InMemoryRoomRepository.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';
import {
  RoomSchemaError,
  deserializeRoom,
  validateRoomSnapshot,
} from '../../src/infrastructure/RoomSerializer.js';
import { Room } from '../../src/domain/room/Room.js';
import { ALL_PHASES, PHASES } from '../../src/domain/game/phases.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { toGameViewDto } from '../../src/application/dto.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';

const NOW = 1_700_000_000_000;
const silentLogger = { error: () => {} };

/** 사람 4좌석을 앉히고 모두 자동 진행으로 돌린 방(테스트가 직접 턴을 돌린다). */
function autoRoom(seed) {
  const random = new SeededRandomSource(seed);
  const room = Room.create({ code: 'AB2C', hostName: '자동1', token: 'a'.repeat(64), now: NOW });
  for (const [index, name] of ['자동2', '자동3', '자동4'].entries()) {
    room.join({ name, token: String(index + 1).repeat(64).slice(0, 64), now: NOW });
  }
  room.start({ bySeatId: room.hostSeatId, random, now: NOW });
  return { room, random };
}

/**
 * 스키마 검증이 **실제로 만들어지는 상태를 거부하지 않는지**가 가장 위험한 실패 모드다
 * (거짓 양성 하나면 저장된 게임을 다시 못 불러온다). 그래서 진짜 대전을 돌리며
 * 모든 커맨드 직후의 스냅샷을 검증하고, 등장한 페이즈를 모아 빠짐없이 확인한다.
 */
describe('저장 스냅샷 왕복(검증 거짓 양성 방어)', () => {
  it('실제 대전의 모든 중간 상태가 스키마 검증을 통과하고 그대로 복원된다', () => {
    // Given
    const policy = new AutoPlayerPolicy();
    const seenPhases = new Set();
    let validated = 0;

    // When
    for (const seed of [5, 91, 404, 8_191]) {
      let { room, random } = autoRoom(seed);
      for (let step = 0; step < 4_000; step += 1) {
        if (!room.isPlaying() || room.game.isOver()) {
          break;
        }
        const decision = policy.decide(toGameViewDto(room.game));
        assert.ok(decision, `결정할 수 없는 페이즈: ${room.game.phase}`);
        seenPhases.add(room.game.phase);
        room.executeCommand({
          seatId: room.game.currentPlayerId,
          type: decision.type,
          payload: decision.payload,
          now: NOW,
        });

        // 매 커맨드 직후: 스냅샷이 검증을 통과하고, 복원본이 원본과 완전히 같아야 한다.
        const snapshot = room.toSnapshot();
        assert.doesNotThrow(
          () => validateRoomSnapshot(snapshot),
          `시드 ${seed} ${step}번째(${decision.type}) 스냅샷이 거부됐다: ${JSON.stringify(snapshot.game?.turn)}`,
        );
        const restored = deserializeRoom(snapshot, random);
        assert.deepEqual(restored.toSnapshot(), snapshot, '복원 왕복에서 상태가 달라졌다');
        validated += 1;
        room = restored;
      }
      seenPhases.add(room.game.phase);
    }

    // Then
    assert.ok(validated > 500, `검증한 상태가 너무 적다: ${validated}`);
    // 이 대전은 투자 모드가 꺼진 방이므로 거래 창구 페이즈는 나올 수 없다.
    // `AWAIT_TRADE`의 스냅샷 왕복·검증은 tests/integration/marketSnapshot.test.js가 덮는다.
    const expected = ALL_PHASES.filter((phase) => phase !== PHASES.AWAIT_TRADE);
    const missing = expected.filter((phase) => !seenPhases.has(phase));
    assert.deepEqual(missing, [], `대전에서 한 번도 등장하지 않은 페이즈: ${missing.join(', ')}`);
    assert.ok(!seenPhases.has(PHASES.AWAIT_TRADE), '투자 모드가 꺼진 방에 거래 창구가 생겼다');
  });

  it('공항 이동권을 든 상태(AWAIT_TRAVEL)의 스냅샷도 통과한다', () => {
    // Given (28 → 더블 2 → 30 공항 → 다음 자기 턴이 AWAIT_TRAVEL)
    const random = new FakeRandomSource([1, 1, 1, 2]);
    const room = Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW });
    room.join({ name: '두리', token: 'b'.repeat(64), now: NOW });
    room.start({ bySeatId: room.hostSeatId, random, now: NOW });
    const snapshot = room.toSnapshot();
    snapshot.game.players[0].position = 28;
    let restored = deserializeRoom(snapshot, random);

    // When
    restored.executeCommand({ seatId: 'seat-1', type: COMMAND_TYPES.ROLL, now: NOW });
    restored.executeCommand({ seatId: 'seat-2', type: COMMAND_TYPES.ROLL, now: NOW });
    restored.executeCommand({ seatId: 'seat-2', type: COMMAND_TYPES.SKIP_BUY, now: NOW });

    // Then
    assert.equal(restored.game.phase, PHASES.AWAIT_TRAVEL);
    assert.doesNotThrow(() => validateRoomSnapshot(restored.toSnapshot()));
    const again = deserializeRoom(restored.toSnapshot(), random);
    assert.equal(again.game.phase, PHASES.AWAIT_TRAVEL);
    assert.equal(again.game.pendingDecision.kind, 'TRAVEL');
  });

  it('바퀴 수가 저장되고 그대로 복원된다', () => {
    // Given (출발 칸을 지나 2바퀴가 된 상태)
    const random = new FakeRandomSource([1, 2]);
    const room = Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW });
    room.join({ name: '두리', token: 'b'.repeat(64), now: NOW });
    room.start({ bySeatId: room.hostSeatId, random, now: NOW });
    const seeded = room.toSnapshot();
    seeded.game.players[0].position = 38;
    const playing = deserializeRoom(seeded, random);
    playing.executeCommand({ seatId: 'seat-1', type: COMMAND_TYPES.ROLL, now: NOW });

    // When
    const snapshot = playing.toSnapshot();

    // Then
    assert.equal(snapshot.game.players[0].lap, 2);
    assert.doesNotThrow(() => validateRoomSnapshot(snapshot));
    assert.equal(deserializeRoom(snapshot, random).game.playerById('seat-1').lap, 2);
  });

  it('바퀴 수가 없는 예전 스냅샷은 1바퀴로 복원된다', () => {
    // Given (규칙 변경 전에 저장된 파일)
    const random = new FakeRandomSource([1, 2]);
    const { room } = autoRoom(17);
    const snapshot = room.toSnapshot();
    for (const player of snapshot.game.players) {
      delete player.lap;
    }

    // When
    const restored = deserializeRoom(snapshot, random);

    // Then
    assert.doesNotThrow(() => validateRoomSnapshot(snapshot));
    assert.deepEqual(
      restored.game.players.map((player) => player.lap),
      [1, 1, 1, 1],
    );
  });

  it('바퀴 수가 1 미만이거나 정수가 아닌 스냅샷은 거부한다', () => {
    // Given
    const { room } = autoRoom(23);

    // When / Then
    for (const lap of [0, -1, 1.5, '2', null]) {
      const snapshot = room.toSnapshot();
      snapshot.game.players[0].lap = lap;
      assert.throws(
        () => validateRoomSnapshot(snapshot),
        RoomSchemaError,
        `바퀴 값 ${String(lap)}을 통과시켰다`,
      );
    }
  });

  it('저장소를 거쳐도 같은 상태로 이어서 진행할 수 있다', async () => {
    // Given
    const random = new SeededRandomSource(2_027);
    const repository = new InMemoryRoomRepository({ random, logger: silentLogger });
    const { room } = autoRoom(31);
    await repository.save(room);

    // When (저장 → 불러오기 → 커맨드 → 저장 → 불러오기)
    const loaded = await repository.findByCode('AB2C');
    loaded.executeCommand({ seatId: loaded.game.currentPlayerId, type: COMMAND_TYPES.ROLL, now: NOW });
    await repository.save(loaded);
    const reloaded = await repository.findByCode('AB2C');

    // Then
    assert.deepEqual(reloaded.toSnapshot(), loaded.toSnapshot());
    assert.equal(reloaded.game.version, 1);
  });
});
