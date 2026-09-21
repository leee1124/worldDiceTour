import { DEPOSIT_UNIT } from './DepositAccount.js';

/** 자산군 이름(정리 페이즈 DTO의 `assetKind`). */
export const STOCK_ASSET_KIND = 'STOCK';
export const DEPOSIT_ASSET_KIND = 'DEPOSIT';

/**
 * 정리 매각 순서(**작을수록 먼저 팔린다**).
 *
 * 설계서 순서는 파생(10) → 코인(20) → **주식(30) → 예금(50)** → 부동산(100)이다.
 * 뒤에 붙을 자산군이 사이에 끼어들 수 있도록 번호 사이를 비워 두었다 — 새 자산군이 생겨도
 * 기존 값을 고치지 않는다.
 */
export const STOCK_LIQUIDATION_PRIORITY = 30;
export const DEPOSIT_LIQUIDATION_PRIORITY = 50;

/** 예금 매각 목록의 항목 id(예금은 한 좌석에 하나뿐이다). */
export const DEPOSIT_ASSET_ID = 'CASH';

/**
 * 주식 자산군(`AssetProvider` 구현).
 *
 * `AssetRegistry.register(...)` 한 줄로 총자산·정리 매각 목록·자동매각 순서·파산 청산에 동시에
 * 들어온다(규칙 R3). 규칙은 전부 `Market`/`TradingDesk` 안에 있고 이 어댑터는 모양만 맞춘다.
 *
 * @implements {import('../shared/AssetProvider.js').AssetProvider}
 */
export class StockAssets {
  /** @type {import('./Market.js').Market} */
  #market;

  constructor({ market }) {
    this.#market = market;
  }

  get kind() {
    return STOCK_ASSET_KIND;
  }

  get liquidationPriority() {
    return STOCK_LIQUIDATION_PRIORITY;
  }

  /** 보유 종목 목록(종목 id 사전순). 상장폐지 종목은 값이 0이므로 목록에 올리지 않는다. */
  listOf(playerId) {
    const assets = [];
    for (const position of this.#market.holdingsOf(playerId)) {
      const instrument = this.#market.instrumentOf(position.instrumentId);
      if (!instrument?.isListed()) {
        continue;
      }
      const refund = instrument.valueOf(position.qty);
      const view = {
        assetKind: STOCK_ASSET_KIND,
        assetId: instrument.id,
        label: instrument.name,
        refund,
        quantity: position.qty,
        maxQuantity: position.qty,
        unitValue: instrument.price,
      };
      assets.push({
        kind: STOCK_ASSET_KIND,
        assetId: instrument.id,
        label: instrument.name,
        refund,
        quantity: position.qty,
        view,
      });
    }
    return assets;
  }

  /** 총자산 평가액 = 보유 주식 시가 합계. */
  valueOf(playerId) {
    return this.#market.stockValueOf(playerId);
  }

  /** 한 종목 일부/전량 매각(수수료 면제 — 강제 지불을 메우는 매각이므로). */
  liquidate({ playerId, assetId, quantity }) {
    const held = this.#market.holdingsOf(playerId).find((position) => position.instrumentId === assetId);
    return this.#market.liquidateStock({
      playerId,
      instrumentId: assetId,
      quantity: quantity ?? held?.qty ?? 0,
    });
  }

  /** 파산 청산: 예약 주문 취소 + 전 종목 시장가 매도. */
  releaseAllOf(playerId) {
    const result = this.#market.releaseStocksOf(playerId);
    return { refund: 0, releasedIndexes: [], ...result };
  }
}

/**
 * 예금 자산군(`AssetProvider` 구현).
 *
 * @implements {import('../shared/AssetProvider.js').AssetProvider}
 */
export class DepositAssets {
  /** @type {import('./Market.js').Market} */
  #market;

  constructor({ market }) {
    this.#market = market;
  }

  get kind() {
    return DEPOSIT_ASSET_KIND;
  }

  get liquidationPriority() {
    return DEPOSIT_LIQUIDATION_PRIORITY;
  }

  /** 예금은 한 좌석에 하나뿐이다. `quantity`는 원 단위 금액이다. */
  listOf(playerId) {
    const balance = this.#market.depositOf(playerId);
    if (balance < DEPOSIT_UNIT) {
      return [];
    }
    const view = {
      assetKind: DEPOSIT_ASSET_KIND,
      assetId: DEPOSIT_ASSET_ID,
      label: '예금',
      refund: balance,
      quantity: balance,
      maxQuantity: balance,
      unitValue: 1,
    };
    return [
      {
        kind: DEPOSIT_ASSET_KIND,
        assetId: DEPOSIT_ASSET_ID,
        label: '예금',
        refund: balance,
        quantity: balance,
        view,
      },
    ];
  }

  valueOf(playerId) {
    return this.#market.depositOf(playerId);
  }

  /** 일부 인출(10,000원 단위) 또는 전액. */
  liquidate({ playerId, assetId, quantity }) {
    void assetId;
    const balance = this.#market.depositOf(playerId);
    return this.#market.liquidateDeposit({ playerId, amount: quantity ?? balance });
  }

  /** 파산 청산: 전액 인출. */
  releaseAllOf(playerId) {
    const result = this.#market.releaseDepositOf(playerId);
    return { releasedIndexes: [], ...result };
  }
}
