/**
 * 좌석 토큰 보관소.
 *
 * **토큰 취급 원칙**
 * - 토큰은 이 기기의 `localStorage`에만 있고, 화면에 출력하거나 콘솔에 남기지 않는다.
 * - 밖으로 내보낼 때는 `publicSeatsOf()`처럼 토큰을 뺀 형태만 쓴다.
 * - 커맨드를 보낼 때만 `tokenOf()`로 꺼내 `Authorization` 헤더에 담는다.
 * - presence 쿼리(`seatId:token`)는 `presenceParam()`으로만 만든다.
 */

const KEY_PREFIX = 'wdt.room.';

const keyOf = (code) => `${KEY_PREFIX}${code}`;

/** localStorage 접근 실패(사파리 프라이빗 모드 등)에도 화면이 죽지 않게 감싼다. */
function readEntry(code) {
  try {
    const raw = window.localStorage.getItem(keyOf(code));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.seats)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error('[storage] 저장된 좌석을 읽지 못했습니다', error.name);
    return null;
  }
}

function writeEntry(code, entry) {
  try {
    window.localStorage.setItem(keyOf(code), JSON.stringify(entry));
    return true;
  } catch (error) {
    console.error('[storage] 좌석을 저장하지 못했습니다', error.name);
    return false;
  }
}

/** 이 기기가 가진 좌석 목록(토큰 포함). 모듈 안에서만 쓴다. */
function seatsWithToken(code) {
  const entry = readEntry(code);
  if (!entry) {
    return [];
  }
  return entry.seats.filter(
    (seat) => typeof seat?.seatId === 'string' && typeof seat?.seatToken === 'string',
  );
}

/** 이 기기가 가진 좌석(토큰 제외). 화면/스토어에는 이 형태만 전달한다. */
export function publicSeatsOf(code) {
  return seatsWithToken(code).map(({ seatId, name }) => ({ seatId, name: name ?? '' }));
}

/** 좌석 하나를 저장한다(같은 좌석이면 갱신). */
export function saveSeat(code, { seatId, seatToken, name }) {
  const seats = seatsWithToken(code).filter((seat) => seat.seatId !== seatId);
  seats.push({ seatId, seatToken, name: name ?? '' });
  writeEntry(code, { code, seats, updatedAt: Date.now() });
}

/** 좌석 이름만 갱신(서버가 준 이름으로 맞춤). */
export function renameSeat(code, seatId, name) {
  const seats = seatsWithToken(code);
  const seat = seats.find((item) => item.seatId === seatId);
  if (!seat || seat.name === name) {
    return;
  }
  seat.name = name;
  writeEntry(code, { code, seats, updatedAt: Date.now() });
}

/** 좌석 하나를 잊는다(퇴장·강퇴). 남은 좌석이 없으면 방 항목을 지운다. */
export function removeSeat(code, seatId) {
  const seats = seatsWithToken(code).filter((seat) => seat.seatId !== seatId);
  if (seats.length === 0) {
    forgetRoom(code);
    return;
  }
  writeEntry(code, { code, seats, updatedAt: Date.now() });
}

export function forgetRoom(code) {
  try {
    window.localStorage.removeItem(keyOf(code));
  } catch (error) {
    console.error('[storage] 방 기록을 지우지 못했습니다', error.name);
  }
}

/** 이 기기에 저장된 방 목록(재접속 카드용). 토큰은 포함하지 않는다. */
export function savedRooms() {
  const rooms = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(KEY_PREFIX)) {
        continue;
      }
      const code = key.slice(KEY_PREFIX.length);
      const seats = publicSeatsOf(code);
      if (seats.length === 0) {
        continue;
      }
      const entry = readEntry(code);
      rooms.push({ code, seats, updatedAt: entry?.updatedAt ?? 0 });
    }
  } catch (error) {
    console.error('[storage] 저장된 방 목록을 읽지 못했습니다', error.name);
  }
  return rooms.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 커맨드 전송용 토큰. 없으면 null. 반환값은 절대 로그/화면에 쓰지 않는다. */
export function tokenOf(code, seatId) {
  return seatsWithToken(code).find((seat) => seat.seatId === seatId)?.seatToken ?? null;
}

/** 이 기기가 가진 좌석 중 하나라도 있으면 true. */
export function hasSeat(code, seatId) {
  return tokenOf(code, seatId) !== null;
}

/** 호스트 동작에 쓸 토큰(호스트 좌석이 이 기기에 있을 때). */
export function hostTokenOf(code, hostSeatId) {
  return tokenOf(code, hostSeatId);
}

/**
 * SSE presence 쿼리 문자열(`seat-1:token,seat-3:token`).
 * API.md 2장 규격: 최대 4쌍, 1000자.
 */
export function presenceParam(code) {
  const pairs = seatsWithToken(code)
    .slice(0, 4)
    .map((seat) => `${seat.seatId}:${seat.seatToken}`);
  return pairs.join(',');
}
