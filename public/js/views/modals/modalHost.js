/**
 * 모달/시트 호스트. 포커스 트랩 + Esc(닫을 수 있는 모달만) + 스택 관리를 담당한다.
 *
 * 사용법
 * - `present(spec)`: 같은 id가 이미 열려 있으면 본문만 갱신하고, 없으면 새로 연다.
 * - `spec = { id, title, subtitle, variant, dismissible, render(api), keepBody }`
 *   - `render(api)`는 본문 노드를 돌려준다. `api.close()`로 스스로 닫을 수 있다.
 *   - `keepBody: true`면 갱신 때 본문을 다시 만들지 않는다(카지노처럼 자체 상태를 가진 화면).
 */

import { button, el, focusableWithin, replaceChildren, setText } from '../../dom.js';

export function createModalHost(root) {
  /** @type {Array<{spec: object, backdrop: HTMLElement, body: HTMLElement, restoreFocus: Element|null}>} */
  const stack = [];

  const top = () => stack[stack.length - 1] ?? null;

  function closeTop() {
    const entry = top();
    if (!entry) {
      return;
    }
    close(entry.spec.id);
  }

  function onKeyDown(event) {
    const entry = top();
    if (!entry) {
      return;
    }
    if (event.key === 'Escape') {
      if (entry.spec.dismissible) {
        event.preventDefault();
        closeTop();
      }
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = focusableWithin(entry.backdrop);
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeyDown);

  /** 갱신 후에도 같은 곳에 포커스를 돌려주기 위한 키. */
  function focusKeyOf(node) {
    return node instanceof HTMLElement ? node.dataset.focusKey ?? null : null;
  }

  function renderBody(entry, api) {
    const previousKey = focusKeyOf(document.activeElement);
    replaceChildren(entry.body, entry.spec.render(api));
    if (previousKey) {
      const next = entry.body.querySelector(`[data-focus-key="${previousKey}"]`);
      if (next instanceof HTMLElement) {
        next.focus();
      }
    }
  }

  function open(spec) {
    const titleId = `modal-title-${spec.id}`;
    const body = el('div', { class: 'modal-body' });
    const api = { close: () => close(spec.id) };

    const dialog = el(
      'div',
      {
        class: ['modal', spec.variant ? `modal--${spec.variant}` : null],
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
      },
      [
        el('header', { class: 'modal-head' }, [
          el('div', { class: 'modal-heading' }, [
            el('h2', { class: 'modal-title', id: titleId, text: spec.title ?? '' }),
            spec.subtitle ? el('p', { class: 'modal-subtitle', text: spec.subtitle }) : null,
          ]),
          spec.dismissible
            ? button(
                { class: 'modal-close', 'aria-label': '닫기', on: { click: () => close(spec.id) } },
                '✕',
              )
            : null,
        ]),
        body,
      ],
    );

    const backdrop = el(
      'div',
      {
        class: ['modal-backdrop', spec.variant ? `modal-backdrop--${spec.variant}` : null],
        dataset: { modalId: spec.id },
      },
      dialog,
    );

    if (spec.dismissible) {
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) {
          close(spec.id);
        }
      });
    }

    const entry = { spec, backdrop, body, restoreFocus: document.activeElement };
    stack.push(entry);
    root.appendChild(backdrop);
    document.body.classList.add('modal-open');
    renderBody(entry, api);

    const focusable = focusableWithin(backdrop);
    (focusable[0] ?? dialog).focus?.();
    return api;
  }

  function close(id) {
    const index = stack.findIndex((entry) => entry.spec.id === id);
    if (index < 0) {
      return;
    }
    const [entry] = stack.splice(index, 1);
    entry.backdrop.remove();
    if (stack.length === 0) {
      document.body.classList.remove('modal-open');
    }
    const restore = entry.restoreFocus;
    if (restore instanceof HTMLElement && document.contains(restore)) {
      restore.focus();
    }
  }

  return {
    /** 열려 있으면 갱신, 없으면 새로 연다. */
    present(spec) {
      const existing = stack.find((entry) => entry.spec.id === spec.id);
      if (!existing) {
        return open(spec);
      }
      existing.spec = { ...existing.spec, ...spec };
      setText(existing.backdrop.querySelector('.modal-title'), spec.title ?? existing.spec.title ?? '');
      const subtitleNode = existing.backdrop.querySelector('.modal-subtitle');
      if (subtitleNode) {
        setText(subtitleNode, spec.subtitle ?? '');
      }
      if (!spec.keepBody) {
        renderBody(existing, { close: () => close(spec.id) });
      }
      return { close: () => close(spec.id) };
    },
    close,
    closeAll() {
      for (const entry of [...stack]) {
        close(entry.spec.id);
      }
    },
    /** 지정한 id들만 남기고 모두 닫는다(페이즈 전환 시). */
    closeOthers(keepIds) {
      const keep = new Set(keepIds);
      for (const entry of [...stack]) {
        if (!keep.has(entry.spec.id)) {
          close(entry.spec.id);
        }
      }
    },
    isOpen(id) {
      return stack.some((entry) => entry.spec.id === id);
    },
    get openIds() {
      return stack.map((entry) => entry.spec.id);
    },
    get hasModal() {
      return stack.length > 0;
    },
  };
}
