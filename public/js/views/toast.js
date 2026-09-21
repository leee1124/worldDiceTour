/**
 * 토스트 안내. 에러는 **서버가 준 message만** 보여준다(자세한 내용은 console.error).
 */

import { button, el } from '../dom.js';

const LIFETIME_MS = 4200;
const MAX_VISIBLE = 3;

export function createToastHost(root) {
  const stack = el('div', { class: 'toast-stack' });
  root.appendChild(stack);

  function dismiss(node) {
    node.classList.add('toast--leaving');
    window.setTimeout(() => node.remove(), 240);
  }

  function push({ message, tone = 'info', title = '' }) {
    while (stack.children.length >= MAX_VISIBLE) {
      stack.firstElementChild?.remove();
    }
    const toast = el(
      'div',
      {
        class: ['toast', `toast--${tone}`],
        role: tone === 'error' ? 'alert' : 'status',
        'aria-live': tone === 'error' ? 'assertive' : 'polite',
      },
      [
        el('div', { class: 'toast-body' }, [
          title ? el('strong', { class: 'toast-title', text: title }) : null,
          el('span', { class: 'toast-message', text: message }),
        ]),
        button({ class: 'toast-close', 'aria-label': '알림 닫기', on: { click: () => dismiss(toast) } }, '✕'),
      ],
    );
    stack.appendChild(toast);
    window.setTimeout(() => dismiss(toast), LIFETIME_MS);
  }

  return {
    element: stack,
    info(message, title = '') {
      push({ message, tone: 'info', title });
    },
    success(message, title = '') {
      push({ message, tone: 'success', title });
    },
    /** @param {{code: string, message: string}} error 서버 규격 에러 */
    error(error) {
      push({ message: error?.message ?? '요청을 처리할 수 없습니다.', tone: 'error', title: '알림' });
    },
  };
}
