import { Game } from '../game/Game.js';
import { DomainError } from '../shared/DomainError.js';
import { SEAT_KINDS, Seat } from './Seat.js';

/** 방 상태. */
export const ROOM_STATUS = Object.freeze({
  LOBBY: 'LOBBY',
  PLAYING: 'PLAYING',
  FINISHED: 'FINISHED',
});

export const MIN_SEATS = 2;
export const MAX_SEATS = 4;

/** 선택 가능한 라운드 제한(없음/20/30). */
export const ALLOWED_ROUND_LIMITS = Object.freeze([null, 20, 30]);

/** 오래된 방 정리 기준(24시간). */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * 방 Aggregate Root.
 * 좌석 수 제한, 호스트 권한, 상태 전이(LOBBY → PLAYING → FINISHED)를 스스로 지킨다.
 * 게임 커맨드는 Game으로 위임하되 방 상태가 PLAYING인지 먼저 확인한다.
 */
export class Room {
  #code;
  #status;
  #hostSeatId;
  /** @type {Seat[]} */
  #seats;
  #options;
  /** @type {Game|null} */
  #game;
  #createdAt;
  #updatedAt;
  #seatSequence;

  constructor({
    code,
    status = ROOM_STATUS.LOBBY,
    hostSeatId,
    seats,
    options = { roundLimit: null },
    game = null,
    createdAt,
    updatedAt,
    seatSequence,
  }) {
    this.#code = code;
    this.#status = status;
    this.#hostSeatId = hostSeatId;
    this.#seats = seats;
    this.#options = { roundLimit: options.roundLimit ?? null };
    this.#game = game;
    this.#createdAt = createdAt;
    this.#updatedAt = updatedAt;
    this.#seatSequence = seatSequence ?? seats.length;
  }

  /** 방을 만들고 호스트 좌석을 앉힌다. */
  static create({ code, hostName, token, now }) {
    const hostSeat = new Seat({ id: 'seat-1', name: hostName, kind: SEAT_KINDS.HUMAN, token });
    return new Room({
      code,
      hostSeatId: hostSeat.id,
      seats: [hostSeat],
      createdAt: now,
      updatedAt: now,
      seatSequence: 1,
    });
  }

  /** 스냅샷에서 복원한다. */
  static restore(snapshot, random) {
    if (!snapshot || !Array.isArray(snapshot.seats)) {
      throw DomainError.invalidArgument('방 스냅샷 구조가 올바르지 않습니다');
    }
    return new Room({
      code: snapshot.code,
      status: snapshot.status,
      hostSeatId: snapshot.hostSeatId,
      seats: snapshot.seats.map((seat) => new Seat({ ...seat })),
      options: snapshot.options ?? { roundLimit: null },
      game: snapshot.game ? Game.restore(snapshot.game, random) : null,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      seatSequence: snapshot.seatSequence,
    });
  }

  // ── 조회 ────────────────────────────────────────────────────────────────

  get code() {
    return this.#code;
  }

  get status() {
    return this.#status;
  }

  get hostSeatId() {
    return this.#hostSeatId;
  }

  get seats() {
    return [...this.#seats];
  }

  get options() {
    return { ...this.#options };
  }

  get game() {
    return this.#game;
  }

  get createdAt() {
    return this.#createdAt;
  }

  get updatedAt() {
    return this.#updatedAt;
  }

  seatById(seatId) {
    return this.#seats.find((seat) => seat.id === seatId) ?? null;
  }

  isFull() {
    return this.#seats.length >= MAX_SEATS;
  }

  isEmpty() {
    return this.#seats.length === 0;
  }

  isLobby() {
    return this.#status === ROOM_STATUS.LOBBY;
  }

  isPlaying() {
    return this.#status === ROOM_STATUS.PLAYING;
  }

  isFinished() {
    return this.#status === ROOM_STATUS.FINISHED;
  }

  isHost(seatId) {
    return this.#hostSeatId === seatId;
  }

  /**
   * 토큰에 해당하는 좌석 id. 비교는 주입된 함수(타이밍 안전 비교)로만 한다.
   * @param {string} token
   * @param {(a: string, b: string) => boolean} compare
   * @returns {string|null}
   */
  findSeatIdByToken(token, compare) {
    const found = this.#seats.find((seat) => seat.matchesToken(token, compare));
    return found?.id ?? null;
  }

  /** 정리 대상(종료됐거나 오래 방치된 방). */
  isStale(now) {
    return now - this.#updatedAt > STALE_AFTER_MS;
  }

  // ── 좌석 ────────────────────────────────────────────────────────────────

  join({ name, token, now }) {
    this.#assertLobby();
    if (this.isFull()) {
      throw DomainError.roomFull(`방 ${this.#code}의 좌석이 모두 찼습니다`);
    }
    const seat = new Seat({ id: this.#nextSeatId(), name, kind: SEAT_KINDS.HUMAN, token });
    this.#seats.push(seat);
    this.touch(now);
    return seat;
  }

  addComputer({ name, token, bySeatId, now }) {
    this.assertHost(bySeatId);
    this.#assertLobby();
    if (this.isFull()) {
      throw DomainError.roomFull(`방 ${this.#code}의 좌석이 모두 찼습니다`);
    }
    const seat = new Seat({ id: this.#nextSeatId(), name, kind: SEAT_KINDS.COMPUTER, token });
    this.#seats.push(seat);
    this.touch(now);
    return seat;
  }

  /**
   * 본인 퇴장 또는 호스트 강퇴. 호스트가 나가면 다음 좌석이 호스트를 이어받는다.
   * **대기실에서만** 가능하다 — 진행 중인 게임의 플레이어를 없애면 턴 순서/채권 관계가 깨져
   * 방을 되살릴 수 없기 때문이다(게임 중 "나가기"는 접속만 끊고, 호스트가 자동 진행으로 돌린다).
   */
  removeSeat({ seatId, bySeatId, now }) {
    const seat = this.seatById(seatId);
    if (!seat) {
      throw DomainError.seatNotFound(`좌석을 찾을 수 없습니다: ${seatId}`);
    }
    this.#assertLobby();
    if (seatId !== bySeatId) {
      this.assertHost(bySeatId);
    }
    this.#seats = this.#seats.filter((candidate) => candidate.id !== seatId);
    if (this.#hostSeatId === seatId) {
      this.#hostSeatId = this.#seats[0]?.id ?? null;
    }
    this.touch(now);
    return seat;
  }

  setOptions({ roundLimit, bySeatId, now }) {
    this.assertHost(bySeatId);
    this.#assertLobby();
    const normalized = roundLimit ?? null;
    if (!ALLOWED_ROUND_LIMITS.includes(normalized)) {
      throw DomainError.invalidArgument(`선택할 수 없는 라운드 제한입니다: ${roundLimit}`);
    }
    this.#options = { roundLimit: normalized };
    this.touch(now);
  }

  /** 오프라인 좌석을 컴퓨터 자동 진행으로 전환(또는 복귀). */
  setAutopilot({ seatId, enabled, bySeatId, now }) {
    this.assertHost(bySeatId);
    const seat = this.seatById(seatId);
    if (!seat) {
      throw DomainError.seatNotFound(`좌석을 찾을 수 없습니다: ${seatId}`);
    }
    seat.setAutopilot(enabled);
    this.touch(now);
    return seat;
  }

  assertHost(seatId) {
    if (!this.isHost(seatId)) {
      throw DomainError.notHost(`호스트만 할 수 있는 동작입니다 (요청 좌석: ${seatId})`);
    }
  }

  // ── 게임 ────────────────────────────────────────────────────────────────

  start({ bySeatId, random, now }) {
    this.assertHost(bySeatId);
    this.#assertLobby();
    if (this.#seats.length < MIN_SEATS) {
      throw DomainError.notEnoughSeats(`게임은 ${MIN_SEATS}명 이상이어야 시작할 수 있습니다`);
    }
    this.#game = Game.start({
      players: this.#seats.map((seat) => ({ id: seat.id, name: seat.name })),
      options: this.#options,
      random,
    });
    this.#status = ROOM_STATUS.PLAYING;
    this.touch(now);
    return this.#game;
  }

  /**
   * 게임 커맨드를 위임한다.
   * @returns {object[]} 도메인 이벤트 목록
   */
  executeCommand({ seatId, type, payload, now }) {
    if (!this.isPlaying() || !this.#game) {
      throw DomainError.invalidState(`게임이 진행 중이 아닙니다 (상태: ${this.#status})`);
    }
    const events = this.#game.execute(seatId, type, payload);
    if (this.#game.isOver()) {
      this.#status = ROOM_STATUS.FINISHED;
    }
    this.touch(now);
    return events;
  }

  /** 현재 턴 좌석이 서버 자동 진행 대상인지. */
  currentSeatIsAutoControlled() {
    if (!this.isPlaying() || !this.#game) {
      return false;
    }
    const seat = this.seatById(this.#game.currentPlayerId);
    return Boolean(seat?.isAutoControlled());
  }

  finish(now) {
    this.#status = ROOM_STATUS.FINISHED;
    this.touch(now);
  }

  touch(now) {
    this.#updatedAt = now ?? this.#updatedAt;
  }

  #assertLobby() {
    if (!this.isLobby()) {
      throw DomainError.invalidState(`대기실에서만 할 수 있는 동작입니다 (상태: ${this.#status})`);
    }
  }

  #nextSeatId() {
    this.#seatSequence += 1;
    return `seat-${this.#seatSequence}`;
  }

  toSnapshot() {
    return {
      code: this.#code,
      status: this.#status,
      hostSeatId: this.#hostSeatId,
      seats: this.#seats.map((seat) => seat.toSnapshot()),
      options: { roundLimit: this.#options.roundLimit },
      game: this.#game ? this.#game.toSnapshot() : null,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      seatSequence: this.#seatSequence,
    };
  }
}
