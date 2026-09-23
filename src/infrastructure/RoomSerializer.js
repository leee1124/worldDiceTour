import { ROOM_SCHEMA_VERSION, ROOM_STATUS, MAX_SEATS, Room } from '../domain/room/Room.js';
import {
  ALLOWED_FINANCE_OPTIONS,
  DEFAULT_FINANCE_OPTIONS,
  FINANCE_OPTION_KEYS,
} from '../domain/room/FinanceOptions.js';
import { SEAT_KINDS } from '../domain/room/Seat.js';
import { isValidRoomCode } from '../domain/room/RoomCode.js';
import { ALL_PHASES, PHASES } from '../domain/game/phases.js';
import { CONTINUATIONS, SINKS } from '../domain/game/payment/DebtNote.js';
import { Casino } from '../domain/game/Casino.js';
import { EVENT_TYPES, MONEY_REASONS } from '../domain/game/events.js';
import { MAX_MONEY } from '../domain/shared/Money.js';
import { FIRST_LAP } from '../domain/game/buildings.js';
import { BOARD_SIZE, BOARD_SPACES, OWNABLE_KINDS } from '../domain/game/data/board.js';

/** 저장 파일 스키마 위반. 호출자는 이 파일을 버리고 로그를 남긴다. */
export class RoomSchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoomSchemaError';
  }
}

/**
 * 저장 파일이 **이 코드보다 새로운** 스키마다.
 *
 * 손상과 달리 파일은 멀쩡하다 — 더 새 서버로 되돌리면 그대로 이어서 플레이할 수 있다.
 * 그래서 호출자는 이 파일을 **격리(이름 변경)하지 말고 그냥 건너뛰어야** 한다. 격리해 버리면
 * 롤백 한 번으로 진행 중인 판이 사라진다(`schemaVersion`을 도입한 이유 자체가 그것을 막는 것이다).
 */
export class RoomVersionError extends RoomSchemaError {
  constructor(message) {
    super(message);
    this.name = 'RoomVersionError';
  }
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
/**
 * 안전 정수만 정수로 인정한다.
 * `Number.isInteger`는 `1e300`이나 `2^53+1`도 참이라, 그런 값이 들어오면 복원된 게임의
 * 보존 불변식이 **처음부터** 거짓이 되거나(1e300) 값이 조용히 달라진다(2^53+1).
 */
const isFiniteInteger = (value) => Number.isSafeInteger(value);
/** 금액 필드: 도메인(`Money.js`)이 허용하는 것과 정확히 같은 범위만 통과시킨다. */
const isMoney = (value) => Number.isSafeInteger(value) && Math.abs(value) <= MAX_MONEY;

function assert(condition, message) {
  if (!condition) {
    throw new RoomSchemaError(message);
  }
}

/**
 * 손상된 값을 **예외 없이** 짧은 문자열로 만든다.
 *
 * 오류 메시지를 만들 때 `${value}`를 쓰면 `{"toString": 1}` 같은 JSON 값에서 원시 `TypeError`가
 * 나고, 그러면 규격화된 `RoomSchemaError`가 아예 만들어지지 않는다(server/validation.js의
 * `safeText`와 같은 이유). 검증기의 모든 메시지는 이 함수를 지난다.
 */
function describe(value) {
  if (value === null || value === undefined) {
    return String(value);
  }
  const type = typeof value;
  if (type === 'string') {
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  }
  if (type === 'number' || type === 'boolean' || type === 'bigint') {
    return String(value);
  }
  if (type === 'symbol' || type === 'function') {
    return `<${type}>`;
  }
  try {
    const json = JSON.stringify(value);
    return json === undefined ? `<${type}>` : json.length > 80 ? `${json.slice(0, 80)}…` : json;
  } catch {
    return `<${type}>`;
  }
}

/** 방 스냅샷을 JSON 문자열로. */
export function serializeRoom(room) {
  return JSON.stringify(room.toSnapshot());
}

/** 지금 코드가 쓰는 스냅샷 스키마 버전. */
export const CURRENT_ROOM_SCHEMA_VERSION = ROOM_SCHEMA_VERSION;

/**
 * 스키마 단계별 승급 목록. **Phase마다 한 줄 추가**하고 기존 단계는 고치지 않는다 —
 * 옛 파일은 여전히 그 경로를 그대로 지나 올라와야 한다.
 */
const MIGRATIONS = Object.freeze([{ from: 1, to: 2, apply: migrateV1ToV2 }]);

/**
 * 저장 스냅샷을 현재 스키마로 승급한다.
 *
 * `schemaVersion`이 없으면 1로 본다(그 필드가 생기기 전에 저장된 방). 미래 버전은 이 코드가
 * 해석할 수 없으므로 거부한다 — 모르는 필드를 무시하고 진행하면 그 방을 **덮어써서** 잃는다.
 *
 * @param {unknown} raw
 * @returns {object} 새 객체(입력을 변형하지 않는다)
 */
export function migrateRoomSnapshot(raw) {
  assert(isPlainObject(raw), '방 스냅샷이 객체가 아닙니다');
  const declared = raw.schemaVersion;
  assert(
    declared === undefined || (isFiniteInteger(declared) && declared >= 1),
    `스키마 버전 오류: ${describe(declared)}`,
  );
  const from = declared ?? 1;
  if (from > CURRENT_ROOM_SCHEMA_VERSION) {
    // 손상이 아니라 "너무 새로운 파일"이다 — 건너뛰기만 하고 파일은 손대지 않는다.
    throw new RoomVersionError(
      `미래 스키마 버전입니다(${from} > ${CURRENT_ROOM_SCHEMA_VERSION}). 서버를 업데이트하세요`,
    );
  }

  let snapshot = raw;
  let version = from;
  while (version < CURRENT_ROOM_SCHEMA_VERSION) {
    const step = MIGRATIONS.find((migration) => migration.from === version);
    assert(step, `스키마 ${version} → ${CURRENT_ROOM_SCHEMA_VERSION} 승급 경로가 없습니다`);
    // 전진 보장: 목록을 잘못 적으면(예: from 2 → to 2) 서버 부팅이 무한 루프에 빠진다.
    assert(step.to > version, `스키마 승급 단계가 전진하지 않습니다: ${version} → ${step.to}`);
    snapshot = step.apply(snapshot);
    assert(
      snapshot?.schemaVersion === step.to,
      `스키마 승급 단계가 버전을 남기지 않았습니다: ${version} → ${step.to}`,
    );
    version = step.to;
  }
  return snapshot;
}

/**
 * v1 → v2: 금융 옵션 기본값(전부 꺼짐)을 채운다.
 * **진행 중인 판에 기능이 갑자기 끼어들지 않는다** — 밸런스/불변식이 판 중간에 바뀌면 안 된다.
 * 장부의 사유별 내역(`ledger.byReason`)은 과거 순유입의 사유를 되살릴 수 없으므로 비워 둔다
 * (그 방의 `moneyReport().breakdownBalanced`만 false가 되고, 보존 불변식은 그대로 성립한다).
 */
function migrateV1ToV2(raw) {
  return {
    ...raw,
    schemaVersion: 2,
    options: {
      roundLimit: raw.options?.roundLimit ?? null,
      finance: { ...DEFAULT_FINANCE_OPTIONS },
    },
  };
}

/**
 * 저장된 방 스냅샷을 승급 → 검증 → Room으로 복원한다.
 * @param {unknown} snapshot
 * @param {import('../domain/shared/interfaces.js').RandomSource} random
 */
export function deserializeRoom(snapshot, random) {
  const migrated = migrateRoomSnapshot(snapshot);
  validateRoomSnapshot(migrated);
  return Room.restore(migrated, random);
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

/**
 * 방 스냅샷 스키마 검증(화이트리스트 방식).
 * **승급이 끝난 스냅샷**을 받는다. `schemaVersion`은 없거나(구버전 검증) 현재 버전이어야 한다.
 */
export function validateRoomSnapshot(snapshot) {
  assert(isPlainObject(snapshot), '방 스냅샷이 객체가 아닙니다');
  assert(
    snapshot.schemaVersion === undefined || snapshot.schemaVersion === ROOM_SCHEMA_VERSION,
    `승급되지 않은 스키마 버전: ${describe(snapshot.schemaVersion)}`,
  );
  assert(isValidRoomCode(snapshot.code), `방 코드 형식 오류: ${describe(snapshot.code)}`);
  assert(Object.values(ROOM_STATUS).includes(snapshot.status), `방 상태 오류: ${describe(snapshot.status)}`);
  assert(Array.isArray(snapshot.seats), '좌석 목록이 배열이 아닙니다');
  assert(snapshot.seats.length <= MAX_SEATS, `좌석 수 초과: ${snapshot.seats.length}`);
  for (const seat of snapshot.seats) {
    assert(isPlainObject(seat), '좌석이 객체가 아닙니다');
    assert(isNonEmptyString(seat.id), `좌석 id 오류: ${describe(seat.id)}`);
    assert(isNonEmptyString(seat.name), `좌석 이름 오류: ${describe(seat.name)}`);
    assert(Object.values(SEAT_KINDS).includes(seat.kind), `좌석 종류 오류: ${describe(seat.kind)}`);
    assert(isNonEmptyString(seat.token), '좌석 토큰이 없습니다');
    assert(typeof seat.autopilot === 'boolean', '좌석 autopilot 값 오류');
  }
  if (snapshot.hostSeatId !== null) {
    assert(
      snapshot.seats.some((seat) => seat.id === snapshot.hostSeatId),
      `호스트 좌석이 목록에 없습니다: ${describe(snapshot.hostSeatId)}`,
    );
  }
  validateOptionsSnapshot(snapshot.options);
  assert(isFiniteInteger(snapshot.createdAt), '생성 시각 오류');
  assert(isFiniteInteger(snapshot.updatedAt), '수정 시각 오류');

  if (snapshot.status === ROOM_STATUS.LOBBY) {
    assert(snapshot.game === null || snapshot.game === undefined, '대기실에는 게임이 없어야 합니다');
    return;
  }
  validateGameSnapshot(snapshot.game, snapshot.seats);
}

/**
 * 방 옵션 검증.
 * `finance`는 **없을 수도 있다** — schemaVersion 1 시절 저장된 방에는 없고,
 * 마이그레이션이 기본값으로 채운다. 있으면 키와 값이 모두 화이트리스트여야 한다.
 */
function validateOptionsSnapshot(options) {
  assert(isPlainObject(options), '방 옵션이 객체가 아닙니다');
  assert(
    options.roundLimit === null || isFiniteInteger(options.roundLimit),
    `라운드 제한 오류: ${describe(options.roundLimit)}`,
  );
  if (options.finance === undefined || options.finance === null) {
    return;
  }
  assert(isPlainObject(options.finance), '금융 옵션이 객체가 아닙니다');
  for (const key of Object.keys(options.finance)) {
    assert(FINANCE_OPTION_KEYS.includes(key), `알 수 없는 금융 옵션: ${describe(key)}`);
  }
  for (const key of FINANCE_OPTION_KEYS) {
    const value = options.finance[key];
    assert(
      value === undefined || ALLOWED_FINANCE_OPTIONS[key].includes(value),
      `금융 옵션 값 오류: ${describe(key)}=${describe(value)}`,
    );
  }
}

/**
 * 게임 서브시스템별 검증기.
 *
 * 앞으로 붙는 서브시스템(market / finance / derivatives / report)은 **이 목록에 한 줄**을
 * 추가하고 자기 검증 함수만 쓰면 된다. `validateGameSnapshot`은 더 이상 자라지 않는다.
 * 순서는 진단 메시지의 우선순위이기도 하므로 함부로 바꾸지 않는다.
 */
const GAME_SUBSYSTEM_VALIDATORS = Object.freeze([
  { name: 'players', validate: (game, context) => validatePlayersSnapshot(game.players, context) },
  { name: 'board', validate: (game, context) => validateBoardSnapshot(game.board, context) },
  { name: 'casino', validate: (game) => validateCasinoSnapshot(game.casino) },
  { name: 'ledger', validate: (game) => validateLedgerSnapshot(game.ledger) },
  { name: 'economy', validate: (game) => validateEconomySnapshot(game) },
  { name: 'deck', validate: (game) => validateDeckSnapshot(game.deck) },
  { name: 'turn', validate: (game, context) => validateTurnSnapshot(game, context.seatIds) },
]);

function validateGameSnapshot(game, seats) {
  validateGameCore(game);
  const context = { seatIds: new Set(seats.map((seat) => seat.id)) };
  for (const validator of GAME_SUBSYSTEM_VALIDATORS) {
    validator.validate(game, context);
  }
}

/** 상태기계 본체(페이즈·버전·라운드·턴 인덱스). 서브시스템 검증의 전제다. */
function validateGameCore(game) {
  assert(isPlainObject(game), '게임 스냅샷이 객체가 아닙니다');
  assert(ALL_PHASES.includes(game.phase), `게임 페이즈 오류: ${describe(game.phase)}`);
  assert(isFiniteInteger(game.version) && game.version >= 0, '게임 version 오류');
  assert(isFiniteInteger(game.round) && game.round >= 1, '게임 round 오류');
  assert(Array.isArray(game.players) && game.players.length >= 2, '게임 플레이어 목록 오류');
  assert(
    isFiniteInteger(game.turnIndex) && game.turnIndex >= 0 && game.turnIndex < game.players.length,
    `턴 인덱스 오류: ${describe(game.turnIndex)}`,
  );
}

function validatePlayersSnapshot(players, { seatIds }) {
  for (const player of players) {
    assert(isPlainObject(player), '플레이어가 객체가 아닙니다');
    assert(seatIds.has(player.id), `좌석에 없는 플레이어입니다: ${describe(player.id)}`);
    assert(isMoney(player.cash) && player.cash >= 0, `현금 오류: ${describe(player.cash)}`);
    assert(isBoardIndex(player.position), `위치 오류: ${describe(player.position)}`);
    assert(typeof player.eliminated === 'boolean', 'eliminated 값 오류');
    assert(isMoney(player.loanDebt) && player.loanDebt >= 0, '대출 채무 오류');
    // 바퀴 수는 규칙 변경 뒤에 생긴 필드다. 없으면 1바퀴로 복원하므로 있을 때만 검증한다.
    assert(
      player.lap === undefined || (isFiniteInteger(player.lap) && player.lap >= FIRST_LAP),
      `바퀴 수 오류: ${describe(player.lap)}`,
    );
  }
}

function validateBoardSnapshot(board, { seatIds }) {
  assert(Array.isArray(board), '보드 스냅샷이 배열이 아닙니다');
  for (const city of board) {
    assert(isPlainObject(city), '보드 칸이 객체가 아닙니다');
    assert(isBoardIndex(city.index), `칸 번호 오류: ${describe(city.index)}`);
    assert(city.ownerId === null || seatIds.has(city.ownerId), `칸 소유자 오류: ${describe(city.ownerId)}`);
    assert(Array.isArray(city.buildings), '건물 목록 오류');
    assert(typeof city.landmark === 'boolean', '관광명소 값 오류');
  }
}

function validateCasinoSnapshot(casino) {
  assert(
    isPlainObject(casino) && isMoney(casino.jackpot) && casino.jackpot >= 0,
    `잭팟 오류: ${describe(casino?.jackpot)}`,
  );
}

/** 돈의 보존 불변식 기준값. */
function validateEconomySnapshot(game) {
  assert(
    game.initialTotal === undefined || (isMoney(game.initialTotal) && game.initialTotal >= 0),
    `초기 총액 오류: ${describe(game.initialTotal)}`,
  );
}

function validateDeckSnapshot(deck) {
  assert(isPlainObject(deck) && Array.isArray(deck.drawPile), '티켓 덱 오류');
}

/**
 * 은행 장부 검증.
 * 사유별 내역(`byReason`)은 **없을 수도 있다** — schemaVersion 1 시절 저장된 방에는 없다.
 * 있으면 사유가 화이트리스트에 있고 값이 안전 정수여야 한다.
 */
function validateLedgerSnapshot(ledger) {
  assert(isPlainObject(ledger), '은행 장부 오류');
  for (const field of ['fromBank', 'toBank']) {
    assert(
      isMoney(ledger[field]) && ledger[field] >= 0,
      `장부 ${field} 오류: ${describe(ledger[field])}`,
    );
  }
  if (ledger.byReason === undefined || ledger.byReason === null) {
    return;
  }
  assert(isPlainObject(ledger.byReason), '장부 사유별 내역이 객체가 아닙니다');
  const reasons = Object.values(MONEY_REASONS);
  for (const [reason, net] of Object.entries(ledger.byReason)) {
    assert(reasons.includes(reason), `장부 사유 오류: ${describe(reason)}`);
    assert(isMoney(net), `장부 사유(${describe(reason)}) 순액 오류: ${describe(net)}`);
  }
}

/** 0~39 칸 번호. */
const isBoardIndex = (value) => isFiniteInteger(value) && value >= 0 && value < BOARD_SIZE;
/**
 * 건설·인수 대상이 될 수 있는 칸(도시/휴양지)인지.
 *
 * 범위만 검사하면 `buildIndex: 0`(출발 칸) 같은 스냅샷이 **통과해 격리되지 않고** 복원되는데,
 * 그 방은 `pendingDecision`이 `board.cityAt(0)`에서 매번 터져 조회·SSE·자동 진행이 영구히
 * 실패한다. 손상 파일은 열리기 전에 격리돼야 한다.
 */
const isOwnableBoardIndex = (value) =>
  isBoardIndex(value) && OWNABLE_KINDS.includes(BOARD_SPACES[value].kind);
const isNullOrOwnableIndex = (value) =>
  value === null || value === undefined || isOwnableBoardIndex(value);

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
  assert(typeof turn.rollWasDouble === 'boolean', `turn.rollWasDouble 오류: ${describe(turn.rollWasDouble)}`);
  assert(
    isFiniteInteger(turn.casinoRoundsLeft) &&
      turn.casinoRoundsLeft >= 0 &&
      turn.casinoRoundsLeft <= Casino.MAX_ROUNDS_PER_VISIT,
    `turn.casinoRoundsLeft 오류: ${describe(turn.casinoRoundsLeft)}`,
  );
  assert(isNullOrOwnableIndex(turn.buildIndex), `turn.buildIndex 오류: ${describe(turn.buildIndex)}`);
  assert(isNullOrOwnableIndex(turn.acquireIndex), `turn.acquireIndex 오류: ${describe(turn.acquireIndex)}`);
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
      isMoney(item.amount) && item.amount >= 0,
      `turn.debt 금액 오류: ${describe(item.amount)}`,
    );
    assert(Object.values(SINKS).includes(item.sink), `turn.debt sink 오류: ${describe(item.sink)}`);
    assert(
      item.toPlayerId === null || item.toPlayerId === undefined || seatIds.has(item.toPlayerId),
      `turn.debt 채권자 오류: ${describe(item.toPlayerId)}`,
    );
  }
  assert(
    Object.values(MONEY_REASONS).includes(debt.reason),
    `turn.debt reason 오류: ${describe(debt.reason)}`,
  );
  assert(isPlainObject(debt.event), 'turn.debt.event가 객체가 아닙니다');
  assert(
    Object.values(EVENT_TYPES).includes(debt.event.type),
    `turn.debt.event 종류 오류: ${describe(debt.event.type)}`,
  );
  assert(isPlainObject(debt.event.payload), 'turn.debt.event.payload가 객체가 아닙니다');
  assert(isPlainObject(debt.next), 'turn.debt.next가 객체가 아닙니다');
  assert(
    Object.values(CONTINUATIONS).includes(debt.next.kind),
    `turn.debt.next.kind 오류: ${describe(debt.next.kind)}`,
  );
  if (debt.next.kind === CONTINUATIONS.ACQUIRE) {
    assert(isOwnableBoardIndex(debt.next.cityIndex), `turn.debt.next.cityIndex 오류: ${describe(debt.next.cityIndex)}`);
  }
}

/** 페이즈가 요구하는 turn 필드가 실제로 채워져 있는지. */
function assertPhaseTurnCoherence(phase, turn) {
  const hasDebt = turn.debt !== null && turn.debt !== undefined;
  if (phase === PHASES.AWAIT_LIQUIDATION) {
    assert(hasDebt, 'AWAIT_LIQUIDATION 페이즈인데 채무가 없습니다');
  } else {
    assert(!hasDebt, `채무가 있는데 페이즈가 ${describe(phase)}입니다`);
  }
  if (phase === PHASES.AWAIT_BUILD) {
    assert(isOwnableBoardIndex(turn.buildIndex), 'AWAIT_BUILD 페이즈인데 건설 칸이 없습니다');
  }
  if (phase === PHASES.AWAIT_ACQUIRE) {
    assert(isOwnableBoardIndex(turn.acquireIndex), 'AWAIT_ACQUIRE 페이즈인데 인수 칸이 없습니다');
  }
  if (phase === PHASES.AWAIT_CASINO) {
    assert(
      isFiniteInteger(turn.casinoRoundsLeft) && turn.casinoRoundsLeft > 0,
      'AWAIT_CASINO 페이즈인데 남은 판이 없습니다',
    );
  }
}
