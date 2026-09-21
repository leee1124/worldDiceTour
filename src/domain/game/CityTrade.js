import { DomainError } from '../shared/DomainError.js';
import { MONEY_REASONS, MoneyIntent } from '../shared/MoneyIntent.js';
import { BUILDING_TYPES } from './City.js';
import { EVENT_TYPES } from './events.js';

/**
 * 도시 거래(매입 · 건설 · 인수) 규칙.
 *
 * 세 거래는 모두 **자발적 행동**이므로 현금이 부족하면 정리 페이즈로 가지 않고 거부한다(명세 D7).
 * 검증 → 돈 이동 의사 → 소유/건물 변경 → 이벤트를 한 곳에서 처리하고,
 * "언제 이 기회를 제안하는가"는 Game의 상태기계가 결정한다.
 *
 * 돈은 직접 옮기지 않고 `{ intents, events }`만 돌려준다(R2).
 */
export class CityTrade {
  #findPlayer;

  /** @param {{findPlayer: (id: string) => object|null}} params 탈락 여부 판단에 쓴다 */
  constructor({ findPlayer }) {
    this.#findPlayer = findPlayer;
  }

  /**
   * 빈 도시 매입. 매입가는 은행으로 간다.
   * @returns {{intents: object[], events: object[]}}
   */
  buy({ player, city }) {
    if (city.isOwned()) {
      throw DomainError.invalidState(`이미 주인이 있는 칸입니다: ${city.name}`);
    }
    if (!player.canPay(city.price)) {
      throw DomainError.insufficientCash(`매입 대금 ${city.price}원이 부족합니다`);
    }
    const price = city.price;
    const intents = [
      MoneyIntent.toBank({
        playerId: player.id,
        amount: price,
        reason: MONEY_REASONS.PURCHASE,
        meta: { cityIndex: city.index },
      }),
    ];
    city.buy(player.id);
    return {
      intents,
      events: [
        {
          type: EVENT_TYPES.CITY_PURCHASED,
          payload: { playerId: player.id, index: city.index, name: city.name, price },
        },
      ],
    };
  }

  /**
   * 고른 건물 조합을 검증하고 짓는다. 건설비는 은행으로 간다.
   * 랜드마크 완성은 `BUILT`와 함께 `LANDMARK_BUILT`를 남긴다.
   *
   * 바퀴가 모자란 건물을 고르면 `City`가 거부한다 — 클라이언트가 잠긴 선택지를 보냈더라도
   * 상태는 하나도 바뀌지 않는다(검증이 모든 변경보다 먼저다).
   * @returns {{intents: object[], events: object[]}}
   */
  build({ player, city, buildings }) {
    if (!city.isOwnedBy(player.id)) {
      throw DomainError.invalidArgument(`내 도시가 아닙니다: ${city.index}`);
    }
    city.assertCanBuild(buildings, { lap: player.lap });
    const cost = city.costOf(buildings);
    if (!player.canPay(cost)) {
      throw DomainError.insufficientCash(`건설비 ${cost}원이 부족합니다`);
    }
    const intents = [
      MoneyIntent.toBank({
        playerId: player.id,
        amount: cost,
        reason: MONEY_REASONS.BUILD,
        meta: { cityIndex: city.index },
      }),
    ];
    city.build(buildings, { lap: player.lap });

    const base = { playerId: player.id, index: city.index, name: city.name };
    const events = [
      { type: EVENT_TYPES.BUILT, payload: { ...base, buildings: [...buildings], cost } },
    ];
    if (buildings.includes(BUILDING_TYPES.LANDMARK)) {
      events.push({ type: EVENT_TYPES.LANDMARK_BUILT, payload: { ...base, cost } });
    }
    return { intents, events };
  }

  /**
   * 남의 도시 인수. 인수 대금은 **보유 현금으로만** 낼 수 있다(명세 4장).
   * 소유자가 탈락했거나 사라졌으면 줄 사람이 없으므로 은행이 받는다.
   * @returns {{intents: object[], events: object[]}}
   */
  acquire({ player, city }) {
    if (!city.canBeAcquired()) {
      throw DomainError.invalidState(`인수할 수 없는 칸입니다: ${city.name}`);
    }
    const price = city.acquisitionPrice();
    if (!player.canPay(price)) {
      throw DomainError.insufficientCash('인수 대금은 보유 현금으로만 지불할 수 있습니다');
    }
    const owner = this.#findPlayer(city.ownerId);
    const meta = { cityIndex: city.index };
    const intents = [
      owner && !owner.eliminated
        ? MoneyIntent.transfer({
            fromId: player.id,
            toId: owner.id,
            amount: price,
            reason: MONEY_REASONS.ACQUISITION,
            meta,
          })
        : MoneyIntent.toBank({
            playerId: player.id,
            amount: price,
            reason: MONEY_REASONS.ACQUISITION,
            meta,
          }),
    ];
    city.transferTo(player.id);
    return {
      intents,
      events: [
        {
          type: EVENT_TYPES.ACQUIRED,
          payload: {
            playerId: player.id,
            index: city.index,
            name: city.name,
            fromId: owner?.id ?? null,
            price,
          },
        },
      ],
    };
  }
}
