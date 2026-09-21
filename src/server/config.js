/**
 * 환경변수 검증. 잘못된 값으로 조용히 기본값으로 떨어지지 않고, 이유를 밝히며 즉시 실패한다
 * (`Number.parseInt('80abc')`가 80을 주는 식의 조용한 오작동을 막는다).
 */

export const DEFAULT_PORT = 5173;
export const DEFAULT_AUTO_PLAY_DELAY_MS = 800;

/** 순수한 10진 정수 문자열만 통과시킨다. */
function parseStrictInteger(raw) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    return null;
  }
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * "설정하지 않음"으로 볼 값. 완전히 빈 값만 해당한다 —
 * 공백만 든 값은 오타일 가능성이 크므로 조용히 기본값으로 떨어지지 않고 실패시킨다.
 */
const isBlank = (raw) => raw === undefined || raw === null || raw === '';

/**
 * `PORT` 환경변수 → 포트 번호.
 * @throws {Error} 1~65535 정수가 아니면
 */
export function resolvePort(raw) {
  if (isBlank(raw)) {
    return DEFAULT_PORT;
  }
  const value = parseStrictInteger(String(raw));
  if (value === null || value < 1 || value > 65_535) {
    throw new Error(`PORT 환경변수가 올바르지 않습니다: ${JSON.stringify(raw)} (1~65535 정수여야 합니다)`);
  }
  return value;
}

/**
 * `AUTO_PLAY_DELAY_MS` 환경변수 → 자동 진행 연출 지연(ms).
 * @throws {Error} 0 이상 정수가 아니면
 */
export function resolveAutoPlayDelay(raw) {
  if (isBlank(raw)) {
    return DEFAULT_AUTO_PLAY_DELAY_MS;
  }
  const value = parseStrictInteger(String(raw));
  if (value === null) {
    throw new Error(
      `AUTO_PLAY_DELAY_MS 환경변수가 올바르지 않습니다: ${JSON.stringify(raw)} (0 이상 정수여야 합니다)`,
    );
  }
  return value;
}
