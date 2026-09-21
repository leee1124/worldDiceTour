/** 행운 티켓 효과 종류(즉시 효과만, 보관형 카드 없음). */
export const TICKET_EFFECTS = Object.freeze({
  /** 은행에서 수령 */
  GAIN: 'GAIN',
  /** 은행에 지불 */
  LOSE: 'LOSE',
  /** 상대 칸 수만큼 전진/후진 */
  MOVE_RELATIVE: 'MOVE_RELATIVE',
  /** 특정 칸으로 전진(출발 통과 시 월급) */
  MOVE_TO: 'MOVE_TO',
  /** 조난 섬으로 이송(월급 없음) */
  TO_ISLAND: 'TO_ISLAND',
  /** 다른 모든 플레이어에게서 수령 */
  COLLECT_FROM_ALL: 'COLLECT_FROM_ALL',
  /** 다른 모든 플레이어에게 지불 */
  PAY_TO_ALL: 'PAY_TO_ALL',
  /** 내 건물 단계 합계 × 금액 지불 */
  PAY_PER_BUILDING: 'PAY_PER_BUILDING',
  /** 내 도시 수 × 금액 수령 */
  GAIN_PER_CITY: 'GAIN_PER_CITY',
  /** 가장 가까운 휴양지로 전진 */
  NEAREST_RESORT: 'NEAREST_RESORT',
  /** 현금의 일정 비율을 잭팟에 납부 */
  TAX_RATE: 'TAX_RATE',
});

/** 행운 티켓 20장. 문구는 전부 자체 창작. */
export const TICKETS = Object.freeze([
  { id: 'T01', text: '복권 소액 당첨! 100,000원을 받습니다.', effect: { type: TICKET_EFFECTS.GAIN, amount: 100_000 } },
  { id: 'T02', text: '여행 브이로그 대박! 200,000원을 받습니다.', effect: { type: TICKET_EFFECTS.GAIN, amount: 200_000 } },
  { id: 'T03', text: '면세점 세금 환급 50,000원을 받습니다.', effect: { type: TICKET_EFFECTS.GAIN, amount: 50_000 } },
  { id: 'T04', text: '여행자 보험금 150,000원을 받습니다.', effect: { type: TICKET_EFFECTS.GAIN, amount: 150_000 } },
  { id: 'T05', text: '수하물 초과 요금 50,000원을 냅니다.', effect: { type: TICKET_EFFECTS.LOSE, amount: 50_000 } },
  { id: 'T06', text: '여권을 잃어버려 재발급 비용 100,000원을 냅니다.', effect: { type: TICKET_EFFECTS.LOSE, amount: 100_000 } },
  { id: 'T07', text: '호텔 미니바 폭주로 80,000원을 냅니다.', effect: { type: TICKET_EFFECTS.LOSE, amount: 80_000 } },
  { id: 'T08', text: '렌터카 과속 딱지로 60,000원을 냅니다.', effect: { type: TICKET_EFFECTS.LOSE, amount: 60_000 } },
  { id: 'T09', text: '순풍을 타고 앞으로 3칸 이동합니다.', effect: { type: TICKET_EFFECTS.MOVE_RELATIVE, steps: 3 } },
  { id: 'T10', text: '역풍을 만나 뒤로 2칸 밀려납니다.', effect: { type: TICKET_EFFECTS.MOVE_RELATIVE, steps: -2 } },
  { id: 'T11', text: '귀국 항공권 당첨! 출발 칸으로 직행하고 월급을 받습니다.', effect: { type: TICKET_EFFECTS.MOVE_TO, index: 0 } },
  { id: 'T12', text: '카지노 초대장! 라스베이거스 카지노로 이동합니다.', effect: { type: TICKET_EFFECTS.MOVE_TO, index: 20 } },
  { id: 'T13', text: '폭풍우에 휩쓸려 조난 섬으로 이송됩니다.', effect: { type: TICKET_EFFECTS.TO_ISLAND } },
  { id: 'T14', text: '공항 특가 항공권! 세계일주 공항으로 이동합니다.', effect: { type: TICKET_EFFECTS.MOVE_TO, index: 30 } },
  { id: 'T15', text: '생일 축하! 다른 모든 플레이어에게서 50,000원씩 받습니다.', effect: { type: TICKET_EFFECTS.COLLECT_FROM_ALL, amount: 50_000 } },
  { id: 'T16', text: '한턱 쏘기! 다른 모든 플레이어에게 30,000원씩 줍니다.', effect: { type: TICKET_EFFECTS.PAY_TO_ALL, amount: 30_000 } },
  { id: 'T17', text: '건물 점검 비용으로 건물 수 × 40,000원을 냅니다.', effect: { type: TICKET_EFFECTS.PAY_PER_BUILDING, amount: 40_000 } },
  { id: 'T18', text: '관광 붐! 보유 도시 수 × 30,000원을 받습니다.', effect: { type: TICKET_EFFECTS.GAIN_PER_CITY, amount: 30_000 } },
  { id: 'T19', text: '휴양 충동! 가장 가까운 휴양지로 전진합니다.', effect: { type: TICKET_EFFECTS.NEAREST_RESORT } },
  { id: 'T20', text: '세무조사! 현금의 5%를 납부합니다(잭팟 적립).', effect: { type: TICKET_EFFECTS.TAX_RATE, rate: 0.05 } },
]);

export const TICKETS_BY_ID = Object.freeze(
  Object.fromEntries(TICKETS.map((ticket) => [ticket.id, ticket])),
);
