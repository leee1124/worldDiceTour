import { readFile, stat } from 'node:fs/promises';
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
 * public/ 아래 파일만 돌려준다. 경로 탈출(../, 절대경로, 심볼릭 경로)은 차단한다.
 * @returns {Promise<{content: Buffer, contentType: string}>}
 */
export async function readStaticFile(rootDir, urlPath) {
  const decoded = safeDecode(urlPath);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolvedRoot = path.resolve(rootDir);
  const target = path.resolve(resolvedRoot, relative);

  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new AppError('ERR011', `정적 경로 탈출 시도: ${urlPath}`);
  }

  const extension = path.extname(target).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    throw new AppError('ERR011', `허용되지 않은 정적 파일 형식: ${extension}`);
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    throw new AppError('ERR011', `정적 파일 없음: ${relative}`);
  }
  if (!info.isFile()) {
    throw new AppError('ERR011', `정적 파일이 아님: ${relative}`);
  }

  return { content: await readFile(target), contentType };
}

function safeDecode(urlPath) {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    throw new AppError('ERR011', '경로 디코딩 실패');
  }
}
