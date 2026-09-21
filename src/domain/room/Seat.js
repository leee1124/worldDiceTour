import { DomainError } from '../shared/DomainError.js';

/** 좌석 종류. */
export const SEAT_KINDS = Object.freeze({
  HUMAN: 'HUMAN',
  COMPUTER: 'COMPUTER',
});

/** 좌석 이름 최대 길이(명세 2.2 입력 검증과 동일). */
const MAX_NAME_LENGTH = 10;

/**
 * 방 안의 플레이어 자리.
 * 좌석 토큰을 보관하지만 **비교는 하지 않는다** — 타이밍 안전 비교는 infrastructure의 책임이며,
 * 도메인은 주입받은 비교 함수로만 토큰을 확인한다(Room.findSeatIdByToken).
 */
export class Seat {
  #id;
  #name;
  #kind;
  #token;
  #autopilot;

  constructor({ id, name, kind = SEAT_KINDS.HUMAN, token, autopilot = false }) {
    this.#id = id;
    this.#name = Seat.normalizeName(name);
    this.#kind = kind;
    this.#token = token;
    this.#autopilot = autopilot;
  }

  static normalizeName(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
      throw DomainError.invalidArgument(`좌석 이름이 올바르지 않습니다: ${JSON.stringify(name)}`);
    }
    return trimmed;
  }

  get id() {
    return this.#id;
  }

  get name() {
    return this.#name;
  }

  get kind() {
    return this.#kind;
  }

  get autopilot() {
    return this.#autopilot;
  }

  get isComputer() {
    return this.#kind === SEAT_KINDS.COMPUTER;
  }

  /** 서버가 대신 진행해야 하는 좌석인지. */
  isAutoControlled() {
    return this.isComputer || this.#autopilot;
  }

  setAutopilot(enabled) {
    if (this.isComputer) {
      throw DomainError.invalidState('컴퓨터 좌석은 자동 진행 설정을 바꿀 수 없습니다');
    }
    this.#autopilot = Boolean(enabled);
  }

  /**
   * 주입된 비교 함수로 토큰 일치 여부를 확인한다.
   * @param {string} candidate
   * @param {(a: string, b: string) => boolean} compare
   */
  matchesToken(candidate, compare) {
    return compare(candidate, this.#token);
  }

  /** 영속화 전용. 토큰이 들어가므로 DTO/응답/로그에 절대 쓰지 않는다. */
  toSnapshot() {
    return {
      id: this.#id,
      name: this.#name,
      kind: this.#kind,
      token: this.#token,
      autopilot: this.#autopilot,
    };
  }
}
