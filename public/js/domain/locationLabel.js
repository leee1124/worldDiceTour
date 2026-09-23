/**
 * "지금 누가 어디에 있는가"를 글로 알려 주는 문구들.
 *
 * 보드에서 말을 못 찾겠다는 문제는 그림만으로 풀리지 않는다 — 중앙 패널과 플레이어 카드,
 * 모바일 상황판이 **칸 이름을 글자로도** 말해 준다.
 */

/** 현재 위치 줄의 접두어. */
export const LOCATION_PREFIX = '현재 위치';

/** 칸 이름을 모를 때 쓰는 자리표시자(빈 줄로 두면 자리가 흔들린다). */
const UNKNOWN_PLACE = '—';

/**
 * 중앙 패널·상황판에 쓰는 한 줄.
 * @param {string|null|undefined} spaceName 서버가 준 칸 이름
 */
export function currentLocationLabel(spaceName) {
  const name = typeof spaceName === 'string' && spaceName.length > 0 ? spaceName : UNKNOWN_PLACE;
  return `${LOCATION_PREFIX}: ${name}`;
}

/**
 * 플레이어 카드 한 줄("12번 · 이스탄불"). 조난·파산 같은 상태를 함께 드러낸다.
 *
 * @param {{index?: number, spaceName?: string, islandRemainingTurns?: number, eliminated?: boolean}} [player]
 */
export function playerCellLabel(player = {}) {
  if (player.eliminated) {
    return '파산 — 게임에서 빠졌습니다';
  }
  const hasIndex = Number.isInteger(player.index);
  const hasName = typeof player.spaceName === 'string' && player.spaceName.length > 0;
  if (!hasIndex && !hasName) {
    return '위치 확인 중';
  }
  if (!hasName) {
    return `${player.index}번 칸`;
  }

  const parts = [hasIndex ? `${player.index}번` : null, player.spaceName];
  if (Number.isFinite(player.islandRemainingTurns) && player.islandRemainingTurns > 0) {
    parts.push(`조난 ${player.islandRemainingTurns}턴`);
  }
  return parts.filter(Boolean).join(' · ');
}
