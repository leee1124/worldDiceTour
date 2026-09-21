import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

/**
 * 좌석 토큰 인증. 타이밍 안전 비교는 여기(infrastructure)에서만 하고,
 * 도메인에는 이미 해석된 seatId만 넘긴다.
 */
export class SeatAuthenticator {
  /**
   * @param {import('../domain/room/Room.js').Room} room
   * @param {string|undefined} token
   * @returns {string|null} 좌석 id 또는 null
   */
  resolveSeatId(room, token) {
    if (typeof token !== 'string' || token.length === 0) {
      return null;
    }
    return room.findSeatIdByToken(token, timingSafeCompare);
  }
}

/** 길이가 같을 때만 timingSafeEqual을 쓸 수 있다(토큰 길이는 고정이라 정보 노출이 없다). */
export function timingSafeCompare(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const left = Buffer.from(candidate, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
