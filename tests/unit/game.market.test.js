import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../../src/domain/game/Game.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { STARTING_CASH } from '../../src/domain/game/Player.js';
import { TRADING_CLOSE_REASONS } from '../../src/domain/market/events.js';
import { ORDER_KINDS } from '../../src/domain/market/OrderQueue.js';
import { REJECT_REASONS } from '../../src/domain/market/rejectReasons.js';
import { SECTORS } from '../../src/domain/market/data/instruments.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';
import { MONEY_REASONS } from '../../src/domain/shared/MoneyIntent.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { ScriptedRandomSource } from '../support/ScriptedRandomSource.js';
import { assertMoneyConserved, eventTypes, findEvent } from '../support/gameBuilder.js';
import { buildStockGame } from '../support/marketGameBuilder.js';

const eventPayload = (events, type) => findEvent(events, type);

describe('AWAIT_TRADE: 거래 창구 진입과 탈출', () => {
  it('투자 모드 STOCKS인 방은 턴이 시작되면 굴리기 전에 거래 창구가 열린다', () => {
    // Given
    const game = buildStockGame();

    // When (첫 턴은 생성 시점에 이미 시작돼 있다)
    // Then
    assert.equal(game.phase, PHASES.AWAIT_TRADE);
    assert.equal(game.pendingDecision.kind, 'TRADE');
    assert.equal(game.pendingDecision.afterTrade, 'ROLL');
    assert.equal(game.pendingDecision.cash, STARTING_CASH);
    assert.deepEqual(game.pendingDecision.holdings, []);
    assert.equal(game.pendingDecision.budget.ordersLeft, 3);
  });

  it('투자 모드 OFF인 방에는 거래 창구가 아예 없다', () => {
    // Given / When
    const game = buildStockGame({ investmentMode: 'OFF' });

    // Then
    assert.equal(game.phase, PHASES.AWAIT_ROLL);
    assert.equal(game.marketView({ actingSeatId: 's1' }), null);
    assert.throws(() => game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {}), {
      code: DOMAIN_ERROR_CODES.INVALID_PHASE,
    });
  });

  it('CLOSE_TRADING을 보내면 원래 흐름(굴리기)으로 돌아간다', () => {
    // Given
    const game = buildStockGame();

    // When
    const events = game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // Then
    assert.deepEqual(eventTypes(events), [EVENT_TYPES.TRADING_CLOSED]);
    assert.equal(eventPayload(events, EVENT_TYPES.TRADING_CLOSED).reason, TRADING_CLOSE_REASONS.PLAYER);
    assert.equal(game.phase, PHASES.AWAIT_ROLL);
  });

  it('조난 중에도 창구가 열리고, 닫으면 조난 선택으로 간다(죽은 턴 방지)', () => {
    // Given
    const game = buildStockGame({ islandTurns: { s1: 2 } });

    // Then
    assert.equal(game.phase, PHASES.AWAIT_TRADE);
    assert.equal(game.pendingDecision.afterTrade, 'ISLAND');

    // When
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // Then
    assert.equal(game.phase, PHASES.AWAIT_ISLAND_CHOICE);
  });

  it('공항 이동권이 있으면 창구를 닫은 뒤 목적지 선택으로 가고 AIRPORT_READY가 그때 나온다', () => {
    // Given
    const game = buildStockGame({ airportPending: ['s1'] });

    // Then
    assert.equal(game.pendingDecision.afterTrade, 'TRAVEL');

    // When
    const events = game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // Then
    assert.deepEqual(eventTypes(events), [EVENT_TYPES.TRADING_CLOSED, EVENT_TYPES.AIRPORT_READY]);
    assert.equal(game.phase, PHASES.AWAIT_TRAVEL);
  });

  it('거래할 것이 전혀 없으면(현금 0·보유 0·예금 0) 창구를 열지 않는다', () => {
    // Given (s2의 현금을 0으로 두고 s1의 턴을 끝내 s2의 턴을 실제로 시작시킨다.
    //        12번에서 6칸 = 18번 세관 → 납부 후 턴이 확실히 끝난다)
    const game = buildStockGame({
      cash: { s2: 0 },
      positions: { s1: 12 },
      random: new ScriptedRandomSource([2, 4]),
    });
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL, {});

    // Then
    assert.equal(game.currentPlayerId, 's2');
    assert.equal(game.phase, PHASES.AWAIT_ROLL, '창구 없이 곧바로 굴리기다');
    assert.equal(findEvent(events, EVENT_TYPES.TRADING_OPENED), undefined);
  });

  it('더블 추가 턴에는 창구가 열리지 않는다(창구는 턴 시작 1회)', () => {
    // Given (더블 6칸 = 18번 세관 → 납부 후 추가 턴)
    const game = buildStockGame({ positions: { s1: 12 }, random: new ScriptedRandomSource([3, 3]) });
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL, {});

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.EXTRA_TURN), '추가 턴이 나와야 한다');
    assert.equal(game.phase, PHASES.AWAIT_ROLL, '창구가 아니라 곧바로 굴리기다');
    assert.equal(findEvent(events, EVENT_TYPES.TRADING_OPENED), undefined);
  });

  it('창구 밖에서는 거래 커맨드가 ERR005(잘못된 페이즈)다', () => {
    // Given
    const game = buildStockGame();
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // When / Then
    for (const [type, payload] of [
      [COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 1 }],
      [COMMAND_TYPES.SELL_STOCK, { instrumentId: 'AIR', quantity: 1 }],
      [COMMAND_TYPES.DEPOSIT, { amount: 10_000 }],
      [COMMAND_TYPES.WITHDRAW, { amount: 10_000 }],
      [COMMAND_TYPES.CLOSE_TRADING, {}],
    ]) {
      assert.throws(() => game.execute('s1', type, payload), {
        code: DOMAIN_ERROR_CODES.INVALID_PHASE,
      });
    }
  });

  it('남의 좌석은 창구에서 거래할 수 없다(ERR006)', () => {
    // Given
    const game = buildStockGame();

    // When / Then
    assert.throws(() => game.execute('s2', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 1 }), {
      code: DOMAIN_ERROR_CODES.NOT_YOUR_TURN,
    });
    assert.equal(game.playerById('s2').cash, STARTING_CASH, '상태가 바뀌지 않는다');
  });
});

describe('AWAIT_TRADE: 주문과 예금', () => {
  it('매수는 현금에서 명목금액과 수수료를 빼고 보유를 늘린다', () => {
    // Given
    const game = buildStockGame();

    // When (AIR 12,000 × 10주 = 120,000 + 수수료 1,200)
    const events = game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 10 });

    // Then
    assert.deepEqual(eventTypes(events), [EVENT_TYPES.ORDER_FILLED]);
    assert.equal(game.playerById('s1').cash, STARTING_CASH - 121_200);
    assert.deepEqual(game.marketView({ actingSeatId: 's1' }).holdings.s1, [
      { instrumentId: 'AIR', qty: 10, avgCost: 12_000, marketValue: 120_000 },
    ]);
    assertMoneyConserved(game, '매수 후');
  });

  it('매도는 명목금액을 받고 수수료를 낸다 — 같은 창구 왕복은 수수료 두 번만큼 손실이다', () => {
    // Given
    const game = buildStockGame();
    game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 10 });

    // When
    game.execute('s1', COMMAND_TYPES.SELL_STOCK, { instrumentId: 'AIR', quantity: 10 });

    // Then (수수료 1,200 × 2 = 2,400원 손실)
    assert.equal(game.playerById('s1').cash, STARTING_CASH - 2_400);
    assert.deepEqual(game.marketView({ actingSeatId: 's1' }).holdings.s1, []);
    assertMoneyConserved(game, '왕복 후');
  });

  it('예치와 인출이 현금과 예금 잔액을 옮긴다', () => {
    // Given
    const game = buildStockGame();

    // When
    const made = game.execute('s1', COMMAND_TYPES.DEPOSIT, { amount: 1_000_000 });

    // Then
    assert.deepEqual(eventTypes(made), [EVENT_TYPES.DEPOSIT_MADE]);
    assert.equal(game.playerById('s1').cash, STARTING_CASH - 1_000_000);
    assert.equal(game.marketView({ actingSeatId: 's1' }).deposits.s1, 1_000_000);

    // When
    game.execute('s1', COMMAND_TYPES.WITHDRAW, { amount: 400_000 });

    // Then
    assert.equal(game.playerById('s1').cash, STARTING_CASH - 600_000);
    assertMoneyConserved(game, '예금 왕복');
  });

  it('4번째 주문은 ERR018(주문 한도)이고 3번째에서 창구가 자동으로 닫힌다', () => {
    // Given
    const game = buildStockGame();

    // When
    game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 1 });
    game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 1 });
    const third = game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 1 });

    // Then
    assert.deepEqual(eventTypes(third), [EVENT_TYPES.ORDER_FILLED, EVENT_TYPES.TRADING_CLOSED]);
    assert.equal(
      eventPayload(third, EVENT_TYPES.TRADING_CLOSED).reason,
      TRADING_CLOSE_REASONS.BUDGET_EXHAUSTED,
    );
    assert.equal(game.phase, PHASES.AWAIT_ROLL);
  });

  it('창구 예산(2,000,000원)을 넘는 주문은 한도 초과로 거부되고 상태가 그대로다', () => {
    // Given (NRG 20,000 × 50주 = 1,000,000원 두 번이면 예산이 끝난다)
    const game = buildStockGame();
    game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'NRG', quantity: 50 });
    game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'NRG', quantity: 50 });
    const cashBefore = game.playerById('s1').cash;

    // When / Then
    assert.throws(() => game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 1 }), {
      code: DOMAIN_ERROR_CODES.TRADE_LIMIT,
    });
    assert.equal(game.playerById('s1').cash, cashBefore);
    assert.equal(game.version, 2, '거부된 커맨드는 version을 올리지 않는다');
  });

  it('현금보다 비싼 주문은 ERR008이고 상태가 그대로다', () => {
    // Given
    const game = buildStockGame({ cash: { s1: 100_000 } });

    // When / Then
    assert.throws(() => game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 10 }), {
      code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH,
    });
    assert.equal(game.playerById('s1').cash, 100_000);
    assert.deepEqual(game.marketView({ actingSeatId: 's1' }).holdings.s1, []);
  });

  it('음수·범위 밖 수량과 비단위 금액은 도메인에서도 거부한다', () => {
    // Given
    const game = buildStockGame();

    // When / Then
    for (const quantity of [0, -5, 201, 1.5]) {
      assert.throws(
        () => game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity }),
        { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
        `수량 ${quantity}`,
      );
    }
    for (const amount of [5_000, 15_000, 0, -10_000]) {
      assert.throws(
        () => game.execute('s1', COMMAND_TYPES.DEPOSIT, { amount }),
        { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
        `금액 ${amount}`,
      );
    }
  });
});

describe('예약 주문(모든 페이즈, 자기 좌석)', () => {
  it('남의 턴에도 자기 좌석 예약을 걸 수 있다', () => {
    // Given (s1의 턴)
    const game = buildStockGame();

    // When
    const events = game.execute('s2', COMMAND_TYPES.QUEUE_ORDER, {
      kind: ORDER_KINDS.BUY_STOCK,
      instrumentId: 'CON',
      quantity: 20,
    });

    // Then
    assert.deepEqual(eventTypes(events), [EVENT_TYPES.QUEUED_ORDER_PLACED]);
    assert.equal(game.marketView({ actingSeatId: 's1' }).orderQueue.length, 1);
    assert.equal(game.phase, PHASES.AWAIT_TRADE, '게임 상태는 바뀌지 않는다');
  });

  it('남의 좌석 예약은 걸 수도 취소할 수도 없다', () => {
    // Given
    const game = buildStockGame();
    game.execute('s2', COMMAND_TYPES.QUEUE_ORDER, { kind: ORDER_KINDS.DEPOSIT, amount: 10_000 });

    // When / Then (s1이 s2의 좌석을 사칭할 수는 없다 — seatId는 인증된 값이다)
    assert.throws(() => game.execute('s1', COMMAND_TYPES.CANCEL_QUEUED_ORDER, { orderId: 'ord-1' }), {
      code: DOMAIN_ERROR_CODES.FORBIDDEN,
    });
    assert.equal(game.marketView({ actingSeatId: 's1' }).orderQueue.length, 1);
  });

  it('탈락한 좌석은 예약을 걸 수 없다', () => {
    // Given
    const game = buildStockGame({ eliminated: ['s3'], seats: 3 });

    // When / Then
    assert.throws(
      () => game.execute('s3', COMMAND_TYPES.QUEUE_ORDER, { kind: ORDER_KINDS.DEPOSIT, amount: 10_000 }),
      { code: DOMAIN_ERROR_CODES.FORBIDDEN },
    );
  });

  it('창구가 열릴 때 예약이 먼저 자동 체결된다', () => {
    // Given (s2가 예약을 걸고 s1의 턴을 끝낸다)
    const game = buildStockGame();
    game.execute('s2', COMMAND_TYPES.QUEUE_ORDER, {
      kind: ORDER_KINDS.BUY_STOCK,
      instrumentId: 'AIR',
      quantity: 10,
    });
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // When (s1이 굴려 턴을 끝내면 s2의 턴이 시작된다)
    const events = game.execute('s1', COMMAND_TYPES.ROLL, {});

    // Then
    const types = eventTypes(events);
    assert.ok(types.includes(EVENT_TYPES.TRADING_OPENED));
    assert.ok(
      types.indexOf(EVENT_TYPES.TRADING_OPENED) < types.indexOf(EVENT_TYPES.QUEUED_ORDER_EXECUTED),
      '창구가 열린 뒤 체결된다',
    );
    assert.ok(types.includes(EVENT_TYPES.ORDER_FILLED));
    assert.equal(game.marketView({ actingSeatId: 's2' }).holdings.s2[0].qty, 10);
    assertMoneyConserved(game, '예약 체결 후');
  });

  it('현금이 모자란 예약은 사유와 함께 버려지고 턴은 계속된다', () => {
    // Given
    const game = buildStockGame({ cash: { s2: 50_000 } });
    game.execute('s2', COMMAND_TYPES.QUEUE_ORDER, {
      kind: ORDER_KINDS.BUY_STOCK,
      instrumentId: 'AIR',
      quantity: 10,
    });
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL, {});

    // Then
    assert.equal(
      eventPayload(events, EVENT_TYPES.QUEUED_ORDER_REJECTED).reasonCode,
      REJECT_REASONS.INSUFFICIENT_CASH,
    );
    assert.equal(game.phase, PHASES.AWAIT_TRADE, '창구는 정상적으로 열려 있다');
    assertMoneyConserved(game, '예약 거절 후');
  });
});

describe('라운드 틱(설계서 §2.3의 시점 규칙)', () => {
  it('ROUND_ADVANCED 1회당 정확히 1번 돈다', () => {
    // Given (2인이 더블 없이 6칸 이동 → 둘 다 18번 세관에서 턴이 끝나 라운드가 한 바퀴 돈다)
    const game = buildStockGame({
      positions: { s1: 12, s2: 12 },
      random: new ScriptedRandomSource([2, 4, 2, 4]),
    });

    // When
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});
    const firstRoll = game.execute('s1', COMMAND_TYPES.ROLL, {});
    game.execute('s2', COMMAND_TYPES.CLOSE_TRADING, {});
    const secondRoll = game.execute('s2', COMMAND_TYPES.ROLL, {});

    // Then
    assert.equal(countOf(firstRoll, EVENT_TYPES.ROUND_ADVANCED), 0, '첫 좌석 뒤에는 라운드가 안 넘어간다');
    assert.equal(countOf(firstRoll, EVENT_TYPES.PRICES_UPDATED), 0);
    assert.equal(countOf(secondRoll, EVENT_TYPES.ROUND_ADVANCED), 1);
    assert.equal(countOf(secondRoll, EVENT_TYPES.PRICES_UPDATED), 1, '틱은 라운드당 1회');
    assert.equal(countOf(secondRoll, EVENT_TYPES.NEWS_PUBLISHED), 1);
  });

  it('더블 추가 턴에는 틱이 없다', () => {
    // Given (s1이 더블 → 추가 턴)
    const game = buildStockGame({ positions: { s1: 12 }, random: new ScriptedRandomSource([3, 3]) });
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // When
    const doubled = game.execute('s1', COMMAND_TYPES.ROLL, {});

    // Then
    assert.ok(eventTypes(doubled).includes(EVENT_TYPES.EXTRA_TURN));
    assert.equal(countOf(doubled, EVENT_TYPES.PRICES_UPDATED), 0);
    assert.equal(countOf(doubled, EVENT_TYPES.ROUND_ADVANCED), 0);
  });

  it('라운드 제한으로 끝나는 전이에서는 틱을 돌리지 않는다', () => {
    // Given (라운드 제한 1 → 한 바퀴를 돌면 게임이 끝난다)
    const game = buildStockGame({
      roundLimit: 1,
      positions: { s1: 12, s2: 12 },
      random: new ScriptedRandomSource([2, 4, 2, 4]),
    });

    // When
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});
    game.execute('s1', COMMAND_TYPES.ROLL, {});
    game.execute('s2', COMMAND_TYPES.CLOSE_TRADING, {});
    const last = game.execute('s2', COMMAND_TYPES.ROLL, {});

    // Then
    assert.ok(eventTypes(last).includes(EVENT_TYPES.GAME_OVER));
    assert.equal(countOf(last, EVENT_TYPES.PRICES_UPDATED), 0, '플레이되지 않는 라운드의 뉴스로 순위가 뒤집히면 부당하다');
    assert.equal(countOf(last, EVENT_TYPES.NEWS_PUBLISHED), 0);
  });

  it('예금 이자는 라운드 틱에 지급되고 장부에 사유로 남는다', () => {
    // Given
    const game = buildStockGame({
      positions: { s1: 12, s2: 12 },
      random: new ScriptedRandomSource([2, 4, 2, 4]),
    });
    game.execute('s1', COMMAND_TYPES.DEPOSIT, { amount: 1_000_000 });
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});
    game.execute('s1', COMMAND_TYPES.ROLL, {});
    game.execute('s2', COMMAND_TYPES.CLOSE_TRADING, {});

    // When
    const events = game.execute('s2', COMMAND_TYPES.ROLL, {});

    // Then (기준금리 50bp → 5,000원)
    const paid = eventPayload(events, EVENT_TYPES.DEPOSIT_INTEREST_PAID);
    assert.equal(paid.playerId, 's1');
    assert.equal(paid.amount, 5_000);
    assert.equal(game.moneyReport().breakdown[MONEY_REASONS.DEPOSIT_INTEREST], 5_000);
    assertMoneyConserved(game, '이자 지급 후');
  });
});

describe('보드 연동 압력(nudge)', () => {
  it('세관 납부는 전 종목에 −100bp를 적립하고 즉시 반영되지 않는다', () => {
    // Given (s1을 세관(18) 앞에 두고 굴린다)
    const game = buildStockGame({ positions: { s1: 16 }, random: new ScriptedRandomSource([1, 1]) });
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL, {});

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.TAX_PAID));
    const nudges = game.marketView({ actingSeatId: 's1' }).pendingNudges;
    assert.equal(nudges.length, 5, '전 섹터에 적립된다');
    assert.ok(nudges.every((nudge) => nudge.bp === -100));
    assert.equal(
      game.marketView({ actingSeatId: 's1' }).instruments[0].price,
      12_000,
      '즉시 반영되지 않는다(내부정보 차단)',
    );
  });

  it('공항 이동권 사용은 항공 섹터에 +200bp를 적립한다', () => {
    // Given
    const game = buildStockGame({ airportPending: ['s1'], positions: { s1: 30 } });
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // When
    game.execute('s1', COMMAND_TYPES.TRAVEL, { destination: 3 });

    // Then
    assert.deepEqual(
      game.marketView({ actingSeatId: 's1' }).pendingNudges.filter((nudge) => nudge.bp > 0),
      [{ sector: SECTORS.AIRLINE, bp: 200, label: '항공' }],
    );
  });

  it('비싼 도시 매입은 건설 섹터에 +100bp를 적립한다', () => {
    // Given (서울 39번 = 800,000원 — 36번에서 3칸)
    const game = buildStockGame({ positions: { s1: 36 }, random: new ScriptedRandomSource([1, 2]) });
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});
    game.execute('s1', COMMAND_TYPES.ROLL, {});

    // When
    game.execute('s1', COMMAND_TYPES.BUY, {});

    // Then
    assert.ok(
      game
        .marketView({ actingSeatId: 's1' })
        .pendingNudges.some((nudge) => nudge.sector === SECTORS.CONSTRUCTION && nudge.bp === 100),
    );
  });
});

describe('배당(출발 칸 통과)', () => {
  it('상장 종목만, 월급 다음에 지급된다', () => {
    // Given (s1을 39번에 두고 AIR 10주·ENT 10주를 사 둔다 → 굴리면 출발 칸을 지난다)
    const game = buildStockGame({ positions: { s1: 39 }, random: new ScriptedRandomSource([1, 2]) });
    game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 10 });
    game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'ENT', quantity: 10 });
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL, {});

    // Then (AIR 12,000 × 150bp = 180원 × 10주)
    const types = eventTypes(events);
    assert.ok(types.indexOf(EVENT_TYPES.SALARY_PAID) < types.indexOf(EVENT_TYPES.DIVIDEND_PAID));
    const dividends = events.filter((event) => event.type === EVENT_TYPES.DIVIDEND_PAID);
    assert.equal(dividends.length, 1, '무배당 종목은 이벤트가 없다');
    assert.deepEqual(dividends[0], {
      type: EVENT_TYPES.DIVIDEND_PAID,
      playerId: 's1',
      instrumentId: 'AIR',
      name: '한빛항공',
      quantity: 10,
      perShare: 180,
      amount: 1_800,
    });
    assert.equal(game.moneyReport().breakdown[MONEY_REASONS.DIVIDEND], 1_800);
    assertMoneyConserved(game, '배당 후');
  });

  it('출발 칸을 지나지 않으면 배당이 없다', () => {
    // Given
    const game = buildStockGame({ positions: { s1: 5 }, random: new ScriptedRandomSource([1, 2]) });
    game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 10 });
    game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL, {});

    // Then
    assert.equal(findEvent(events, EVENT_TYPES.DIVIDEND_PAID), undefined);
  });
});

describe('정리(LIQUIDATION)와 파산에서의 주식·예금', () => {
  it('정리 목록에 주식·예금·부동산이 순서대로 오른다', () => {
    // Given (통행료를 낼 수 없게 만든다)
    const game = liquidatingGame();

    // When / Then (통행료를 못 내 정리 페이즈에 들어와 있다)

    // Then
    assert.equal(game.phase, PHASES.AWAIT_LIQUIDATION);
    assert.deepEqual(
      game.pendingDecision.sellable.map((asset) => asset.assetKind),
      ['STOCK', 'DEPOSIT'],
    );
    assert.deepEqual(game.pendingDecision.sellable[0], {
      assetKind: 'STOCK',
      assetId: 'AIR',
      name: '한빛항공',
      label: '한빛항공',
      refund: 120_000,
      quantity: 10,
      maxQuantity: 10,
      heldQuantity: 10,
      unitValue: 12_000,
    });
    // 자산군이 섞여도 이름 필드 키가 같아야 한 렌더러로 그릴 수 있다.
    for (const asset of game.pendingDecision.sellable) {
      assert.equal(typeof asset.name, 'string', `${asset.assetKind}에 name이 없다`);
      assert.ok(asset.name.length > 0);
    }
  });

  it('sellable의 maxQuantity는 **팔 수 있는 최대**이고 quantity는 보유량이다', () => {
    // Given (서버가 부족액까지만 허용하므로, 화면이 보유 전량을 최대로 보여 주면
    //        플레이어가 스테퍼를 끝까지 올려 ERR018을 맞는다. 규칙은 서버가 알려 준다)
    const game = smallDebtGame();
    const shortfall = game.pendingDecision.amountDue - game.playerById('s1').cash;
    const needed = Math.ceil(shortfall / 12_000);
    const stock = game.pendingDecision.sellable.find((asset) => asset.assetKind === 'STOCK');

    // When / Then
    assert.equal(stock.quantity, 10, 'quantity는 보유량');
    assert.equal(stock.heldQuantity, 10, 'heldQuantity도 보유량');
    assert.equal(stock.maxQuantity, needed, 'maxQuantity는 부족액을 덮는 수량');
    assert.ok(stock.maxQuantity < stock.heldQuantity, '이 시나리오는 일부만 팔면 된다');
    // 화면이 maxQuantity까지 올려도 서버가 받아 준다.
    game.execute('s1', COMMAND_TYPES.SELL_ASSET, {
      assetKind: 'STOCK',
      assetId: 'AIR',
      quantity: stock.maxQuantity,
    });
    assertMoneyConserved(game, 'maxQuantity 매각');
  });

  it('부족액이 보유보다 크면 maxQuantity가 보유량과 같다', () => {
    // Given (서울 랜드마크 통행료 2,800,000원)
    const game = liquidatingGame();

    // When
    const stock = game.pendingDecision.sellable.find((asset) => asset.assetKind === 'STOCK');
    const deposit = game.pendingDecision.sellable.find((asset) => asset.assetKind === 'DEPOSIT');

    // Then
    assert.equal(stock.maxQuantity, stock.heldQuantity);
    assert.equal(deposit.maxQuantity, deposit.heldQuantity);
  });

  it('부동산은 쪼갤 수 없으므로 maxQuantity가 항상 1이다', () => {
    // Given
    const game = liquidatingGame({ withCity: true });

    // When
    const property = game.pendingDecision.sellable.find((asset) => asset.assetKind === 'PROPERTY');

    // Then
    assert.equal(property.maxQuantity, 1);
    assert.equal(property.heldQuantity, 1);
  });

  it('SELL_ASSET으로 주식을 수수료 없이 팔 수 있고 기존 SELL도 그대로 동작한다', () => {
    // Given
    const game = liquidatingGame();
    const cashBefore = game.playerById('s1').cash;

    // When
    const events = game.execute('s1', COMMAND_TYPES.SELL_ASSET, {
      assetKind: 'STOCK',
      assetId: 'AIR',
      quantity: 5,
    });

    // Then
    assert.equal(eventPayload(events, EVENT_TYPES.ORDER_FILLED).fee, 0, '정리 매각은 수수료 면제');
    assert.equal(game.playerById('s1').cash, cashBefore + 60_000);
    assertMoneyConserved(game, '정리 매각 후');
  });

  it('정리 매각은 부족액을 덮는 수량까지만 허용한다(수수료 면제·한도 면제 악용 차단)', () => {
    // Given (정리 매각은 수수료가 면제되고 창구 한도를 보지 않는다. 그래서 통행료를 조금 못 낸
    //        상황을 만들어 놓고 보유 전량을 한 번에 털면 수수료 없이 창구 규칙을 우회한
    //        대량 현금화가 된다 — "강제 지불을 메우는 매각"이라는 전제를 벗어난다)
    const game = smallDebtGame();
    const owed = game.pendingDecision.amountDue;
    const shortfall = owed - game.playerById('s1').cash;
    const needed = Math.ceil(shortfall / 12_000);
    assert.ok(needed >= 1 && needed < 10, `부족액이 보유(10주)보다 작아야 한다: ${needed}주`);

    // When / Then (필요량을 넘는 수량은 거부되고 상태가 그대로다)
    assert.throws(
      () =>
        game.execute('s1', COMMAND_TYPES.SELL_ASSET, {
          assetKind: 'STOCK',
          assetId: 'AIR',
          quantity: 10,
        }),
      { code: DOMAIN_ERROR_CODES.TRADE_LIMIT },
    );
    assert.equal(game.marketView({ actingSeatId: 's1' }).holdings.s1[0].qty, 10, '상태 불변');

    // When (필요량만큼은 통과한다)
    game.execute('s1', COMMAND_TYPES.SELL_ASSET, {
      assetKind: 'STOCK',
      assetId: 'AIR',
      quantity: needed,
    });

    // Then
    assert.equal(game.marketView({ actingSeatId: 's2' }).holdings.s1[0].qty, 10 - needed);
    assertMoneyConserved(game, '정리 매각 상한');
  });

  it('수량을 생략하면 부족액을 덮는 만큼만 팔린다(전량이 아니다)', () => {
    // Given
    const game = smallDebtGame();
    const shortfall = game.pendingDecision.amountDue - game.playerById('s1').cash;
    const needed = Math.ceil(shortfall / 12_000);

    // When
    game.execute('s1', COMMAND_TYPES.SELL_ASSET, { assetKind: 'STOCK', assetId: 'AIR' });

    // Then
    assert.equal(game.marketView({ actingSeatId: 's2' }).holdings.s1?.[0]?.qty, 10 - needed);
    assertMoneyConserved(game, '정리 매각 자동 수량');
  });

  it('부족액이 보유 전체보다 크면 전량 매각이 허용된다', () => {
    // Given (서울 랜드마크 통행료 2,800,000원 — 10주(120,000원)로는 어림도 없다)
    const game = liquidatingGame();

    // When / Then
    game.execute('s1', COMMAND_TYPES.SELL_ASSET, {
      assetKind: 'STOCK',
      assetId: 'AIR',
      quantity: 10,
    });
    assert.equal(game.marketView({ actingSeatId: 's2' }).holdings.s1.length, 0);
    assertMoneyConserved(game, '전량 정리 매각');
  });

  it('부동산은 쪼갤 수 없으므로 필요액을 넘어도 통째로 팔린다', () => {
    // Given
    const game = liquidatingGame({ withCity: true });

    // When
    const events = game.execute('s1', COMMAND_TYPES.SELL_ASSET, {
      assetKind: 'PROPERTY',
      assetId: '33',
    });

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.PROPERTY_SOLD));
    assertMoneyConserved(game, '부동산 정리 매각');
  });

  it('AUTO_SELL은 주식 → 예금 → 부동산 순서로 판다', () => {
    // Given
    const game = liquidatingGame({ withCity: true });

    // When
    const events = game.execute('s1', COMMAND_TYPES.AUTO_SELL, {});

    // Then
    const sold = eventTypes(events).filter((type) =>
      [EVENT_TYPES.ORDER_FILLED, EVENT_TYPES.DEPOSIT_WITHDRAWN, EVENT_TYPES.PROPERTY_SOLD].includes(type),
    );
    assert.equal(sold[0], EVENT_TYPES.ORDER_FILLED, '주식이 가장 먼저');
    assert.ok(
      sold.indexOf(EVENT_TYPES.PROPERTY_SOLD) === -1 ||
        sold.indexOf(EVENT_TYPES.DEPOSIT_WITHDRAWN) < sold.indexOf(EVENT_TYPES.PROPERTY_SOLD),
      '부동산은 가장 마지막',
    );
    assertMoneyConserved(game, '자동매각 후');
  });

  it('파산은 주식·예금을 먼저 청산한 뒤 남은 현금을 채권자에게 넘긴다', () => {
    // Given
    const game = liquidatingGame();
    const creditorBefore = game.playerById('s2').cash;

    // When
    const events = game.execute('s1', COMMAND_TYPES.DECLARE_BANKRUPTCY, {});

    // Then
    const types = eventTypes(events);
    assert.ok(
      types.indexOf(EVENT_TYPES.ORDER_FILLED) < types.indexOf(EVENT_TYPES.BANKRUPT),
      '청산이 분배보다 먼저다',
    );
    assert.equal(game.playerById('s1').cash, 0);
    assert.ok(game.playerById('s2').cash > creditorBefore, '청산 대금이 채권자에게 갔다');
    assert.equal(game.marketView({ actingSeatId: 's2' }).holdings.s1.length, 0);
    assert.equal(game.marketView({ actingSeatId: 's2' }).deposits.s1, 0);
    assertMoneyConserved(game, '파산 후');
  });

  it('파산하면 예약 주문도 함께 취소된다', () => {
    // Given
    const game = liquidatingGame();
    game.execute('s1', COMMAND_TYPES.QUEUE_ORDER, { kind: ORDER_KINDS.DEPOSIT, amount: 10_000 });

    // When
    const events = game.execute('s1', COMMAND_TYPES.DECLARE_BANKRUPTCY, {});

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.QUEUED_ORDER_CANCELLED));
    assert.equal(game.marketView({ actingSeatId: 's2' }).orderQueue.length, 0);
  });
});

describe('총자산(NetWorth)과 순위', () => {
  it('총자산에 주식 평가액과 예금이 포함된다(단일 출처)', () => {
    // Given
    const game = buildStockGame();
    game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 10 });
    game.execute('s1', COMMAND_TYPES.DEPOSIT, { amount: 500_000 });

    // When
    const breakdown = game.netWorthBreakdownOf('s1');

    // Then (현금 3,000,000 − 121,200 − 500,000 = 2,378,800 / 주식 120,000 / 예금 500,000)
    assert.deepEqual(breakdown, {
      cash: 2_378_800,
      property: 0,
      stock: 120_000,
      deposit: 500_000,
      loanDebt: 0,
      total: 2_998_800,
    });
    assert.equal(game.netWorthOf('s1'), breakdown.total, '순위와 화면이 같은 계산을 쓴다');
    assert.equal(
      game.rankings().find((entry) => entry.playerId === 's1').totalAssets,
      breakdown.total,
    );
  });

  it('탈락자의 총자산 내역은 전부 0이다', () => {
    // Given
    const game = buildStockGame({ eliminated: ['s2'] });

    // When / Then
    assert.deepEqual(game.netWorthBreakdownOf('s2'), {
      cash: 0,
      property: 0,
      stock: 0,
      deposit: 0,
      loanDebt: 0,
      total: 0,
    });
  });
});

describe('스냅샷', () => {
  it('시장 상태가 스냅샷에 실리고 왕복해도 같다', () => {
    // Given
    const game = buildStockGame();
    game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 10 });
    game.execute('s2', COMMAND_TYPES.QUEUE_ORDER, { kind: ORDER_KINDS.DEPOSIT, amount: 10_000 });

    // When
    const snapshot = game.toSnapshot();
    const restored = Game.restore(snapshot, new FakeRandomSource());

    // Then
    assert.deepEqual(restored.toSnapshot(), snapshot);
    assert.equal(restored.phase, PHASES.AWAIT_TRADE);
    assert.equal(restored.marketView({ actingSeatId: 's1' }).budget.ordersLeft, 2, '창구 예산이 유지된다');
  });

  it('투자 모드 OFF인 방의 스냅샷에는 market이 null이다', () => {
    // Given / When
    const snapshot = buildStockGame({ investmentMode: 'OFF' }).toSnapshot();

    // Then
    assert.equal(snapshot.market, null);
    assert.equal(Game.restore(snapshot, new FakeRandomSource()).marketView({ actingSeatId: 's1' }), null);
  });
});

/**
 * 통행료를 **조금** 못 내 정리 페이즈에 들어간 게임(주식 10주 보유).
 * 부족액이 보유 수량보다 작아야 "필요량까지만" 규칙을 검증할 수 있다.
 */
function smallDebtGame() {
  const game = buildStockGame({
    seats: 2,
    cash: { s1: 130_000 },
    // 방콕(3) + 별장 → 통행료 = 70,000 × 0.4 = 28,000원
    cities: [{ index: 3, ownerId: 's2', buildings: ['VILLA'] }],
    positions: { s1: 0 },
    random: new ScriptedRandomSource([1, 2]),
  });
  game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 10 });
  game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});
  game.execute('s1', COMMAND_TYPES.ROLL, {});
  assert.equal(game.phase, PHASES.AWAIT_LIQUIDATION, '소액 정리 페이즈 준비 실패');
  return game;
}

/** 통행료를 못 내 정리 페이즈에 들어간 게임(주식 10주 + 예금 500,000원 보유). */
function liquidatingGame({ withCity = false } = {}) {
  const game = buildStockGame({
    seats: 2,
    cash: { s1: 1_000_000 },
    cities: [
      // 서울(39) 랜드마크 통행료 = 800,000 × 3.5 = 2,800,000원 → 현금으로 절대 낼 수 없다.
      { index: 39, ownerId: 's2', buildings: ['VILLA', 'BUILDING', 'HOTEL'], landmark: true },
      ...(withCity ? [{ index: 33, ownerId: 's1', buildings: ['VILLA'] }] : []),
    ],
    positions: { s1: 36 },
    random: new ScriptedRandomSource([1, 2]),
  });
  game.execute('s1', COMMAND_TYPES.BUY_STOCK, { instrumentId: 'AIR', quantity: 10 });
  game.execute('s1', COMMAND_TYPES.DEPOSIT, { amount: 500_000 });
  game.execute('s1', COMMAND_TYPES.CLOSE_TRADING, {});
  game.execute('s1', COMMAND_TYPES.ROLL, {});
  assert.equal(game.phase, PHASES.AWAIT_LIQUIDATION, '정리 페이즈 준비 실패');
  return game;
}

function countOf(events, type) {
  return events.filter((event) => event.type === type).length;
}
