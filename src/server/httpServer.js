import http from 'node:http';

import { AppError } from '../application/errors.js';
import { isAllowedHost } from './hostGuard.js';
import { SECURITY_HEADERS } from './securityHeaders.js';
import { readStaticFile } from './staticFiles.js';

/** 요청 본문 최대 크기. */
export const MAX_BODY_BYTES = 16 * 1024;
/** 동시 연결 상한(랜 게임 규모를 한참 넘는 연결은 받지 않는다). */
export const MAX_CONNECTIONS = 256;
/** 헤더 수신 제한(느린 헤더 공격 방지). */
export const HEADERS_TIMEOUT_MS = 10_000;

/**
 * 라우팅 + 정적 파일 + 본문 크기 제한 + 규격 에러 응답.
 * @param {{controller:object, publicDir:string, logger?:object, allowedHosts?:string[]}} params
 *   `allowedHosts`는 `ALLOWED_HOSTS` 환경변수로 추가 허용할 Host 값(정확 일치).
 */
export function createHttpServer({ controller, publicDir, logger = console, allowedHosts = [] }) {
  const server = http.createServer((request, response) => {
    handle(request, response, { controller, publicDir, logger, allowedHosts }).catch((error) => {
      respondError(response, error, logger, request);
    });
  });
  server.maxConnections = MAX_CONNECTIONS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  return server;
}

async function handle(request, response, context) {
  // DNS 리바인딩 방어: 랜에서 실제로 쓰이는 Host만 받는다(정적 파일 포함).
  if (!isAllowedHost(request.headers.host, { allowedHosts: context.allowedHosts })) {
    respondError(
      response,
      new AppError('ERR015', `허용되지 않은 Host 헤더: ${String(request.headers.host)}`),
      context.logger,
      request,
    );
    return;
  }

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
    respondError(response, error, logger, request);
    return undefined;
  }
}

async function handleStatic(request, response, url, { publicDir, logger }) {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      throw new AppError('ERR014', `허용되지 않은 메서드: ${request.method}`);
    }
    const { content, contentType } = await readStaticFile(publicDir, url.pathname, { logger });
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': contentType,
      'content-length': content.length,
      'cache-control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    respondError(response, error, logger, request);
  }
}

function assertMethod(method, allowed) {
  if (!allowed.includes(method)) {
    throw new AppError('ERR014', `허용되지 않은 메서드: ${method}`);
  }
}

/**
 * 본문의 Content-Type이 JSON인지 확인한다.
 * 브라우저 폼으로는 `application/json`을 보낼 수 없으므로, 이 검사가 사이트 간 요청 위조(CSRF)를
 * 막는 핵심이다. `charset` 같은 파라미터는 허용하고, 다른 타입은 전부 거부한다.
 */
function assertJsonContentType(request) {
  const raw = request.headers['content-type'];
  const mediaType = typeof raw === 'string' ? raw.split(';')[0].trim().toLowerCase() : '';
  if (mediaType !== 'application/json') {
    throw new AppError('ERR001', `JSON 본문이 아닙니다: ${String(raw)}`);
  }
}

/** 본문이 실려 오는 요청인지(길이 헤더 또는 청크 전송). */
function hasBody(request) {
  const length = Number(request.headers['content-length'] ?? 0);
  return length > 0 || typeof request.headers['transfer-encoding'] === 'string';
}

/** 본문을 크기 제한과 함께 읽고 JSON으로 해석한다. */
export function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    /**
     * 더 읽지 않고 실패로 끝낸다.
     * 소켓을 즉시 파괴하면 413/400 응답조차 나가지 못하므로(클라이언트에는 "socket hang up"),
     * **읽기만 멈추고** 규격 에러로 응답한다. 본문을 끝까지 읽지 않았으므로 Node가 응답 뒤
     * 연결을 닫는다(`connection: close`).
     */
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      chunks.length = 0;
      size = 0;
      request.pause();
      reject(error);
    };

    if (hasBody(request)) {
      try {
        assertJsonContentType(request);
      } catch (error) {
        fail(error);
        return;
      }
    }

    request.on('data', (chunk) => {
      if (settled) {
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // 한도를 넘는 즉시 버퍼를 버리고 수신을 멈춘다(큰 본문을 끝까지 모으지 않는다).
        fail(new AppError('ERR009', `본문 크기 초과: ${size}바이트 이상`));
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', (error) => fail(new AppError('ERR001', `본문 수신 오류: ${error.message}`)));
    request.on('aborted', () => fail(new AppError('ERR001', '본문 수신이 중단되었습니다')));
    request.on('end', () => {
      if (settled) {
        return;
      }
      settled = true;
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

function respondJson(response, { status, body }, { close = false } = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // 방 목록·게임 상태는 절대 캐시되면 안 된다(뒤로 가기·프록시 재사용 방지).
    'cache-control': 'no-store',
    // 레이트 리밋(429)은 "언제 다시 시도할지"를 알려 줘야 한다 — 없으면 클라이언트가 즉시 재시도한다.
    ...(status === 429 ? { 'retry-after': '1' } : {}),
    ...(close ? { connection: 'close' } : {}),
  });
  response.end(payload);
}

/**
 * 스택/내부 메시지는 서버 로그로만, 클라이언트에는 규격 에러만.
 * 본문을 끝까지 읽지 않고 거부한 요청(크기 초과/타입 위반)은 남은 본문이 계속 흘러와 연결을
 * 막으므로, **응답을 먼저 내보낸 뒤** 연결을 닫는다.
 */
function respondError(response, error, logger, request) {
  const appError = AppError.from(error);
  logger.error(`[http] ${appError.code} ${appError.detail ?? appError.message}`);
  if (response.headersSent) {
    response.end();
    return;
  }
  // 본문을 실어 보냈는데 우리가 끝까지 읽지 않은 경우에만 연결을 닫는다.
  // (본문 없는 GET까지 닫으면 정상적인 404·405 응답마다 연결을 버리게 된다.)
  const close = Boolean(request) && hasBody(request) && request.readableEnded === false;
  respondJson(response, { status: appError.status, body: appError.toBody() }, { close });
  if (close) {
    response.once('finish', () => request.destroy());
  }
}
