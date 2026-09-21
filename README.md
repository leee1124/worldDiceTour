# 월드 다이스 투어 (World Dice Tour)

로컬 네트워크(LAN)에서 즐기는 세계일주 주사위 보드게임. 호스트 PC가 서버를 띄우고 방을 만들면, **같은 와이파이의 다른 기기(폰·태블릿·PC)가 브라우저로 접속**해 함께 플레이한다. 한 기기가 좌석 여러 개를 가지는 핫시트도 지원한다.

- **런타임 의존성 0개** — Node 24 내장 모듈만 사용(`node:http`, `node:crypto`, `node:fs`).
- 서버가 게임 상태와 모든 난수(주사위·티켓·카지노)의 유일한 권위. 클라이언트는 커맨드를 보내고 스냅샷을 그린다.
- 실시간 동기화는 **SSE + fetch POST** (WebSocket 라이브러리 불필요).

상세 규칙·설계: [docs/SPEC.md](docs/SPEC.md) · 클라이언트용 API 계약: [docs/API.md](docs/API.md)

- 클라이언트도 **빌드 없는 Vanilla JS(ES Modules) + CSS**뿐이다. 외부 폰트·이미지·CDN 없이 CSS와 이모지, 인라인 SVG로만 그린다.

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
| `PORT` | `5173` | 서버 포트 |
| `AUTO_PLAY_DELAY_MS` | `800` | 컴퓨터/자동 진행 좌석의 연출용 지연(ms) |

방 상태는 `data/rooms/<코드>.json`에 자동 저장되어 서버를 다시 켜도 이어서 플레이할 수 있다.
이 디렉터리에는 **좌석 토큰이 들어 있어 정적 서빙되지 않는다**(정적 루트는 `public/`뿐). 24시간 넘게 방치된 방은 서버 시작 시 자동 정리된다.

## 게임 화면

| 화면 | 무엇을 하는 곳인가 |
|---|---|
| **홈** | 방 만들기 / 같은 네트워크의 방 목록에서 참가(3초마다 자동 새로고침) / 4자리 코드로 참가 / **이 기기에 저장된 방 재접속** |
| **대기실** | 큰 방 코드와 LAN 접속 주소, 좌석 목록(접속 점 · "이 기기" 표시), "이 기기에서 플레이어 추가"(핫시트), 호스트 도구(컴퓨터 추가 · 라운드 제한 · 강퇴 · 시작) |
| **게임 보드** | 11×11 그리드 외곽 40칸의 정사각 보드. 칸마다 이름 · 가격/통행료 · 소유자 색 띠 · 건물 아이콘(별장/빌딩/호텔/랜드마크) · 말. 칸을 누르면 상세 시트(소유자 · 건물 · 현재 통행료 · 인수 가격) |
| **중앙 코어** | 라운드 · 잭팟 · 현재 차례와 페이즈 안내 · 주사위 · 주 행동 버튼. 넓은 화면에서는 보드 안쪽에, 세로 화면에서는 보드 아래에 놓인다 |
| **플레이어 패널** | 색·모양으로 구분되는 좌석, 현금(증감 카운트), 총자산, 상태 배지(조난 · 대출/채무 · 컴퓨터 · 자동 진행 · 오프라인 · 파산) |
| **게임 로그** | 서버 도메인 이벤트 43종을 한국어 한 줄로 기록 |
| **카지노** | 라스베이거스 칸에 도착하면 열리는 네온 화면. 홀짝 / 하이로우세븐 / 슬롯 탭, 10,000원 단위 베팅 조작, 3릴 슬롯과 7️⃣7️⃣7️⃣ 잭팟 연출 |

## 플레이 방법

1. 호스트가 `npm start` 후 브라우저로 접속해 이름을 넣고 **방 만들기**.
2. 다른 기기는 대기실에 표시된 주소로 접속해 방 목록이나 4자리 코드로 **참가**. 한 기기에서 여러 명이 플레이하려면 "이 기기에서 플레이어 추가"(핫시트).
3. 사람이 모자라면 호스트가 **컴퓨터 추가**. 좌석 2~4명이면 **게임 시작**.
4. 자기 차례에만 행동 버튼이 켜진다. 주사위는 버튼 또는 **Space/Enter**. 남의 차례에는 같은 연출을 관전한다.
5. 페이즈에 따라 결정 창이 열린다: 매입 / 건설 조합(합계 비용과 건설 후 통행료를 미리 보여 준다) / 인수 / 출발 보너스 / 조난 섬 탈출 / 공항 목적지(보드 칸을 직접 누른다) / 지불 정리(매각 · 대출 · 파산).
6. 마지막까지 살아남거나, 라운드 제한에 닿았을 때 **총자산 1위**면 승리.

- 새로고침·재접속해도 좌석 토큰이 브라우저에 남아 자리를 되찾는다. 연결이 끊기면 "재연결 중…"이 뜨고 다시 붙는 즉시 현재 상태를 통째로 받아 그린다.
- 자리를 비운 좌석은 호스트가 **자동 진행**으로 넘길 수 있고, 그 사람이 돌아오면 "직접 플레이로 복귀"로 되돌린다.
- 접근성: 모든 버튼 포커스 이동, 모달 포커스 트랩과 Esc, 턴 안내 `aria-live`, 좌석은 색 + 모양으로 구분, `prefers-reduced-motion` 존중.

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
npm run test:e2e      # 컴퓨터 4인 자동 대전(시드 고정) + 돈 보존 불변식 + 클라이언트 순수 로직
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
      interfaces.js          RandomSource / RoomRepository / EventPublisher 포트(JSDoc)
  application/               유스케이스 — 로드 → 인증 → Aggregate 위임 → 저장 → 발행
    RoomService.js  GameService.js
    AutoPlayerPolicy.js      컴퓨터 좌석 의사결정(규칙 기반, 뷰 DTO만 입력)
    AutoPlayerDriver.js      자동 진행 스케줄러(중복 발사·무한 루프 방지, unref 타이머)
    dto.js                   RoomDto / GameViewDto (엔티티·토큰 절대 미노출)
    errors.js                ERR001~ERR014 규격 에러
  infrastructure/            포트 구현
    CryptoRandomSource.js  SeededRandomSource.js  TokenFactory.js
    SeatAuthenticator.js     좌석 토큰 timingSafeEqual 비교
    RoomSerializer.js        저장 스냅샷 스키마 검증
    FileRoomRepository.js  InMemoryRoomRepository.js
  server/                    Controller 레이어
    httpServer.js            라우팅·정적 서빙·16KB 본문 제한·보안 헤더·규격 에러 응답
    roomController.js        입력 화이트리스트 검증 → Service 호출 → DTO 응답
    sseHub.js                방별 구독자·브로드캐스트·하트비트·presence
    validation.js            이름/토큰/커맨드/payload 검증 규칙
    staticFiles.js           경로 탈출 차단 + 확장자 화이트리스트
    networkInfo.js           LAN 주소 목록
public/                      클라이언트 (빌드 없음, 의존성 0)
  index.html                 인라인 스크립트 없는 껍데기(CSP script-src 'self')
  styles/                    base · animations · home · board · panels · modals · casino
  js/
    main.js                  진입점
    GameController.js        화면·서버·연출 와이어링(커맨드 전송, 모달 동기화, SSE 재연결)
    api.js                   fetch + EventSource 래퍼, 규격 에러 {code, message} → ApiError
    storage.js               좌석 토큰 보관소(localStorage 전용, 토큰은 밖으로 내보내지 않음)
    store.js                 클라이언트 상태(room/view 스냅샷, 이 기기 좌석) + 선택자
    dom.js                   innerHTML 없는 DOM 생성 도우미(XSS 구조적 차단)
    format.js                금액 표기
    domain/                  DOM 없는 순수 규칙: boardLayout(좌표·이동 경로) · eventLog(43종 로그)
                             betRules(베팅 한도) · buildRules(조합 비용·통행료 미리보기)
                             labels · particles(한국어 조사)
    animation/               EventQueue(버전 수렴·빨리 감기) · playback(연출 재생) · effects · timing
    views/                   home · lobby · board · center · players · log · game · casino · toast
      modals/                modalHost(포커스 트랩) · 구매 · 건설 · 출발 보너스 · 인수 · 조난 섬
                             공항 확인 · 정리 · 종료 순위 · 칸 상세 · 티켓/통행료 오버레이
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
- **에러 규격화**: 클라이언트에는 `{ code, message }`만, 내부 사유는 `console.error`로만. 화면 토스트에는 서버가 준 `message`만 띄운다(모르는 코드도 그대로 안내).
- **클라이언트의 진실은 서버 뷰**: 연출은 장식일 뿐이고, 재생이 끝나면 언제나 최신 `view.version`을 그린다. 난수(주사위·티켓·카지노)는 클라이언트가 만들지 않는다.
- **테스트 가능한 순수 로직 분리**: 보드 좌표 매핑·이벤트 로그 문장·베팅 한도·건설 미리보기·재생 큐는 DOM에 의존하지 않는 모듈로 떼어 Node에서 직접 테스트한다(건설 통행료 미리보기는 서버 `City.tollFor()`와 대조).
