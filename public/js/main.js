/**
 * 진입점. CSP(`script-src 'self'`)를 지키기 위해 인라인 스크립트 없이 이 모듈만 로드한다.
 */

import { initTheme } from './theme.js';

// 화면을 그리기 전에 가장 먼저: 테마부터 반영해야 깜빡임(FOUC)이 줄어든다.
initTheme();

import { createGameController } from './GameController.js';

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
