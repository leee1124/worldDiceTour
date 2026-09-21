/**
 * 호스트 전용 동작 종류.
 *
 * 서비스 파일이 아니라 별도 상수 모듈에 두는 이유: 입력 검증(`server/validation.js`)이
 * 이 목록만 필요한데 `RoomService`에서 가져오면 도메인·저장소까지 딸려 오는
 * 서비스 의존 그래프 전체를 끌고 들어오게 된다.
 */
export const HOST_ACTIONS = Object.freeze({
  ADD_COMPUTER: 'ADD_COMPUTER',
  SET_OPTIONS: 'SET_OPTIONS',
  START: 'START',
  SET_AUTOPILOT: 'SET_AUTOPILOT',
});
