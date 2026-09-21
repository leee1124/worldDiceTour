/** 재시도 간 기본 백오프(ms). 마지막 값까지 쓰고 나면 멈춤으로 처리한다. */
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([200, 600, 1_800]);

/**
 * 컴퓨터/자동 진행 좌석의 턴을 짧은 지연 뒤 대신 진행한다.
 * - 방마다 타이머가 하나만 존재하고(중복 발사 방지), 진행 중이면 **다시 예약한다**(스텝을 버리지 않는다).
 * - 스텝이 실패하거나 결정이 나오지 않으면 백오프를 두고 정해진 횟수까지 재시도하고,
 *   그마저 소진하면 `autoStalled` 신호를 방송해 호스트가 개입할 수 있게 한다.
 * - 커맨드는 결정 근거가 된 뷰 버전과 함께 보낸다(낙관적 동시성). 그사이 상태가 바뀌면
 *   서버가 거부하고, 드라이버는 새 상태로 다시 결정한다.
 * - 방이 끝나거나 삭제되면 타이머를 정리한다. 타이머는 unref해 서버 종료를 막지 않는다.
 * - 한 방에서 허용하는 최대 자동 진행 횟수를 두어 어떤 경우에도 무한 루프에 빠지지 않는다.
 */
export class AutoPlayerDriver {
  #delayMs;
  #policy;
  #gameService;
  #logger;
  #timers;
  #maxSteps;
  #retryDelaysMs;
  /** @type {Map<string, any>} */
  #pending = new Map();
  /** @type {Set<string>} */
  #running = new Set();
  /** @type {Set<Promise<void>>} */
  #inflight = new Set();
  /** @type {Map<string, number>} */
  #steps = new Map();
  /** @type {Map<string, number>} */
  #retries = new Map();
  #stopped = false;

  constructor({
    delayMs = 800,
    policy,
    gameService,
    logger,
    timers = { setTimeout, clearTimeout },
    maxStepsPerRoom = 5_000,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  }) {
    this.#delayMs = delayMs;
    this.#policy = policy;
    this.#gameService = gameService;
    this.#logger = logger ?? console;
    this.#timers = timers;
    this.#maxSteps = maxStepsPerRoom;
    this.#retryDelaysMs = [...retryDelaysMs];
  }

  /** 현재 턴이 자동 좌석이면 한 스텝을 예약한다. */
  schedule(code) {
    this.#scheduleAfter(code, this.#delayMs);
  }

  #scheduleAfter(code, delayMs) {
    if (this.#stopped) {
      return;
    }
    this.cancelTimer(code);
    const handle = this.#timers.setTimeout(() => {
      this.#pending.delete(code);
      void this.#step(code);
    }, delayMs);
    if (typeof handle?.unref === 'function') {
      handle.unref();
    }
    this.#pending.set(code, handle);
  }

  cancelTimer(code) {
    const handle = this.#pending.get(code);
    if (handle !== undefined) {
      this.#timers.clearTimeout(handle);
      this.#pending.delete(code);
    }
  }

  /** 방이 끝났거나 삭제됐을 때 호출한다. */
  cancel(code) {
    this.cancelTimer(code);
    this.#steps.delete(code);
    this.#retries.delete(code);
  }

  /** 서버 종료용. 모든 타이머를 정리하고 더 이상 예약하지 않는다. */
  stop() {
    this.#stopped = true;
    for (const code of [...this.#pending.keys()]) {
      this.cancelTimer(code);
    }
    this.#steps.clear();
    this.#retries.clear();
  }

  /** 테스트용: 예약/진행 중인 자동 턴이 모두 끝날 때까지 기다린다. */
  async whenIdle({ timeoutMs = 5_000 } = {}) {
    const startedAt = Date.now();
    while (this.#pending.size > 0 || this.#inflight.size > 0) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('AutoPlayerDriver.whenIdle 시간 초과');
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
    }
  }

  async #step(code) {
    if (this.#running.has(code)) {
      // 같은 방의 스텝이 진행 중이면 이 발사는 버리지 않고 뒤로 미룬다.
      this.schedule(code);
      return;
    }
    this.#running.add(code);
    const task = this.#runStep(code).finally(() => {
      this.#running.delete(code);
    });
    this.#inflight.add(task);
    task.finally(() => this.#inflight.delete(task));
    await task;
  }

  async #runStep(code) {
    let turn;
    try {
      turn = await this.#gameService.autoTurn(code);
    } catch (error) {
      this.#logger.error(`[AutoPlayerDriver] 방 ${code} 자동 진행 실패: ${error.message}`);
      await this.#retryOrStall(code, error.message);
      return;
    }
    if (!turn) {
      // 자동 좌석 차례가 아니다 — 카운터만 비운다. 대기 중인 타이머까지 지우면
      // 재진입으로 미뤄 둔 스텝이 사라진다.
      this.#steps.delete(code);
      this.#retries.delete(code);
      return;
    }

    const steps = (this.#steps.get(code) ?? 0) + 1;
    this.#steps.set(code, steps);
    if (steps > this.#maxSteps) {
      this.#logger.error(`[AutoPlayerDriver] 방 ${code}의 자동 진행 한도(${this.#maxSteps}) 초과`);
      this.cancel(code);
      return;
    }

    const decision = this.#policy.decide(turn.view);
    if (!decision) {
      this.#logger.error(`[AutoPlayerDriver] 방 ${code}에서 결정을 내리지 못했습니다`);
      await this.#retryOrStall(code, '결정 없음');
      return;
    }

    try {
      await this.#gameService.executeAsServer({
        code,
        seatId: turn.seatId,
        type: decision.type,
        payload: decision.payload,
        // 결정 근거가 된 버전. 그사이 사람이 움직였다면 서버가 거부하고 아래에서 다시 결정한다.
        expectedVersion: turn.version,
      });
      this.#retries.delete(code);
    } catch (error) {
      this.#logger.error(`[AutoPlayerDriver] 방 ${code} 자동 진행 실패: ${error.message}`);
      await this.#retryOrStall(code, error.message);
    }
  }

  /** 백오프를 두고 재시도하거나, 재시도를 모두 쓰면 멈춤을 알린다. */
  async #retryOrStall(code, reason) {
    const attempt = this.#retries.get(code) ?? 0;
    const delayMs = this.#retryDelaysMs[attempt];
    if (delayMs === undefined) {
      this.#logger.error(`[AutoPlayerDriver] 방 ${code} 자동 진행을 포기합니다(${reason})`);
      this.cancel(code);
      await this.#reportStalled(code);
      return;
    }
    this.#retries.set(code, attempt + 1);
    this.#scheduleAfter(code, delayMs);
  }

  /** 호스트가 알 수 있도록 방에 멈춤 신호를 방송한다. */
  async #reportStalled(code) {
    try {
      await this.#gameService.publishAutoStalled?.(code);
    } catch (error) {
      this.#logger.error(`[AutoPlayerDriver] 방 ${code} 멈춤 알림 실패: ${error.message}`);
    }
  }
}
