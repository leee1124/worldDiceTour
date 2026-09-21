import http from 'node:http';

/** 테스트용 간단 HTTP 클라이언트(의존성 0). */
export function request(baseUrl, { method = 'GET', path: urlPath = '/', token, body, headers = {} } = {}) {
  const url = new URL(urlPath, baseUrl);
  const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          ...(payload === null ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = text.length > 0 ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, body: json });
        });
      },
    );
    req.on('error', reject);
    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * SSE 스트림을 열고 이벤트를 수집한다.
 * @returns {{events: Array<{event:string, data:object}>, waitFor: Function, close: Function}}
 */
export function openSse(baseUrl, urlPath) {
  const url = new URL(urlPath, baseUrl);
  const events = [];
  const waiters = [];
  let buffer = '';
  let request_;

  const ready = new Promise((resolve, reject) => {
    request_ = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { accept: 'text/event-stream' },
      },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          let separator = buffer.indexOf('\n\n');
          while (separator !== -1) {
            const raw = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            const parsed = parseEvent(raw);
            if (parsed) {
              events.push(parsed);
              for (const waiter of [...waiters]) {
                if (waiter.predicate(parsed)) {
                  waiters.splice(waiters.indexOf(waiter), 1);
                  waiter.resolve(parsed);
                }
              }
            }
            separator = buffer.indexOf('\n\n');
          }
        });
        resolve({ status: res.statusCode, headers: res.headers, response: res });
      },
    );
    request_.on('error', reject);
    request_.end();
  });

  return {
    ready,
    events,
    waitFor(predicate, { timeoutMs = 3_000 } = {}) {
      const existing = events.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('SSE 이벤트 대기 시간 초과')), timeoutMs);
        waiters.push({
          predicate,
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
        });
      });
    },
    close() {
      request_.destroy();
    },
  };
}

function parseEvent(raw) {
  const lines = raw.split('\n');
  let event = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith(':')) {
      return { event: 'comment', data: line.slice(1).trim() };
    }
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return { event, data: dataLines.join('\n') };
  }
}
