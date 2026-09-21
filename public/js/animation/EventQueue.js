/**
 * 도메인 이벤트 재생 큐. DOM에 의존하지 않는다(그래서 Node에서 그대로 테스트된다).
 *
 * 규칙:
 * - `view.version`은 단조 증가한다. 더 낮은 버전은 버린다(SSE 재정렬·중복 방어).
 * - 커맨드 응답과 SSE 방송이 같은 내용을 두 번 주므로, 같은 버전의 "이벤트 있는" 메시지는 버린다.
 * - 같은 버전의 "이벤트 없는" 메시지는 재접속 스냅샷이므로 뷰만 갱신한다.
 * - 재생이 밀리면(컴퓨터 좌석이 0.8초마다 커맨드를 보낸다) 빨리 감기로 전환하고,
 *   상한을 넘으면 오래된 이벤트를 버려 항상 최신 뷰로 수렴한다.
 */
export class EventPlaybackQueue {
  /** @type {object[]} */
  #events = [];
  /** @type {object|null} */
  #targetView = null;
  #latestVersion = -1;
  #maxEvents;
  #fastForwardThreshold;

  constructor({ maxEvents = 200, fastForwardThreshold = 16 } = {}) {
    this.#maxEvents = maxEvents;
    this.#fastForwardThreshold = fastForwardThreshold;
  }

  /** 재생을 기다리는 이벤트 수. */
  get size() {
    return this.#events.length;
  }

  /** 재생이 끝나면 그릴 최신 뷰. */
  get targetView() {
    return this.#targetView;
  }

  get latestVersion() {
    return this.#latestVersion;
  }

  /** 밀린 이벤트가 임계치를 넘었는지(연출 생략 여부). */
  get fastForward() {
    return this.#events.length > this.#fastForwardThreshold;
  }

  /**
   * `game` SSE 메시지 또는 커맨드 응답을 받아들인다.
   * @param {{view?: object|null, events?: object[]}|null} message
   * @returns {boolean} 반영했는지(false면 오래되거나 중복된 메시지)
   */
  accept(message) {
    if (!message || typeof message !== 'object') {
      return false;
    }
    const events = Array.isArray(message.events) ? message.events : [];
    const version = message.view?.version;

    if (Number.isInteger(version)) {
      const isSnapshot = events.length === 0;
      if (version < this.#latestVersion) {
        return false;
      }
      if (version === this.#latestVersion && !isSnapshot) {
        return false;
      }
      this.#latestVersion = version;
      this.#targetView = message.view;
    } else if (events.length === 0) {
      return false;
    }

    for (const event of events) {
      if (event && typeof event === 'object') {
        this.#events.push(event);
      }
    }
    this.#trim();
    return true;
  }

  /** 다음 재생할 이벤트. 없으면 null. */
  shift() {
    return this.#events.shift() ?? null;
  }

  /** 재접속 스냅샷: 쌓인 연출을 버리고 현재 상태부터 다시 시작한다. */
  reset(view) {
    this.#events.length = 0;
    const version = view?.version;
    if (Number.isInteger(version) && version >= this.#latestVersion) {
      this.#latestVersion = version;
      this.#targetView = view;
    }
  }

  /** 연출만 버리고 목표 뷰는 유지한다(탭 비활성 등). */
  clearEvents() {
    this.#events.length = 0;
  }

  #trim() {
    while (this.#events.length > this.#maxEvents) {
      this.#events.shift();
    }
  }
}
