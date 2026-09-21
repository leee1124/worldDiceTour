import { parseRoomJson, serializeRoom } from './RoomSerializer.js';

/**
 * 테스트용 저장소. 파일 저장소와 같은 직렬화 경로를 타도록 JSON 문자열로 보관한다.
 */
export class InMemoryRoomRepository {
  /** @type {Map<string, string>} */
  #rooms = new Map();
  #random;

  constructor({ random } = {}) {
    this.#random = random;
  }

  async save(room) {
    this.#rooms.set(room.code, serializeRoom(room));
  }

  async findByCode(code) {
    const text = this.#rooms.get(code);
    return text ? parseRoomJson(text, this.#random) : null;
  }

  async findAll() {
    return [...this.#rooms.values()].map((text) => parseRoomJson(text, this.#random));
  }

  async delete(code) {
    this.#rooms.delete(code);
  }

  get size() {
    return this.#rooms.size;
  }
}
