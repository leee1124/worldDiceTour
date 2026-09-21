import { readFile, realpath, stat as fsStat } from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../application/errors.js';

/** 확장자별 Content-Type(화이트리스트). 목록에 없는 확장자는 서빙하지 않는다. */
const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
});

/**
 * public/ 아래 파일만 돌려준다.
 *
 * 경로 탈출은 두 단계로 막는다.
 *  1) 문자열 경로 정규화(`path.resolve`)로 `../`·절대경로를 걸러낸다.
 *  2) **실제 경로(realpath)** 를 다시 확인해, public/ 안에 있는 심볼릭 링크가 바깥을
 *     가리키는 경우까지 차단한다.
 *
 * @param {object} [options]
 * @param {object} [options.logger]
 * @param {Function} [options.stat] `node:fs/promises`의 `stat` 대체 — 테스트에서 권한 오류(EACCES 등)를
 *   플랫폼 독립적으로 주입하기 위한 선택적 시드다.
 * @returns {Promise<{content: Buffer, contentType: string}>}
 */
export async function readStaticFile(rootDir, urlPath, { logger = console, stat: statFn = fsStat } = {}) {
  const decoded = safeDecode(urlPath);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolvedRoot = path.resolve(rootDir);
  const target = path.resolve(resolvedRoot, relative);

  assertInside(resolvedRoot, target, urlPath);

  const extension = path.extname(target).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    throw new AppError('ERR011', `허용되지 않은 정적 파일 형식: ${extension}`);
  }

  let info;
  try {
    info = await statFn(target);
  } catch (error) {
    // 없는 파일은 흔한 일이므로 조용히, 그 밖의 이유(권한 등)는 사유를 남긴다.
    if (error.code !== 'ENOENT') {
      logger.error(`[staticFiles] 파일 정보 조회 실패 ${relative}: ${error.code} ${error.message}`);
    }
    throw new AppError('ERR011', `정적 파일 없음: ${relative} (${error.code})`);
  }
  if (!info.isFile()) {
    throw new AppError('ERR011', `정적 파일이 아님: ${relative}`);
  }

  // 심볼릭 링크로 루트 밖을 가리키는 경우를 실제 경로로 한 번 더 확인한다.
  let real;
  try {
    real = await realpath(target);
  } catch (error) {
    logger.error(`[staticFiles] 실제 경로 확인 실패 ${relative}: ${error.code} ${error.message}`);
    throw new AppError('ERR011', `정적 파일 경로를 확인할 수 없음: ${relative}`);
  }
  const realRoot = await realpathOfRoot(resolvedRoot, logger);
  assertInside(realRoot, real, urlPath);

  return { content: await readFile(real), contentType };
}

/** 루트 자체가 심볼릭 링크일 수 있으므로 루트도 실제 경로로 비교한다. */
async function realpathOfRoot(resolvedRoot, logger) {
  try {
    return await realpath(resolvedRoot);
  } catch (error) {
    logger.error(`[staticFiles] 정적 루트 확인 실패: ${error.code} ${error.message}`);
    return resolvedRoot;
  }
}

function assertInside(root, target, urlPath) {
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new AppError('ERR011', `정적 경로 탈출 시도: ${urlPath}`);
  }
}

function safeDecode(urlPath) {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    throw new AppError('ERR011', '경로 디코딩 실패');
  }
}
