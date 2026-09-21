/**
 * 컴퓨터/자동 진행 좌석의 턴을 짧은 지연 뒤 대신 진행한다.
 * - 방마다 타이머가 하나만 존재하고(중복 발사 방지), 진행 중이면 새 실행을 건너뛴다(재진입 방지).
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
  /** @type {Map<string, any>} */
  #pending = new Map();
  /** @type {Set<string>} */
  #running = new Set();
  /** @type {Set<Promise<void>>} */
  #inflight = new Set();
  /** @type {Map<string, number>} */
  #steps = new Map();
  #stopped = false;

  constructor({
    delayMs = 800,
    policy,
    gameService,
    logger,
    timers = { setTimeout, clearTimeout },
    maxStepsPerRoom = 5_000,
  }) {
    this.#delayMs = delayMs;
    this.#policy = policy;
    this.#gameService = gameService;
    this.#logger = logger ?? console;
    this.#timers = timers;
    this.#maxSteps = maxStepsPerRoom;
  }

  /** 현재 턴이 자동 좌석이면 한 스텝을 예약한다. */
  schedule(code) {
    if (this.#stopped) {
      return;
    }
    this.cancelTimer(code);
    const handle = this.#timers.setTimeout(() => {
      this.#pending.delete(code);
      void this.#step(code);
    }, this.#delayMs);
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
  }

  /** 서버 종료용. 모든 타이머를 정리하고 더 이상 예약하지 않는다. */
  stop() {
    this.#stopped = true;
    for (const code of [...this.#pending.keys()]) {
      this.cancelTimer(code);
    }
    this.#steps.clear();
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
    try {
      const turn = await this.#gameService.autoTurn(code);
      if (!turn) {
        this.#steps.delete(code);
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
        return;
      }
      await this.#gameService.executeAsServer({
        code,
        seatId: turn.seatId,
        type: decision.type,
        payload: decision.payload,
      });
    } catch (error) {
      this.#logger.error(`[AutoPlayerDriver] 방 ${code} 자동 진행 실패: ${error.message}`);
    }
  }
}
