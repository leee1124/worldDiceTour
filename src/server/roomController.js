import { SECURITY_HEADERS } from './securityHeaders.js';
import {
  extractToken,
  parseCommandBody,
  parseCreateRoomBody,
  parseHostActionBody,
  parseJoinSeatBody,
  parsePresenceParam,
  requireSeatId,
} from './validation.js';

/** presence 방송을 모으는 시간(ms). */
const PRESENCE_DEBOUNCE_MS = 200;

/**
 * Controller 레이어.
 * 입력을 화이트리스트로 검증하고 Service를 호출한 뒤 DTO만 응답한다.
 * 도메인 규칙 판단은 하지 않는다.
 */
export class RoomController {
  #roomService;
  #gameService;
  #sseHub;
  #networkInfo;
  #logger;
  #presenceDebounceMs;
  #timers;
  /** @type {Map<string, any>} */
  #presenceTimers = new Map();

  constructor({
    roomService,
    gameService,
    sseHub,
    networkInfo,
    logger,
    presenceDebounceMs = PRESENCE_DEBOUNCE_MS,
    timers = { setTimeout, clearTimeout },
  }) {
    this.#roomService = roomService;
    this.#gameService = gameService;
    this.#sseHub = sseHub;
    this.#networkInfo = networkInfo;
    this.#logger = logger ?? console;
    this.#presenceDebounceMs = presenceDebounceMs;
    this.#timers = timers;
  }

  serverInfo() {
    return { status: 200, body: this.#networkInfo() };
  }

  async listRooms() {
    return { status: 200, body: { rooms: await this.#roomService.listRooms() } };
  }

  async createRoom(body) {
    const { hostName } = parseCreateRoomBody(body);
    const result = await this.#roomService.createRoom({ hostName });
    return { status: 201, body: result };
  }

  async getRoom(code) {
    const state = await this.#roomService.getRoomState({ code });
    return { status: 200, body: state };
  }

  async joinSeat(code, body) {
    const { name } = parseJoinSeatBody(body);
    const result = await this.#roomService.joinSeat({ code, name });
    return { status: 201, body: result };
  }

  async leaveSeat(code, seatId, headers) {
    const token = extractToken(headers);
    const room = await this.#roomService.leaveSeat({
      code,
      seatId: requireSeatId(seatId),
      token,
    });
    return { status: 200, body: { room } };
  }

  async hostAction(code, body, headers) {
    const token = extractToken(headers);
    const action = parseHostActionBody(body);
    const room = await this.#roomService.hostAction({ code, token, action });
    return { status: 200, body: { room } };
  }

  async command(code, body, headers) {
    const token = extractToken(headers);
    const { type, seatId, payload } = parseCommandBody(body);
    const result = await this.#gameService.execute({ code, token, seatId, type, payload });
    return { status: 200, body: result };
  }

  /**
   * SSE 구독. 연결 즉시 현재 스냅샷을 보내고, presence 파라미터로 온라인 좌석을 표시한다.
   * EventSource는 헤더를 보낼 수 없으므로 쿼리로 받되 서버에서 토큰을 검증한다.
   */
  async subscribe(code, query, request, response) {
    // 방이 없으면 여기서 ERR004로 끝난다(스트림을 열지 않는다).
    const seatIds = await this.#roomService.verifyPresence({
      code,
      pairs: parsePresenceParam(query.get('presence')),
    });
    // 상한 검사는 스트림 헤더를 쓰기 전에 — 초과 시 규격 JSON 에러로 응답해야 한다.
    this.#sseHub.assertCapacity(code);

    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(': connected\n\n');

    this.#sseHub.subscribe(code, response, {
      seatIds,
      onClose: () => this.#schedulePresenceBroadcast(code),
    });

    const state = await this.#roomService.getRoomState({ code });
    this.#sseHub.send(response, 'room', state.room);
    if (state.game) {
      this.#sseHub.send(response, 'game', { view: state.game, events: [] });
    }
    if (seatIds.length > 0) {
      this.#schedulePresenceBroadcast(code);
    }
    request.on('close', () => {
      response.end();
    });
  }

  /**
   * presence 방송을 모아서 한 번만 보낸다.
   * 핫시트 기기가 여러 좌석으로 붙거나 새로고침으로 여러 스트림이 동시에 끊길 때,
   * 방 전체 스냅샷을 그만큼 반복 방송하지 않도록 방마다 디바운스한다.
   */
  #schedulePresenceBroadcast(code) {
    const existing = this.#presenceTimers.get(code);
    if (existing !== undefined) {
      this.#timers.clearTimeout(existing);
    }
    const handle = this.#timers.setTimeout(() => {
      this.#presenceTimers.delete(code);
      void this.#publishPresence(code);
    }, this.#presenceDebounceMs);
    if (typeof handle?.unref === 'function') {
      handle.unref();
    }
    this.#presenceTimers.set(code, handle);
  }

  async #publishPresence(code) {
    try {
      const state = await this.#roomService.getRoomState({ code });
      this.#sseHub.publishRoom(code, state.room);
    } catch (error) {
      // 방이 이미 사라졌을 수 있다. 브로드캐스트는 포기하되 이유는 남긴다.
      this.#logger.error(`[RoomController] presence 방송 실패 ${code}: ${error.message}`);
    }
  }
}
