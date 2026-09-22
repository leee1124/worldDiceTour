/**
 * 결정 모달 안전망(순수 로직). DOM을 모른다.
 *
 * **왜 필요한가**: 결정 모달은 "최신 뷰를 그릴 때"만 닫힌다. 그런데 최신 뷰는 연출 큐가
 * 다 비워진 뒤에 반영되므로, 연출 약속(애니메이션 Promise)이 멈추면 서버가 이미 다음
 * 페이즈로 넘어갔어도 모달이 화면에 남는다. 폰에서 "카드가 안 꺼진다"는 신고의 가장
 * 그럴듯한 경로다. 그래서 **메시지가 도착한 시점의 페이즈**만 보고 어긋난 모달을 골라낸다.
 *
 * 정보 시트(칸 상세·도시 목록)와 게임 종료 모달은 스스로 닫는 UI라 안전망이 건드리지 않는다.
 */

/** 결정 모달 id → 그 모달이 살아 있어도 되는 페이즈. */
export const DECISION_MODAL_PHASES = Object.freeze({
  buy: Object.freeze(['AWAIT_BUY']),
  build: Object.freeze(['AWAIT_BUILD']),
  'start-build': Object.freeze(['AWAIT_START_BUILD']),
  acquire: Object.freeze(['AWAIT_ACQUIRE']),
  island: Object.freeze(['AWAIT_ISLAND_CHOICE']),
  liquidation: Object.freeze(['AWAIT_LIQUIDATION']),
  casino: Object.freeze(['AWAIT_CASINO']),
  'travel-confirm': Object.freeze(['AWAIT_TRAVEL']),
});

/** 결정 모달 id → 서버 pending.kind. (pending이 있을 때만 비교한다.) */
export const DECISION_MODAL_PENDING_KINDS = Object.freeze({
  buy: 'BUY',
  build: 'BUILD',
  'start-build': 'START_BUILD',
  acquire: 'ACQUIRE',
  island: 'ISLAND',
  liquidation: 'LIQUIDATION',
});

/**
 * **자기 본문에서 연출이 재생되는** 결정 모달. 카지노만 해당한다
 * (릴·주사위·결과 배너가 모달 안에서 돈다). 이 모달만 유예를 준다 —
 * 곧바로 닫으면 3판째 결과를 사용자가 보기도 전에 화면에서 사라진다.
 */
export const ANIMATED_BODY_MODAL_IDS = Object.freeze(['casino']);

/**
 * 어긋난 모달을 닫기 전에 기다려 주는 시간.
 * 0이면 진행 중인 연출(예: 카지노 3판째 결과)을 사용자가 보기도 전에 닫아 버린다.
 * 검증 하네스는 "페이즈가 바뀐 뒤 3초 이상 열려 있는 결정 모달"을 STUCK으로 보므로 그보다 짧게 둔다.
 */
export const STALE_MODAL_GRACE_MS = 2200;

/**
 * 지금 뷰와 어긋나 닫아야 하는 결정 모달 id 목록.
 *
 * @param {string[]} [openIds] 열려 있는 모달 id (modalHost.openIds)
 * @param {{phase?: string, pending?: object|null, isOver?: boolean}|null} [view] 가장 최근에 받은 서버 뷰
 * @returns {string[]}
 */
export function staleDecisionModalIds(openIds = [], view = null) {
  if (!Array.isArray(openIds) || openIds.length === 0) {
    return [];
  }
  const decisions = openIds.filter((id) => Boolean(DECISION_MODAL_PHASES[id]));
  // 뷰가 없거나 게임이 끝났으면 결정할 것이 남아 있지 않다.
  if (!view || view.isOver === true) {
    return decisions;
  }
  const phase = view.phase ?? null;
  const pending = view.pending ?? null;
  return decisions.filter((id) => {
    if (!DECISION_MODAL_PHASES[id].includes(phase)) {
      return true;
    }
    const wantKind = DECISION_MODAL_PENDING_KINDS[id];
    // pending이 아직 없는 메시지(연출만 온 경우)는 페이즈만으로 판단한다.
    return Boolean(wantKind) && Boolean(pending?.kind) && pending.kind !== wantKind;
  });
}

/**
 * 어긋난 결정 모달을 "즉시 닫을 것"과 "유예 뒤에 닫을 것"으로 나눈다.
 *
 * 조난 섬처럼 자기 연출이 없는 모달은 페이즈가 바뀌는 **즉시** 닫아야 한다.
 * (구조비를 낸 뒤 결과 안내 카드가 재생되는 동안 모달이 남아 있던 실제 사례가 있다.)
 *
 * @param {string[]} [openIds]
 * @param {object|null} [view]
 * @returns {{immediate: string[], graced: string[]}}
 */
export function partitionStaleModals(openIds = [], view = null) {
  const stale = staleDecisionModalIds(openIds, view);
  return {
    immediate: stale.filter((id) => !ANIMATED_BODY_MODAL_IDS.includes(id)),
    graced: stale.filter((id) => ANIMATED_BODY_MODAL_IDS.includes(id)),
  };
}
