import { parseRoomJson, serializeRoom } from './RoomSerializer.js';

/**
 * 테스트용 저장소. 파일 저장소와 같은 직렬화 경로를 타도록 JSON 문자열로 보관한다.
 * 해석할 수 없는 항목은 파일 저장소의 격리와 같은 효과가 나도록 건너뛰고 버린다
 * (목록 조회 하나가 저장소 전체를 무너뜨리지 않게 한다).
 */
export class InMemoryRoomRepository {
  /** @type {Map<string, string>} */
  #rooms = new Map();
  #random;
  #logger;

  constructor({ random, logger } = {}) {
    this.#random = random;
    this.#logger = logger ?? console;
  }

  async save(room) {
    this.#rooms.set(room.code, serializeRoom(room));
  }

  async findByCode(code) {
    const text = this.#rooms.get(code);
    return text === undefined ? null : this.#parse(code, text);
  }

  /** 로비 목록용 요약(파일 저장소의 색인과 같은 역할). */
  async findAllSummaries() {
    return (await this.findAll()).map((room) => room.toSummary());
  }

  async countRooms() {
    return this.#rooms.size;
  }

  async findAll() {
    const rooms = [];
    for (const [code, text] of [...this.#rooms.entries()]) {
      const room = this.#parse(code, text);
      if (room) {
        rooms.push(room);
      }
    }
    return rooms;
  }

  async delete(code) {
    this.#rooms.delete(code);
  }

  get size() {
    return this.#rooms.size;
  }

  /**
   * 테스트 전용: 손상된 저장 내용을 그대로 심는다.
   * 파일 저장소가 격리로 처리하는 상황을 인메모리에서도 재현하기 위한 seam이다.
   */
  seedRaw(code, text) {
    this.#rooms.set(code, text);
  }

  /** 해석 실패한 항목은 로그를 남기고 저장소에서 제거한다(유령 방 방지). */
  #parse(code, text) {
    try {
      return parseRoomJson(text, this.#random);
    } catch (error) {
      this.#logger.error(`[InMemoryRoomRepository] 방 복원 실패 ${code}: ${error.message}`);
      this.#rooms.delete(code);
      return null;
    }
  }
}
