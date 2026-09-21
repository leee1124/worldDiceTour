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
| 9 | 동작 | 본문이 있는 요청은 `Content-Type: application/json`이 **필수**(파라미터 허용). 아니면 `400 ERR001` | `fetch`에 헤더를 반드시 붙일 것(`FormData`·`text/plain` 금지) |
| 10 | **새 에러 코드** | `ERR015`(403) — 허용되지 않은 `Host` 헤더 | 랜 주소(사설 IP/localhost/`*.local`/단일 라벨)로만 접속. 그 외 도메인은 `ALLOWED_HOSTS` 환경변수에 등록 |
| 11 | 동작 | 모든 API JSON 응답에 `cache-control: no-store` | 캐시 우회 쿼리 파라미터를 붙일 필요가 없다 |
| 12 | **새 에러 코드** | `ERR016`(503) — SSE 구독자 상한(방당 16, 전체 128) 초과. **이벤트 스트림이 아니라 JSON**으로 온다 | `EventSource`가 바로 끊기면 재접속을 무한 반복하지 말고 잠시 뒤 재시도할 것 |
| 13 | **새 에러 코드** | `ERR017`(503) — 서버 방 개수 상한(200) 초과 | 방 만들기 실패 안내를 띄우고 잠시 후 재시도를 권할 것 |
| 14 | 동작 | `rankings` 정렬에 동점 기준이 추가됐다: 총자산 → **현금** → 좌석 순서 | 같은 상태면 항상 같은 순위가 나온다(종료 모달이 흔들리지 않는다) |
| 15 | 동작 + **추가 필드** | 채권자가 여러 명인 채무(`한턱 쏘기`)로 파산하면 남은 현금이 **여러 `MONEY_TRANSFERRED` 이벤트로 나뉘어** 발생한다(이전에는 첫 채권자 한 명에게 전액). `BANKRUPT`에 `creditorIds`(배열)가 추가됐다 | 파산 로그 연출은 `MONEY_TRANSFERRED`를 여러 건 받을 수 있다고 가정할 것. 누가 받았는지는 `creditorIds`를 볼 것(`creditorId`는 대표 한 명이라 금액과 짝지으면 어긋난다) |
| 16 | 동작 | 에러 응답에서 본문을 끝까지 읽지 않은 경우(413/415) 연결이 닫힌다(`connection: close`) | 큰 본문을 보내다 거절당하면 그 연결은 재사용되지 않는다 |
| 17 | 동작 + **추가 필드** + **새 이벤트** | **바퀴(lap)별 건설 제한**(명세 4장). 플레이어마다 바퀴 수가 있고 **1바퀴 별장 / 2바퀴 빌딩 / 3바퀴부터 호텔**만 지을 수 있다. 추가 필드: `GameViewDto.players[].lap`(정수, 1부터), 건설 관련 `pending`의 `lockedOptions`, 그리고 `options[]`·`lockedOptions[]` 각 항목의 `locked`(boolean)·`unlockLap`(정수). 새 이벤트 `LAP_ADVANCED { playerId, lap }`. **`options`의 뜻은 그대로다** — 여전히 "지금 고를 수 있는 건물"만 들어 있으므로 예전 클라이언트도 잘못된 건물을 고르지 않는다 | 잠긴 건물을 보여 주려면 `lockedOptions`를 읽어 비활성 행으로 그리고 `unlockLap`으로 "n바퀴부터"를 안내할 것. `options`에 없는 건물을 BUILD/START_BUILD로 보내면 `400 ERR001`이고 상태는 바뀌지 않는다. 플레이어 패널에는 `players[].lap`을 함께 보여 줄 것 |
| 18 | **추가 필드** | `GameViewDto.actingSeatId` — 지금 **결정을 내릴** 좌석. 오늘은 항상 `currentSeatId`와 같다 | 지금은 무시해도 된다. 앞으로 압류 경매처럼 턴 소유자가 아닌 좌석이 결정하는 구간에서만 달라지므로, "내 차례" 판정을 새로 만들 때는 `actingSeatId`를 쓰는 편이 앞날에 안전하다(`currentSeatId`는 계속 턴 소유자다) |
| 19 | **추가 필드** | `RoomDto.options.finance = { investmentMode, financeSystem, tradeTimerSec, scenario }`. 기본값 `"OFF"` / `"BASIC"` / `0` / `"STANDARD"` | 로비 호스트 도구에 표시만 하면 된다. **지금은 기본값 외의 값을 보내면 `400 ERR001`이다**(해당 기능이 아직 없다). `RoomSummaryDto.options`에는 들어가지 않는다(목록은 `roundLimit`만) |
| 20 | 동작 | `SET_OPTIONS`에 `finance`를 **넣을 수 있고, 생략하거나 일부 키만 보내면 나머지는 기존 값이 유지된다** | 기존 클라이언트(roundLimit만 보내는)는 그대로 동작한다 |
| 21 | 동작 | 저장 파일에 `schemaVersion: 2`가 생겼다(서버 내부 형식) | 클라이언트 영향 없음. 예전에 저장된 방(버전 필드 없음)은 서버가 자동으로 승급해 그대로 이어진다 |
| 22 | **추가 필드** | `pending.sellable` 항목에 `assetKind`("PROPERTY")와 `assetId`가 가산됐다. `index`·`name`·`refund`는 그대로다 | 기존 정리 모달은 고칠 것이 없다. 앞으로 주식·예금이 같은 목록에 섞이면 **`assetKind`로 분기**하면 되고, `index`는 부동산 항목에만 있다 |

### 증권거래소(투자 모드 `STOCKS`) — 9장 참고

아래 23~33번은 **`options.finance.investmentMode === "STOCKS"`인 방에서만** 나타난다.
`"OFF"`인 방의 응답은 한 바이트도 달라지지 않는다(골든 회귀 테스트가 이를 증명한다).

| # | 종류 | 변경 내용 | 영향 |
|---|---|---|---|
| 23 | **옵션 값 개방** | `SET_OPTIONS`의 `finance.investmentMode`가 이제 `"OFF"`와 **`"STOCKS"`** 두 값을 받는다. 나머지 금융 옵션(`financeSystem` `"ADVANCED"`, `tradeTimerSec` `30`/`45`, `scenario` `"BUBBLE"`/`"DEPRESSION"`)은 **여전히 `400 ERR001`** | 로비 호스트 도구의 "투자 모드" 행을 실제 토글로 바꿀 것. 대기실에서만 바꿀 수 있고 `START` 시점 값이 판 내내 고정된다 |
| 24 | **새 페이즈** | `AWAIT_TRADE` — 자기 턴 시작 직후(조난/공항/굴리기 **앞**)에 열리는 거래 창구. 커맨드 `BUY_STOCK` `SELL_STOCK` `DEPOSIT` `WITHDRAW` `CLOSE_TRADING` | 거래 모달을 이 페이즈에서 연다. **`CLOSE_TRADING`을 보내야 주사위/조난/공항 화면으로 넘어간다**(서버가 예산 소진 시 자동으로 닫기도 한다) |
| 25 | **새 커맨드** | `QUEUE_ORDER` / `CANCEL_QUEUED_ORDER` — **모든 페이즈에서 자기 좌석에 한해** 허용(남의 턴 예약 주문). 게임 상태는 바뀌지 않고 큐만 바뀌지만 `version`은 +1 된다 | 남의 턴에도 "예약 주문" 버튼을 열 수 있다. 예약은 **내 차례 시작 시 자동 체결**되며 그때 전면 재검증된다 |
| 26 | **새 커맨드** | `SELL_ASSET { assetKind, assetId, quantity? }` — 정리 페이즈에서 자산군을 가리지 않는 매각. 기존 `SELL { cityIndex }`는 **그대로 동작한다**(하위호환) | 정리 모달은 `pending.sellable[].assetKind`/`assetId`를 그대로 되돌려주는 `SELL_ASSET`으로 바꾸면 주식·예금까지 한 버튼으로 처리된다 |
| 27 | **추가 필드** | `GameViewDto.market` — 시세·국면·뉴스·전원 보유/예금·예약 주문·내 예산·수수료 규칙이 담긴 공개 스냅샷. 투자 모드가 `OFF`면 **`null`** | 남의 턴에도 항상 그려지는 시세 패널/티커의 유일한 입력이다 |
| 28 | **추가 필드** | `GameViewDto.players[]`에 `stockValue`·`depositBalance`·`netWorth`(내역 객체) 가산. `totalAssets`의 **뜻이 넓어졌다** — 이제 주식 평가액과 예금도 포함한다 | 플레이어 패널의 총자산 내역을 `현금 / 부동산 / 주식 / 예금 / −대출`로 분해해 보여 줄 것. `totalAssets === netWorth.total` |
| 29 | **추가 필드** | `pending`에 `kind: "TRADE"`가 생겼고, `LIQUIDATION`의 `sellable` 항목에 `quantity`·`maxQuantity`·`unitValue`가 가산됐다(`index`·`name`은 여전히 부동산 항목에만 있다) | 정리 모달은 `assetKind`로 분기하고 주식은 수량 입력을 받을 것 |
| 30 | **새 이벤트** | 19종: `TRADING_OPENED` `TRADING_CLOSED` `ORDER_FILLED` `ORDER_REJECTED` `DEPOSIT_MADE` `DEPOSIT_WITHDRAWN` `DEPOSIT_INTEREST_PAID` `DIVIDEND_PAID` `NEWS_PUBLISHED` `CYCLE_CHANGED` `BASE_RATE_CHANGED` `PRICES_UPDATED` `INSTRUMENT_DELISTED` `INSTRUMENT_LISTED` `HOLDINGS_WIPED` `QUEUED_ORDER_PLACED` `QUEUED_ORDER_CANCELLED` `QUEUED_ORDER_EXECUTED` `QUEUED_ORDER_REJECTED` (7장) | 라운드 틱 연출(뉴스 카드 뒤집기 → 시세 갱신)은 `NEWS_PUBLISHED` → `PRICES_UPDATED` 순서로 온다 |
| 31 | **새 에러 코드** | `ERR018`(409) 주문 한도를 초과했습니다 / `ERR019`(429) 요청이 너무 잦습니다 | `ERR018`은 창구 예산(3건·2,000,000원)·종목 보유 상한·예금 한도 위반. `ERR019`는 좌석당 거래 커맨드 레이트 리밋(5초 10건) — **즉시 재시도하지 말 것** |
| 32 | 동작 | 저장 파일이 `schemaVersion: 3`이 됐다(서버 내부 형식) | 클라이언트 영향 없음. 예전에 저장된 방은 자동 승급되며 **투자 모드는 `OFF`로 유지된다**(진행 중인 판에 기능이 끼어들지 않는다) |
| 33 | 동작 | `rankings`와 `players[].totalAssets`가 주식 평가액·예금을 포함한다(단일 출처 `NetWorth`) | 종료 순위 모달의 총자산 내역도 28번의 `netWorth`로 분해해 보여 줄 수 있다 |

서버는 **게임 상태와 모든 난수의 유일한 권위**다. 클라이언트는 커맨드를 POST로 보내고, SSE로 받은 스냅샷(`GameViewDto`)과 이벤트 목록으로 화면을 그리고 연출만 한다.

- Base URL: `http://<호스트>:5173` (서버는 `0.0.0.0`에 바인딩. `PORT` 환경변수로 변경 가능 — 1~65535 정수가 아니면 서버가 시작하지 않는다)
- 요청/응답 본문은 모두 `application/json; charset=utf-8`
- **본문이 있는 요청은 `Content-Type: application/json`이 필수다**(`; charset=utf-8` 같은 파라미터는 허용). 다른 타입이거나 헤더가 없으면 `400 ERR001` — 브라우저 폼으로는 이 타입을 만들 수 없으므로 사이트 간 요청 위조(CSRF)가 막힌다.
- 인증 헤더: `Authorization: Bearer <seatToken>`
- 요청 본문 최대 크기: **16KB**. 한도를 넘는 순간 수신을 멈추고 `413 ERR009`를 보낸 뒤 연결을 닫는다(`connection: close`).
- **`Host` 헤더 검사(DNS 리바인딩 방어)**: 랜에서 실제로 쓰이는 주소만 받는다 — `localhost`, `127.0.0.0/8`, `[::1]`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, 점이 없는 단일 라벨 호스트명(`mypc`), `*.local`(mDNS). 각각 포트를 붙일 수 있다. 그 밖의 이름은 `ALLOWED_HOSTS` 환경변수(콤마 구분, 정확 일치)에 적어야 하며, 없으면 `403 ERR015`.
- 모든 API JSON 응답에 `cache-control: no-store`가 붙는다.
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
| `ERR015` | 403 | 허용되지 않은 접속 주소입니다. | `Host` 헤더가 랜 주소 화이트리스트에 없음(DNS 리바인딩 방어). 헤더 자체가 없어도 거부 |
| `ERR016` | 503 | 접속자가 너무 많습니다. 잠시 후 다시 시도하세요. | SSE 구독자 상한(방당 16 / 전체 128) 초과 |
| `ERR017` | 503 | 방을 더 만들 수 없습니다. 잠시 후 다시 시도하세요. | 서버 방 개수 상한(200) 초과. 30분 이상 방치된 대기실을 먼저 정리한 뒤에도 자리가 없을 때 |
| `ERR018` | 409 | 주문 한도를 초과했습니다. | 창구 주문 수(3건)·창구 명목금액(2,000,000원)·1건 명목금액(1,000,000원)·종목 보유 상한(500주)·예금 한도(10,000,000원)·예약 주문 수(3건) 초과 |
| `ERR019` | 429 | 요청이 너무 잦습니다. 잠시 후 다시 시도하세요. | 좌석당 거래 커맨드 레이트 리밋(5초에 10건) 초과. `retry-after: 1` 헤더가 함께 온다 |

> `ERR015`/`ERR016`은 이미 다른 뜻(접속 주소·구독자 상한)으로 쓰이고 있어, 설계서가 예고한 번호 대신
> **`ERR018`·`ERR019`를 새로 발급했다.** 뜻(주문 한도 409 / 레이트 리밋 429)은 설계서와 같다.

---

## 2. 엔드포인트

### `GET /api/server-info`

로비에 "다른 기기에서 이 주소로 접속" 안내를 띄우기 위한 LAN 주소 목록.

```json
{ "port": 5173, "urls": ["http://192.168.0.12:5173"], "localUrl": "http://localhost:5173" }
```

### `GET /api/rooms`

참가 가능한 방 목록(대기실이고 자리가 남은 방만, 최근 수정 순).
서버는 이 응답을 **메모리 요약 색인**으로 만든다(방마다 게임 상태를 복원하지 않으므로 방이 많아도 가볍다).

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

> 목록 요약의 `options`에는 `roundLimit`만 담긴다(목록을 가볍게 유지한다). 금융 옵션은 방 상세
> `RoomDto.options.finance`에서 본다.

### `POST /api/rooms` → 201

방 만들기. 요청 `{ "hostName": "하나" }` (`^[가-힣a-zA-Z0-9 ]{1,10}$`, 공백만인 이름 불가)

- 서버가 동시에 들고 있을 수 있는 방은 **200개**다. 상한에 닿으면 서버가 먼저 **30분 이상 방치된 대기실**을 정리하고, 그래도 자리가 없으면 `503 ERR017`로 거절한다(진행 중인 방은 정리하지 않는다).

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
| `ADD_COMPUTER` | `name` | 컴퓨터 좌석 추가 | 대기실 좌석 4개 미만 |
| `SET_OPTIONS` | `roundLimit`: `null \| 20 \| 30`, `finance?`(아래) | 라운드 제한 + 금융 옵션 | 대기실 |
| `SET_AUTOPILOT` | `seatId`, `enabled`(boolean) | 오프라인 좌석을 서버 자동 진행으로 전환/복귀 | 사람 좌석만. **켜기**는 호스트 + 그 좌석이 오프라인일 때만(`ERR005`), **끄기**는 호스트 또는 그 좌석 본인 토큰(그 외 `ERR003`) |
| `START` | — | 게임 시작 | 대기실, 좌석 2명 이상 |

`START` 직후 SSE로 `room`과 `game`(events: `[]`)이 함께 방송된다.

**`SET_OPTIONS`의 `finance` (선택)**

```json
{ "type": "SET_OPTIONS", "roundLimit": 30,
  "finance": { "investmentMode": "OFF", "financeSystem": "BASIC", "tradeTimerSec": 0, "scenario": "STANDARD" } }
```

| 키 | 지금 보낼 수 있는 값 | 앞으로 열릴 값(지금은 `ERR001`) |
|---|---|---|
| `investmentMode` | `"OFF"` · **`"STOCKS"`** | `"STOCKS_CRYPTO"` · `"ADVANCED"` |
| `financeSystem` | `"BASIC"` | `"ADVANCED"` |
| `tradeTimerSec` | `0` | `30` · `45` |
| `scenario` | `"STANDARD"` | `"BUBBLE"` · `"DEPRESSION"` |

- `investmentMode: "STOCKS"`를 켜면 증권거래소가 열린다(9장). 그 방의 `GameViewDto.market`이
  `null`이 아니게 되고, 자기 턴 시작 때 `AWAIT_TRADE` 페이즈가 생긴다.

- `finance`를 **생략하면 기존 값이 유지된다**(기존 클라이언트는 바꿀 것이 없다). 일부 키만 보내도
  마찬가지로 **보낸 키만** 바뀐다(나머지는 그대로).
- 모르는 키, 구현되지 않은 값, 객체가 아닌 값은 모두 `400 ERR001`이다. 켜도 아무 일이 일어나지 않는
  옵션을 만들지 않기 위한 의도적인 거부이며, 각 기능이 들어올 때 값이 열린다.
- 옵션은 **대기실에서만** 바꿀 수 있다(`START` 시점의 옵션이 판 내내 고정된다).

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

**상한과 헤더**
- 구독자 상한: **방당 16, 서버 전체 128**. 넘으면 스트림을 열지 않고 `503 ERR016`을 **JSON으로** 응답한다(`content-type: application/json`). `EventSource`는 이때 곧바로 `error`를 받으므로, 즉시 재접속을 반복하지 말고 잠시 기다린 뒤 다시 시도할 것.
- SSE 응답에도 공통 보안 헤더가 붙는다.
- presence 변화(구독 추가/끊김)로 인한 `room` 재방송은 방마다 약 200ms 동안 **합쳐서 한 번만** 보낸다. 핫시트 기기가 좌석 여러 개로 붙어도 스냅샷이 연달아 쏟아지지 않는다.

---

## 3. RoomDto

```json
{
  "code": "DK7P",
  "status": "LOBBY",
  "hostSeatId": "seat-1",
  "options": {
    "roundLimit": null,
    "finance": { "investmentMode": "OFF", "financeSystem": "BASIC", "tradeTimerSec": 0, "scenario": "STANDARD" }
  },
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
| `options.finance` | 금융 확장 옵션. 지금은 전부 꺼진 기본값만 가능하다(위 `SET_OPTIONS` 표) |
| `seats[].kind` | `HUMAN` \| `COMPUTER` |
| `seats[].autopilot` | 사람 좌석을 서버가 대신 진행 중인지. `true`인 동안 그 좌석의 게임 커맨드는 `ERR003` |
| `seats[].online` | presence로 확인된 접속 여부(컴퓨터는 항상 true) |
| `createdAt`/`updatedAt` | epoch ms. 24시간 이상 방치된 방은 서버 시작 시와 **1시간 주기로** 정리된다 |
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
  "actingSeatId": "seat-1",
  "jackpot": 0,
  "isOver": false,
  "players": [
    {
      "seatId": "seat-1", "name": "하나", "cash": 2972000, "position": 3, "lap": 2,
      "eliminated": false, "islandRemainingTurns": 0, "airportPending": false,
      "loanUsed": false, "loanDebt": 0, "cityCount": 0, "resortCount": 0, "totalAssets": 2972000,
      "stockValue": 0, "depositBalance": 0,
      "netWorth": { "cash": 2972000, "property": 0, "stock": 0, "deposit": 0, "loanDebt": 0, "total": 2972000 }
    }
  ],
  "market": null,
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
| `currentSeatId` | 지금 차례인 좌석 id(턴 소유자). **내 좌석 토큰이 있는 좌석과 같을 때만 행동 버튼 활성화** |
| `actingSeatId` | 지금 **결정을 내릴** 좌석 id. 오늘은 항상 `currentSeatId`와 같다. 앞으로 턴 소유자가 아닌 좌석이 결정하는 구간(압류 경매 등)에서만 달라진다 |
| `jackpot` | 카지노 잭팟 적립금(원) |
| `isOver` | 게임 종료 여부 |
| `players[].cash` | 보유 현금 |
| `players[].position` | 보드 칸 번호(0~39) |
| `players[].lap` | 지금 몇 바퀴째인지(1부터). 출발 칸을 앞으로 지나거나 도착해 **월급을 받는 순간마다 +1**(월급이 대출로 압류돼도 +1, 뒤로 밀려 도착하거나 조난 이송이면 그대로. 한 커맨드에 두 번 오를 수도 있다). 이 값이 지을 수 있는 건물을 정한다: 1바퀴 별장 / 2바퀴 빌딩 / 3바퀴부터 호텔 |
| `players[].eliminated` | 파산 탈락 |
| `players[].islandRemainingTurns` | 조난 섬에 남은 턴(0이면 자유) |
| `players[].airportPending` | 다음 자기 턴에 공항 이동권을 쓸 수 있는지 |
| `players[].loanUsed` / `loanDebt` | 대출 사용 여부 / 남은 채무(월급이 압류된다) |
| `players[].cityCount` / `resortCount` | 보유 도시 수 / 휴양지 수 |
| `players[].totalAssets` | 총자산 = `netWorth.total`. 현금 + 부동산 투자액 + **주식 평가액 + 예금** − 남은 대출 채무(순위 기준). 투자 모드가 `OFF`면 주식·예금이 항상 0이라 예전과 값이 같다 |
| `players[].stockValue` | 보유 주식의 시가 평가액 합계(`Σ 수량 × 현재가`). 투자 모드 `OFF`면 `0` |
| `players[].depositBalance` | 예금 잔액. 투자 모드 `OFF`면 `0` |
| `players[].netWorth` | 총자산 내역 `{ cash, property, stock, deposit, loanDebt, total }`. `total = cash + property + stock + deposit − loanDebt`이며 탈락자는 모두 `0`. 화면과 순위가 **같은 계산(`NetWorth`)** 을 쓴다 |
| `market` | 증권거래소 공개 스냅샷(9장). 투자 모드가 `OFF`면 `null` |
| `board[].kind` | `START`·`CITY`·`RESORT`·`TICKET`·`TAX`·`ISLAND`·`CASINO`·`AIRPORT` |
| `board[].price` | 매입가(소유 가능 칸만) |
| `board[].ownerId` | 소유 좌석 id 또는 `null` |
| `board[].buildings` | `["VILLA","BUILDING","HOTEL"]` 중 지어진 것(정해진 순서) |
| `board[].landmark` | 랜드마크 완성 여부 |
| `board[].invested` | 매입가 + 정가 기준 건설비 합계. 매각 환급은 이 값의 50% |
| `board[].toll` | 지금 이 칸에 걸리면 낼 통행료 |
| `board[].acquisitionPrice` | 인수 가격(`invested × 2`). 인수 불가(랜드마크/휴양지/주인 없음)면 `null` |
| `pending` | 현재 플레이어가 내려야 하는 결정(6장). 결정이 없으면 `null` |
| `rankings` | 종료 시에만 채워진다: `[{ playerId, name, rank, cash, totalAssets, loanDebt, eliminated }]`. 정렬은 생존자 → 총자산 → **현금** → 좌석 순서(같은 상태면 항상 같은 순위) |

> 소유 불가능 칸(`START`/`TICKET`/`TAX`/`ISLAND`/`CASINO`/`AIRPORT`)에는 `price` 이하 필드가 없다.

---

## 5. 페이즈와 커맨드

| 페이즈 | 허용 커맨드 | payload |
|---|---|---|
| `AWAIT_TRADE` | `BUY_STOCK`, `SELL_STOCK`, `DEPOSIT`, `WITHDRAW`, `CLOSE_TRADING` | 아래 9.4 |
| `AWAIT_ROLL` | `ROLL` | 없음 |
| `AWAIT_BUY` | `BUY`, `SKIP_BUY` | 없음 |
| `AWAIT_BUILD` | `BUILD`, `SKIP_BUILD` | `BUILD`: `{ buildings: string[] }` |
| `AWAIT_START_BUILD` | `START_BUILD`, `SKIP_START_BUILD` | `START_BUILD`: `{ cityIndex: 0~39, buildings: string[] }` |
| `AWAIT_ACQUIRE` | `ACQUIRE`, `SKIP_ACQUIRE` | 없음 |
| `AWAIT_CASINO` | `CASINO_BET`, `CASINO_LEAVE` | `CASINO_BET`: `{ game, bet, choice }` |
| `AWAIT_ISLAND_CHOICE` | `ISLAND_PAY`, `ISLAND_ROLL` | 없음 |
| `AWAIT_TRAVEL` | `TRAVEL` | `{ destination: 0~39 }` (공항 칸 30과 현재 칸은 불가) |
| `AWAIT_LIQUIDATION` | `SELL`, `SELL_ASSET`, `AUTO_SELL`, `TAKE_LOAN`, `DECLARE_BANKRUPTCY` | `SELL`: `{ cityIndex: 0~39 }` · `SELL_ASSET`: 아래 9.4 |
| `GAME_OVER` | 없음(모든 커맨드 `ERR005`) | — |
| **모든 페이즈**(`GAME_OVER` 제외) | `QUEUE_ORDER`, `CANCEL_QUEUED_ORDER` — **자기 좌석만**(내 차례가 아니어도 된다) | 아래 9.4 |

### 커맨드 상세

| 커맨드 | 뜻과 규칙 |
|---|---|
| `ROLL` | 주사위 2개. 더블이면 턴 종료 후 한 번 더(같은 좌석 `AWAIT_ROLL`), 3연속 더블이면 이동 없이 조난 섬 |
| `BUY` | 빈 칸 매입. 현금 부족 시 `ERR008`. 매입 직후 같은 턴에 `AWAIT_BUILD`(건설 기회) |
| `SKIP_BUY` | 매입 포기 → 턴 종료 |
| `BUILD` | `buildings`는 `pending.options[].type` 중에서만 고른다. 중복 불가. `LANDMARK`는 **단독으로만**(3종을 이미 가진 기회일 때). `pending.lockedOptions`에 있는 건물(바퀴 미달)을 담으면 `400 ERR001`이고 상태는 그대로다 |
| `SKIP_BUILD` | 건설 포기 |
| `START_BUILD` | 출발 칸 보너스. `pending.candidates` 중 하나의 `index`와 그 후보의 `options`에서 고른 건물. 그 후보의 `lockedOptions`에 있는 건물을 담으면 `400 ERR001` |
| `SKIP_START_BUILD` | 보너스 포기 |
| `ACQUIRE` | 통행료를 낸 남의 도시를 `pending.price`(= invested × 2)에 인수. **보유 현금만** 사용(부족하면 `ERR008`). 인수 후 `AWAIT_BUILD`. 통행료를 정리 페이즈로 낸 턴에는 이 페이즈에 오지 않는다 |
| `SKIP_ACQUIRE` | 인수 포기 |
| `CASINO_BET` | `game`: `ODD_EVEN`(choice `ODD`\|`EVEN`) / `HIGH_LOW_SEVEN`(choice `LOW`\|`HIGH`\|`SEVEN`) / `SLOT`(choice 불필요). `bet`은 10,000원 단위, 10,000 ~ min(현금, 500,000). 한 방문 최대 3판 |
| `CASINO_LEAVE` | 카지노에서 나가 턴 종료 |
| `ISLAND_PAY` | 구조비 200,000원 지불 후 즉시 `AWAIT_ROLL`(같은 턴에 정상 굴림). 현금 부족 시 `ERR008` |
| `ISLAND_ROLL` | 더블이면 탈출해 그 눈만큼 이동(추가 턴 없음), 아니면 남은 턴 −1 후 턴 종료 |
| `TRAVEL` | 공항 이동권 사용. 앞 방향으로 이동하므로 출발 칸을 지나면 월급. 도착 칸 효과 정상 적용. `pending.forbiddenIndexes`의 칸(공항 칸·현재 칸)을 고르면 `ERR001` |
| `SELL` | 정리 페이즈에서 고른 **도시** 하나를 `invested × 0.5`에 은행 매각(건물 포함 초기화). 하위호환으로 계속 유지된다 |
| `SELL_ASSET` | 정리 페이즈에서 고른 자산 하나를 매각(자산군 무관). `pending.sellable` 항목의 `assetKind`/`assetId`를 그대로 보낸다. 주식·예금은 `quantity`로 일부만 팔 수 있다. 정리·파산 중에는 **거래 수수료가 면제**된다 |
| `AUTO_SELL` | 정해진 순서대로 필요한 만큼 자동 매각: **주식 → 예금 → 부동산**(자산군 안에서는 환급액이 낮은 것부터, 그마저 같으면 목록 순서). 팔 자산이 없으면 `ERR005` |
| `TAKE_LOAN` | 게임당 1회. 현금 +1,000,000, 채무 1,200,000. 이후 월급이 채무 상환에 압류된다. 이미 썼으면 `ERR005` |
| `DECLARE_BANKRUPTCY` | 정리 페이즈에서 **항상 가능**. 남은 현금을 채권자에게 넘기고 모든 자산 초기화 후 탈락 |

> 현금 ≥ 지불액이 되는 즉시 지불이 자동 완료되고 중단됐던 흐름이 이어진다.
> 단 **정리 페이즈를 거친 통행료 뒤에는 인수를 제안하지 않는다** — 인수는 보유 현금으로만 할 수 있으므로(명세 4장), 매각·대출로 만든 돈으로 인수하는 길을 막는다.

---

## 6. pending(결정 요청) 형태

| `kind` | 필드 |
|---|---|
| `BUY` | `index`, `name`, `price` |
| `BUILD` | `index`, `name`, `options: [{ type, cost, locked, unlockLap }]`, `lockedOptions: [{ type, cost, locked, unlockLap }]`, `buildings`(이미 지은 것), `landmark` |
| `START_BUILD` | `candidates: [{ index, name, price, options: [{ type, cost, locked, unlockLap }], lockedOptions: [...] }]` |
| `ACQUIRE` | `index`, `name`, `ownerId`, `price` |
| `CASINO` | `roundsLeft`, `limits: { min, max, unit }`, `jackpot` |
| `ISLAND` | `remainingTurns`, `fee`(200000), `canPayFee` |
| `TRAVEL` | `forbiddenIndexes: number[]` — 공항 칸(30)과 현재 칸. 공항 칸에 서 있으면 한 칸으로 합쳐져 `[30]` |
| `LIQUIDATION` | `amountDue`, `creditorId`(은행/잭팟이면 `null`), `canSell`, `canLoan`, `sellable: [{ assetKind, assetId, label, refund, quantity, maxQuantity, unitValue, index?, name? }]` — `assetKind`는 `"PROPERTY"` \| `"STOCK"` \| `"DEPOSIT"`. `index`·`name`은 **부동산 항목에만** 있다 |
| `TRADE` | `budget`(9.3), `cash`, `deposit`, `holdings: [{ instrumentId, qty, avgCost, marketValue }]`, `afterTrade`(`"ROLL"` \| `"ISLAND"` \| `"TRAVEL"` — 창구를 닫으면 갈 곳) |

`AWAIT_ROLL`과 `GAME_OVER`에서는 `pending`이 `null`이다.

### 정리 페이즈 `sellable` 항목 (자산군별)

| 필드 | `PROPERTY` | `STOCK` | `DEPOSIT` |
|---|---|---|---|
| `assetId` | 칸 번호 문자열(`"3"`) | 종목 id(`"AIR"`) | 항상 `"CASH"` |
| `label` | 도시 이름 | 종목 이름 | `"예금"` |
| `quantity` | `1` | 보유 수량 | 잔액(원) |
| `maxQuantity` | `1` | 보유 수량 | 잔액(원) |
| `unitValue` | 환급액 | 1주 현재가 | `1` |
| `refund` | `invested × 0.5` | `수량 × 현재가`(수수료 면제) | 잔액 전액 |
| `index`/`name` | 있음 | 없음 | 없음 |

- `SELL_ASSET`의 `quantity`를 생략하면 **전량**을 판다. 예금은 10,000원 단위로만 인출할 수 있다.
- 상장폐지된 종목은 목록에 오르지 않는다(값이 0이므로).

### 건설 선택지와 바퀴 제한 (`options` / `lockedOptions`)

건설 관련 `pending`(`BUILD`의 본문과 `START_BUILD`의 각 후보)은 선택지를 **두 목록으로 나눠** 보낸다.

| 필드 | 뜻 |
|---|---|
| `options` | **지금 고를 수 있는 건물**만. 뜻이 바뀌지 않았으므로 이 목록만 쓰는 예전 클라이언트도 그대로 동작한다. 항목마다 `locked: false`와 `unlockLap`이 함께 온다(추가 필드) |
| `lockedOptions` | **바퀴가 모자라 아직 못 짓는 건물**(`locked: true`). 화면에 비활성 행으로 보여 주기 위한 정보이며, 여기 있는 건물을 커맨드에 담으면 `400 ERR001`이다 |
| `locked` | 그 항목을 지금 고를 수 있는지(`options`는 항상 `false`, `lockedOptions`는 항상 `true`) |
| `unlockLap` | 그 건물이 열리는 바퀴(별장 1 · 빌딩 2 · 호텔 3). 랜드마크는 바퀴로 막지 않으므로 `1` |

- 두 목록에는 **이미 지은 건물이 들어가지 않는다.** 랜드마크 업그레이드 기회(`options`가 `[{ type: "LANDMARK", … }]`)에서는 `lockedOptions`가 항상 빈 배열이다.
- 그 바퀴에 **고를 수 있는 것이 하나도 없으면 건설 기회 자체가 열리지 않는다**(페이즈가 `AWAIT_BUILD`로 가지 않고 턴이 끝난다). `START_BUILD`의 `candidates`에도 그런 도시는 올라오지 않으며, 후보가 하나도 없으면 보너스를 자동으로 건너뛴다.
- 예: 1바퀴 플레이어가 방콕(70,000원)을 막 매입한 직후
  ```json
  {
    "kind": "BUILD", "index": 3, "name": "방콕",
    "options": [{ "type": "VILLA", "cost": 21000, "locked": false, "unlockLap": 1 }],
    "lockedOptions": [
      { "type": "BUILDING", "cost": 42000, "locked": true, "unlockLap": 2 },
      { "type": "HOTEL", "cost": 63000, "locked": true, "unlockLap": 3 }
    ],
    "buildings": [], "landmark": false
  }
  ```

---

## 7. 도메인 이벤트 (UI 연출/로그용)

`game` SSE 메시지의 `events`는 **그 커맨드가 만든 이벤트 목록**이며 발생 순서대로 들어 있다. 각 이벤트는 `type` + 아래 필드를 가진다.

### 턴 흐름
| type | 필드 | 의미 |
|---|---|---|
| `TURN_STARTED` | `playerId`, `round` | 새 턴 시작 |
| `DICE_ROLLED` | `playerId`, `die1`, `die2`, `sum`, `isDouble` | 주사위 연출 |
| `MOVED` | `playerId`, `from`, `to`, `steps`, `passedStart` | 말 이동. `steps`가 `null`이면 순간이동(조난 이송) |
| `LAP_ADVANCED` | `playerId`, `lap` | **한 바퀴 완주**(출발 칸을 앞으로 지나거나 도착). 순서는 `MOVED` → `LAP_ADVANCED` → 월급 이벤트 → `LANDED`이며, 새 바퀴 수를 담는다. 월급이 전액 압류되면 `SALARY_PAID`가 없으므로 "바퀴가 올랐는지"는 이 이벤트로 판단할 것. **한 커맨드에 두 번 이상 올 수 있다**(티켓 연쇄로 출발 칸을 두 번 지날 때). 그때마다 짝이 되는 `SALARY_PAID`/`SALARY_SEIZED`가 따라온다 |
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
·`TRADE_BUY`·`TRADE_SELL`·`TRADE_FEE`·`DIVIDEND`·`DEPOSIT`·`DEPOSIT_INTEREST` (뒤 6개는 투자 모드 `STOCKS`에서만)

### 도시·건물·인수
| type | 필드 | 의미 |
|---|---|---|
| `CITY_PURCHASED` | `playerId`, `index`, `name`, `price` | 매입 |
| `PURCHASE_DECLINED` | `playerId`, `index` | 매입 포기 |
| `BUILD_OFFERED` | `playerId`, `index`, `name`, `options`, `lockedOptions` | 건설 기회 열림. 두 목록은 같은 순간의 `pending`과 같다(6장) |
| `BUILT` | `playerId`, `index`, `name`, `buildings`, `cost` | 건설 완료(지은 목록) |
| `LANDMARK_BUILT` | `playerId`, `index`, `name`, `cost` | 랜드마크 완성(`BUILT`와 함께 발생) |
| `BUILD_DECLINED` | `playerId`, `index` | 건설 포기(`index`는 출발 보너스 포기 시 `null`) |
| `START_BONUS_OFFERED` | `playerId`, `candidates` | 출발 칸 보너스. 후보마다 `options`·`lockedOptions`가 있고, 그 바퀴에 지을 것이 없는 도시는 후보에 없다 |
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
| `BANKRUPT` | `playerId`, `creditorId`, `creditorIds`, `paidAmount`, `releasedIndexes` | 파산(초기화된 칸 목록 포함). `creditorIds`는 실제로 돈을 받은 좌석 전원(좌석 순서, 은행 채무면 `[]`), `creditorId`는 그중 대표 한 명이다. **`creditorId`와 `paidAmount`를 짝지어 한 명에게 전액이 갔다고 보면 안 된다** — 분배 내역은 함께 발생하는 `MONEY_TRANSFERRED` 이벤트들에 있다 |

### 증권거래소 (투자 모드 `STOCKS`에서만)

**거래 창구**
| type | 필드 | 의미 |
|---|---|---|
| `TRADING_OPENED` | `playerId`, `ordersLeft`, `notionalLeft`, `afterTrade` | 거래 창구 열림(`TURN_STARTED` 직후). `afterTrade`는 창구를 닫으면 갈 곳(`ROLL`\|`ISLAND`\|`TRAVEL`) |
| `TRADING_CLOSED` | `playerId`, `reason` | 창구 닫힘. `reason`: `PLAYER`(직접 마감) \| `BUDGET_EXHAUSTED`(예산 소진 자동 마감) |
| `ORDER_FILLED` | `playerId`, `kind`(`BUY`\|`SELL`), `instrumentId`, `name`, `quantity`, `price`, `notional`, `fee`, `viaLiquidation` | 체결. `notional = quantity × price`, 매수 실제 지출 = `notional + fee`, 매도 실제 수령 = `notional − fee`. `viaLiquidation`이 `true`면 정리/파산 매각이라 `fee`가 `0`이다 |
| `ORDER_REJECTED` | `playerId`, `kind`, `instrumentId`, `quantity`, `reasonCode` | 주문 거절(예약 주문 자동 체결에서만 발생. 직접 보낸 주문은 이벤트 대신 **에러 응답**으로 거절된다) |
| `DEPOSIT_MADE` | `playerId`, `amount`, `balance` | 예치 |
| `DEPOSIT_WITHDRAWN` | `playerId`, `amount`, `balance`, `viaLiquidation` | 인출 |
| `DEPOSIT_INTEREST_PAID` | `playerId`, `amount`, `balance`, `baseRateBp` | 라운드 틱 예금 이자. 대출 채무가 있으면 이자가 0이라 이 이벤트가 **발생하지 않는다** |
| `DIVIDEND_PAID` | `playerId`, `instrumentId`, `name`, `quantity`, `perShare`, `amount` | 출발 칸 통과 시 배당(월급과 같은 순간). 상장 종목만 |

`reasonCode`: `WINDOW_CLOSED` · `INSUFFICIENT_CASH` · `NOT_ENOUGH_SHARES` · `DELISTED` · `UNKNOWN_INSTRUMENT` · `ORDER_LIMIT` · `NOTIONAL_LIMIT` · `POSITION_LIMIT` · `DEPOSIT_CAP` · `INSUFFICIENT_DEPOSIT`

**시장(라운드 틱)** — 발생 순서가 고정돼 있다: `CYCLE_CHANGED?` → `NEWS_PUBLISHED` → `BASE_RATE_CHANGED?` → `PRICES_UPDATED` → `INSTRUMENT_DELISTED?`/`HOLDINGS_WIPED?` → `INSTRUMENT_LISTED?` → `DEPOSIT_INTEREST_PAID?`

| type | 필드 | 의미 |
|---|---|---|
| `CYCLE_CHANGED` | `from`, `to`, `round` | 경기 국면 전이(`EXPANSION`\|`OVERHEAT`\|`RECESSION`\|`RECOVERY`) |
| `NEWS_PUBLISHED` | `id`, `headline`, `explanation`, `effects`, `round`, `cyclePhase` | 그 라운드의 경제 뉴스 1장. `effects`는 `[{ target, sector?, bp }]`, `target`: `SECTOR`\|`ALL`\|`RATE` |
| `BASE_RATE_CHANGED` | `from`, `to`, `changeBp` | 기준금리 변화(bp). 뉴스만이 금리를 움직인다 |
| `PRICES_UPDATED` | `round`, `changes: [{ instrumentId, from, to, changeBp, state }]` | 전 종목 시세 갱신(스파크라인·등락 연출의 입력) |
| `INSTRUMENT_DELISTED` | `instrumentId`, `name`, `price` | 상장폐지(기준가의 20% 이하) |
| `HOLDINGS_WIPED` | `playerId`, `instrumentId`, `quantity`, `costBasis` | 상장폐지로 보유 수량이 **전액 소각**됐다. 현금은 움직이지 않는다 |
| `INSTRUMENT_LISTED` | `instrumentId`, `name`, `sector`, `price` | 예비 풀에서 신규 상장(상장폐지 **다음 틱**에 5종목을 회복한다) |

**예약 주문** — 남의 턴에도 보낼 수 있다
| type | 필드 | 의미 |
|---|---|---|
| `QUEUED_ORDER_PLACED` | `playerId`, `orderId`, `kind`, `instrumentId`, `quantity`, `amount` | 예약 등록. `kind`가 `DEPOSIT`/`WITHDRAW`면 `instrumentId`·`quantity`가 `null`이고 `amount`가 찬다 |
| `QUEUED_ORDER_CANCELLED` | `playerId`, `orderId` | 예약 취소 |
| `QUEUED_ORDER_EXECUTED` | `playerId`, `orderId`, `kind` | 창구가 열릴 때 자동 체결됨. 곧바로 `ORDER_FILLED`/`DEPOSIT_MADE`/`DEPOSIT_WITHDRAWN`이 따라온다 |
| `QUEUED_ORDER_REJECTED` | `playerId`, `orderId`, `kind`, `reasonCode` | 재검증 실패로 버려짐(현금 부족·상장폐지·한도 초과 등) |

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

---

## 9. 증권거래소 (투자 모드 `STOCKS`)

호스트가 대기실에서 `SET_OPTIONS`의 `finance.investmentMode`를 `"STOCKS"`로 켠 방에서만 동작한다.
`"OFF"`인 방에서는 `view.market`이 `null`이고, `AWAIT_TRADE` 페이즈도 새 이벤트도 **전혀 발생하지 않는다**.

핵심 규칙 세 줄:

- **주문은 가격을 움직이지 않는다.** 시세는 경기 국면·뉴스·보드 연동 압력·서버 난수만의 함수다(시세 조작 불가).
- **거래 창구는 자기 턴 시작 때 한 번 열린다.** 더블 추가 턴에는 열리지 않는다.
- **비밀 정보가 없다.** 전원의 보유 수량·예금·예약 주문·다음 틱에 반영될 압력까지 모두 공개 DTO다.

### 9.1 `view.market` 전체 모양

```json
{
  "investmentMode": "STOCKS",
  "cycle": { "phase": "EXPANSION", "label": "호황", "age": 2, "driftBp": 150, "volMulPct": 100 },
  "baseRateBp": 125,
  "news": {
    "id": "NE1",
    "headline": "국제선 좌석이 모자란다",
    "explanation": "여행 수요가 늘어난 좌석 공급을 앞질렀습니다.",
    "round": 4,
    "cyclePhase": "EXPANSION",
    "effects": [
      { "target": "SECTOR", "sector": "AIRLINE", "bp": 600 },
      { "target": "SECTOR", "sector": "HOTEL", "bp": 400 }
    ]
  },
  "pendingNudges": [
    { "sector": "CONSTRUCTION", "bp": 300, "label": "건설" },
    { "sector": "ENTERTAINMENT", "bp": 500, "label": "카지노·엔터" }
  ],
  "instruments": [
    {
      "id": "AIR", "name": "한빛항공", "sector": "AIRLINE", "sectorLabel": "항공", "klass": "STOCK",
      "state": "LISTED", "price": 12800, "prevPrice": 12000, "changeBp": 667,
      "basePrice": 12000, "tickUnit": 100, "dividendBp": 150,
      "series": [12000, 12300, 12100, 12800]
    }
  ],
  "holdings": {
    "seat-1": [{ "instrumentId": "AIR", "qty": 40, "avgCost": 12000, "marketValue": 512000 }],
    "seat-2": []
  },
  "deposits": { "seat-1": 500000, "seat-2": 0 },
  "orderQueue": [
    { "id": "ord-2", "seatId": "seat-2", "kind": "BUY_STOCK", "instrumentId": "CON", "quantity": 20, "amount": null }
  ],
  "budget": {
    "seatId": "seat-1", "open": true,
    "ordersUsed": 1, "ordersLeft": 2, "ordersMax": 3,
    "notionalUsed": 512000, "notionalLeft": 1488000, "notionalMax": 2000000
  },
  "rules": {
    "feeBp": 100, "feeMin": 1000,
    "maxOrdersPerWindow": 3, "maxNotionalPerWindow": 2000000, "maxNotionalPerOrder": 1000000,
    "minQuantity": 1, "maxQuantity": 200, "maxPositionPerInstrument": 500,
    "depositUnit": 10000, "depositCap": 10000000, "maxQueuedOrders": 3,
    "baseRateMinBp": 25, "baseRateMaxBp": 400, "seriesLength": 30
  }
}
```

| 필드 | 뜻 |
|---|---|
| `cycle.phase` | `EXPANSION`(호황) · `OVERHEAT`(과열) · `RECESSION`(침체) · `RECOVERY`(회복) |
| `cycle.age` | 이 국면이 몇 라운드째인지(1부터). `age ≥ 2`부터 전이 판정이 돌아간다 |
| `cycle.driftBp` / `volMulPct` | 그 국면의 기본 추세(bp)와 변동성 배수(%). 화면 설명용 |
| `baseRateBp` | 기준금리(bp, 1bp = 0.01%). 예금 이자율이며 25~400 사이로 묶인다 |
| `news` | 그 라운드에 뽑힌 경제 뉴스 1장. 첫 라운드(아직 틱이 없을 때)는 `null` |
| `news.effects[].target` | `SECTOR`(그 섹터만) · `ALL`(전 종목) · `RATE`(기준금리) |
| `pendingNudges` | 보드 사건으로 적립돼 **다음 틱에 반영될** 섹터별 압력(±600bp로 묶임). 전원 공개다(내부정보를 만들지 않는다) |
| `instruments[].price` / `prevPrice` | 현재가 / 직전 틱 가격. `changeBp`는 등락률(bp, 내림) |
| `instruments[].state` | `LISTED` · `DELISTED`. `DELISTED`는 거래·배당이 모두 막히고 값이 0이다 |
| `instruments[].series` | 최근 최대 30개 가격(오래된 것 → 최신). 스파크라인 입력 |
| `instruments[].tickUnit` | 가격 단위(주식 100원). 모든 가격은 이 값의 배수다 |
| `instruments[].dividendBp` | 배당률(bp/랩). 1주 배당 = `floor(현재가 × dividendBp / 10000)` |
| `holdings` | **전원**의 보유 목록(좌석 id → 배열). 보유가 없으면 빈 배열 |
| `deposits` | 전원의 예금 잔액(좌석 id → 원) |
| `orderQueue` | 전원의 예약 주문(등록 순서) |
| `budget` | **`view.actingSeatId` 좌석의** 창구 예산. 그 좌석이 창구에 있지 않으면 `open: false`이고 남은 값은 최대치다 |
| `rules` | 수수료·한도 상수(화면이 숫자를 하드코딩하지 않게 한다) |

섹터 코드와 이름: `AIRLINE` 항공 · `CONSTRUCTION` 건설 · `HOTEL` 호텔·관광 · `ENTERTAINMENT` 카지노·엔터 · `ENERGY` 에너지.

### 9.2 종목 (기준 시세)

| id | 이름 | 섹터 | 기준가 | 배당 | 변동성 |
|---|---|---|---|---|---|
| `AIR` | 한빛항공 | 항공 | 12,000 | 1.5% | 700bp |
| `CON` | 대양건설 | 건설 | 8,000 | 2.0% | 900bp |
| `HOT` | 미르호텔앤리조트 | 호텔·관광 | 15,000 | 2.5% | 600bp |
| `ENT` | 네온엔터카지노 | 카지노·엔터 | 6,000 | 없음 | 1200bp |
| `NRG` | 청해에너지 | 에너지 | 20,000 | 3.5% | 500bp |

상장폐지 대체용 예비 풀: `SKY` 새벽항공운수 · `ROCK` 반석중공업 · `LEAF` 초록전력.
목록은 항상 5종목이다(상장폐지 다음 틱에 신규 상장으로 회복).

### 9.3 창구 예산과 수수료

| 항목 | 값 |
|---|---|
| 창구당 주문 수 | **3건** (예치·인출도 1건으로 센다) |
| 창구당 총 명목금액 | **2,000,000원** |
| 주문 1건 명목금액 | **≤ 1,000,000원** |
| 주문 1건 수량 | **1 ~ 200주** |
| 종목별 보유 상한 | **500주** |
| 거래 수수료 | `max(1000, ceil(명목금액 / 100))` — 1%, 최소 1,000원. **매수·매도 양방향** |
| 예금 단위 / 한도 | 10,000원 단위 / 잔액 ≤ 10,000,000원 |
| 예금 이자(라운드 틱) | `floor(max(0, 예금 − 총부채) × baseRateBp / 10000)` — **대출이 있으면 이자가 0** |
| 예약 주문 | 좌석당 최대 3건. 체결 시점에 전면 재검증 |

- 같은 창구 안에서 **사고 팔면 언제나 손실**이다(가격은 그 창구 동안 고정이고 수수료가 양방향이므로).
  수량 1~200주 전수에 대해 이 성질이 테스트로 보장된다.
- 예산이 다 떨어지면 서버가 창구를 **자동으로 닫는다**(`TRADING_CLOSED reason: "BUDGET_EXHAUSTED"`).

### 9.4 커맨드 payload와 검증

형식 검증은 컨트롤러(화이트리스트), **존재 여부(상장 목록 등)는 도메인**이 본다.

| 커맨드 | payload | 형식 검증 |
|---|---|---|
| `BUY_STOCK` | `{ instrumentId, quantity }` | `instrumentId`: `^[A-Z]{2,6}$` · `quantity`: 정수 1~200 |
| `SELL_STOCK` | `{ instrumentId, quantity }` | 같음 |
| `DEPOSIT` | `{ amount }` | 정수, 10,000 단위, 10,000 ~ 10,000,000 |
| `WITHDRAW` | `{ amount }` | 같음 |
| `CLOSE_TRADING` | 없음 | — |
| `QUEUE_ORDER` | `{ kind, instrumentId?, quantity?, amount? }` | `kind`: `BUY_STOCK`\|`SELL_STOCK`\|`DEPOSIT`\|`WITHDRAW`. 주식이면 `instrumentId`+`quantity`(위와 같은 규칙), 예금이면 `amount` |
| `CANCEL_QUEUED_ORDER` | `{ orderId }` | `^ord-\d{1,4}$` |
| `SELL_ASSET` | `{ assetKind, assetId, quantity? }` | `assetKind`: `PROPERTY`\|`STOCK`\|`DEPOSIT` · `assetId`: 1~16자 `^[A-Za-z0-9_-]{1,16}$` · `quantity`: 정수 1~10,000,000(생략하면 전량) |

에러 매핑:

| 상황 | 코드 |
|---|---|
| 형식 위반(음수·비단위·범위 초과·모르는 필드값) | `400 ERR001` |
| 거래 창구가 아닌 페이즈에서 거래 커맨드 | `409 ERR005` |
| 없는/상장폐지된 종목, 없는 예약 주문 id | `400 ERR001` |
| 남의 차례에 거래 커맨드(`QUEUE_ORDER` 제외) | `409 ERR006` |
| 남의 좌석 `seatId`를 body에 넣어 보냄 | `403 ERR003` |
| 자동 진행 중인 좌석의 커맨드 | `403 ERR003` |
| 현금·보유 수량·예금 잔액 부족 | `409 ERR008` |
| 4번째 주문 / 창구 예산 초과 / 1건 한도 초과 / 보유 상한 / 예금 한도 / 예약 4건 | `409 ERR018` |
| 좌석당 5초에 11번째 거래 커맨드 | `429 ERR019` (`retry-after: 1`) |

**거절돼도 상태는 절대 바뀌지 않는다**(`version`도 그대로). 클라이언트는 서버가 준 `view`를 유일한 진실로 삼으면 된다.

### 9.5 턴 흐름

```
TURN_STARTED
  → (거래할 것이 있으면) TRADING_OPENED
       → 예약 주문 자동 체결(QUEUED_ORDER_EXECUTED / ..._REJECTED)
       → BUY_STOCK / SELL_STOCK / DEPOSIT / WITHDRAW (예산 안에서 반복)
       → CLOSE_TRADING  또는  예산 소진 자동 마감
  → TRADING_CLOSED
  → 원래 흐름(조난 선택 / 공항 목적지 / 주사위)
```

- 창구는 **조난 중에도 열린다**(죽은 턴을 만들지 않는다). 닫으면 `AWAIT_ISLAND_CHOICE`로 간다.
- **거래할 것이 전혀 없으면 열리지 않는다**: 현금 0 + 보유 0 + 예금 0.
- **더블 추가 턴에는 열리지 않는다**(창구는 `TURN_STARTED` 1회당 1번).
- 라운드 틱(뉴스·시세·이자)은 `ROUND_ADVANCED` 1회당 정확히 1번이며, **라운드 제한으로 끝나는
  전이에서는 돌지 않는다**(절대 플레이되지 않는 라운드의 뉴스로 순위가 뒤집히지 않게).

### 9.6 보드 연동 압력(nudge)

보드에서 벌어진 일이 섹터에 압력을 남기고, 그 압력은 **다음 라운드 틱에 반영**되며 `pendingNudges`로 공개된다.
(즉시 반영하면 "내 턴에 건설주를 사고 랜드마크를 지어 즉시 상승"이 성립해 내부정보 거래가 되므로 미룬다.)

| 보드 사건 | 압력 |
|---|---|
| `LANDMARK_BUILT` | 건설 +300 |
| `CITY_PURCHASED`(가격 ≥ 300,000) | 건설 +100 |
| 잭팟 당첨 | 카지노·엔터 +500 |
| 잭팟 누적 1,000,000 돌파 | 카지노·엔터 +200 |
| 휴양지 통행료 발생 | 호텔 +100 |
| 공항 이동권 사용(`TRAVELED`) | 항공 +200 |
| 세관 납부(`TAX_PAID`) | 전 종목 −100 |

섹터별 합계는 ±600bp로 묶이고, 틱에 반영되면 0으로 비워진다.

### 9.7 샘플

`docs/fixtures/marketView.sample.json`에 실제 서버가 만드는 모양의 샘플이 있다:
- `view`: `AWAIT_TRADE` 페이즈의 완전한 `GameViewDto`(시세·보유·예약·예산 포함)
- `messages`: SSE `game` 메시지 4개 — ① 라운드 틱(`NEWS_PUBLISHED` + `PRICES_UPDATED`)
  ② 매수 체결(`ORDER_FILLED`) ③ 출발 통과 배당(`DIVIDEND_PAID`) ④ 상장폐지(`INSTRUMENT_DELISTED` + `HOLDINGS_WIPED` + `INSTRUMENT_LISTED`)
