import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Dice } from '../../src/domain/game/Dice.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';

describe('Dice(주사위)', () => {
  it('두 개의 주사위를 굴려 눈과 합을 돌려준다', () => {
    // Given
    const random = new FakeRandomSource([2, 5]);
    const dice = new Dice(random);

    // When
    const result = dice.roll();

    // Then
    assert.deepEqual(result, { die1: 2, die2: 5, sum: 7, isDouble: false });
  });

  it('두 눈이 같으면 더블로 판정한다', () => {
    // Given
    const dice = new Dice(new FakeRandomSource([4, 4]));

    // When
    const result = dice.roll();

    // Then
    assert.equal(result.isDouble, true);
    assert.equal(result.sum, 8);
  });

  it('주사위 한 개만 굴릴 수 있다', () => {
    // Given
    const dice = new Dice(new FakeRandomSource([6]));

    // When
    const value = dice.rollOne();

    // Then
    assert.equal(value, 6);
  });

  it('RandomSource에 1~6 범위로만 난수를 요청한다', () => {
    // Given
    const calls = [];
    const random = {
      nextInt(min, max) {
        calls.push([min, max]);
        return min;
      },
    };
    const dice = new Dice(random);

    // When
    dice.roll();

    // Then
    assert.deepEqual(calls, [
      [1, 6],
      [1, 6],
    ]);
  });
});
