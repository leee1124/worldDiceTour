import { DomainError } from '../../shared/DomainError.js';
import { MONEY_REASONS, MoneyIntent } from '../../shared/MoneyIntent.js';
import { EVENT_TYPES } from '../events.js';

/** 부동산 자산군 이름. */
export const PROPERTY_ASSET_KIND = 'PROPERTY';

/**
 * 부동산 매각 순서. 설계상 정리 순서는 **파생 → 코인 → 주식 → 예금 → 부동산**이므로
 * 부동산이 가장 뒤(가장 큰 값)다 — 보드를 지키는 것이 플레이어에게 유리하기 때문이다.
 */
export const PROPERTY_LIQUIDATION_PRIORITY = 100;

/**
 * 보드를 자산군 포트로 감싼 어댑터. `SELL`/`AUTO_SELL`/파산 청산의 부동산 규칙이 여기 모여 있다.
 * 이 파일이 `AssetProvider` 구현의 **참조 예시**이기도 하다.
 *
 * @implements {import('../../shared/AssetProvider.js').AssetProvider}
 */
export class PropertyAssets {
  /** @type {import('../Board.js').Board} */
  #board;

  constructor({ board }) {
    this.#board = board;
  }

  get kind() {
    return PROPERTY_ASSET_KIND;
  }

  get liquidationPriority() {
    return PROPERTY_LIQUIDATION_PRIORITY;
  }

  /**
   * 소유한 칸 목록(칸 번호 순). `view`가 그대로 DTO의 `pending.sellable` 항목이 된다.
   *
   * `index`/`name`/`refund`는 **기존 계약 그대로** 두고, 자산군을 구별할 `assetKind`/`assetId`를
   * 가산한다. 앞으로 주식·예금이 같은 목록에 섞여도 클라이언트는 `assetKind`로 분기하면 되고,
   * 이미 있는 화면은 한 줄도 고치지 않아도 된다(Phase 1에서 DTO를 깨지 않기 위한 자리).
   */
  listOf(playerId) {
    return this.#board.ownedBy(playerId).map((city) => ({
      kind: PROPERTY_ASSET_KIND,
      assetId: String(city.index),
      label: city.name,
      refund: city.liquidationValue(),
      quantity: 1,
      view: {
        index: city.index,
        name: city.name,
        refund: city.liquidationValue(),
        assetKind: PROPERTY_ASSET_KIND,
        assetId: String(city.index),
      },
    }));
  }

  /** 총자산 평가액 = 투자액 합계(매입가 + 정가 기준 건설비). */
  valueOf(playerId) {
    return this.#board.totalAssetValueOf(playerId);
  }

  /** 한 칸을 은행에 매각한다(건물 포함 통째로, 주인 없는 초기 상태로). */
  liquidate({ playerId, assetId }) {
    const city = this.#requireOwned(playerId, assetId);
    const refund = city.liquidationValue();
    const index = city.index;
    const name = city.name;
    city.reset();
    return {
      refund,
      intents: [
        MoneyIntent.fromBank({
          playerId,
          amount: refund,
          reason: MONEY_REASONS.LIQUIDATION,
          meta: { cityIndex: index },
        }),
      ],
      events: [
        { type: EVENT_TYPES.PROPERTY_SOLD, payload: { playerId, index, name, refund } },
      ],
    };
  }

  /**
   * 파산 청산: 소유한 모든 칸을 주인 없는 상태로 되돌린다.
   * 환급은 없다(파산은 자산을 잃는 것이므로 돈이 움직이지 않는다).
   */
  releaseAllOf(playerId) {
    return {
      refund: 0,
      intents: [],
      events: [],
      releasedIndexes: this.#board.releaseAllOf(playerId),
    };
  }

  #requireOwned(playerId, assetId) {
    const index = Number(assetId);
    if (!Number.isInteger(index)) {
      throw DomainError.invalidArgument(`매각할 칸이 올바르지 않습니다: ${assetId}`);
    }
    if (!this.#board.isOwnable(index) || !this.#board.cityAt(index).isOwnedBy(playerId)) {
      throw DomainError.invalidArgument(`내 소유가 아닌 칸은 매각할 수 없습니다: ${index}`);
    }
    return this.#board.cityAt(index);
  }
}
