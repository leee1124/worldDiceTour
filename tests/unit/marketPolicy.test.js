import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AutoPlayerPolicy } from '../../src/application/AutoPlayerPolicy.js';
import {
  AUTO_CASH_BUFFER,
  AUTO_DEPOSIT_RATE_BP,
  AUTO_DEPOSIT_UNIT,
  AUTO_STOCK_BUDGET,
} from '../../src/application/AutoPlayerPolicy.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { toGameViewDto } from '../../src/application/dto.js';
import { CYCLE_PHASES } from '../../src/domain/market/data/cycle.js';
import { buildStockGame } from '../support/marketGameBuilder.js';

const policy = new AutoPlayerPolicy();

/**
 * 거래 창구 뷰를 손으로 만든다(정책은 공개 뷰만 본다 — 도메인 엔티티에 접근하지 않는다).
 */
function tradeView({
  cash = 3_000_000,
  deposit = 0,
  loanDebt = 0,
  holdings = [],
  cyclePhase = CYCLE_PHASES.RECOVERY,
  baseRateBp = 50,
  ordersLeft = 3,
  notionalLeft = 2_000_000,
  prices = { AIR: 12_000, CON: 8_000, HOT: 15_000, ENT: 6_000, NRG: 20_000 },
  bases = { AIR: 12_000, CON: 8_000, HOT: 15_000, ENT: 6_000, NRG: 20_000 },
  states = {},
} = {}) {
  const budget = {
    seatId: 's1',
    open: true,
    ordersUsed: 3 - ordersLeft,
    ordersLeft,
    ordersMax: 3,
    notionalUsed: 2_000_000 - notionalLeft,
    notionalLeft,
    notionalMax: 2_000_000,
  };
  return {
    phase: PHASES.AWAIT_TRADE,
    isOver: false,
    currentSeatId: 's1',
    actingSeatId: 's1',
    players: [{ seatId: 's1', cash, loanDebt, depositBalance: deposit }],
    board: [],
    pending: { kind: 'TRADE', cash, deposit, afterTrade: 'ROLL', holdings, budget },
    market: {
      cycle: { phase: cyclePhase, label: '', age: 1, driftBp: 0, volMulPct: 100 },
      baseRateBp,
      instruments: Object.entries(prices).map(([id, price]) => ({
        id,
        name: id,
        sector: 'AIRLINE',
        state: states[id] ?? 'LISTED',
        price,
        basePrice: bases[id],
        tickUnit: 100,
        dividendBp: 0,
        series: [price],
        prevPrice: price,
        changeBp: 0,
      })),
      holdings: { s1: holdings },
      deposits: { s1: deposit },
      orderQueue: [],
      budget,
      rules: {
        maxQuantity: 200,
        minQuantity: 1,
        maxNotionalPerOrder: 1_000_000,
        maxPositionPerInstrument: 500,
        depositUnit: 10_000,
        depositCap: 10_000_000,
      },
    },
  };
}

describe('AutoPlayerPolicy: 거래 창구(설계서 §4.6)', () => {
  it('현금 버퍼(1,000,000원) 아래면 아무것도 하지 않고 창구를 닫는다', () => {
    // Given / When / Then
    assert.equal(AUTO_CASH_BUFFER, 1_000_000);
    assert.deepEqual(policy.decide(tradeView({ cash: 999_999 })), {
      type: COMMAND_TYPES.CLOSE_TRADING,
    });
  });

  it('부채가 없고 기준금리가 기준선(125bp) 이상이면 여유현금을 100,000원 단위로 예치한다', () => {
    // Given (현금 3,000,000 − 버퍼 1,000,000 = 2,000,000)
    assert.equal(AUTO_DEPOSIT_RATE_BP, 125);
    assert.equal(AUTO_DEPOSIT_UNIT, 100_000);

    // When
    const decision = policy.decide(tradeView({ cash: 3_050_000, baseRateBp: 125 }));

    // Then
    assert.deepEqual(decision, {
      type: COMMAND_TYPES.DEPOSIT,
      payload: { amount: 2_000_000 },
    });
  });

  it('금리가 낮으면 예금을 전액 인출한다', () => {
    // Given / When
    const decision = policy.decide(tradeView({ cash: 2_000_000, baseRateBp: 50, deposit: 500_000 }));

    // Then
    assert.deepEqual(decision, {
      type: COMMAND_TYPES.WITHDRAW,
      payload: { amount: 500_000 },
    });
  });

  it('대출이 있으면 금리가 높아도 예치하지 않는다(이자가 0이므로)', () => {
    // Given / When
    const decision = policy.decide(
      tradeView({ cash: 3_000_000, baseRateBp: 400, loanDebt: 1_200_000 }),
    );

    // Then
    assert.notEqual(decision.type, COMMAND_TYPES.DEPOSIT);
  });

  it('회복·호황이고 여유현금이 600,000원 이상이면 기준가 대비 가장 싼 종목을 산다', () => {
    // Given (CON이 기준가의 50%로 가장 싸다)
    assert.equal(AUTO_STOCK_BUDGET, 600_000);
    const view = tradeView({
      cash: 2_000_000,
      baseRateBp: 50,
      prices: { AIR: 12_000, CON: 4_000, HOT: 15_000, ENT: 6_000, NRG: 20_000 },
    });

    // When
    const decision = policy.decide(view);

    // Then (600,000 / 4,000 = 150주)
    assert.deepEqual(decision, {
      type: COMMAND_TYPES.BUY_STOCK,
      payload: { instrumentId: 'CON', quantity: 150 },
    });
  });

  it('수량은 200주·1건 명목금액·남은 예산 안으로 잘린다', () => {
    // Given (싼 종목 1,000원 → 600주를 살 수 있지만 200주 상한)
    const capped = policy.decide(
      tradeView({ cash: 2_000_000, prices: { CON: 1_000 }, bases: { CON: 8_000 } }),
    );

    // Then
    assert.equal(capped.payload.quantity, 200);

    // Given (남은 예산이 50,000원뿐이면 4주만)
    const budgeted = policy.decide(
      tradeView({
        cash: 2_000_000,
        notionalLeft: 50_000,
        prices: { CON: 12_000 },
        bases: { CON: 8_000 },
      }),
    );

    // Then
    assert.equal(budgeted.payload.quantity, 4);
  });

  it('같은 비율이면 종목 id 사전순으로 고른다(결정적)', () => {
    // Given (AIR·CON 모두 기준가의 100%)
    const view = tradeView({ cash: 2_000_000, prices: { NRG: 20_000, CON: 8_000, AIR: 12_000 } });

    // When / Then
    assert.equal(policy.decide(view).payload.instrumentId, 'AIR');
  });

  it('상장폐지된 종목은 사지 않는다', () => {
    // Given (가장 싼 CON이 상장폐지)
    const view = tradeView({
      cash: 2_000_000,
      prices: { AIR: 12_000, CON: 1_600 },
      bases: { AIR: 12_000, CON: 8_000 },
      states: { CON: 'DELISTED' },
    });

    // When / Then
    assert.equal(policy.decide(view).payload.instrumentId, 'AIR');
  });

  it('과열·침체에서는 보유 최대 종목의 절반을 팔고, 팔 것이 없으면 창구를 닫는다', () => {
    // Given
    const holding = [
      { instrumentId: 'AIR', qty: 40, avgCost: 12_000, marketValue: 480_000 },
      { instrumentId: 'CON', qty: 10, avgCost: 8_000, marketValue: 80_000 },
    ];

    // When / Then
    for (const cyclePhase of [CYCLE_PHASES.OVERHEAT, CYCLE_PHASES.RECESSION]) {
      assert.deepEqual(
        policy.decide(tradeView({ cyclePhase, holdings: holding, cash: 2_000_000 })),
        { type: COMMAND_TYPES.SELL_STOCK, payload: { instrumentId: 'AIR', quantity: 20 } },
        cyclePhase,
      );
      assert.deepEqual(
        policy.decide(tradeView({ cyclePhase, holdings: [], cash: 2_000_000 })),
        { type: COMMAND_TYPES.CLOSE_TRADING },
        `${cyclePhase} 보유 없음`,
      );
    }
  });

  it('절반이 0주가 되는 잔량은 팔지 않고 창구를 닫는다(무한 분할 방지)', () => {
    // Given
    const view = tradeView({
      cyclePhase: CYCLE_PHASES.RECESSION,
      holdings: [{ instrumentId: 'AIR', qty: 1, avgCost: 12_000, marketValue: 12_000 }],
      cash: 2_000_000,
    });

    // When / Then
    assert.deepEqual(policy.decide(view), { type: COMMAND_TYPES.CLOSE_TRADING });
  });

  it('주문 예산이 없으면 창구를 닫는다', () => {
    // Given / When / Then
    assert.deepEqual(policy.decide(tradeView({ ordersLeft: 0 })), {
      type: COMMAND_TYPES.CLOSE_TRADING,
    });
  });

  it('여유현금이 매수 기준에 못 미치면 창구를 닫는다', () => {
    // Given (현금 1,500,000 − 버퍼 1,000,000 = 500,000 < 600,000)
    // When / Then
    assert.deepEqual(policy.decide(tradeView({ cash: 1_500_000 })), {
      type: COMMAND_TYPES.CLOSE_TRADING,
    });
  });

  it('결정은 언제나 같다(같은 뷰 → 같은 커맨드)', () => {
    // Given
    const view = tradeView({ cash: 2_500_000 });

    // When / Then
    assert.deepEqual(policy.decide(view), policy.decide(view));
  });
});

describe('AutoPlayerPolicy: 실제 게임 뷰로 창구를 끝까지 진행한다', () => {
  it('거래 창구에서 반드시 결정을 내리고 결국 창구가 닫힌다', () => {
    // Given
    const game = buildStockGame();
    let guard = 0;

    // When (정책이 내린 결정을 그대로 실행한다)
    while (game.phase === PHASES.AWAIT_TRADE && guard < 20) {
      const view = toGameViewDto(game);
      const decision = policy.decide(view);
      assert.ok(decision, '거래 창구에서 결정을 내리지 못했다');
      game.execute('s1', decision.type, decision.payload ?? {});
      guard += 1;
    }

    // Then
    assert.notEqual(game.phase, PHASES.AWAIT_TRADE, `창구가 닫히지 않았다(시도 ${guard}회)`);
    assert.ok(guard <= 4, `결정이 너무 많다: ${guard}회`);
  });

  it('정리 페이즈 규칙은 달라지지 않았다(자동매각 → 대출 → 파산)', () => {
    // Given (OFF 모드 동작을 바꾸면 골든 리플레이가 깨진다)
    const decisions = [
      [{ canSell: true, canLoan: true }, COMMAND_TYPES.AUTO_SELL],
      [{ canSell: false, canLoan: true }, COMMAND_TYPES.TAKE_LOAN],
      [{ canSell: false, canLoan: false }, COMMAND_TYPES.DECLARE_BANKRUPTCY],
    ];

    // When / Then
    for (const [pending, expected] of decisions) {
      const view = {
        phase: PHASES.AWAIT_LIQUIDATION,
        isOver: false,
        currentSeatId: 's1',
        players: [{ seatId: 's1', cash: 0 }],
        board: [],
        pending: { kind: 'LIQUIDATION', ...pending },
      };
      assert.deepEqual(policy.decide(view), { type: expected });
    }
  });
});
