import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isValidRoomCode } from '../domain/room/RoomCode.js';
import { RoomSchemaError, parseRoomJson, serializeRoom } from './RoomSerializer.js';

/** 해석할 수 없는 저장 파일에 붙이는 꼬리표. 이 확장자는 조회/목록 경로가 모두 무시한다. */
const CORRUPT_SUFFIX = '.corrupt';

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

  /** 스키마가 깨진 파일은 격리하고(게임을 이어갈 수 없으므로) 로그를 남긴다. */
  async #parse(code, text) {
    try {
      return parseRoomJson(text, this.#random);
    } catch (error) {
      const label = error instanceof RoomSchemaError ? '저장 파일 스키마 오류' : '방 복원 실패';
      this.#logger.error(`[FileRoomRepository] ${label} ${code}: ${error.message}`);
      await this.#quarantine(code, error.message);
      return null;
    }
  }
}
