import { ALL_COMMAND_TYPES, COMMAND_TYPES } from '../domain/game/commands.js';
import { BUILDING_TYPES } from '../domain/game/City.js';
import { CASINO_GAMES, HIGH_LOW_SEVEN_CHOICES, ODD_EVEN_CHOICES } from '../domain/game/Casino.js';
import { BOARD_SIZE } from '../domain/game/data/board.js';
import { ALLOWED_ROUND_LIMITS } from '../domain/room/Room.js';
import { HOST_ACTIONS } from '../application/RoomService.js';
import { AppError } from '../application/errors.js';

/** 좌석/방 이름. */
export const NAME_PATTERN = /^[가-힣a-zA-Z0-9 ]{1,10}$/;
/** 좌석 식별자. */
export const SEAT_ID_PATTERN = /^seat-\d{1,3}$/;
/** 좌석 토큰(32바이트 hex). */
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

const BUILDING_LIST = Object.values(BUILDING_TYPES);
const CASINO_GAME_LIST = Object.values(CASINO_GAMES);

/** 오류 메시지에 실을 값의 최대 길이. */
const MAX_DETAIL_LENGTH = 120;

/**
 * 외부 입력을 **절대 예외 없이** 사람이 읽을 수 있는 짧은 문자열로 바꾼다.
 *
 * `${value}`나 `String(value)`는 공격자가 보낸 `{"toString": 1}` 같은 값에서
 * TypeError를 던진다. 그 예외가 검증 코드에서 새면 ERR001(400)이어야 할 요청이
 * ERR010(500)이 되므로, 오류 메시지를 만들 때는 반드시 이 함수를 쓴다.
 */
export function safeText(value) {
  if (value === null || value === undefined) {
    return String(value);
  }
  const type = typeof value;
  if (type === 'string') {
    return truncate(value);
  }
  if (type === 'number' || type === 'boolean' || type === 'bigint') {
    return truncate(String(value));
  }
  if (type === 'symbol' || type === 'function') {
    return `<${type}>`;
  }
  try {
    const json = JSON.stringify(value);
    return json === undefined ? `<${type}>` : truncate(json);
  } catch {
    // 순환 참조 등 JSON으로 만들 수 없는 값. 종류만 알린다.
    return `<${type}>`;
  }
}

function truncate(text) {
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

function invalid(detail) {
  return new AppError('ERR001', detail);
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export function requireName(value, field = 'name') {
  if (typeof value !== 'string' || !NAME_PATTERN.test(value) || value.trim().length === 0) {
    throw invalid(`${field} 형식 오류`);
  }
  return value;
}

export function requireSeatId(value, field = 'seatId') {
  if (typeof value !== 'string' || !SEAT_ID_PATTERN.test(value)) {
    throw invalid(`${field} 형식 오류`);
  }
  return value;
}

export function optionalSeatId(value) {
  return value === undefined || value === null ? undefined : requireSeatId(value);
}

/** Authorization 헤더에서 좌석 토큰을 꺼낸다. 형식이 틀리면 인증 실패로 본다. */
export function extractToken(headers) {
  const raw = headers.authorization ?? headers.Authorization;
  if (typeof raw !== 'string' || !raw.startsWith('Bearer ')) {
    throw new AppError('ERR002', '인증 헤더 없음');
  }
  const token = raw.slice('Bearer '.length).trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new AppError('ERR002', '토큰 형식 오류');
  }
  return token;
}

function requireInteger(value, { min, max, field }) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalid(`${field} 범위 오류: ${safeText(value)}`);
  }
  return value;
}

function requireBoardIndex(value, field) {
  return requireInteger(value, { min: 0, max: BOARD_SIZE - 1, field });
}

/** 건물 목록 화이트리스트(중복/개수 제한 포함). */
function requireBuildings(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > BUILDING_LIST.length) {
    throw invalid('buildings 형식 오류');
  }
  const seen = new Set();
  for (const item of value) {
    if (!BUILDING_LIST.includes(item) || seen.has(item)) {
      throw invalid(`buildings 값 오류: ${safeText(item)}`);
    }
    seen.add(item);
  }
  return [...value];
}

/** 방 생성/참가 본문. 알 수 없는 필드는 버린다. */
export function parseCreateRoomBody(body) {
  if (!isObject(body)) {
    throw invalid('본문이 객체가 아님');
  }
  return { hostName: requireName(body.hostName, 'hostName') };
}

export function parseJoinSeatBody(body) {
  if (!isObject(body)) {
    throw invalid('본문이 객체가 아님');
  }
  return { name: requireName(body.name) };
}

/** 호스트 동작 본문. */
export function parseHostActionBody(body) {
  if (!isObject(body)) {
    throw invalid('본문이 객체가 아님');
  }
  switch (body.type) {
    case HOST_ACTIONS.ADD_COMPUTER:
      return { type: HOST_ACTIONS.ADD_COMPUTER, name: requireName(body.name) };
    case HOST_ACTIONS.SET_OPTIONS: {
      const roundLimit = body.roundLimit ?? null;
      if (!ALLOWED_ROUND_LIMITS.includes(roundLimit)) {
        throw invalid(`roundLimit 값 오류: ${safeText(body.roundLimit)}`);
      }
      return { type: HOST_ACTIONS.SET_OPTIONS, roundLimit };
    }
    case HOST_ACTIONS.SET_AUTOPILOT:
      if (typeof body.enabled !== 'boolean') {
        throw invalid('enabled 값 오류');
      }
      return {
        type: HOST_ACTIONS.SET_AUTOPILOT,
        seatId: requireSeatId(body.seatId),
        enabled: body.enabled,
      };
    case HOST_ACTIONS.START:
      return { type: HOST_ACTIONS.START };
    default:
      throw invalid(`알 수 없는 호스트 동작: ${safeText(body.type)}`);
  }
}

/** 게임 커맨드 본문. 커맨드별 payload 화이트리스트. */
export function parseCommandBody(body) {
  if (!isObject(body)) {
    throw invalid('본문이 객체가 아님');
  }
  const { type } = body;
  if (!ALL_COMMAND_TYPES.includes(type)) {
    throw invalid(`알 수 없는 커맨드: ${safeText(type)}`);
  }
  const payload = isObject(body.payload) ? body.payload : {};
  return {
    type,
    seatId: optionalSeatId(body.seatId),
    payload: parseCommandPayload(type, payload),
  };
}

function parseCommandPayload(type, payload) {
  switch (type) {
    case COMMAND_TYPES.BUILD:
      return { buildings: requireBuildings(payload.buildings) };
    case COMMAND_TYPES.START_BUILD:
      return {
        cityIndex: requireBoardIndex(payload.cityIndex, 'cityIndex'),
        buildings: requireBuildings(payload.buildings),
      };
    case COMMAND_TYPES.SELL:
      return { cityIndex: requireBoardIndex(payload.cityIndex, 'cityIndex') };
    case COMMAND_TYPES.TRAVEL:
      return { destination: requireBoardIndex(payload.destination, 'destination') };
    case COMMAND_TYPES.CASINO_BET:
      return parseCasinoBet(payload);
    default:
      return {};
  }
}

function parseCasinoBet(payload) {
  if (!CASINO_GAME_LIST.includes(payload.game)) {
    throw invalid(`카지노 게임 값 오류: ${safeText(payload.game)}`);
  }
  const bet = requireInteger(payload.bet, { min: 10_000, max: 500_000, field: 'bet' });
  if (bet % 10_000 !== 0) {
    throw invalid(`bet 단위 오류: ${safeText(bet)}`);
  }
  let choice = null;
  if (payload.game === CASINO_GAMES.ODD_EVEN) {
    choice = requireChoice(payload.choice, ODD_EVEN_CHOICES);
  } else if (payload.game === CASINO_GAMES.HIGH_LOW_SEVEN) {
    choice = requireChoice(payload.choice, HIGH_LOW_SEVEN_CHOICES);
  }
  return { game: payload.game, bet, choice };
}

function requireChoice(value, allowed) {
  if (!allowed.includes(value)) {
    throw invalid(`선택값 오류: ${safeText(value)}`);
  }
  return value;
}

/**
 * SSE presence 파라미터: `seatId:token,seatId:token`.
 * 형식이 맞는 쌍만 남긴다(검증은 호출자가 토큰 인증으로 마무리).
 */
export function parsePresenceParam(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1_000) {
    return [];
  }
  return raw
    .split(',')
    .slice(0, 4)
    .map((pair) => {
      const [seatId, token] = pair.split(':');
      return { seatId, token };
    })
    .filter(({ seatId, token }) => SEAT_ID_PATTERN.test(seatId ?? '') && TOKEN_PATTERN.test(token ?? ''));
}
