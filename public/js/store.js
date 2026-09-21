/**
 * 클라이언트 상태 저장소. 서버가 준 `room`/`view`가 유일한 진실이고,
 * 여기에는 그 스냅샷과 "이 기기가 가진 좌석" 같은 화면 상태만 둔다.
 */

export const SCREENS = Object.freeze({
  HOME: 'HOME',
  LOBBY: 'LOBBY',
  GAME: 'GAME',
});

export const CONNECTION = Object.freeze({
  IDLE: 'IDLE',
  CONNECTING: 'CONNECTING',
  OPEN: 'OPEN',
  RECONNECTING: 'RECONNECTING',
  CLOSED: 'CLOSED',
});

/** 좌석 색/모양 슬롯. 색만으로 구분하지 않도록 모양 이름도 함께 둔다. */
export const SEAT_SLOTS = Object.freeze([
  { id: 0, color: 'ruby', shape: 'circle', shapeLabel: '원' },
  { id: 1, color: 'azure', shape: 'square', shapeLabel: '사각' },
  { id: 2, color: 'amber', shape: 'diamond', shapeLabel: '다이아' },
  { id: 3, color: 'jade', shape: 'hexagon', shapeLabel: '육각' },
]);

const INITIAL_STATE = Object.freeze({
  screen: SCREENS.HOME,
  serverInfo: null,
  roomList: [],
  roomListError: null,
  savedRooms: [],
  /** 서버 RoomDto */
  room: null,
  /** 서버 GameViewDto */
  view: null,
  /** 이 기기가 가진 좌석 `[{seatId, name}]` (토큰 없음) */
  mySeats: [],
  connection: CONNECTION.IDLE,
  busy: false,
  /** 공항 목적지 선택 모드에서 하이라이트할 금지 칸 */
  travel: null,
  /** 상세 시트를 열어 둔 칸 */
  selectedCell: null,
});

export function createStore() {
  let state = { ...INITIAL_STATE };
  const listeners = new Set();

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (error) {
        console.error('[store] 구독자 처리 중 오류', error);
      }
    }
  };

  return {
    get state() {
      return state;
    },
    patch(partial) {
      state = { ...state, ...partial };
      notify();
      return state;
    },
    /** 화면 전환 시 방/게임 상태를 비운다. */
    resetRoom() {
      state = { ...state, room: null, view: null, mySeats: [], travel: null, selectedCell: null };
      notify();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/* ── 선택자(selector) ─────────────────────────────────────────── */

export function mySeatIds(state) {
  return state.mySeats.map((seat) => seat.seatId);
}

export function isMySeat(state, seatId) {
  return Boolean(seatId) && mySeatIds(state).includes(seatId);
}

/**
 * 지금 차례가 이 기기의 좌석이고 내가 직접 조작할 수 있는지. 행동 버튼 활성화의 유일한 기준.
 * 자동 진행(autopilot)이 걸린 좌석은 서버가 커맨드를 거절하므로 내 차례로 보지 않는다.
 */
export function isMyTurn(state) {
  const seatId = state.view?.currentSeatId;
  if (!seatId || !isMySeat(state, seatId) || state.view?.isOver === true) {
    return false;
  }
  return seatOf(state, seatId)?.autopilot !== true;
}

/** 내 좌석이지만 자동 진행에 맡겨져 있어 조작이 막힌 차례인지. */
export function isMySeatOnAutopilot(state) {
  const seatId = state.view?.currentSeatId;
  return Boolean(seatId) && isMySeat(state, seatId) && seatOf(state, seatId)?.autopilot === true;
}

export function currentSeatId(state) {
  return state.view?.currentSeatId ?? null;
}

export function seatOf(state, seatId) {
  return state.room?.seats.find((seat) => seat.id === seatId) ?? null;
}

export function playerOf(state, seatId) {
  return state.view?.players.find((player) => player.seatId === seatId) ?? null;
}

/** 좌석 이름(없으면 안전한 대체값). 화면에는 항상 textContent로 넣는다. */
export function seatNameOf(state, seatId) {
  return seatOf(state, seatId)?.name ?? playerOf(state, seatId)?.name ?? '알 수 없는 좌석';
}

/** 좌석 순서 기준 색/모양 슬롯. 방 좌석 순서를 우선 쓰고, 없으면 플레이어 순서. */
export function slotOf(state, seatId) {
  const seats = state.room?.seats ?? [];
  let index = seats.findIndex((seat) => seat.id === seatId);
  if (index < 0) {
    index = (state.view?.players ?? []).findIndex((player) => player.seatId === seatId);
  }
  return SEAT_SLOTS[(index < 0 ? 0 : index) % SEAT_SLOTS.length];
}

export function isHostSeatMine(state) {
  return isMySeat(state, state.room?.hostSeatId);
}

export function spaceOf(state, index) {
  return state.view?.board?.[index] ?? null;
}

export function spaceNameOf(state, index) {
  return spaceOf(state, index)?.name ?? `${index}번 칸`;
}

/** 게임 화면을 보여야 하는 방 상태인지. */
export function isPlayingRoom(room) {
  return room?.status === 'PLAYING' || room?.status === 'FINISHED';
}
