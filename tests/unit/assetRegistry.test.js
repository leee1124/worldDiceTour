import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Board } from '../../src/domain/game/Board.js';
import { AssetRegistry } from '../../src/domain/game/payment/AssetRegistry.js';
import { Liquidator } from '../../src/domain/game/payment/Liquidator.js';
import {
  PROPERTY_ASSET_KIND,
  PROPERTY_LIQUIDATION_PRIORITY,
  PropertyAssets,
} from '../../src/domain/game/payment/PropertyAssets.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';
import { MONEY_REASONS, MoneyIntent } from '../../src/domain/shared/MoneyIntent.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';

/**
 * 가짜 두 번째 자산군. 앞으로 붙을 주식·예금·파생이 **등록 한 줄로** 정리/파산/순자산에
 * 들어가는지 확인하는 대역이다(Game.js를 고치지 않아도 되는지가 핵심).
 */
class FakeDepositAssets {
  #balances;
  #priority;

  constructor(balances, priority = 40) {
    this.#balances = new Map(Object.entries(balances));
    this.#priority = priority;
  }

  get kind() {
    return 'DEPOSIT';
  }

  get liquidationPriority() {
    return this.#priority;
  }

  listOf(playerId) {
    const balance = this.#balances.get(playerId) ?? 0;
    if (balance <= 0) {
      return [];
    }
    return [
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
      intents: [
        MoneyIntent.fromBank({ playerId, amount: refund, reason: MONEY_REASONS.LIQUIDATION }),
      ],
      events: [{ type: EVENT_TYPES.PROPERTY_SOLD, payload: { playerId, index: null, name: '정기예금', refund } }],
    };
  }

  releaseAllOf(playerId) {
    return this.liquidate({ playerId });
  }
}

/** 하나(s1)가 1번 하노이(90,000)와 39번 서울(1,200,000)을 가진 보드. */
function boardWithCities() {
  return Board.restore([
    { index: 1, ownerId: 's1', buildings: [], landmark: false },
    { index: 39, ownerId: 's1', buildings: [], landmark: false },
    { index: 3, ownerId: 's2', buildings: [], landmark: false },
  ]);
}

function registryWith(board, extra = []) {
  const registry = new AssetRegistry();
  registry.register(new PropertyAssets({ board }));
  for (const provider of extra) {
    registry.register(provider);
  }
  return registry;
}

describe('AssetRegistry / PropertyAssets(자산군 포트)', () => {
  it('부동산 자산군은 보드 어댑터로 등록되고 매각 순서는 가장 뒤다', () => {
    // Given
    const registry = registryWith(boardWithCities());

    // When / Then
    assert.deepEqual(registry.kinds, [PROPERTY_ASSET_KIND]);
    assert.equal(PROPERTY_LIQUIDATION_PRIORITY > 0, true);
  });

  it('매각 가능 목록은 칸 번호 순서이며 환급액은 투자액의 절반이다', () => {
    // Given
    const registry = registryWith(boardWithCities());

    // When
    const sellable = registry.sellableOf('s1');

    // Then
    // 기존 계약(index/name/refund)은 그대로 두고 자산군 구별·수량 필드를 가산한다.
    // `label`/`quantity`/`maxQuantity`/`unitValue`는 자산군이 섞인 목록을 렌더러 하나로
    // 그릴 수 있게 하기 위한 공통 필드다(부동산은 한 칸이 1건).
    assert.deepEqual(
      sellable.map((asset) => asset.view),
      [
        {
          index: 1,
          name: '하노이',
          label: '하노이',
          refund: 45_000,
          quantity: 1,
          maxQuantity: 1,
          heldQuantity: 1,
          unitValue: 45_000,
          assetKind: 'PROPERTY',
          assetId: '1',
        },
        {
          index: 39,
          name: '서울',
          label: '서울',
          refund: 600_000,
          quantity: 1,
          maxQuantity: 1,
          heldQuantity: 1,
          unitValue: 600_000,
          assetKind: 'PROPERTY',
          assetId: '39',
        },
      ],
    );
  });

  it('순자산 평가액은 자산군별 합계다', () => {
    // Given
    const registry = registryWith(boardWithCities(), [new FakeDepositAssets({ s1: 500_000 })]);

    // When / Then
    assert.equal(registry.valueOf('s1'), 90_000 + 1_200_000 + 500_000);
    assert.equal(registry.valueOf('s2'), 105_000);
    assert.equal(registry.valueOf('ghost'), 0);
  });

  it('새 자산군을 등록하면 매각 목록에 자산군 우선순위 순서로 함께 나온다', () => {
    // Given (예금이 부동산보다 먼저 팔린다)
      const registry = registryWith(boardWithCities(), [new FakeDepositAssets({ s1: 500_000 })]);

    // When
    const sellable = registry.sellableOf('s1');

    // Then
    assert.deepEqual(
      sellable.map((asset) => asset.kind),
      ['DEPOSIT', PROPERTY_ASSET_KIND, PROPERTY_ASSET_KIND],
    );
  });

  it('한 건 매각은 환급 intent와 이벤트를 돌려주고 소유를 비운다', () => {
    // Given
    const board = boardWithCities();
    const registry = registryWith(board);

    // When
    const result = registry.liquidate({ playerId: 's1', kind: PROPERTY_ASSET_KIND, assetId: '1' });

    // Then
    assert.equal(result.refund, 45_000);
    assert.equal(result.intents.length, 1);
    assert.equal(result.intents[0].amount, 45_000);
    assert.equal(result.events[0].type, EVENT_TYPES.PROPERTY_SOLD);
    assert.equal(board.cityAt(1).isOwned(), false);
  });

  it('내 소유가 아닌 자산은 매각할 수 없다', () => {
    // Given
    const registry = registryWith(boardWithCities());

    // When / Then
    assert.throws(
      () => registry.liquidate({ playerId: 's1', kind: PROPERTY_ASSET_KIND, assetId: '3' }),
      DomainError,
    );
    assert.throws(
      () => registry.liquidate({ playerId: 's1', kind: PROPERTY_ASSET_KIND, assetId: '2' }),
      DomainError,
      '소유할 수 없는 칸',
    );
    assert.throws(
      () => registry.liquidate({ playerId: 's1', kind: 'GOLD', assetId: '1' }),
      DomainError,
      '등록되지 않은 자산군',
    );
  });

  it('전 자산 청산은 모든 자산군을 돌며 초기화한다', () => {
    // Given
    const board = boardWithCities();
    const deposits = new FakeDepositAssets({ s1: 500_000 });
    const registry = registryWith(board, [deposits]);

    // When
    const result = registry.releaseAllOf('s1');

    // Then
    assert.deepEqual(result.releasedIndexes, [1, 39]);
    assert.equal(board.ownedBy('s1').length, 0);
    assert.equal(deposits.valueOf('s1'), 0);
    assert.equal(registry.valueOf('s1'), 0);
  });

  it('포트 형태가 아닌 값이나 중복 자산군은 등록을 거부한다', () => {
    // Given
    const registry = registryWith(boardWithCities());

    // When / Then
    assert.throws(() => registry.register({ kind: 'BROKEN' }), DomainError);
    assert.throws(() => registry.register(new PropertyAssets({ board: boardWithCities() })), DomainError);
  });
});

describe('Liquidator(정리 매각 순서)', () => {
  it('환급액이 낮은 자산부터 팔고, 채무를 덮으면 멈춘다', () => {
    // Given (하노이 45,000 / 서울 600,000, 필요액 20,000)
    const board = boardWithCities();
    const liquidator = new Liquidator({ registry: registryWith(board) });

    // When
    const result = liquidator.autoSell({ playerId: 's1', cash: 0, amountDue: 20_000 });

    // Then
    assert.deepEqual(
      result.sold.map((asset) => asset.view.index),
      [1],
      '필요한 만큼만 판다',
    );
    assert.equal(board.cityAt(39).isOwned(), true);
  });

  it('필요액이 크면 낮은 것부터 차례로 다 팔아 본다', () => {
    // Given
    const board = boardWithCities();
    const liquidator = new Liquidator({ registry: registryWith(board) });

    // When
    const result = liquidator.autoSell({ playerId: 's1', cash: 0, amountDue: 10_000_000 });

    // Then
    assert.deepEqual(
      result.sold.map((asset) => asset.view.index),
      [1, 39],
    );
  });

  it('자산군 우선순위가 환급액보다 먼저다 — 예금이 더 비싸도 먼저 팔린다', () => {
    // Given (예금 500,000 > 하노이 45,000 이지만 예금 우선순위가 앞선다)
    const board = boardWithCities();
    const liquidator = new Liquidator({
      registry: registryWith(board, [new FakeDepositAssets({ s1: 500_000 })]),
    });

    // When
    const result = liquidator.autoSell({ playerId: 's1', cash: 0, amountDue: 10_000 });

    // Then
    assert.deepEqual(
      result.sold.map((asset) => asset.kind),
      ['DEPOSIT'],
    );
    assert.equal(board.cityAt(1).isOwned(), true, '부동산은 건드리지 않는다');
  });

  it('팔 자산이 없으면 거부한다', () => {
    // Given
    const liquidator = new Liquidator({ registry: registryWith(boardWithCities()) });

    // When / Then
    assert.throws(
      () => liquidator.autoSell({ playerId: 'ghost', cash: 0, amountDue: 1_000 }),
      DomainError,
    );
  });

  it('이미 현금이 충분하면 아무것도 팔지 않는다', () => {
    // Given
    const board = boardWithCities();
    const liquidator = new Liquidator({ registry: registryWith(board) });

    // When
    const result = liquidator.autoSell({ playerId: 's1', cash: 5_000_000, amountDue: 1_000 });

    // Then
    assert.deepEqual(result.sold, []);
    assert.equal(board.ownedBy('s1').length, 2);
  });
});
