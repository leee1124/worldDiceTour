/**
 * 게임 로그 패널. 도메인 이벤트 한 건당 한국어 한 줄.
 * 문장 생성은 순수 모듈(domain/eventLog.js)이 담당하고 여기서는 표시만 한다.
 */

import { el } from '../dom.js';

const MAX_LINES = 240;

/** 줄 성격별 아이콘(이모지를 쓰지 않는 단순 기호 한 글자). */
const KIND_ICONS = Object.freeze({
  turn: '▶',
  info: '·',
  move: '→',
  'money-in': '＋',
  'money-out': '－',
  special: '◆',
  alert: '!',
  unknown: '?',
});

export function createLogView() {
  const listNode = el('ol', {
    class: 'log-list',
    role: 'log',
    // 턴 안내는 별도 aria-live 영역에서 읽어 주므로 로그는 읽지 않는다.
    'aria-live': 'off',
  });
  const element = el('section', { class: 'panel panel--log' }, [
    el('h2', { class: 'panel-title' }, ['게임 로그']),
    listNode,
  ]);

  function atBottom() {
    return listNode.scrollHeight - listNode.scrollTop - listNode.clientHeight < 48;
  }

  return {
    element,

    /** @param {Array<{kind: string, text: string}>} lines */
    append(lines) {
      if (lines.length === 0) {
        return;
      }
      const shouldScroll = atBottom();
      for (const line of lines) {
        listNode.appendChild(
          el('li', { class: ['log-line', `log-line--${line.kind}`] }, [
            el('span', { class: 'log-icon', 'aria-hidden': 'true', text: KIND_ICONS[line.kind] ?? '·' }),
            el('span', { class: 'log-text', text: line.text }),
          ]),
        );
      }
      while (listNode.children.length > MAX_LINES) {
        listNode.firstElementChild?.remove();
      }
      if (shouldScroll) {
        listNode.scrollTop = listNode.scrollHeight;
      }
    },

    clear() {
      while (listNode.firstChild) {
        listNode.removeChild(listNode.firstChild);
      }
    },
  };
}
