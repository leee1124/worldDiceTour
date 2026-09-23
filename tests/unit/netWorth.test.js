import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Board } from '../../src/domain/game/Board.js';
import { Player } from '../../src/domain/game/Player.js';
import { AssetRegistry } from '../../src/domain/game/payment/AssetRegistry.js';
import { NetWorth } from '../../src/domain/game/payment/NetWorth.js';
import { PropertyAssets } from '../../src/domain/game/payment/PropertyAssets.js';

/** 자산군 하나를 흉내내는 가짜 포트(순자산 합산만 쓴다). */
const fakeAssets = (kind, values) => ({
  kind,
  liquidationPriority: 10,
  listOf: () => [],
  valueOf: (playerId) => values[playerId] ?? 0,
  liquidate: () => ({ refund: 0, intents: [], events: [] }),
  releaseAllOf: () => ({ intents: [], events: [] }),
});

function build({ cities = [], extra = [] } = {}) {
  const registry = new AssetRegistry();
  registry.register(new PropertyAssets({ board: Board.restore(cities) }));
  for (const provider of extra) {
    registry.register(provider);
  }
  return new NetWorth({ registry });
}

describe('NetWorth(총자산 단일 출처)', () => {
  it('총자산 = 현금 + 자산 평가액 − 남은 대출 채무', () => {
    // Given (1번 하노이 90,000 + 별장 27,000 = 투자액 117,000)
    const netWorth = build({
      cities: [{ index: 1, ownerId: 's1', buildings: ['VILLA'], landmark: false }],
    });
    const player = new Player({ id: 's1', name: '하나', cash: 1_000_000, loanDebt: 200_000 });

    // When / Then
    assert.equal(netWorth.of(player), 1_000_000 + 117_000 - 200_000);
  });

  it('탈락자는 0이다', () => {
    // Given
    const netWorth = build({
      cities: [{ index: 1, ownerId: 's1', buildings: [], landmark: false }],
    });
    const player = new Player({ id: 's1', name: '하나', cash: 500_000, eliminated: true });

    // When / Then
    assert.equal(netWorth.of(player), 0);
  });

  it('자산군을 등록하면 총자산에 자동으로 합산된다(Game 수정 없이)', () => {
    // Given
    const netWorth = build({ extra: [fakeAssets('STOCK', { s1: 340_000 })] });
    const player = new Player({ id: 's1', name: '하나', cash: 100_000 });

    // When / Then
    assert.equal(netWorth.of(player), 440_000);
  });

  it('순위는 생존자 우선 → 총자산 → 현금 → 좌석 순서로 정렬된다', () => {
    // Given
    const netWorth = build();
    const players = [
      new Player({ id: 's1', name: '하나', cash: 1_000_000 }),
      new Player({ id: 's2', name: '두리', cash: 3_000_000 }),
      new Player({ id: 's3', name: '세찌', cash: 5_000_000, eliminated: true }),
      new Player({ id: 's4', name: '네찌', cash: 3_000_000 }),
    ];

    // When
    const rankings = netWorth.rankings(players);

    // Then
    assert.deepEqual(
      rankings.map((entry) => [entry.rank, entry.playerId, entry.totalAssets]),
      [
        [1, 's2', 3_000_000],
        [2, 's4', 3_000_000],
        [3, 's1', 1_000_000],
        [4, 's3', 0],
      ],
    );
  });

  it('순위 항목은 기존 DTO 계약(이름·현금·채무·탈락 여부)을 그대로 담는다', () => {
    // Given
    const netWorth = build();
    const players = [new Player({ id: 's1', name: '하나', cash: 7, loanDebt: 3 })];

    // When
    const [entry] = netWorth.rankings(players);

    // Then
    assert.deepEqual(entry, {
      playerId: 's1',
      name: '하나',
      eliminated: false,
      cash: 7,
      loanDebt: 3,
      totalAssets: 4,
      rank: 1,
    });
  });
});
