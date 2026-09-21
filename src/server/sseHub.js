import { AppError } from '../application/errors.js';

/** 하트비트 주기(프록시/모바일 절전 대비). */
const HEARTBEAT_MS = 20_000;
/** 한 방이 받는 최대 구독자 수(핫시트 기기를 넉넉히 감당하는 값). */
export const MAX_SUBSCRIBERS_PER_ROOM = 16;
/** 서버 전체 최대 구독자 수. 열린 스트림은 메모리와 소켓을 계속 점유한다. */
export const MAX_SUBSCRIBERS_TOTAL = 128;

/**
 * 방별 SSE 구독자 관리.
 * - 연결 시 현재 스냅샷을 즉시 보내고, 이후 방/게임 변경을 방송한다.
 * - 좌석 온라인 여부는 검증된 presence 좌석 목록으로 계산한다(토큰은 절대 밖으로 나가지 않는다).
 */
export class SseHub {
  /** @type {Map<string, Set<{response: import('node:http').ServerResponse, seatIds: string[]}>>} */
  #rooms = new Map();
  #logger;
  #heartbeat;
  #maxPerRoom;
  #maxTotal;

  constructor({
    logger,
    heartbeatMs = HEARTBEAT_MS,
    maxPerRoom = MAX_SUBSCRIBERS_PER_ROOM,
    maxTotal = MAX_SUBSCRIBERS_TOTAL,
  } = {}) {
    this.#logger = logger ?? console;
    this.#maxPerRoom = maxPerRoom;
    this.#maxTotal = maxTotal;
    this.#heartbeat = setInterval(() => this.#sendHeartbeat(), heartbeatMs);
    if (typeof this.#heartbeat.unref === 'function') {
      this.#heartbeat.unref();
    }
  }

  /** 지금 열려 있는 전체 구독자 수. */
  get totalSubscribers() {
    let total = 0;
    for (const clients of this.#rooms.values()) {
      total += clients.size;
    }
    return total;
  }

  /**
   * 구독 여유가 있는지 확인한다(스트림 헤더를 쓰기 **전에** 호출해야 한다).
   * 상한을 넘으면 이벤트 스트림 대신 규격 JSON 에러로 응답해야 하므로 예외를 던진다.
   */
  assertCapacity(code) {
    const inRoom = this.subscriberCount(code);
    if (inRoom >= this.#maxPerRoom) {
      throw new AppError('ERR016', `방 ${code}의 구독자 상한(${this.#maxPerRoom}) 초과`);
    }
    if (this.totalSubscribers >= this.#maxTotal) {
      throw new AppError('ERR016', `서버 전체 구독자 상한(${this.#maxTotal}) 초과`);
    }
  }

  /**
   * 구독자를 등록한다.
   * @param {string} code
   * @param {import('node:http').ServerResponse} response
   * @param {{seatIds?: string[], onClose?: Function}} options 검증이 끝난 좌석 id 목록
   */
  subscribe(code, response, { seatIds = [], onClose } = {}) {
    const client = { response, seatIds };
    const clients = this.#rooms.get(code) ?? new Set();
    clients.add(client);
    this.#rooms.set(code, clients);

    const cleanup = () => {
      clients.delete(client);
      if (clients.size === 0) {
        this.#rooms.delete(code);
      }
      onClose?.();
    };
    response.on('close', cleanup);
    response.on('error', cleanup);
    return client;
  }

  /** 검증된 presence 기준 온라인 좌석 목록. */
  onlineSeatIds(code) {
    const clients = this.#rooms.get(code);
    if (!clients) {
      return [];
    }
    const seatIds = new Set();
    for (const client of clients) {
      for (const seatId of client.seatIds) {
        seatIds.add(seatId);
      }
    }
    return [...seatIds];
  }

  subscriberCount(code) {
    return this.#rooms.get(code)?.size ?? 0;
  }

  publishRoom(code, payload) {
    this.#broadcast(code, 'room', payload);
  }

  publishGame(code, payload) {
    this.#broadcast(code, 'game', payload);
  }

  /** 특정 응답 하나에만 보낸다(연결 직후 스냅샷). */
  send(response, event, payload) {
    this.#write(response, `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  /** 방이 사라질 때 구독자 연결을 정리한다. */
  closeRoom(code) {
    const clients = this.#rooms.get(code);
    if (!clients) {
      return;
    }
    for (const client of clients) {
      client.response.end();
    }
    this.#rooms.delete(code);
  }

  /** 서버 종료용. */
  closeAll() {
    clearInterval(this.#heartbeat);
    for (const code of [...this.#rooms.keys()]) {
      this.closeRoom(code);
    }
  }

  #broadcast(code, event, payload) {
    const clients = this.#rooms.get(code);
    if (!clients || clients.size === 0) {
      return;
    }
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) {
      this.#write(client.response, frame);
    }
  }

  #sendHeartbeat() {
    for (const clients of this.#rooms.values()) {
      for (const client of clients) {
        this.#write(client.response, ': ping\n\n');
      }
    }
  }

  #write(response, frame) {
    try {
      response.write(frame);
    } catch (error) {
      this.#logger.error(`[SseHub] 전송 실패: ${error.message}`);
    }
  }
}
