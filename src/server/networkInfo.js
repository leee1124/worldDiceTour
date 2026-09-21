import os from 'node:os';

/**
 * 같은 와이파이의 다른 기기가 접속할 수 있는 LAN 주소 목록.
 * IPv4 + 내부(loopback) 제외.
 */
export function lanUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        urls.push(`http://${address.address}:${port}`);
      }
    }
  }
  return urls;
}

/** GET /api/server-info 응답. */
export function serverInfo(port) {
  return { port, urls: lanUrls(port), localUrl: `http://localhost:${port}` };
}
