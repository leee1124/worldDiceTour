import { MAX_SEATS } from '../domain/room/Room.js';
import { SPACE_KINDS } from '../domain/game/data/board.js';

/**
 * DTO 매퍼. 엔티티를 절대 그대로 내보내지 않으며 **좌석 토큰은 어떤 DTO에도 담지 않는다.**
 */

/**
 * 로비 목록용 요약 DTO. 좌석 상세는 넣지 않는다.
 * 입력은 도메인이 만든 요약(`Room.toSummary()`)이며, 저장소가 색인해 둔 값을 그대로 쓸 수 있다.
 * @param {{code:string, status:string, hostName:string|null, seatCount:number, roundLimit:number|null, updatedAt:number}} summary
 */
export function toRoomSummaryDto(summary) {
  return {
    code: summary.code,
    status: summary.status,
    hostName: summary.hostName ?? null,
    seatCount: summary.seatCount,
    maxSeats: MAX_SEATS,
    options: { roundLimit: summary.roundLimit ?? null },
    updatedAt: summary.updatedAt,
  };
}

/**
 * 방 상세.
 * @param {import('../domain/room/Room.js').Room} room
 * @param {{onlineSeatIds?: string[], autoStalled?: boolean}} options
 *   `onlineSeatIds`는 SSE 연결로 파악한 접속 좌석, `autoStalled`는 자동 진행이 재시도까지
 *   실패해 멈췄다는 일회성 신호다(다음 `room` 이벤트에서는 다시 false).
 */
export function toRoomDto(room, { onlineSeatIds = [], autoStalled = false } = {}) {
  const online = new Set(onlineSeatIds);
  return {
    code: room.code,
    status: room.status,
    hostSeatId: room.hostSeatId,
    // `finance`는 가산 필드다(기존 UI는 `roundLimit`만 읽어도 된다).
    options: { roundLimit: room.options.roundLimit, finance: room.options.finance },
    maxSeats: MAX_SEATS,
    seats: room.seats.map((seat) => ({
      id: seat.id,
      name: seat.name,
      kind: seat.kind,
      autopilot: seat.autopilot,
      isHost: room.isHost(seat.id),
      online: seat.isComputer ? true : online.has(seat.id),
    })),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    autoStalled: Boolean(autoStalled),
  };
}

/** 보드 한 칸. */
function toSpaceDto(board, index) {
  const space = board.spaceAt(index);
  const base = { index: space.index, name: space.name, kind: space.kind };
  if (space.kind !== SPACE_KINDS.CITY && space.kind !== SPACE_KINDS.RESORT) {
    return base;
  }
  const city = board.cityAt(index);
  const ownerId = city.ownerId;
  return {
    ...base,
    price: city.price,
    ownerId,
    buildings: city.buildings,
    landmark: city.landmark,
    invested: city.invested(),
    toll: city.tollFor({ resortCount: ownerId ? board.resortCountOf(ownerId) : 0 }),
    acquisitionPrice: city.canBeAcquired() ? city.acquisitionPrice() : null,
  };
}

/**
 * 게임 뷰. 클라이언트가 그리는 데 필요한 모든 공개 정보를 담는다(비밀 정보 없음).
 * @param {import('../domain/game/Game.js').Game} game
 */
export function toGameViewDto(game) {
  const board = game.board;
  return {
    version: game.version,
    phase: game.phase,
    round: game.round,
    roundLimit: game.options.roundLimit,
    currentSeatId: game.currentPlayerId,
    // 지금 결정을 내릴 좌석. 오늘은 `currentSeatId`와 항상 같고, 앞으로 경매처럼
    // 턴 소유자가 아닌 좌석이 행동하는 구간에서만 달라진다.
    actingSeatId: game.actingSeatId,
    jackpot: game.jackpot,
    isOver: game.isOver(),
    players: game.players.map((player) => ({
      seatId: player.id,
      name: player.name,
      cash: player.cash,
      position: player.position,
      eliminated: player.eliminated,
      islandRemainingTurns: player.islandRemainingTurns,
      airportPending: player.airportPending,
      loanUsed: player.loanUsed,
      loanDebt: player.loanDebt,
      cityCount: board.cityCountOf(player.id),
      resortCount: board.resortCountOf(player.id),
      // 순위와 같은 함수(`NetWorth`)를 쓴다 — 예전엔 같은 공식이 여기 복제돼 있어서
      // 자산군이 늘어나면 화면과 순위가 어긋날 수밖에 없었다.
      totalAssets: game.netWorthOf(player.id),
    })),
    board: Array.from({ length: board.size }, (_unused, index) => toSpaceDto(board, index)),
    pending: game.pendingDecision,
    rankings: game.isOver() ? game.rankings() : null,
  };
}
