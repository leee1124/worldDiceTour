import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PHASES } from '../../src/domain/game/phases.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { BUILDING_TYPES } from '../../src/domain/game/City.js';
import { LOAN_DEBT, LOAN_PRINCIPAL, SALARY, STARTING_CASH } from '../../src/domain/game/Player.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { buildGame, eventTypes, findEvent, assertMoneyConserved } from '../support/gameBuilder.js';

const { VILLA, BUILDING, HOTEL } = BUILDING_TYPES;

/**
 * 3번 방콕(호텔·빌딩·별장 완비, 통행료 140,000원)에 도착하지만 현금이 5,000원뿐인 상황.
 */
const insolventGame = (overrides = {}) =>
  buildGame({
    cash: { s1: 5_000 },
    cities: [{ index: 3, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL] }],
    random: new FakeRandomSource([1, 2]),
    ...overrides,
  });

describe('Game(지불 불능 - 정리 페이즈)', () => {
  it('현금이 부족하면 즉시 파산하지 않고 정리 페이즈로 들어간다', () => {
    // Given
    const game = insolventGame();

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.phase, PHASES.AWAIT_LIQUIDATION);
    assert.equal(game.playerById('s1').eliminated, false);
    const required = findEvent(events, EVENT_TYPES.LIQUIDATION_REQUIRED);
    assert.equal(required.amountDue, 140_000);
    assert.equal(required.creditorId, 's2');
  });

  it('선택할 수 있는 수단을 뷰에 알려준다', () => {
    // Given
    const game = insolventGame({ cities: [
      { index: 3, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL] },
      { index: 39, ownerId: 's1' },
    ] });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);
    const decision = game.pendingDecision;

    // Then
    assert.equal(decision.kind, 'LIQUIDATION');
    assert.equal(decision.amountDue, 140_000);
    assert.equal(decision.canSell, true);
    assert.equal(decision.canLoan, true);
    assert.equal(decision.sellable.length, 1);
    assert.equal(decision.sellable[0].refund, 400_000);
  });

  it('선택 매각으로 채무를 메우면 지불이 자동 완료된다', () => {
    // Given
    const game = insolventGame({
      cities: [
        { index: 3, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL] },
        { index: 39, ownerId: 's1' },
      ],
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const events = game.execute('s1', COMMAND_TYPES.SELL, { cityIndex: 39 });

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.PROPERTY_SOLD));
    assert.ok(eventTypes(events).includes(EVENT_TYPES.TOLL_PAID));
    assert.ok(eventTypes(events).includes(EVENT_TYPES.DEBT_SETTLED));
    assert.equal(game.playerById('s1').cash, 5_000 + 400_000 - 140_000);
    assert.equal(game.board.cityAt(39).isOwned(), false);
    assertMoneyConserved(game, '선택 매각');
  });

  it('매각 대상은 내 자산이어야 한다', () => {
    // Given
    const game = insolventGame({
      cities: [
        { index: 3, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL] },
        { index: 39, ownerId: 's1' },
      ],
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.throws(() => game.execute('s1', COMMAND_TYPES.SELL, { cityIndex: 3 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.equal(game.phase, PHASES.AWAIT_LIQUIDATION);
  });

  it('자동 매각은 환급액이 낮은 자산부터 필요한 만큼만 판다', () => {
    // Given
    const game = insolventGame({
      cities: [
        { index: 3, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL] },
        { index: 1, ownerId: 's1' },
        { index: 39, ownerId: 's1' },
      ],
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const events = game.execute('s1', COMMAND_TYPES.AUTO_SELL);

    // Then
    const sold = events.filter((event) => event.type === EVENT_TYPES.PROPERTY_SOLD);
    assert.deepEqual(sold.map((event) => event.index), [1, 39]);
    assert.equal(game.board.cityAt(39).isOwned(), false);
    assert.equal(game.playerById('s1').cash, 5_000 + 30_000 + 400_000 - 140_000);
    assertMoneyConserved(game, '자동 매각');
  });

  describe('정리로 낸 통행료 뒤에는 인수를 제안하지 않는다(현금으로만 인수)', () => {
    /** 방콕(3, 통행료 140,000 / 인수가 392,000) 통행료를 못 내는 상태 + 팔면 넉넉해지는 서울. */
    const richAssetGame = () =>
      insolventGame({
        cities: [
          { index: 3, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL] },
          { index: 39, ownerId: 's1', buildings: [VILLA, BUILDING, HOTEL] },
        ],
      });

    it('대출로 메운 경우', () => {
      // Given
      const game = insolventGame();
      game.execute('s1', COMMAND_TYPES.ROLL);

      // When
      const events = game.execute('s1', COMMAND_TYPES.TAKE_LOAN);

      // Then (대출금 덕에 인수가 392,000원을 낼 수는 있지만 제안하지 않는다)
      assert.ok(game.playerById('s1').cash >= game.board.cityAt(3).acquisitionPrice());
      assert.equal(findEvent(events, EVENT_TYPES.ACQUIRE_OFFERED), undefined);
      assert.notEqual(game.phase, PHASES.AWAIT_ACQUIRE);
      assert.ok(eventTypes(events).includes(EVENT_TYPES.TURN_ENDED));
      assertMoneyConserved(game, '대출 후 인수 금지');
    });

    it('자동 매각으로 메운 경우', () => {
      // Given
      const game = richAssetGame();
      game.execute('s1', COMMAND_TYPES.ROLL);

      // When
      const events = game.execute('s1', COMMAND_TYPES.AUTO_SELL);

      // Then
      assert.ok(game.playerById('s1').cash >= game.board.cityAt(3).acquisitionPrice());
      assert.equal(findEvent(events, EVENT_TYPES.ACQUIRE_OFFERED), undefined);
      assert.notEqual(game.phase, PHASES.AWAIT_ACQUIRE);
      assertMoneyConserved(game, '자동 매각 후 인수 금지');
    });

    it('선택 매각으로 메운 경우', () => {
      // Given
      const game = richAssetGame();
      game.execute('s1', COMMAND_TYPES.ROLL);

      // When
      const events = game.execute('s1', COMMAND_TYPES.SELL, { cityIndex: 39 });

      // Then
      assert.ok(game.playerById('s1').cash >= game.board.cityAt(3).acquisitionPrice());
      assert.equal(findEvent(events, EVENT_TYPES.ACQUIRE_OFFERED), undefined);
      assert.notEqual(game.phase, PHASES.AWAIT_ACQUIRE);
      assertMoneyConserved(game, '선택 매각 후 인수 금지');
    });

    it('현금으로 바로 낸 경우에는 그대로 인수를 제안한다', () => {
      // Given (통행료 140,000원을 처음부터 현금으로 낼 수 있다)
      const game = buildGame({
        cities: [{ index: 3, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL] }],
        random: new FakeRandomSource([1, 2]),
      });

      // When
      const events = game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      assert.equal(findEvent(events, EVENT_TYPES.ACQUIRE_OFFERED).index, 3);
      assert.equal(game.phase, PHASES.AWAIT_ACQUIRE);
    });
  });

  it('자동 매각으로 충분하면 더 비싼 자산은 남긴다', () => {
    // Given
    const game = insolventGame({
      cities: [
        { index: 3, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL] },
        { index: 37, ownerId: 's1' },
        { index: 39, ownerId: 's1' },
      ],
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    game.execute('s1', COMMAND_TYPES.AUTO_SELL);

    // Then
    assert.equal(game.board.cityAt(37).isOwned(), false);
    assert.equal(game.board.cityAt(39).isOwnedBy('s1'), true);
  });
});

describe('Game(정리 페이즈에 채무가 없는 깨진 상태)', () => {
  /** 스냅샷이 손상되면 AWAIT_LIQUIDATION인데 채무가 비어 있을 수 있다. */
  const debtlessLiquidation = () =>
    buildGame({
      phase: PHASES.AWAIT_LIQUIDATION,
      debt: null,
      cities: [{ index: 39, ownerId: 's1' }],
      random: new FakeRandomSource([]),
    });

  for (const [label, type, payload] of [
    ['선택 매각', COMMAND_TYPES.SELL, { cityIndex: 39 }],
    ['자동 매각', COMMAND_TYPES.AUTO_SELL, {}],
    ['대출', COMMAND_TYPES.TAKE_LOAN, {}],
    ['파산 선언', COMMAND_TYPES.DECLARE_BANKRUPTCY, {}],
  ]) {
    it(`${label}은 원시 TypeError가 아니라 규격 도메인 예외로 거부된다`, () => {
      // Given
      const game = debtlessLiquidation();

      // When / Then
      assert.throws(
        () => game.execute('s1', type, payload),
        (error) => {
          assert.equal(error.name, 'DomainError');
          assert.equal(error.code, DOMAIN_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );
      assert.equal(game.version, 0);
      assert.equal(game.playerById('s1').eliminated, false);
      assert.equal(game.board.cityAt(39).isOwnedBy('s1'), true);
    });
  }
});

describe('Game(대출)', () => {
  it('대출을 받으면 현금 1,000,000원이 들어오고 채무 1,200,000원이 생긴다', () => {
    // Given
    const game = insolventGame();

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);
    const events = game.execute('s1', COMMAND_TYPES.TAKE_LOAN);

    // Then
    const loan = findEvent(events, EVENT_TYPES.LOAN_TAKEN);
    assert.equal(loan.principal, LOAN_PRINCIPAL);
    assert.equal(loan.debt, LOAN_DEBT);
    assert.equal(game.playerById('s1').loanDebt, LOAN_DEBT);
    assert.equal(game.playerById('s1').cash, 5_000 + LOAN_PRINCIPAL - 140_000);
    assertMoneyConserved(game, '대출');
  });

  it('대출은 게임당 한 번만 받을 수 있다', () => {
    // Given
    const game = insolventGame({
      cash: { s1: 5_000 },
      loans: { s1: { used: true, debt: 0 } },
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.equal(game.pendingDecision.canLoan, false);
    assert.throws(() => game.execute('s1', COMMAND_TYPES.TAKE_LOAN), {
      code: DOMAIN_ERROR_CODES.INVALID_STATE,
    });
  });

  describe('대출로도 메우지 못하는 큰 채무', () => {
    /** 서울(39, 랜드마크) 통행료 2,800,000원을 현금 5,000원으로 맞닥뜨린다. */
    const hugeDebtGame = (overrides = {}) =>
      buildGame({
        positions: { s1: 36 },
        cash: { s1: 5_000 },
        cities: [{ index: 39, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL], landmark: true }],
        random: new FakeRandomSource([1, 2]),
        ...overrides,
      });

    it('대출을 받아도 부족하면 정리 페이즈에 남고, 두 번째 대출은 거부된다', () => {
      // Given
      const game = hugeDebtGame();
      game.execute('s1', COMMAND_TYPES.ROLL);
      assert.equal(game.phase, PHASES.AWAIT_LIQUIDATION);
      assert.equal(game.pendingDecision.amountDue, 2_800_000);

      // When (실제로 대출을 한 번 받는다 — loanUsed를 주입하지 않는다)
      game.execute('s1', COMMAND_TYPES.TAKE_LOAN);

      // Then (여전히 부족해 정리 페이즈이며 채무는 그대로다)
      assert.equal(game.playerById('s1').cash, 5_000 + LOAN_PRINCIPAL);
      assert.equal(game.phase, PHASES.AWAIT_LIQUIDATION);
      assert.equal(game.pendingDecision.amountDue, 2_800_000);
      assert.equal(game.pendingDecision.canLoan, false);

      // When / Then (두 번째 대출은 거부)
      assert.throws(() => game.execute('s1', COMMAND_TYPES.TAKE_LOAN), {
        code: DOMAIN_ERROR_CODES.INVALID_STATE,
      });
      assert.equal(game.playerById('s1').loanDebt, LOAN_DEBT);
      assertMoneyConserved(game, '대출 후에도 부족');
    });

    it('부족한 매각 한 번으로는 정리 페이즈가 끝나지 않고 채무도 줄지 않는다', () => {
      // Given (하노이를 팔아도 30,000원뿐)
      const game = hugeDebtGame({
        cities: [
          { index: 39, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL], landmark: true },
          { index: 1, ownerId: 's1' },
        ],
      });
      game.execute('s1', COMMAND_TYPES.ROLL);

      // When
      const events = game.execute('s1', COMMAND_TYPES.SELL, { cityIndex: 1 });

      // Then
      assert.equal(findEvent(events, EVENT_TYPES.PROPERTY_SOLD).refund, 30_000);
      assert.equal(findEvent(events, EVENT_TYPES.DEBT_SETTLED), undefined);
      assert.equal(game.phase, PHASES.AWAIT_LIQUIDATION);
      assert.equal(game.pendingDecision.amountDue, 2_800_000);
      assert.equal(game.playerById('s1').cash, 35_000);
      assert.equal(game.pendingDecision.canSell, false, '팔 자산이 더 없다');
      assertMoneyConserved(game, '부족한 매각');
    });
  });

  it('대출 채무가 남아 있으면 월급이 압류된다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 38 },
      loans: { s1: { used: true, debt: 150_000 } },
      random: new FakeRandomSource([1, 2]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    const seized = findEvent(events, EVENT_TYPES.SALARY_SEIZED);
    assert.equal(seized.amount, 150_000);
    assert.equal(game.playerById('s1').loanDebt, 0);
    assert.equal(game.playerById('s1').cash, STARTING_CASH + (SALARY - 150_000));
    assert.ok(eventTypes(events).includes(EVENT_TYPES.LOAN_REPAID));
    assertMoneyConserved(game, '월급 압류');
  });

  it('월급보다 채무가 크면 월급 전액이 압류된다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 38 },
      loans: { s1: { used: true, debt: LOAN_DEBT } },
      random: new FakeRandomSource([1, 2]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(findEvent(events, EVENT_TYPES.SALARY_SEIZED).amount, SALARY);
    assert.equal(findEvent(events, EVENT_TYPES.SALARY_PAID), undefined);
    assert.equal(game.playerById('s1').loanDebt, LOAN_DEBT - SALARY);
    assert.equal(game.playerById('s1').cash, STARTING_CASH);
    assertMoneyConserved(game, '월급 전액 압류');
  });

  it('남은 대출 채무는 총자산 순위에서 차감된다', () => {
    // Given
    const game = buildGame({
      roundLimit: 1,
      cash: { s1: 2_000_000, s2: 1_500_000 },
      loans: { s1: { used: true, debt: 1_000_000 } },
      random: new FakeRandomSource([1, 2, 1, 2]),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);
    game.execute('s1', COMMAND_TYPES.SKIP_BUY);
    game.execute('s2', COMMAND_TYPES.ROLL);
    const events = game.execute('s2', COMMAND_TYPES.SKIP_BUY);

    // Then
    const over = findEvent(events, EVENT_TYPES.GAME_OVER);
    assert.equal(over.rankings[0].playerId, 's2');
    assert.equal(over.rankings[1].totalAssets, 1_000_000);
  });
});

describe('Game(파산 선언)', () => {
  it('정리 페이즈에서는 언제든 파산을 선언할 수 있다', () => {
    // Given
    const game = insolventGame({
      seats: [
        { id: 's1', name: '하나' },
        { id: 's2', name: '두리' },
        { id: 's3', name: '세찌' },
      ],
      cities: [
        { index: 3, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL] },
        { index: 39, ownerId: 's1' },
      ],
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const events = game.execute('s1', COMMAND_TYPES.DECLARE_BANKRUPTCY);

    // Then
    const bankrupt = findEvent(events, EVENT_TYPES.BANKRUPT);
    assert.equal(bankrupt.playerId, 's1');
    assert.equal(game.playerById('s1').eliminated, true);
    assert.equal(game.playerById('s1').cash, 0);
    assert.equal(game.board.cityAt(39).isOwned(), false);
    assert.equal(game.playerById('s2').cash, STARTING_CASH + 5_000);
    assert.equal(game.currentPlayerId, 's2');
    assertMoneyConserved(game, '파산 선언');
  });

  it('팔 자산도 대출도 없으면 파산만 선택할 수 있다', () => {
    // Given
    const game = insolventGame({ loans: { s1: { used: true, debt: 0 } } });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const decision = game.pendingDecision;

    // Then
    assert.equal(decision.canSell, false);
    assert.equal(decision.canLoan, false);
    assert.throws(() => game.execute('s1', COMMAND_TYPES.AUTO_SELL), {
      code: DOMAIN_ERROR_CODES.INVALID_STATE,
    });
    assert.throws(() => game.execute('s1', COMMAND_TYPES.TAKE_LOAN), {
      code: DOMAIN_ERROR_CODES.INVALID_STATE,
    });

    // When (남은 유일한 선택지를 실제로 실행한다)
    const events = game.execute('s1', COMMAND_TYPES.DECLARE_BANKRUPTCY);

    // Then (파산이 성립하고 남은 현금이 채권자에게 넘어간다)
    assert.equal(findEvent(events, EVENT_TYPES.BANKRUPT).playerId, 's1');
    assert.equal(game.playerById('s1').eliminated, true);
    assert.equal(game.playerById('s1').cash, 0);
    assert.equal(game.playerById('s2').cash, STARTING_CASH + 5_000);
    assert.equal(game.isOver(), true);
    assertMoneyConserved(game, '유일한 선택지 파산');
  });

  it('마지막 한 명이 남으면 게임이 끝난다', () => {
    // Given
    const game = insolventGame();
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const events = game.execute('s1', COMMAND_TYPES.DECLARE_BANKRUPTCY);

    // Then
    assert.equal(game.isOver(), true);
    assert.equal(findEvent(events, EVENT_TYPES.GAME_OVER).rankings[0].playerId, 's2');
  });

  it('은행에 대한 채무로 파산하면 남은 현금은 은행으로 간다', () => {
    // Given (건물 점검 티켓: 건물 3개 × 40,000 = 120,000원을 은행에 지불)
    const game = buildGame({
      seats: [
        { id: 's1', name: '하나' },
        { id: 's2', name: '두리' },
        { id: 's3', name: '세찌' },
      ],
      cash: { s1: 1_000 },
      drawPile: ['T17'],
      cities: [{ index: 1, ownerId: 's1', buildings: [VILLA, BUILDING, HOTEL] }],
      random: new FakeRandomSource([1, 1, 0]),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    game.execute('s1', COMMAND_TYPES.DECLARE_BANKRUPTCY);

    // Then
    assert.equal(game.playerById('s1').eliminated, true);
    assert.equal(game.playerById('s2').cash, STARTING_CASH);
    assert.equal(game.board.cityAt(1).isOwned(), false);
    assertMoneyConserved(game, '은행 채무 파산');
  });
});
