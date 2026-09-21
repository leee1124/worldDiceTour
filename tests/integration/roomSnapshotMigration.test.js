import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AutoPlayerPolicy } from '../../src/application/AutoPlayerPolicy.js';
import { toGameViewDto } from '../../src/application/dto.js';
import { deserializeRoom, parseRoomJson } from '../../src/infrastructure/RoomSerializer.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';

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
});
