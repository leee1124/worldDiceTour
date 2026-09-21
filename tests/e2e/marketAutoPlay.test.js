import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { STARTING_CASH } from '../../src/domain/game/Player.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { MAX_POSITION_PER_INSTRUMENT } from '../../src/domain/market/Holdings.js';
import { DEPOSIT_CAP, DEPOSIT_UNIT } from '../../src/domain/market/DepositAccount.js';
import { PriceProcess } from '../../src/domain/market/PriceProcess.js';
import { CLASS_PARAMS, instrumentSpecById } from '../../src/domain/market/data/instruments.js';
import { createHeadlessApp, playToEnd, startFourComputerGame } from '../support/marketPlay.js';

/** 설계서 §9 합격 기준 11: 10시드 × {OFF, STOCKS} 매트릭스. */
const SEEDS = [1, 7, 42, 99, 123, 2_024, 31_337, 65_535, 777_777, 1_000_003];
/** 템포 가드(설계서 §5.3 (e)). 거래로 판이 늘어지면 안 된다. */
const MAX_COMMANDS_PER_ROUND = 40;

/**
 * 매 커맨드마다 확인하는 불변식(설계서 §5.3 (a)~(d)).
 * 하나라도 깨지면 그 자리에서 멈춰야 한다 — 돈이 새는 채로 진행하는 것이 가장 나쁘다.
 */
function assertInvariants({ room, view, label }) {
  const game = room.game;

  // (a) 돈의 보존
  const report = game.moneyReport();
  assert.equal(report.balanced, true, `${label}: 돈 보존 위반 ${JSON.stringify(report)}`);

  // (b) 은행 순유입 = 사유별 내역의 합
  const breakdownSum = Object.values(report.breakdown).reduce((sum, value) => sum + value, 0);
  assert.equal(breakdownSum, report.netFromBank, `${label}: 사유별 내역 합 불일치`);
  assert.equal(report.breakdownBalanced, true, `${label}: 설명되지 않은 은행 순유입`);

  // (c) 음수 금지: 현금·예금·보유수량·총자산 내역
  for (const player of view.players) {
    assert.ok(player.cash >= 0, `${label}: 현금 음수 ${player.seatId}=${player.cash}`);
    assert.ok(player.depositBalance >= 0, `${label}: 예금 음수 ${player.seatId}`);
    assert.ok(player.stockValue >= 0, `${label}: 주식 평가액 음수 ${player.seatId}`);
    assert.ok(player.depositBalance <= DEPOSIT_CAP, `${label}: 예금 한도 초과 ${player.seatId}`);
    assert.equal(
      player.depositBalance % DEPOSIT_UNIT,
      0,
      `${label}: 예금이 단위의 배수가 아니다 ${player.seatId}`,
    );
    // 총자산 내역의 합이 곧 총자산이다(화면과 순위가 어긋날 수 없다).
    const net = player.netWorth;
    assert.equal(
      net.cash + net.property + net.stock + net.deposit - net.loanDebt,
      net.total,
      `${label}: 총자산 내역 합 불일치 ${player.seatId}`,
    );
    assert.equal(player.totalAssets, net.total, `${label}: totalAssets ≠ netWorth.total`);
  }

  if (!view.market) {
    return;
  }

  // (d) 가격 건강성: 정수·tickUnit 배수·경계 안
  for (const instrument of view.market.instruments) {
    const spec = instrumentSpecById(instrument.id);
    const params = CLASS_PARAMS[spec.klass];
    assert.ok(Number.isSafeInteger(instrument.price), `${label}: 가격이 정수가 아니다 ${instrument.id}`);
    assert.equal(
      instrument.price % params.tickUnit,
      0,
      `${label}: 가격이 단위의 배수가 아니다 ${instrument.id}=${instrument.price}`,
    );
    const min = PriceProcess.minPrice({ basePrice: spec.basePrice, ...params });
    const max = PriceProcess.maxPrice({ basePrice: spec.basePrice, ...params });
    assert.ok(
      instrument.price >= min && instrument.price <= max,
      `${label}: 가격 경계 위반 ${instrument.id}=${instrument.price} (${min}~${max})`,
    );
    assert.ok(instrument.series.length <= 30, `${label}: 이력이 30개를 넘는다 ${instrument.id}`);
  }
  assert.equal(view.market.instruments.length, 5, `${label}: 상장 종목이 5개가 아니다`);

  // 보유 수량 상한과 평가액 정합성
  for (const [seatId, positions] of Object.entries(view.market.holdings)) {
    for (const position of positions) {
      assert.ok(position.qty > 0, `${label}: 보유 수량이 0 이하 ${seatId}/${position.instrumentId}`);
      assert.ok(
        position.qty <= MAX_POSITION_PER_INSTRUMENT,
        `${label}: 보유 상한 초과 ${seatId}/${position.instrumentId}=${position.qty}`,
      );
      assert.ok(position.avgCost >= 0, `${label}: 평단 음수`);
    }
  }

  // 창구 예산은 언제나 범위 안이다
  const budget = view.market.budget;
  assert.ok(budget.ordersLeft >= 0 && budget.ordersLeft <= budget.ordersMax, `${label}: 주문 예산 범위`);
  assert.ok(
    budget.notionalLeft >= 0 && budget.notionalLeft <= budget.notionalMax,
    `${label}: 명목 예산 범위`,
  );
}

/** 한 판을 끝까지 돌리며 불변식을 확인한다. */
async function playMatch({ seed, investmentMode, roundLimit = 30 }) {
  const app = createHeadlessApp(seed);
  const code = await startFourComputerGame(app, { roundLimit, investmentMode });
  const label = `${investmentMode} 시드 ${seed}`;

  const { commands, room, eventCounts } = await playToEnd(app, code, {
    onCommand: ({ commands: count, decision, room: current, view }) => {
      assertInvariants({ room: current, view, label: `${label} (${count}, ${decision.type})` });
    },
  });

  assert.equal(room.game.isOver(), true, `${label}: 커맨드 ${commands}회 안에 끝나지 않았다`);
  assert.equal(room.isFinished(), true, `${label}: 방이 종료 상태가 아니다`);

  // (e) 템포 가드
  const perRound = commands / room.game.round;
  assert.ok(
    perRound <= MAX_COMMANDS_PER_ROUND,
    `${label}: 라운드당 커맨드가 너무 많다 ${perRound.toFixed(1)}`,
  );

  return { commands, room, eventCounts, perRound };
}

describe('E2E: 투자 모드 매트릭스 {OFF, STOCKS} × 10시드', () => {
  /** 상품 커버리지(설계서 §5.3 (f))는 시드 집합 **전체** 기준으로 본다. */
  const stocksCoverage = new Map();

  for (const investmentMode of ['OFF', 'STOCKS']) {
    for (const seed of SEEDS) {
      it(`${investmentMode} 시드 ${seed}: 예외 없이 끝나고 §5.3 불변식이 매 커맨드에서 성립한다`, async () => {
        // Given / When
        const { room, eventCounts, commands } = await playMatch({ seed, investmentMode });

        // Then
        const rankings = room.game.rankings();
        assert.equal(rankings.length, 4);
        assert.deepEqual(
          rankings.map((entry) => entry.rank),
          [1, 2, 3, 4],
        );
        assert.equal(room.game.moneyReport().initialTotal, 4 * STARTING_CASH);
        assert.ok(commands > 20, `너무 적은 커맨드로 끝났다: ${commands}`);

        if (investmentMode === 'STOCKS') {
          for (const [type, count] of eventCounts) {
            stocksCoverage.set(type, (stocksCoverage.get(type) ?? 0) + count);
          }
        } else {
          // (g) OFF 모드에는 시장이 존재하지 않는다.
          assert.equal(room.game.marketView({ actingSeatId: null }), null);
          for (const type of [
            EVENT_TYPES.TRADING_OPENED,
            EVENT_TYPES.ORDER_FILLED,
            EVENT_TYPES.PRICES_UPDATED,
            EVENT_TYPES.NEWS_PUBLISHED,
            EVENT_TYPES.DIVIDEND_PAID,
          ]) {
            assert.equal(eventCounts.get(type) ?? 0, 0, `OFF 모드에서 ${type}이 발생했다`);
          }
        }
      });
    }
  }

  it('(f) 상품 커버리지: 시드 집합 전체에서 주요 흐름이 최소 한 번씩 등장한다', () => {
    // Given (앞의 STOCKS 시드들이 모아 둔 집계)
    // When / Then
    for (const type of [
      EVENT_TYPES.TRADING_OPENED,
      EVENT_TYPES.TRADING_CLOSED,
      EVENT_TYPES.ORDER_FILLED,
      EVENT_TYPES.DIVIDEND_PAID,
      EVENT_TYPES.DEPOSIT_INTEREST_PAID,
      EVENT_TYPES.DEPOSIT_MADE,
      EVENT_TYPES.DEPOSIT_WITHDRAWN,
      EVENT_TYPES.PRICES_UPDATED,
      EVENT_TYPES.NEWS_PUBLISHED,
      EVENT_TYPES.CYCLE_CHANGED,
      EVENT_TYPES.BASE_RATE_CHANGED,
    ]) {
      assert.ok(
        (stocksCoverage.get(type) ?? 0) > 0,
        `${type}이 10시드 전체에서 한 번도 나오지 않았다`,
      );
    }
  });

  it('라운드 틱은 ROUND_ADVANCED 1회당 정확히 1회다(전 시드)', async () => {
    // Given / When
    for (const seed of [1, 42, 2_024]) {
      const app = createHeadlessApp(seed);
      const code = await startFourComputerGame(app, { roundLimit: 30, investmentMode: 'STOCKS' });
      const { eventCounts, room } = await playToEnd(app, code);

      // Then (라운드 제한으로 끝난 전이에서는 틱이 없으므로 뉴스가 한 번 적다)
      const rounds = eventCounts.get(EVENT_TYPES.ROUND_ADVANCED) ?? 0;
      const ticks = eventCounts.get(EVENT_TYPES.PRICES_UPDATED) ?? 0;
      const expected = room.game.isOver() && rounds > 0 ? rounds - 1 : rounds;
      assert.equal(
        ticks,
        expected,
        `시드 ${seed}: ROUND_ADVANCED ${rounds}회에 틱 ${ticks}회`,
      );
      assert.equal(eventCounts.get(EVENT_TYPES.NEWS_PUBLISHED) ?? 0, ticks, '뉴스도 틱당 1장');
    }
  });

  it('라운드 제한이 없어도 파산으로 승자가 가려진다(투자 모드 ON)', async () => {
    // Given / When
    const { room } = await playMatch({
      seed: 20_260_921,
      investmentMode: 'STOCKS',
      roundLimit: null,
    });

    // Then
    assert.equal(room.game.livingPlayers().length, 1);
    assert.equal(room.game.rankings()[0].rank, 1);
  });

  it('성적표 수집이 판 내내 쌓인다(Phase 5가 재작업이 되지 않도록)', async () => {
    // Given / When
    const { room } = await playMatch({ seed: 42, investmentMode: 'STOCKS' });
    const record = room.game.matchRecord;

    // Then
    assert.ok(record.snapshots.length > 10, `라운드 스냅샷이 너무 적다: ${record.snapshots.length}`);
    assert.ok(record.highlights.length > 0, '하이라이트가 하나도 없다');
    assert.ok(record.highlights.length <= 200, '하이라이트 상한을 넘었다');
    assert.ok(Object.keys(record.pnl).length > 0, '사유별 손익이 비었다');
    // 라운드 스냅샷의 총자산 내역도 합이 맞아야 한다.
    for (const snapshot of record.snapshots) {
      for (const player of snapshot.players) {
        assert.equal(
          player.cash + player.property + player.stock + player.deposit - player.loanDebt,
          player.total,
          `라운드 ${snapshot.round} 총자산 내역 합 불일치`,
        );
      }
    }
    // 성적표는 뷰에 실리지 않는다(SSE 페이로드를 키우지 않는다).
    assert.equal(room.game.marketView({ actingSeatId: null }).report, undefined);
  });
});
