#!/usr/bin/env node
/**
 * Lucide 아이콘 벡터 데이터 생성기.
 *
 * CSP가 `innerHTML`을 막기 때문에(`public/js/dom.js` 참고) 아이콘을 SVG 마크업 문자열이 아니라
 * "viewBox + 자식 엘리먼트 서술자(JS 객체)" 데이터로 내보낸다. `public/js/views/icons.js`가
 * `dom.js`의 `svg()` 헬퍼로 이 데이터를 노드로 조립해 그린다.
 *
 * 입력은 이미 저장소에 받아 둔 원본 SVG(`third_party/lucide/svg/*.svg`, lucide-static
 * v1.47.0, ISC/MIT 라이선스 — `third_party/lucide/LICENSE`·`NOTICE.md` 참고)뿐이다.
 * 네트워크 접근이 없으므로 오프라인에서도 재생성할 수 있다.
 *
 * 사용법:
 *   node scripts/buildIcons.js
 *
 * 아이콘 추가/교체:
 *   1. 새 아이콘의 `.svg`를 `third_party/lucide/svg/`에 받는다.
 *   2. 아래 `ICON_NAMES`에 파일명(확장자 제외)을 추가한다.
 *   3. 다시 `node scripts/buildIcons.js`를 실행해 `iconPaths.js`를 재생성한다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SVG_DIR = path.join(ROOT, 'third_party/lucide/svg');
const OUT_FILE = path.join(ROOT, 'public/js/views/iconPaths.js');
const LUCIDE_VERSION = '1.47.0';

// 실제로 화면에서 쓰는 lucide 아이콘만 나열한다(라이브러리 전체를 담지 않는다).
// icons.js의 어느 함수가 어떤 이름을 쓰는지는 icons.js 안의 `libraryIcon(name)` 호출을 grep.
const ICON_NAMES = [
  'flag',
  'plane',
  'ticket',
  'stamp',
  'x',
  'lock',
  'map-pin',
  'sun',
  'moon',
  'sun-moon',
  'search',
  'target',
  'circle-help',
  'trending-up',
  'landmark',
  'newspaper',
  'receipt',
  'arrow-left-right',
  'flame',
  'cloud-rain',
  'sprout',
];

// 아이콘 데이터에 들어갈 수 있는 태그와, 태그별로 허용하는 속성의 화이트리스트.
// (stroke/fill/style/class/href 등은 절대 포함하지 않는다 — 색은 항상 상위 <svg>의 currentColor를 물려받는다.)
const ATTR_WHITELIST = {
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
};

const NUMERIC_ATTRS = new Set(['cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'ry']);

function parseAttrs(tag, rawAttrText) {
  const whitelist = ATTR_WHITELIST[tag];
  const attrs = {};
  const attrRe = /([\w-]+)="([^"]*)"/g;
  let match;
  while ((match = attrRe.exec(rawAttrText))) {
    const [, name, value] = match;
    if (!whitelist.includes(name)) {
      continue; // 원본 SVG의 class 등은 아이콘 데이터에 필요 없으니 버린다.
    }
    attrs[name] = NUMERIC_ATTRS.has(name) ? Number(value) : value;
  }
  return attrs;
}

function parseSvg(source, name) {
  const viewBoxMatch = source.match(/viewBox="([^"]+)"/);
  if (!viewBoxMatch) {
    throw new Error(`${name}.svg: viewBox를 찾을 수 없습니다`);
  }
  const viewBox = viewBoxMatch[1];

  // 화이트리스트 밖의 도형(line·polyline·polygon·ellipse·g 등)이 섞여 있으면 **즉시 실패**한다.
  // 조용히 버리면 일부 도형이 빠진 아이콘이 그대로 생성되고 테스트도 잡지 못한다(코드리뷰 지적).
  const body = source.slice(source.indexOf('>', source.indexOf('<svg')) + 1);
  const unknown = new Set();
  const anyTagRe = /<([a-zA-Z][\w-]*)\b/g;
  let tagMatch;
  while ((tagMatch = anyTagRe.exec(body))) {
    const tag = tagMatch[1];
    if (tag !== 'svg' && !ATTR_WHITELIST[tag]) {
      unknown.add(tag);
    }
  }
  if (unknown.size > 0) {
    throw new Error(
      `${name}.svg: 지원하지 않는 태그가 있습니다(<${[...unknown].join('>, <')}>) — buildIcons.js의 ATTR_WHITELIST와 icons.js의 조립 코드를 먼저 확장하세요`,
    );
  }

  const children = [];
  const tagRe = /<(path|circle|rect)\s+([^>]*?)\/?>/g;
  let match;
  while ((match = tagRe.exec(source))) {
    const [, tag, rawAttrText] = match;
    children.push({ tag, attrs: parseAttrs(tag, rawAttrText) });
  }
  if (children.length === 0) {
    throw new Error(`${name}.svg: path/circle/rect 자식 엘리먼트를 찾지 못했습니다`);
  }
  return { viewBox, children };
}

function buildIconTable() {
  const icons = {};
  for (const name of ICON_NAMES) {
    const filePath = path.join(SVG_DIR, `${name}.svg`);
    const source = readFileSync(filePath, 'utf8');
    icons[name] = parseSvg(source, name);
  }
  return icons;
}

function render(icons) {
  return `/**
 * Lucide 아이콘 벡터 데이터 — **자동 생성 파일. 손으로 고치지 말 것.**
 *
 * 생성 명령: \`node scripts/buildIcons.js\`
 * 원본: lucide-static v${LUCIDE_VERSION} (ISC/MIT, third_party/lucide/LICENSE · NOTICE.md),
 *       third_party/lucide/svg/*.svg
 *
 * CSP가 innerHTML을 막으므로(public/js/dom.js) SVG 마크업 문자열이 아니라
 * "viewBox + 자식 엘리먼트 서술자" 데이터로 내보낸다. public/js/views/icons.js의
 * libraryIcon()이 dom.js의 svg() 헬퍼로 이 데이터를 조립해 currentColor · 선 굵기 2 아이콘을 그린다.
 */

/** 생성에 쓰인 lucide-static 버전(재생성 시 참고용). */
export const LUCIDE_VERSION = '${LUCIDE_VERSION}';

/** 아이콘 이름 → { viewBox, children: [{ tag, attrs }] }. */
export const LUCIDE_ICONS = Object.freeze(${JSON.stringify(icons, null, 2)});
`;
}

function main() {
  const icons = buildIconTable();
  writeFileSync(OUT_FILE, render(icons));
  const sizeKb = (Buffer.byteLength(render(icons), 'utf8') / 1024).toFixed(1);
  console.log(`생성 완료: ${path.relative(ROOT, OUT_FILE)} (아이콘 ${ICON_NAMES.length}개, ${sizeKb} KB)`);
}

main();
