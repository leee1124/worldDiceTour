/**
 * 도메인 규칙 위반을 나타내는 예외.
 * `code`는 도메인 내부 사유 코드이며, 클라이언트에 노출되는 `ERR0xx` 코드와 안전한 메시지는
 * application 레이어(errors.js)에서 매핑한다. 내부 메시지는 서버 로그 용도로만 사용한다.
 */
export const DOMAIN_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_PHASE: 'INVALID_PHASE',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  INSUFFICIENT_CASH: 'INSUFFICIENT_CASH',
  NOT_HOST: 'NOT_HOST',
  /** 호스트 여부와 무관한 권한 위반(예: 자동 진행 중인 좌석을 사람이 조종하려는 시도). */
  FORBIDDEN: 'FORBIDDEN',
  ROOM_FULL: 'ROOM_FULL',
  SEAT_NOT_FOUND: 'SEAT_NOT_FOUND',
  NOT_ENOUGH_SEATS: 'NOT_ENOUGH_SEATS',
  /**
   * 거래 한도 위반(창구 주문 수·명목금액·종목 보유 상한·예금 한도·예약 주문 수).
   *
   * "형식이 틀렸다"(`INVALID_ARGUMENT`)도 "돈이 없다"(`INSUFFICIENT_CASH`)도 아니라
   * **규칙이 허용하는 양을 넘었다**는 뜻이므로 별도 사유다. 화면이 "이번 창구에서는 더 살 수 없습니다"를
   * 정확히 안내할 수 있어야 하기 때문이다.
   */
  TRADE_LIMIT: 'TRADE_LIMIT',
});

export class DomainError extends Error {
  #code;
  #details;

  /**
   * @param {string} code DOMAIN_ERROR_CODES 중 하나
   * @param {string} message 내부 진단용 메시지(클라이언트로 그대로 보내지 않는다)
   * @param {string|null} [details] 같은 사유 안에서의 **세부 종류**(기계가 읽는 값).
   *   호출자가 사유를 더 잘게 구분해야 할 때 쓴다 — 예전에는 한국어 메시지를 정규식으로
   *   분류했는데, 문구를 다듬는 것만으로 분기가 조용히 바뀌었다. 클라이언트로는 나가지 않는다.
   */
  constructor(code, message, details = null) {
    super(message);
    this.name = 'DomainError';
    this.#code = code;
    this.#details = details;
  }

  get code() {
    return this.#code;
  }

  get details() {
    return this.#details;
  }

  static invalidArgument(message) {
    return new DomainError(DOMAIN_ERROR_CODES.INVALID_ARGUMENT, message);
  }

  static invalidState(message) {
    return new DomainError(DOMAIN_ERROR_CODES.INVALID_STATE, message);
  }

  static invalidPhase(message) {
    return new DomainError(DOMAIN_ERROR_CODES.INVALID_PHASE, message);
  }

  static notYourTurn(message) {
    return new DomainError(DOMAIN_ERROR_CODES.NOT_YOUR_TURN, message);
  }

  static insufficientCash(message) {
    return new DomainError(DOMAIN_ERROR_CODES.INSUFFICIENT_CASH, message);
  }

  static notHost(message) {
    return new DomainError(DOMAIN_ERROR_CODES.NOT_HOST, message);
  }

  static forbidden(message) {
    return new DomainError(DOMAIN_ERROR_CODES.FORBIDDEN, message);
  }

  static roomFull(message) {
    return new DomainError(DOMAIN_ERROR_CODES.ROOM_FULL, message);
  }

  static seatNotFound(message) {
    return new DomainError(DOMAIN_ERROR_CODES.SEAT_NOT_FOUND, message);
  }

  static notEnoughSeats(message) {
    return new DomainError(DOMAIN_ERROR_CODES.NOT_ENOUGH_SEATS, message);
  }

  static tradeLimit(message, details = null) {
    return new DomainError(DOMAIN_ERROR_CODES.TRADE_LIMIT, message, details);
  }
}
