/**
 * 일시 안내 카드의 **단일 창구**. 티켓·통행료·조난 결과·월급·바퀴·잭팟 안내가 모두 여기를 지난다.
 *
 * 폰에서 "카드가 뜰 때 안 꺼진다"는 신고를 못 재현했기 때문에, 원인을 추측하지 않고
 * **어떤 경로로도 카드가 남을 수 없게** 만든다.
 *
 * 1. 노드를 붙이는 그 자리에서 **동기적으로** `setTimeout` 페일세이프를 건다.
 *    연출이 예외로 끊기든, 탭이 백그라운드로 가서 타이머가 밀리든, 이 타이머가 노드를 걷어 낸다.
 * 2. 제거는 `animationend`·`transitionend`·`requestAnimationFrame`에 **절대** 기대지 않는다.
 *    (백그라운드 탭·iOS 저전력에서 rAF는 멈춘다 — 예전 코드는 여기서 멈추면 카드가 영원히 남았다.)
 * 3. 화면 어디를 눌러도 즉시 닫힌다(포인터·터치·클릭·키보드 모두).
 *    iOS에서 비대화형 요소의 click 위임이 새는 경우까지 대비해 window 캡처 단계에도 건다.
 * 4. 창구가 하나라 **카드가 겹쳐 쌓이지 않는다**. 새 카드가 오면 이전 카드를 즉시 걷어 낸다.
 * 5. 사라지기 시작하는 순간 `pointer-events: none` — 카드가 보이지 않는 동안 입력을 막는 일이 없다.
 * 6. 읽는 시간은 `domain/noticeTiming.js`가 정한다(모션 축소로 줄지 않는다).
 *
 * 카드는 결정 모달(`.overlay-root`)보다 **아래**에 깔린다. 혹시라도 카드가 남더라도
 * 모달의 버튼을 덮어 조작을 막을 수 없다.
 */

import { el } from '../../dom.js';
import { DISMISS_HINT, noticeTiming, remainingLabel } from '../../domain/noticeTiming.js';
import { prefersReducedMotion } from '../../animation/timing.js';

/** 사라지는 연출에 주는 시간(이 시간이 지나면 무조건 DOM에서 뗀다). */
const LEAVE_MS = 200;

/** 지금 화면에 있는 안내. 창구가 하나라 카드가 쌓이지 않는다. */
let current = null;

function hardRemove(node) {
  try {
    node.remove();
  } catch (error) {
    console.error('[notice] 안내 카드를 떼지 못했습니다', error);
  }
}

/** 열려 있는 안내를 즉시 정리한다(새 안내가 오거나 화면을 떠날 때). */
function closeCurrent(immediate = false) {
  const entry = current;
  if (!entry) {
    return;
  }
  current = null;
  entry.dismiss(immediate);
}

/** 화면 전환(방 떠나기 등)에서 남은 안내를 걷어 낸다. */
export function clearNotices() {
  closeCurrent(true);
}

/** 지금 안내가 떠 있는지(결정 모달을 잠깐 늦출지 판단할 때 쓴다). */
export function isNoticeVisible() {
  return current !== null;
}

/** 남은 시간을 보여 주는 얇은 진행 바 + "탭하면 닫힘" 힌트. */
function noticeFoot({ readMs, showProgress }) {
  const fill = el('span', {
    class: 'notice-progress-fill',
    style: { '--notice-ms': `${readMs}ms` },
  });
  return el('div', { class: 'notice-foot' }, [
    el('span', { class: ['notice-progress', showProgress ? null : 'notice-progress--static'] }, [fill]),
    el('span', {
      class: 'notice-hint',
      // 모션 축소에서는 움직이는 바 대신 남은 시간을 글자로 알린다.
      text: showProgress ? DISMISS_HINT : `${remainingLabel(readMs)} · ${DISMISS_HINT}`,
    }),
  ]);
}

/**
 * 안내를 하나 보여 주고, 사라질 때 resolve한다. **절대 영원히 pending이 되지 않는다.**
 *
 * @param {{
 *   kind: string, mine?: boolean, fastForward?: boolean, variant?: string,
 *   card: () => Node|Node[], line: string, onShown?: (node: HTMLElement) => void,
 * }} options `card`는 전체 카드 본문, `line`은 빨리 감기용 한 줄 문구
 * @returns {Promise<void>}
 */
export function showNotice({ kind, mine = false, fastForward = false, variant = '', card, line, onShown }) {
  const timing = noticeTiming({ kind, mine, fastForward, reducedMotion: prefersReducedMotion() });

  // 새 안내가 오면 이전 안내는 즉시 사라진다(겹쳐 쌓이지 않는다).
  closeCurrent(true);

  const asCard = timing.mode === 'card';
  const node = asCard
    ? el(
        'div',
        {
          class: ['notice-overlay', variant ? `notice-overlay--${variant}` : null],
          role: 'status',
          'aria-live': 'polite',
          dataset: { noticeKind: timing.kind, failsafeMs: String(timing.failsafeMs) },
        },
        [el('div', { class: 'notice-card' }, [card(), noticeFoot(timing)])],
      )
    : el(
        'div',
        {
          class: ['notice-line', variant ? `notice-line--${variant}` : null],
          role: 'status',
          'aria-live': 'polite',
          dataset: { noticeKind: timing.kind, failsafeMs: String(timing.failsafeMs) },
        },
        [el('span', { class: 'notice-line-text', text: line ?? '' })],
      );

  document.body.appendChild(node);

  let settled = false;
  let closed = false;
  /** @type {number[]} */
  const timers = [];
  let resolveShown = () => {};
  const shown = new Promise((resolve) => {
    resolveShown = resolve;
  });

  const settle = () => {
    if (settled) {
      return;
    }
    settled = true;
    resolveShown();
  };

  const stopTimers = () => {
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
    timers.length = 0;
  };

  const detachInput = () => {
    window.removeEventListener('pointerdown', onAnyPointer, true);
    window.removeEventListener('touchstart', onAnyPointer, true);
    window.removeEventListener('click', onAnyPointer, true);
    window.removeEventListener('keydown', onAnyKey, true);
  };

  /** 닫기. 몇 번 불려도 안전하고, 어떤 경로로 불려도 노드를 확실히 뗀다. */
  const dismiss = (immediate = false) => {
    if (closed) {
      return;
    }
    closed = true;
    stopTimers();
    detachInput();
    if (current && current.node === node) {
      current = null;
    }
    // 보이지 않게 되는 순간부터 입력을 가로채지 않는다.
    node.classList.add('notice--leaving');
    node.style.pointerEvents = 'none';
    if (immediate) {
      hardRemove(node);
    } else {
      // 사라지는 연출이 끝나기를 기다리되, 기다림의 근거는 타이머 하나뿐이다.
      window.setTimeout(() => hardRemove(node), LEAVE_MS);
    }
    settle();
  };

  function onAnyPointer() {
    dismiss(true);
  }

  function onAnyKey(event) {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      dismiss(true);
    }
  }

  current = { node, dismiss };

  // ① 페일세이프: 노드를 붙인 바로 이 자리에서 동기적으로 건다.
  //    아래 어떤 코드가 실패하더라도 카드는 이 시간 안에 반드시 사라진다.
  //    `timers`에 넣지 않는다 — 정상 닫기가 시작된 뒤에도 "정말 떼어졌는지" 마지막으로 확인한다.
  window.setTimeout(() => {
    if (document.body.contains(node)) {
      console.error('[notice] 안내 카드가 제 시간에 닫히지 않아 강제로 걷어 냈습니다', timing.kind);
      hardRemove(node);
    }
    dismiss(true);
  }, timing.failsafeMs);

  // ② 정상 수명.
  timers.push(window.setTimeout(() => dismiss(false), timing.readMs));

  // ③ 아무 곳이나 누르면 즉시 닫힌다.
  node.addEventListener('pointerdown', onAnyPointer);
  node.addEventListener('click', onAnyPointer);
  window.addEventListener('pointerdown', onAnyPointer, true);
  window.addEventListener('touchstart', onAnyPointer, true);
  window.addEventListener('click', onAnyPointer, true);
  window.addEventListener('keydown', onAnyKey, true);

  try {
    onShown?.(node);
  } catch (error) {
    // 등장 연출이 실패해도 카드의 수명에는 영향이 없다.
    console.error('[notice] 안내 등장 연출 실패', timing.kind, error);
  }

  return shown;
}

/**
 * 금액/상태 변화 안내(조난 결과 · 월급 · 바퀴 · 잭팟). 서버 문자열만 조합한다.
 *
 * @param {{kind: string, mine?: boolean, fastForward?: boolean, tone?: string,
 *   eyebrow: string, headline: string, amount?: string, note?: string}} options
 */
export function playInfoNotice({ kind, mine = false, fastForward = false, tone = 'info', eyebrow, headline, amount = '', note = '' }) {
  return showNotice({
    kind,
    mine,
    fastForward,
    variant: 'info',
    line: [eyebrow, headline, amount].filter(Boolean).join(' · '),
    card: () =>
      el('div', { class: ['info-notice', `info-notice--${tone}`] }, [
        el('span', { class: 'info-notice-eyebrow', text: eyebrow }),
        el('p', { class: 'info-notice-headline', text: headline }),
        amount ? el('p', { class: 'info-notice-amount', text: amount }) : null,
        note ? el('p', { class: 'info-notice-note', text: note }) : null,
      ]),
  });
}
