import { ISLAND_RESCUE_FEE } from './Player.js';
import { PHASES } from './phases.js';
import { SPACE_KINDS } from './data/board.js';

/**
 * "지금 이 좌석이 내려야 하는 결정"을 조립한다(읽기 전용 모델).
 *
 * 상태를 바꾸지 않고 현재 페이즈에 맞는 공개 정보만 모은다. 화면이 필요한 정보가 늘어나는 것은
 * 상태기계의 관심사가 아니므로, Game 밖의 이 파일이 자란다. 자산군이 늘어나도
 * `AWAIT_LIQUIDATION` 항목은 `Liquidator`가 준 목록을 그대로 쓰므로 여기도 바뀌지 않는다.
 *
 * @param {object} context
 * @param {string} context.phase 현재 페이즈
 * @param {import('./Player.js').Player|undefined} context.player 지금 차례인 좌석
 * @param {import('./Board.js').Board} context.board
 * @param {{buildIndex:number|null, acquireIndex:number|null, casinoRoundsLeft:number}} context.turn
 * @param {import('./Casino.js').Casino} context.casino
 * @param {import('./payment/PaymentFlow.js').PaymentFlow} context.payment
 * @param {import('./payment/Liquidator.js').Liquidator} context.liquidator
 * @returns {object|null} 결정이 없으면 null
 */
export function buildPendingDecision({ phase, player, board, turn, casino, payment, liquidator }) {
  if (!player) {
    return null;
  }
  switch (phase) {
    case PHASES.AWAIT_BUY: {
      const city = board.cityAt(player.position);
      return { kind: 'BUY', index: city.index, name: city.name, price: city.price };
    }
    case PHASES.AWAIT_BUILD: {
      const city = board.cityAt(turn.buildIndex);
      return {
        kind: 'BUILD',
        index: city.index,
        name: city.name,
        // 건설자의 바퀴에 따라 `options`/`lockedOptions`가 갈린다(규칙은 City가 안다).
        ...city.buildOffer({ lap: player.lap }),
        buildings: city.buildings,
        landmark: city.landmark,
      };
    }
    case PHASES.AWAIT_START_BUILD:
      return { kind: 'START_BUILD', candidates: startBuildCandidates(board, player) };
    case PHASES.AWAIT_ACQUIRE: {
      const city = board.cityAt(turn.acquireIndex);
      return {
        kind: 'ACQUIRE',
        index: city.index,
        name: city.name,
        ownerId: city.ownerId,
        price: city.acquisitionPrice(),
      };
    }
    case PHASES.AWAIT_CASINO:
      return {
        kind: 'CASINO',
        roundsLeft: turn.casinoRoundsLeft,
        limits: casino.betLimits(player.cash),
        jackpot: casino.jackpot,
      };
    case PHASES.AWAIT_ISLAND_CHOICE:
      return {
        kind: 'ISLAND',
        remainingTurns: player.islandRemainingTurns,
        fee: ISLAND_RESCUE_FEE,
        canPayFee: player.canPay(ISLAND_RESCUE_FEE),
      };
    case PHASES.AWAIT_TRAVEL:
      return { kind: 'TRAVEL', forbiddenIndexes: forbiddenTravelIndexes(board, player) };
    case PHASES.AWAIT_LIQUIDATION: {
      // 목록과 순서는 AssetRegistry/Liquidator가 정한다 — 자산군이 늘어도 여기는 안 바뀐다.
      const sellable = liquidator.sellableOf(player.id);
      return {
        kind: 'LIQUIDATION',
        amountDue: payment.amountDue,
        creditorId: payment.primaryCreditorId,
        canSell: sellable.length > 0,
        canLoan: player.canTakeLoan(),
        sellable: sellable.map((asset) => asset.view),
      };
    }
    default:
      return null;
  }
}

/**
 * 출발 칸 보너스로 건설할 수 있는 내 도시 목록.
 * 그 바퀴에 지을 것이 **하나도 없는** 도시는 후보에서 빠진다(빈 기회를 열지 않는다).
 */
export function startBuildCandidates(board, player) {
  return board
    .buildableBy(player.id, { cash: player.cash, lap: player.lap })
    .map((city) => ({
      index: city.index,
      name: city.name,
      price: city.price,
      ...city.buildOffer({ lap: player.lap }),
    }));
}

/**
 * 공항 이동권으로 고를 수 없는 칸.
 * 공항 칸 자신과 **지금 서 있는 칸**(0칸 이동은 이동이 아니라 같은 칸 효과의 재발동이다).
 */
export function forbiddenTravelIndexes(board, player) {
  const airportIndex = board.indexOfKind(SPACE_KINDS.AIRPORT);
  return airportIndex === player.position ? [airportIndex] : [airportIndex, player.position];
}
