/** 방 코드에 쓰는 글자(헷갈리는 I, O, 0, 1 제외). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 방 코드 길이. */
export const ROOM_CODE_LENGTH = 4;

/** 방 코드 형식 검증용 정규식. */
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}$/;

/**
 * 방 코드를 만든다. 난수는 주입된 RandomSource에서만 얻는다.
 * @param {import('../shared/interfaces.js').RandomSource} random
 */
export function generateRoomCode(random) {
  let code = '';
  for (let position = 0; position < ROOM_CODE_LENGTH; position += 1) {
    code += ROOM_CODE_ALPHABET[random.nextInt(0, ROOM_CODE_ALPHABET.length - 1)];
  }
  return code;
}

export function isValidRoomCode(code) {
  return typeof code === 'string' && ROOM_CODE_PATTERN.test(code);
}
