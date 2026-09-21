import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LapIncome } from '../../src/domain/game/LapIncome.js';
import { LOAN_DEBT, Player, SALARY } from '../../src/domain/game/Player.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { MONEY_REASONS } from '../../src/domain/shared/MoneyIntent.js';

const types = (events) => events.map((event) => event.type);

describe('LapIncome(출발 통과 1회 정산)', () => {
  it('채무가 없으면 월급 전액을 은행에서 받는다', () => {
    // Given
    const player = new Player({ id: 's1', name: '하나', cash: 0 });

    // When
    const { intents, events } = new LapIncome().collect({ player });

    // Then
    assert.equal(intents.length, 1);
    assert.equal(intents[0].amount, SALARY);
    assert.equal(intents[0].reason, MONEY_REASONS.SALARY);
    assert.deepEqual(types(events), [EVENT_TYPES.SALARY_PAID]);
    assert.equal(events[0].payload.amount, SALARY);
    assert.equal(player.cash, 0, '현금은 Treasury가 옮긴다 — 여기서 늘지 않는다');
  });

  it('대출 채무가 남아 있으면 월급이 먼저 압류된다', () => {
    // Given (채무 1,200,000 > 월급 200,000 → 전액 압류)
    const player = new Player({ id: 's1', name: '하나', cash: 0, loanUsed: true, loanDebt: LOAN_DEBT });

    // When
    const { intents, events } = new LapIncome().collect({ player });

    // Then
    assert.deepEqual(intents, [], '손에 남는 돈이 없으면 은행이 내줄 돈도 없다');
    assert.deepEqual(types(events), [EVENT_TYPES.SALARY_SEIZED]);
    assert.equal(events[0].payload.amount, SALARY);
    assert.equal(events[0].payload.remainingDebt, LOAN_DEBT - SALARY);
    assert.equal(player.loanDebt, LOAN_DEBT - SALARY);
  });

  it('채무가 월급보다 적으면 남는 금액만 받고 완납 이벤트가 붙는다', () => {
    // Given
    const player = new Player({ id: 's1', name: '하나', cash: 0, loanUsed: true, loanDebt: 50_000 });

    // When
    const { intents, events } = new LapIncome().collect({ player });

    // Then
    assert.equal(player.loanDebt, 0);
    assert.deepEqual(types(events), [
      EVENT_TYPES.SALARY_SEIZED,
      EVENT_TYPES.LOAN_REPAID,
      EVENT_TYPES.SALARY_PAID,
    ]);
    assert.equal(intents[0].amount, SALARY - 50_000);
  });

  it('월급과 채무가 정확히 같으면 완납만 알리고 받는 돈은 없다', () => {
    // Given
    const player = new Player({ id: 's1', name: '하나', cash: 0, loanUsed: true, loanDebt: SALARY });

    // When
    const { intents, events } = new LapIncome().collect({ player });

    // Then
    assert.equal(player.loanDebt, 0);
    assert.deepEqual(types(events), [EVENT_TYPES.SALARY_SEIZED, EVENT_TYPES.LOAN_REPAID]);
    assert.deepEqual(intents, []);
  });
});
