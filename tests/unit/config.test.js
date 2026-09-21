import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PORT, resolveAutoPlayDelay, resolvePort } from '../../src/server/config.js';

describe('서버 환경변수 검증', () => {
  describe('PORT', () => {
    it('지정하지 않으면 기본 포트를 쓴다', () => {
      // Given / When / Then
      assert.equal(resolvePort(undefined), DEFAULT_PORT);
      assert.equal(resolvePort(''), DEFAULT_PORT);
    });

    it('1~65535 정수는 그대로 쓴다', () => {
      // Given / When / Then
      assert.equal(resolvePort('1'), 1);
      assert.equal(resolvePort('5173'), 5173);
      assert.equal(resolvePort('65535'), 65_535);
    });

    const invalid = ['0', '65536', '-1', '80.5', 'abc', '8080abc', ' ', '1e4'];

    for (const raw of invalid) {
      it(`잘못된 값(${JSON.stringify(raw)})이면 이유를 밝히며 즉시 실패한다`, () => {
        // Given / When / Then
        assert.throws(() => resolvePort(raw), (error) => {
          assert.match(error.message, /PORT/);
          assert.match(error.message, /1~65535/);
          return true;
        });
      });
    }
  });

  describe('AUTO_PLAY_DELAY_MS', () => {
    it('지정하지 않으면 기본값(800ms)이다', () => {
      // Given / When / Then
      assert.equal(resolveAutoPlayDelay(undefined), 800);
    });

    it('0 이상 정수만 받는다', () => {
      // Given / When / Then
      assert.equal(resolveAutoPlayDelay('0'), 0);
      assert.equal(resolveAutoPlayDelay('1500'), 1_500);
      assert.throws(() => resolveAutoPlayDelay('-1'), /AUTO_PLAY_DELAY_MS/);
      assert.throws(() => resolveAutoPlayDelay('빠르게'), /AUTO_PLAY_DELAY_MS/);
    });
  });
});
