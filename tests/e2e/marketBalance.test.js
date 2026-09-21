import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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

  it('그래도 도박은 아니다 — 25라운드 손실 확률이 10%~35%다', () => {
    // Given (확실한 것도, 카지노도 아니어야 한다)
    // When / Then
    assert.ok(
      summary.portfolio.lossRate >= 0.1 && summary.portfolio.lossRate <= 0.35,
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

  it('상장폐지·재상장 경로는 긴 시계열에서 실제로 도달한다', () => {
    // Given (100라운드까지 늘리면 꼬리가 실현된다 — 규칙이 죽은 코드가 아님을 증명한다)
    const long = MarketSimulation.summarize({
      seeds: SEEDS.slice(0, 200),
      rounds: 100,
      randomFactory: (seed) => new SeededRandomSource(seed),
    });

    // When
    const anyDelisted = Object.values(long.perInstrument).some((stats) => stats.delistRate > 0);

    // Then
    assert.ok(anyDelisted, '긴 시계열에서도 상장폐지가 한 번도 일어나지 않았다');
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

  it('시뮬레이션 요약을 사람이 읽을 수 있게 남긴다(SPEC 12장 표의 출처)', () => {
    // Given / When
    const lines = [
      `시드 ${summary.seeds}개 × ${summary.rounds}라운드`,
      `포트폴리오: 평균 ${percent(summary.portfolio.meanReturn)} / 중앙값 ${percent(
        summary.portfolio.medianReturn,
      )} / 1바퀴 ${percent(summary.portfolio.perLapReturn)} / 손실확률 ${percent(
        summary.portfolio.lossRate,
      )}`,
      `배당 포함: ${percent(summary.portfolio.withDividendsMeanReturn)}`,
      `1바퀴 구간 하락 확률: ${percent(summary.lapWindowLossRate)}`,
      `예금: ${percent(summary.deposit.meanReturn)} (평균 금리 ${summary.deposit.meanBaseRateBp.toFixed(1)}bp)`,
    ];

    // Then (값이 계산됐는지만 확인한다 — 기댓값은 위의 테스트들이 지킨다)
    assert.equal(lines.length, 5);
    assert.ok(lines.every((line) => line.length > 0));
  });
});
