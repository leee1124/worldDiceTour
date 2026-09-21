/**
 * 도메인이 의존하는 포트(인터페이스) 정의. 구현체는 infrastructure 레이어에 있다.
 * 도메인 코드는 node:*/브라우저 API를 직접 import 하지 않고 이 포트에만 의존한다.
 *
 * @typedef {object} RandomSource
 * @property {(min: number, max: number) => number} nextInt min~max(양쪽 포함) 범위의 정수를 돌려준다.
 *
 * @typedef {object} RoomRepository
 * @property {(room: import('../room/Room.js').Room) => Promise<void>} save
 * @property {(code: string) => Promise<import('../room/Room.js').Room|null>} findByCode
 * @property {() => Promise<import('../room/Room.js').Room[]>} findAll
 * @property {(code: string) => Promise<void>} delete
 *
 * @typedef {object} EventPublisher
 * @property {(code: string, payload: object) => void} publishRoom 로비/좌석 변경 브로드캐스트
 * @property {(code: string, payload: object) => void} publishGame 게임 스냅샷 + 이벤트 브로드캐스트
 * @property {(code: string) => void} closeRoom 방이 사라질 때 그 방의 스트림을 모두 닫는다
 *
 * @typedef {object} PresenceQuery
 * @property {(code: string) => string[]} onlineSeatIds
 *   그 방에서 **토큰 검증을 통과해** 접속 중인 좌석 id 목록.
 *   도메인은 이 목록만 받아 "접속 중인 좌석은 자동 진행으로 바꿀 수 없다" 규칙을 판단한다.
 *   구현체는 server 레이어의 SseHub다.
 *
 * @typedef {object} TokenFactory
 * @property {() => string} create 좌석 토큰(hex 문자열) 생성
 */
export {};
