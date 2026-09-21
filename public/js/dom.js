/**
 * DOM 생성 도우미.
 *
 * **XSS 원칙**: 이 모듈에는 `innerHTML`이 없다. 모든 텍스트는 `textContent`
 * 또는 `createTextNode`로만 들어가므로 서버/사용자 문자열이 마크업으로 해석될 수 없다.
 * 인라인 이벤트 속성(`onclick` 등)은 만들 수 없도록 막는다(CSP `script-src 'self'`).
 */

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const INLINE_HANDLER = /^on/i;

function appendChild(parent, child) {
  if (child === null || child === undefined || child === false) {
    return;
  }
  if (Array.isArray(child)) {
    for (const item of child) {
      appendChild(parent, item);
    }
    return;
  }
  if (child instanceof Node) {
    parent.appendChild(child);
    return;
  }
  parent.appendChild(document.createTextNode(String(child)));
}

function applyClass(node, value) {
  const names = Array.isArray(value) ? value.filter(Boolean) : String(value).split(/\s+/);
  for (const name of names) {
    if (name) {
      node.classList.add(name);
    }
  }
}

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    switch (key) {
      case 'class':
        applyClass(node, value);
        break;
      case 'text':
        node.textContent = String(value);
        break;
      case 'on':
        for (const [type, listener] of Object.entries(value)) {
          node.addEventListener(type, listener);
        }
        break;
      case 'dataset':
        for (const [name, item] of Object.entries(value)) {
          if (item !== undefined && item !== null) {
            node.dataset[name] = String(item);
          }
        }
        break;
      case 'style':
        for (const [name, item] of Object.entries(value)) {
          if (name.startsWith('--')) {
            node.style.setProperty(name, String(item));
          } else {
            node.style[name] = String(item);
          }
        }
        break;
      default:
        if (INLINE_HANDLER.test(key)) {
          throw new Error(`인라인 이벤트 속성은 쓸 수 없습니다: ${key}`);
        }
        node.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

/**
 * HTML 요소를 만든다.
 * @param {string} tag
 * @param {object} [props] class/text/on/dataset/style 외의 키는 속성으로 설정된다
 * @param {*} [children] 노드·문자열·배열(문자열은 항상 텍스트 노드가 된다)
 */
export function el(tag, props = {}, children = null) {
  const node = document.createElement(tag);
  applyProps(node, props);
  appendChild(node, children);
  return node;
}

/** 인라인 SVG 요소를 만든다(이미지 에셋 없이 아이콘을 그리기 위해). */
export function svg(tag, attrs = {}, children = null) {
  const node = document.createElementNS(SVG_NAMESPACE, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (INLINE_HANDLER.test(key)) {
      throw new Error(`인라인 이벤트 속성은 쓸 수 없습니다: ${key}`);
    }
    node.setAttributeNS(null, key, String(value));
  }
  appendChild(node, children);
  return node;
}

/** 버튼(기본 type="button"). */
export function button(props = {}, children = null) {
  return el('button', { type: 'button', ...props }, children);
}

/** 자식 전부 제거. */
export function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/** 자식을 한 번에 갈아끼운다. */
export function replaceChildren(node, children) {
  clear(node);
  appendChild(node, children);
  return node;
}

/** 외부 문자열을 안전하게 넣는다. */
export function setText(node, text) {
  node.textContent = text === undefined || text === null ? '' : String(text);
  return node;
}

/** 조건부 표시. */
export function setHidden(node, hidden) {
  node.hidden = Boolean(hidden);
  return node;
}

export function toggleClass(node, name, on) {
  node.classList.toggle(name, Boolean(on));
  return node;
}

/** 라벨 + 값 한 줄(정의 목록 대신 쓰는 작은 조각). */
export function fieldRow(label, value, extraClass) {
  return el('div', { class: ['field-row', extraClass] }, [
    el('span', { class: 'field-label', text: label }),
    el('span', { class: 'field-value', text: value }),
  ]);
}

/** 포커스 가능한 요소 목록(모달 포커스 트랩용). */
export function focusableWithin(root) {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'summary',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return [...root.querySelectorAll(selector)].filter(
    (node) => !node.hidden && node.offsetParent !== null,
  );
}
