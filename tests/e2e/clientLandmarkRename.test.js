/**
 * 회귀 방지: 화면에 보이는 이름은 "랜드마크"가 아니라 "관광명소"다(오너 방침).
 *
 * 식별자(`LANDMARK`, `landmark`, `LANDMARK_BUILT`, `board[].landmark` 등)는 서버 계약과
 * 저장된 방 데이터 호환을 위해 그대로 둔다 — 영문 식별자에는 애초에 한글이 없으므로,
 * 소스 전체에서 "랜드마크"(한글) 글자만 찾아도 식별자를 건드릴 위험 없이 검증할 수 있다.
 */

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OLD_NAME = '랜드마크';

function collectFiles(dir, extension) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full, extension));
    } else if (entry.isFile() && full.endsWith(extension)) {
      files.push(full);
    }
  }
  return files;
}

function findHits(files) {
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [lineIndex, lineText] of text.split('\n').entries()) {
      if (lineText.includes(OLD_NAME)) {
        hits.push(`${path.relative(ROOT, file)}:${lineIndex + 1} → ${lineText.trim()}`);
      }
    }
  }
  return hits;
}

test('표시 이름: public/js 어디에도 "랜드마크"라는 옛 이름이 남아 있지 않다', () => {
  // Given 클라이언트 자바스크립트 전체
  const files = collectFiles(path.join(ROOT, 'public/js'), '.js');

  // When 옛 표시 이름을 찾으면
  const hits = findHits(files);

  // Then 하나도 없다(전부 "관광명소"로 바뀌었다) — LANDMARK/landmark 식별자는 한글이 아니라 그대로 남는다
  assert.deepEqual(hits, [], `옛 표시 이름이 남아 있다:\n${hits.join('\n')}`);
});

test('표시 이름: public/styles 어디에도 "랜드마크"라는 옛 이름이 남아 있지 않다', () => {
  // Given 클라이언트 스타일시트 전체(주석 포함)
  const files = collectFiles(path.join(ROOT, 'public/styles'), '.css');

  // When 옛 표시 이름을 찾으면
  const hits = findHits(files);

  // Then 하나도 없다
  assert.deepEqual(hits, [], `옛 표시 이름이 남아 있다:\n${hits.join('\n')}`);
});

test('표시 이름: 건물 라벨 표는 관광명소로 등록되어 있고 식별자 키는 그대로다', async () => {
  // Given 건물 라벨 사전
  const { BUILDING_LABELS, buildingLabel } = await import('../../public/js/domain/labels.js');

  // When LANDMARK 키를 조회하면
  // Then 키(식별자)는 LANDMARK 그대로이고, 값(표시 이름)만 관광명소다
  assert.equal(Object.prototype.hasOwnProperty.call(BUILDING_LABELS, 'LANDMARK'), true);
  assert.equal(BUILDING_LABELS.LANDMARK, '관광명소');
  assert.equal(buildingLabel('LANDMARK'), '관광명소');
});
