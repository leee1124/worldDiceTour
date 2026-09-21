/**
 * 서버 enum → 화면 문구 사전. 명세의 유비쿼터스 언어를 그대로 쓴다.
 * 모든 조회 함수는 모르는 값이 와도 예외 없이 원본을 돌려준다.
 */

const lookup = (table, key, fallback) => table[key] ?? fallback ?? String(key ?? '');

/** 건물 3종 + 랜드마크. */
export const BUILDING_LABELS = Object.freeze({
  VILLA: '별장',
  BUILDING: '빌딩',
  HOTEL: '호텔',
  LANDMARK: '랜드마크',
});

export const BUILDING_ICONS = Object.freeze({
  VILLA: '🏡',
  BUILDING: '🏢',
  HOTEL: '🏨',
  LANDMARK: '🗼',
});

export const BUILDING_ORDER = Object.freeze(['VILLA', 'BUILDING', 'HOTEL']);

export function buildingLabel(type) {
  return lookup(BUILDING_LABELS, type);
}

export function buildingIcon(type) {
  return lookup(BUILDING_ICONS, type, '🏗');
}

/** 칸 종류. */
export const SPACE_KIND_LABELS = Object.freeze({
  START: '출발',
  CITY: '도시',
  RESORT: '휴양지',
  TICKET: '행운 티켓',
  TAX: '세관',
  ISLAND: '조난 섬',
  CASINO: '카지노',
  AIRPORT: '세계일주 공항',
});

export const SPACE_KIND_ICONS = Object.freeze({
  START: '🚩',
  CITY: '🏙',
  RESORT: '🌴',
  TICKET: '🎫',
  TAX: '🛃',
  ISLAND: '🏝',
  CASINO: '🎰',
  AIRPORT: '✈️',
});

export function spaceKindLabel(kind) {
  return lookup(SPACE_KIND_LABELS, kind);
}

export function spaceKindIcon(kind) {
  return lookup(SPACE_KIND_ICONS, kind, '📍');
}

/** 페이즈별 안내 문구. title은 현재 해야 할 일, hint는 보조 설명. */
export const PHASE_PROMPTS = Object.freeze({
  AWAIT_ROLL: { title: '주사위를 굴리세요', hint: '더블이 나오면 한 번 더 굴립니다.' },
  AWAIT_BUY: { title: '도시를 매입할까요?', hint: '매입하면 같은 턴에 건설 기회가 열립니다.' },
  AWAIT_BUILD: { title: '건설 기회', hint: '원하는 건물을 한 번에 골라 지을 수 있습니다.' },
  AWAIT_START_BUILD: { title: '출발 보너스', hint: '내 도시 한 곳에 건설 기회를 씁니다.' },
  AWAIT_ACQUIRE: { title: '도시를 인수할까요?', hint: '투자액의 두 배를 현금으로 내야 합니다.' },
  AWAIT_CASINO: { title: '라스베이거스 카지노', hint: '한 방문에 최대 3판까지 즐길 수 있습니다.' },
  AWAIT_ISLAND_CHOICE: { title: '조난 섬 탈출', hint: '구조비를 내거나 더블을 노려 보세요.' },
  AWAIT_TRAVEL: { title: '목적지를 고르세요', hint: '공항 칸을 뺀 어느 칸으로든 갈 수 있습니다.' },
  AWAIT_LIQUIDATION: { title: '지불 정리', hint: '자산을 팔거나 대출로 부족한 금액을 메웁니다.' },
  GAME_OVER: { title: '게임 종료', hint: '최종 순위를 확인하세요.' },
});

export function phasePrompt(phase) {
  return PHASE_PROMPTS[phase] ?? { title: '진행 중', hint: '' };
}

/** 돈 이동 사유. */
export const MONEY_REASON_LABELS = Object.freeze({
  SALARY: '월급',
  PURCHASE: '매입',
  BUILD: '건설',
  TOLL: '통행료',
  TAX: '세금',
  TICKET: '행운 티켓',
  CASINO: '카지노',
  ISLAND_RESCUE: '구조비',
  LIQUIDATION: '자산 정리',
  BANKRUPTCY: '파산',
  ACQUISITION: '인수',
  LOAN: '대출',
});

export function moneyReasonLabel(reason) {
  return lookup(MONEY_REASON_LABELS, reason, '정산');
}

/** 카지노 게임과 선택지. */
export const CASINO_GAME_LABELS = Object.freeze({
  ODD_EVEN: '홀짝',
  HIGH_LOW_SEVEN: '하이로우세븐',
  SLOT: '슬롯',
});

export const CASINO_CHOICE_LABELS = Object.freeze({
  ODD: '홀',
  EVEN: '짝',
  LOW: '로우 (2~6)',
  HIGH: '하이 (8~12)',
  SEVEN: '세븐 (7)',
});

export function casinoGameLabel(game) {
  return lookup(CASINO_GAME_LABELS, game);
}

export function casinoChoiceLabel(choice) {
  return lookup(CASINO_CHOICE_LABELS, choice);
}

/** 행운 티켓 효과 종류(로그 보조 문구). */
export const TICKET_EFFECT_LABELS = Object.freeze({
  GAIN: '현금 수령',
  LOSE: '현금 지불',
  MOVE_RELATIVE: '상대 이동',
  MOVE_TO: '지정 칸 이동',
  TO_ISLAND: '조난 섬 이송',
  COLLECT_FROM_ALL: '전원에게서 수령',
  PAY_TO_ALL: '전원에게 지불',
  PAY_PER_BUILDING: '건물 수 비례 지불',
  GAIN_PER_CITY: '도시 수 비례 수령',
  NEAREST_RESORT: '가까운 휴양지로 이동',
  TAX_RATE: '현금 비율 납부',
  CLAIM_JACKPOT: '잭팟 적립금 수령',
});

/**
 * 잭팟 수령 티켓 두 장은 효과 종류가 같고 **지분만 다르다**(전액/절반).
 * 카드마다 다른 문구를 보여 주기 위해 지분별 문구를 따로 둔다.
 */
export const JACKPOT_CLAIM_LABELS = Object.freeze({
  100: '잭팟 적립금 전액 수령',
  50: '잭팟 적립금 절반 수령',
});

/**
 * @param {string} type `TICKET_DRAWN.effect.type`
 * @param {object} [effect] 효과 전체(있으면 지분 같은 세부 값까지 문구에 반영한다)
 */
export function ticketEffectLabel(type, effect = null) {
  if (type === 'CLAIM_JACKPOT') {
    const byShare = JACKPOT_CLAIM_LABELS[effect?.share];
    if (byShare) {
      return byShare;
    }
  }
  return lookup(TICKET_EFFECT_LABELS, type, '즉시 효과');
}

/** 게임 종료 사유. */
export const GAME_OVER_REASON_LABELS = Object.freeze({
  LAST_SURVIVOR: '마지막 생존자',
  ROUND_LIMIT: '라운드 제한 도달',
});

export function gameOverReasonLabel(reason) {
  return lookup(GAME_OVER_REASON_LABELS, reason, '종료');
}

/** 조난 탈출 방법. */
export const ISLAND_ESCAPE_LABELS = Object.freeze({
  PAY: '구조비 지불',
  DOUBLE: '더블 성공',
});

/** 에러 코드가 없을 때 쓰는 기본 안내(서버 메시지가 있으면 항상 그것을 쓴다). */
export const FALLBACK_ERROR_MESSAGE = '요청을 처리할 수 없습니다.';

/**
 * 보드 칸 표시용 축약 이름(5자를 넘거나 붙여 쓰면 좁은 칸에서 잘리는 이름만).
 * **보드 칸 안에서만** 쓴다 — 시트·모달·로그·aria-label은 항상 서버가 준 원래 이름을 쓴다.
 */
export const CELL_SHORT_NAMES = Object.freeze({
  '제주 올레길': '제주',
  '알프스 설원열차': '설원열차',
  '암스테르담': '암스텔',
  '바르셀로나': '바르셀',
  '라스베이거스 카지노': '카지노',
  '멕시코시티': '멕시코',
  '리우데자네이루': '리우',
  '부에노스아이레스': '부에노스',
  '카리브 크루즈': '크루즈',
  '샌프란시스코': '샌프란',
  '세계일주 공항': '세계공항',
  '오로라 관측소': '오로라',
});

/** 보드 칸에 그릴 이름. 매핑에 없으면 원래 이름 그대로. */
export function boardCellShortName(name) {
  return CELL_SHORT_NAMES[name] ?? name;
}
