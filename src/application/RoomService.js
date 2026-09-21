import { MAX_SEATS, ROOM_STATUS, Room } from '../domain/room/Room.js';
import { generateRoomCode, isValidRoomCode } from '../domain/room/RoomCode.js';
import { AppError } from './errors.js';
import { KeyedMutex } from './KeyedMutex.js';
import { toRoomDto, toRoomSummaryDto, toGameViewDto } from './dto.js';

/** 호스트 전용 동작 종류. */
export const HOST_ACTIONS = Object.freeze({
  ADD_COMPUTER: 'ADD_COMPUTER',
  SET_OPTIONS: 'SET_OPTIONS',
  START: 'START',
  SET_AUTOPILOT: 'SET_AUTOPILOT',
});

/** 서버가 동시에 들고 있을 수 있는 최대 방 개수(플러딩 방어). */
export const MAX_ROOMS = 200;
/** 상한에 닿았을 때 먼저 쓸어낼 "방치된 대기실" 기준(30분). */
export const IDLE_LOBBY_MS = 30 * 60 * 1000;
/** 오래된 방 정리를 주기적으로 돌리는 간격(1시간). */
export const STALE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** 방 코드 생성 재시도 횟수. */
const CODE_ATTEMPTS = 20;
/** 방 생성(코드 중복 확인 → 저장)을 직렬화하는 키. */
const CREATE_LOCK_KEY = '@create';

/**
 * 방 유스케이스. 저장소에서 방을 불러와 → 인증하고 → Aggregate에 위임하고 → 저장하고 → 발행한다.
 * 규칙 판단은 Room/Seat이 하고, 이 서비스는 조합만 담당한다.
 */
export class RoomService {
  #repository;
  #random;
  #authenticator;
  #publisher;
  #clock;
  #tokenFactory;
  #logger;
  #autoDriver = null;
  #presence;
  #mutex;
  #maxRooms;

  constructor({
    repository,
    random,
    authenticator,
    publisher,
    clock,
    tokenFactory,
    logger,
    presence,
    mutex,
    maxRooms = MAX_ROOMS,
  }) {
    this.#repository = repository;
    this.#random = random;
    this.#authenticator = authenticator;
    this.#publisher = publisher;
    this.#clock = clock;
    this.#tokenFactory = tokenFactory;
    this.#logger = logger ?? console;
    this.#presence = presence ?? { onlineSeatIds: () => [] };
    this.#mutex = mutex ?? new KeyedMutex();
    this.#maxRooms = maxRooms;
  }

  /** 컴퓨터/자동 진행 좌석을 대신 진행시키는 드라이버를 연결한다(순환 의존 방지). */
  attachAutoPlayerDriver(driver) {
    this.#autoDriver = driver;
  }

  /**
   * 참가 가능한 방 목록.
   * 저장소의 **요약 색인**만 읽는다 — 목록 한 번 볼 때마다 모든 방의 게임을 복원하지 않는다.
   */
  async listRooms() {
    const summaries = await this.#repository.findAllSummaries();
    return summaries
      .filter((summary) => summary.status === ROOM_STATUS.LOBBY && summary.seatCount < MAX_SEATS)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toRoomSummaryDto);
  }

  async getRoom({ code }) {
    const room = await this.#loadRoom(code);
    return this.#roomDto(room);
  }

  /** 방 상세 + 진행 중인 게임 뷰(SSE 최초 스냅샷용). */
  async getRoomState({ code }) {
    const room = await this.#loadRoom(code);
    return {
      room: this.#roomDto(room),
      game: room.game ? toGameViewDto(room.game) : null,
    };
  }

  /**
   * SSE presence 쌍(`seatId` + 좌석 토큰)을 검증해 실제 좌석 id만 돌려준다.
   * 토큰 대조는 인증기(infrastructure)가, 방 조회는 이 서비스가 맡아 컨트롤러가
   * 저장소나 도메인 엔티티를 직접 만지지 않게 한다.
   * @param {{code:string, pairs:Array<{seatId:string, token:string}>}} params
   * @returns {Promise<string[]>} 검증을 통과한 좌석 id
   */
  async verifyPresence({ code, pairs = [] }) {
    const room = await this.#loadRoom(code);
    const verified = [];
    for (const { seatId, token } of pairs) {
      const resolved = this.#authenticator.resolveSeatId(room, token);
      if (resolved && resolved === seatId) {
        verified.push(resolved);
      }
    }
    return verified;
  }

  async createRoom({ hostName }) {
    return this.#mutex.runExclusive(CREATE_LOCK_KEY, () => this.#createRoomLocked({ hostName }));
  }

  async #createRoomLocked({ hostName }) {
    await this.#enforceRoomCapacity();
    const now = this.#clock.now();
    const code = await this.#generateUniqueCode();
    const token = this.#tokenFactory.create();
    const room = this.#guard(() => Room.create({ code, hostName, token, now }));

    await this.#repository.save(room);
    const seatId = room.hostSeatId;
    this.#publishRoom(room);
    return { room: this.#roomDto(room), seatId, seatToken: token };
  }

  async joinSeat({ code, name }) {
    return this.#mutex.runExclusive(code, () => this.#joinSeatLocked({ code, name }));
  }

  async #joinSeatLocked({ code, name }) {
    const room = await this.#loadRoom(code);
    const token = this.#tokenFactory.create();
    const seat = this.#guard(() => room.join({ name, token, now: this.#clock.now() }));

    await this.#repository.save(room);
    this.#publishRoom(room);
    return { room: this.#roomDto(room), seatId: seat.id, seatToken: token };
  }

  async leaveSeat({ code, seatId, token }) {
    return this.#mutex.runExclusive(code, () => this.#leaveSeatLocked({ code, seatId, token }));
  }

  async #leaveSeatLocked({ code, seatId, token }) {
    const room = await this.#loadRoom(code);
    const bySeatId = this.#authenticate(room, token);
    this.#guard(() => room.removeSeat({ seatId, bySeatId, now: this.#clock.now() }));

    if (room.isEmpty()) {
      const dto = this.#roomDto(room);
      await this.#deleteRoom(room.code);
      return dto;
    }
    await this.#repository.save(room);
    this.#publishRoom(room);
    return this.#roomDto(room);
  }

  /**
   * 호스트 전용 동작.
   * @param {{code:string, token:string, action:{type:string}}} params
   */
  async hostAction({ code, token, action }) {
    return this.#mutex.runExclusive(code, () => this.#hostActionLocked({ code, token, action }));
  }

  async #hostActionLocked({ code, token, action }) {
    const room = await this.#loadRoom(code);
    const bySeatId = this.#authenticate(room, token);
    const now = this.#clock.now();

    switch (action?.type) {
      case HOST_ACTIONS.ADD_COMPUTER:
        this.#guard(() =>
          room.addComputer({ name: action.name, token: this.#tokenFactory.create(), bySeatId, now }),
        );
        break;
      case HOST_ACTIONS.SET_OPTIONS:
        this.#guard(() => room.setOptions({ roundLimit: action.roundLimit ?? null, bySeatId, now }));
        break;
      case HOST_ACTIONS.SET_AUTOPILOT:
        this.#guard(() =>
          room.setAutopilot({
            seatId: action.seatId,
            enabled: Boolean(action.enabled),
            bySeatId,
            // 도메인 규칙("접속 중인 좌석은 켤 수 없다")이 판단할 재료를 PresenceQuery 포트로 확인해 넘긴다.
            onlineSeatIds: this.#presence.onlineSeatIds(room.code),
            now,
          }),
        );
        break;
      case HOST_ACTIONS.START:
        this.#guard(() => room.start({ bySeatId, random: this.#random, now }));
        break;
      default:
        throw new AppError('ERR001', `알 수 없는 호스트 동작: ${action?.type}`);
    }

    await this.#repository.save(room);
    this.#publishRoom(room);
    if (room.game) {
      this.#publisher.publishGame(room.code, { view: toGameViewDto(room.game), events: [] });
    }
    this.#syncAutoDriver(room);
    return this.#roomDto(room);
  }

  /**
   * 자동 진행 예약을 현재 턴 좌석에 맞춘다.
   * 자동 진행을 켠 좌석의 차례면 예약하고, 되돌렸으면 대기 중인 타이머를 취소한다
   * (사람이 돌아왔는데 서버가 한 수 더 두는 일을 막는다).
   */
  #syncAutoDriver(room) {
    if (room.currentSeatIsAutoControlled()) {
      this.#autoDriver?.schedule(room.code);
      return;
    }
    this.#autoDriver?.cancelTimer(room.code);
  }

  /**
   * 방 개수 상한을 지킨다.
   * 상한에 닿으면 먼저 **방치된 대기실**(30분 이상 변화 없음)을 쓸어내고, 그래도 자리가 없으면
   * 거절한다. 진행 중인 방은 사람이 돌아올 수 있으므로 건드리지 않는다.
   */
  async #enforceRoomCapacity() {
    const summaries = await this.#repository.findAllSummaries();
    if (summaries.length < this.#maxRooms) {
      return;
    }
    const now = this.#clock.now();
    let remaining = summaries.length;
    for (const summary of summaries) {
      if (summary.status === ROOM_STATUS.LOBBY && now - summary.updatedAt > IDLE_LOBBY_MS) {
        await this.#deleteRoom(summary.code);
        remaining -= 1;
      }
    }
    if (remaining >= this.#maxRooms) {
      throw new AppError('ERR017', `방 개수 상한(${this.#maxRooms}) 초과`);
    }
  }

  /**
   * 오래된 방 정리를 주기적으로 돌린다(시작 시 한 번만으로는 오래 켜 둔 서버가 계속 쌓인다).
   * 타이머는 unref해 서버 종료를 막지 않는다.
   * @returns {() => void} 정리 중단 함수
   */
  startStaleCleanup({ intervalMs = STALE_CLEANUP_INTERVAL_MS, timers = { setInterval, clearInterval } } = {}) {
    const handle = timers.setInterval(() => {
      void this.#runStaleCleanup();
    }, intervalMs);
    if (typeof handle?.unref === 'function') {
      handle.unref();
    }
    return () => timers.clearInterval(handle);
  }

  /** 주기 정리는 실패해도 서버를 멈추지 않는다(다음 주기에 다시 시도). */
  async #runStaleCleanup() {
    try {
      const removed = await this.cleanupStaleRooms();
      if (removed.length > 0) {
        this.#logger.info?.(`[RoomService] 오래된 방 ${removed.length}개 정리: ${removed.join(', ')}`);
      }
    } catch (error) {
      this.#logger.error(`[RoomService] 주기 방 정리 실패: ${error.message}`);
    }
  }

  /** 오래된 방 정리(시작 시 + 주기적으로). */
  async cleanupStaleRooms() {
    const now = this.#clock.now();
    const rooms = await this.#repository.findAll();
    const removed = [];
    for (const room of rooms) {
      if (room.isStale(now)) {
        await this.#deleteRoom(room.code);
        removed.push(room.code);
      }
    }
    return removed;
  }

  /**
   * 방을 지우고 그 방에 매달린 자원을 함께 정리한다.
   * 스트림을 닫지 않으면 구독자가 사라진 방의 이벤트를 영원히 기다리고, 예약을 취소하지 않으면
   * 드라이버가 없는 방을 계속 깨운다.
   */
  async #deleteRoom(code) {
    this.#autoDriver?.cancel(code);
    await this.#repository.delete(code);
    this.#publisher.closeRoom?.(code);
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  async #loadRoom(code) {
    if (!isValidRoomCode(code)) {
      throw new AppError('ERR004', `방 코드 형식이 올바르지 않습니다: ${code}`);
    }
    const room = await this.#repository.findByCode(code);
    if (!room) {
      throw new AppError('ERR004', `방을 찾을 수 없습니다: ${code}`);
    }
    return room;
  }

  #authenticate(room, token) {
    const seatId = this.#authenticator.resolveSeatId(room, token);
    if (!seatId) {
      throw new AppError('ERR002', `좌석 토큰이 일치하지 않습니다 (방: ${room.code})`);
    }
    return seatId;
  }

  async #generateUniqueCode() {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = generateRoomCode(this.#random);
      if (!(await this.#repository.findByCode(code))) {
        return code;
      }
    }
    throw new AppError('ERR010', '빈 방 코드를 찾지 못했습니다');
  }

  #roomDto(room) {
    return toRoomDto(room, { onlineSeatIds: this.#presence.onlineSeatIds(room.code) });
  }

  #publishRoom(room) {
    this.#publisher.publishRoom(room.code, this.#roomDto(room));
  }

  /** 도메인 예외를 규격 에러로 바꾸고 내부 사유는 로그로만 남긴다. */
  #guard(operation) {
    try {
      return operation();
    } catch (error) {
      const appError = AppError.from(error);
      this.#logger.error(`[RoomService] ${appError.code}: ${error.message}`);
      throw appError;
    }
  }
}
