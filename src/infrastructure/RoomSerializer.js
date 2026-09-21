import { ROOM_STATUS, MAX_SEATS, Room } from '../domain/room/Room.js';
import { SEAT_KINDS } from '../domain/room/Seat.js';
import { isValidRoomCode } from '../domain/room/RoomCode.js';
import { ALL_PHASES, PHASES } from '../domain/game/phases.js';
import { CONTINUATIONS, SINKS } from '../domain/game/Game.js';
import { Casino } from '../domain/game/Casino.js';
import { EVENT_TYPES, MONEY_REASONS } from '../domain/game/events.js';
import { BOARD_SIZE } from '../domain/game/data/board.js';

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
    assert(isBoardIndex(player.position), `위치 오류: ${player.position}`);
    assert(typeof player.eliminated === 'boolean', 'eliminated 값 오류');
    assert(isFiniteInteger(player.loanDebt) && player.loanDebt >= 0, '대출 채무 오류');
  }
  assert(Array.isArray(game.board), '보드 스냅샷이 배열이 아닙니다');
  for (const city of game.board) {
    assert(isPlainObject(city), '보드 칸이 객체가 아닙니다');
    assert(isBoardIndex(city.index), `칸 번호 오류: ${city.index}`);
    assert(city.ownerId === null || seatIds.has(city.ownerId), `칸 소유자 오류: ${city.ownerId}`);
    assert(Array.isArray(city.buildings), '건물 목록 오류');
    assert(typeof city.landmark === 'boolean', '랜드마크 값 오류');
  }
  assert(
    isPlainObject(game.casino) && isFiniteInteger(game.casino.jackpot) && game.casino.jackpot >= 0,
    `잭팟 오류: ${game.casino?.jackpot}`,
  );
  assert(isPlainObject(game.ledger), '은행 장부 오류');
  for (const field of ['fromBank', 'toBank']) {
    assert(
      isFiniteInteger(game.ledger[field]) && game.ledger[field] >= 0,
      `장부 ${field} 오류: ${game.ledger[field]}`,
    );
  }
  assert(
    game.initialTotal === undefined || (isFiniteInteger(game.initialTotal) && game.initialTotal >= 0),
    `초기 총액 오류: ${game.initialTotal}`,
  );
  assert(isPlainObject(game.deck) && Array.isArray(game.deck.drawPile), '티켓 덱 오류');
  validateTurnSnapshot(game, seatIds);
}

/** 0~39 칸 번호. */
const isBoardIndex = (value) => isFiniteInteger(value) && value >= 0 && value < BOARD_SIZE;
const isNullOrBoardIndex = (value) => value === null || value === undefined || isBoardIndex(value);

/**
 * 턴 임시 상태(turn) 검증.
 * 페이즈와 turn이 어긋난 스냅샷(예: AWAIT_LIQUIDATION인데 채무가 없음)은 복원 직후 커맨드에서
 * 터지므로, 여기서 막고 파일을 격리한다.
 */
function validateTurnSnapshot(game, seatIds) {
  if (game.turn === undefined || game.turn === null) {
    // 없으면 기본값(EMPTY_TURN)으로 복원되므로, 페이즈 정합성만 확인한다.
    assertPhaseTurnCoherence(game.phase, {});
    return;
  }
  const turn = game.turn;
  assert(isPlainObject(turn), 'turn이 객체가 아닙니다');
  assert(typeof turn.rollWasDouble === 'boolean', `turn.rollWasDouble 오류: ${turn.rollWasDouble}`);
  assert(
    isFiniteInteger(turn.casinoRoundsLeft) &&
      turn.casinoRoundsLeft >= 0 &&
      turn.casinoRoundsLeft <= Casino.MAX_ROUNDS_PER_VISIT,
    `turn.casinoRoundsLeft 오류: ${turn.casinoRoundsLeft}`,
  );
  assert(isNullOrBoardIndex(turn.buildIndex), `turn.buildIndex 오류: ${turn.buildIndex}`);
  assert(isNullOrBoardIndex(turn.acquireIndex), `turn.acquireIndex 오류: ${turn.acquireIndex}`);
  if (turn.debt !== null && turn.debt !== undefined) {
    validateDebtSnapshot(turn.debt, seatIds);
  }
  assertPhaseTurnCoherence(game.phase, turn);
}

function validateDebtSnapshot(debt, seatIds) {
  assert(isPlainObject(debt), 'turn.debt가 객체가 아닙니다');
  assert(Array.isArray(debt.items) && debt.items.length > 0, 'turn.debt.items 오류');
  for (const item of debt.items) {
    assert(isPlainObject(item), 'turn.debt 항목이 객체가 아닙니다');
    assert(
      isFiniteInteger(item.amount) && item.amount >= 0,
      `turn.debt 금액 오류: ${item.amount}`,
    );
    assert(Object.values(SINKS).includes(item.sink), `turn.debt sink 오류: ${item.sink}`);
    assert(
      item.toPlayerId === null || item.toPlayerId === undefined || seatIds.has(item.toPlayerId),
      `turn.debt 채권자 오류: ${item.toPlayerId}`,
    );
  }
  assert(
    Object.values(MONEY_REASONS).includes(debt.reason),
    `turn.debt reason 오류: ${debt.reason}`,
  );
  assert(isPlainObject(debt.event), 'turn.debt.event가 객체가 아닙니다');
  assert(
    Object.values(EVENT_TYPES).includes(debt.event.type),
    `turn.debt.event 종류 오류: ${debt.event.type}`,
  );
  assert(isPlainObject(debt.event.payload), 'turn.debt.event.payload가 객체가 아닙니다');
  assert(isPlainObject(debt.next), 'turn.debt.next가 객체가 아닙니다');
  assert(
    Object.values(CONTINUATIONS).includes(debt.next.kind),
    `turn.debt.next.kind 오류: ${debt.next.kind}`,
  );
  if (debt.next.kind === CONTINUATIONS.ACQUIRE) {
    assert(isBoardIndex(debt.next.cityIndex), `turn.debt.next.cityIndex 오류: ${debt.next.cityIndex}`);
  }
}

/** 페이즈가 요구하는 turn 필드가 실제로 채워져 있는지. */
function assertPhaseTurnCoherence(phase, turn) {
  const hasDebt = turn.debt !== null && turn.debt !== undefined;
  if (phase === PHASES.AWAIT_LIQUIDATION) {
    assert(hasDebt, 'AWAIT_LIQUIDATION 페이즈인데 채무가 없습니다');
  } else {
    assert(!hasDebt, `채무가 있는데 페이즈가 ${phase}입니다`);
  }
  if (phase === PHASES.AWAIT_BUILD) {
    assert(isBoardIndex(turn.buildIndex), 'AWAIT_BUILD 페이즈인데 건설 칸이 없습니다');
  }
  if (phase === PHASES.AWAIT_ACQUIRE) {
    assert(isBoardIndex(turn.acquireIndex), 'AWAIT_ACQUIRE 페이즈인데 인수 칸이 없습니다');
  }
  if (phase === PHASES.AWAIT_CASINO) {
    assert(
      isFiniteInteger(turn.casinoRoundsLeft) && turn.casinoRoundsLeft > 0,
      'AWAIT_CASINO 페이즈인데 남은 판이 없습니다',
    );
  }
}
