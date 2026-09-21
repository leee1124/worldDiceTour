# 월드 다이스 투어 — 서버 API 계약 (클라이언트 UI 개발자용)

## 변경 이력 (UI 개발자 필독)

기존 `GameViewDto` 필드명은 하나도 바뀌지 않았다. 아래는 **추가된 필드와 동작 변경**뿐이다.

| # | 종류 | 변경 내용 | 영향 |
|---|---|---|---|
| 1 | 동작 | `DELETE /api/rooms/:code/seats/:seatId`는 **대기실에서만** 가능. 게임 중/종료 후에는 `409 ERR005` | 게임 중 "나가기" 버튼은 좌석 삭제 대신 **연결만 끊기**로 구현. 호스트가 그 좌석을 자동 진행으로 돌릴 수 있다 |
| 2 | 동작 | `TRAVEL`의 `destination`이 **현재 칸**이면 `400 ERR001`. `pending.forbiddenIndexes`가 이제 `[30]`이 아니라 `[30, <현재 칸>]`을 담는다(공항 칸에 서 있으면 `[30]`) | 공항 목적지 선택 UI는 `forbiddenIndexes`에 든 칸을 **모두** 비활성화할 것 |
| 3 | 동작 | 공항 칸(30)에 더블로 도착해도 `EXTRA_TURN` 이벤트가 없다 | 더블 연출 후 곧바로 턴이 넘어간다 |
| 4 | 동작 | 통행료를 `AWAIT_LIQUIDATION`을 거쳐(`SELL`/`AUTO_SELL`/`TAKE_LOAN`) 낸 경우 **인수를 제안하지 않는다** — `ACQUIRE_OFFERED` 없이 `TURN_ENDED` | 정리 후 인수 모달을 기대하지 말 것. 현금으로 바로 낸 통행료 뒤에는 이전과 같이 제안된다 |
| 5 | 동작 | `SET_AUTOPILOT enabled:true`는 **그 좌석이 오프라인일 때만** 가능(`online: true`면 `409 ERR005`) | 호스트 UI는 `seats[].online === false`인 사람 좌석에만 "자동 진행" 버튼을 켤 것 |
| 6 | 동작 | `SET_AUTOPILOT enabled:false`는 호스트 **또는 그 좌석 본인 토큰**으로 가능 | 돌아온 플레이어가 스스로 "직접 플레이로 복귀" 버튼을 누를 수 있다 |
| 7 | 동작 | 자동 진행 중인 좌석의 게임 커맨드는 그 좌석 토큰이어도 `403 ERR003` | 자동 진행 중에는 행동 버튼을 비활성화하고 "복귀" 버튼만 노출할 것 |
| 8 | **추가 필드** | `RoomDto.autoStalled`(boolean) — 자동 진행이 재시도까지 실패해 멈췄다는 일회성 신호 | `true`인 `room` 이벤트를 받으면 호스트에게 경고를 띄울 것. 다음 `room` 이벤트에서는 다시 `false` |

서버는 **게임 상태와 모든 난수의 유일한 권위**다. 클라이언트는 커맨드를 POST로 보내고, SSE로 받은 스냅샷(`GameViewDto`)과 이벤트 목록으로 화면을 그리고 연출만 한다.

- Base URL: `http://<호스트>:5173` (서버는 `0.0.0.0`에 바인딩. `PORT` 환경변수로 변경 가능)
- 요청/응답 본문은 모두 `application/json; charset=utf-8`
- 인증 헤더: `Authorization: Bearer <seatToken>`
- 요청 본문 최대 크기: **16KB** (초과 시 `ERR009`)
- **알 수 없는 필드는 무시**된다(화이트리스트 검증)
- 모든 응답에 보안 헤더가 붙는다: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
- 정적 파일은 `public/` 아래만 서빙된다. `data/rooms/*.json`(좌석 토큰 포함)은 **절대 서빙되지 않는다.**

## 0. 좌석 토큰 규칙 (중요)

- 방을 만들거나 좌석에 참가하면 서버가 **좌석 토큰**(32바이트 hex, 64자)을 1회 발급한다. 이 응답이 토큰을 볼 수 있는 **유일한 곳**이다.
- 토큰은 어떤 DTO/SSE 페이로드/서버 로그에도 실리지 않는다. 클라이언트는 `localStorage`에 `{ code, seatId, seatToken }`을 보관해 재접속에 쓴다.
- 한 기기가 여러 좌석 토큰을 가질 수 있다(핫시트). 커맨드를 보낼 때는 **그 차례 좌석의 토큰**을 쓴다.
- 서버는 토큰을 `crypto.timingSafeEqual`로 비교한다. 형식(`^[0-9a-f]{64}$`)이 틀리면 즉시 `ERR002`.

---

## 1. 에러 규격

에러 응답 본문은 **항상** 다음 두 필드뿐이다. 스택/내부 메시지는 서버 콘솔에만 남는다.

```json
{ "code": "ERR006", "message": "당신의 차례가 아닙니다." }
```

| 코드 | HTTP | 메시지 | 대표 상황 |
|---|---|---|---|
| `ERR001` | 400 | 요청 형식이 올바르지 않습니다. | 이름/커맨드/payload 화이트리스트 위반, 깨진 JSON, 알 수 없는 커맨드·호스트 동작 |
| `ERR002` | 401 | 좌석 인증에 실패했습니다. | 토큰 없음/형식 오류/일치하는 좌석 없음 |
| `ERR003` | 403 | 권한이 없습니다. | 호스트 전용 동작을 비호스트가 요청, 본문 `seatId`가 토큰 좌석과 불일치, 남의 좌석 강퇴, **자동 진행 중인 좌석의 게임 커맨드** |
| `ERR004` | 404 | 방을 찾을 수 없습니다. | 방 코드 형식 오류 또는 없는 방 |
| `ERR005` | 409 | 지금은 할 수 없는 동작입니다. | 현재 페이즈에서 불가한 커맨드, 대기실에서 게임 커맨드, 이미 시작/종료된 방, **게임 중 좌석 삭제**, **접속 중인 좌석에 자동 진행 켜기** |
| `ERR006` | 409 | 당신의 차례가 아닙니다. | 다른 좌석 차례에 커맨드 전송 |
| `ERR007` | 409 | 방의 좌석이 모두 찼습니다. | 좌석 4개 초과 참가 |
| `ERR008` | 409 | 현금이 부족합니다. | 매입/건설/인수/구조비를 현금으로 낼 수 없음 |
| `ERR009` | 413 | 요청 본문이 너무 큽니다. | 본문 16KB 초과 |
| `ERR010` | 500 | 요청을 처리할 수 없습니다. | 서버 내부 오류 |
| `ERR011` | 404 | 요청한 경로를 찾을 수 없습니다. | 없는 API 경로/정적 파일, 경로 탈출 시도 |
| `ERR012` | 409 | 좌석을 찾을 수 없습니다. | 없는 좌석 id 지정 |
| `ERR013` | 409 | 게임을 시작할 수 없습니다. | 좌석 2명 미만 |
| `ERR014` | 405 | 허용되지 않은 요청 방식입니다. | 잘못된 HTTP 메서드 |

---

## 2. 엔드포인트

### `GET /api/server-info`

로비에 "다른 기기에서 이 주소로 접속" 안내를 띄우기 위한 LAN 주소 목록.

```json
{ "port": 5173, "urls": ["http://192.168.0.12:5173"], "localUrl": "http://localhost:5173" }
```

### `GET /api/rooms`

참가 가능한 방 목록(대기실이고 자리가 남은 방만, 최근 수정 순).

```json
{
  "rooms": [
    {
      "code": "DK7P",
      "status": "LOBBY",
      "hostName": "하나",
      "seatCount": 2,
      "maxSeats": 4,
      "options": { "roundLimit": null },
      "updatedAt": 1758400000000
    }
  ]
}
```

### `POST /api/rooms` → 201

방 만들기. 요청 `{ "hostName": "하나" }` (`^[가-힣a-zA-Z0-9 ]{1,10}$`, 공백만인 이름 불가)

```json
{
  "room": { "...RoomDto": "3장 참고" },
  "seatId": "seat-1",
  "seatToken": "9f2c…(64자 hex)"
}
```

### `GET /api/rooms/:code`

방 + (진행 중이면) 게임 스냅샷. 재접속·새로고침 시 현재 상태를 한 번에 받는 용도.

```json
{ "room": { "...RoomDto": "" }, "game": { "...GameViewDto": "" } }
```
`game`은 대기실이면 `null`.

### `POST /api/rooms/:code/seats` → 201

좌석 참가(대기실에서만). 요청 `{ "name": "두리" }`

```json
{ "room": { "...RoomDto": "" }, "seatId": "seat-2", "seatToken": "…" }
```
- 좌석이 4개면 `ERR007`, 게임이 시작된 방이면 `ERR005`.

### `DELETE /api/rooms/:code/seats/:seatId`

본인 퇴장(자기 토큰) 또는 호스트 강퇴(호스트 토큰). 인증 필수.
- `seatId` 형식은 `^seat-\d{1,3}$`.
- 호스트가 나가면 남은 첫 좌석이 호스트를 이어받는다. 마지막 좌석이 나가면 방이 삭제된다(열려 있던 SSE 스트림도 함께 닫힌다).
- **대기실(`LOBBY`)에서만 가능하다.** 진행 중(`PLAYING`)이거나 끝난(`FINISHED`) 방에서는 본인 퇴장이든 호스트 강퇴든 `409 ERR005`다. 게임에서 플레이어를 빼면 턴 순서와 채권 관계가 깨져 방을 되살릴 수 없기 때문이다.
  - 따라서 **게임 중 "나가기"는 클라이언트가 그냥 연결을 끊는 것**으로 구현한다(`EventSource`를 닫으면 presence가 사라져 `online: false`가 방송된다).
  - 남은 사람들은 멈추지 않는다: 호스트가 `SET_AUTOPILOT`으로 그 오프라인 좌석을 서버 자동 진행으로 돌릴 수 있다.

```json
{ "room": { "...RoomDto": "" } }
```

### `POST /api/rooms/:code/host-actions`

호스트 토큰 전용. 응답은 `{ "room": RoomDto }`.

| `type` | 추가 필드 | 설명 | 제약 |
|---|---|---|---|
| `ADD_COMPUTER` | `name` | 컴퓨터 좌석 추가 | 대기실, 좌석 4개 미만 |
| `SET_OPTIONS` | `roundLimit`: `null \| 20 \| 30` | 라운드 제한 | 대기실 |
| `SET_AUTOPILOT` | `seatId`, `enabled`(boolean) | 오프라인 좌석을 서버 자동 진행으로 전환/복귀 | 사람 좌석만. **켜기**는 호스트 + 그 좌석이 오프라인일 때만(`ERR005`), **끄기**는 호스트 또는 그 좌석 본인 토큰(그 외 `ERR003`) |
| `START` | — | 게임 시작 | 대기실, 좌석 2명 이상 |

`START` 직후 SSE로 `room`과 `game`(events: `[]`)이 함께 방송된다.

**`SET_AUTOPILOT` 상세 (이중 조종 방지)**
- **켜기(`enabled: true`)**: 호스트 토큰만, 그리고 대상 좌석이 `online: false`일 때만. 접속 중이면 `409 ERR005`. 사람과 서버가 같은 좌석을 동시에 조종하면 커맨드가 경합하기 때문이다.
- **끄기(`enabled: false`)**: 호스트 토큰 **또는 그 좌석 본인 토큰**. 돌아온 플레이어가 스스로 조종권을 회수할 수 있다. 남의 좌석을 비호스트가 끄려 하면 `403 ERR003`.
- 자동 진행 중인 좌석에 `POST /commands`를 보내면 토큰이 맞아도 `403 ERR003`이다(먼저 자동 진행을 끌 것). 이 검사는 "내 차례 아님(`ERR006`)"보다 먼저 걸린다.
- 켠 좌석이 **지금 차례**면 서버가 곧바로 대행을 예약하고, 끄면 대기 중인 예약을 취소한다.
- 컴퓨터 좌석(`kind: "COMPUTER"`)의 설정은 바꿀 수 없다(`409 ERR005`).

### `POST /api/rooms/:code/commands`

게임 커맨드. 해당 좌석 토큰 필수. 요청:

```json
{ "type": "BUILD", "seatId": "seat-1", "payload": { "buildings": ["VILLA", "HOTEL"] } }
```
- `seatId`는 생략 가능(선택). 넣었는데 토큰의 좌석과 다르면 `ERR003`.
- 응답은 SSE와 동일한 페이로드:

```json
{ "view": { "...GameViewDto": "" }, "events": [ { "type": "DICE_ROLLED", "…": "" } ] }
```

### `GET /api/rooms/:code/events` (SSE)

`text/event-stream`. 연결 직후 순서:

1. `: connected` (주석)
2. `event: room` — 현재 `RoomDto`
3. `event: game` — `{ view: GameViewDto, events: [] }` (게임 진행 중일 때만)

이후 방 변경마다 `room`, 커맨드 처리마다 `game`이 방송된다. 약 20초마다 `: ping` 주석이 온다(EventSource는 무시).

**presence(온라인 표시) 메커니즘** — `EventSource`는 커스텀 헤더를 보낼 수 없으므로, 이 기기가 가진 좌석을 쿼리로 알린다:

```
GET /api/rooms/DK7P/events?presence=seat-1:<token1>,seat-3:<token3>
```
- 형식은 `seatId:token` 쌍을 콤마로 이은 문자열(최대 4쌍, 1000자).
- 서버가 **각 쌍의 토큰을 실제로 검증**하고, 통과한 좌석만 그 연결이 살아 있는 동안 `online: true`가 된다. 검증에 실패한 쌍은 조용히 무시된다.
- 토큰은 어떤 응답/이벤트/로그에도 다시 나타나지 않는다. presence가 붙거나 연결이 끊기면 `room` 이벤트가 다시 방송된다.
- 컴퓨터 좌석은 항상 `online: true`로 표시된다.

없는 방이면 `404 ERR004`(스트림을 열지 않는다).

---

## 3. RoomDto

```json
{
  "code": "DK7P",
  "status": "LOBBY",
  "hostSeatId": "seat-1",
  "options": { "roundLimit": null },
  "maxSeats": 4,
  "seats": [
    { "id": "seat-1", "name": "하나", "kind": "HUMAN", "autopilot": false, "isHost": true, "online": true },
    { "id": "seat-2", "name": "컴퓨터1", "kind": "COMPUTER", "autopilot": false, "isHost": false, "online": true }
  ],
  "createdAt": 1758400000000,
  "updatedAt": 1758400009000,
  "autoStalled": false
}
```

| 필드 | 뜻 |
|---|---|
| `code` | 4자리 방 코드 `^[A-HJ-NP-Z2-9]{4}$` (헷갈리는 I·O·0·1 제외) |
| `status` | `LOBBY` → `PLAYING` → `FINISHED` |
| `hostSeatId` | 호스트 좌석 id. 호스트만 호스트 동작 가능 |
| `options.roundLimit` | `null`(무제한) / `20` / `30` |
| `seats[].kind` | `HUMAN` \| `COMPUTER` |
| `seats[].autopilot` | 사람 좌석을 서버가 대신 진행 중인지. `true`인 동안 그 좌석의 게임 커맨드는 `ERR003` |
| `seats[].online` | presence로 확인된 접속 여부(컴퓨터는 항상 true) |
| `createdAt`/`updatedAt` | epoch ms. 24시간 이상 방치된 방은 서버 시작 시와 주기적으로 정리된다 |
| `autoStalled` | 자동 진행(컴퓨터/자동 좌석 대행)이 재시도를 모두 소진해 멈췄다는 **일회성 신호**. 이 값이 `true`인 `room` 이벤트는 "호스트가 개입해야 한다"는 뜻이며, 이후의 평범한 `room` 이벤트에서는 다시 `false`다. 호스트는 해당 좌석의 자동 진행을 끄거나 방을 정리하면 된다 |

---

## 4. GameViewDto

```json
{
  "version": 1,
  "phase": "AWAIT_ACQUIRE",
  "round": 1,
  "roundLimit": null,
  "currentSeatId": "seat-1",
  "jackpot": 0,
  "isOver": false,
  "players": [
    {
      "seatId": "seat-1", "name": "하나", "cash": 2972000, "position": 3,
      "eliminated": false, "islandRemainingTurns": 0, "airportPending": false,
      "loanUsed": false, "loanDebt": 0, "cityCount": 0, "resortCount": 0, "totalAssets": 2972000
    }
  ],
  "board": [
    { "index": 0, "name": "출발", "kind": "START" },
    {
      "index": 3, "name": "방콕", "kind": "CITY", "price": 70000, "ownerId": "seat-2",
      "buildings": ["VILLA"], "landmark": false, "invested": 91000,
      "toll": 28000, "acquisitionPrice": 182000
    }
  ],
  "pending": { "kind": "ACQUIRE", "index": 3, "name": "방콕", "ownerId": "seat-2", "price": 182000 },
  "rankings": null
}
```

| 필드 | 뜻 |
|---|---|
| `version` | **단조 증가** 버전. 커맨드 1개 처리마다 +1. 오래된 SSE 메시지 무시/재정렬 방지에 사용 |
| `phase` | 현재 페이즈(5장) |
| `round` | 현재 라운드(1부터). 좌석 순서가 한 바퀴 돌 때 +1 |
| `roundLimit` | `null`이면 무제한 |
| `currentSeatId` | 지금 차례인 좌석 id. **내 좌석 토큰이 있는 좌석과 같을 때만 행동 버튼 활성화** |
| `jackpot` | 카지노 잭팟 적립금(원) |
| `isOver` | 게임 종료 여부 |
| `players[].cash` | 보유 현금 |
| `players[].position` | 보드 칸 번호(0~39) |
| `players[].eliminated` | 파산 탈락 |
| `players[].islandRemainingTurns` | 조난 섬에 남은 턴(0이면 자유) |
| `players[].airportPending` | 다음 자기 턴에 공항 이동권을 쓸 수 있는지 |
| `players[].loanUsed` / `loanDebt` | 대출 사용 여부 / 남은 채무(월급이 압류된다) |
| `players[].cityCount` / `resortCount` | 보유 도시 수 / 휴양지 수 |
| `players[].totalAssets` | 현금 + 자산 투자액 − 남은 대출 채무(라운드 제한 순위 기준) |
| `board[].kind` | `START`·`CITY`·`RESORT`·`TICKET`·`TAX`·`ISLAND`·`CASINO`·`AIRPORT` |
| `board[].price` | 매입가(소유 가능 칸만) |
| `board[].ownerId` | 소유 좌석 id 또는 `null` |
| `board[].buildings` | `["VILLA","BUILDING","HOTEL"]` 중 지어진 것(정해진 순서) |
| `board[].landmark` | 랜드마크 완성 여부 |
| `board[].invested` | 매입가 + 정가 기준 건설비 합계. 매각 환급은 이 값의 50% |
| `board[].toll` | 지금 이 칸에 걸리면 낼 통행료 |
| `board[].acquisitionPrice` | 인수 가격(`invested × 2`). 인수 불가(랜드마크/휴양지/주인 없음)면 `null` |
| `pending` | 현재 플레이어가 내려야 하는 결정(6장). 결정이 없으면 `null` |
| `rankings` | 종료 시에만 채워진다: `[{ playerId, name, rank, cash, totalAssets, loanDebt, eliminated }]` |

> 소유 불가능 칸(`START`/`TICKET`/`TAX`/`ISLAND`/`CASINO`/`AIRPORT`)에는 `price` 이하 필드가 없다.

---

## 5. 페이즈와 커맨드

| 페이즈 | 허용 커맨드 | payload |
|---|---|---|
| `AWAIT_ROLL` | `ROLL` | 없음 |
| `AWAIT_BUY` | `BUY`, `SKIP_BUY` | 없음 |
| `AWAIT_BUILD` | `BUILD`, `SKIP_BUILD` | `BUILD`: `{ buildings: string[] }` |
| `AWAIT_START_BUILD` | `START_BUILD`, `SKIP_START_BUILD` | `START_BUILD`: `{ cityIndex: 0~39, buildings: string[] }` |
| `AWAIT_ACQUIRE` | `ACQUIRE`, `SKIP_ACQUIRE` | 없음 |
| `AWAIT_CASINO` | `CASINO_BET`, `CASINO_LEAVE` | `CASINO_BET`: `{ game, bet, choice }` |
| `AWAIT_ISLAND_CHOICE` | `ISLAND_PAY`, `ISLAND_ROLL` | 없음 |
| `AWAIT_TRAVEL` | `TRAVEL` | `{ destination: 0~39 }` (공항 칸 30과 현재 칸은 불가) |
| `AWAIT_LIQUIDATION` | `SELL`, `AUTO_SELL`, `TAKE_LOAN`, `DECLARE_BANKRUPTCY` | `SELL`: `{ cityIndex: 0~39 }` |
| `GAME_OVER` | 없음(모든 커맨드 `ERR005`) | — |

### 커맨드 상세

| 커맨드 | 뜻과 규칙 |
|---|---|
| `ROLL` | 주사위 2개. 더블이면 턴 종료 후 한 번 더(같은 좌석 `AWAIT_ROLL`), 3연속 더블이면 이동 없이 조난 섬 |
| `BUY` | 빈 칸 매입. 현금 부족 시 `ERR008`. 매입 직후 같은 턴에 `AWAIT_BUILD`(건설 기회) |
| `SKIP_BUY` | 매입 포기 → 턴 종료 |
| `BUILD` | `buildings`는 `pending.options[].type` 중에서만 고른다. 중복 불가. `LANDMARK`는 **단독으로만**(3종을 이미 가진 기회일 때) |
| `SKIP_BUILD` | 건설 포기 |
| `START_BUILD` | 출발 칸 보너스. `pending.candidates` 중 하나의 `index`와 그 후보의 `options`에서 고른 건물 |
| `SKIP_START_BUILD` | 보너스 포기 |
| `ACQUIRE` | 통행료를 낸 남의 도시를 `pending.price`(= invested × 2)에 인수. **보유 현금만** 사용(부족하면 `ERR008`). 인수 후 `AWAIT_BUILD`. 통행료를 정리 페이즈로 낸 턴에는 이 페이즈에 오지 않는다 |
| `SKIP_ACQUIRE` | 인수 포기 |
| `CASINO_BET` | `game`: `ODD_EVEN`(choice `ODD`\|`EVEN`) / `HIGH_LOW_SEVEN`(choice `LOW`\|`HIGH`\|`SEVEN`) / `SLOT`(choice 불필요). `bet`은 10,000원 단위, 10,000 ~ min(현금, 500,000). 한 방문 최대 3판 |
| `CASINO_LEAVE` | 카지노에서 나가 턴 종료 |
| `ISLAND_PAY` | 구조비 200,000원 지불 후 즉시 `AWAIT_ROLL`(같은 턴에 정상 굴림). 현금 부족 시 `ERR008` |
| `ISLAND_ROLL` | 더블이면 탈출해 그 눈만큼 이동(추가 턴 없음), 아니면 남은 턴 −1 후 턴 종료 |
| `TRAVEL` | 공항 이동권 사용. 앞 방향으로 이동하므로 출발 칸을 지나면 월급. 도착 칸 효과 정상 적용. `pending.forbiddenIndexes`의 칸(공항 칸·현재 칸)을 고르면 `ERR001` |
| `SELL` | 정리 페이즈에서 고른 자산 하나를 `invested × 0.5`에 은행 매각(건물 포함 초기화) |
| `AUTO_SELL` | 환급액이 낮은 자산부터 필요한 만큼 자동 매각. 팔 자산이 없으면 `ERR005` |
| `TAKE_LOAN` | 게임당 1회. 현금 +1,000,000, 채무 1,200,000. 이후 월급이 채무 상환에 압류된다. 이미 썼으면 `ERR005` |
| `DECLARE_BANKRUPTCY` | 정리 페이즈에서 **항상 가능**. 남은 현금을 채권자에게 넘기고 모든 자산 초기화 후 탈락 |

> 현금 ≥ 지불액이 되는 즉시 지불이 자동 완료되고 중단됐던 흐름이 이어진다.
> 단 **정리 페이즈를 거친 통행료 뒤에는 인수를 제안하지 않는다** — 인수는 보유 현금으로만 할 수 있으므로(명세 4장), 매각·대출로 만든 돈으로 인수하는 길을 막는다.

---

## 6. pending(결정 요청) 형태

| `kind` | 필드 |
|---|---|
| `BUY` | `index`, `name`, `price` |
| `BUILD` | `index`, `name`, `options: [{ type, cost }]`, `buildings`(이미 지은 것), `landmark` |
| `START_BUILD` | `candidates: [{ index, name, price, options: [{ type, cost }] }]` |
| `ACQUIRE` | `index`, `name`, `ownerId`, `price` |
| `CASINO` | `roundsLeft`, `limits: { min, max, unit }`, `jackpot` |
| `ISLAND` | `remainingTurns`, `fee`(200000), `canPayFee` |
| `TRAVEL` | `forbiddenIndexes: number[]` — 공항 칸(30)과 현재 칸. 공항 칸에 서 있으면 한 칸으로 합쳐져 `[30]` |
| `LIQUIDATION` | `amountDue`, `creditorId`(은행/잭팟이면 `null`), `canSell`, `canLoan`, `sellable: [{ index, name, refund }]` |

`AWAIT_ROLL`과 `GAME_OVER`에서는 `pending`이 `null`이다.

---

## 7. 도메인 이벤트 (UI 연출/로그용)

`game` SSE 메시지의 `events`는 **그 커맨드가 만든 이벤트 목록**이며 발생 순서대로 들어 있다. 각 이벤트는 `type` + 아래 필드를 가진다.

### 턴 흐름
| type | 필드 | 의미 |
|---|---|---|
| `TURN_STARTED` | `playerId`, `round` | 새 턴 시작 |
| `DICE_ROLLED` | `playerId`, `die1`, `die2`, `sum`, `isDouble` | 주사위 연출 |
| `MOVED` | `playerId`, `from`, `to`, `steps`, `passedStart` | 말 이동. `steps`가 `null`이면 순간이동(조난 이송) |
| `LANDED` | `playerId`, `index`, `kind`, `name` | 도착 칸 |
| `EXTRA_TURN` | `playerId` | 더블로 한 번 더 |
| `TURN_ENDED` | `playerId` | 턴 종료 |
| `ROUND_ADVANCED` | `round` | 라운드 증가 |
| `GAME_OVER` | `reason`(`LAST_SURVIVOR` \| `ROUND_LIMIT`), `rankings` | 종료 순위 모달 |

### 돈
| type | 필드 | 의미 |
|---|---|---|
| `SALARY_PAID` | `playerId`, `amount` | 실제로 받은 월급(압류 후 잔액) |
| `SALARY_SEIZED` | `playerId`, `amount`, `remainingDebt` | 월급이 대출 상환에 압류됨 |
| `LOAN_TAKEN` | `playerId`, `principal`, `debt` | 대출 실행 |
| `LOAN_REPAID` | `playerId` | 대출 완납 |
| `TOLL_PAID` | `payerId`, `ownerId`, `index`, `amount` | 통행료 |
| `TAX_PAID` | `playerId`, `amount`, `ticketId?` | 세관/세무조사(잭팟 적립) |
| `MONEY_GAINED` | `playerId`, `amount`, `reason`, `ticketId?` | 은행에서 수령 |
| `MONEY_LOST` | `playerId`, `amount`, `reason`, `ticketId?`, `toPlayerIds?` | 은행/타인에게 지불 |
| `MONEY_TRANSFERRED` | `fromId`, `toId`, `amount`, `reason` | 플레이어 간 이동 |
| `JACKPOT_CHANGED` | `jackpot` | 잭팟 적립금 변화 |

`reason`: `SALARY`·`PURCHASE`·`BUILD`·`TOLL`·`TAX`·`TICKET`·`CASINO`·`ISLAND_RESCUE`·`LIQUIDATION`·`BANKRUPTCY`·`ACQUISITION`·`LOAN`

### 도시·건물·인수
| type | 필드 | 의미 |
|---|---|---|
| `CITY_PURCHASED` | `playerId`, `index`, `name`, `price` | 매입 |
| `PURCHASE_DECLINED` | `playerId`, `index` | 매입 포기 |
| `BUILD_OFFERED` | `playerId`, `index`, `name`, `options` | 건설 기회 열림 |
| `BUILT` | `playerId`, `index`, `name`, `buildings`, `cost` | 건설 완료(지은 목록) |
| `LANDMARK_BUILT` | `playerId`, `index`, `name`, `cost` | 랜드마크 완성(`BUILT`와 함께 발생) |
| `BUILD_DECLINED` | `playerId`, `index` | 건설 포기(`index`는 출발 보너스 포기 시 `null`) |
| `START_BONUS_OFFERED` | `playerId`, `candidates` | 출발 칸 보너스 |
| `ACQUIRE_OFFERED` | `playerId`, `index`, `name`, `ownerId`, `price` | 인수 제안 |
| `ACQUIRED` | `playerId`, `index`, `name`, `fromId`, `price` | 인수 성립 |
| `ACQUIRE_DECLINED` | `playerId`, `index` | 인수 포기 |

### 행운 티켓 · 조난 섬 · 공항 · 카지노
| type | 필드 | 의미 |
|---|---|---|
| `TICKET_DRAWN` | `playerId`, `ticketId`, `text`, `effect` | 카드 뒤집기 연출. `text`는 화면에 그대로(textContent) 출력 |
| `STRANDED` | `playerId`, `remainingTurns` | 조난 시작 |
| `ISLAND_RESCUE_PAID` | `playerId`, `amount` | 구조비 지불 |
| `ISLAND_ESCAPED` | `playerId`, `by`(`PAY` \| `DOUBLE`) | 탈출 |
| `ISLAND_STAY` | `playerId`, `remainingTurns` | 탈출 실패 |
| `AIRPORT_TICKET_GRANTED` | `playerId` | 공항 도착(다음 턴에 이동권). 더블이어도 이 턴은 여기서 끝난다 |
| `AIRPORT_READY` | `playerId` | 이동권을 쓸 턴이 시작됨 |
| `TRAVELED` | `playerId`, `from`, `to` | 목적지 선택 완료 |
| `CASINO_ENTERED` | `playerId`, `roundsLeft`, `jackpot` | 카지노 입장 |
| `CASINO_RESULT` | `playerId`, `game`, `bet`, `win`, `payout`, `jackpotWon`, `detail` | 판정 결과 |
| `CASINO_LEFT` | `playerId` | 카지노 퇴장 |

`CASINO_RESULT.detail`:
- `ODD_EVEN`: `{ die, outcome, choice }`
- `HIGH_LOW_SEVEN`: `{ die1, die2, sum, outcome, choice }`
- `SLOT`: `{ symbols: ["🍒","🍋","🔔"], matched, jackpotSymbol }`

### 지불 불능
| type | 필드 | 의미 |
|---|---|---|
| `LIQUIDATION_REQUIRED` | `playerId`, `amountDue`, `creditorId`, `reason` | 정리 페이즈 진입 |
| `PROPERTY_SOLD` | `playerId`, `index`, `name`, `refund` | 자산 매각 |
| `DEBT_SETTLED` | `playerId`, `amount` | 정리 후 채무 정산 완료 |
| `BANKRUPT` | `playerId`, `creditorId`, `paidAmount`, `releasedIndexes` | 파산(초기화된 칸 목록 포함) |

### 행운 티켓 효과(`TICKET_DRAWN.effect.type`)

`GAIN`·`LOSE`(`amount`) / `MOVE_RELATIVE`(`steps`) / `MOVE_TO`(`index`) / `TO_ISLAND` / `COLLECT_FROM_ALL`·`PAY_TO_ALL`(`amount`) / `PAY_PER_BUILDING`(`amount`) / `GAIN_PER_CITY`(`amount`) / `NEAREST_RESORT` / `TAX_RATE`(`rate`)

---

## 8. 클라이언트 구현 권장 흐름

1. 시작 화면: `GET /api/rooms`로 목록, `POST /api/rooms`(방 만들기) 또는 `POST /api/rooms/:code/seats`(코드로 참가). 받은 `seatToken`을 `localStorage`에 저장.
2. 로비: `GET /api/rooms/:code`로 초기 상태 → `EventSource('/api/rooms/:code/events?presence=…')` 연결. `GET /api/server-info`의 `urls`를 크게 표시.
3. 게임: `game` 이벤트를 받으면 `view.version`이 이전보다 큰 것만 반영하고, `events`를 순서대로 애니메이션 큐에 넣는다.
4. 내 차례 판단: `view.currentSeatId`가 이 기기가 가진 좌석 중 하나일 때만 버튼 활성화. 버튼은 `view.phase` + `view.pending`으로 결정.
5. 커맨드 실패 시 `code`에 맞는 한국어 안내를 보여주고, 서버가 준 `view`를 유일한 진실로 삼아 화면을 되돌린다.
6. 서버에서 온 문자열(`name`, 티켓 `text` 등)은 반드시 `textContent`로 출력한다(`innerHTML` 금지).
