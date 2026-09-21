import { isValidRoomCode } from '../domain/room/RoomCode.js';
import { AppError } from './errors.js';
import { KeyedMutex } from './KeyedMutex.js';
import { TokenBucketLimiter } from './RateLimiter.js';
import {
  TRADE_COMMAND_TYPES,
  TRADE_RATE_CAPACITY,
  TRADE_RATE_WINDOW_MS,
} from './tradeCommands.js';
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
  #mutex;
  #tradeLimiter;

  /**
   * @param {{tradeLimiter?: {tryConsume: (key: string) => boolean}}} params
   *   `tradeLimiter`는 **사람이 보낸 거래 커맨드**의 좌석당 레이트 리밋이다(설계서 §7).
   *   커맨드마다 방 파일을 저장하므로, 한 좌석이 주문을 쏟아부어 디스크를 붙잡는 것을 막는다.
   *   서버가 대신 두는 좌석(`executeAsServer`)은 제한하지 않는다 — 드라이버는 스팸을 내지 않고,
   *   막히면 자동 진행이 멈춘다.
   */
  constructor({
    repository,
    random,
    authenticator,
    publisher,
    clock,
    logger,
    presence,
    mutex,
    tradeLimiter,
  }) {
    this.#repository = repository;
    this.#random = random;
    this.#authenticator = authenticator;
    this.#publisher = publisher;
    this.#clock = clock;
    this.#logger = logger ?? console;
    this.#presence = presence ?? { onlineSeatIds: () => [] };
    this.#mutex = mutex ?? new KeyedMutex();
    this.#tradeLimiter =
      tradeLimiter ??
      new TokenBucketLimiter({
        capacity: TRADE_RATE_CAPACITY,
        windowMs: TRADE_RATE_WINDOW_MS,
      });
  }

  attachAutoPlayerDriver(driver) {
    this.#autoDriver = driver;
  }

  /**
   * 사람 좌석의 커맨드.
   * @param {{code:string, token:string, seatId?:string, type:string, payload?:object}} params
   */
  async execute({ code, token, seatId, type, payload }) {
    return this.#mutex.runExclusive(code, () => this.#executeLocked({ code, token, seatId, type, payload }));
  }

  async #executeLocked({ code, token, seatId, type, payload }) {
    const room = await this.#loadRoom(code);
    const resolvedSeatId = this.#authenticate(room, token);
    if (seatId && seatId !== resolvedSeatId) {
      throw new AppError('ERR003', `토큰의 좌석(${resolvedSeatId})과 요청 좌석(${seatId})이 다릅니다`);
    }
    // 서버가 대신 두는 좌석을 사람이 동시에 조종하면 두 커맨드가 경합한다(이중 조종).
    this.#guard(() => room.assertManualControl(resolvedSeatId));
    this.#assertTradeRate(code, resolvedSeatId, type);
    return this.#run(room, resolvedSeatId, type, payload);
  }

  /**
   * 서버(컴퓨터/자동 진행 좌석) 대행 커맨드. 토큰 대신 좌석이 자동 진행 대상인지 확인한다.
   * `expectedVersion`을 주면 **낙관적 동시성 검사**를 한다 — 결정을 내린 뒤 상태가 바뀌었다면
   * 아무것도 바꾸지 않고 ERR005로 거부한다(드라이버가 새 상태로 다시 결정하면 된다).
   */
  async executeAsServer({ code, seatId, type, payload, expectedVersion }) {
    return this.#mutex.runExclusive(code, () =>
      this.#executeAsServerLocked({ code, seatId, type, payload, expectedVersion }),
    );
  }

  async #executeAsServerLocked({ code, seatId, type, payload, expectedVersion }) {
    const room = await this.#loadRoom(code);
    const seat = room.seatById(seatId);
    if (!seat?.isAutoControlled()) {
      throw new AppError('ERR003', `자동 진행 좌석이 아닙니다: ${seatId}`);
    }
    if (expectedVersion !== undefined && room.game?.version !== expectedVersion) {
      throw new AppError(
        'ERR005',
        `자동 진행 버전 불일치: 기대 ${expectedVersion}, 실제 ${room.game?.version}`,
      );
    }
    return this.#run(room, seatId, type, payload);
  }

  /**
   * 현재 턴이 자동 진행 좌석이면 좌석 id와 게임 뷰를 돌려준다(드라이버 판단용).
   * `version`은 이 뷰로 내린 결정을 커맨드에 실어 보낼 때 쓰는 낙관적 동시성 토큰이다.
   * @returns {Promise<{seatId:string, view:object, version:number}|null>}
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
    const view = toGameViewDto(room.game);
    return { seatId: seat.id, view, version: view.version };
  }

  /**
   * 자동 진행이 재시도까지 실패했음을 방에 알린다(`RoomDto.autoStalled`).
   * 호스트가 자동 진행을 끄거나 방을 정리할 수 있도록 알리는 일회성 신호다.
   */
  async publishAutoStalled(code) {
    const room = await this.#repository.findByCode(code);
    if (!room) {
      return;
    }
    this.#publisher.publishRoom(
      code,
      toRoomDto(room, {
        onlineSeatIds: this.#presence.onlineSeatIds(code),
        autoStalled: true,
      }),
    );
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
    } else if (room.currentSeatIsAutoControlled()) {
      // 다음 턴이 사람 좌석이면 예약할 이유가 없다(쓸데없는 타이머와 오예약 방지).
      this.#autoDriver?.schedule(room.code);
    }
    return { view, events };
  }

  /**
   * 거래 커맨드의 좌석당 레이트 리밋. 상태를 바꾸기 **전에** 검사하므로 거부돼도 방은 그대로다.
   */
  #assertTradeRate(code, seatId, type) {
    if (!TRADE_COMMAND_TYPES.has(type)) {
      return;
    }
    if (!this.#tradeLimiter.tryConsume(`${code}:${seatId}`)) {
      throw new AppError('ERR019', `거래 요청이 너무 잦습니다: ${code}/${seatId} ${type}`);
    }
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
