import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLASS_PARAMS,
  INSTRUMENT_CLASSES,
  LISTED_INSTRUMENTS,
  RESERVE_INSTRUMENTS,
  SECTORS,
  SECTOR_LABELS,
  instrumentSpecById,
} from '../../src/domain/market/data/instruments.js';
import {
  CYCLE_ORDER,
  CYCLE_PARAMS,
  CYCLE_PHASES,
  DESIGN_DRIFT_BP,
  DRIFT_TUNING_BP,
  INITIAL_CYCLE_PHASE,
  MIN_PHASE_AGE,
  nextCyclePhase,
} from '../../src/domain/market/data/cycle.js';
import {
  NEWS_CARDS,
  NEWS_EFFECT_TARGETS,
  newsCardsOfPhase,
} from '../../src/domain/market/data/news.js';

/**
 * 시장 데이터 표가 설계서 §3.1~§3.3과 정확히 일치하는지 검증한다.
 * 기댓값은 설계서에서 그대로 옮겨 적었다 — 숫자를 바꾸려면 설계서와 SPEC을 함께 고쳐야 한다.
 */

/** 설계서 §3.1 주식 5종목. */
const EXPECTED_LISTED = [
  { id: 'AIR', name: '한빛항공', sector: 'AIRLINE', basePrice: 12_000, baseVolBp: 700, dividendBp: 150 },
  { id: 'CON', name: '대양건설', sector: 'CONSTRUCTION', basePrice: 8_000, baseVolBp: 900, dividendBp: 200 },
  { id: 'HOT', name: '미르호텔앤리조트', sector: 'HOTEL', basePrice: 15_000, baseVolBp: 600, dividendBp: 250 },
  { id: 'ENT', name: '네온엔터카지노', sector: 'ENTERTAINMENT', basePrice: 6_000, baseVolBp: 1_200, dividendBp: 0 },
  { id: 'NRG', name: '청해에너지', sector: 'ENERGY', basePrice: 20_000, baseVolBp: 500, dividendBp: 350 },
];

/** 설계서 §3.3 뉴스 24장의 효과(섹터 bp / RATE bp / ALL bp). */
const EXPECTED_NEWS = {
  NE1: { phase: 'EXPANSION', headline: '국제선 좌석이 모자란다', sectors: { AIRLINE: 600, HOTEL: 400 } },
  NE2: { phase: 'EXPANSION', headline: '신도시 착공식이 줄줄이', sectors: { CONSTRUCTION: 700, ENERGY: 200 } },
  NE3: { phase: 'EXPANSION', headline: '연휴 특수, 객실 만실', sectors: { HOTEL: 600, ENTERTAINMENT: 300 } },
  NE4: { phase: 'EXPANSION', headline: '전력 수요 최고치 경신', sectors: { ENERGY: 500, CONSTRUCTION: 100 } },
  NE5: { phase: 'EXPANSION', headline: '경기가 좋으면 금리도 오른다', sectors: { CONSTRUCTION: -200, AIRLINE: -100 }, rate: 25 },
  NE6: { phase: 'EXPANSION', headline: '관광 박람회 대성황', sectors: { HOTEL: 500, AIRLINE: 300, ENTERTAINMENT: 200 } },

  NO1: { phase: 'OVERHEAT', headline: '빈 땅에도 웃돈이 붙는다', sectors: { CONSTRUCTION: 1_200, ENERGY: 200 } },
  NO2: { phase: 'OVERHEAT', headline: '금리 인상, 이번엔 폭이 크다', sectors: { CONSTRUCTION: -600, HOTEL: -400 }, rate: 50 },
  NO3: { phase: 'OVERHEAT', headline: '카지노 매출 사상 최대', sectors: { ENTERTAINMENT: 1_500 } },
  NO4: { phase: 'OVERHEAT', headline: '연료비 급등에 항공사 비명', sectors: { AIRLINE: -800, ENERGY: 900 } },
  NO5: { phase: 'OVERHEAT', headline: '분양 경쟁률 세 자릿수', sectors: { CONSTRUCTION: 1_000, HOTEL: 300 } },
  NO6: { phase: 'OVERHEAT', headline: '거품 경고 보고서 공개', all: -300, rate: 25 },

  NR1: { phase: 'RECESSION', headline: '여행 예약 취소 급증', sectors: { AIRLINE: -1_000, HOTEL: -800 } },
  NR2: { phase: 'RECESSION', headline: '공사 중단 현장이 늘어난다', sectors: { CONSTRUCTION: -1_200 } },
  NR3: { phase: 'RECESSION', headline: '금리 인하, 급한 불 끄기', sectors: { CONSTRUCTION: 400, HOTEL: 200 }, rate: -50 },
  NR4: { phase: 'RECESSION', headline: '전기 사용량 감소', sectors: { ENERGY: -600 } },
  NR5: { phase: 'RECESSION', headline: '지갑 닫힌 주말', sectors: { ENTERTAINMENT: -1_400, HOTEL: -400 } },
  NR6: { phase: 'RECESSION', headline: '구조조정 발표 잇따라', all: -500, rate: -25 },

  NV1: { phase: 'RECOVERY', headline: '예약률이 바닥을 지났다', sectors: { AIRLINE: 500, HOTEL: 400 } },
  NV2: { phase: 'RECOVERY', headline: '멈췄던 공사가 재개된다', sectors: { CONSTRUCTION: 600 } },
  NV3: { phase: 'RECOVERY', headline: '저금리, 돈이 위험자산으로', all: 200, rate: -25 },
  NV4: { phase: 'RECOVERY', headline: '연료값 안정세', sectors: { AIRLINE: 600, ENERGY: -300 } },
  NV5: { phase: 'RECOVERY', headline: '주말 나들이 재개', sectors: { ENTERTAINMENT: 700, HOTEL: 300 } },
  NV6: { phase: 'RECOVERY', headline: '금리 동결, 지켜보기', all: 0 },
};

describe('시장 데이터: 주식 종목표(설계서 §3.1)', () => {
  it('상장 5종목의 이름·섹터·기준가·변동성·배당이 설계서와 같다', () => {
    // Given / When
    const actual = LISTED_INSTRUMENTS.map((spec) => ({
      id: spec.id,
      name: spec.name,
      sector: spec.sector,
      basePrice: spec.basePrice,
      baseVolBp: spec.baseVolBp,
      dividendBp: spec.dividendBp,
    }));

    // Then
    assert.deepEqual(actual, EXPECTED_LISTED);
  });

  it('모든 종목이 STOCK 클래스이고 클래스 파라미터는 100원 단위·20/400/20%다', () => {
    // Given / When / Then
    for (const spec of [...LISTED_INSTRUMENTS, ...RESERVE_INSTRUMENTS]) {
      assert.equal(spec.klass, INSTRUMENT_CLASSES.STOCK, `${spec.id} 클래스`);
    }
    assert.deepEqual(CLASS_PARAMS[INSTRUMENT_CLASSES.STOCK], {
      tickUnit: 100,
      minPct: 20,
      maxPct: 400,
      delistPct: 20,
    });
  });

  it('코인·지수 클래스 파라미터도 미리 들어 있다(설계서 §3.6/§3.7 — 데이터 추가만으로 열리게)', () => {
    // Given / When / Then
    assert.deepEqual(CLASS_PARAMS[INSTRUMENT_CLASSES.COIN], {
      tickUnit: 500,
      minPct: 5,
      maxPct: 1_000,
      delistPct: 10,
    });
    assert.ok(CLASS_PARAMS[INSTRUMENT_CLASSES.INDEX], '지수 파라미터가 없다');
  });

  it('예비 상장 풀은 3종목(SKY·ROCK·LEAF)이고 상장 목록과 id가 겹치지 않는다', () => {
    // Given / When
    const reserveIds = RESERVE_INSTRUMENTS.map((spec) => spec.id);
    const listedIds = LISTED_INSTRUMENTS.map((spec) => spec.id);

    // Then
    assert.deepEqual(reserveIds, ['SKY', 'ROCK', 'LEAF']);
    assert.deepEqual(
      RESERVE_INSTRUMENTS.map((spec) => spec.name),
      ['새벽항공운수', '반석중공업', '초록전력'],
    );
    for (const id of reserveIds) {
      assert.ok(!listedIds.includes(id), `예비 종목이 상장 목록과 겹친다: ${id}`);
    }
  });

  it('모든 종목의 기준가는 tickUnit의 배수이고 섹터는 이름표를 갖는다', () => {
    // Given / When / Then
    for (const spec of [...LISTED_INSTRUMENTS, ...RESERVE_INSTRUMENTS]) {
      const tickUnit = CLASS_PARAMS[spec.klass].tickUnit;
      assert.equal(spec.basePrice % tickUnit, 0, `${spec.id} 기준가가 단위의 배수가 아니다`);
      assert.ok(Object.values(SECTORS).includes(spec.sector), `${spec.id} 섹터가 목록에 없다`);
      assert.ok(SECTOR_LABELS[spec.sector], `${spec.sector} 이름표가 없다`);
    }
  });

  it('id로 종목 규격을 찾을 수 있고 없는 id는 null이다', () => {
    // Given / When / Then
    assert.equal(instrumentSpecById('AIR').name, '한빛항공');
    assert.equal(instrumentSpecById('SKY').name, '새벽항공운수');
    assert.equal(instrumentSpecById('NOPE'), null);
  });
});

describe('시장 데이터: 경기 국면표(설계서 §3.2 + 오너 밸런스 결정)', () => {
  it('4국면의 drift·변동성 배수·전이 확률이 확정값과 같다', () => {
    // Given / When / Then
    assert.deepEqual(CYCLE_PARAMS, {
      EXPANSION: { label: '호황', driftBp: 200, volMulPct: 100, advanceChance: 35 },
      OVERHEAT: { label: '과열', driftBp: 100, volMulPct: 140, advanceChance: 50 },
      RECESSION: { label: '침체', driftBp: -150, volMulPct: 130, advanceChance: 35 },
      RECOVERY: { label: '회복', driftBp: 150, volMulPct: 80, advanceChance: 40 },
    });
  });

  it('확정 drift는 설계서 값에 균일 가산 한 번(+50bp)을 얹은 것이다 — 국면 간 상대 관계 보존', () => {
    // Given (오너 결정: "1바퀴 평균 6~7% 상승, 물론 떨어질 때도 있어야 함")
    //        → 전 국면에 같은 값을 더해 기대수익만 올리고 국면 성격은 건드리지 않는다.
    // When / Then
    assert.equal(DRIFT_TUNING_BP, 50);
    for (const phase of CYCLE_ORDER) {
      assert.equal(
        CYCLE_PARAMS[phase].driftBp,
        DESIGN_DRIFT_BP[phase] + DRIFT_TUNING_BP,
        `${phase} drift가 설계값 + 균일 가산이 아니다`,
      );
    }
    assert.deepEqual(DESIGN_DRIFT_BP, {
      EXPANSION: 150,
      OVERHEAT: 50,
      RECESSION: -200,
      RECOVERY: 100,
    });
  });

  it('침체는 가산 후에도 분명히 하락 국면이다(타이밍이 여전히 중요하다)', () => {
    // Given / When / Then
    assert.ok(CYCLE_PARAMS.RECESSION.driftBp < 0, '침체 drift가 음수가 아니다');
    // 침체 뉴스 덱의 평균(종목당 −243bp/라운드)까지 합치면 라운드당 −3.5% 수준이다.
    assert.ok(
      CYCLE_PARAMS.RECESSION.driftBp < CYCLE_PARAMS.OVERHEAT.driftBp &&
        CYCLE_PARAMS.OVERHEAT.driftBp < CYCLE_PARAMS.RECOVERY.driftBp &&
        CYCLE_PARAMS.RECOVERY.driftBp < CYCLE_PARAMS.EXPANSION.driftBp,
      '국면 간 drift 순서가 설계서와 달라졌다',
    );
  });

  it('국면은 호황 → 과열 → 침체 → 회복 순으로 순환한다', () => {
    // Given / When / Then
    assert.deepEqual(CYCLE_ORDER, ['EXPANSION', 'OVERHEAT', 'RECESSION', 'RECOVERY']);
    assert.equal(nextCyclePhase(CYCLE_PHASES.EXPANSION), CYCLE_PHASES.OVERHEAT);
    assert.equal(nextCyclePhase(CYCLE_PHASES.OVERHEAT), CYCLE_PHASES.RECESSION);
    assert.equal(nextCyclePhase(CYCLE_PHASES.RECESSION), CYCLE_PHASES.RECOVERY);
    assert.equal(nextCyclePhase(CYCLE_PHASES.RECOVERY), CYCLE_PHASES.EXPANSION);
  });

  it('판은 회복 국면에서 시작하고 최소 2라운드는 머문다', () => {
    // Given / When / Then
    assert.equal(INITIAL_CYCLE_PHASE, CYCLE_PHASES.RECOVERY);
    assert.equal(MIN_PHASE_AGE, 2);
  });
});

describe('시장 데이터: 경제 뉴스 24장(설계서 §3.3)', () => {
  it('국면마다 정확히 6장씩, 전체 24장이다', () => {
    // Given / When / Then
    assert.equal(NEWS_CARDS.length, 24);
    for (const phase of CYCLE_ORDER) {
      assert.equal(newsCardsOfPhase(phase).length, 6, `${phase} 덱 크기`);
    }
  });

  it('id가 중복되지 않고 모든 카드가 헤드라인과 한 줄 해설을 갖는다', () => {
    // Given / When
    const ids = NEWS_CARDS.map((card) => card.id);

    // Then
    assert.equal(new Set(ids).size, 24, 'id가 중복됐다');
    for (const card of NEWS_CARDS) {
      assert.ok(card.headline.length > 0, `${card.id} 헤드라인 없음`);
      assert.ok(card.explanation.length > 0, `${card.id} 해설 없음`);
      assert.ok(card.explanation.length <= 60, `${card.id} 해설이 너무 길다`);
    }
  });

  for (const [id, expected] of Object.entries(EXPECTED_NEWS)) {
    it(`${id}(${expected.headline}): 국면과 효과 bp가 설계서와 정확히 같다`, () => {
      // Given
      const card = NEWS_CARDS.find((candidate) => candidate.id === id);
      assert.ok(card, `카드 ${id}가 없다`);

      // When
      const sectors = {};
      let all = null;
      let rate = null;
      for (const effect of card.effects) {
        if (effect.target === NEWS_EFFECT_TARGETS.SECTOR) {
          sectors[effect.sector] = effect.bp;
        } else if (effect.target === NEWS_EFFECT_TARGETS.ALL) {
          all = effect.bp;
        } else if (effect.target === NEWS_EFFECT_TARGETS.RATE) {
          rate = effect.bp;
        }
      }

      // Then
      assert.equal(card.phase, expected.phase, '국면');
      assert.equal(card.headline, expected.headline, '헤드라인');
      assert.deepEqual(sectors, expected.sectors ?? {}, '섹터 효과');
      assert.equal(all, expected.all ?? null, 'ALL 효과');
      assert.equal(rate, expected.rate ?? null, 'RATE 효과');
    });
  }

  it('효과의 target은 화이트리스트이고 bp는 안전 정수다', () => {
    // Given / When / Then
    const targets = Object.values(NEWS_EFFECT_TARGETS);
    for (const card of NEWS_CARDS) {
      for (const effect of card.effects) {
        assert.ok(targets.includes(effect.target), `${card.id} 알 수 없는 target`);
        assert.ok(Number.isSafeInteger(effect.bp), `${card.id} bp가 정수가 아니다`);
        if (effect.target === NEWS_EFFECT_TARGETS.SECTOR) {
          assert.ok(Object.values(SECTORS).includes(effect.sector), `${card.id} 알 수 없는 섹터`);
        }
      }
    }
  });
});
