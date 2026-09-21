/** 게임 페이즈 상태기계(명세 7장). */
export const PHASES = Object.freeze({
  /** 주사위를 굴려야 하는 상태 */
  AWAIT_ROLL: 'AWAIT_ROLL',
  /** 빈 도시 매입 여부 선택 */
  AWAIT_BUY: 'AWAIT_BUY',
  /** 내 도시 건설 여부 선택 */
  AWAIT_BUILD: 'AWAIT_BUILD',
  /** 카지노 베팅/그만두기 선택 */
  AWAIT_CASINO: 'AWAIT_CASINO',
  /** 지불 불능 → 자산 매각 선택 */
  AWAIT_LIQUIDATION: 'AWAIT_LIQUIDATION',
  /** 조난 섬 탈출 방법 선택 */
  AWAIT_ISLAND_CHOICE: 'AWAIT_ISLAND_CHOICE',
  /** 세계일주 공항 목적지 선택 */
  AWAIT_TRAVEL: 'AWAIT_TRAVEL',
  /** 게임 종료 */
  GAME_OVER: 'GAME_OVER',
});

export const ALL_PHASES = Object.freeze(Object.values(PHASES));
