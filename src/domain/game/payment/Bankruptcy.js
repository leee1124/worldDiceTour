import { MONEY_REASONS, MoneyIntent } from '../../shared/MoneyIntent.js';

/**
 * 파산 청산 시나리오.
 *
 * "남은 현금을 누가 얼마나 받는가"와 "어떤 자산을 비우는가"의 규칙만 담는다. 페이즈 전이·탈락
 * 처리·이벤트 발행은 Game이 한다. 앞으로 포지션·예금·담보가 늘어나도 자산 청산은
 * `AssetRegistry`가 자산군 순서대로 처리하므로 이 파일은 바뀌지 않는다.
 */
export class Bankruptcy {
  /** @type {import('./AssetRegistry.js').AssetRegistry} */
  #registry;

  constructor({ registry }) {
    this.#registry = registry;
  }

  /**
   * 남은 현금의 행선지를 정한다(상태 변경 없음).
   *
   * 채권자가 여러 명이면 **고르게 나누고(내림), 나머지는 좌석 순서가 앞선 채권자에게** 준다.
   * 나눠 준 합계는 항상 남은 현금과 정확히 같다(돈의 보존 불변식).
   * 파산자 자신은 채권자에서 제외한다 — 자기에게 돌려주면 `eliminate()`에서 그 돈이 사라진다
   * (손상된 스냅샷에 대한 방어).
   *
   * @param {{player: object, note: import('./DebtNote.js').DebtNote|null, players: object[]}} params
   * @returns {{remaining:number, creditors:object[], transfers:Array<{creditor:object, amount:number}>, toJackpot:boolean, intents:object[]}}
   */
  plan({ player, note, players }) {
    const remaining = player.cash;
    const creditorIds = note?.creditorIds() ?? [];
    const creditors = players.filter(
      (candidate) =>
        creditorIds.includes(candidate.id) && !candidate.eliminated && candidate.id !== player.id,
    );
    const toJackpot = Boolean(note?.hasJackpotSink);

    if (remaining <= 0) {
      return { remaining, creditors, transfers: [], toJackpot, intents: [] };
    }

    if (creditors.length > 0) {
      const transfers = shareEvenly(remaining, creditors);
      return {
        remaining,
        creditors,
        transfers,
        toJackpot,
        intents: transfers.map(({ creditor, amount }) =>
          MoneyIntent.transfer({
            fromId: player.id,
            toId: creditor.id,
            amount,
            reason: MONEY_REASONS.BANKRUPTCY,
          }),
        ),
      };
    }

    const intent = toJackpot
      ? MoneyIntent.toJackpot({
          playerId: player.id,
          amount: remaining,
          reason: MONEY_REASONS.BANKRUPTCY,
        })
      : MoneyIntent.toBank({
          playerId: player.id,
          amount: remaining,
          reason: MONEY_REASONS.BANKRUPTCY,
        });
    return { remaining, creditors, transfers: [], toJackpot, intents: [intent] };
  }

  /** 모든 자산군을 비운다. */
  liquidateAll(playerId) {
    return this.#registry.releaseAllOf(playerId);
  }
}

/** 고르게(내림) 나누고 나머지는 앞선 좌석에게 1원씩. 합계는 정확히 `remaining`이다. */
function shareEvenly(remaining, creditors) {
  const share = Math.floor(remaining / creditors.length);
  let leftover = remaining - share * creditors.length;
  const transfers = [];
  for (const creditor of creditors) {
    const amount = share + (leftover > 0 ? 1 : 0);
    leftover = Math.max(0, leftover - 1);
    if (amount > 0) {
      transfers.push({ creditor, amount });
    }
  }
  return transfers;
}
