import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isValidRoomCode } from '../domain/room/RoomCode.js';
import { RoomSchemaError, parseRoomJson, serializeRoom } from './RoomSerializer.js';

/**
 * 방 상태를 `data/rooms/<CODE>.json`에 저장한다(서버 재시작 후 이어하기).
 * 이 디렉터리는 정적 서빙 대상이 아니다(정적 루트는 public/ 뿐) — 파일에 좌석 토큰이 들어 있다.
 */
export class FileRoomRepository {
  #directory;
  #random;
  #logger;

  constructor({ directory, random, logger }) {
    this.#directory = directory;
    this.#random = random;
    this.#logger = logger ?? console;
  }

  async init() {
    await mkdir(this.#directory, { recursive: true });
  }

  #pathOf(code) {
    return path.join(this.#directory, `${code}.json`);
  }

  async save(room) {
    await this.init();
    const target = this.#pathOf(room.code);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, serializeRoom(room), 'utf8');
    await rename(temporary, target);
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
      }
      return null;
    }
    return this.#parse(code, text);
  }

  async findAll() {
    await this.init();
    let entries;
    try {
      entries = await readdir(this.#directory);
    } catch (error) {
      this.#logger.error(`[FileRoomRepository] 저장 디렉터리 조회 실패: ${error.message}`);
      return [];
    }
    const rooms = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const code = entry.slice(0, -'.json'.length);
      const room = await this.findByCode(code);
      if (room) {
        rooms.push(room);
      }
    }
    return rooms;
  }

  async delete(code) {
    if (!isValidRoomCode(code)) {
      return;
    }
    try {
      await unlink(this.#pathOf(code));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.#logger.error(`[FileRoomRepository] 방 파일 삭제 실패 ${code}: ${error.message}`);
      }
    }
  }

  /** 스키마가 깨진 파일은 버리고(게임을 이어갈 수 없으므로) 로그를 남긴다. */
  #parse(code, text) {
    try {
      return parseRoomJson(text, this.#random);
    } catch (error) {
      if (error instanceof RoomSchemaError) {
        this.#logger.error(`[FileRoomRepository] 저장 파일 스키마 오류 ${code}: ${error.message}`);
        return null;
      }
      this.#logger.error(`[FileRoomRepository] 방 복원 실패 ${code}: ${error.message}`);
      return null;
    }
  }
}
