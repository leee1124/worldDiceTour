import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readStaticFile } from '../../src/server/staticFiles.js';

let root;
let outside;
const silentLogger = { error: () => {} };

beforeEach(async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'wdt-static-'));
  root = path.join(base, 'public');
  outside = path.join(base, 'secret');
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<h1>안녕</h1>', 'utf8');
  await writeFile(path.join(outside, 'tokens.json'), '{"token":"비밀"}', 'utf8');
});

afterEach(async () => {
  await rm(path.dirname(root), { recursive: true, force: true });
});

describe('정적 파일 서빙(경로 탈출 방지)', () => {
  it('루트 요청은 index.html을 돌려준다', async () => {
    // Given / When
    const result = await readStaticFile(root, '/', { logger: silentLogger });

    // Then
    assert.match(result.content.toString('utf8'), /안녕/);
    assert.match(result.contentType, /text\/html/);
  });

  it('상위 경로로 올라가려는 시도를 막는다', async () => {
    // Given / When / Then
    await assert.rejects(
      () => readStaticFile(root, '/../secret/tokens.json', { logger: silentLogger }),
      { code: 'ERR011' },
    );
  });

  it('인코딩된 상위 경로도 막는다', async () => {
    // Given / When / Then
    await assert.rejects(
      () => readStaticFile(root, '/%2e%2e/secret/tokens.json', { logger: silentLogger }),
      { code: 'ERR011' },
    );
  });

  it('public 안의 심볼릭 링크가 바깥을 가리키면 거부한다', async () => {
    // Given (public/leak.json → ../secret/tokens.json)
    await symlink(path.join(outside, 'tokens.json'), path.join(root, 'leak.json'));

    // When / Then (문자열 경로만 보면 통과하지만 실제 경로 확인에서 막힌다)
    await assert.rejects(() => readStaticFile(root, '/leak.json', { logger: silentLogger }), {
      code: 'ERR011',
    });
  });

  it('public 안을 가리키는 심볼릭 링크는 허용한다', async () => {
    // Given
    await writeFile(path.join(root, 'real.json'), '{"ok":true}', 'utf8');
    await symlink(path.join(root, 'real.json'), path.join(root, 'alias.json'));

    // When
    const result = await readStaticFile(root, '/alias.json', { logger: silentLogger });

    // Then
    assert.equal(result.content.toString('utf8'), '{"ok":true}');
  });

  it('허용 목록에 없는 확장자는 서빙하지 않는다', async () => {
    // Given
    await writeFile(path.join(root, 'notes.txt'), '메모', 'utf8');

    // When / Then
    await assert.rejects(() => readStaticFile(root, '/notes.txt', { logger: silentLogger }), {
      code: 'ERR011',
    });
  });

  it('디렉터리 요청은 파일이 아니므로 거부한다', async () => {
    // Given
    await mkdir(path.join(root, 'styles.css'), { recursive: true });

    // When / Then
    await assert.rejects(() => readStaticFile(root, '/styles.css', { logger: silentLogger }), {
      code: 'ERR011',
    });
  });

  it('파일 조회가 실패하면 사유를 로그에 남긴다', async () => {
    // Given (chmod는 Windows에서 효과가 없으므로 stat 실패를 직접 주입한다)
    const logs = [];
    const blocked = path.join(root, 'blocked');
    await mkdir(blocked, { recursive: true });
    await writeFile(path.join(blocked, 'a.js'), 'x', 'utf8');
    const failingStat = async (target) => {
      const error = new Error(`EACCES: permission denied, stat '${target}'`);
      error.code = 'EACCES';
      throw error;
    };

    // When
    await assert.rejects(
      () =>
        readStaticFile(root, '/blocked/a.js', {
          logger: { error: (m) => logs.push(m) },
          stat: failingStat,
        }),
      { code: 'ERR011' },
    );

    // Then (권한 문제는 조용히 넘기지 않는다)
    assert.ok(
      logs.some((message) => /EACCES|EPERM/.test(message)),
      `사유가 기록되지 않았습니다: ${logs.join(' | ')}`,
    );
  });
});
