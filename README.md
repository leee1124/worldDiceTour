# 월드 다이스 투어 (World Dice Tour)

로컬 네트워크(LAN)에서 즐기는 세계일주 주사위 보드게임. 호스트 PC가 서버를 띄우고 방을 만들면, **같은 와이파이의 다른 기기(폰·태블릿·PC)가 브라우저로 접속**해 함께 플레이한다. 한 기기가 좌석 여러 개를 가지는 핫시트도 지원한다.

- **런타임 의존성 0개** — Node 24 내장 모듈만 사용(`node:http`, `node:crypto`, `node:fs`).
- 서버가 게임 상태와 모든 난수(주사위·티켓·카지노)의 유일한 권위. 클라이언트는 커맨드를 보내고 스냅샷을 그린다.
- 실시간 동기화는 **SSE + fetch POST** (WebSocket 라이브러리 불필요).

상세 규칙·설계: [docs/SPEC.md](docs/SPEC.md) · 클라이언트용 API 계약: [docs/API.md](docs/API.md)

## 실행

```bash
node --version   # v24 이상
npm start        # = node server.js
```

```
🎲 월드 다이스 투어 서버가 시작되었습니다.
   이 기기:      http://localhost:5173
   같은 와이파이: http://192.168.0.12:5173
```

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `5173` | 서버 포트. **1~65535 정수가 아니면 이유를 출력하고 시작하지 않는다** |
| `AUTO_PLAY_DELAY_MS` | `800` | 컴퓨터/자동 진행 좌석의 연출용 지연(ms). 0 이상 정수 |
| `ALLOWED_HOSTS` | (없음) | `Host` 헤더 추가 허용 목록(콤마 구분, 정확 일치). 아래 "접속 주소 제한" 참고 |

방 상태는 `data/rooms/<코드>.json`에 자동 저장되어 서버를 다시 켜도 이어서 플레이할 수 있다.
이 디렉터리에는 **좌석 토큰이 들어 있어 정적 서빙되지 않는다**(정적 루트는 `public/`뿐).
24시간 넘게 방치된 방은 서버 시작 시와 **1시간 주기로** 정리된다. 해석할 수 없게 손상된 저장 파일은
`<코드>.json.corrupt`로 격리되어 같은 코드의 방을 다시 만들 수 있다.

### 서버가 스스로 지키는 한도

랜 안에서 쓰는 서버지만, 브라우저 하나가 실수로(또는 악의적으로) 서버를 망가뜨리지 못하게 한도를 둔다.

| 항목 | 한도 | 초과 시 |
|---|---|---|
| 요청 본문 | 16KB | `413 ERR009` 후 연결 종료 |
| 방 개수 | 200개 | 30분 이상 방치된 대기실을 먼저 정리한 뒤 `503 ERR017` |
| SSE 구독자 | 방당 16 / 전체 128 | `503 ERR016`(이벤트 스트림이 아닌 JSON) |
| 동시 연결 | 256 | 추가 연결을 받지 않음 |
| 헤더 수신 | 10초 | 연결 종료 |

### 접속 주소 제한 (DNS 리바인딩 방어)

브라우저는 공격자 도메인을 사설 IP로 리바인딩해 이 서버에 요청을 보낼 수 있다. 그래서 서버는
`Host` 헤더가 **랜에서 실제로 쓰이는 이름**일 때만 요청을 받는다.

- 허용: `localhost`, `127.0.0.0/8`, `[::1]`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
  `169.254.0.0/16`, 점이 없는 단일 라벨 호스트명(`mypc`), `*.local`(mDNS). 모두 포트를 붙일 수 있다.
- 그 밖의 이름으로 접속해야 한다면(예: 사내 DNS 이름) 정확한 값을 환경변수에 적는다.
  ```bash
  ALLOWED_HOSTS="game.mylan.example,myhost.test" npm start
  ```
  항목은 포트를 붙여도, 붙이지 않아도 맞는다(대소문자 무시).
- 허용 목록에 없으면 `403 ERR015`.

또한 본문이 있는 요청은 `Content-Type: application/json`이어야 한다(`; charset=utf-8` 같은 파라미터는
허용). 브라우저 폼으로는 이 타입을 만들 수 없어 사이트 간 요청 위조(CSRF)가 막힌다.

## 다른 기기에서 참가하기 (같은 와이파이)

1. 호스트 PC에서 `npm start` 실행 → 콘솔에 표시된 `같은 와이파이:` 주소를 확인한다.
2. 폰/태블릿 브라우저에서 그 주소(`http://192.168.x.x:5173`)로 접속한다.
3. 방 목록에서 고르거나 4자리 방 코드를 입력해 참가한다. 좌석마다 발급되는 토큰은 브라우저에 저장되어 새로고침·재접속 시 자리를 되찾는다.

문제가 있으면:
- 두 기기가 **같은 공유기**(같은 SSID)에 있는지 확인한다. 게스트 와이파이는 기기 간 통신이 막혀 있는 경우가 많다.
- 호스트 PC 방화벽에서 5173 포트의 인바운드(사설 네트워크)를 허용한다.
  - Windows PowerShell(관리자): `New-NetFirewallRule -DisplayName "World Dice Tour" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow -Profile Private`

### ⚠️ WSL2에서 실행하는 경우

WSL2는 별도 가상 네트워크를 쓰기 때문에 **LAN의 다른 기기가 WSL2 안의 서버에 기본적으로 접근할 수 없다.** 셋 중 하나를 선택한다.

1. **(가장 쉬움) Windows 네이티브 Node로 실행** — Windows에 Node 24를 설치하고 PowerShell/명령 프롬프트에서 프로젝트 폴더로 이동해 `npm start`.
2. **WSL2 미러 네트워킹 모드** (Windows 11 22H2+ / WSL 2.0+) — `%USERPROFILE%\.wslconfig`에 다음을 넣고 `wsl --shutdown` 후 다시 실행하면 WSL2가 Windows 네트워크를 그대로 공유한다.
   ```ini
   [wsl2]
   networkingMode=mirrored
   ```
3. **포트 프록시(netsh) + 방화벽 규칙** — WSL2 IP(`wsl hostname -I`)로 Windows 5173 포트를 전달한다. WSL2 IP는 재부팅 시 바뀔 수 있으므로 매번 갱신해야 한다.
   ```powershell
   # 관리자 PowerShell
   $wslIp = (wsl hostname -I).Trim().Split(" ")[0]
   netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0 connectport=5173 connectaddress=$wslIp
   New-NetFirewallRule -DisplayName "World Dice Tour" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow -Profile Private
   # 해제: netsh interface portproxy delete v4tov4 listenport=5173 listenaddress=0.0.0.0
   ```

## 테스트

```bash
npm test              # 단위 + 통합 + E2E 전체
npm run test:unit     # 도메인 단위 테스트
npm run test:integration
npm run test:e2e      # 컴퓨터 4인 자동 대전(시드 고정) + 돈 보존 불변식
npm run coverage      # node --test --experimental-test-coverage
```

- 테스트 러너는 Node 내장 `node:test` + `node:assert/strict`. 테스트 설명은 한국어, 본문은 `// Given` / `// When` / `// Then` 구조.
- 난수는 `RandomSource` 인터페이스로 주입하므로 테스트는 결정적(`FakeRandomSource`, `SeededRandomSource`)이다.
- E2E는 모든 커맨드 후 **돈의 보존 불변식**(`총현금 + 잭팟 = 초기총액 + 은행순유입`)을 검증한다.

## 프로젝트 구조

```
server.js                    실행 진입점(포트 바인딩, LAN 주소 출력, 오래된 방 정리, 종료 처리)
src/
  app.js                     조립 루트(Composition Root)
  domain/                    순수 비즈니스 로직 — node:*/브라우저 API 의존 금지
    game/
      Game.js                Aggregate Root: 턴 소유권·페이즈 상태기계·모든 돈의 흐름
      Board.js  City.js      40칸 보드, 도시/휴양지(건물·통행료·투자액·인수·매각)
      Player.js              현금·위치·조난·공항 이동권·연속 더블·대출
      TicketDeck.js          행운 티켓 20장(즉시 효과)
      Casino.js  Dice.js     홀짝/하이로우세븐/슬롯 + 잭팟, 주사위
      BankLedger.js          은행 순유입 장부(돈의 보존 불변식)
      phases.js commands.js events.js   페이즈·커맨드·이벤트 정의(단일 출처)
      data/board.js data/tickets.js     보드 40칸·티켓 20장 데이터
    room/
      Room.js                Aggregate Root: 좌석 한도·호스트 권한·상태 전이·게임 시작
      Seat.js  RoomCode.js   좌석(토큰 보관, 비교는 하지 않음), 방 코드 생성/검증
    shared/
      DomainError.js         도메인 사유 코드 + 예외
      interfaces.js          RandomSource / RoomRepository / EventPublisher / PresenceQuery 포트(JSDoc)
  application/               유스케이스 — 로드 → 인증 → Aggregate 위임 → 저장 → 발행
    RoomService.js  GameService.js
    AutoPlayerPolicy.js      컴퓨터 좌석 의사결정(규칙 기반, 뷰 DTO만 입력)
    AutoPlayerDriver.js      자동 진행 스케줄러(중복 발사·무한 루프 방지, 백오프 재시도, 낙관적 동시성)
    dto.js                   RoomDto / GameViewDto (엔티티·토큰 절대 미노출)
    errors.js                ERR001~ERR017 규격 에러
    hostActions.js           호스트 동작 enum(검증이 서비스 그래프를 끌어오지 않도록 분리)
  infrastructure/            포트 구현
    CryptoRandomSource.js  SeededRandomSource.js  TokenFactory.js
    SeatAuthenticator.js     좌석 토큰 timingSafeEqual 비교
    RoomSerializer.js        저장 스냅샷 스키마 검증
    FileRoomRepository.js  InMemoryRoomRepository.js
  server/                    Controller 레이어
    httpServer.js            라우팅·정적 서빙·16KB 본문 제한·보안 헤더·규격 에러 응답
    hostGuard.js             Host 헤더 화이트리스트(DNS 리바인딩 방어)
    securityHeaders.js       모든 응답(JSON·정적·SSE)에 공통으로 붙는 보안 헤더
    config.js                환경변수 검증(PORT·AUTO_PLAY_DELAY_MS)
    roomController.js        입력 화이트리스트 검증 → Service 호출 → DTO 응답
    sseHub.js                방별 구독자·브로드캐스트·하트비트·presence
    validation.js            이름/토큰/커맨드/payload 검증 규칙
    staticFiles.js           경로 탈출 차단(realpath 봉쇄 포함) + 확장자 화이트리스트
    networkInfo.js           LAN 주소 목록
public/                      클라이언트(현재는 자리표시 index.html)
tests/
  unit/                      도메인 단위 테스트
  integration/               서비스 + 저장소, 실제 HTTP 서버(REST + SSE)
  e2e/                       컴퓨터 4인 자동 대전 스모크
  support/                   FakeRandomSource, 게임/앱 픽스처, 테스트용 HTTP 클라이언트
docs/SPEC.md  docs/API.md
```

### 설계 원칙

- **풍부한 도메인 모델**: 규칙 판단은 엔티티/애그리거트 안에 있다(`Player.pay`, `City.tollFor/build/liquidationValue`, `Game`이 페이즈·턴 소유권 강제, `Room`이 호스트 권한·좌석 한도 강제). 서비스는 조합만 한다.
- **레이어 분리**: 도메인은 `RandomSource`/`RoomRepository`/`EventPublisher` 포트에만 의존하고 `node:` 모듈을 import하지 않는다. 토큰 비교(`timingSafeEqual`)는 infrastructure에만 있고, 도메인은 이미 해석된 `seatId`만 받는다.
- **엔티티 미노출**: 서비스는 DTO 평면 객체만 반환하며 좌석 토큰은 DTO·SSE·로그에 절대 싣지 않는다.
- **에러 규격화**: 클라이언트에는 `{ code, message }`만, 내부 사유는 `console.error`로만. 검증 메시지는
  외부 입력을 안전하게 문자열화(`safeText`)해 `{"toString":1}` 같은 페이로드가 500으로 번지지 않게 한다.
- **저장 스냅샷 검증**: 복원 전에 좌석·플레이어·보드·턴(채무·페이즈 정합성)·장부·잭팟을 화이트리스트로
  검증하고, 어긋나면 파일을 격리한다 — 깨진 파일이 서버를 계속 넘어뜨리지 않게.
