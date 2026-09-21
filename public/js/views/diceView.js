/**
 * 주사위 눈(pip)을 실제로 그리는 공용 컴포넌트.
 *
 * 중앙 코어 · 모바일 상황판 · 카지노가 모두 이 컴포넌트를 쓴다.
 * 값은 **항상 서버 이벤트(DICE_ROLLED / CASINO_RESULT)로만** 들어온다 — 여기서 난수를 만들지 않는다.
 *
 * 접근성: 눈은 장식(`aria-hidden`)이고, 숫자는 모서리 배지로 따로 보여 주며,
 * 주사위 자체는 `role="img"`와 `aria-label`로 읽힌다.
 */

import { el, setHidden, setText, toggleClass } from '../dom.js';
import { DURATIONS, prefersReducedMotion, scaled, wait } from '../animation/timing.js';

/** 3×3 격자라 눈 자리는 늘 9개다(어느 눈을 켤지는 CSS가 `data-face`로 고른다). */
const PIPS_PER_DIE = 9;

/** 아직 굴리지 않았음을 뜻하는 얼굴 값. */
const FACE_UNKNOWN = 0;

const MIN_FACE = 1;
const MAX_FACE = 6;

function normalizeFace(value) {
  const face = Number(value);
  return Number.isInteger(face) && face >= MIN_FACE && face <= MAX_FACE ? face : FACE_UNKNOWN;
}

/**
 * 주사위 한 개.
 * @param {string} label 스크린리더용 이름(예: "주사위 1")
 */
export function createDie(label) {
  const pips = el(
    'span',
    { class: 'die-pips', 'aria-hidden': 'true' },
    Array.from({ length: PIPS_PER_DIE }, () => el('span', { class: 'pip' })),
  );
  const numeral = el('span', { class: 'die-num', 'aria-hidden': 'true', text: '?' });
  const element = el(
    'div',
    {
      class: ['die', 'die--idle'],
      dataset: { face: String(FACE_UNKNOWN) },
      role: 'img',
      'aria-label': `${label} — 아직 굴리지 않았습니다`,
    },
    [pips, numeral],
  );

  return {
    element,
    /** 눈을 확정한다. 범위를 벗어난 값은 "아직 모름"으로 둔다(화면이 거짓말하지 않게). */
    set(value) {
      const face = normalizeFace(value);
      element.dataset.face = String(face);
      toggleClass(element, 'die--idle', face === FACE_UNKNOWN);
      setText(numeral, face === FACE_UNKNOWN ? '?' : String(face));
      element.setAttribute(
        'aria-label',
        face === FACE_UNKNOWN ? `${label} — 아직 굴리지 않았습니다` : `${label} ${face}`,
      );
      return face;
    },
    setRolling(rolling) {
      toggleClass(element, 'die--rolling', rolling);
    },
  };
}

/**
 * 주사위 두 개 + 합계 + 더블 표시 한 묶음.
 *
 * @param {{labels?: string[], variant?: string|null, compact?: boolean}} [options]
 * @returns {{element: HTMLElement, show: Function, roll: Function, reset: Function, setRolling: Function}}
 */
export function createDicePair({ labels = ['주사위 1', '주사위 2'], variant = null } = {}) {
  const dice = labels.map((label) => createDie(label));
  const sumNode = el('span', { class: 'dice-sum', text: '' });
  const doubleNode = el('span', { class: 'dice-double', text: '✨ 더블!' });
  setHidden(doubleNode, true);

  const element = el(
    'div',
    {
      class: ['dice-row', variant ? `dice-row--${variant}` : null],
      role: 'group',
      'aria-label': '주사위',
    },
    [...dice.map((die) => die.element), sumNode, doubleNode],
  );

  function setRolling(rolling) {
    for (const die of dice) {
      die.setRolling(rolling);
    }
    toggleClass(element, 'dice-row--rolling', rolling);
    if (rolling) {
      // 굴리는 동안에는 이전 합계를 지운다(다음 값이 확정될 때까지 오해를 막는다).
      setText(sumNode, '');
      setHidden(doubleNode, true);
      element.classList.remove('dice-row--settled');
    }
  }

  /** 연출 없이 값만 확정한다(빨리 감기 · 재접속 · 다른 기기에서 온 이벤트). */
  function show(value1, value2, { isDouble } = {}) {
    setRolling(false);
    const face1 = dice[0].set(value1);
    const face2 = dice[1].set(value2);
    const known = face1 !== FACE_UNKNOWN && face2 !== FACE_UNKNOWN;
    setText(sumNode, known ? `= ${face1 + face2}` : '');
    const doubled = known && (isDouble ?? face1 === face2);
    setHidden(doubleNode, !doubled);
    toggleClass(element, 'dice-row--double', Boolean(doubled));
    return known;
  }

  return {
    element,
    show,
    setRolling,
    /** 서버가 정한 눈으로 굴리는 연출을 재생한다. */
    async roll(value1, value2, options = {}) {
      if (prefersReducedMotion()) {
        show(value1, value2, options);
        return;
      }
      setRolling(true);
      await wait(scaled(DURATIONS.dice));
      show(value1, value2, options);
      element.classList.add('dice-row--settled');
      await wait(scaled(180));
      element.classList.remove('dice-row--settled');
    },
    /** 새 게임 등으로 값이 의미를 잃었을 때. */
    reset() {
      show(null, null);
    },
  };
}
