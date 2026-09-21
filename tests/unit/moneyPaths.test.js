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
 *
 * 그래서 **두 겹으로** 막는다:
 *   ① 잔액을 바꾸는 메서드 **집합 자체**를 고정한다(`Player`의 `#cash`, `Casino`의 `#jackpot`,
 *      `BankLedger`의 장부 필드). 새 입출금 메서드를 추가하면 그 순간 빌드가 깨진다 —
 *      호출 지점만 검사하면 `player.credit(...)` 같은 새 이름이 그대로 통과하기 때문이다.
 *   ② ①에서 찾아낸 이름들의 **호출 지점**이 허용된 파일 밖에 없는지 검사한다.
 *
 * ②의 검사 패턴은 ①의 결과에서 만들어지므로, 규칙이 저절로 따라온다.
 */

const SRC_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));

/** 돈을 옮기는 유일한 파일. */
const TREASURY = 'domain/game/Treasury.js';

/** src/ 아래 모든 자바스크립트 파일의 { relative, text }. */
function sourceFiles(dir = SRC_ROOT) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      files.push({
        relative: path.relative(SRC_ROOT, full).split(path.sep).join('/'),
        text: readFileSync(full, 'utf8'),
      });
    }
  }
  return files;
}

const FILES = sourceFiles();
const fileNamed = (relative) => {
  const found = FILES.find((file) => file.relative === relative);
  assert.ok(found, `검사 대상 파일을 찾지 못했다: ${relative}`);
  return found;
};

/**
 * 클래스 본문에서 `this.<field>`에 **대입하는** 메서드 이름 목록.
 * 어떤 메서드가 잔액을 바꾸는지를 소스에서 직접 읽어 온다.
 */
function mutatorsOf(text, field) {
  const assigns = new RegExp(`this\\.${field}\\s*(?:=[^=]|\\+=|-=|\\*=|/=|\\+\\+|--)`);
  const header = /^ {2}(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(#?[A-Za-z_$][\w$]*)\s*\(/;
  const names = new Set();
  let current = null;
  for (const line of text.split('\n')) {
    const match = line.match(header);
    if (match) {
      current = match[1];
    }
    if (assigns.test(line)) {
      assert.ok(current, `${field}를 메서드 밖에서 바꾼다: ${line.trim()}`);
      names.add(current);
    }
  }
  return [...names].sort();
}

/** 패턴에 걸리는 `파일:줄 내용` 목록. */
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

/**
 * 메서드 이름들의 호출 지점 패턴.
 * `obj.name(`, `obj.name (`, `obj?.name(`, `obj['name']`를 모두 잡는다.
 */
function callPattern(names) {
  const alternation = names.join('|');
  return `\\.\\s*(?:${alternation})\\s*\\(|\\[\\s*['"](?:${alternation})['"]\\s*\\]`;
}

describe('돈 이동 경로(구조 규칙)', () => {
  it('src/ 아래 모든 자바스크립트 파일을 실제로 훑는다(검사가 조용히 비어 있지 않게)', () => {
    // Given / When / Then
    assert.ok(FILES.length >= 55, `검사한 파일이 너무 적다: ${FILES.length}`);
    fileNamed(TREASURY);
    fileNamed('domain/game/Player.js');
    fileNamed('domain/game/Casino.js');
    fileNamed('domain/game/BankLedger.js');
  });

  describe('① 잔액을 바꾸는 메서드 집합을 고정한다', () => {
    it('Player의 현금을 바꾸는 메서드는 pay/receive(+생성·탈락)뿐이다', () => {
      // Given / When
      const mutators = mutatorsOf(fileNamed('domain/game/Player.js').text, '#cash');

      // Then (새 입출금 메서드를 만들면 여기서 깨진다 → Treasury를 거치도록 고치라는 신호)
      assert.deepEqual(mutators, ['constructor', 'eliminate', 'pay', 'receive']);
    });

    it('Casino의 잭팟을 바꾸는 메서드는 accumulate/payOut(+생성)뿐이다', () => {
      // Given / When
      const mutators = mutatorsOf(fileNamed('domain/game/Casino.js').text, '#jackpot');

      // Then
      assert.deepEqual(mutators, ['accumulate', 'constructor', 'payOut']);
    });

    it('은행 장부를 바꾸는 메서드는 applyNet(+생성) 하나뿐이다', () => {
      // Given
      const ledger = fileNamed('domain/game/BankLedger.js').text;

      // When / Then
      assert.deepEqual(mutatorsOf(ledger, '#fromBank'), ['applyNet', 'constructor']);
      assert.deepEqual(mutatorsOf(ledger, '#toBank'), ['applyNet', 'constructor']);
      assert.deepEqual(mutatorsOf(ledger, '#byReason'), ['constructor']);
    });

    it('현금·잭팟·장부 필드는 그 파일 밖에서 이름조차 등장하지 않는다(직접 대입 차단)', () => {
      // Given (private 필드라 문법적으로도 불가능하지만, 이름이 새는 것 자체를 막는다)
      const owners = {
        '#cash': 'domain/game/Player.js',
        '#jackpot': 'domain/game/Casino.js',
        '#fromBank': 'domain/game/BankLedger.js',
        '#toBank': 'domain/game/BankLedger.js',
      };

      // When / Then
      for (const [field, owner] of Object.entries(owners)) {
        assertOnlyIn(`this\\.${field}\\b`, [owner], `${field} 직접 접근`);
      }
    });
  });

  describe('② 그 메서드들의 호출 지점은 Treasury에만 있다', () => {
    it('플레이어 현금 입출 호출은 Treasury에만 있다', () => {
      // Given (검사 패턴을 ①의 결과에서 만든다 — 새 이름이 생기면 자동으로 함께 검사된다)
      const mutators = mutatorsOf(fileNamed('domain/game/Player.js').text, '#cash').filter(
        (name) => name !== 'constructor' && name !== 'eliminate',
      );

      // When / Then
      assertOnlyIn(callPattern(mutators), [TREASURY], `현금 입출 호출(${mutators.join('/')})`);
    });

    it('잭팟 적립/지급 호출은 Treasury에만 있다', () => {
      // Given (Casino는 자기 잭팟 필드의 주인이지만, 움직이라고 시키는 것은 Treasury뿐이다)
      const mutators = mutatorsOf(fileNamed('domain/game/Casino.js').text, '#jackpot').filter(
        (name) => name !== 'constructor',
      );

      // When / Then
      assertOnlyIn(callPattern(mutators), [TREASURY], `잭팟 변경 호출(${mutators.join('/')})`);
    });

    it('은행 장부 기록 호출은 Treasury에만 있다', () => {
      // Given
      const mutators = mutatorsOf(fileNamed('domain/game/BankLedger.js').text, '#fromBank').filter(
        (name) => name !== 'constructor',
      );

      // When / Then
      assertOnlyIn(callPattern(mutators), [TREASURY], `장부 기록 호출(${mutators.join('/')})`);
    });
  });

  describe('레이어 규칙', () => {
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
});
