import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Casino, CASINO_GAMES, SLOT_SYMBOLS } from '../../src/domain/game/Casino.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';

describe('Casino(라스베이거스 카지노)', () => {
  describe('베팅액 검증', () => {
    it('최소 베팅액보다 적으면 거부한다', () => {
      // Given
      const casino = new Casino();

      // When / Then
      assert.throws(() => casino.assertValidBet(5000, 3_000_000), DomainError);
    });

    it('10,000원 단위가 아니면 거부한다', () => {
      // Given
      const casino = new Casino();

      // When / Then
      assert.throws(() => casino.assertValidBet(15_000, 3_000_000), DomainError);
    });

    it('보유 현금보다 많으면 거부한다', () => {
      // Given
      const casino = new Casino();

      // When / Then
      assert.throws(() => casino.assertValidBet(200_000, 150_000), DomainError);
    });

    it('상한(500,000원)을 넘으면 거부한다', () => {
      // Given
      const casino = new Casino();

      // When / Then
      assert.throws(() => casino.assertValidBet(510_000, 3_000_000), DomainError);
    });

    it('단위·범위를 지키면 통과한다', () => {
      // Given
      const casino = new Casino();

      // When / Then
      assert.doesNotThrow(() => casino.assertValidBet(500_000, 500_000));
    });

    it('현금과 상한 중 작은 값을 최대 베팅액으로 계산한다', () => {
      // Given
      const casino = new Casino();

      // When
      const limits = casino.betLimits(120_000);

      // Then
      assert.deepEqual(limits, { min: 10_000, max: 120_000, unit: 10_000 });
    });

    it('현금이 최소 베팅액보다 적으면 베팅할 수 없다', () => {
      // Given
      const casino = new Casino();

      // When
      const limits = casino.betLimits(5_000);

      // Then
      assert.equal(limits.max, 0);
      assert.equal(casino.canBet(5_000), false);
    });
  });

  describe('홀짝', () => {
    it('홀을 맞히면 베팅액의 2배를 환급한다', () => {
      // Given
      const casino = new Casino();
      const random = new FakeRandomSource([3]);

      // When
      const result = casino.play({ game: CASINO_GAMES.ODD_EVEN, bet: 10_000, choice: 'ODD' }, random);

      // Then
      assert.equal(result.payout, 20_000);
      assert.equal(result.detail.die, 3);
      assert.equal(result.win, true);
    });

    it('틀리면 베팅액을 잃고 절반이 잭팟에 적립된다', () => {
      // Given
      const casino = new Casino();
      const random = new FakeRandomSource([4]);

      // When
      const result = casino.play({ game: CASINO_GAMES.ODD_EVEN, bet: 30_000, choice: 'ODD' }, random);

      // Then
      assert.equal(result.payout, 0);
      assert.equal(result.jackpotAccumulated, 15_000);
      assert.equal(casino.jackpot, 15_000);
    });

    it('선택값이 홀/짝이 아니면 거부한다', () => {
      // Given
      const casino = new Casino();

      // When / Then
      assert.throws(
        () => casino.play({ game: CASINO_GAMES.ODD_EVEN, bet: 10_000, choice: 'MAYBE' }, new FakeRandomSource([1])),
        DomainError,
      );
    });
  });

  describe('하이로우세븐', () => {
    it('로우(2~6)를 맞히면 2배를 환급한다', () => {
      // Given
      const casino = new Casino();

      // When
      const result = casino.play(
        { game: CASINO_GAMES.HIGH_LOW_SEVEN, bet: 20_000, choice: 'LOW' },
        new FakeRandomSource([2, 3]),
      );

      // Then
      assert.equal(result.payout, 40_000);
      assert.equal(result.detail.sum, 5);
    });

    it('세븐을 맞히면 5배를 환급한다', () => {
      // Given
      const casino = new Casino();

      // When
      const result = casino.play(
        { game: CASINO_GAMES.HIGH_LOW_SEVEN, bet: 20_000, choice: 'SEVEN' },
        new FakeRandomSource([3, 4]),
      );

      // Then
      assert.equal(result.payout, 100_000);
    });

    it('하이(8~12)를 골랐는데 세븐이 나오면 잃는다', () => {
      // Given
      const casino = new Casino();

      // When
      const result = casino.play(
        { game: CASINO_GAMES.HIGH_LOW_SEVEN, bet: 20_000, choice: 'HIGH' },
        new FakeRandomSource([3, 4]),
      );

      // Then
      assert.equal(result.payout, 0);
      assert.equal(result.detail.outcome, 'SEVEN');
    });
  });

  describe('슬롯', () => {
    it('심볼 3개가 일치하면 10배를 환급한다', () => {
      // Given
      const casino = new Casino();

      // When
      const result = casino.play(
        { game: CASINO_GAMES.SLOT, bet: 10_000, choice: null },
        new FakeRandomSource([1, 1, 1]),
      );

      // Then
      assert.equal(result.payout, 100_000);
      assert.deepEqual(result.detail.symbols, [SLOT_SYMBOLS[1], SLOT_SYMBOLS[1], SLOT_SYMBOLS[1]]);
    });

    it('심볼 2개가 일치하면 1.5배(내림)를 환급한다', () => {
      // Given
      const casino = new Casino();

      // When
      const result = casino.play(
        { game: CASINO_GAMES.SLOT, bet: 30_000, choice: null },
        new FakeRandomSource([0, 0, 2]),
      );

      // Then
      assert.equal(result.payout, 45_000);
      assert.equal(result.detail.matched, 2);
    });

    it('7 세 개가 나오면 10배와 잭팟 적립금 전액을 함께 지급한다', () => {
      // Given
      const casino = new Casino({ jackpot: 500_000 });
      const sevenIndex = SLOT_SYMBOLS.length - 1;

      // When
      const result = casino.play(
        { game: CASINO_GAMES.SLOT, bet: 10_000, choice: null },
        new FakeRandomSource([sevenIndex, sevenIndex, sevenIndex]),
      );

      // Then
      assert.equal(result.jackpotWon, 500_000);
      assert.equal(result.payout, 100_000 + 500_000);
      assert.equal(casino.jackpot, 0);
    });

    it('모두 다르면 잃고 절반(내림)이 잭팟에 적립된다', () => {
      // Given
      const casino = new Casino();

      // When
      const result = casino.play(
        { game: CASINO_GAMES.SLOT, bet: 50_000, choice: null },
        new FakeRandomSource([0, 1, 2]),
      );

      // Then
      assert.equal(result.payout, 0);
      assert.equal(casino.jackpot, 25_000);
    });
  });

  it('알 수 없는 게임 종류는 거부한다', () => {
    // Given
    const casino = new Casino();

    // When / Then
    assert.throws(
      () => casino.play({ game: 'ROULETTE', bet: 10_000, choice: null }, new FakeRandomSource([1])),
      DomainError,
    );
  });

  it('세관 납부액 등 외부 적립을 잭팟에 더한다', () => {
    // Given
    const casino = new Casino({ jackpot: 10_000 });

    // When
    casino.accumulate(7_000);

    // Then
    assert.equal(casino.jackpot, 17_000);
  });

  it('음수 적립은 거부한다', () => {
    // Given
    const casino = new Casino();

    // When / Then
    assert.throws(() => casino.accumulate(-1), DomainError);
  });
});
