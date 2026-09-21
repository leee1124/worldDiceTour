import { DomainError } from '../../shared/DomainError.js';

/**
 * 정리 매각 도메인 서비스.
 *
 * 매각 **순서**가 이 파일의 전부다:
 *   ① 자산군 우선순위(작을수록 먼저 — 파생 → 코인 → 주식 → 예금 → 부동산)
 *   ② 같은 자산군 안에서는 환급액이 낮은 것부터
 *   ③ 그마저 같으면 목록 순서(칸 번호 순) — 같은 상태면 언제나 같은 결과가 나온다
 *
 * 자산군이 늘어나도 이 세 줄만 유지하면 되고, `Game`은 바뀌지 않는다.
 */
export class Liquidator {
  /** @type {import('./AssetRegistry.js').AssetRegistry} */
  #registry;

  constructor({ registry }) {
    this.#registry = registry;
  }

  /** 정리 페이즈에 보여 줄 매각 가능 목록. */
  sellableOf(playerId) {
    return this.#registry.sellableOf(playerId);
  }

  /** 고른 자산 한 건을 매각한다. */
  sell({ playerId, kind, assetId, quantity }) {
    return this.#registry.liquidate({ playerId, kind, assetId, quantity });
  }

  /**
   * 자동매각: 채무를 덮을 수 있을 때까지 정해진 순서대로 판다.
   * @param {{playerId:string, cash:number, amountDue:number}} params
   * @returns {{intents:object[], events:object[], sold:object[]}}
   */
  autoSell({ playerId, cash, amountDue }) {
    const candidates = this.#ordered(playerId);
    if (candidates.length === 0) {
      throw DomainError.invalidState('매각할 자산이 없습니다');
    }

    const intents = [];
    const events = [];
    const sold = [];
    let available = cash;
    for (const asset of candidates) {
      if (available >= amountDue) {
        break;
      }
      const result = this.#registry.liquidate({
        playerId,
        kind: asset.kind,
        assetId: asset.assetId,
        quantity: asset.quantity,
      });
      intents.push(...result.intents);
      events.push(...result.events);
      sold.push(asset);
      available += result.refund;
    }
    return { intents, events, sold };
  }

  #ordered(playerId) {
    return this.#registry
      .sellableOf(playerId)
      .sort((a, b) => a.priority - b.priority || a.refund - b.refund || a.order - b.order);
  }
}
