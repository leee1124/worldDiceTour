/**
 * Host 헤더 화이트리스트 — DNS 리바인딩과 외부 도메인 경유 요청 차단.
 *
 * 이 서버는 **같은 랜에서만** 쓰는 게임 서버다. 그런데 브라우저는 공격자 도메인이
 * `192.168.x.x`로 리바인딩되면 그 도메인 이름으로 요청을 보낼 수 있고, 서버가 Host를 보지
 * 않으면 이를 정상 요청으로 처리한다. 그래서 "랜에서 실제로 쓰이는 이름"만 허용한다.
 *
 * 허용: localhost / 127.0.0.0/8 / [::1] / 10.0.0.0/8 / 172.16.0.0/12 / 192.168.0.0/16 /
 *       169.254.0.0/16(링크 로컬) / 점이 없는 단일 라벨 호스트명(`mypc`) / `*.local`(mDNS).
 *       모두 포트를 붙일 수 있다. 그 밖의 이름은 `ALLOWED_HOSTS`에 정확히 적어야 허용된다.
 */

/** 점 없는 단일 라벨 호스트명(`mypc`, `my-pc-2`). */
const SINGLE_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** mDNS 이름(`mypc.local`). */
const MDNS_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.local$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** `ALLOWED_HOSTS` 환경변수(콤마 구분)를 정확 비교용 목록으로 만든다. */
export function parseAllowedHosts(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * @param {string|undefined} hostHeader `request.headers.host`
 * @param {{allowedHosts?: string[]}} options `ALLOWED_HOSTS`로 추가 허용된 호스트(정확 일치)
 */
export function isAllowedHost(hostHeader, { allowedHosts = [] } = {}) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) {
    return false;
  }
  const value = hostHeader.trim().toLowerCase();
  if (allowedHosts.includes(value)) {
    return true;
  }
  const split = splitHostPort(value);
  if (!split) {
    return false;
  }
  const { host } = split;
  if (host === 'localhost' || host === '[::1]' || host === '::1') {
    return true;
  }
  if (IPV4.test(host)) {
    return isPrivateIpv4(host);
  }
  return SINGLE_LABEL.test(host) || MDNS_NAME.test(host);
}

/** `host[:port]` / `[ipv6][:port]`를 나눈다. 포트 형식이 틀리면 null. */
function splitHostPort(value) {
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close === -1) {
      return null;
    }
    const host = value.slice(0, close + 1);
    const rest = value.slice(close + 1);
    if (rest.length === 0) {
      return { host, port: null };
    }
    return rest.startsWith(':') && isValidPort(rest.slice(1)) ? { host, port: rest.slice(1) } : null;
  }
  const colon = value.indexOf(':');
  if (colon === -1) {
    return { host: value, port: null };
  }
  // 콜론이 여러 개면 대괄호 없는 IPv6이므로 받지 않는다.
  if (value.indexOf(':', colon + 1) !== -1) {
    return null;
  }
  const port = value.slice(colon + 1);
  return isValidPort(port) ? { host: value.slice(0, colon), port } : null;
}

function isValidPort(port) {
  if (!/^\d{1,5}$/.test(port)) {
    return false;
  }
  const number = Number(port);
  return number >= 1 && number <= 65_535;
}

/** 랜에서 실제로 쓰이는 사설/루프백/링크 로컬 대역인지. */
function isPrivateIpv4(host) {
  const octets = host.split('.').map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets;
  if (first === 127) {
    return true;
  }
  if (first === 10) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  return first === 169 && second === 254;
}
