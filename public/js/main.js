/**
 * 진입점. CSP(`script-src 'self'`)를 지키기 위해 인라인 스크립트 없이 이 모듈만 로드한다.
 */

import { initTheme } from './theme.js';
import { createGameController } from './GameController.js';

/*
 * import는 끌어올려지지만(hoisting) 그건 "바인딩이 먼저 만들어진다"는 뜻이지 실행 순서가
 * 바뀐다는 뜻은 아니다 — 모듈 그래프는 이 파일이 적은 순서대로(깊이 우선) 평가된다.
 * `GameController.js`가 끌어들이는 view 모듈들은 전부 "만드는 함수"만 내보낼 뿐 임포트
 * 시점에 DOM을 그리지 않으므로, 실제 화면은 아래 `createGameController(...).start()`가
 * 호출될 때 비로소 그려진다. 따라서 이 줄(그 호출보다 앞)에서 테마부터 반영해 두면
 * 깜빡임(FOUC)을 줄일 수 있다. 다만 CSP(`script-src 'self'`)상 <head>에 동기 스크립트를
 * 먼저 끼워 넣을 수는 없으므로(인라인 금지), 모듈이 로드된 뒤 페인트되기 전이라는
 * 최선의 지점일 뿐 완전한 제거는 아니다(자동+시스템다크 조합은 CSS 미디어쿼리만으로
 * 이미 깜빡임 없이 처리되고, 수동 선택이 시스템과 반대인 경우에만 아주 짧게 남는다).
 */
initTheme();

const appRoot = document.getElementById('app');
const overlayRoot = document.getElementById('overlay-root');

if (!appRoot || !overlayRoot) {
  console.error('[main] 앱을 붙일 자리를 찾지 못했습니다.');
} else {
  const controller = createGameController({ appRoot, overlayRoot });
  controller.start().catch((error) => {
    console.error('[main] 초기화 실패', error);
  });
}
