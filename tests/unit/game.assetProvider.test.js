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
    const refund = this.#balances.get(playerId) ?? 0;
    this.#balances.set(playerId, 0);
    return {
      refund,
      intents:
        refund > 0
          ? [MoneyIntent.fromBank({ playerId, amount: refund, reason: MONEY_REASONS.LIQUIDATION })]
          : [],
      events:
        refund > 0
          ? [{ type: EVENT_TYPES.MONEY_GAINED, payload: { playerId, amount: refund, reason: MONEY_REASONS.LIQUIDATION } }]
          : [],
    };
  }

  /** 파산: 예금은 은행 것이 되고 현금은 움직이지 않는다(자산을 잃는다). */
  releaseAllOf(playerId) {
    this.#balances.set(playerId, 0);
    return { refund: 0, intents: [], events: [] };
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
      { index: 1, name: '하노이', refund: 30_000 },
    ]);
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

  it('파산하면 등록된 자산군도 함께 청산되고 총자산이 0이 된다', () => {
    // Given (팔아도 모자라는 예금 1,000 + 대출 이미 사용)
    const game = buildGame({
      cash: { s1: 5_000 },
      loans: { s1: { used: true, debt: 0 } },
      cities: [{ index: 3, ownerId: 's2', buildings: ['VILLA', 'BUILDING', 'HOTEL'] }],
      random: new FakeRandomSource([1, 2]),
    });
    game.registerAssetProvider(new FakeDepositAssets({ s1: 1_000_000 }));
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const events = game.execute('s1', COMMAND_TYPES.DECLARE_BANKRUPTCY);

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.BANKRUPT));
    assert.equal(game.playerById('s1').eliminated, true);
    assert.equal(game.netWorthOf('s1'), 0, '탈락자의 총자산은 자산군과 무관하게 0');
    assertMoneyConserved(game, '새 자산군 파산 청산 후');
  });
});
