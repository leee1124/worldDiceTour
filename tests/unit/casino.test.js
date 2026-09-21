import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Casino, CASINO_GAMES, SLOT_SYMBOLS } from '../../src/domain/game/Casino.js';
import { COUNTERPARTIES, MONEY_REASONS } from '../../src/domain/shared/MoneyIntent.js';
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

    it('단위·범위의 경계값은 모두 통과하고, 한 칸 벗어나면 거부한다', () => {
      // Given
      const casino = new Casino();

      // When / Then (최소·최대·중간 단위는 통과)
      for (const bet of [10_000, 20_000, 250_000, 490_000, 500_000]) {
        assert.doesNotThrow(() => casino.assertValidBet(bet, 500_000), `거부되면 안 됨: ${bet}`);
      }
      // 경계 바로 밖은 거부
      assert.throws(() => casino.assertValidBet(9_999, 500_000), DomainError);
      assert.throws(() => casino.assertValidBet(510_000, 600_000), DomainError);
      assert.throws(() => casino.assertValidBet(10_001, 500_000), DomainError);
      // 현금과 정확히 같은 금액은 통과하고, 1원 넘으면 현금 부족
      assert.doesNotThrow(() => casino.assertValidBet(20_000, 20_000));
      assert.throws(() => casino.assertValidBet(20_000, 19_999), DomainError);
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
      // play()는 판정만 한다. 실제 적립은 Treasury가 MoneyIntent로 적용한다.
      assert.equal(casino.jackpot, 0);
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
      // play()는 판정만 한다. 실제 지급은 Treasury가 MoneyIntent로 적용한다.
      assert.equal(casino.jackpot, 500_000);
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
      assert.equal(result.jackpotAccumulated, 25_000);
      // play()는 판정만 한다. 실제 적립은 Treasury가 MoneyIntent로 적용한다.
      assert.equal(casino.jackpot, 0);
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

  describe('잭팟 수령 지분 계산(claimShare)', () => {
    it('지분 100%는 적립금 전액의 수령 의사를 만든다', () => {
      // Given
      const casino = new Casino({ jackpot: 326_500 });

      // When
      const claim = casino.claimShare({
        playerId: 's1',
        share: 100,
        reason: MONEY_REASONS.TICKET,
        meta: { ticketId: 'T21' },
      });

      // Then
      assert.equal(claim.amount, 326_500);
      assert.equal(claim.remaining, 0);
      assert.equal(claim.intents.length, 1);
      assert.equal(claim.intents[0].playerId, 's1');
      assert.equal(claim.intents[0].amount, 326_500, '+면 수령');
      assert.equal(claim.intents[0].counterparty, COUNTERPARTIES.JACKPOT);
      assert.equal(claim.intents[0].affectsLedger, false, '잭팟 이동은 장부에 남지 않는다');
    });

    it('지분 50%는 내림으로 계산하고 나머지는 적립금에 남긴다', () => {
      // Given (홀수 금액이라 반으로 정확히 나뉘지 않는다)
      const casino = new Casino({ jackpot: 125_001 });

      // When
      const claim = casino.claimShare({ playerId: 's1', share: 50, reason: MONEY_REASONS.TICKET });

      // Then
      assert.equal(claim.amount, 62_500, '내림');
      assert.equal(claim.remaining, 62_501, '남는 쪽이 1원을 갖는다(합계가 정확히 보존된다)');
      assert.equal(claim.amount + claim.remaining, 125_001);
    });

    it('적립금이 0원이면 옮길 돈이 없어 이동 의사도 만들지 않는다', () => {
      // Given
      const casino = new Casino({ jackpot: 0 });

      // When
      const claim = casino.claimShare({ playerId: 's1', share: 100, reason: MONEY_REASONS.TICKET });

      // Then
      assert.equal(claim.amount, 0);
      assert.equal(claim.remaining, 0);
      assert.deepEqual(claim.intents, []);
    });

    it('판정만 하는 순수 계산이므로 적립금을 건드리지 않는다', () => {
      // Given
      const casino = new Casino({ jackpot: 500_000 });

      // When
      casino.claimShare({ playerId: 's1', share: 100, reason: MONEY_REASONS.TICKET });

      // Then (실제 이동은 Treasury가 MoneyIntent로 적용한다)
      assert.equal(casino.jackpot, 500_000);
    });

    it('1~100 정수가 아닌 지분은 거부한다', () => {
      // Given
      const casino = new Casino({ jackpot: 100_000 });

      // When / Then
      for (const share of [0, -50, 101, 12.5, '50', null, undefined]) {
        assert.throws(
          () => casino.claimShare({ playerId: 's1', share, reason: MONEY_REASONS.TICKET }),
          DomainError,
          `지분 ${String(share)}는 거부해야 한다`,
        );
      }
    });
  });
});
