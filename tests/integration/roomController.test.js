import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { RoomController } from '../../src/server/roomController.js';
import { SseHub } from '../../src/server/sseHub.js';
import { createAppFixture, startedRoom } from '../support/appFixture.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';

const codeRandom = () => new FakeRandomSource(Array.from({ length: 200 }, (_unused, index) => index % 32));

/** SSE 응답 대역: 보낸 프레임만 모아 둔다. */
class FakeResponse extends EventEmitter {
  frames = [];
  head = null;
  ended = false;

  writeHead(status, headers) {
    this.head = { status, headers };
    return this;
  }

  write(frame) {
    this.frames.push(frame);
    return true;
  }

  end() {
    this.ended = true;
  }
}

/** 저장소도 인증기도 주지 않은 컨트롤러 — 컨트롤러는 서비스만 알아야 한다. */
const controllerWithoutRepository = (fixture, sseHub) =>
  new RoomController({
    roomService: fixture.roomService,
    gameService: fixture.gameService,
    sseHub,
    networkInfo: () => ({ port: 0, urls: [], localUrl: 'http://localhost:0' }),
    logger: { error: () => {} },
  });

describe('RoomController(컨트롤러 레이어)', () => {
  it('저장소를 직접 쓰지 않고도 SSE 구독을 처리한다', async () => {
    // Given
    const fixture = createAppFixture({ random: codeRandom() });
    const started = await startedRoom(fixture, { guestCount: 1 });
    const sseHub = new SseHub({ logger: { error: () => {} } });
    const controller = controllerWithoutRepository(fixture, sseHub);
    const response = new FakeResponse();

    // When
    await controller.subscribe(started.code, new URLSearchParams(), new EventEmitter(), response);

    // Then
    assert.equal(response.head.status, 200);
    assert.match(response.head.headers['content-type'], /text\/event-stream/);
    assert.ok(response.frames.some((frame) => frame.startsWith('event: room')));
    assert.ok(response.frames.some((frame) => frame.startsWith('event: game')));
    sseHub.closeAll();
  });

  it('없는 방을 구독하면 ERR004를 던진다', async () => {
    // Given
    const fixture = createAppFixture({ random: codeRandom() });
    const sseHub = new SseHub({ logger: { error: () => {} } });
    const controller = controllerWithoutRepository(fixture, sseHub);

    // When / Then
    await assert.rejects(
      () => controller.subscribe('ZZZZ', new URLSearchParams(), new EventEmitter(), new FakeResponse()),
      { code: 'ERR004' },
    );
    sseHub.closeAll();
  });

  it('presence 토큰 검증을 서비스에 맡겨 온라인 좌석을 표시한다', async () => {
    // Given
    const fixture = createAppFixture({ random: codeRandom() });
    const started = await startedRoom(fixture, { guestCount: 1 });
    const sseHub = new SseHub({ logger: { error: () => {} } });
    const controller = controllerWithoutRepository(fixture, sseHub);
    const query = new URLSearchParams({
      presence: `${started.host.seatId}:${started.host.seatToken}`,
    });

    // When
    await controller.subscribe(started.code, query, new EventEmitter(), new FakeResponse());

    // Then
    assert.deepEqual(sseHub.onlineSeatIds(started.code), [started.host.seatId]);
    sseHub.closeAll();
  });

  it('구독자 상한을 넘으면 이벤트 스트림이 아니라 규격 에러를 던진다', async () => {
    // Given
    const fixture = createAppFixture({ random: codeRandom() });
    const started = await startedRoom(fixture, { guestCount: 1 });
    const sseHub = new SseHub({ logger: { error: () => {} }, maxPerRoom: 1, maxTotal: 10 });
    const controller = controllerWithoutRepository(fixture, sseHub);
    await controller.subscribe(started.code, new URLSearchParams(), new EventEmitter(), new FakeResponse());

    // When
    const rejected = new FakeResponse();

    // Then (스트림 헤더를 쓰기 전에 거부한다)
    await assert.rejects(
      () => controller.subscribe(started.code, new URLSearchParams(), new EventEmitter(), rejected),
      { code: 'ERR016' },
    );
    assert.equal(rejected.head, null);
    assert.deepEqual(rejected.frames, []);
    sseHub.closeAll();
  });

  it('SSE 응답에도 공통 보안 헤더를 붙인다', async () => {
    // Given
    const fixture = createAppFixture({ random: codeRandom() });
    const started = await startedRoom(fixture, { guestCount: 1 });
    const sseHub = new SseHub({ logger: { error: () => {} } });
    const controller = controllerWithoutRepository(fixture, sseHub);
    const response = new FakeResponse();

    // When
    await controller.subscribe(started.code, new URLSearchParams(), new EventEmitter(), response);

    // Then
    assert.equal(response.head.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.head.headers['x-frame-options'], 'DENY');
    assert.match(response.head.headers['content-security-policy'], /default-src 'self'/);
    sseHub.closeAll();
  });

  it('presence 방송은 디바운스로 합쳐진다', async () => {
    // Given (같은 방에 여러 구독이 연달아 붙어도 방송은 한 번)
    const fixture = createAppFixture({ random: codeRandom() });
    const started = await startedRoom(fixture, { guestCount: 1 });
    const sseHub = new SseHub({ logger: { error: () => {} } });
    const broadcasts = [];
    const recordingHub = {
      assertCapacity: (code) => sseHub.assertCapacity(code),
      subscribe: (code, response, options) => sseHub.subscribe(code, response, options),
      send: () => {},
      onlineSeatIds: (code) => sseHub.onlineSeatIds(code),
      publishRoom: (code) => broadcasts.push(code),
    };
    const controller = new RoomController({
      roomService: fixture.roomService,
      gameService: fixture.gameService,
      sseHub: recordingHub,
      networkInfo: () => ({ port: 0, urls: [], localUrl: '' }),
      logger: { error: () => {} },
      presenceDebounceMs: 20,
    });
    const query = () =>
      new URLSearchParams({ presence: `${started.host.seatId}:${started.host.seatToken}` });

    // When (연달아 3번 붙는다)
    await controller.subscribe(started.code, query(), new EventEmitter(), new FakeResponse());
    await controller.subscribe(started.code, query(), new EventEmitter(), new FakeResponse());
    await controller.subscribe(started.code, query(), new EventEmitter(), new FakeResponse());
    assert.deepEqual(broadcasts, [], '디바운스 전에는 방송하지 않는다');

    // Then
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(broadcasts, [started.code]);
    sseHub.closeAll();
  });

  it('토큰이 틀린 presence 쌍은 온라인으로 인정하지 않는다', async () => {
    // Given
    const fixture = createAppFixture({ random: codeRandom() });
    const started = await startedRoom(fixture, { guestCount: 1 });
    const sseHub = new SseHub({ logger: { error: () => {} } });
    const controller = controllerWithoutRepository(fixture, sseHub);
    const query = new URLSearchParams({ presence: `${started.host.seatId}:${'0'.repeat(64)}` });

    // When
    await controller.subscribe(started.code, query, new EventEmitter(), new FakeResponse());

    // Then
    assert.deepEqual(sseHub.onlineSeatIds(started.code), []);
    sseHub.closeAll();
  });
});
