/**
 * 서버 API 래퍼(fetch + EventSource). docs/API.md의 계약만 다룬다.
 *
 * - 에러는 `ApiError`로 통일한다. 화면에는 서버가 준 `message`만 보여주고,
 *   자세한 내용은 `console.error`로만 남긴다.
 * - 좌석 토큰은 `Authorization: Bearer` 헤더로만 나가고 로그에 남지 않는다.
 */

/** 서버가 준 `{code, message}` 규격 에러. */
export class ApiError extends Error {
  constructor(code, message, { status = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** 네트워크 자체가 끊겼을 때(서버 응답이 없으므로 클라이언트 문구를 쓴다). */
const NETWORK_ERROR_CODE = 'ERR_NETWORK';
const NETWORK_ERROR_MESSAGE = '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.';

const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json; charset=utf-8' });

function authHeaders(token) {
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** 응답 본문을 JSON으로 읽는다. 본문이 없거나 깨졌으면 null. */
async function readJson(response) {
  try {
    const text = await response.text();
    return text.length === 0 ? null : JSON.parse(text);
  } catch (error) {
    console.error('[api] 응답 본문 해석 실패', response.status, error);
    return null;
  }
}

async function request(method, path, { body, token } = {}) {
  let response;
  // 서버는 본문이 있는 POST/DELETE에서 정확한 JSON content-type만 받아들인다.
  const needsJsonType = method === 'POST' || method === 'DELETE';
  try {
    response = await fetch(path, {
      method,
      headers: { ...(needsJsonType ? JSON_HEADERS : {}), ...authHeaders(token) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    console.error(`[api] ${method} ${path} 전송 실패`, error);
    throw new ApiError(NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const code = typeof payload?.code === 'string' ? payload.code : 'ERR010';
    const message = typeof payload?.message === 'string' ? payload.message : '요청을 처리할 수 없습니다.';
    console.error(`[api] ${method} ${path} → ${response.status} ${code}`);
    throw new ApiError(code, message, { status: response.status });
  }
  return payload ?? {};
}

/* ── REST ────────────────────────────────────────────────────── */

/** LAN 접속 주소 안내용. */
export function getServerInfo() {
  return request('GET', '/api/server-info');
}

/** 참가 가능한 방 목록. */
export function listRooms() {
  return request('GET', '/api/rooms');
}

/** 방 만들기 → `{room, seatId, seatToken}` */
export function createRoom(hostName) {
  return request('POST', '/api/rooms', { body: { hostName } });
}

/** 방 + (진행 중이면) 게임 스냅샷. */
export function getRoom(code) {
  return request('GET', `/api/rooms/${encodeURIComponent(code)}`);
}

/** 좌석 참가 → `{room, seatId, seatToken}` */
export function joinSeat(code, name) {
  return request('POST', `/api/rooms/${encodeURIComponent(code)}/seats`, { body: { name } });
}

/** 본인 퇴장 또는 호스트 강퇴. */
export function leaveSeat(code, seatId, token) {
  return request('DELETE', `/api/rooms/${encodeURIComponent(code)}/seats/${encodeURIComponent(seatId)}`, {
    token,
  });
}

/** 호스트 전용 동작(ADD_COMPUTER / SET_OPTIONS / SET_AUTOPILOT / START). */
export function hostAction(code, action, token) {
  return request('POST', `/api/rooms/${encodeURIComponent(code)}/host-actions`, { body: action, token });
}

/** 게임 커맨드 → `{view, events}` */
export function sendCommand(code, command, token) {
  return request('POST', `/api/rooms/${encodeURIComponent(code)}/commands`, { body: command, token });
}

/* ── SSE ─────────────────────────────────────────────────────── */

/**
 * 방 이벤트 스트림을 연다. `EventSource`는 끊기면 스스로 재연결한다.
 * @param {{code: string, presence?: string, onRoom: Function, onGame: Function,
 *          onOpen?: Function, onDisconnected?: Function}} options
 * @returns {{close: () => void, get readyState: number}}
 */
export function openRoomStream({ code, presence = '', onRoom, onGame, onOpen, onDisconnected }) {
  const query = presence ? `?presence=${encodeURIComponent(presence)}` : '';
  const source = new EventSource(`/api/rooms/${encodeURIComponent(code)}/events${query}`);

  const parse = (event, handler, label) => {
    try {
      handler(JSON.parse(event.data));
    } catch (error) {
      console.error(`[api] ${label} 이벤트 해석 실패`, error);
    }
  };

  source.addEventListener('room', (event) => parse(event, onRoom, 'room'));
  source.addEventListener('game', (event) => parse(event, onGame, 'game'));
  source.addEventListener('open', () => onOpen?.());
  source.addEventListener('error', () => {
    // EventSource는 CONNECTING 상태로 자동 재연결한다. CLOSED면 되살아나지 않는다.
    console.error('[api] SSE 연결 오류 (readyState:', source.readyState, ')');
    onDisconnected?.(source.readyState === EventSource.CLOSED);
  });

  return {
    close() {
      source.close();
    },
    get readyState() {
      return source.readyState;
    },
  };
}
