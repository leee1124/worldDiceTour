/**
 * 상품 데이터(설계서 §3.1). **이름과 회사는 전부 창작이며 실존 기업과 무관하다.**
 *
 * `klass`(상품 종류)와 클래스별 파라미터 표를 분리해 둔 이유: 앞으로 코인·지수가 붙을 때
 * `PriceProcess`/`Instrument`/`TradingDesk`의 로직을 고치지 않고 **이 파일에 줄만 추가**하면 되게 하려는 것이다
 * (설계서 §9.1 항목 1·2).
 */

/** 섹터(뉴스 효과와 보드 연동 압력이 겨누는 대상). */
export const SECTORS = Object.freeze({
  AIRLINE: 'AIRLINE',
  CONSTRUCTION: 'CONSTRUCTION',
  HOTEL: 'HOTEL',
  ENTERTAINMENT: 'ENTERTAINMENT',
  ENERGY: 'ENERGY',
});

export const ALL_SECTORS = Object.freeze(Object.values(SECTORS));

/** 화면에 그대로 출력할 섹터 이름. */
export const SECTOR_LABELS = Object.freeze({
  [SECTORS.AIRLINE]: '항공',
  [SECTORS.CONSTRUCTION]: '건설',
  [SECTORS.HOTEL]: '호텔·관광',
  [SECTORS.ENTERTAINMENT]: '카지노·엔터',
  [SECTORS.ENERGY]: '에너지',
});

/** 상품 종류. Phase 1은 주식만 쓰지만 가격 규칙은 종류에 무관하다. */
export const INSTRUMENT_CLASSES = Object.freeze({
  STOCK: 'STOCK',
  COIN: 'COIN',
  INDEX: 'INDEX',
});

/** 상장 상태. */
export const INSTRUMENT_STATES = Object.freeze({
  LISTED: 'LISTED',
  DELISTED: 'DELISTED',
});

/**
 * 클래스별 가격 파라미터.
 * - `tickUnit`: 가격 단위(주식 100원 / 코인 500원 / 지수 1pt)
 * - `minPct`/`maxPct`: 기준가 대비 하한·상한(%)
 * - `delistPct`: 기준가 대비 이 비율 이하로 떨어지면 상장폐지(%)
 *
 * 코인·지수 줄은 Phase 3·4가 데이터만 추가해 열 수 있도록 미리 확정해 둔 값이다(설계서 §3.6/§3.7).
 */
export const CLASS_PARAMS = Object.freeze({
  [INSTRUMENT_CLASSES.STOCK]: Object.freeze({ tickUnit: 100, minPct: 20, maxPct: 400, delistPct: 20 }),
  [INSTRUMENT_CLASSES.COIN]: Object.freeze({ tickUnit: 500, minPct: 5, maxPct: 1_000, delistPct: 10 }),
  [INSTRUMENT_CLASSES.INDEX]: Object.freeze({ tickUnit: 1, minPct: 20, maxPct: 400, delistPct: 0 }),
});

const stock = (spec) => Object.freeze({ ...spec, klass: INSTRUMENT_CLASSES.STOCK });

/** 판이 시작될 때 상장되는 주식 5종목(설계서 §3.1). */
export const LISTED_INSTRUMENTS = Object.freeze([
  stock({ id: 'AIR', name: '한빛항공', sector: SECTORS.AIRLINE, basePrice: 12_000, baseVolBp: 700, dividendBp: 150 }),
  stock({ id: 'CON', name: '대양건설', sector: SECTORS.CONSTRUCTION, basePrice: 8_000, baseVolBp: 900, dividendBp: 200 }),
  stock({ id: 'HOT', name: '미르호텔앤리조트', sector: SECTORS.HOTEL, basePrice: 15_000, baseVolBp: 600, dividendBp: 250 }),
  stock({ id: 'ENT', name: '네온엔터카지노', sector: SECTORS.ENTERTAINMENT, basePrice: 6_000, baseVolBp: 1_200, dividendBp: 0 }),
  stock({ id: 'NRG', name: '청해에너지', sector: SECTORS.ENERGY, basePrice: 20_000, baseVolBp: 500, dividendBp: 350 }),
]);

/**
 * 예비 상장 풀(설계서 §3.1). 상장폐지가 일어난 **다음 틱**에 이 순서대로 신규 상장되어
 * 목록은 언제나 5종목을 유지한다(UI 형태 고정 + 분산투자 교훈 유지).
 *
 * 기준가·변동성·배당은 설계서가 이름만 정했으므로, 대체하는 섹터의 원래 종목과 비슷한 성격이 되도록
 * 정했다(SPEC 12장에 기록).
 */
export const RESERVE_INSTRUMENTS = Object.freeze([
  stock({ id: 'SKY', name: '새벽항공운수', sector: SECTORS.AIRLINE, basePrice: 9_000, baseVolBp: 800, dividendBp: 100 }),
  stock({ id: 'ROCK', name: '반석중공업', sector: SECTORS.CONSTRUCTION, basePrice: 11_000, baseVolBp: 850, dividendBp: 150 }),
  stock({ id: 'LEAF', name: '초록전력', sector: SECTORS.ENERGY, basePrice: 14_000, baseVolBp: 550, dividendBp: 300 }),
]);

const SPECS_BY_ID = new Map(
  [...LISTED_INSTRUMENTS, ...RESERVE_INSTRUMENTS].map((spec) => [spec.id, spec]),
);

/** 종목 규격을 id로 찾는다(없으면 null — 손상 스냅샷 방어). */
export function instrumentSpecById(id) {
  return SPECS_BY_ID.get(id) ?? null;
}
