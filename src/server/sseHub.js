/** 하트비트 주기(프록시/모바일 절전 대비). */
const HEARTBEAT_MS = 20_000;

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

  constructor({ logger, heartbeatMs = HEARTBEAT_MS } = {}) {
    this.#logger = logger ?? console;
    this.#heartbeat = setInterval(() => this.#sendHeartbeat(), heartbeatMs);
    if (typeof this.#heartbeat.unref === 'function') {
      this.#heartbeat.unref();
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
