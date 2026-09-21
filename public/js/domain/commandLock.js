/**
 * 커맨드 중복 전송 방지 상태 기계.
 *
 * 왜 필요한가: 결정 버튼을 ~1초 간격으로 두 번 누르면 두 번째 클릭 시점에는
 * 이미 서버 응답이 와 있을 수 있다(연출은 아직 재생 중이어도). 그 상태에서
 * 커맨드가 또 나가면 서버는 이미 다음 차례로 넘어갔으므로 `ERR006`을 돌려준다.
 *
 * 그래서 "요청 성공"과 "화면이 실제로 다음 상태를 반영함"을 분리해서 잠근다.
 * - 보낼 때 잠근다.
 * - 성공해도 **더 최신 `view.version`이 실제로 도착할 때까지** 잠금을 유지한다
 *   (연출이 끝나고 최신 뷰가 반영되는 순간까지).
 * - 실패하면 즉시 푼다(토스트를 보고 바로 다시 시도할 수 있어야 한다).
 * - 스냅샷 재동기화(재접속 등)가 오면 버전 비교 없이 즉시 푼다.
 * - 보낼 때 기준으로 삼은 버전보다 낮거나 같은 버전은 "새 버전"으로 치지 않는다
 *   (SSE 재정렬·중복 방송, 방마다 1부터 다시 시작하는 버전 번호 방어).
 */

const STATE = Object.freeze({
  IDLE: 'IDLE',
  IN_FLIGHT: 'IN_FLIGHT',
  AWAITING_VERSION: 'AWAITING_VERSION',
});

export function createCommandLock() {
  let state = STATE.IDLE;
  let baseVersion = null;

  return {
    /** 지금 조작이 잠겨 있는지(어떤 이유로든 IDLE이 아니면 잠긴 것). */
    get locked() {
      return state !== STATE.IDLE;
    },

    /** 커맨드 전송 시작. `currentVersion`은 전송 시점의 `view.version`(있다면). */
    onSend(currentVersion) {
      state = STATE.IN_FLIGHT;
      baseVersion = Number.isInteger(currentVersion) ? currentVersion : null;
    },

    /**
     * 서버가 커맨드를 받아들였다. 다음 버전이 올 때까지는 계속 잠근다.
     * 단, SSE의 새 버전이 POST 응답보다 먼저 반영돼 이미 풀린 상태(IDLE)라면
     * 더 기다릴 버전이 없으므로 다시 잠그지 않는다(영구 잠금 방지).
     */
    onSuccess() {
      if (state !== STATE.IN_FLIGHT) {
        return;
      }
      state = STATE.AWAITING_VERSION;
    },

    /** 커맨드가 실패했다. 사용자가 바로 다시 시도할 수 있게 즉시 푼다. */
    onError() {
      state = STATE.IDLE;
      baseVersion = null;
    },

    /** 재접속 스냅샷 등으로 화면을 강제로 맞췄다. 버전 비교 없이 즉시 푼다. */
    onResync() {
      state = STATE.IDLE;
      baseVersion = null;
    },

    /**
     * 새 뷰가 반영됐을 때 호출한다. 보낼 때 기준 버전보다 실제로 커진 경우에만 푼다.
     * IDLE 상태에서 호출되면 아무 효과가 없다.
     */
    onView(version) {
      if (state === STATE.IDLE) {
        return;
      }
      if (!Number.isInteger(version)) {
        return;
      }
      if (baseVersion !== null && version <= baseVersion) {
        return;
      }
      state = STATE.IDLE;
      baseVersion = null;
    },
  };
}
