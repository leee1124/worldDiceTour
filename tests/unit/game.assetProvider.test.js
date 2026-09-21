import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { MONEY_REASONS, MoneyIntent } from '../../src/domain/shared/MoneyIntent.js';
import { toGameViewDto } from '../../src/application/dto.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { assertMoneyConserved, buildGame, eventTypes } from '../support/gameBuilder.js';

/**
 * 가짜 두 번째 자산군(예금). **Game.js를 한 줄도 고치지 않고** 등록만으로
 * 총자산·정리 매각 목록·자동매각 순서·파산 청산에 들어가는지 확인한다.
 * 앞으로 붙는 주식·코인·파생이 정말 "가산만"으로 끝나는지의 증거다.
 */
class FakeDepositAssets {
  #balances;
  /** 어떤 메서드가 실제로 불렸는지 — "정말 참여했는가"를 증명할 근거. */
  calls = [];

  constructor(balances) {
    this.#balances = new Map(Object.entries(balances));
  }

  get kind() {
    return 'DEPOSIT';
  }

  /** 부동산(100)보다 작으므로 먼저 팔린다. */
  get liquidationPriority() {
    return 40;
  }

  listOf(playerId) {
    const balance = this.#balances.get(playerId) ?? 0;
    return balance <= 0
      ? []
      : [
          {
            kind: 'DEPOSIT',
            assetId: 'main',
            label: '정기예금',
            refund: balance,
            quantity: 1,
            view: { assetKind: 'DEPOSIT', assetId: 'main', name: '정기예금', refund: balance },
          },
        ];
  }

  valueOf(playerId) {
    return this.#balances.get(playerId) ?? 0;
  }

  liquidate({ playerId }) {
    this.calls.push(`liquidate:${playerId}`);
    return this.#cashOut(playerId);
  }

  /**
   * 파산 청산: **예금은 해지되어 현금으로 돌아온다**(앞으로의 주식·예금·증거금과 같은 성격).
   * 부동산처럼 그냥 사라지는 자산군이 아니므로, 이 돈이 채권자에게 흘러가야 한다.
   */
  releaseAllOf(playerId) {
    this.calls.push(`releaseAllOf:${playerId}`);
    return this.#cashOut(playerId);
  }

  #cashOut(playerId) {
    const refund = this.#balances.get(playerId) ?? 0;
    this.#balances.set(playerId, 0);
    if (refund <= 0) {
      return { refund: 0, intents: [], events: [] };
    }
    return {
      refund,
      intents: [
        MoneyIntent.fromBank({ playerId, amount: refund, reason: MONEY_REASONS.LIQUIDATION }),
      ],
      events: [
        {
          type: EVENT_TYPES.MONEY_GAINED,
          payload: { playerId, amount: refund, reason: MONEY_REASONS.LIQUIDATION },
        },
      ],
    };
  }
}

/**
 * 하나(s1)가 3번 방콕(두리 소유, 3종 건물)에 걸려 통행료를 못 내는 판.
 * 통행료 = 70,000 × 2.0 = 140,000. 하나의 현금은 5,000.
 */
function liquidationGame({ deposits = null, ownedByS1 = [] } = {}) {
  const game = buildGame({
    cash: { s1: 5_000 },
    cities: [
      { index: 3, ownerId: 's2', buildings: ['VILLA', 'BUILDING', 'HOTEL'] },
      ...ownedByS1,
    ],
    random: new FakeRandomSource([1, 2]),
  });
  if (deposits) {
    game.registerAssetProvider(new FakeDepositAssets(deposits));
  }
  game.execute('s1', COMMAND_TYPES.ROLL);
  assert.equal(game.phase, PHASES.AWAIT_LIQUIDATION, '정리 페이즈여야 한다');
  return game;
}

describe('Game 자산군 확장(AssetProvider 등록만으로)', () => {
  it('등록한 자산군이 총자산에 합산되고 DTO의 totalAssets도 같은 값을 쓴다', () => {
    // Given
    const game = buildGame({ random: new FakeRandomSource() });
    const before = game.netWorthOf('s1');

    // When
    game.registerAssetProvider(new FakeDepositAssets({ s1: 400_000 }));

    // Then
    assert.equal(game.netWorthOf('s1'), before + 400_000);
    const view = toGameViewDto(game);
    assert.equal(
      view.players.find((player) => player.seatId === 's1').totalAssets,
      before + 400_000,
    );
    assert.equal(game.rankings().find((entry) => entry.playerId === 's1').totalAssets, before + 400_000);
  });

  it('정리 페이즈의 매각 가능 목록에 자산군 우선순위 순서로 함께 나온다', () => {
    // Given
    const game = liquidationGame({
      deposits: { s1: 300_000 },
      ownedByS1: [{ index: 1, ownerId: 's1' }],
    });

    // When
    const pending = game.pendingDecision;

    // Then
    assert.equal(pending.canSell, true);
    assert.deepEqual(pending.sellable, [
      { assetKind: 'DEPOSIT', assetId: 'main', name: '정기예금', refund: 300_000 },
      {
        index: 1,
        name: '하노이',
        label: '하노이',
        refund: 30_000,
        quantity: 1,
        maxQuantity: 1,
        unitValue: 30_000,
        assetKind: 'PROPERTY',
        assetId: '1',
      },
    ]);
    // 모든 항목은 자산군을 스스로 밝힌다 → 클라이언트가 `assetKind`로 분기할 수 있다.
    assert.deepEqual(
      pending.sellable.map((asset) => asset.assetKind),
      ['DEPOSIT', 'PROPERTY'],
    );
  });

  it('AUTO_SELL은 자산군 우선순위대로 팔아 부동산을 지킨다', () => {
    // Given (예금 300,000이 하노이 30,000보다 비싸도 먼저 팔린다)
    const game = liquidationGame({
      deposits: { s1: 300_000 },
      ownedByS1: [{ index: 1, ownerId: 's1' }],
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.AUTO_SELL);

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.MONEY_GAINED), '예금이 매각됐다');
    assert.ok(!eventTypes(events).includes(EVENT_TYPES.PROPERTY_SOLD), '부동산은 팔리지 않았다');
    assert.equal(game.board.cityAt(1).isOwnedBy('s1'), true);
    assert.ok(eventTypes(events).includes(EVENT_TYPES.DEBT_SETTLED));
    assertMoneyConserved(game, '새 자산군 자동매각 후');
  });

  it('파산하면 등록된 자산군도 청산되고, 청산 대금이 채권자에게 흘러간다', () => {
    // Given (하나는 통행료 140,000을 못 내고 대출도 이미 썼다. 예금 1,000,000원이 있다)
    const game = buildGame({
      cash: { s1: 5_000 },
      loans: { s1: { used: true, debt: 0 } },
      cities: [{ index: 3, ownerId: 's2', buildings: ['VILLA', 'BUILDING', 'HOTEL'] }],
      random: new FakeRandomSource([1, 2]),
    });
    const deposits = new FakeDepositAssets({ s1: 1_000_000 });
    game.registerAssetProvider(deposits);
    game.execute('s1', COMMAND_TYPES.ROLL);
    assert.equal(game.phase, PHASES.AWAIT_LIQUIDATION);
    const creditorBefore = game.playerById('s2').cash;

    // When
    const events = game.execute('s1', COMMAND_TYPES.DECLARE_BANKRUPTCY);

    // Then (자산군이 실제로 청산에 참여했다)
    assert.deepEqual(deposits.calls, ['releaseAllOf:s1'], '파산 청산이 자산군을 호출해야 한다');
    assert.equal(deposits.valueOf('s1'), 0, '예금이 비워져야 한다');
    assert.ok(
      eventTypes(events).includes(EVENT_TYPES.MONEY_GAINED),
      '자산군이 낸 이벤트가 버려지지 않아야 한다',
    );

    // 청산 대금이 사라지지 않고 채권자에게 갔다: 현금 5,000 + 예금 1,000,000
    const bankruptEvent = events.find((event) => event.type === EVENT_TYPES.BANKRUPT);
    assert.equal(bankruptEvent.paidAmount, 1_005_000, '청산 대금이 분배 대상에 포함돼야 한다');
    assert.equal(game.playerById('s2').cash, creditorBefore + 1_005_000);
    assert.equal(game.playerById('s1').cash, 0);
    assert.equal(game.playerById('s1').eliminated, true);
    assert.equal(game.netWorthOf('s1'), 0);
    assertMoneyConserved(game, '새 자산군 파산 청산 후');
  });
});
