import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { MAX_SUBSCRIBERS_PER_ROOM, MAX_SUBSCRIBERS_TOTAL, SseHub } from '../../src/server/sseHub.js';

/** 구독자 대역. write/end만 기록한다. */
class FakeStream extends EventEmitter {
  frames = [];
  ended = false;

  write(frame) {
    this.frames.push(frame);
    return true;
  }

  end() {
    this.ended = true;
    this.emit('close');
  }
}

const newHub = () => new SseHub({ logger: { error: () => {} } });

describe('SseHub(구독자 상한)', () => {
  it('기본 상한은 방당 16명, 전체 128명이다', () => {
    // Given / When / Then
    assert.equal(MAX_SUBSCRIBERS_PER_ROOM, 16);
    assert.equal(MAX_SUBSCRIBERS_TOTAL, 128);
  });

  it('방당 상한까지는 받아들인다', () => {
    // Given
    const hub = new SseHub({ logger: { error: () => {} }, maxPerRoom: 3, maxTotal: 10 });

    // When / Then
    for (let index = 0; index < 3; index += 1) {
      assert.doesNotThrow(() => hub.assertCapacity('AB2C'));
      hub.subscribe('AB2C', new FakeStream());
    }
    hub.closeAll();
  });

  it('방당 상한을 넘으면 규격 에러를 던진다', () => {
    // Given
    const hub = new SseHub({ logger: { error: () => {} }, maxPerRoom: 2, maxTotal: 10 });
    hub.subscribe('AB2C', new FakeStream());
    hub.subscribe('AB2C', new FakeStream());

    // When / Then
    assert.throws(() => hub.assertCapacity('AB2C'), { code: 'ERR016' });
    // 다른 방은 영향을 받지 않는다
    assert.doesNotThrow(() => hub.assertCapacity('DEF2'));
    hub.closeAll();
  });

  it('전체 상한을 넘으면 새 방의 구독도 거부한다', () => {
    // Given
    const hub = new SseHub({ logger: { error: () => {} }, maxPerRoom: 5, maxTotal: 3 });
    hub.subscribe('AB2C', new FakeStream());
    hub.subscribe('AB2C', new FakeStream());
    hub.subscribe('DEF2', new FakeStream());

    // When / Then
    assert.throws(() => hub.assertCapacity('GHJ2'), { code: 'ERR016' });
    hub.closeAll();
  });

  it('구독이 끊기면 자리가 다시 생긴다', () => {
    // Given
    const hub = new SseHub({ logger: { error: () => {} }, maxPerRoom: 1, maxTotal: 10 });
    const stream = new FakeStream();
    hub.subscribe('AB2C', stream);
    assert.throws(() => hub.assertCapacity('AB2C'), { code: 'ERR016' });

    // When
    stream.end();

    // Then
    assert.doesNotThrow(() => hub.assertCapacity('AB2C'));
    hub.closeAll();
  });
});
