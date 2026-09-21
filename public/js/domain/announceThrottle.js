/**
 * `TURN_STARTED` 안내 스팸 방지.
 *
 * 컴퓨터/자동 진행끼리 주고받는 턴은 초당 한 번꼴로 `TURN_STARTED`가 온다.
 * 스크린 리더에는 그때마다 안내하지 않는다:
 * - 이 기기의 좌석 차례는 항상 즉시 알린다(직접 조작해야 하므로).
 * - 그 외(다른 기기·컴퓨터) 차례는 burst당 최소 {@link THROTTLE_MS} 간격으로 한 번만 알린다.
 */

export const THROTTLE_MS = 5000;

export function createTurnAnnouncer({ throttleMs = THROTTLE_MS } = {}) {
  let lastRemoteAt = -Infinity;

  return {
    /**
     * 이 턴 안내를 화면에 내보내야 하는지 결정한다(부수효과: 내보내기로 했으면 내부 타이머를 갱신한다).
     * @param {{isLocalSeat: boolean, now?: number}} input
     * @returns {boolean}
     */
    shouldAnnounceTurn({ isLocalSeat, now = Date.now() }) {
      if (isLocalSeat) {
        return true;
      }
      if (now - lastRemoteAt >= throttleMs) {
        lastRemoteAt = now;
        return true;
      }
      return false;
    },

    /** 게임 종료처럼 항상 알리는 이벤트 다음에는 원격 차례 안내 제한을 다시 시작한다. */
    reset() {
      lastRemoteAt = -Infinity;
    },
  };
}
