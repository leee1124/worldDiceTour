import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../../src/app.js';
import { InMemoryRoomRepository } from '../../src/infrastructure/InMemoryRoomRepository.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';
import { TokenFactory } from '../../src/infrastructure/TokenFactory.js';
import { request, openSse } from '../support/httpClient.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const silentLogger = { error: () => {}, warn: () => {}, info: () => {} };

let app;
let baseUrl;

before(async () => {
  const random = new SeededRandomSource(12345);
  app = createApp({
    repository: new InMemoryRoomRepository({ random }),
    random,
    tokenFactory: new TokenFactory(),
    publicDir,
    autoPlayDelayMs: 0,
    logger: silentLogger,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app.close();
});

/** 방 생성 + 참가 + 시작까지 끝낸 방을 만든다. */
async function createStartedRoom() {
  const created = await request(baseUrl, { method: 'POST', path: '/api/rooms', body: { hostName: '하나' } });
  const code = created.body.room.code;
  const joined = await request(baseUrl, {
    method: 'POST',
    path: `/api/rooms/${code}/seats`,
    body: { name: '두리' },
  });
  await request(baseUrl, {
    method: 'POST',
    path: `/api/rooms/${code}/host-actions`,
    token: created.body.seatToken,
    body: { type: 'START' },
  });
  return { code, host: created.body, guest: joined.body };
}

describe('HTTP 서버(REST + SSE)', () => {
  describe('서버 정보와 정적 파일', () => {
    it('LAN 접속 주소를 알려준다', async () => {
      // Given / When
      const response = await request(baseUrl, { path: '/api/server-info' });

      // Then
      assert.equal(response.status, 200);
      assert.equal(Array.isArray(response.body.urls), true);
      assert.equal(typeof response.body.port, 'number');
    });

    it('루트 요청에 index.html을 돌려주고 보안 헤더를 붙인다', async () => {
      // Given / When
      const response = await request(baseUrl, { path: '/' });

      // Then
      assert.equal(response.status, 200);
      assert.match(response.headers['content-type'], /text\/html/);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.match(response.headers['content-security-policy'], /default-src 'self'/);
    });

    it('경로 탈출 시도를 막는다', async () => {
      // Given / When
      const response = await request(baseUrl, { path: '/../../package.json' });

      // Then
      assert.notEqual(response.status, 200);
      assert.equal(response.text.includes('"dependencies"'), false);
    });

    it('저장 디렉터리는 정적으로 노출되지 않는다', async () => {
      // Given / When
      const response = await request(baseUrl, { path: '/data/rooms/AB2C.json' });

      // Then
      assert.equal(response.status, 404);
      assert.equal(response.body.code, 'ERR011');
    });

    it('없는 API 경로는 규격 에러를 돌려준다', async () => {
      // Given / When
      const response = await request(baseUrl, { path: '/api/nope' });

      // Then
      assert.equal(response.status, 404);
      assert.deepEqual(Object.keys(response.body).sort(), ['code', 'message']);
      assert.equal(response.body.code, 'ERR011');
    });
  });

  describe('방 REST API', () => {
    it('방을 만들면 201과 좌석 토큰을 돌려준다', async () => {
      // Given / When
      const response = await request(baseUrl, {
        method: 'POST',
        path: '/api/rooms',
        body: { hostName: '하나', 알수없는필드: '무시' },
      });

      // Then
      assert.equal(response.status, 201);
      assert.match(response.body.room.code, /^[A-HJ-NP-Z2-9]{4}$/);
      assert.match(response.body.seatToken, /^[0-9a-f]{64}$/);
      assert.equal(JSON.stringify(response.body.room).includes(response.body.seatToken), false);
    });

    it('이름 형식이 잘못되면 400 ERR001이다', async () => {
      // Given / When
      const response = await request(baseUrl, {
        method: 'POST',
        path: '/api/rooms',
        body: { hostName: '이름이_너무_길고_특수문자!!' },
      });

      // Then
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'ERR001');
    });

    it('방 목록을 돌려준다', async () => {
      // Given
      await request(baseUrl, { method: 'POST', path: '/api/rooms', body: { hostName: '목록' } });

      // When
      const response = await request(baseUrl, { path: '/api/rooms' });

      // Then
      assert.equal(response.status, 200);
      assert.equal(Array.isArray(response.body.rooms), true);
      assert.equal(response.body.rooms.some((room) => room.hostName === '목록'), true);
    });

    it('좌석에 참가하면 좌석 토큰을 받는다', async () => {
      // Given
      const created = await request(baseUrl, {
        method: 'POST',
        path: '/api/rooms',
        body: { hostName: '하나' },
      });

      // When
      const response = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${created.body.room.code}/seats`,
        body: { name: '두리' },
      });

      // Then
      assert.equal(response.status, 201);
      assert.equal(response.body.room.seats.length, 2);
      assert.notEqual(response.body.seatToken, created.body.seatToken);
    });

    it('방 코드 형식이 틀리면 404다', async () => {
      // Given / When
      const response = await request(baseUrl, {
        method: 'POST',
        path: '/api/rooms/abc!/seats',
        body: { name: '두리' },
      });

      // Then
      assert.equal(response.status, 404);
      assert.equal(response.body.code, 'ERR004');
    });

    it('본문이 16KB를 넘으면 413이다', async () => {
      // Given
      const huge = JSON.stringify({ hostName: 'a'.repeat(20_000) });

      // When
      const response = await request(baseUrl, { method: 'POST', path: '/api/rooms', body: huge });

      // Then
      assert.equal(response.status, 413);
      assert.equal(response.body.code, 'ERR009');
    });

    it('본문이 아주 커도 한도를 넘는 즉시 끊고 413을 돌려준다', async () => {
      // Given (한도의 30배)
      const huge = JSON.stringify({ hostName: 'a'.repeat(500_000) });

      // When
      const response = await request(baseUrl, { method: 'POST', path: '/api/rooms', body: huge });

      // Then
      assert.equal(response.status, 413);
      assert.equal(response.body.code, 'ERR009');
      assert.equal(response.headers.connection, 'close');
    });

    it('JSON이 아니면 400이다', async () => {
      // Given / When
      const response = await request(baseUrl, {
        method: 'POST',
        path: '/api/rooms',
        body: '{ 깨진 JSON',
      });

      // Then
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'ERR001');
    });

    it('좌석에서 나가면 방에서 제거된다', async () => {
      // Given
      const created = await request(baseUrl, {
        method: 'POST',
        path: '/api/rooms',
        body: { hostName: '하나' },
      });
      const code = created.body.room.code;
      const guest = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${code}/seats`,
        body: { name: '두리' },
      });

      // When
      const response = await request(baseUrl, {
        method: 'DELETE',
        path: `/api/rooms/${code}/seats/${guest.body.seatId}`,
        token: guest.body.seatToken,
      });

      // Then
      assert.equal(response.status, 200);
      assert.equal(response.body.room.seats.length, 1);
    });

    it('게임 중에는 좌석을 지울 수 없고(409 ERR005) 방 조회는 계속 200이다', async () => {
      // Given
      const started = await createStartedRoom();

      // When
      const response = await request(baseUrl, {
        method: 'DELETE',
        path: `/api/rooms/${started.code}/seats/${started.guest.seatId}`,
        token: started.guest.seatToken,
      });

      // Then
      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'ERR005');
      const room = await request(baseUrl, { path: `/api/rooms/${started.code}` });
      assert.equal(room.status, 200);
      assert.equal(room.body.room.seats.length, 2);
      assert.equal(room.body.room.status, 'PLAYING');
    });

    it('좌석 id 형식이 틀리면 400이다', async () => {
      // Given
      const created = await request(baseUrl, {
        method: 'POST',
        path: '/api/rooms',
        body: { hostName: '하나' },
      });

      // When
      const response = await request(baseUrl, {
        method: 'DELETE',
        path: `/api/rooms/${created.body.room.code}/seats/..%2Fetc`,
        token: created.body.seatToken,
      });

      // Then
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'ERR001');
    });

    it('허용되지 않은 메서드는 405다', async () => {
      // Given / When
      const response = await request(baseUrl, { method: 'PUT', path: '/api/rooms' });

      // Then
      assert.equal(response.status, 405);
      assert.equal(response.body.code, 'ERR014');
    });
  });

  describe('요청 헤더 방어', () => {
    it('API JSON 응답에는 캐시 금지 헤더가 붙는다', async () => {
      // Given / When
      const response = await request(baseUrl, { path: '/api/rooms' });

      // Then
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
    });

    it('에러 응답에도 캐시 금지 헤더가 붙는다', async () => {
      // Given / When
      const response = await request(baseUrl, { path: '/api/rooms/ZZZZ' });

      // Then
      assert.equal(response.status, 404);
      assert.equal(response.headers['cache-control'], 'no-store');
    });

    it('연결 수와 헤더 타임아웃 상한이 설정돼 있다', () => {
      // Given / When / Then
      assert.equal(app.server.maxConnections, 256);
      assert.equal(app.server.headersTimeout, 10_000);
    });

    describe('Content-Type 검사(CSRF 방어)', () => {
      it('application/json이면 통과한다(charset 같은 파라미터 허용)', async () => {
        // Given / When
        const response = await request(baseUrl, {
          method: 'POST',
          path: '/api/rooms',
          body: { hostName: '타입' },
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });

        // Then
        assert.equal(response.status, 201);
      });

      const rejectedTypes = [
        'text/plain',
        'application/x-www-form-urlencoded',
        'multipart/form-data; boundary=x',
        'application/json-patch+json',
        'text/plain; charset=utf-8',
      ];

      for (const contentType of rejectedTypes) {
        it(`${contentType} 본문은 400 ERR001로 거부한다`, async () => {
          // Given / When
          const response = await request(baseUrl, {
            method: 'POST',
            path: '/api/rooms',
            body: JSON.stringify({ hostName: '위조' }),
            headers: { 'content-type': contentType },
          });

          // Then
          assert.equal(response.status, 400);
          assert.equal(response.body.code, 'ERR001');
        });
      }

      it('본문이 있는데 Content-Type이 없으면 거부한다', async () => {
        // Given / When
        const response = await request(baseUrl, {
          method: 'POST',
          path: '/api/rooms',
          body: JSON.stringify({ hostName: '위조' }),
          headers: { 'content-type': '' },
        });

        // Then
        assert.equal(response.status, 400);
        assert.equal(response.body.code, 'ERR001');
      });
    });

    describe('Host 헤더 검사(DNS 리바인딩 방어)', () => {
      it('허용되지 않은 Host는 403 ERR015다', async () => {
        // Given / When
        const response = await request(baseUrl, {
          path: '/api/rooms',
          headers: { host: 'evil.example.com' },
        });

        // Then
        assert.equal(response.status, 403);
        assert.equal(response.body.code, 'ERR015');
      });

      it('정적 파일 요청도 같은 검사를 받는다', async () => {
        // Given / When
        const response = await request(baseUrl, {
          path: '/',
          headers: { host: 'evil.example.com' },
        });

        // Then
        assert.equal(response.status, 403);
        assert.equal(response.body.code, 'ERR015');
      });

      it('랜 사설 주소는 통과한다', async () => {
        // Given / When
        const response = await request(baseUrl, {
          path: '/api/rooms',
          headers: { host: '192.168.0.12:5173' },
        });

        // Then
        assert.equal(response.status, 200);
      });

      it('점 없는 호스트명(mypc)과 mDNS 이름(mypc.local)도 통과한다', async () => {
        // Given / When
        const single = await request(baseUrl, { path: '/api/rooms', headers: { host: 'mypc:5173' } });
        const mdns = await request(baseUrl, { path: '/api/rooms', headers: { host: 'mypc.local' } });

        // Then
        assert.equal(single.status, 200);
        assert.equal(mdns.status, 200);
      });
    });

    it('toString이 오염된 payload도 400 ERR001이며 500이 아니다', async () => {
      // Given
      const started = await createStartedRoom();

      // When
      const response = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/commands`,
        token: started.host.seatToken,
        body: { type: 'TRAVEL', payload: { destination: { toString: 1 } } },
      });

      // Then
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'ERR001');
    });
  });

  describe('권한 검증', () => {
    it('토큰 없이 호스트 동작을 하면 401이다', async () => {
      // Given
      const started = await createStartedRoom();

      // When
      const response = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/host-actions`,
        body: { type: 'START' },
      });

      // Then
      assert.equal(response.status, 401);
      assert.equal(response.body.code, 'ERR002');
    });

    it('호스트가 아닌 좌석이 호스트 동작을 하면 403이다', async () => {
      // Given
      const created = await request(baseUrl, {
        method: 'POST',
        path: '/api/rooms',
        body: { hostName: '하나' },
      });
      const guest = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${created.body.room.code}/seats`,
        body: { name: '두리' },
      });

      // When
      const response = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${created.body.room.code}/host-actions`,
        token: guest.body.seatToken,
        body: { type: 'ADD_COMPUTER', name: '컴퓨터' },
      });

      // Then
      assert.equal(response.status, 403);
      assert.equal(response.body.code, 'ERR003');
    });

    it('접속 중인 좌석을 자동 진행으로 바꾸려 하면 409 ERR005다', async () => {
      // Given (좌석 토큰으로 presence를 붙여 두리를 온라인으로 만든다)
      const started = await createStartedRoom();
      const stream = openSse(
        baseUrl,
        `/api/rooms/${started.code}/events?presence=${started.guest.seatId}:${started.guest.seatToken}`,
      );
      await stream.ready;
      await stream.waitFor((event) => event.event === 'room' && event.data.seats[1].online === true);

      // When
      const response = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/host-actions`,
        token: started.host.seatToken,
        body: { type: 'SET_AUTOPILOT', seatId: started.guest.seatId, enabled: true },
      });

      // Then
      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'ERR005');
      stream.close();
    });

    it('오프라인 좌석은 자동 진행으로 바꿀 수 있고, 그 좌석 토큰으로 되돌릴 수 있다', async () => {
      // Given
      const started = await createStartedRoom();

      // When
      const enabled = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/host-actions`,
        token: started.host.seatToken,
        body: { type: 'SET_AUTOPILOT', seatId: started.guest.seatId, enabled: true },
      });

      // Then
      assert.equal(enabled.status, 200);
      assert.equal(enabled.body.room.seats[1].autopilot, true);

      // When (좌석 본인이 조종권을 회수한다)
      const disabled = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/host-actions`,
        token: started.guest.seatToken,
        body: { type: 'SET_AUTOPILOT', seatId: started.guest.seatId, enabled: false },
      });

      // Then
      assert.equal(disabled.status, 200);
      assert.equal(disabled.body.room.seats[1].autopilot, false);
    });

    it('자동 진행 중인 좌석의 커맨드는 그 좌석 토큰이어도 403 ERR003이다', async () => {
      // Given (두리 좌석을 자동 진행으로 돌린다 — 두리 차례가 아니므로 드라이버는 움직이지 않는다)
      const started = await createStartedRoom();
      await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/host-actions`,
        token: started.host.seatToken,
        body: { type: 'SET_AUTOPILOT', seatId: started.guest.seatId, enabled: true },
      });

      // When
      const response = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/commands`,
        token: started.guest.seatToken,
        body: { type: 'ROLL' },
      });

      // Then (차례가 아닌 것(ERR006)보다 이중 조종 차단이 먼저 걸린다)
      assert.equal(response.status, 403);
      assert.equal(response.body.code, 'ERR003');
      const room = await request(baseUrl, { path: `/api/rooms/${started.code}` });
      assert.equal(room.body.game.version, 0);
    });

    it('내 차례가 아니면 409 ERR006이고 상태는 그대로다', async () => {
      // Given
      const started = await createStartedRoom();

      // When
      const response = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/commands`,
        token: started.guest.seatToken,
        body: { type: 'ROLL' },
      });

      // Then
      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'ERR006');
      const room = await request(baseUrl, { path: `/api/rooms/${started.code}` });
      assert.equal(room.body.game.version, 0);
    });

    it('잘못된 페이즈의 커맨드는 409 ERR005다', async () => {
      // Given
      const started = await createStartedRoom();

      // When
      const response = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/commands`,
        token: started.host.seatToken,
        body: { type: 'BUY' },
      });

      // Then
      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'ERR005');
    });

    it('알 수 없는 커맨드 종류는 400이다', async () => {
      // Given
      const started = await createStartedRoom();

      // When
      const response = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/commands`,
        token: started.host.seatToken,
        body: { type: 'DROP_TABLE' },
      });

      // Then
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'ERR001');
    });

    it('토큰 형식이 틀리면 401이다', async () => {
      // Given
      const started = await createStartedRoom();

      // When
      const response = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/commands`,
        token: 'not-a-token',
        body: { type: 'ROLL' },
      });

      // Then
      assert.equal(response.status, 401);
      assert.equal(response.body.code, 'ERR002');
    });

    it('에러 응답에는 내부 정보가 담기지 않는다', async () => {
      // Given
      const started = await createStartedRoom();

      // When
      const response = await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/commands`,
        token: started.guest.seatToken,
        body: { type: 'ROLL' },
      });

      // Then
      assert.deepEqual(Object.keys(response.body).sort(), ['code', 'message']);
      assert.equal(response.text.includes('at '), false);
      assert.equal(response.text.includes('seat-'), false);
    });
  });

  describe('SSE 스트림', () => {
    it('연결하면 현재 방과 게임 스냅샷을 즉시 보낸다', async () => {
      // Given
      const started = await createStartedRoom();

      // When
      const stream = openSse(baseUrl, `/api/rooms/${started.code}/events`);
      const headers = await stream.ready;
      const roomEvent = await stream.waitFor((event) => event.event === 'room');
      const gameEvent = await stream.waitFor((event) => event.event === 'game');

      // Then
      assert.equal(headers.status, 200);
      assert.match(headers.headers['content-type'], /text\/event-stream/);
      assert.equal(roomEvent.data.code, started.code);
      assert.equal(gameEvent.data.view.phase, 'AWAIT_ROLL');
      stream.close();
    });

    it('커맨드를 처리하면 구독자에게 뷰와 이벤트를 방송한다', async () => {
      // Given
      const started = await createStartedRoom();
      const stream = openSse(baseUrl, `/api/rooms/${started.code}/events`);
      await stream.ready;
      await stream.waitFor((event) => event.event === 'game');

      // When
      await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${started.code}/commands`,
        token: started.host.seatToken,
        body: { type: 'ROLL' },
      });
      const broadcast = await stream.waitFor(
        (event) => event.event === 'game' && event.data.view.version === 1,
      );

      // Then
      assert.equal(broadcast.data.events.some((event) => event.type === 'DICE_ROLLED'), true);
      assert.equal(broadcast.data.view.currentSeatId !== null, true);
      stream.close();
    });

    it('SSE 페이로드에는 좌석 토큰이 들어가지 않는다', async () => {
      // Given
      const started = await createStartedRoom();
      const stream = openSse(
        baseUrl,
        `/api/rooms/${started.code}/events?presence=${started.host.room.seats[0].id}:${started.host.seatToken}`,
      );
      await stream.ready;

      // When
      const roomEvent = await stream.waitFor((event) => event.event === 'room');

      // Then
      assert.equal(JSON.stringify(roomEvent.data).includes(started.host.seatToken), false);
      stream.close();
    });

    it('presence 파라미터로 좌석 온라인 상태를 표시한다', async () => {
      // Given
      const started = await createStartedRoom();
      const hostSeatId = started.host.seatId;

      // When
      const stream = openSse(
        baseUrl,
        `/api/rooms/${started.code}/events?presence=${hostSeatId}:${started.host.seatToken}`,
      );
      await stream.ready;
      await stream.waitFor((event) => event.event === 'room');
      const snapshot = await request(baseUrl, { path: `/api/rooms/${started.code}` });

      // Then
      const hostSeat = snapshot.body.room.seats.find((seat) => seat.id === hostSeatId);
      assert.equal(hostSeat.online, true);
      stream.close();
    });

    it('잘못된 presence 토큰은 온라인으로 인정하지 않는다', async () => {
      // Given
      const started = await createStartedRoom();

      // When
      const stream = openSse(
        baseUrl,
        `/api/rooms/${started.code}/events?presence=${started.host.seatId}:${'0'.repeat(64)}`,
      );
      await stream.ready;
      await stream.waitFor((event) => event.event === 'room');
      const snapshot = await request(baseUrl, { path: `/api/rooms/${started.code}` });

      // Then
      const hostSeat = snapshot.body.room.seats.find((seat) => seat.id === started.host.seatId);
      assert.equal(hostSeat.online, false);
      stream.close();
    });

    it('없는 방의 스트림은 404다', async () => {
      // Given / When
      const response = await request(baseUrl, { path: '/api/rooms/ZZZZ/events' });

      // Then
      assert.equal(response.status, 404);
      assert.equal(response.body.code, 'ERR004');
    });

    it('구독자 상한을 넘으면 이벤트 스트림이 아니라 503 JSON을 돌려준다', async () => {
      // Given (상한을 낮춘 별도 서버)
      const random = new SeededRandomSource(777);
      const small = createApp({
        repository: new InMemoryRoomRepository({ random, logger: silentLogger }),
        random,
        tokenFactory: new TokenFactory(),
        publicDir,
        autoPlayDelayMs: 0,
        logger: silentLogger,
        sseLimits: { maxPerRoom: 1, maxTotal: 4 },
      });
      await new Promise((resolve) => small.server.listen(0, '127.0.0.1', resolve));
      const smallUrl = `http://127.0.0.1:${small.server.address().port}`;
      const created = await request(smallUrl, {
        method: 'POST',
        path: '/api/rooms',
        body: { hostName: '하나' },
      });
      const code = created.body.room.code;
      const first = openSse(smallUrl, `/api/rooms/${code}/events`);
      await first.ready;
      await first.waitFor((event) => event.event === 'room');

      // When
      const response = await request(smallUrl, { path: `/api/rooms/${code}/events` });

      // Then
      assert.equal(response.status, 503);
      assert.equal(response.body.code, 'ERR016');
      assert.match(response.headers['content-type'], /application\/json/);
      first.close();
      await small.close();
    });

    it('방이 삭제되면 열려 있던 스트림이 끝난다', async () => {
      // Given (혼자 있는 대기실에 스트림을 연다)
      const created = await request(baseUrl, {
        method: 'POST',
        path: '/api/rooms',
        body: { hostName: '하나' },
      });
      const code = created.body.room.code;
      const stream = openSse(baseUrl, `/api/rooms/${code}/events`);
      const { response } = await stream.ready;
      await stream.waitFor((event) => event.event === 'room');
      const ended = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('스트림이 닫히지 않았습니다')), 2_000);
        response.on('end', () => {
          clearTimeout(timer);
          resolve();
        });
      });

      // When (마지막 좌석이 나가 방이 삭제된다)
      const deleted = await request(baseUrl, {
        method: 'DELETE',
        path: `/api/rooms/${code}/seats/${created.body.seatId}`,
        token: created.body.seatToken,
      });

      // Then
      assert.equal(deleted.status, 200);
      await ended;
      assert.equal(response.complete, true);
      stream.close();
    });
  });

  describe('컴퓨터 좌석 자동 진행', () => {
    it('컴퓨터 차례가 되면 서버가 진행해 방송한다', async () => {
      // Given
      const created = await request(baseUrl, {
        method: 'POST',
        path: '/api/rooms',
        body: { hostName: '하나' },
      });
      const code = created.body.room.code;
      await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${code}/host-actions`,
        token: created.body.seatToken,
        body: { type: 'ADD_COMPUTER', name: '컴퓨터' },
      });
      await request(baseUrl, {
        method: 'POST',
        path: `/api/rooms/${code}/host-actions`,
        token: created.body.seatToken,
        body: { type: 'START' },
      });
      const stream = openSse(baseUrl, `/api/rooms/${code}/events`);
      await stream.ready;

      // When (사람 좌석의 턴을 끝낼 때까지 정책대로 진행)
      for (let guard = 0; guard < 30; guard += 1) {
        const snapshot = await request(baseUrl, { path: `/api/rooms/${code}` });
        const view = snapshot.body.game;
        if (view.isOver || view.currentSeatId !== created.body.seatId) {
          break;
        }
        const type = view.pending ? autoCommandFor(view.pending.kind) : 'ROLL';
        await request(baseUrl, {
          method: 'POST',
          path: `/api/rooms/${code}/commands`,
          token: created.body.seatToken,
          body: { type },
        });
      }
      const computerTurn = await stream.waitFor(
        (event) =>
          event.event === 'game' &&
          event.data.view.version > 1 &&
          (event.data.view.currentSeatId === created.body.seatId || event.data.view.isOver),
        { timeoutMs: 5_000 },
      );

      // Then
      assert.equal(computerTurn.data.view.version > 1, true);
      stream.close();
    });
  });
});

/** 사람 좌석을 단순히 "건너뛰기"로 진행시키기 위한 커맨드 선택. */
function autoCommandFor(kind) {
  switch (kind) {
    case 'BUY':
      return 'SKIP_BUY';
    case 'BUILD':
      return 'SKIP_BUILD';
    case 'START_BUILD':
      return 'SKIP_START_BUILD';
    case 'ACQUIRE':
      return 'SKIP_ACQUIRE';
    case 'CASINO':
      return 'CASINO_LEAVE';
    case 'ISLAND':
      return 'ISLAND_ROLL';
    case 'LIQUIDATION':
      return 'AUTO_SELL';
    default:
      return 'ROLL';
  }
}
