#!/usr/bin/env node
/**
 * 시세 덤프 — 밸런스를 눈으로 확인하는 개발 도구.
 *
 * 게임을 돌리지 않고 **실제 `Market.roundTick()`** 만 돌린다. 시뮬레이터가 가격 공식을 복제하면
 * 보고 있는 숫자가 진짜 게임의 숫자가 아니게 되기 때문이다.
 *
 * 쓰는 법:
 *   node scripts/dumpMarket.js                      한 시드의 라운드별 표
 *   node scripts/dumpMarket.js --seed 42 --rounds 30
 *   node scripts/dumpMarket.js --summary --seeds 300  여러 시드 통계(SPEC 12장 표의 출처)
 *
 * 이 스크립트는 파일을 쓰지 않고 표준출력만 쓴다.
 */
import { Market } from '../src/domain/market/Market.js';
import { MarketSimulation, ROUNDS_PER_LAP } from '../src/domain/market/MarketSimulation.js';
import { SeededRandomSource } from '../src/infrastructure/SeededRandomSource.js';
import { CYCLE_PARAMS, DESIGN_DRIFT_BP, DRIFT_TUNING_BP } from '../src/domain/market/data/cycle.js';
import { INITIAL_BASE_RATE_BP } from '../src/domain/market/BaseRate.js';

const options = parseArgs(process.argv.slice(2));

if (options.summary) {
  printSummary(options);
} else {
  printTimeline(options);
}

/** 라운드별 시세·국면·뉴스 표. */
function printTimeline({ seed, rounds }) {
  const market = Market.create();
  const random = new SeededRandomSource(seed);
  const ids = market.instrumentIds;

  console.log(`\n시드 ${seed} · ${rounds}라운드 · 시작 금리 ${INITIAL_BASE_RATE_BP}bp`);
  console.log(
    `국면별 추세(bp): ${Object.entries(CYCLE_PARAMS)
      .map(([phase, params]) => `${params.label} ${signed(params.driftBp)}`)
      .join(' / ')}  (설계서 원안 + 균일 ${signed(DRIFT_TUNING_BP)})\n`,
  );

  const header = ['R', '국면', '금리', ...ids.map((id) => id.padStart(7)), '뉴스'];
  console.log(header.join(' | '));
  console.log('-'.repeat(header.join(' | ').length + 20));
  console.log(
    ['1', '회복'.padEnd(4), `${String(market.baseRateBp).padStart(3)}bp`, ...ids.map((id) => money(market.instrumentOf(id).price)), '(시작)'].join(' | '),
  );

  for (let round = 2; round <= rounds + 1; round += 1) {
    const { events } = market.roundTick({ round, random, players: [] });
    const news = events.find((event) => event.type === 'NEWS_PUBLISHED');
    const delisted = events
      .filter((event) => event.type === 'INSTRUMENT_DELISTED')
      .map((event) => `⚠${event.payload.instrumentId} 상장폐지`);
    const listed = events
      .filter((event) => event.type === 'INSTRUMENT_LISTED')
      .map((event) => `✨${event.payload.instrumentId} 신규상장`);

    const current = market.instrumentIds;
    console.log(
      [
        String(round).padStart(2),
        market.viewModel({ seatIds: [] }).cycle.label.padEnd(4),
        `${String(market.baseRateBp).padStart(3)}bp`,
        ...ids.map((id) =>
          current.includes(id) ? money(market.instrumentOf(id).price) : '      –',
        ),
        [news?.payload.headline ?? '', ...delisted, ...listed].filter(Boolean).join(' '),
      ].join(' | '),
    );
  }

  console.log('\n종가 / 기준가');
  for (const id of market.instrumentIds) {
    const instrument = market.instrumentOf(id);
    const ratio = instrument.price / instrument.basePrice;
    console.log(
      `  ${id.padEnd(5)} ${instrument.name.padEnd(10)} ${money(instrument.price)} / ${money(
        instrument.basePrice,
      )} = ${ratio.toFixed(2)}배${instrument.isListed() ? '' : ' (상장폐지)'}`,
    );
  }
  console.log('');
}

/** 여러 시드 통계(오너 밸런스 목표 확인). */
function printSummary({ seeds, rounds }) {
  const seedList = Array.from({ length: seeds }, (_unused, index) => (index + 1) * 7_919);
  const summary = MarketSimulation.summarize({
    seeds: seedList,
    rounds,
    randomFactory: (seed) => new SeededRandomSource(seed),
  });

  console.log(`\n밸런스 요약 — 시드 ${summary.seeds}개 × ${summary.rounds}라운드 (보드 압력 제외)`);
  console.log(`국면별 추세 = 설계서 원안 ${JSON.stringify(DESIGN_DRIFT_BP)} + 균일 ${signed(DRIFT_TUNING_BP)}bp\n`);

  console.log('분산 포트폴리오(5종목 동일 비중 매수 후 보유)');
  row('평균 수익률', percent(summary.portfolio.meanReturn));
  row('중앙값', percent(summary.portfolio.medianReturn));
  row(`1바퀴(${ROUNDS_PER_LAP}R) 평균`, percent(summary.portfolio.perLapReturn), '목표 +6~7%');
  row('라운드당 평균', percent(summary.portfolio.perRoundReturn), '목표 +0.9~1.4%');
  row('손실 확률', percent(summary.portfolio.lossRate), '목표 10~35%');
  row('1바퀴 구간 하락 확률', percent(summary.lapWindowLossRate), '목표 25~45%');
  row('배당 포함 평균', percent(summary.portfolio.withDividendsMeanReturn));

  console.log('\n예금 1,000,000원');
  row('평균 이자 수익', percent(summary.deposit.meanReturn), '목표 +10~20%');
  row('최소 / 최대', `${percent(summary.deposit.minReturn)} / ${percent(summary.deposit.maxReturn)}`);
  row('평균 기준금리', `${summary.deposit.meanBaseRateBp.toFixed(1)}bp`);

  console.log('\n종목별');
  console.log(
    `  ${'종목'.padEnd(6)}${'평균'.padStart(9)}${'중앙값'.padStart(10)}${'손실확률'.padStart(11)}${'상장폐지'.padStart(11)}${'종가/기준가'.padStart(13)}`,
  );
  for (const [id, stats] of Object.entries(summary.perInstrument)) {
    console.log(
      `  ${id.padEnd(6)}${percent(stats.meanReturn).padStart(9)}${percent(stats.medianReturn).padStart(10)}${percent(
        stats.lossRate,
      ).padStart(11)}${percent(stats.delistRate).padStart(11)}${`${stats.meanPriceOverBase.toFixed(2)}배`.padStart(13)}`,
    );
  }
  console.log('');
}

function row(label, value, note = '') {
  console.log(`  ${label.padEnd(22)} ${value.padStart(9)}${note ? `   (${note})` : ''}`);
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function signed(bp) {
  return `${bp > 0 ? '+' : ''}${bp}`;
}

function money(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',').padStart(7);
}

function parseArgs(argv) {
  const parsed = { seed: 1, rounds: 25, summary: false, seeds: 300 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--summary') {
      parsed.summary = true;
    } else if (arg === '--seed') {
      parsed.seed = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--rounds') {
      parsed.rounds = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--seeds') {
      parsed.seeds = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        '사용법: node scripts/dumpMarket.js [--seed N] [--rounds N] [--summary [--seeds N]]',
      );
      process.exit(0);
    }
  }
  if (!Number.isInteger(parsed.seed) || !Number.isInteger(parsed.rounds) || parsed.rounds < 1) {
    console.error('seed와 rounds는 정수여야 합니다.');
    process.exit(1);
  }
  return parsed;
}
