/**
 * 모든 응답(JSON·정적 파일·SSE)에 공통으로 붙이는 보안 헤더.
 * 한곳에서만 정의해 응답 종류마다 빠지는 일이 없게 한다.
 */
export const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});
