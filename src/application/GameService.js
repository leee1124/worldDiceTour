import { isValidRoomCode } from '../domain/room/RoomCode.js';
import { AppError } from './errors.js';
import { toGameViewDto, toRoomDto } from './dto.js';

/**
 * 게임 커맨드 유스케이스.
 * 방 로드 → 좌석 인증 → Aggregate 위임 → 저장 → 발행 → 자동 좌석 예약. 규칙 판단은 Game이 한다.
 */
export class GameService {
  #repository;
  #random;
  #authenticator;
  #publisher;
  #clock;
  #logger;
  #autoDriver = null;
  #presence;

  constructor({ repository, random, authenticator, publisher, clock, logger, presence }) {
    this.#repository = repository;
    this.#random = random;
    this.#authenticator = authenticator;
    this.#publisher = publisher;
    this.#clock = clock;
    this.#logger = logger ?? console;
    this.#presence = presence ?? { onlineSeatIds: () => [] };
  }

  attachAutoPlayerDriver(driver) {
    this.#autoDriver = driver;
  }

  /**
   * 사람 좌석의 커맨드.
   * @param {{code:string, token:string, seatId?:string, type:string, payload?:object}} params
   */
  async execute({ code, token, seatId, type, payload }) {
    const room = await this.#loadRoom(code);
    const resolvedSeatId = this.#authenticate(room, token);
    if (seatId && seatId !== resolvedSeatId) {
      throw new AppError('ERR003', `토큰의 좌석(${resolvedSeatId})과 요청 좌석(${seatId})이 다릅니다`);
    }
    return this.#run(room, resolvedSeatId, type, payload);
  }

  /**
   * 서버(컴퓨터/자동 진행 좌석) 대행 커맨드. 토큰 대신 좌석이 자동 진행 대상인지 확인한다.
   */
  async executeAsServer({ code, seatId, type, payload }) {
    const room = await this.#loadRoom(code);
    const seat = room.seatById(seatId);
    if (!seat?.isAutoControlled()) {
      throw new AppError('ERR003', `자동 진행 좌석이 아닙니다: ${seatId}`);
    }
    return this.#run(room, seatId, type, payload);
  }

  /**
   * 현재 턴이 자동 진행 좌석이면 좌석 id와 게임 뷰를 돌려준다(드라이버 판단용).
   * @returns {Promise<{seatId:string, view:object}|null>}
   */
  async autoTurn(code) {
    const room = await this.#repository.findByCode(code);
    if (!room || !room.isPlaying() || !room.game || room.game.isOver()) {
      return null;
    }
    const seat = room.seatById(room.game.currentPlayerId);
    if (!seat?.isAutoControlled()) {
      return null;
    }
    return { seatId: seat.id, view: toGameViewDto(room.game) };
  }

  async #run(room, seatId, type, payload) {
    const events = this.#guard(() =>
      room.executeCommand({ seatId, type, payload, now: this.#clock.now() }),
    );

    await this.#repository.save(room);

    const view = toGameViewDto(room.game);
    this.#publisher.publishGame(room.code, { view, events });
    if (room.isFinished()) {
      this.#publisher.publishRoom(
        room.code,
        toRoomDto(room, { onlineSeatIds: this.#presence.onlineSeatIds(room.code) }),
      );
      this.#autoDriver?.cancel(room.code);
    } else {
      this.#autoDriver?.schedule(room.code);
    }
    return { view, events };
  }

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

  #guard(operation) {
    try {
      return operation();
    } catch (error) {
      const appError = AppError.from(error);
      this.#logger.error(`[GameService] ${appError.code}: ${error.message}`);
      throw appError;
    }
  }
}
