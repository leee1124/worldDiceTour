/**
 * 첫 사용 안내 카드. 보드게임을 하러 모인 사람에게 **한 화면 안에서** 개념을 알려 준다.
 * 문구는 이 게임의 규칙만으로 쓰였고(교과서 인용 없음), 숫자는 서버 규칙과 어긋나지 않게
 * "게임 안 규칙"만 말한다.
 */

export const TUTORIAL_CARDS = Object.freeze([
  Object.freeze({
    id: 'STOCK',
    icon: '📈',
    title: '주식이란?',
    paragraphs: Object.freeze([
      '주식은 회사의 아주 작은 조각입니다. 한 조각을 사 두면 그 회사가 잘될 때 조각값이 오르고, 어려워지면 내려갑니다.',
      '이 게임에서 값을 움직이는 것은 경기 국면과 그 라운드의 뉴스, 그리고 보드에서 벌어진 일입니다. 내가 많이 사도 값은 꿈쩍하지 않습니다 — 값을 끌어올려 이기는 방법은 없습니다.',
    ]),
    points: Object.freeze([
      '사고팔 때마다 수수료가 붙습니다. 같은 창구에서 사고 곧바로 팔면 언제나 손해입니다.',
      '가진 주식은 출발 칸을 지날 때 배당을 줍니다(배당이 없는 종목도 있습니다).',
      '값이 기준가의 20% 아래로 떨어지면 상장폐지되고, 그 종목은 전액 사라집니다.',
    ]),
  }),
  Object.freeze({
    id: 'DEPOSIT',
    icon: '🏦',
    title: '예금이란?',
    paragraphs: Object.freeze([
      '예금은 은행에 돈을 맡겨 두는 것입니다. 라운드가 넘어갈 때마다 기준금리만큼 이자가 붙습니다.',
      '값이 오르내리지 않으니 마음이 편하지만, 그만큼 크게 벌지도 못합니다. 통행료 낼 현금이 모자라면 언제든 빼서 쓸 수 있습니다.',
    ]),
    points: Object.freeze([
      '정해진 단위로만 넣고 뺄 수 있고, 잔액에는 상한이 있습니다.',
      '대출 채무가 남아 있으면 그 라운드 이자는 0원입니다(빌린 돈으로 이자를 벌 수는 없습니다).',
      '예금도 총자산에 들어가므로 순위 계산에 그대로 반영됩니다.',
    ]),
  }),
  Object.freeze({
    id: 'CYCLE',
    icon: '🌤',
    title: '경기 사이클과 뉴스',
    paragraphs: Object.freeze([
      '경기는 호황 → 과열 → 침체 → 회복을 돌며, 국면마다 기본 추세와 흔들림의 크기가 다릅니다.',
      '라운드가 넘어갈 때 뉴스 한 장이 뽑혀 업종별로 값을 밀거나 당깁니다. 뉴스 카드에는 "왜 그런지" 한 줄이 늘 함께 나옵니다.',
    ]),
    points: Object.freeze([
      '보드에서 벌어진 일(랜드마크·잭팟·세관 등)은 업종에 압력을 남기고 다음 라운드에 반영됩니다.',
      '그 압력은 시장 패널에 미리 공개됩니다 — 아무도 혼자만 아는 정보를 가질 수 없습니다.',
      '기준금리는 뉴스만이 움직이고, 예금 이자율이 곧 기준금리입니다.',
    ]),
  }),
]);

/** id로 카드 한 장. 없으면 null. */
export function tutorialCard(id) {
  return TUTORIAL_CARDS.find((card) => card.id === id) ?? null;
}

/** 아직 보지 않은 첫 카드(보여 줄 순서는 목록 순서). */
export function firstUnseenCard(seenIds) {
  const seen = new Set(Array.isArray(seenIds) ? seenIds : []);
  return TUTORIAL_CARDS.find((card) => !seen.has(card.id)) ?? null;
}
