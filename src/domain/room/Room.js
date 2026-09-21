import { Game } from '../game/Game.js';
import { DomainError } from '../shared/DomainError.js';
import { normalizeFinanceOptions } from './FinanceOptions.js';
import { SEAT_KINDS, Seat } from './Seat.js';

/** 방 상태. */
export const ROOM_STATUS = Object.freeze({
  LOBBY: 'LOBBY',
  PLAYING: 'PLAYING',
  FINISHED: 'FINISHED',
});

export const MIN_SEATS = 2;
export const MAX_SEATS = 4;

/**
 * 방 스냅샷(저장 파일) 스키마 버전.
 *
 * - `1`: 필드가 없던 최초 버전(`options = { roundLimit }`)
 * - `2`: `options.finance`와 장부 사유별 내역(`ledger.byReason`) 도입
 *
 * 값이 올라갈 때마다 `RoomSerializer`의 마이그레이션 목록에 한 단계를 **추가**한다
 * (기존 단계는 고치지 않는다 — 옛 파일은 여전히 그 경로로 올라와야 한다).
 */
export const ROOM_SCHEMA_VERSION = 2;

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
    this.#options = {
      roundLimit: options.roundLimit ?? null,
      finance: normalizeFinanceOptions(options.finance),
    };
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
    return { roundLimit: this.#options.roundLimit, finance: { ...this.#options.finance } };
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

  /**
   * 로비 목록에 필요한 최소 정보. 좌석 토큰과 게임 상태는 담지 않는다.
   * 저장소가 이 값을 색인해 두면 목록 조회 때 게임을 복원할 필요가 없다.
   */
  toSummary() {
    return {
      code: this.#code,
      status: this.#status,
      hostName: this.seatById(this.#hostSeatId)?.name ?? null,
      seatCount: this.#seats.length,
      roundLimit: this.#options.roundLimit,
      updatedAt: this.#updatedAt,
    };
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

  /**
   * 방 옵션을 바꾼다(호스트, **대기실에서만**).
   * `START` 시점의 옵션이 판 내내 고정된다 — 진행 중인 판에 밸런스/불변식이 끼어들면 안 된다.
   *
   * `finance`를 생략하면 기존 값을 유지한다(금융 옵션을 모르는 기존 클라이언트 호환).
   */
  setOptions({ roundLimit, finance, bySeatId, now }) {
    this.assertHost(bySeatId);
    this.#assertLobby();
    const normalized = roundLimit ?? null;
    if (!ALLOWED_ROUND_LIMITS.includes(normalized)) {
      throw DomainError.invalidArgument(`선택할 수 없는 라운드 제한입니다: ${roundLimit}`);
    }
    // 검증이 먼저 끝나야 한다 — 거부된 요청이 상태를 절반만 바꿔서는 안 된다.
    const nextFinance = normalizeFinanceOptions(finance, { base: this.#options.finance });
    this.#options = { roundLimit: normalized, finance: nextFinance };
    this.touch(now);
  }

  /**
   * 오프라인 좌석을 컴퓨터 자동 진행으로 전환(또는 복귀).
   *
   * - **켜기**: 호스트만, 그리고 그 좌석이 **접속 중이 아닐 때만**. 접속한 사람과 서버가
   *   같은 좌석을 동시에 조종하면(이중 조종) 커맨드가 경합한다.
   * - **끄기**: 호스트 또는 **그 좌석 본인**. 돌아온 사람이 스스로 조종권을 회수할 수 있어야 한다.
   *
   * @param {{seatId:string, enabled:boolean, bySeatId:string, onlineSeatIds?:string[], now:number}} params
   *   `onlineSeatIds`는 application 레이어가 PresenceQuery 포트로 확인한 **검증된** 좌석 목록이다.
   */
  setAutopilot({ seatId, enabled, bySeatId, onlineSeatIds = [], now }) {
    const seat = this.seatById(seatId);
    if (!seat) {
      throw DomainError.seatNotFound(`좌석을 찾을 수 없습니다: ${seatId}`);
    }
    if (enabled) {
      this.assertHost(bySeatId);
      if (onlineSeatIds.includes(seatId)) {
        throw DomainError.invalidState(
          `접속 중인 좌석은 자동 진행으로 바꿀 수 없습니다: ${seatId}`,
        );
      }
    } else if (seatId !== bySeatId) {
      this.assertHost(bySeatId);
    }
    seat.setAutopilot(enabled);
    this.touch(now);
    return seat;
  }

  /**
   * 사람이 직접 커맨드를 보낼 수 있는 좌석인지 확인한다.
   * 자동 진행 중인 좌석은 서버가 조종하므로, 사람은 먼저 자동 진행을 끄고 조종권을 되찾아야 한다.
   */
  assertManualControl(seatId) {
    if (this.seatById(seatId)?.isAutoControlled()) {
      throw DomainError.forbidden(
        `자동 진행 중인 좌석입니다. 먼저 자동 진행을 해제하세요: ${seatId}`,
      );
    }
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
      schemaVersion: ROOM_SCHEMA_VERSION,
      code: this.#code,
      status: this.#status,
      hostSeatId: this.#hostSeatId,
      seats: this.#seats.map((seat) => seat.toSnapshot()),
      options: {
        roundLimit: this.#options.roundLimit,
        finance: { ...this.#options.finance },
      },
      game: this.#game ? this.#game.toSnapshot() : null,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      seatSequence: this.#seatSequence,
    };
  }
}
