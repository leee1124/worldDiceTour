/**
 * 차례 순서에서 나오는 문구들(순수 로직). DOM을 모른다.
 *
 * 오너 피드백: 라운드가 언제 넘어가는지, 내 차례까지 몇 명 남았는지 화면에서 알 수 없었다.
 * 좌석 순서(`view.players`)가 곧 차례 순서이므로, 지금 차례 **뒤에 오는 좌석**이 이번 라운드에
 * 남은 차례다. 서버에 새 필드를 요구하지 않고 이미 오는 뷰만으로 만든다.
 */

/** 이름이 비어 온 좌석도 한 자리를 차지해야 "몇 명 남았는지"가 어긋나지 않는다. */
const UNNAMED = '이름 없음';

/**
 * 이번 라운드에 아직 차례가 오지 않은 좌석들.
 *
 * @param {{players?: Array<{seatId: string, name?: string, eliminated?: boolean}>|null,
 *   currentSeatId?: string|null, isOver?: boolean}} [view]
 * @returns {{names: string[], isLast: boolean, label: string}}
 */
export function remainingTurnsOf({ players = [], currentSeatId = null, isOver = false } = {}) {
  const empty = { names: [], isLast: false, label: '' };
  if (isOver || !Array.isArray(players) || players.length === 0 || !currentSeatId) {
    return empty;
  }
  // 파산해 빠진 좌석은 차례가 돌아오지 않는다.
  const alive = players.filter((player) => player && !player.eliminated);
  const at = alive.findIndex((player) => player.seatId === currentSeatId);
  if (at < 0) {
    return empty;
  }
  const names = alive.slice(at + 1).map((player) => player.name || UNNAMED);
  if (names.length === 0) {
    return { names, isLast: true, label: '이번 라운드 마지막 차례' };
  }
  return { names, isLast: false, label: `이번 라운드 남은 차례: ${names.join(', ')}` };
}

/** 라운드 시작 로그 한 줄. "전원이 한 바퀴 돌았다"는 뜻을 함께 적는다. */
export function roundStartLine(round) {
  const value = Number.isInteger(round) && round > 0 ? `${round}라운드` : '새 라운드';
  return `${value} 시작 · 전원 한 바퀴 완료`;
}
