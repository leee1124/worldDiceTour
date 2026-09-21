/**
 * `GAME_OVER` 이벤트를 못 받은 채(재접속 스냅샷 등) 종료 사유를 추정한다.
 *
 * 서버 판정 순서(Game.js)와 같은 우선순위를 쓴다: 생존자가 1명 이하로 줄면
 * 라운드 제한보다 먼저 `LAST_SURVIVOR`로 끝난다. 판단할 수 없으면 `null`을 돌려주고,
 * 호출부는 부제(subtitle) 없이 그냥 넘어간다.
 */

export function inferGameOverReason(view) {
  if (!view || view.isOver !== true) {
    return null;
  }

  const alive = (view.players ?? []).filter((player) => !player.eliminated).length;
  if (alive <= 1) {
    return 'LAST_SURVIVOR';
  }

  if (view.roundLimit != null && view.round > view.roundLimit) {
    return 'ROUND_LIMIT';
  }

  return null;
}
