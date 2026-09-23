import { Instrument } from './Instrument.js';
import { Market } from './Market.js';
import { NEWS_EFFECT_TARGETS } from './data/news.js';

/** 한 랩(출발 칸 통과 간격)에 해당하는 평균 라운드 수. 4인 판의 실측 근사치다. */
export const ROUNDS_PER_LAP = 5.5;
/** 배당을 지급하는 주기(라운드). 랩 간격의 정수 근사. */
const DIVIDEND_EVERY_ROUNDS = 5;

/**
 * 시장만 돌려 보는 밸런스 시뮬레이터.
 *
 * 보드·플레이어 없이 **가격 엔진만** 돌린다. 보드 연동 압력을 뺀 "순수한 시장"의 기대수익을 재는 것이
 * 목적이므로(오너 밸런스 목표의 기준), 압력은 넣지 않는다.
 *
 * 실제 게임과 **같은 `Market.roundTick()`** 을 쓴다 — 시뮬레이터가 별도의 가격 공식을 복제하면
 * 검증의 의미가 없어지기 때문이다.
 */
export class MarketSimulation {
  /**
   * 한 판을 돌린다.
   * @param {{random: import('../shared/interfaces.js').RandomSource, rounds: number, depositAmount?: number}} params
   * @returns {{
   *   portfolio: {startValue:number, endValue:number, ratio:number, series:number[]},
   *   perInstrument: Record<string, {ratio:number, delisted:boolean, price:number, basePrice:number}>,
   *   dividendRatio: number,
   *   depositInterestRatio: number,
   *   meanBaseRateBp: number,
   * }}
   */
  static run({ random, rounds, depositAmount = 1_000_000 }) {
    const market = Market.create();
    const startPrices = new Map();
    const quantities = new Map();
    // 5종목 동일 비중 매수 후 보유(equal-weight buy & hold). 대체 상장 종목은 사지 않는다.
    const budgetPerName = Math.floor(1_000_000 / market.instrumentIds.length);
    for (const id of market.instrumentIds) {
      const instrument = market.instrumentOf(id);
      startPrices.set(id, instrument.price);
      quantities.set(id, Math.floor(budgetPerName / instrument.price));
    }

    const held = [...startPrices.keys()];
    const series = [];
    const rateSamples = [];
    let dividends = 0;
    let interest = 0;

    for (let round = 2; round <= rounds + 1; round += 1) {
      market.roundTick({ round, random, players: [] });
      rateSamples.push(market.baseRateBp);
      interest += Math.floor((depositAmount * market.baseRateBp) / 10_000);
      if ((round - 1) % DIVIDEND_EVERY_ROUNDS === 0) {
        for (const id of held) {
          const instrument = market.instrumentOf(id);
          dividends += (instrument?.dividendPerShare() ?? 0) * quantities.get(id);
        }
      }
      series.push(valueOf(market, held, quantities));
    }

    const startValue = held.reduce((sum, id) => sum + startPrices.get(id) * quantities.get(id), 0);
    const endValue = series[series.length - 1];
    const perInstrument = {};
    for (const id of held) {
      const instrument = market.instrumentOf(id);
      const base = startPrices.get(id) * quantities.get(id);
      perInstrument[id] = {
        ratio: (instrument?.valueOf(quantities.get(id)) ?? 0) / base,
        delisted: !instrument || !instrument.isListed(),
        price: instrument?.price ?? 0,
        basePrice: instrument?.basePrice ?? startPrices.get(id),
      };
    }

    return {
      portfolio: { startValue, endValue, ratio: endValue / startValue, series },
      perInstrument,
      dividendRatio: dividends / startValue,
      depositInterestRatio: interest / depositAmount,
      meanBaseRateBp: rateSamples.reduce((sum, bp) => sum + bp, 0) / rateSamples.length,
    };
  }

  /**
   * 여러 시드를 돌려 통계를 낸다(오너 밸런스 목표 검증용).
   * @param {{seeds: number[], rounds: number, randomFactory: (seed:number) => object}} params
   */
  static summarize({ seeds, rounds, randomFactory }) {
    const runs = seeds.map((seed) => MarketSimulation.run({ random: randomFactory(seed), rounds }));
    const ratios = runs.map((run) => run.portfolio.ratio);

    const perInstrument = {};
    for (const id of Object.keys(runs[0].perInstrument)) {
      const values = runs.map((run) => run.perInstrument[id].ratio);
      perInstrument[id] = {
        meanReturn: mean(values) - 1,
        medianReturn: median(values) - 1,
        lossRate: values.filter((value) => value < 1).length / values.length,
        delistRate: runs.filter((run) => run.perInstrument[id].delisted).length / runs.length,
        meanPriceOverBase: mean(
          runs.map((run) => run.perInstrument[id].price / run.perInstrument[id].basePrice),
        ),
      };
    }

    // "한 랩이 하락인 확률" — 5라운드 간격 창을 전부 훑는다.
    let negativeWindows = 0;
    let totalWindows = 0;
    for (const run of runs) {
      const series = run.portfolio.series;
      for (let index = 0; index + DIVIDEND_EVERY_ROUNDS < series.length; index += 1) {
        totalWindows += 1;
        if (series[index + DIVIDEND_EVERY_ROUNDS] < series[index]) {
          negativeWindows += 1;
        }
      }
    }

    return {
      seeds: seeds.length,
      rounds,
      portfolio: {
        meanReturn: mean(ratios) - 1,
        medianReturn: median(ratios) - 1,
        lossRate: ratios.filter((ratio) => ratio < 1).length / ratios.length,
        perRoundReturn: mean(ratios) ** (1 / rounds) - 1,
        perLapReturn: mean(ratios) ** (ROUNDS_PER_LAP / rounds) - 1,
        withDividendsMeanReturn: mean(runs.map((run) => run.portfolio.ratio + run.dividendRatio)) - 1,
      },
      lapWindowLossRate: negativeWindows / totalWindows,
      deposit: {
        meanReturn: mean(runs.map((run) => run.depositInterestRatio)),
        minReturn: Math.min(...runs.map((run) => run.depositInterestRatio)),
        maxReturn: Math.max(...runs.map((run) => run.depositInterestRatio)),
        meanBaseRateBp: mean(runs.map((run) => run.meanBaseRateBp)),
      },
      perInstrument,
    };
  }
}

function valueOf(market, ids, quantities) {
  return ids.reduce(
    (sum, id) => sum + (market.instrumentOf(id)?.valueOf(quantities.get(id)) ?? 0),
    0,
  );
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

/** 그 종목(섹터)에 적용되는 뉴스 효과 합계(bp) — 진단 출력용. */
export function newsBpFor(card, sector) {
  let bp = 0;
  for (const effect of card.effects) {
    if (effect.target === NEWS_EFFECT_TARGETS.SECTOR && effect.sector === sector) {
      bp += effect.bp;
    } else if (effect.target === NEWS_EFFECT_TARGETS.ALL) {
      bp += effect.bp;
    }
  }
  return bp;
}

export { Instrument };
