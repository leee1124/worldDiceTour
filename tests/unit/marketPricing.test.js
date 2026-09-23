import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BaseRate, BASE_RATE_MAX_BP, BASE_RATE_MIN_BP, INITIAL_BASE_RATE_BP } from '../../src/domain/market/BaseRate.js';
import { BusinessCycle } from '../../src/domain/market/BusinessCycle.js';
import { Instrument } from '../../src/domain/market/Instrument.js';
import { NewsDeck } from '../../src/domain/market/NewsDeck.js';
import { MAX_SERIES_LENGTH, PriceSeries } from '../../src/domain/market/PriceSeries.js';
import { MAX_NUDGE_BP, MAX_TICK_BP, PriceProcess } from '../../src/domain/market/PriceProcess.js';
import {
  CYCLE_PARAMS,
  CYCLE_PHASES,
  INITIAL_CYCLE_PHASE,
  MIN_PHASE_AGE,
} from '../../src/domain/market/data/cycle.js';
import { newsCardsOfPhase } from '../../src/domain/market/data/news.js';
import {
  CLASS_PARAMS,
  INSTRUMENT_CLASSES,
  INSTRUMENT_STATES,
  LISTED_INSTRUMENTS,
  instrumentSpecById,
} from '../../src/domain/market/data/instruments.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';

const STOCK_PARAMS = CLASS_PARAMS[INSTRUMENT_CLASSES.STOCK];

describe('PriceSeries(가격 이력 VO)', () => {
  it('최근 30개만 유지한다(라운드 제한 최대값)', () => {
    // Given
    let series = new PriceSeries([1_000]);

    // When
    for (let index = 0; index < 50; index += 1) {
      series = series.append(2_000 + index);
    }

    // Then
    assert.equal(MAX_SERIES_LENGTH, 30);
    assert.equal(series.values.length, 30);
    assert.equal(series.latest, 2_049);
    assert.equal(series.values[0], 2_020, '가장 오래된 값부터 밀려난다');
  });

  it('직전 가격은 끝에서 두 번째이며 값이 하나뿐이면 자기 자신이다', () => {
    // Given / When / Then
    assert.equal(new PriceSeries([500]).previous, 500);
    assert.equal(new PriceSeries([500, 700]).previous, 500);
    assert.equal(new PriceSeries([500, 700, 900]).previous, 700);
  });

  it('값 배열은 사본이라 밖에서 바꿀 수 없다', () => {
    // Given
    const series = new PriceSeries([100, 200]);

    // When
    series.values.push(999);

    // Then
    assert.deepEqual(series.values, [100, 200]);
  });

  it('비어 있거나 정수가 아닌 이력은 거부한다', () => {
    // Given / When / Then
    assert.throws(() => new PriceSeries([]), { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT });
    assert.throws(() => new PriceSeries([1.5]), { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT });
    assert.throws(() => new PriceSeries([-100]), { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT });
    assert.throws(() => new PriceSeries('x'), { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT });
  });
});

describe('PriceProcess(틱 규칙 — 순수 함수, 설계서 §2.1)', () => {
  it('변동폭은 국면 배수를 곱해 내림한다', () => {
    // Given / When / Then
    assert.equal(PriceProcess.volBp({ baseVolBp: 700, volMulPct: 100 }), 700);
    assert.equal(PriceProcess.volBp({ baseVolBp: 700, volMulPct: 140 }), 980);
    assert.equal(PriceProcess.volBp({ baseVolBp: 1_200, volMulPct: 80 }), 960);
    assert.equal(PriceProcess.volBp({ baseVolBp: 501, volMulPct: 130 }), 651, '내림');
  });

  it('충격은 RandomSource.nextInt(-volBp, +volBp) 한 번만 쓴다', () => {
    // Given
    const random = new FakeRandomSource([-700]);

    // When
    const shockBp = PriceProcess.shockBp({ baseVolBp: 700, volMulPct: 100, random });

    // Then
    assert.equal(shockBp, -700);
    assert.equal(random.remaining, 0, '난수를 한 번만 써야 한다');
  });

  it('보드 압력은 ±600bp로, 합산 변화는 ±4000bp로 묶인다', () => {
    // Given / When / Then
    assert.equal(MAX_NUDGE_BP, 600);
    assert.equal(MAX_TICK_BP, 4_000);
    assert.equal(PriceProcess.nudgeBp(5_000), 600);
    assert.equal(PriceProcess.nudgeBp(-5_000), -600);
    assert.equal(PriceProcess.nudgeBp(300), 300);
    assert.equal(
      PriceProcess.tickBp({ driftBp: 3_000, newsBp: 3_000, nudgeBp: 600, shockBp: 1_000 }),
      4_000,
    );
    assert.equal(
      PriceProcess.tickBp({ driftBp: -3_000, newsBp: -3_000, nudgeBp: -600, shockBp: -1_000 }),
      -4_000,
    );
    assert.equal(PriceProcess.tickBp({ driftBp: 150, newsBp: 600, nudgeBp: 0, shockBp: -200 }), 550);
  });

  it('다음 가격은 tickUnit 단위로 반올림(half-up)한다', () => {
    // Given (12,000원 × +5.5% = 12,660원 → 100원 단위 그대로)
    // When / Then
    assert.equal(
      PriceProcess.nextPrice({ price: 12_000, basePrice: 12_000, tickBp: 550, ...STOCK_PARAMS }),
      12_700,
      '12,660 → 12,700 (half-up)',
    );
    assert.equal(
      PriceProcess.nextPrice({ price: 12_000, basePrice: 12_000, tickBp: 40, ...STOCK_PARAMS }),
      12_000,
      '12,048 → 12,000 (내림)',
    );
    assert.equal(
      PriceProcess.nextPrice({ price: 12_000, basePrice: 12_000, tickBp: 42, ...STOCK_PARAMS }),
      12_100,
      '12,050 → 12,100 (정확히 절반은 올림)',
    );
  });

  it('가격은 기준가의 minPct~maxPct 안에 묶이고 경계도 tickUnit 배수다', () => {
    // Given (기준가 12,000 → 하한 2,400 / 상한 48,000)
    // When / Then
    assert.equal(PriceProcess.minPrice({ basePrice: 12_000, ...STOCK_PARAMS }), 2_400);
    assert.equal(PriceProcess.maxPrice({ basePrice: 12_000, ...STOCK_PARAMS }), 48_000);
    assert.equal(
      PriceProcess.nextPrice({ price: 47_000, basePrice: 12_000, tickBp: 4_000, ...STOCK_PARAMS }),
      48_000,
      '상한에서 멈춘다',
    );
    assert.equal(
      PriceProcess.nextPrice({ price: 3_000, basePrice: 12_000, tickBp: -4_000, ...STOCK_PARAMS }),
      2_400,
      '하한에서 멈춘다',
    );
  });

  it('상장폐지 임계는 기준가의 delistPct 이하다', () => {
    // Given / When / Then
    assert.equal(PriceProcess.delistPrice({ basePrice: 12_000, ...STOCK_PARAMS }), 2_400);
    assert.equal(PriceProcess.isDelisted({ price: 2_400, basePrice: 12_000, ...STOCK_PARAMS }), true);
    assert.equal(PriceProcess.isDelisted({ price: 2_500, basePrice: 12_000, ...STOCK_PARAMS }), false);
  });

  it('속성: 무작위 10,000틱에서 가격은 언제나 정수·tickUnit 배수·경계 안이다', () => {
    // Given
    const random = new SeededRandomSource(20_260_922);
    const specs = LISTED_INSTRUMENTS;
    let ticks = 0;

    // When
    for (const spec of specs) {
      const params = CLASS_PARAMS[spec.klass];
      const min = PriceProcess.minPrice({ basePrice: spec.basePrice, ...params });
      const max = PriceProcess.maxPrice({ basePrice: spec.basePrice, ...params });
      let price = spec.basePrice;
      for (let index = 0; index < 2_000; index += 1) {
        // 모든 국면·압력 조합을 골고루 섞는다.
        const phase = Object.values(CYCLE_PHASES)[index % 4];
        const { driftBp, volMulPct } = CYCLE_PARAMS[phase];
        const newsBp = random.nextInt(-1_500, 1_500);
        const nudgeBp = PriceProcess.nudgeBp(random.nextInt(-1_000, 1_000));
        const shockBp = PriceProcess.shockBp({ baseVolBp: spec.baseVolBp, volMulPct, random });
        const tickBp = PriceProcess.tickBp({ driftBp, newsBp, nudgeBp, shockBp });

        assert.ok(Math.abs(tickBp) <= MAX_TICK_BP, `tickBp 범위 위반: ${tickBp}`);
        price = PriceProcess.nextPrice({ price, basePrice: spec.basePrice, tickBp, ...params });
        ticks += 1;

        assert.ok(Number.isSafeInteger(price), `정수가 아니다: ${price}`);
        assert.equal(price % params.tickUnit, 0, `단위 배수가 아니다: ${price}`);
        assert.ok(price >= min && price <= max, `경계 위반: ${price} (${min}~${max})`);

        // 하한(= 상장폐지 임계)에 닿으면 새 종목으로 갈아타 계속 흔든다.
        if (PriceProcess.isDelisted({ price, basePrice: spec.basePrice, ...params })) {
          price = spec.basePrice;
        }
      }
    }

    // Then
    assert.equal(ticks, 10_000);
  });
});

describe('Instrument(상품 엔티티)', () => {
  const air = () => Instrument.fromSpec(instrumentSpecById('AIR'));

  it('규격에서 만들면 기준가로 상장 상태로 시작한다', () => {
    // Given / When
    const instrument = air();

    // Then
    assert.equal(instrument.id, 'AIR');
    assert.equal(instrument.name, '한빛항공');
    assert.equal(instrument.klass, INSTRUMENT_CLASSES.STOCK);
    assert.equal(instrument.state, INSTRUMENT_STATES.LISTED);
    assert.equal(instrument.price, 12_000);
    assert.equal(instrument.basePrice, 12_000);
    assert.equal(instrument.tickUnit, 100);
    assert.equal(instrument.dividendBp, 150);
    assert.deepEqual(instrument.series, [12_000]);
    assert.equal(instrument.isListed(), true);
  });

  it('틱은 가격을 옮기고 이력에 쌓으며 등락률을 알려준다', () => {
    // Given (충격 0 → drift + news만)
    const instrument = air();
    const random = new FakeRandomSource([0]);

    // When
    const result = instrument.tick({ driftBp: 200, newsBp: 600, nudgeBp: 0, volMulPct: 100, random });

    // Then (12,000 × 1.084 = 13,008 → 13,000)
    assert.equal(result.from, 12_000);
    assert.equal(result.to, 13_000);
    assert.equal(result.delisted, false);
    assert.equal(instrument.price, 13_000);
    assert.equal(instrument.prevPrice, 12_000);
    assert.equal(instrument.changeBp, 833, '(13000-12000)/12000 = 8.33%');
    assert.deepEqual(instrument.series, [12_000, 13_000]);
  });

  it('등락률은 0으로 자른 나눗셈이라 하락도 부호만 다르다', () => {
    // Given
    const instrument = Instrument.restore({ id: 'ENT', price: 5_300, state: 'LISTED', series: [5_800, 5_300] });

    // When / Then
    assert.equal(instrument.changeBp, -862, '(5300-5800)/5800 = -8.62%');
  });

  it('하한까지 떨어지면 상장폐지되고 더 이상 틱이 돌지 않는다', () => {
    // Given (하한 2,400 바로 위에서 큰 하락)
    const instrument = Instrument.restore({ id: 'AIR', price: 2_500, state: 'LISTED', series: [2_500] });
    const random = new FakeRandomSource([-700]);

    // When
    const result = instrument.tick({ driftBp: -150, newsBp: -1_000, nudgeBp: -600, volMulPct: 100, random });

    // Then
    assert.equal(result.delisted, true);
    assert.equal(instrument.state, INSTRUMENT_STATES.DELISTED);
    assert.equal(instrument.isListed(), false);

    // When (상장폐지된 종목에 다시 틱을 돌려도 아무 일도 없다)
    const again = instrument.tick({ driftBp: 4_000, newsBp: 0, nudgeBp: 0, volMulPct: 100, random: new FakeRandomSource() });

    // Then
    assert.equal(again, null);
    assert.equal(instrument.state, INSTRUMENT_STATES.DELISTED);
  });

  it('1주 배당은 현재가 × 배당률 내림이고 상장폐지·무배당이면 0이다', () => {
    // Given / When / Then
    assert.equal(air().dividendPerShare(), 180, 'floor(12000 × 150 / 10000)');
    assert.equal(
      Instrument.restore({ id: 'AIR', price: 12_800, state: 'LISTED', series: [12_800] }).dividendPerShare(),
      192,
    );
    assert.equal(
      Instrument.fromSpec(instrumentSpecById('ENT')).dividendPerShare(),
      0,
      '무배당 종목',
    );
    assert.equal(
      Instrument.restore({ id: 'AIR', price: 12_000, state: 'DELISTED', series: [12_000] }).dividendPerShare(),
      0,
      '상장폐지 종목은 배당 없음',
    );
  });

  it('평가액은 상장 종목만 매긴다(상장폐지는 휴지조각)', () => {
    // Given / When / Then
    assert.equal(air().valueOf(10), 120_000);
    assert.equal(
      Instrument.restore({ id: 'AIR', price: 12_000, state: 'DELISTED', series: [12_000] }).valueOf(10),
      0,
    );
  });

  it('스냅샷을 왕복해도 같은 상태다', () => {
    // Given
    const instrument = air();
    instrument.tick({ driftBp: 200, newsBp: 0, nudgeBp: 0, volMulPct: 100, random: new FakeRandomSource([0]) });

    // When
    const restored = Instrument.restore(instrument.toSnapshot());

    // Then
    assert.deepEqual(restored.toSnapshot(), instrument.toSnapshot());
    assert.equal(restored.name, '한빛항공', '이름은 데이터 표에서 되살린다(스냅샷에 담지 않는다)');
  });

  it('알 수 없는 종목 id는 거부한다(손상 스냅샷 방어)', () => {
    // Given / When / Then
    assert.throws(() => Instrument.restore({ id: 'NOPE', price: 100, state: 'LISTED', series: [100] }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });
});

describe('BusinessCycle(경기 국면 상태기계)', () => {
  it('판은 회복 국면 1년차에서 시작한다', () => {
    // Given / When
    const cycle = new BusinessCycle();

    // Then
    assert.equal(cycle.phase, INITIAL_CYCLE_PHASE);
    assert.equal(cycle.age, 1);
    assert.equal(cycle.driftBp, CYCLE_PARAMS[INITIAL_CYCLE_PHASE].driftBp);
    assert.equal(cycle.volMulPct, CYCLE_PARAMS[INITIAL_CYCLE_PHASE].volMulPct);
  });

  it('최소 체류 라운드(2) 전에는 난수를 쓰지 않고 나이만 올린다', () => {
    // Given
    const cycle = new BusinessCycle({ phase: CYCLE_PHASES.EXPANSION, age: 1 });
    const random = new FakeRandomSource();

    // When
    const result = cycle.advance(random);

    // Then
    assert.equal(MIN_PHASE_AGE, 2);
    assert.equal(result.changed, false);
    assert.equal(cycle.age, 2);
    assert.equal(cycle.phase, CYCLE_PHASES.EXPANSION);
    assert.equal(random.remaining, 0, '난수를 쓰지 않아야 한다');
  });

  it('나이가 찼고 주사위가 확률 안이면 다음 국면으로 넘어간다(경계값 포함)', () => {
    // Given (호황 전이 확률 35 → 35는 전이, 36은 유지)
    const atEdge = new BusinessCycle({ phase: CYCLE_PHASES.EXPANSION, age: 2 });
    const overEdge = new BusinessCycle({ phase: CYCLE_PHASES.EXPANSION, age: 9 });

    // When
    const changed = atEdge.advance(new FakeRandomSource([35]));
    const stayed = overEdge.advance(new FakeRandomSource([36]));

    // Then
    assert.deepEqual(changed, { changed: true, from: CYCLE_PHASES.EXPANSION, to: CYCLE_PHASES.OVERHEAT });
    assert.equal(atEdge.phase, CYCLE_PHASES.OVERHEAT);
    assert.equal(atEdge.age, 1, '새 국면은 1년차부터');

    assert.equal(stayed.changed, false);
    assert.equal(overEdge.phase, CYCLE_PHASES.EXPANSION);
    assert.equal(overEdge.age, 10);
  });

  it('국면은 호황 → 과열 → 침체 → 회복 → 호황으로 순환한다', () => {
    // Given
    const cycle = new BusinessCycle({ phase: CYCLE_PHASES.EXPANSION, age: 2 });
    const seen = [];

    // When
    for (let index = 0; index < 4; index += 1) {
      cycle.advance(new FakeRandomSource([1]));
      cycle.advance(new FakeRandomSource()); // age 1 → 2 (난수 없음)
      seen.push(cycle.phase);
    }

    // Then
    assert.deepEqual(seen, [
      CYCLE_PHASES.OVERHEAT,
      CYCLE_PHASES.RECESSION,
      CYCLE_PHASES.RECOVERY,
      CYCLE_PHASES.EXPANSION,
    ]);
  });

  it('스냅샷을 왕복해도 같고 손상된 국면은 거부한다', () => {
    // Given
    const cycle = new BusinessCycle({ phase: CYCLE_PHASES.RECESSION, age: 3 });

    // When / Then
    assert.deepEqual(cycle.toSnapshot(), { phase: 'RECESSION', age: 3 });
    assert.deepEqual(new BusinessCycle(cycle.toSnapshot()).toSnapshot(), cycle.toSnapshot());
    assert.throws(() => new BusinessCycle({ phase: 'BOOM', age: 1 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.throws(() => new BusinessCycle({ phase: CYCLE_PHASES.EXPANSION, age: 0 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });
});

describe('BaseRate(기준금리 VO)', () => {
  it('시작 금리는 50bp이고 범위는 25~400bp다', () => {
    // Given / When / Then
    assert.equal(INITIAL_BASE_RATE_BP, 50);
    assert.equal(BASE_RATE_MIN_BP, 25);
    assert.equal(BASE_RATE_MAX_BP, 400);
    assert.equal(new BaseRate().bp, 50);
  });

  it('변화는 범위 안에서 묶인다', () => {
    // Given / When / Then
    assert.equal(new BaseRate(100).shift(25).bp, 125);
    assert.equal(new BaseRate(50).shift(-50).bp, BASE_RATE_MIN_BP, '하한에서 멈춘다');
    assert.equal(new BaseRate(380).shift(50).bp, BASE_RATE_MAX_BP, '상한에서 멈춘다');
    assert.equal(new BaseRate(100).shift(0).bp, 100);
  });

  it('생성 시에도 범위를 벗어난 값은 묶고 정수가 아니면 거부한다', () => {
    // Given / When / Then
    assert.equal(new BaseRate(1).bp, BASE_RATE_MIN_BP);
    assert.equal(new BaseRate(10_000).bp, BASE_RATE_MAX_BP);
    assert.throws(() => new BaseRate(1.5), { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT });
    assert.throws(() => new BaseRate(Number.NaN), { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT });
  });

  it('이자는 이자 대상 금액 × 금리 내림이다', () => {
    // Given / When / Then
    assert.equal(new BaseRate(50).interestOn(1_000_000), 5_000);
    assert.equal(new BaseRate(125).interestOn(500_000), 6_250);
    assert.equal(new BaseRate(25).interestOn(3_999), 9, 'floor(3999 × 25 / 10000) = 9');
    assert.equal(new BaseRate(400).interestOn(0), 0);
  });
});

describe('NewsDeck(국면별 비복원 추출)', () => {
  it('국면의 6장 안에서만 뽑는다', () => {
    // Given
    const deck = new NewsDeck();
    const random = new SeededRandomSource(7);
    const allowed = new Set(newsCardsOfPhase(CYCLE_PHASES.RECESSION).map((card) => card.id));

    // When / Then
    for (let index = 0; index < 20; index += 1) {
      const card = deck.draw(CYCLE_PHASES.RECESSION, random);
      assert.ok(allowed.has(card.id), `침체 덱에 없는 카드가 나왔다: ${card.id}`);
      assert.equal(card.phase, CYCLE_PHASES.RECESSION);
    }
  });

  it('6장을 다 쓰기 전에는 같은 카드가 두 번 나오지 않고, 소진되면 다시 채운다', () => {
    // Given
    const deck = new NewsDeck();
    const random = new SeededRandomSource(11);

    // When
    const first = Array.from({ length: 6 }, () => deck.draw(CYCLE_PHASES.EXPANSION, random).id);
    const second = Array.from({ length: 6 }, () => deck.draw(CYCLE_PHASES.EXPANSION, random).id);

    // Then
    assert.equal(new Set(first).size, 6, '한 바퀴 안에서 중복이 나왔다');
    assert.equal(new Set(second).size, 6, '리셔플 후에도 한 바퀴는 비복원이다');
  });

  it('국면별 덱이 서로 독립이다(한 국면을 소진해도 다른 국면 덱은 그대로)', () => {
    // Given
    const deck = new NewsDeck();
    const random = new SeededRandomSource(3);

    // When
    for (let index = 0; index < 4; index += 1) {
      deck.draw(CYCLE_PHASES.EXPANSION, random);
    }
    const snapshot = deck.toSnapshot();

    // Then
    assert.equal(snapshot.piles.EXPANSION.length, 2);
    assert.equal(snapshot.piles.OVERHEAT, undefined, '아직 뽑지 않은 국면은 비어 있다');
    assert.equal(deck.draw(CYCLE_PHASES.OVERHEAT, random).phase, CYCLE_PHASES.OVERHEAT);
  });

  it('스냅샷을 왕복해도 남은 카드가 같고, 알 수 없는 id는 버린다(스키마 방어)', () => {
    // Given
    const deck = new NewsDeck({ piles: { EXPANSION: ['NE1', 'NOPE', 'NE3'] } });

    // When
    const restored = new NewsDeck(deck.toSnapshot());

    // Then
    assert.deepEqual(restored.toSnapshot().piles.EXPANSION, ['NE1', 'NE3']);
  });

  it('난수를 정확히 한 번만 쓴다(리셔플이 일어나도)', () => {
    // Given
    const deck = new NewsDeck({ piles: { RECOVERY: [] } });
    const random = new FakeRandomSource([5]);

    // When
    const card = deck.draw(CYCLE_PHASES.RECOVERY, random);

    // Then
    assert.equal(card.id, 'NV6', '빈 덱을 6장으로 채운 뒤 마지막 카드를 뽑았다');
    assert.equal(random.remaining, 0);
  });
});
