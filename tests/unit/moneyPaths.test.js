import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * 구조 규칙을 코드로 강제하는 테스트.
 *
 * "돈은 Treasury만 움직인다"는 규칙은 리뷰 습관으로는 반드시 새어 나간다. 새 금융 상품이
 * 붙을 때 누군가 `player.receive(...)` 한 줄을 쓰면 장부를 우회하고 보존 불변식이 조용히 깨진다.
 * 그래서 **호출 지점 자체를 검사**한다 — 새 파일이 생겨도 이 테스트가 자동으로 지킨다.
 */

const SRC_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));

/** src/ 아래 모든 .js 파일의 { relative, text }. */
function sourceFiles(dir = SRC_ROOT) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.js')) {
      files.push({
        relative: path.relative(SRC_ROOT, full).split(path.sep).join('/'),
        text: readFileSync(full, 'utf8'),
      });
    }
  }
  return files;
}

const FILES = sourceFiles();

/** 패턴에 걸리는 `파일:줄` 목록. */
function callSites(pattern) {
  const hits = [];
  for (const { relative, text } of FILES) {
    for (const [index, line] of text.split('\n').entries()) {
      if (new RegExp(pattern).test(line)) {
        hits.push(`${relative}:${index + 1} ${line.trim()}`);
      }
    }
  }
  return hits;
}

function assertOnlyIn(pattern, allowed, what) {
  const offenders = callSites(pattern).filter(
    (hit) => !allowed.some((file) => hit.startsWith(`${file}:`)),
  );
  assert.deepEqual(
    offenders,
    [],
    `${what}는 ${allowed.join(', ')} 밖에서 쓸 수 없다:\n${offenders.join('\n')}`,
  );
}

describe('돈 이동 경로(구조 규칙)', () => {
  it('src/ 아래 .js 파일을 실제로 훑는다(검사가 조용히 비어 있지 않게)', () => {
    // Given / When / Then
    assert.ok(FILES.length > 25, `검사한 파일이 너무 적다: ${FILES.length}`);
    assert.ok(
      FILES.some((file) => file.relative === 'domain/game/Treasury.js'),
      'Treasury.js를 찾지 못했다',
    );
  });

  it('플레이어 현금을 움직이는 호출은 Treasury에만 있다', () => {
    // Given (`.pay(` / `.receive(` = Player의 현금 입출)
    // When / Then
    assertOnlyIn('\\.pay\\(|\\.receive\\(', ['domain/game/Treasury.js'], '현금 입출 호출');
  });

  it('은행 장부를 바꾸는 호출은 Treasury에만 있다', () => {
    // Given / When / Then
    assertOnlyIn(
      'ledger\\.(payToBank|receiveFromBank|applyNet)\\(',
      ['domain/game/Treasury.js'],
      '장부 기록 호출',
    );
  });

  it('잭팟 적립금을 바꾸는 호출은 Treasury에만 있다', () => {
    // Given (Casino는 자기 잭팟 필드의 주인이지만, 움직이라고 시키는 것은 Treasury뿐이다)
    // When / Then
    assertOnlyIn(
      '(casino|Casino)\\.(accumulate|payOut)\\(',
      ['domain/game/Treasury.js'],
      '잭팟 적립/지급 호출',
    );
  });

  it('Game은 돈을 직접 만지지 않고 Treasury에만 위임한다', () => {
    // Given
    const game = FILES.find((file) => file.relative === 'domain/game/Game.js');

    // When
    const direct = game.text
      .split('\n')
      .filter((line) => /#ledger\.(payToBank|receiveFromBank|applyNet)\(|#casino\.(accumulate|payOut)\(|\.pay\(|\.receive\(/.test(line));

    // Then
    assert.deepEqual(direct, [], `Game.js가 돈을 직접 움직인다:\n${direct.join('\n')}`);
  });

  it('도메인은 node: 모듈을 import하지 않는다(순수 도메인)', () => {
    // Given / When
    const offenders = FILES.filter(
      (file) => file.relative.startsWith('domain/') && /from 'node:/.test(file.text),
    ).map((file) => file.relative);

    // Then
    assert.deepEqual(offenders, [], `도메인이 node: 모듈에 의존한다: ${offenders.join(', ')}`);
  });

  it('도메인은 application/infrastructure/server 레이어를 import하지 않는다', () => {
    // Given / When
    const offenders = FILES.filter(
      (file) =>
        file.relative.startsWith('domain/') &&
        /from '[^']*\/(application|infrastructure|server)\//.test(file.text),
    ).map((file) => file.relative);

    // Then
    assert.deepEqual(offenders, [], `도메인이 상위 레이어에 의존한다: ${offenders.join(', ')}`);
  });
});
