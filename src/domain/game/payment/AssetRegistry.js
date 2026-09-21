import { DomainError } from '../../shared/DomainError.js';

/**
 * 자산군 레지스트리. 등록된 `AssetProvider`들을 모아 **총자산 합산 · 매각 가능 목록 ·
 * 파산 청산**을 한 곳에서 제공한다.
 *
 * 목록은 언제나 `liquidationPriority` 오름차순(작을수록 먼저 팔린다), 같은 자산군 안에서는
 * 제공자가 준 순서를 그대로 유지한다. 그래서 자산군을 하나 더 등록해도 기존 순서가 흔들리지 않는다.
 */
export class AssetRegistry {
  /** @type {import('../../shared/AssetProvider.js').AssetProvider[]} */
  #providers = [];

  /**
   * 자산군을 등록한다(R3: 확장은 포트 등록으로).
   * @param {import('../../shared/AssetProvider.js').AssetProvider} provider
   */
  register(provider) {
    assertProvider(provider);
    if (this.#providers.some((registered) => registered.kind === provider.kind)) {
      throw DomainError.invalidState(`이미 등록된 자산군입니다: ${provider.kind}`);
    }
    this.#providers.push(provider);
    this.#providers.sort((a, b) => a.liquidationPriority - b.liquidationPriority);
    return this;
  }

  /** 등록된 자산군 종류(매각 순서). */
  get kinds() {
    return this.#providers.map((provider) => provider.kind);
  }

  providerOf(kind) {
    const provider = this.#providers.find((candidate) => candidate.kind === kind);
    if (!provider) {
      throw DomainError.invalidArgument(`등록되지 않은 자산군입니다: ${kind}`);
    }
    return provider;
  }

  /**
   * 매각 가능한 자산 전체. 각 항목에 자산군 우선순위와 목록 내 순번을 붙여 돌려주므로
   * 자동매각이 "자산군 순서 → 환급액 낮은 것 → 목록 순서"로 안정적으로 정렬할 수 있다.
   * @returns {Array<import('../../shared/AssetProvider.js').SellableAsset & {priority:number, order:number}>}
   */
  sellableOf(playerId) {
    const assets = [];
    for (const provider of this.#providers) {
      for (const asset of provider.listOf(playerId)) {
        assets.push({ ...asset, priority: provider.liquidationPriority, order: assets.length });
      }
    }
    return assets;
  }

  /** 총자산 평가액(모든 자산군 합계). */
  valueOf(playerId) {
    return this.#providers.reduce((sum, provider) => sum + provider.valueOf(playerId), 0);
  }

  /** 한 건 매각. */
  liquidate({ playerId, kind, assetId, quantity }) {
    return this.providerOf(kind).liquidate({ playerId, assetId, quantity });
  }

  /**
   * 파산 청산: 모든 자산군을 **매각 순서대로** 비운다.
   * @returns {{intents:object[], events:object[], releasedIndexes:number[]}}
   */
  releaseAllOf(playerId) {
    const intents = [];
    const events = [];
    const releasedIndexes = [];
    for (const provider of this.#providers) {
      const result = provider.releaseAllOf(playerId) ?? {};
      intents.push(...(result.intents ?? []));
      events.push(...(result.events ?? []));
      releasedIndexes.push(...(result.releasedIndexes ?? []));
    }
    return { intents, events, releasedIndexes };
  }
}

function assertProvider(provider) {
  const required = ['listOf', 'valueOf', 'liquidate', 'releaseAllOf'];
  if (!provider || typeof provider.kind !== 'string' || provider.kind.length === 0) {
    throw DomainError.invalidArgument('자산군에는 kind가 필요합니다');
  }
  if (!Number.isInteger(provider.liquidationPriority)) {
    throw DomainError.invalidArgument(`자산군 ${provider.kind}에 liquidationPriority가 없습니다`);
  }
  for (const method of required) {
    if (typeof provider[method] !== 'function') {
      throw DomainError.invalidArgument(`자산군 ${provider.kind}에 ${method}가 없습니다`);
    }
  }
}
