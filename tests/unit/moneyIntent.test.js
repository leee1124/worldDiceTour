import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DomainError } from '../../src/domain/shared/DomainError.js';
import { MAX_MONEY, assertAmount, assertSignedAmount } from '../../src/domain/shared/Money.js';
import { COUNTERPARTIES, MoneyIntent } from '../../src/domain/shared/MoneyIntent.js';
import { MONEY_REASONS } from '../../src/domain/game/events.js';

describe('Money(금액 단위 규칙)', () => {
  it('0 이상의 안전 정수만 금액으로 받아들인다', () => {
    // Given / When / Then
    assert.equal(assertAmount(0), 0);
    assert.equal(assertAmount(1_234), 1_234);
    assert.equal(assertAmount(MAX_MONEY), MAX_MONEY);
  });

  it('음수·소수·NaN·문자열·상한 초과는 거부한다', () => {
    // Given
    const rejected = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1000', null, undefined, MAX_MONEY + 1];

    // When / Then
    for (const value of rejected) {
      assert.throws(() => assertAmount(value), DomainError, `거부되지 않았다: ${String(value)}`);
    }
  });

  it('안전 정수 범위를 넘는 값은 상한보다 먼저 거부한다', () => {
    // Given
    const unsafe = Number.MAX_SAFE_INTEGER + 2;

    // When / Then
    assert.throws(() => assertAmount(unsafe), DomainError);
    assert.throws(() => assertSignedAmount(unsafe), DomainError);
  });

  it('부호 있는 금액은 절댓값이 상한 이내인 정수만 받아들인다', () => {
    // Given / When / Then
    assert.equal(assertSignedAmount(-500), -500);
    assert.equal(assertSignedAmount(0), 0);
    assert.throws(() => assertSignedAmount(-(MAX_MONEY + 1)), DomainError);
    assert.throws(() => assertSignedAmount(-0.5), DomainError);
  });
});

describe('MoneyIntent(돈 이동 의사 VO)', () => {
  it('지불은 음수, 수령은 양수 금액으로 표현된다', () => {
    // Given / When
    const paid = MoneyIntent.toBank({ playerId: 's1', amount: 1_000, reason: MONEY_REASONS.PURCHASE });
    const got = MoneyIntent.fromBank({ playerId: 's1', amount: 1_000, reason: MONEY_REASONS.SALARY });

    // Then
    assert.equal(paid.amount, -1_000);
    assert.equal(paid.counterparty, COUNTERPARTIES.BANK);
    assert.equal(paid.affectsLedger, true);
    assert.equal(got.amount, 1_000);
    assert.equal(got.reason, MONEY_REASONS.SALARY);
  });

  it('거래소도 은행 창구이므로 양방향 모두 장부에 기록된다', () => {
    // Given (주식 매수/매도가 들어올 자리 — 예금·주식은 현금이 아니라 은행이 보관하는 채무다)
    const paid = MoneyIntent.toExchange({
      playerId: 's1',
      amount: 5_000,
      reason: MONEY_REASONS.PURCHASE,
    });
    const got = MoneyIntent.fromExchange({
      playerId: 's1',
      amount: 5_000,
      reason: MONEY_REASONS.LIQUIDATION,
    });

    // Then
    assert.equal(paid.counterparty, COUNTERPARTIES.EXCHANGE);
    assert.equal(paid.amount, -5_000);
    assert.equal(paid.affectsLedger, true);
    assert.equal(got.counterparty, COUNTERPARTIES.EXCHANGE);
    assert.equal(got.amount, 5_000);
    assert.equal(got.affectsLedger, true);
  });

  it('플레이어 간 이동과 잭팟 이동은 총합을 바꾸지 않으므로 장부 대상이 아니다', () => {
    // Given / When
    const transfer = MoneyIntent.transfer({
      fromId: 's1',
      toId: 's2',
      amount: 700,
      reason: MONEY_REASONS.TOLL,
    });
    const jackpot = MoneyIntent.toJackpot({
      playerId: 's1',
      amount: 700,
      reason: MONEY_REASONS.TAX,
    });

    // Then
    assert.equal(transfer.counterparty, COUNTERPARTIES.PLAYER);
    assert.equal(transfer.playerId, 's1');
    assert.equal(transfer.otherPlayerId, 's2');
    assert.equal(transfer.amount, -700);
    assert.equal(transfer.affectsLedger, false);
    assert.equal(jackpot.affectsLedger, false);
  });

  it('meta는 보고용 부가 정보이며 읽기 전용 사본으로 노출된다', () => {
    // Given
    const intent = MoneyIntent.toBank({
      playerId: 's1',
      amount: 10,
      reason: MONEY_REASONS.TICKET,
      meta: { ticketId: 'T01' },
    });

    // When
    const meta = intent.meta;

    // Then
    assert.deepEqual(meta, { ticketId: 'T01' });
    assert.notEqual(meta, intent.meta, 'meta는 매번 사본을 준다');
  });

  it('사유는 MONEY_REASONS 목록에 있어야 한다(단일 출처 강제)', () => {
    // Given / When / Then
    assert.throws(
      () => MoneyIntent.toBank({ playerId: 's1', amount: 10, reason: 'WHATEVER' }),
      DomainError,
    );
  });

  it('플레이어 식별자가 없거나 자기 자신에게 이동하면 거부한다', () => {
    // Given / When / Then
    assert.throws(
      () => MoneyIntent.toBank({ playerId: '', amount: 10, reason: MONEY_REASONS.TICKET }),
      DomainError,
    );
    assert.throws(
      () =>
        MoneyIntent.transfer({
          fromId: 's1',
          toId: 's1',
          amount: 10,
          reason: MONEY_REASONS.TOLL,
        }),
      DomainError,
    );
  });

  it('알 수 없는 상대방은 거부한다', () => {
    // Given / When / Then
    assert.throws(
      () =>
        new MoneyIntent({
          playerId: 's1',
          amount: -10,
          counterparty: 'MARS',
          reason: MONEY_REASONS.TICKET,
        }),
      { message: /알 수 없는 상대방/ },
    );
  });

  it('상대 좌석이 없는 이동에 상대 좌석을 적으면 거부한다', () => {
    // Given (BANK·JACKPOT 이동에 상대 좌석이 붙어 있으면 어느 쪽 규칙을 따를지 모호해진다)
    // When / Then
    assert.throws(
      () =>
        new MoneyIntent({
          playerId: 's1',
          amount: -10,
          counterparty: COUNTERPARTIES.BANK,
          otherPlayerId: 's2',
          reason: MONEY_REASONS.TICKET,
        }),
      { message: /상대 좌석이 없어야/ },
    );
  });

  it('좌석 간 이동에 상대 좌석이 없으면 거부한다', () => {
    // Given / When / Then
    assert.throws(
      () =>
        new MoneyIntent({
          playerId: 's1',
          amount: -10,
          counterparty: COUNTERPARTIES.PLAYER,
          reason: MONEY_REASONS.TOLL,
        }),
      { message: /상대 좌석 식별자/ },
    );
  });

  it('meta가 객체가 아니면 거부한다', () => {
    // Given / When / Then
    assert.throws(
      () =>
        MoneyIntent.toBank({
          playerId: 's1',
          amount: 10,
          reason: MONEY_REASONS.TICKET,
          meta: 'ticket',
        }),
      { message: /meta는 객체/ },
    );
  });

  it('금액 0은 -0이 아니라 0으로 정규화된다(스냅샷·비교가 흔들리지 않게)', () => {
    // Given / When
    const paid = MoneyIntent.toBank({ playerId: 's1', amount: 0, reason: MONEY_REASONS.TICKET });
    const moved = MoneyIntent.transfer({
      fromId: 's1',
      toId: 's2',
      amount: 0,
      reason: MONEY_REASONS.TICKET,
    });

    // Then
    assert.ok(Object.is(paid.amount, 0), `-0이 새어 나왔다: ${paid.amount}`);
    assert.ok(Object.is(moved.amount, 0), `-0이 새어 나왔다: ${moved.amount}`);
    assert.ok(Object.is(assertAmount(-0), 0), 'assertAmount가 -0을 정규화해야 한다');
    assert.ok(Object.is(assertSignedAmount(-0), 0), 'assertSignedAmount가 -0을 정규화해야 한다');
  });

  it('음수 금액이나 비정수 금액으로는 만들 수 없다', () => {
    // Given / When / Then
    assert.throws(
      () => MoneyIntent.toBank({ playerId: 's1', amount: -1, reason: MONEY_REASONS.TICKET }),
      DomainError,
    );
    assert.throws(
      () => MoneyIntent.fromBank({ playerId: 's1', amount: 1.5, reason: MONEY_REASONS.TICKET }),
      DomainError,
    );
    assert.throws(
      () =>
        MoneyIntent.fromBank({
          playerId: 's1',
          amount: MAX_MONEY + 1,
          reason: MONEY_REASONS.TICKET,
        }),
      DomainError,
    );
  });
});
