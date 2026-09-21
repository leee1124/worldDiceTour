import { Room } from '../domain/room/Room.js';
import { generateRoomCode, isValidRoomCode } from '../domain/room/RoomCode.js';
import { AppError } from './errors.js';
import { toRoomDto, toRoomSummaryDto, toGameViewDto } from './dto.js';

/** 호스트 전용 동작 종류. */
export const HOST_ACTIONS = Object.freeze({
  ADD_COMPUTER: 'ADD_COMPUTER',
  SET_OPTIONS: 'SET_OPTIONS',
  START: 'START',
  SET_AUTOPILOT: 'SET_AUTOPILOT',
});

/** 방 코드 생성 재시도 횟수. */
const CODE_ATTEMPTS = 20;

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

  constructor({ repository, random, authenticator, publisher, clock, tokenFactory, logger, presence }) {
    this.#repository = repository;
    this.#random = random;
    this.#authenticator = authenticator;
    this.#publisher = publisher;
    this.#clock = clock;
    this.#tokenFactory = tokenFactory;
    this.#logger = logger ?? console;
    this.#presence = presence ?? { onlineSeatIds: () => [] };
  }

  /** 컴퓨터/자동 진행 좌석을 대신 진행시키는 드라이버를 연결한다(순환 의존 방지). */
  attachAutoPlayerDriver(driver) {
    this.#autoDriver = driver;
  }

  async listRooms() {
    const rooms = await this.#repository.findAll();
    return rooms
      .filter((room) => room.isLobby() && !room.isFull())
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

  async createRoom({ hostName }) {
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
    const room = await this.#loadRoom(code);
    const token = this.#tokenFactory.create();
    const seat = this.#guard(() => room.join({ name, token, now: this.#clock.now() }));

    await this.#repository.save(room);
    this.#publishRoom(room);
    return { room: this.#roomDto(room), seatId: seat.id, seatToken: token };
  }

  async leaveSeat({ code, seatId, token }) {
    const room = await this.#loadRoom(code);
    const bySeatId = this.#authenticate(room, token);
    this.#guard(() => room.removeSeat({ seatId, bySeatId, now: this.#clock.now() }));

    if (room.isEmpty()) {
      this.#autoDriver?.cancel(room.code);
      await this.#repository.delete(room.code);
      return this.#roomDto(room);
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
          room.setAutopilot({ seatId: action.seatId, enabled: Boolean(action.enabled), bySeatId, now }),
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
      this.#autoDriver?.schedule(room.code);
    }
    return this.#roomDto(room);
  }

  /** 시작 시 오래된 방 정리. */
  async cleanupStaleRooms() {
    const now = this.#clock.now();
    const rooms = await this.#repository.findAll();
    const removed = [];
    for (const room of rooms) {
      if (room.isStale(now)) {
        await this.#repository.delete(room.code);
        removed.push(room.code);
      }
    }
    return removed;
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
