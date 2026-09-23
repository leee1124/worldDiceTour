import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Market } from '../../src/domain/market/Market.js';
import { MarketSimulation, ROUNDS_PER_LAP } from '../../src/domain/market/MarketSimulation.js';
import { SeededRandomSource } from '../../src/infrastructure/SeededRandomSource.js';

/**
 * 밸런스 시뮬레이션(오너 결정 검증).
 *
 * 오너 요구:
 *   "등락은 있어도 장기투자 하면 자산이 꾸준히 오르는 시스템"
 *   "1바퀴 평균 6~7% 상승(물론 떨어질 때도 있어야 함)"
 *
 * 보드 없이 **실제 `Market.roundTick()`** 만 돌린다 — 시뮬레이터가 가격 공식을 복제하면 검증의
 * 의미가 없다. 보드 연동 압력은 넣지 않는다(순수한 시장의 기대수익을 재는 것이 목적).
 *
 * 시드는 고정이므로 이 수치는 **결정적**이다. 값이 달라졌다면 밸런스가 바뀐 것이고,
 * SPEC 12장의 표도 함께 고쳐야 한다.
 */
const SEEDS = Array.from({ length: 300 }, (_unused, index) => (index + 1) * 7_919);
const ROUNDS = 25;

const summary = MarketSimulation.summarize({
  seeds: SEEDS,
  rounds: ROUNDS,
  randomFactory: (seed) => new SeededRandomSource(seed),
});

const percent = (value) => `${(value * 100).toFixed(2)}%`;

describe('밸런스: 분산투자는 장기적으로 오른다(오너 목표)', () => {
  it(`1바퀴(${ROUNDS_PER_LAP}라운드) 평균 수익률이 +6~7%다`, () => {
    // Given / When / Then
    assert.ok(
      summary.portfolio.perLapReturn >= 0.06 && summary.portfolio.perLapReturn <= 0.07,
      `1바퀴 평균 수익률이 목표(6~7%)를 벗어났다: ${percent(summary.portfolio.perLapReturn)}`,
    );
  });

  it('라운드당 평균 수익률이 +0.9%~+1.4%다', () => {
    // Given / When / Then
    assert.ok(
      summary.portfolio.perRoundReturn >= 0.009 && summary.portfolio.perRoundReturn <= 0.014,
      `라운드당 수익률: ${percent(summary.portfolio.perRoundReturn)}`,
    );
  });

  it('25라운드 평균 수익률이 +25%~+45%이고 중앙값도 플러스다', () => {
    // Given / When / Then
    assert.ok(
      summary.portfolio.meanReturn >= 0.25 && summary.portfolio.meanReturn <= 0.45,
      `25라운드 평균 수익률: ${percent(summary.portfolio.meanReturn)}`,
    );
    assert.ok(
      summary.portfolio.medianReturn > 0,
      `중앙값이 0 이하다: ${percent(summary.portfolio.medianReturn)}`,
    );
  });

  it('그래도 도박은 아니다 — 25라운드 손실 확률이 5%~35%다(경기 방어 종목이 섞이면 5%대까지 내려간다)', () => {
    // Given (확실한 것도, 카지노도 아니어야 한다)
    // When / Then
    assert.ok(
      summary.portfolio.lossRate >= 0.05 && summary.portfolio.lossRate <= 0.35,
      `손실 확률: ${percent(summary.portfolio.lossRate)}`,
    );
  });

  it('떨어질 때도 있어야 한다 — 1바퀴 구간이 하락일 확률이 25%~45%다', () => {
    // Given (침체 국면이 분명히 아프게 느껴져야 타이밍이 의미를 갖는다)
    // When / Then
    assert.ok(
      summary.lapWindowLossRate >= 0.25 && summary.lapWindowLossRate <= 0.45,
      `1바퀴 구간 하락 확률: ${percent(summary.lapWindowLossRate)}`,
    );
  });
});

describe('밸런스: 위험자산이 무위험자산보다 기대수익이 높다', () => {
  it('예금 1,000,000원을 25라운드 두면 +10%~+20%다', () => {
    // Given (시작 금리 50bp — 주식 기대수익을 올렸으므로 무위험 자산을 낮춰 균형을 잡았다)
    // When / Then
    assert.ok(
      summary.deposit.meanReturn >= 0.1 && summary.deposit.meanReturn <= 0.2,
      `예금 평균 수익률: ${percent(summary.deposit.meanReturn)}`,
    );
    assert.ok(summary.deposit.minReturn > 0, '예금이 손실이 나는 시드가 있다');
  });

  it('배당까지 더한 주식 기대수익이 예금을 분명히 앞선다(위험 프리미엄)', () => {
    // Given / When / Then
    assert.ok(
      summary.portfolio.withDividendsMeanReturn > summary.deposit.meanReturn * 1.5,
      `주식 ${percent(summary.portfolio.withDividendsMeanReturn)} vs 예금 ${percent(
        summary.deposit.meanReturn,
      )}`,
    );
    assert.ok(
      summary.portfolio.withDividendsMeanReturn > 0.15,
      '배당 포함 기대수익이 너무 낮다',
    );
  });
});

describe('밸런스: 분산투자가 한 종목보다 안전하다(교육 목표)', () => {
  it('모든 개별 종목의 손실 확률이 분산 포트폴리오보다 높다', () => {
    // Given / When / Then
    for (const [id, stats] of Object.entries(summary.perInstrument)) {
      assert.ok(
        stats.lossRate > summary.portfolio.lossRate,
        `${id}의 손실 확률 ${percent(stats.lossRate)}이 분산 ${percent(
          summary.portfolio.lossRate,
        )}보다 낮다`,
      );
    }
  });

  it('변동성이 큰 종목일수록 손실 확률이 높다(ENT > NRG)', () => {
    // Given (ENT는 변동성 1200bp·무배당, NRG는 500bp)
    // When / Then
    assert.ok(
      summary.perInstrument.ENT.lossRate > summary.perInstrument.NRG.lossRate,
      '변동성과 손실 확률의 관계가 뒤집혔다',
    );
  });

  it('25라운드 안에서 상장폐지는 드문 꼬리 사건이다(10% 미만)', () => {
    // Given (오너 목표가 "꾸준히 오른다"이므로 25라운드 안의 상장폐지는 거의 일어나지 않는다.
    //        규칙 자체가 동작한다는 것은 단위 테스트와 아래의 긴 시계열 테스트가 증명한다.)
    // When / Then
    for (const [id, stats] of Object.entries(summary.perInstrument)) {
      assert.ok(stats.delistRate < 0.1, `${id} 상장폐지율이 너무 높다: ${percent(stats.delistRate)}`);
    }
  });

  it('상장폐지 경로는 최악의 시세가 이어지면 실제로 도달한다(규칙이 죽은 코드가 아니다)', () => {
    // Given — 카지노 종목이 경기 방어 종목이 된 뒤로는 무작위 시드로 25~200라운드를 돌려도 상장폐지가
    //        거의 나오지 않는다(400라운드에 2%). 그래서 "우연히 나오길" 기대하는 대신, 매 라운드 최악의
    //        충격만 뽑는 적대적 난수원으로 하한(기준가 20%)에 도달함을 결정적으로 증명한다.
    //        (지분 소각·재상장의 세부 동작은 tests/unit/market.test.js가 단위로 고정한다.)
    const worstCase = { nextInt: (min) => min };
    const market = Market.create();

    // When — 최대 60라운드까지만 돌린다(그 안에 못 닿으면 규칙이 도달 불가능하다는 뜻)
    let delistedAt = null;
    for (let round = 2; round <= 61 && delistedAt === null; round += 1) {
      const { events } = market.roundTick({ round, random: worstCase, players: [] });
      if (events.some((event) => event.type === 'INSTRUMENT_DELISTED')) {
        delistedAt = round;
      }
    }

    // Then
    assert.ok(delistedAt !== null, '최악의 시세가 60라운드 이어져도 상장폐지가 일어나지 않았다');
    assert.ok(
      market.viewModel().instruments.length === 5,
      '상장폐지 뒤에도 예비 종목이 올라와 5종목이 유지되어야 한다',
    );
  });

});

describe('밸런스: 폭주하는 종목이 없다', () => {
  it('어떤 종목도 평균 종가가 기준가의 0.6배~3.0배를 벗어나지 않는다', () => {
    // Given / When / Then
    for (const [id, stats] of Object.entries(summary.perInstrument)) {
      assert.ok(
        stats.meanPriceOverBase >= 0.6 && stats.meanPriceOverBase <= 3.0,
        `${id} 평균 종가/기준가: ${stats.meanPriceOverBase.toFixed(2)}`,
      );
    }
  });

  it('중앙값 기준 1바퀴 수익률도 함께 공표한다(평균만 보면 체감과 어긋난다)', () => {
    // Given (평균은 큰 상승에 끌려 올라간다. 플레이어 절반이 실제로 보는 값은 중앙값 기준이므로
    //        SPEC 12.3 표에 둘 다 싣고, 중앙값도 플러스임을 지킨다)
    const medianPerLap = (1 + summary.portfolio.medianReturn) ** (ROUNDS_PER_LAP / ROUNDS) - 1;

    // When / Then
    assert.ok(medianPerLap > 0.04, `중앙값 기준 1바퀴 수익률이 너무 낮다: ${percent(medianPerLap)}`);
    assert.ok(
      medianPerLap < summary.portfolio.perLapReturn,
      '중앙값이 평균보다 높다면 분포 계산이 잘못됐다',
    );
  });
});

describe('카지노·엔터 종목(무배당 고위험)의 위험 대비 보상', () => {
  // 오너 피드백(2026-09-23): "카지노는 떨어지기만 함? 2,800원까지 떨어지냐 배당도 없는데"
  // 무배당·최고 변동성이라는 성격은 유지하되, 감수할 가치가 있는 위험이어야 한다.
  const ent = summary.perInstrument.ENT;

  it('손실 확률이 30% 아래로 내려온다(이전 34%)', () => {
    // Given / When / Then
    assert.ok(ent.lossRate < 0.3, `ENT 손실 확률 ${percent(ent.lossRate)}`);
  });

  it('무배당의 대가로 평균 가격 수익률이 5종목 평균보다 높다', () => {
    const ids = Object.keys(summary.perInstrument);
    const mean = ids.reduce((sum, id) => sum + summary.perInstrument[id].meanReturn, 0) / ids.length;
    assert.ok(ent.meanReturn > mean, `ENT ${percent(ent.meanReturn)} vs 평균 ${percent(mean)}`);
  });

  it('그래도 단일 종목 몰빵은 분산보다 위험하다(경기 방어 종목이라도 예외 없음)', () => {
    // ENT는 경기 방어 종목이 되어 더는 "최고 위험"이 아니다(그건 AIR). 대신 진폭이 가장 크므로(ENT > NRG는 별도 테스트)
    // 한 종목에 몰아넣는 것은 분산보다 손실 확률이 높아야 한다.
    assert.ok(ent.lossRate > summary.portfolio.lossRate * 2, `ENT ${percent(ent.lossRate)} vs 분산 ${percent(summary.portfolio.lossRate)}`);
  });
});

describe('카지노·엔터 종목은 경기 방어적이다(오너 지적 2026-09-23: "카지노는 원래 불황기에 더 잘되지 않나")', () => {
  // 실제 Market.roundTick()을 돌려 국면별로 각 종목의 라운드 수익률 평균을 잰다.
  // 현실 경제의 사행 산업처럼 "불황을 완전히 거스르진 않지만 다른 업종보다 훨씬 덜 꺾인다"를 고정한다.
  const byPhase = {};
  for (let seed = 1; seed <= 120; seed += 1) {
    const random = new SeededRandomSource(seed * 7_919);
    const market = Market.create();
    const prev = Object.fromEntries(market.viewModel().instruments.map((i) => [i.id, i.price]));
    for (let round = 2; round <= 26; round += 1) {
      market.roundTick({ round, random, players: [] });
      const phase = market.cyclePhase;
      for (const item of market.viewModel().instruments) {
        if (item.state !== 'LISTED' || !(item.id in prev)) {
          prev[item.id] = item.price;
          continue;
        }
        ((byPhase[phase] ??= {})[item.id] ??= []).push(item.price / prev[item.id] - 1);
        prev[item.id] = item.price;
      }
    }
  }
  const meanOf = (phase, id) => {
    const list = byPhase[phase]?.[id] ?? [];
    return list.reduce((sum, value) => sum + value, 0) / Math.max(1, list.length);
  };
  const others = ['AIR', 'CON', 'HOT', 'NRG'];

  it('침체 국면에서 다른 네 종목보다 훨씬 덜 떨어진다(방어)', () => {
    // Given / When / Then
    const ent = meanOf('RECESSION', 'ENT');
    for (const id of others) {
      const other = meanOf('RECESSION', id);
      assert.ok(other < 0, `${id}는 침체에서 떨어져야 한다: ${percent(other)}`);
      assert.ok(ent > other + 0.01, `ENT ${percent(ent)}가 ${id} ${percent(other)}보다 1%p 이상 덜 떨어져야 한다`);
    }
  });

  it('호황 국면에서는 오히려 가장 평범하다(호황엔 다들 여행을 가지 카지노에 몰리지 않는다)', () => {
    const ent = meanOf('EXPANSION', 'ENT');
    const best = Math.max(...others.map((id) => meanOf('EXPANSION', id)));
    assert.ok(ent < best, `호황에서 ENT ${percent(ent)}가 최고 종목 ${percent(best)}보다 낮아야 한다`);
  });
});

describe('밸런스: 긴 판(60라운드)에서도 종목이 바닥이나 천장에 고착되지 않는다', () => {
  // 오너 피드백: 라운드 제한 없는 43라운드 방에서 카지노 종목이 기준가의 33%에 눌러붙었다.
  const long = MarketSimulation.summarize({
    seeds: SEEDS.slice(0, 150),
    rounds: 60,
    randomFactory: (seed) => new SeededRandomSource(seed),
  });

  it('60라운드 상장폐지율이 종목마다 5% 미만이다', () => {
    for (const [id, stats] of Object.entries(long.perInstrument)) {
      assert.ok(stats.delistRate < 0.05, `${id} 60R 상장폐지율 ${percent(stats.delistRate)}`);
    }
  });

  it('60라운드 평균 종가가 기준가의 0.7~2.5배 안에 있다(눌러붙지도 폭주하지도 않는다)', () => {
    for (const [id, stats] of Object.entries(long.perInstrument)) {
      assert.ok(
        stats.meanPriceOverBase >= 0.7 && stats.meanPriceOverBase <= 2.5,
        `${id} 60R 평균 종가/기준가 ${stats.meanPriceOverBase.toFixed(2)}`,
      );
    }
  });
});
