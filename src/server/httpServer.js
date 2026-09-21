import http from 'node:http';

import { AppError } from '../application/errors.js';
import { readStaticFile } from './staticFiles.js';

/** 요청 본문 최대 크기. */
export const MAX_BODY_BYTES = 16 * 1024;

/** 모든 응답에 붙이는 기본 보안 헤더. */
const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});

/**
 * 라우팅 + 정적 파일 + 본문 크기 제한 + 규격 에러 응답.
 */
export function createHttpServer({ controller, publicDir, logger = console }) {
  const server = http.createServer((request, response) => {
    handle(request, response, { controller, publicDir, logger }).catch((error) => {
      respondError(response, error, logger);
    });
  });
  return server;
}

async function handle(request, response, context) {
  const url = new URL(request.url, 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[0] === 'api') {
    await handleApi(request, response, url, segments.slice(1), context);
    return;
  }
  await handleStatic(request, response, url, context);
}

async function handleApi(request, response, url, segments, { controller, logger }) {
  const method = request.method ?? 'GET';

  try {
    // /api/server-info
    if (segments.length === 1 && segments[0] === 'server-info') {
      assertMethod(method, ['GET']);
      return respondJson(response, controller.serverInfo());
    }

    // /api/rooms
    if (segments.length === 1 && segments[0] === 'rooms') {
      if (method === 'GET') {
        return respondJson(response, await controller.listRooms());
      }
      if (method === 'POST') {
        const body = await readJsonBody(request);
        return respondJson(response, await controller.createRoom(body));
      }
      throw new AppError('ERR014', `허용되지 않은 메서드: ${method}`);
    }

    if (segments[0] === 'rooms' && segments.length >= 2) {
      const code = segments[1];
      const rest = segments.slice(2);

      // /api/rooms/:code
      if (rest.length === 0) {
        assertMethod(method, ['GET']);
        return respondJson(response, await controller.getRoom(code));
      }

      // /api/rooms/:code/seats[/:seatId]
      if (rest[0] === 'seats') {
        if (rest.length === 1) {
          assertMethod(method, ['POST']);
          const body = await readJsonBody(request);
          return respondJson(response, await controller.joinSeat(code, body));
        }
        if (rest.length === 2) {
          assertMethod(method, ['DELETE']);
          return respondJson(response, await controller.leaveSeat(code, rest[1], request.headers));
        }
      }

      // /api/rooms/:code/host-actions
      if (rest.length === 1 && rest[0] === 'host-actions') {
        assertMethod(method, ['POST']);
        const body = await readJsonBody(request);
        return respondJson(response, await controller.hostAction(code, body, request.headers));
      }

      // /api/rooms/:code/commands
      if (rest.length === 1 && rest[0] === 'commands') {
        assertMethod(method, ['POST']);
        const body = await readJsonBody(request);
        return respondJson(response, await controller.command(code, body, request.headers));
      }

      // /api/rooms/:code/events (SSE)
      if (rest.length === 1 && rest[0] === 'events') {
        assertMethod(method, ['GET']);
        return controller.subscribe(code, url.searchParams, request, response);
      }
    }

    throw new AppError('ERR011', `알 수 없는 API 경로: ${url.pathname}`);
  } catch (error) {
    respondError(response, error, logger);
    return undefined;
  }
}

async function handleStatic(request, response, url, { publicDir, logger }) {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      throw new AppError('ERR014', `허용되지 않은 메서드: ${request.method}`);
    }
    const { content, contentType } = await readStaticFile(publicDir, url.pathname);
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': contentType,
      'content-length': content.length,
      'cache-control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    respondError(response, error, logger);
  }
}

function assertMethod(method, allowed) {
  if (!allowed.includes(method)) {
    throw new AppError('ERR014', `허용되지 않은 메서드: ${method}`);
  }
}

/** 본문을 크기 제한과 함께 읽고 JSON으로 해석한다. */
export function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', (error) => reject(new AppError('ERR001', `본문 수신 오류: ${error.message}`)));
    request.on('end', () => {
      if (tooLarge) {
        reject(new AppError('ERR009', `본문 크기 초과: ${size}바이트`));
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new AppError('ERR001', `JSON 파싱 실패: ${error.message}`));
      }
    });
  });
}

function respondJson(response, { status, body }) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

/** 스택/내부 메시지는 서버 로그로만, 클라이언트에는 규격 에러만. */
function respondError(response, error, logger) {
  const appError = AppError.from(error);
  logger.error(`[http] ${appError.code} ${appError.detail ?? appError.message}`);
  if (response.headersSent) {
    response.end();
    return;
  }
  respondJson(response, { status: appError.status, body: appError.toBody() });
}
