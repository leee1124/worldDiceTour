import { randomBytes } from 'node:crypto';

/** 좌석 토큰 발급기(32바이트 hex). */
export class TokenFactory {
  create() {
    return randomBytes(32).toString('hex');
  }
}
