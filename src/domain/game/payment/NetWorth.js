/**
 * 총자산(순자산) 계산의 **단일 출처**.
 *
 * 예전에는 같은 공식이 `Game.rankings()`와 `application/dto.js`에 복제돼 있었다. 자산군이
 * 늘어나면 두 곳이 반드시 어긋나므로(순위와 화면의 총자산이 다르게 보이는 버그), 계산은
 * 여기 한 곳에만 둔다. 새 자산군은 `AssetRegistry`에 등록만 하면 자동으로 반영된다.
 *
 * ```
 * netWorth = 현금 + Σ 자산군 평가액 − 남은 대출 채무
 * 탈락자는 0. 정렬: 생존자 우선 → 총자산 → 현금 → 좌석 순서 (명세 D11/D19)
 * ```
 */
export class NetWorth {
  /** @type {import('./AssetRegistry.js').AssetRegistry} */
  #registry;

  constructor({ registry }) {
    this.#registry = registry;
  }

  /**
   * 한 좌석의 총자산.
   * @param {import('../Player.js').Player} player
   */
  of(player) {
    if (player.eliminated) {
      return 0;
    }
    return player.cash + this.#registry.valueOf(player.id) - player.loanDebt;
  }

  /**
   * 총자산 순위. 같은 상태면 언제나 같은 순위가 나온다(종료 모달이 흔들리지 않는다).
   * @param {import('../Player.js').Player[]} players 좌석 순서(입력 순서)
   */
  rankings(players) {
    const seatOrder = new Map(players.map((player, order) => [player.id, order]));
    const scored = players.map((player) => ({
      playerId: player.id,
      name: player.name,
      eliminated: player.eliminated,
      cash: player.cash,
      loanDebt: player.loanDebt,
      totalAssets: this.of(player),
    }));

    scored.sort((a, b) => {
      if (a.eliminated !== b.eliminated) {
        return a.eliminated ? 1 : -1;
      }
      if (b.totalAssets !== a.totalAssets) {
        return b.totalAssets - a.totalAssets;
      }
      if (b.cash !== a.cash) {
        return b.cash - a.cash;
      }
      return seatOrder.get(a.playerId) - seatOrder.get(b.playerId);
    });
    return scored.map((entry, order) => ({ ...entry, rank: order + 1 }));
  }
}
