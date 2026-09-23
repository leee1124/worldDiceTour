/** 보드 칸 종류. */
export const SPACE_KINDS = Object.freeze({
  START: 'START',
  CITY: 'CITY',
  RESORT: 'RESORT',
  TICKET: 'TICKET',
  TAX: 'TAX',
  ISLAND: 'ISLAND',
  CASINO: 'CASINO',
  AIRPORT: 'AIRPORT',
});

/** 소유 가능한(매입 가능한) 칸 종류. */
export const OWNABLE_KINDS = Object.freeze([SPACE_KINDS.CITY, SPACE_KINDS.RESORT]);

const city = (index, name, price) => ({ index, name, kind: SPACE_KINDS.CITY, price });
const resort = (index, name) => ({ index, name, kind: SPACE_KINDS.RESORT, price: 300_000 });
const plain = (index, name, kind) => ({ index, name, kind, price: 0 });

/** 40칸 보드 정의(명세 4장). 순서/가격은 본 프로젝트 창작물. */
export const BOARD_SPACES = Object.freeze([
  plain(0, '출발', SPACE_KINDS.START),
  city(1, '하노이', 90_000),
  plain(2, '행운 티켓', SPACE_KINDS.TICKET),
  city(3, '방콕', 105_000),
  city(4, '자카르타', 120_000),
  resort(5, '제주 올레길'),
  city(6, '뭄바이', 150_000),
  plain(7, '행운 티켓', SPACE_KINDS.TICKET),
  city(8, '두바이', 180_000),
  city(9, '카이로', 180_000),
  plain(10, '조난 섬', SPACE_KINDS.ISLAND),
  city(11, '이스탄불', 210_000),
  plain(12, '행운 티켓', SPACE_KINDS.TICKET),
  city(13, '아테네', 240_000),
  city(14, '프라하', 240_000),
  resort(15, '알프스 설원열차'),
  city(16, '빈', 270_000),
  city(17, '암스테르담', 300_000),
  plain(18, '세관', SPACE_KINDS.TAX),
  city(19, '바르셀로나', 330_000),
  plain(20, '라스베이거스 카지노', SPACE_KINDS.CASINO),
  city(21, '멕시코시티', 360_000),
  plain(22, '행운 티켓', SPACE_KINDS.TICKET),
  city(23, '리우데자네이루', 390_000),
  city(24, '부에노스아이레스', 390_000),
  resort(25, '카리브 크루즈'),
  city(26, '토론토', 420_000),
  plain(27, '행운 티켓', SPACE_KINDS.TICKET),
  city(28, '시카고', 450_000),
  city(29, '샌프란시스코', 480_000),
  plain(30, '세계일주 공항', SPACE_KINDS.AIRPORT),
  city(31, '시드니', 525_000),
  plain(32, '행운 티켓', SPACE_KINDS.TICKET),
  city(33, '베를린', 570_000),
  city(34, '파리', 600_000),
  resort(35, '오로라 관측소'),
  city(36, '런던', 675_000),
  city(37, '도쿄', 750_000),
  city(38, '뉴욕', 900_000),
  city(39, '서울', 1_200_000),
]);

export const BOARD_SIZE = BOARD_SPACES.length;
