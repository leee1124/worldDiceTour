/**
 * 상대 행동 알림 줄. 화면 위쪽에 **한 번에 하나씩** 떴다가 사라진다.
 *
 * 오너 요청: "상대방이 뭘 하는지 로그 말고 토스트 메시지로 떴으면 좋겠음."
 *
 * 설계 원칙(안내 카드와 같다)
 * - 수명은 알림이 들고 온 `ttl`이 정한다. **모션 축소로 줄이지 않는다**(읽는 시간이다).
 * - 제거는 `animationend`/`transitionend`/rAF에 기대지 않는다 — 타이머 하나뿐이고,
 *   더 늦게 도는 페일세이프가 노드를 반드시 걷어 낸다.
 * - 아무 곳이나 누르면 즉시 닫힌다.
 * - 결정 모달보다 **아래** 층에 그린다(z-index). 모달 버튼을 절대 가리지 않는다.
 * - 화면 낭독은 기존 차례 안내(announceThrottle)가 맡는다 — 여기서는 `aria-hidden`으로 두어
 *   같은 내용을 두 번 읽지 않게 한다(로그 패널이 접근성 경로를 이미 담당한다).
 */

import { el, setText } from '../dom.js';
import { coalesceNotices } from '../domain/opponentNotice.js';

/** 사라지는 연출에 주는 시간(이 시간이 지나면 무조건 DOM에서 뗀다). */
const LEAVE_MS = 180;
/** 수명을 넘겨도 남아 있으면 강제로 걷어 내는 시점. */
const FAILSAFE_EXTRA_MS = 1500;

export function createOpponentToastHost(root) {
  const strip = el('div', { class: 'opponent-strip', 'aria-hidden': 'true' });
  root.appendChild(strip);

  /** @type {Array<object>} 최대 한 개만 기다린다. */
  let pending = [];
  /** @type {{node: HTMLElement, timers: number[]}|null} */
  let current = null;

  function removeNow(entry) {
    // pointerdown과 click이 잇달아 오므로 두 번 불려도 안전해야 한다.
    if (!entry || entry.closed) {
      return;
    }
    entry.closed = true;
    for (const timer of entry.timers) {
      window.clearTimeout(timer);
    }
    entry.node.classList.add('opponent-toast--leaving');
    entry.node.style.pointerEvents = 'none';
    window.setTimeout(() => entry.node.remove(), LEAVE_MS);
    if (current === entry) {
      current = null;
    }
    showNext();
  }

  function showNext() {
    if (current || pending.length === 0) {
      return;
    }
    const item = pending.shift();
    const node = el(
      'div',
      {
        class: ['opponent-toast', `opponent-toast--${item.tone ?? 'info'}`],
        dataset: { kind: item.kind, failsafeMs: String(item.ttl + FAILSAFE_EXTRA_MS) },
      },
      [el('span', { class: 'opponent-toast-text', text: item.text })],
    );
    const entry = { node, timers: [], closed: false };
    current = entry;
    strip.appendChild(node);

    // 수명 타이머와, 그보다 늦게 도는 페일세이프를 **노드를 붙인 자리에서** 함께 건다.
    entry.timers.push(window.setTimeout(() => removeNow(entry), item.ttl));
    window.setTimeout(() => {
      if (document.contains(node)) {
        node.remove();
        if (current === entry) {
          current = null;
          showNext();
        }
      }
    }, item.ttl + FAILSAFE_EXTRA_MS);

    node.addEventListener('pointerdown', () => removeNow(entry));
    node.addEventListener('click', () => removeNow(entry));
  }

  return {
    element: strip,

    /** 알림 하나를 넣는다. 보여 주는 중이면 한 개만 예약하고, 같은 종류는 최신 것으로 덮는다. */
    push(item) {
      if (!item) {
        return;
      }
      pending = coalesceNotices(pending, item);
      showNext();
    },

    /**
     * 빨리 감기: 쌓인 예약을 버리고 **가장 최근 것 하나만** 남긴다.
     * (밀린 상황에서 지나간 알림을 차례로 보여 주는 것은 의미가 없다.)
     */
    keepLatestOnly() {
      pending = pending.slice(-1);
    },

    /** 화면을 떠날 때 남은 알림을 모두 걷어 낸다. */
    clear() {
      pending = [];
      const entry = current;
      current = null;
      if (entry) {
        for (const timer of entry.timers) {
          window.clearTimeout(timer);
        }
        entry.node.remove();
      }
    },
  };
}
