/**
 * 한국어 조사 붙이기. 로그 문장을 자연스럽게 만들기 위한 순수 함수.
 * 한글 음절의 종성 유무로 조사를 고르고, 한글이 아닌 이름(영문·숫자)은 종성이 있는 것으로 본다.
 */

/**
 * 숫자로 끝나는 이름(예: "컴퓨터1")은 숫자를 읽은 소리의 받침을 따른다.
 * 영(ㅇ) 일(ㄹ) 이(-) 삼(ㅁ) 사(-) 오(-) 육(ㄱ) 칠(ㄹ) 팔(ㄹ) 구(-)
 */
const DIGIT_FINALS = Object.freeze({
  0: { hasFinal: true, isRieul: false },
  1: { hasFinal: true, isRieul: true },
  2: { hasFinal: false, isRieul: false },
  3: { hasFinal: true, isRieul: false },
  4: { hasFinal: false, isRieul: false },
  5: { hasFinal: false, isRieul: false },
  6: { hasFinal: true, isRieul: false },
  7: { hasFinal: true, isRieul: true },
  8: { hasFinal: true, isRieul: true },
  9: { hasFinal: false, isRieul: false },
});

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const JONGSEONG_COUNT = 28;
/** 종성 'ㄹ'의 인덱스. 'ㄹ' 뒤에서는 '으로'가 아니라 '로'를 쓴다. */
const RIEUL = 8;

function finalConsonant(word) {
  const text = String(word ?? '');
  if (text.length === 0) {
    return { hasFinal: true, isRieul: false };
  }
  const last = text[text.length - 1];
  if (DIGIT_FINALS[last]) {
    return DIGIT_FINALS[last];
  }
  const code = text.codePointAt(text.length - 1);
  if (code < HANGUL_START || code > HANGUL_END) {
    // 영문 이름 등은 받침이 있는 것으로 본다("Tom이", "Ann이").
    return { hasFinal: true, isRieul: false };
  }
  const jongseong = (code - HANGUL_START) % JONGSEONG_COUNT;
  return { hasFinal: jongseong !== 0, isRieul: jongseong === RIEUL };
}

/** 주격: 하나 → "하나가", 서울 → "서울이" */
export function subject(word) {
  return `${word}${finalConsonant(word).hasFinal ? '이' : '가'}`;
}

/** 목적격: 방콕 → "방콕을", 파리 → "파리를" */
export function object(word) {
  return `${word}${finalConsonant(word).hasFinal ? '을' : '를'}`;
}

/** 주제격: 하나 → "하나는", 서울 → "서울은" */
export function topic(word) {
  return `${word}${finalConsonant(word).hasFinal ? '은' : '는'}`;
}

/** 방향: 서울 → "서울로", 방콕 → "방콕으로", 파리 → "파리로" */
export function direction(word) {
  const { hasFinal, isRieul } = finalConsonant(word);
  return `${word}${hasFinal && !isRieul ? '으로' : '로'}`;
}

/** 여격: 하나 → "하나에게" (받침 무관) */
export function to(word) {
  return `${word}에게`;
}
