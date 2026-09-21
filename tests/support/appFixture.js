import { GameService } from '../../src/application/GameService.js';
import { RoomService } from '../../src/application/RoomService.js';
import { AutoPlayerPolicy } from '../../src/application/AutoPlayerPolicy.js';
import { AutoPlayerDriver } from '../../src/application/AutoPlayerDriver.js';
import { KeyedMutex } from '../../src/application/KeyedMutex.js';
import { InMemoryRoomRepository } from '../../src/infrastructure/InMemoryRoomRepository.js';
import { SeatAuthenticator } from '../../src/infrastructure/SeatAuthenticator.js';
import assert from 'node:assert/strict';

import { FakeRandomSource } from './FakeRandomSource.js';

/** SSE 발행 내용을 기록하는 가짜 EventPublisher. */
export class RecordingPublisher {
  rooms = [];
  games = [];
  closed = [];

  publishRoom(code, payload) {
    this.rooms.push({ code, payload });
  }

  publishGame(code, payload) {
    this.games.push({ code, payload });
  }

  closeRoom(code) {
    this.closed.push(code);
  }

  get lastGame() {
    return this.games.at(-1)?.payload ?? null;
  }

  get lastRoom() {
    return this.rooms.at(-1)?.payload ?? null;
  }

  reset() {
    this.rooms = [];
    this.games = [];
    this.closed = [];
  }
}

/** 예측 가능한 좌석 토큰 발급기. */
export class SequentialTokenFactory {
  #sequence = 0;

  create() {
    this.#sequence += 1;
    // 실제 토큰과 같은 형식(64자 hex)이어야 presence 파라미터 검증을 통과한다.
    return `${this.#sequence.toString(16).padStart(4, '0')}${'a'.repeat(60)}`;
  }
}

/** 테스트에서 온라인 좌석 목록을 마음대로 조작할 수 있는 PresenceQuery 구현. */
export class FakePresence {
  /** @type {Map<string, string[]>} */
  #online = new Map();

  onlineSeatIds(code) {
    return this.#online.get(code) ?? [];
  }

  setOnline(code, seatIds) {
    this.#online.set(code, [...seatIds]);
    return this;
  }
}

/**
 * 인메모리 저장소 + 결정적 난수로 애플리케이션 서비스를 조립한다.
 */
export function createAppFixture({
  random = new FakeRandomSource(),
  now = 1_700_000_000_000,
  presence = new FakePresence(),
} = {}) {
  const repository = new InMemoryRoomRepository({ random, logger: { error: () => {} } });
  const publisher = new RecordingPublisher();
  const authenticator = new SeatAuthenticator();
  const tokenFactory = new SequentialTokenFactory();
  const clock = { now: () => now };
  const policy = new AutoPlayerPolicy();
  const logger = { error: () => {}, warn: () => {}, info: () => {} };
  const mutex = new KeyedMutex();

  const gameService = new GameService({
    repository,
    random,
    authenticator,
    publisher,
    clock,
    logger,
    presence,
    mutex,
  });

  const driver = new AutoPlayerDriver({
    delayMs: 0,
    policy,
    gameService,
    logger,
    maxStepsPerRoom: 2_000,
  });

  const roomService = new RoomService({
    repository,
    random,
    authenticator,
    publisher,
    clock,
    tokenFactory,
    logger,
    presence,
    mutex,
  });

  gameService.attachAutoPlayerDriver(driver);
  roomService.attachAutoPlayerDriver(driver);

  return {
    repository,
    publisher,
    authenticator,
    tokenFactory,
    roomService,
    gameService,
    driver,
    policy,
    clock,
    presence,
  };
}

/**
 * 상태가 정말 그대로인지 확인할 지문.
 * 버전만 보면 "버전은 같은데 내용이 바뀐" 경우를 놓치므로 게임 스냅샷 전체를 굳혀서 비교한다.
 */
export async function stateDigest(repository, code) {
  const room = await repository.findByCode(code);
  return JSON.stringify({ room: room?.toSnapshot() ?? null });
}

/** 권한 위반 커맨드가 규격 에러를 내고 상태를 전혀 바꾸지 않는지 검증한다. */
export async function assertRejectedWithoutChange(fixture, code, expectedCode, run) {
  const before = await stateDigest(fixture.repository, code);
  const beforeRoom = await fixture.repository.findByCode(code);
  const beforeVersion = beforeRoom.game?.version ?? null;

  await assert.rejects(run, (error) => {
    assert.equal(error.code, expectedCode, `에러 코드가 다릅니다: ${error.code}`);
    return true;
  });

  const afterRoom = await fixture.repository.findByCode(code);
  assert.equal(afterRoom.game?.version ?? null, beforeVersion, '게임 버전이 바뀌었습니다');
  assert.equal(await stateDigest(fixture.repository, code), before, '상태 지문이 바뀌었습니다');
}

/** 방 생성 + 좌석 참가 + 시작까지 진행한 픽스처. */
export async function startedRoom(fixture, { guestCount = 1, computerCount = 0 } = {}) {
  const { roomService } = fixture;
  const host = await roomService.createRoom({ hostName: '하나' });
  const guests = [];
  for (let index = 0; index < guestCount; index += 1) {
    guests.push(await roomService.joinSeat({ code: host.room.code, name: `손님${index + 1}` }));
  }
  for (let index = 0; index < computerCount; index += 1) {
    await roomService.hostAction({
      code: host.room.code,
      token: host.seatToken,
      action: { type: 'ADD_COMPUTER', name: `컴퓨터${index + 1}` },
    });
  }
  await roomService.hostAction({ code: host.room.code, token: host.seatToken, action: { type: 'START' } });
  return { code: host.room.code, host, guests };
}
