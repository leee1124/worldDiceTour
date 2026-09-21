import { DOMAIN_ERROR_CODES, DomainError } from '../domain/shared/DomainError.js';

/**
 * 클라이언트에 나가는 유일한 에러 형식: { code, message }.
 * 메시지는 안전한 한국어 고정 문구이며, 내부 사유는 서버 로그로만 남긴다.
 */
export const ERROR_CATALOG = Object.freeze({
  ERR001: { status: 400, message: '요청 형식이 올바르지 않습니다.' },
  ERR002: { status: 401, message: '좌석 인증에 실패했습니다.' },
  ERR003: { status: 403, message: '권한이 없습니다.' },
  ERR004: { status: 404, message: '방을 찾을 수 없습니다.' },
  ERR005: { status: 409, message: '지금은 할 수 없는 동작입니다.' },
  ERR006: { status: 409, message: '당신의 차례가 아닙니다.' },
  ERR007: { status: 409, message: '방의 좌석이 모두 찼습니다.' },
  ERR008: { status: 409, message: '현금이 부족합니다.' },
  ERR009: { status: 413, message: '요청 본문이 너무 큽니다.' },
  ERR010: { status: 500, message: '요청을 처리할 수 없습니다.' },
  ERR011: { status: 404, message: '요청한 경로를 찾을 수 없습니다.' },
  ERR012: { status: 409, message: '좌석을 찾을 수 없습니다.' },
  ERR013: { status: 409, message: '게임을 시작할 수 없습니다.' },
  ERR014: { status: 405, message: '허용되지 않은 요청 방식입니다.' },
  ERR015: { status: 403, message: '허용되지 않은 접속 주소입니다.' },
});

/** 도메인 사유 코드 → 클라이언트 에러 코드 매핑. */
const DOMAIN_TO_APP = Object.freeze({
  [DOMAIN_ERROR_CODES.INVALID_ARGUMENT]: 'ERR001',
  [DOMAIN_ERROR_CODES.INVALID_STATE]: 'ERR005',
  [DOMAIN_ERROR_CODES.INVALID_PHASE]: 'ERR005',
  [DOMAIN_ERROR_CODES.NOT_YOUR_TURN]: 'ERR006',
  [DOMAIN_ERROR_CODES.INSUFFICIENT_CASH]: 'ERR008',
  [DOMAIN_ERROR_CODES.NOT_HOST]: 'ERR003',
  [DOMAIN_ERROR_CODES.FORBIDDEN]: 'ERR003',
  [DOMAIN_ERROR_CODES.ROOM_FULL]: 'ERR007',
  [DOMAIN_ERROR_CODES.SEAT_NOT_FOUND]: 'ERR012',
  [DOMAIN_ERROR_CODES.NOT_ENOUGH_SEATS]: 'ERR013',
});

export class AppError extends Error {
  #code;
  #status;
  #safeMessage;
  #detail;

  /**
   * @param {keyof typeof ERROR_CATALOG} code
   * @param {string} [detail] 서버 로그 전용 상세 사유
   */
  constructor(code, detail) {
    const entry = ERROR_CATALOG[code] ?? ERROR_CATALOG.ERR010;
    super(detail ?? entry.message);
    this.name = 'AppError';
    this.#code = ERROR_CATALOG[code] ? code : 'ERR010';
    this.#status = entry.status;
    this.#safeMessage = entry.message;
    this.#detail = detail ?? null;
  }

  get code() {
    return this.#code;
  }

  get status() {
    return this.#status;
  }

  get detail() {
    return this.#detail;
  }

  /** 클라이언트로 내보낼 본문. */
  toBody() {
    return { code: this.#code, message: this.#safeMessage };
  }

  /** 도메인/알 수 없는 예외를 규격 에러로 변환한다. */
  static from(error) {
    if (error instanceof AppError) {
      return error;
    }
    if (error instanceof DomainError) {
      return new AppError(DOMAIN_TO_APP[error.code] ?? 'ERR001', error.message);
    }
    return new AppError('ERR010', error?.message ?? '알 수 없는 오류');
  }
}
