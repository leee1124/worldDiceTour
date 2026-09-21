/**
 * 방 관련 서버 에러 판별. `docs/API.md` 3장: `ERR004` = 방을 찾을 수 없음(404).
 */

export const ROOM_NOT_FOUND_CODE = 'ERR004';

/** 방이 이미 사라졌다는 에러인지(저장된 방 목록에서 지워야 하는 신호). */
export function isRoomGoneError(error) {
  return Boolean(error) && error.code === ROOM_NOT_FOUND_CODE;
}
