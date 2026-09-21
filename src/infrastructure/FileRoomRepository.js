import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isValidRoomCode } from '../domain/room/RoomCode.js';
import { RoomSchemaError, parseRoomJson, serializeRoom } from './RoomSerializer.js';

/** 해석할 수 없는 저장 파일에 붙이는 꼬리표. 이 확장자는 조회/목록 경로가 모두 무시한다. */
const CORRUPT_SUFFIX = '.corrupt';

/**
 * 방 상태를 `data/rooms/<CODE>.json`에 저장한다(서버 재시작 후 이어하기).
 * 이 디렉터리는 정적 서빙 대상이 아니다(정적 루트는 public/ 뿐) — 파일에 좌석 토큰이 들어 있다.
 *
 * 로비 목록은 **메모리 요약 색인**으로 답한다. 색인은 `init()`에서 한 번 세우고 저장/삭제마다
 * 갱신하므로, 목록 요청마다 모든 방의 게임을 다시 복원하는 일이 없다.
 * (단일 서버 전제. 다른 프로세스가 같은 디렉터리를 고치면 색인이 어긋난다.)
 */
export class FileRoomRepository {
  #directory;
  #random;
  #logger;
  /** @type {Map<string, object>} code → RoomSummary */
  #summaries = new Map();
  /** 디렉터리 생성은 한 번만(저장마다 mkdir 시스템 호출을 하지 않는다). */
  #ready = null;

  constructor({ directory, random, logger }) {
    this.#directory = directory;
    this.#random = random;
    this.#logger = logger ?? console;
  }

  /** 저장 디렉터리를 만들고 요약 색인을 다시 세운다. */
  async init() {
    await this.#ensureDirectory();
    await this.#rebuildIndex();
  }

  #ensureDirectory() {
    this.#ready ??= mkdir(this.#directory, { recursive: true }).catch((error) => {
      // 다음 호출에서 다시 시도할 수 있게 캐시를 비운다.
      this.#ready = null;
      throw error;
    });
    return this.#ready;
  }

  #pathOf(code) {
    return path.join(this.#directory, `${code}.json`);
  }

  async save(room) {
    await this.#ensureDirectory();
    const target = this.#pathOf(room.code);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, serializeRoom(room), 'utf8');
    await rename(temporary, target);
    this.#summaries.set(room.code, room.toSummary());
  }

  async findByCode(code) {
    if (!isValidRoomCode(code)) {
      return null;
    }
    let text;
    try {
      text = await readFile(this.#pathOf(code), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.#logger.error(`[FileRoomRepository] 방 파일 읽기 실패 ${code}: ${error.message}`);
      } else {
        this.#summaries.delete(code);
      }
      return null;
    }
    return this.#parse(code, text);
  }

  /**
   * 해석할 수 없는 파일을 `<CODE>.json.corrupt`로 옮긴다.
   * 그대로 두면 같은 코드의 방을 만들 수도, 고칠 수도 없는 "영구 유령 방"이 되므로
   * 목록/조회 경로에서 비켜 놓고 원본은 진단용으로 남긴다.
   */
  async #quarantine(code, reason) {
    const source = this.#pathOf(code);
    const target = `${source}${CORRUPT_SUFFIX}`;
    try {
      await rename(source, target);
      this.#logger.error(
        `[FileRoomRepository] 손상된 저장 파일을 격리했습니다 ${code} → ${path.basename(target)}: ${reason}`,
      );
    } catch (error) {
      this.#logger.error(`[FileRoomRepository] 손상 파일 격리 실패 ${code}: ${error.message}`);
    }
  }

  async findAll() {
    const rooms = [];
    for (const code of await this.#listCodes()) {
      const room = await this.findByCode(code);
      if (room) {
        rooms.push(room);
      }
    }
    return rooms;
  }

  /** 로비 목록용 요약. 파일을 읽지 않고 메모리 색인만 본다. */
  async findAllSummaries() {
    return [...this.#summaries.values()];
  }

  /** 저장된 방 개수(색인 기준). */
  async countRooms() {
    return this.#summaries.size;
  }

  async delete(code) {
    if (!isValidRoomCode(code)) {
      return;
    }
    this.#summaries.delete(code);
    try {
      await unlink(this.#pathOf(code));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.#logger.error(`[FileRoomRepository] 방 파일 삭제 실패 ${code}: ${error.message}`);
      }
    }
  }

  async #listCodes() {
    await this.#ensureDirectory();
    let entries;
    try {
      entries = await readdir(this.#directory);
    } catch (error) {
      this.#logger.error(`[FileRoomRepository] 저장 디렉터리 조회 실패: ${error.message}`);
      return [];
    }
    return entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => entry.slice(0, -'.json'.length));
  }

  /** 시작 시 한 번: 파일을 모두 읽어 요약을 채운다(손상 파일은 격리된다). */
  async #rebuildIndex() {
    this.#summaries.clear();
    for (const code of await this.#listCodes()) {
      const room = await this.findByCode(code);
      if (room) {
        this.#summaries.set(room.code, room.toSummary());
      }
    }
  }

  /** 스키마가 깨진 파일은 격리하고(게임을 이어갈 수 없으므로) 로그를 남긴다. */
  async #parse(code, text) {
    try {
      const room = parseRoomJson(text, this.#random);
      this.#summaries.set(room.code, room.toSummary());
      return room;
    } catch (error) {
      const label = error instanceof RoomSchemaError ? '저장 파일 스키마 오류' : '방 복원 실패';
      this.#logger.error(`[FileRoomRepository] ${label} ${code}: ${error.message}`);
      this.#summaries.delete(code);
      await this.#quarantine(code, error.message);
      return null;
    }
  }
}
