/**
 * 회귀 방지: 클라이언트 화면 코드에는 이모지를 쓰지 않는다(오너 방침).
 *
 * "이모지 쓰면 너무 프로토타입 느낌이라 안 쓰고 개발했으면 좋겠음" — 대신 평범한 글자,
 * 인라인 SVG(`views/icons.js`), CSS 도형을 쓴다. 이 테스트는 `public/js`, `public/styles`,
 * `public/index.html`, `public/favicon.svg`를 훑어 이모지 코드포인트가 하나도 없는지 확인한다.
 *
 * 예외: `public/js/domain/slotSymbols.js`는 서버가 실제로 보내는 이모지 심볼 id를 유니코드
 * 이스케이프(`\u{1F352}` 등)로 옮겨 담는 계약 매핑 표다. 소스에 이모지 글자를 직접 적지 않으므로
 * 이 스캔에도 걸리지 않는다 — 그래서 예외 목록에 넣을 필요가 없다(문자 자체가 없다).
 */

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** 스캔에서 쓰는 이모지 범위(오너가 지정한 grep 패턴과 같다). */
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}️\u{1F000}-\u{1F2FF}]/gu;

/** 디렉터리를 재귀적으로 훑어 파일 경로 목록을 만든다. */
function collectFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function findEmojiHits(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const hits = [];
  for (const [lineIndex, lineText] of text.split('\n').entries()) {
    const matches = lineText.match(EMOJI_PATTERN);
    if (matches) {
      hits.push({ line: lineIndex + 1, matches, lineText });
    }
  }
  return hits;
}

function reportAllHits(files) {
  const report = [];
  for (const file of files) {
    for (const hit of findEmojiHits(file)) {
      report.push(`${path.relative(ROOT, file)}:${hit.line} → ${JSON.stringify(hit.matches)} (${hit.lineText.trim()})`);
    }
  }
  return report;
}

test('화면 코드: public/js에는 이모지가 없다', () => {
  // Given 클라이언트 자바스크립트 전체
  const files = collectFiles(path.join(ROOT, 'public/js')).filter((file) => file.endsWith('.js'));

  // When 이모지 범위로 스캔하면
  const report = reportAllHits(files);

  // Then 하나도 걸리지 않는다
  assert.deepEqual(report, [], `이모지가 남아 있다:\n${report.join('\n')}`);
});

test('화면 코드: public/styles에는 이모지가 없다', () => {
  // Given 클라이언트 스타일시트 전체
  const files = collectFiles(path.join(ROOT, 'public/styles')).filter((file) => file.endsWith('.css'));

  // When 이모지 범위로 스캔하면
  const report = reportAllHits(files);

  // Then 하나도 걸리지 않는다
  assert.deepEqual(report, [], `이모지가 남아 있다:\n${report.join('\n')}`);
});

test('화면 코드: index.html · favicon.svg에는 이모지가 없다', () => {
  // Given 최상위 정적 파일
  const files = [path.join(ROOT, 'public/index.html'), path.join(ROOT, 'public/favicon.svg')].filter((file) =>
    fs.existsSync(file),
  );

  // When 이모지 범위로 스캔하면
  const report = reportAllHits(files);

  // Then 하나도 걸리지 않는다
  assert.deepEqual(report, [], `이모지가 남아 있다:\n${report.join('\n')}`);
});
