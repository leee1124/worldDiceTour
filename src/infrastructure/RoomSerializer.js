import { ROOM_STATUS, MAX_SEATS, Room } from '../domain/room/Room.js';
import { SEAT_KINDS } from '../domain/room/Seat.js';
import { isValidRoomCode } from '../domain/room/RoomCode.js';
import { ALL_PHASES } from '../domain/game/phases.js';

/** 저장 파일 스키마 위반. 호출자는 이 파일을 버리고 로그를 남긴다. */
export class RoomSchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoomSchemaError';
  }
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const isFiniteInteger = (value) => Number.isInteger(value);

function assert(condition, message) {
  if (!condition) {
    throw new RoomSchemaError(message);
  }
}

/** 방 스냅샷을 JSON 문자열로. */
export function serializeRoom(room) {
  return JSON.stringify(room.toSnapshot());
}

/**
 * 저장된 방 스냅샷을 검증하고 Room으로 복원한다.
 * @param {unknown} snapshot
 * @param {import('../domain/shared/interfaces.js').RandomSource} random
 */
export function deserializeRoom(snapshot, random) {
  validateRoomSnapshot(snapshot);
  return Room.restore(snapshot, random);
}

export function parseRoomJson(text, random) {
  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch (error) {
    throw new RoomSchemaError(`JSON 파싱 실패: ${error.message}`);
  }
  return deserializeRoom(snapshot, random);
}

/** 방 스냅샷 스키마 검증(화이트리스트 방식). */
export function validateRoomSnapshot(snapshot) {
  assert(isPlainObject(snapshot), '방 스냅샷이 객체가 아닙니다');
  assert(isValidRoomCode(snapshot.code), `방 코드 형식 오류: ${snapshot.code}`);
  assert(Object.values(ROOM_STATUS).includes(snapshot.status), `방 상태 오류: ${snapshot.status}`);
  assert(Array.isArray(snapshot.seats), '좌석 목록이 배열이 아닙니다');
  assert(snapshot.seats.length <= MAX_SEATS, `좌석 수 초과: ${snapshot.seats.length}`);
  for (const seat of snapshot.seats) {
    assert(isPlainObject(seat), '좌석이 객체가 아닙니다');
    assert(isNonEmptyString(seat.id), `좌석 id 오류: ${seat.id}`);
    assert(isNonEmptyString(seat.name), `좌석 이름 오류: ${seat.name}`);
    assert(Object.values(SEAT_KINDS).includes(seat.kind), `좌석 종류 오류: ${seat.kind}`);
    assert(isNonEmptyString(seat.token), '좌석 토큰이 없습니다');
    assert(typeof seat.autopilot === 'boolean', '좌석 autopilot 값 오류');
  }
  if (snapshot.hostSeatId !== null) {
    assert(
      snapshot.seats.some((seat) => seat.id === snapshot.hostSeatId),
      `호스트 좌석이 목록에 없습니다: ${snapshot.hostSeatId}`,
    );
  }
  assert(isPlainObject(snapshot.options), '방 옵션이 객체가 아닙니다');
  assert(
    snapshot.options.roundLimit === null || isFiniteInteger(snapshot.options.roundLimit),
    `라운드 제한 오류: ${snapshot.options.roundLimit}`,
  );
  assert(isFiniteInteger(snapshot.createdAt), '생성 시각 오류');
  assert(isFiniteInteger(snapshot.updatedAt), '수정 시각 오류');

  if (snapshot.status === ROOM_STATUS.LOBBY) {
    assert(snapshot.game === null || snapshot.game === undefined, '대기실에는 게임이 없어야 합니다');
    return;
  }
  validateGameSnapshot(snapshot.game, snapshot.seats);
}

function validateGameSnapshot(game, seats) {
  assert(isPlainObject(game), '게임 스냅샷이 객체가 아닙니다');
  assert(ALL_PHASES.includes(game.phase), `게임 페이즈 오류: ${game.phase}`);
  assert(isFiniteInteger(game.version) && game.version >= 0, '게임 version 오류');
  assert(isFiniteInteger(game.round) && game.round >= 1, '게임 round 오류');
  assert(Array.isArray(game.players) && game.players.length >= 2, '게임 플레이어 목록 오류');
  assert(
    isFiniteInteger(game.turnIndex) && game.turnIndex >= 0 && game.turnIndex < game.players.length,
    `턴 인덱스 오류: ${game.turnIndex}`,
  );
  const seatIds = new Set(seats.map((seat) => seat.id));
  for (const player of game.players) {
    assert(isPlainObject(player), '플레이어가 객체가 아닙니다');
    assert(seatIds.has(player.id), `좌석에 없는 플레이어입니다: ${player.id}`);
    assert(isFiniteInteger(player.cash) && player.cash >= 0, `현금 오류: ${player.cash}`);
    assert(isFiniteInteger(player.position) && player.position >= 0 && player.position < 40,
      `위치 오류: ${player.position}`);
    assert(typeof player.eliminated === 'boolean', 'eliminated 값 오류');
    assert(isFiniteInteger(player.loanDebt) && player.loanDebt >= 0, '대출 채무 오류');
  }
  assert(Array.isArray(game.board), '보드 스냅샷이 배열이 아닙니다');
  for (const city of game.board) {
    assert(isPlainObject(city), '보드 칸이 객체가 아닙니다');
    assert(isFiniteInteger(city.index) && city.index >= 0 && city.index < 40, `칸 번호 오류: ${city.index}`);
    assert(city.ownerId === null || seatIds.has(city.ownerId), `칸 소유자 오류: ${city.ownerId}`);
    assert(Array.isArray(city.buildings), '건물 목록 오류');
    assert(typeof city.landmark === 'boolean', '랜드마크 값 오류');
  }
  assert(isPlainObject(game.casino) && isFiniteInteger(game.casino.jackpot), '잭팟 오류');
  assert(isPlainObject(game.ledger), '은행 장부 오류');
  assert(isPlainObject(game.deck) && Array.isArray(game.deck.drawPile), '티켓 덱 오류');
}
