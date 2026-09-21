import { AppError } from '../application/errors.js';
import {
  extractToken,
  parseCommandBody,
  parseCreateRoomBody,
  parseHostActionBody,
  parseJoinSeatBody,
  parsePresenceParam,
  requireSeatId,
} from './validation.js';

/**
 * Controller 레이어.
 * 입력을 화이트리스트로 검증하고 Service를 호출한 뒤 DTO만 응답한다.
 * 도메인 규칙 판단은 하지 않는다.
 */
export class RoomController {
  #roomService;
  #gameService;
  #sseHub;
  #authenticator;
  #repository;
  #networkInfo;
  #logger;

  constructor({ roomService, gameService, sseHub, authenticator, repository, networkInfo, logger }) {
    this.#roomService = roomService;
    this.#gameService = gameService;
    this.#sseHub = sseHub;
    this.#authenticator = authenticator;
    this.#repository = repository;
    this.#networkInfo = networkInfo;
    this.#logger = logger ?? console;
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
    const room = await this.#repository.findByCode(code);
    if (!room) {
      throw new AppError('ERR004', `방을 찾을 수 없습니다: ${code}`);
    }

    const seatIds = this.#verifyPresence(room, query.get('presence'));

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(': connected\n\n');

    this.#sseHub.subscribe(code, response, {
      seatIds,
      onClose: () => this.#publishPresence(code),
    });

    const state = await this.#roomService.getRoomState({ code });
    this.#sseHub.send(response, 'room', state.room);
    if (state.game) {
      this.#sseHub.send(response, 'game', { view: state.game, events: [] });
    }
    if (seatIds.length > 0) {
      this.#publishPresence(code);
    }
    request.on('close', () => {
      response.end();
    });
  }

  /** presence 쌍을 토큰까지 검증해 실제 좌석 id만 남긴다. */
  #verifyPresence(room, raw) {
    const verified = [];
    for (const { seatId, token } of parsePresenceParam(raw)) {
      const resolved = this.#authenticator.resolveSeatId(room, token);
      if (resolved && resolved === seatId) {
        verified.push(resolved);
      }
    }
    return verified;
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
