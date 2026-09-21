import { MAX_SEATS } from '../domain/room/Room.js';
import { SPACE_KINDS } from '../domain/game/data/board.js';

/**
 * DTO 매퍼. 엔티티를 절대 그대로 내보내지 않으며 **좌석 토큰은 어떤 DTO에도 담지 않는다.**
 */

/** 로비 목록용 요약. 좌석 상세는 넣지 않는다. */
export function toRoomSummaryDto(room) {
  const host = room.seatById(room.hostSeatId);
  return {
    code: room.code,
    status: room.status,
    hostName: host?.name ?? null,
    seatCount: room.seats.length,
    maxSeats: MAX_SEATS,
    options: { roundLimit: room.options.roundLimit },
    updatedAt: room.updatedAt,
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
    options: { roundLimit: room.options.roundLimit },
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
      totalAssets: player.eliminated
        ? 0
        : player.cash + board.totalAssetValueOf(player.id) - player.loanDebt,
    })),
    board: Array.from({ length: board.size }, (_unused, index) => toSpaceDto(board, index)),
    pending: game.pendingDecision,
    rankings: game.isOver() ? game.rankings() : null,
  };
}

/** 방 + (진행 중이면) 게임 스냅샷을 함께 담은 응답. */
export function toRoomStateDto(room, presence) {
  return {
    room: toRoomDto(room, presence),
    game: room.game ? toGameViewDto(room.game) : null,
  };
}
