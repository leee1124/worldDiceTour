import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BankLedger } from '../../src/domain/game/BankLedger.js';
import { Casino } from '../../src/domain/game/Casino.js';
import { Player } from '../../src/domain/game/Player.js';
import { Treasury } from '../../src/domain/game/Treasury.js';
import { CONTINUATIONS, DebtNote, SINKS } from '../../src/domain/game/payment/DebtNote.js';
import { PAYMENT_OUTCOMES, PaymentFlow } from '../../src/domain/game/payment/PaymentFlow.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { MONEY_REASONS } from '../../src/domain/shared/MoneyIntent.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

const tollEvent = (payerId, ownerId, amount) => ({
  type: EVENT_TYPES.TOLL_PAID,
  payload: { payerId, ownerId, index: 3, amount },
});

function build({ cash = { s1: 1_000_000, s2: 1_000_000 }, eliminated = [] } = {}) {
  const players = Object.entries(cash).map(
    ([id, amount]) => new Player({ id, name: id, cash: amount, eliminated: eliminated.includes(id) }),
  );
  const ledger = new BankLedger();
  const casino = new Casino();
  const treasury = new Treasury({
    players,
    ledger,
    casino,
    initialTotal: players.reduce((sum, player) => sum + player.cash, 0),
  });
  const flow = new PaymentFlow({
    treasury,
    findPlayer: (id) => players.find((player) => player.id === id) ?? null,
  });
  return { flow, treasury, ledger, casino, players, byId: (id) => players.find((p) => p.id === id) };
}

describe('DebtNote(채무 증서 VO)', () => {
  it('합계와 대표 채권자를 스스로 계산한다', () => {
    // Given (「한턱 쏘기」처럼 채권자가 여러 명일 수 있다)
    const note = new DebtNote({
      reason: MONEY_REASONS.TICKET,
      items: [
        { amount: 30_000, sink: SINKS.PLAYER, toPlayerId: 's2' },
        { amount: 30_000, sink: SINKS.PLAYER, toPlayerId: 's3' },
      ],
      event: { type: EVENT_TYPES.MONEY_LOST, payload: {} },
    });

    // When / Then
    assert.equal(note.total, 60_000);
    assert.equal(note.primaryCreditorId, 's2');
    assert.deepEqual(note.next, { kind: CONTINUATIONS.TURN_END });
  });

  it('은행·잭팟 채무에는 대표 채권자가 없다', () => {
    // Given
    const note = new DebtNote({
      reason: MONEY_REASONS.TAX,
      items: [{ amount: 10_000, sink: SINKS.JACKPOT, toPlayerId: null }],
      event: { type: EVENT_TYPES.TAX_PAID, payload: {} },
    });

    // When / Then
    assert.equal(note.primaryCreditorId, null);
  });

  it('스냅샷을 왕복해도 같은 내용이다(저장 형태 고정)', () => {
    // Given
    const note = new DebtNote({
      reason: MONEY_REASONS.TOLL,
      items: [{ amount: 42_000, sink: SINKS.PLAYER, toPlayerId: 's2' }],
      event: tollEvent('s1', 's2', 42_000),
      next: { kind: CONTINUATIONS.ACQUIRE, cityIndex: 3 },
    });

    // When
    const snapshot = note.toSnapshot();
    const restored = DebtNote.restore(snapshot);

    // Then
    assert.deepEqual(snapshot, {
      reason: MONEY_REASONS.TOLL,
      items: [{ amount: 42_000, sink: SINKS.PLAYER, toPlayerId: 's2' }],
      event: tollEvent('s1', 's2', 42_000),
      next: { kind: CONTINUATIONS.ACQUIRE, cityIndex: 3 },
    });
    assert.deepEqual(restored.toSnapshot(), snapshot);
    assert.notEqual(snapshot.items, note.items, '스냅샷은 깊은 사본이다');
  });

  it('항목이 없거나 알 수 없는 sink는 거부한다', () => {
    // Given / When / Then
    assert.throws(
      () =>
        new DebtNote({
          reason: MONEY_REASONS.TOLL,
          items: [],
          event: tollEvent('s1', 's2', 1),
        }),
      DomainError,
    );
    assert.throws(
      () =>
        new DebtNote({
          reason: MONEY_REASONS.TOLL,
          items: [{ amount: 1, sink: 'MARS', toPlayerId: null }],
          event: tollEvent('s1', 's2', 1),
        }),
      DomainError,
    );
  });
});

describe('PaymentFlow(강제 지불 → 정리 → 정산 → 이어하기)', () => {
  it('현금이 충분하면 즉시 정산되고 원래 흐름으로 이어진다', () => {
    // Given
    const { flow, byId } = build();

    // When
    const result = flow.charge({
      payer: byId('s1'),
      items: [{ amount: 42_000, sink: SINKS.PLAYER, toPlayerId: 's2' }],
      reason: MONEY_REASONS.TOLL,
      event: tollEvent('s1', 's2', 42_000),
      next: { kind: CONTINUATIONS.ACQUIRE, cityIndex: 3 },
    });

    // Then
    assert.equal(result.outcome, PAYMENT_OUTCOMES.SETTLED);
    assert.deepEqual(result.next, { kind: CONTINUATIONS.ACQUIRE, cityIndex: 3 });
    assert.deepEqual(
      result.events.map((event) => event.type),
      [EVENT_TYPES.TOLL_PAID],
    );
    assert.equal(byId('s1').cash, 958_000);
    assert.equal(byId('s2').cash, 1_042_000);
    assert.equal(flow.hasDebt, false);
  });

  it('낼 금액이 0이면 채무를 만들지 않고 그대로 이어간다', () => {
    // Given
    const { flow, byId } = build();

    // When
    const result = flow.charge({
      payer: byId('s1'),
      items: [{ amount: 0, sink: SINKS.BANK, toPlayerId: null }],
      reason: MONEY_REASONS.TICKET,
      event: { type: EVENT_TYPES.MONEY_LOST, payload: {} },
    });

    // Then
    assert.equal(result.outcome, PAYMENT_OUTCOMES.NOTHING_DUE);
    assert.deepEqual(result.events, []);
    assert.equal(flow.hasDebt, false);
  });

  it('현금이 부족하면 채무를 남기고 정리 페이즈를 요구한다', () => {
    // Given
    const { flow, byId } = build({ cash: { s1: 5_000, s2: 1_000_000 } });

    // When
    const result = flow.charge({
      payer: byId('s1'),
      items: [{ amount: 42_000, sink: SINKS.PLAYER, toPlayerId: 's2' }],
      reason: MONEY_REASONS.TOLL,
      event: tollEvent('s1', 's2', 42_000),
    });

    // Then
    assert.equal(result.outcome, PAYMENT_OUTCOMES.LIQUIDATION_REQUIRED);
    assert.deepEqual(result.events, [
      {
        type: EVENT_TYPES.LIQUIDATION_REQUIRED,
        payload: {
          playerId: 's1',
          amountDue: 42_000,
          creditorId: 's2',
          reason: MONEY_REASONS.TOLL,
        },
      },
    ]);
    assert.equal(flow.hasDebt, true);
    assert.equal(flow.amountDue, 42_000);
    assert.equal(flow.primaryCreditorId, 's2');
    assert.equal(byId('s1').cash, 5_000, '아직 아무 돈도 움직이지 않았다');
  });

  it('정리 페이즈를 거친 정산에는 DEBT_SETTLED가 붙고 흐름은 턴 종료로 바뀐다', () => {
    // Given (인수는 보유 현금으로만 — 매각·대출로 만든 돈으로 인수하지 못하게 한다)
    const { flow, byId, treasury } = build({ cash: { s1: 5_000, s2: 1_000_000 } });
    flow.charge({
      payer: byId('s1'),
      items: [{ amount: 42_000, sink: SINKS.PLAYER, toPlayerId: 's2' }],
      reason: MONEY_REASONS.TOLL,
      event: tollEvent('s1', 's2', 42_000),
      next: { kind: CONTINUATIONS.ACQUIRE, cityIndex: 3 },
    });

    // When (자산을 팔아 현금을 마련했다고 가정)
    const result = flow.settleIfAffordable({ payer: byId('s1'), inLiquidation: true });
    assert.equal(result, null, '아직 부족하면 정산하지 않는다');

    // 자산을 팔아 현금이 들어왔다(매각 환급과 같은 경로)
    treasury.receiveFromBank({
      playerId: 's1',
      amount: 100_000,
      reason: MONEY_REASONS.LIQUIDATION,
    });
    const settled = flow.settleIfAffordable({ payer: byId('s1'), inLiquidation: true });

    // Then
    assert.equal(settled.outcome, PAYMENT_OUTCOMES.SETTLED);
    assert.deepEqual(
      settled.events.map((event) => event.type),
      [EVENT_TYPES.TOLL_PAID, EVENT_TYPES.DEBT_SETTLED],
    );
    assert.deepEqual(settled.next, { kind: CONTINUATIONS.TURN_END }, '인수 제안은 하지 않는다');
    assert.equal(flow.hasDebt, false);
  });

  it('잭팟으로 가는 채무는 JACKPOT_CHANGED를 함께 낸다', () => {
    // Given
    const { flow, byId, casino } = build();

    // When
    const result = flow.charge({
      payer: byId('s1'),
      items: [{ amount: 100_000, sink: SINKS.JACKPOT, toPlayerId: null }],
      reason: MONEY_REASONS.TAX,
      event: { type: EVENT_TYPES.TAX_PAID, payload: { playerId: 's1', amount: 100_000 } },
    });

    // Then
    assert.deepEqual(
      result.events.map((event) => event.type),
      [EVENT_TYPES.TAX_PAID, EVENT_TYPES.JACKPOT_CHANGED],
    );
    assert.equal(casino.jackpot, 100_000);
  });

  it('자기 자신이 채권자로 적힌 손상 채무는 돈을 움직이지 않는다', () => {
    // Given (내던 돈이 그대로 돌아오는 셈 — 파산의 자기 채권자 방어와 같은 이유)
    const { flow, byId, ledger } = build();

    // When
    const result = flow.charge({
      payer: byId('s1'),
      items: [{ amount: 42_000, sink: SINKS.PLAYER, toPlayerId: 's1' }],
      reason: MONEY_REASONS.TOLL,
      event: tollEvent('s1', 's1', 42_000),
    });

    // Then
    assert.equal(result.outcome, PAYMENT_OUTCOMES.SETTLED);
    assert.equal(byId('s1').cash, 1_000_000, '총액이 그대로다');
    assert.equal(ledger.netFromBank, 0, '은행으로 새지도 않는다');
  });

  it('채권자가 탈락했으면 은행이 받는다', () => {
    // Given
    const { flow, byId, ledger } = build({ cash: { s1: 1_000_000, s2: 0 }, eliminated: ['s2'] });

    // When
    flow.charge({
      payer: byId('s1'),
      items: [{ amount: 42_000, sink: SINKS.PLAYER, toPlayerId: 's2' }],
      reason: MONEY_REASONS.TOLL,
      event: tollEvent('s1', 's2', 42_000),
    });

    // Then
    assert.equal(byId('s2').cash, 0);
    assert.equal(ledger.netFromBank, -42_000);
    assert.deepEqual(ledger.breakdown, { [MONEY_REASONS.TOLL]: -42_000 });
  });

  it('스냅샷으로 진행 중인 채무를 왕복한다', () => {
    // Given
    const { flow, byId } = build({ cash: { s1: 5_000, s2: 1_000_000 } });
    flow.charge({
      payer: byId('s1'),
      items: [{ amount: 42_000, sink: SINKS.PLAYER, toPlayerId: 's2' }],
      reason: MONEY_REASONS.TOLL,
      event: tollEvent('s1', 's2', 42_000),
    });

    // When
    const snapshot = flow.toSnapshot();
    const other = build({ cash: { s1: 5_000, s2: 1_000_000 } }).flow;
    other.restore(snapshot);

    // Then
    assert.deepEqual(other.toSnapshot(), snapshot);
    assert.equal(other.amountDue, 42_000);
    other.clear();
    assert.equal(other.toSnapshot(), null);
  });

  it('채무가 없는데 정산하려 하면 손상된 상태로 보고 거부한다', () => {
    // Given
    const { flow, byId } = build();

    // When / Then
    assert.throws(() => flow.assertPendingDebt(), DomainError);
    assert.throws(() => flow.settle({ payer: byId('s1'), inLiquidation: true }), DomainError);
  });
});
