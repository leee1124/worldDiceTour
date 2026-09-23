/**
 * 회귀 방지: `scripts/buildIcons.js`가 만든 `public/js/views/iconPaths.js`(Lucide 아이콘 벡터
 * 데이터, 자동 생성 파일)가 계약을 지키는지 확인한다.
 *
 * - `icons.js`가 실제로 `libraryIcon('이름')`으로 참조하는 모든 이름이 데이터에 있어야 한다
 *   (하나라도 빠지면 화면에서 `libraryIcon()`이 던지는 에러로 즉시 드러나지만, 재생성을
 *   깜빡하고 커밋했을 때 CI에서 먼저 잡기 위한 테스트다).
 * - 자식 서술자는 화이트리스트에 있는 태그(path/circle/rect)만 쓴다.
 * - `style`/`href`/`xlink:href`나 외부 URL(`http(s)://`, `data:`)을 실어 나르는 속성이 없다
 *   (CSP가 `innerHTML`을 막는 대신 이 데이터를 신뢰하므로, 데이터 자체가 안전해야 한다).
 * - 라이브러리 아이콘의 viewBox는 lucide 원본 그대로 `0 0 24 24`다(게임 고유 손그림은
 *   `icons.js` 안에서 별도 16x16 좌표를 쓰며 이 파일이 다루는 대상이 아니다).
 * - 생성 파일에도 이모지가 없다(`tests/e2e/clientNoEmoji.test.js`와 같은 방침).
 */

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { LUCIDE_ICONS, LUCIDE_VERSION } from '../../public/js/views/iconPaths.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ICONS_JS_PATH = path.join(ROOT, 'public/js/views/icons.js');
const ICON_PATHS_JS_PATH = path.join(ROOT, 'public/js/views/iconPaths.js');

const KNOWN_TAGS = new Set(['path', 'circle', 'rect']);
const FORBIDDEN_ATTR_NAMES = new Set(['style', 'href', 'xlink:href', 'class', 'id', 'onload', 'onclick']);
const EXTERNAL_URL_PATTERN = /^(https?:)?\/\//i;
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}️\u{1F000}-\u{1F2FF}]/gu;

/** icons.js 소스에서 실제로 쓰는 `libraryIcon('이름')` 호출을 모두 뽑는다. */
function usedLibraryIconNames() {
  const source = fs.readFileSync(ICONS_JS_PATH, 'utf8');
  const names = new Set();
  const callRe = /libraryIcon\('([\w-]+)'\)/g;
  let match;
  while ((match = callRe.exec(source))) {
    names.add(match[1]);
  }
  return names;
}

test('icons.js가 참조하는 모든 lucide 아이콘 이름이 생성 데이터에 있다', () => {
  // given: icons.js 소스가 실제로 부르는 libraryIcon() 이름 목록
  const usedNames = usedLibraryIconNames();

  // when / then: 데이터 조회
  assert.ok(usedNames.size > 0, 'libraryIcon() 호출을 하나도 못 찾았다면 정규식이 깨진 것이다');
  for (const name of usedNames) {
    assert.ok(
      Object.hasOwn(LUCIDE_ICONS, name),
      `LUCIDE_ICONS에 '${name}'이 없다 — node scripts/buildIcons.js로 재생성했는지 확인`,
    );
  }
});

test('생성 데이터의 모든 아이콘이 화이트리스트 태그·속성만 쓴다', () => {
  // given: 생성된 아이콘 표 전체
  for (const [name, data] of Object.entries(LUCIDE_ICONS)) {
    // when / then: 자식 서술자마다 태그·속성을 검사
    assert.ok(Array.isArray(data.children) && data.children.length > 0, `${name}: 자식이 비어 있다`);
    for (const child of data.children) {
      assert.ok(KNOWN_TAGS.has(child.tag), `${name}: 알 수 없는 태그 '${child.tag}'`);
      for (const [attrName, attrValue] of Object.entries(child.attrs)) {
        assert.ok(
          !FORBIDDEN_ATTR_NAMES.has(attrName.toLowerCase()),
          `${name}: 금지된 속성 '${attrName}'이 들어 있다`,
        );
        if (typeof attrValue === 'string') {
          assert.ok(
            !EXTERNAL_URL_PATTERN.test(attrValue) && !attrValue.startsWith('data:') && !attrValue.startsWith('javascript:'),
            `${name}: 속성 '${attrName}'에 외부 URL/스킴이 들어 있다 (${attrValue})`,
          );
        }
      }
    }
  }
});

test('라이브러리 아이콘의 viewBox는 lucide 원본 그대로 0 0 24 24다', () => {
  // given/when/then: 데이터의 모든 항목이 24x24 그리드
  for (const [name, data] of Object.entries(LUCIDE_ICONS)) {
    assert.equal(data.viewBox, '0 0 24 24', `${name}: viewBox가 24x24가 아니다 (${data.viewBox})`);
  }
});

test('생성 파일에는 이모지가 없다', () => {
  // given: 생성된 iconPaths.js 원문
  const source = fs.readFileSync(ICON_PATHS_JS_PATH, 'utf8');

  // when
  const hits = source.match(EMOJI_PATTERN);

  // then
  assert.equal(hits, null, `이모지가 있으면 안 된다: ${JSON.stringify(hits)}`);
});

test('생성 파일 헤더가 손대지 말라고 밝히고, 버전 상수를 내보낸다', () => {
  // given
  const source = fs.readFileSync(ICON_PATHS_JS_PATH, 'utf8');

  // when / then
  assert.match(source, /자동 생성 파일/, '자동 생성 경고 문구가 있어야 한다');
  assert.equal(typeof LUCIDE_VERSION, 'string');
  assert.ok(LUCIDE_VERSION.length > 0);
});
