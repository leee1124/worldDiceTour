import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PHASES } from '../../src/domain/game/phases.js';
import { MAX_TICKET_CHAIN } from '../../src/domain/game/Game.js';
import { Board } from '../../src/domain/game/Board.js';
import { SPACE_KINDS } from '../../src/domain/game/data/board.js';
import { TICKETS, TICKET_EFFECTS } from '../../src/domain/game/data/tickets.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { STARTING_CASH, SALARY, ISLAND_RESCUE_FEE } from '../../src/domain/game/Player.js';
import { CASINO_GAMES, SLOT_SYMBOLS } from '../../src/domain/game/Casino.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { buildGame, eventTypes, findEvent, assertMoneyConserved } from '../support/gameBuilder.js';

/** 행운 티켓 칸(2번)에 정확히 도착하도록 준비한다. 지정한 티켓 한 장만 덱에 남긴다. */
const ticketGame = (ticketId, options = {}) =>
  buildGame({
    positions: { s1: 0, ...(options.positions ?? {}) },
    drawPile: [ticketId],
    ...options,
    random: options.random ?? new FakeRandomSource([1, 1, 0]),
  });

describe('Game(행운 티켓 효과)', () => {
  it('현금 수령 티켓은 은행에서 돈을 받는다', () => {
    // Given
    const game = ticketGame('T01', { random: new FakeRandomSource([1, 1, 0]) });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(findEvent(events, EVENT_TYPES.TICKET_DRAWN).ticketId, 'T01');
    assert.equal(game.playerById('s1').cash, STARTING_CASH + 100_000);
    assertMoneyConserved(game, '수령 티켓');
  });

  it('현금 지불 티켓은 은행에 돈을 낸다', () => {
    // Given
    const game = ticketGame('T05');

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').cash, STARTING_CASH - 50_000);
    assertMoneyConserved(game, '지불 티켓');
  });

  it('전진 티켓은 이동 후 도착 칸 효과까지 적용한다', () => {
    // Given (2번 칸 → 앞으로 3칸 → 5번 제주 올레길 휴양지)
    const game = ticketGame('T09');

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').position, 5);
    assert.equal(game.phase, PHASES.AWAIT_BUY);
    assert.equal(game.pendingDecision.index, 5);
  });

  it('후진 티켓은 뒤로 이동하며 월급을 받지 않는다', () => {
    // Given (2번 칸 → 뒤로 2칸 → 0번 출발)
    const game = ticketGame('T10');

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').position, 0);
    assert.equal(findEvent(events, EVENT_TYPES.SALARY_PAID), undefined);
  });

  it('출발 칸 직행 티켓은 월급을 받는다', () => {
    // Given
    const game = ticketGame('T11');

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').position, 0);
    assert.equal(findEvent(events, EVENT_TYPES.SALARY_PAID).amount, SALARY);
  });

  it('카지노 초대장 티켓은 라스베이거스로 이동시켜 베팅 페이즈로 만든다', () => {
    // Given
    const game = ticketGame('T12');

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').position, 20);
    assert.equal(game.phase, PHASES.AWAIT_CASINO);
  });

  it('폭풍우 티켓은 월급 없이 조난 섬으로 이송한다', () => {
    // Given
    const game = ticketGame('T13');

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').position, 10);
    assert.equal(game.playerById('s1').isStranded(), true);
    assert.equal(findEvent(events, EVENT_TYPES.SALARY_PAID), undefined);
  });

  it('공항 특가 티켓은 공항으로 이동시켜 다음 턴 이동권을 준다', () => {
    // Given
    const game = ticketGame('T14');

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').position, 30);
    assert.equal(game.playerById('s1').airportPending, true);
  });

  it('생일 축하 티켓은 다른 모든 플레이어에게서 50,000원씩 받는다', () => {
    // Given
    const game = ticketGame('T15', {
      seats: [
        { id: 's1', name: '하나' },
        { id: 's2', name: '두리' },
        { id: 's3', name: '세찌' },
      ],
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').cash, STARTING_CASH + 100_000);
    assert.equal(game.playerById('s2').cash, STARTING_CASH - 50_000);
    assert.equal(game.playerById('s3').cash, STARTING_CASH - 50_000);
    assertMoneyConserved(game, '생일 축하');
  });

  it('한턱 쏘기 티켓은 다른 모든 플레이어에게 30,000원씩 준다', () => {
    // Given
    const game = ticketGame('T16');

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').cash, STARTING_CASH - 30_000);
    assert.equal(game.playerById('s2').cash, STARTING_CASH + 30_000);
    assertMoneyConserved(game, '한턱 쏘기');
  });

  it('건물 점검 티켓은 건물 수 × 40,000원을 낸다', () => {
    // Given
    const game = ticketGame('T17', {
      cities: [
        { index: 1, ownerId: 's1', buildings: ['VILLA', 'BUILDING'] },
        { index: 3, ownerId: 's1', buildings: ['VILLA'] },
      ],
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').cash, STARTING_CASH - 120_000);
  });

  it('관광 붐 티켓은 보유 도시 수 × 30,000원을 받는다(휴양지 제외)', () => {
    // Given
    const game = ticketGame('T18', {
      cities: [
        { index: 1, ownerId: 's1' },
        { index: 3, ownerId: 's1' },
        { index: 5, ownerId: 's1' },
      ],
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').cash, STARTING_CASH + 60_000);
  });

  it('휴양 충동 티켓은 가장 가까운 휴양지로 전진한다', () => {
    // Given
    const game = ticketGame('T19');

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').position, 5);
  });

  it('세무조사 티켓은 현금의 5%를 잭팟에 적립한다', () => {
    // Given
    const game = ticketGame('T20', { cash: { s1: 1_000_000 } });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.jackpot, 50_000);
    assert.equal(game.playerById('s1').cash, 950_000);
    assertMoneyConserved(game, '세무조사');
  });

  describe('티켓 연쇄 상한', () => {
    /**
     * 배포 티켓으로는 티켓 칸에서 티켓 칸으로 이어지는 연쇄가 **한 번도** 일어나지 않는다.
     * 그래서 상한을 실제로 시험하려면 연쇄가 일어나는 티켓을 직접 넣어야 한다.
     * 앞으로 10칸 이동 티켓이면 2 → 12 → 22 → 32가 모두 티켓 칸이라 연쇄가 성립한다.
     */
    const CHAIN_CATALOG = {
      X1: {
        id: 'X1',
        text: '테스트용: 앞으로 10칸',
        effect: { type: TICKET_EFFECTS.MOVE_RELATIVE, steps: 10 },
      },
    };

    it('연쇄가 실제로 일어나도 정확히 상한(3장)에서 멈추고 턴이 정상 종료된다', () => {
      // Given (36 → 주사위 6(2+4, 더블 아님) → 2번 티켓 칸)
      const game = buildGame({
        positions: { s1: 36 },
        drawPile: ['X1'],
        ticketCatalog: CHAIN_CATALOG,
        random: new FakeRandomSource([2, 4, 0, 0, 0]),
      });

      // When
      const events = game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      const draws = events.filter((event) => event.type === EVENT_TYPES.TICKET_DRAWN);
      assert.equal(draws.length, MAX_TICKET_CHAIN, '상한만큼만 뽑는다');
      assert.deepEqual(
        events.filter((event) => event.type === EVENT_TYPES.MOVED).map((event) => event.to),
        [2, 12, 22, 32],
      );
      // 마지막 칸(32)은 티켓 칸이지만 상한에 닿아 효과가 발동하지 않는다
      assert.equal(game.playerById('s1').position, 32);
      assert.ok(eventTypes(events).includes(EVENT_TYPES.TURN_ENDED));
      assert.equal(findEvent(events, EVENT_TYPES.EXTRA_TURN), undefined);
      assert.equal(game.currentPlayerId, 's2');
      assert.equal(game.isOver(), false);
      assertMoneyConserved(game, '티켓 연쇄 상한');
    });

    it('배포된 티켓 데이터로는 연쇄가 한 번도 일어나지 않는다(상한은 방어용)', () => {
      // Given (모든 티켓 칸 × 모든 이동형 티켓 조합)
      const board = Board.createDefault();
      const ticketIndexes = Array.from({ length: board.size }, (_unused, index) => index).filter(
        (index) => board.spaceAt(index).kind === SPACE_KINDS.TICKET,
      );

      // When (각 조합의 도착 칸을 모은다)
      const destinations = [];
      for (const from of ticketIndexes) {
        for (const ticket of TICKETS) {
          const { effect } = ticket;
          if (effect.type === TICKET_EFFECTS.MOVE_RELATIVE) {
            destinations.push(board.advance(from, effect.steps).index);
          } else if (effect.type === TICKET_EFFECTS.MOVE_TO) {
            destinations.push(effect.index);
          } else if (effect.type === TICKET_EFFECTS.NEAREST_RESORT) {
            destinations.push(board.nearestResortFrom(from));
          } else if (effect.type === TICKET_EFFECTS.TO_ISLAND) {
            destinations.push(board.indexOfKind(SPACE_KINDS.ISLAND));
          }
        }
      }

      // Then
      assert.ok(destinations.length > 0, '이동형 티켓이 있어야 의미 있는 검사다');
      assert.deepEqual(
        destinations.filter((index) => ticketIndexes.includes(index)),
        [],
        '티켓 칸으로 이동시키는 티켓이 하나도 없어야 한다',
      );
    });

    it('배포 데이터로 티켓 칸에 도착하면 티켓을 한 장만 뽑는다', () => {
      // Given (앞으로 3칸 티켓만 남긴 덱)
      const game = buildGame({
        positions: { s1: 36 },
        drawPile: ['T09'],
        random: new FakeRandomSource([2, 4, 0]),
      });

      // When
      const events = game.execute('s1', COMMAND_TYPES.ROLL);

      // Then (2 → 5 제주 올레길, 티켓 칸이 아니므로 연쇄 없음)
      assert.equal(
        events.filter((event) => event.type === EVENT_TYPES.TICKET_DRAWN).length,
        1,
      );
      assert.equal(game.playerById('s1').position, 5);
    });
  });
});

describe('Game(조난 섬)', () => {
  it('조난 중인 플레이어는 자기 턴에 선택 페이즈가 된다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 10 },
      islandTurns: { s1: 3 },
      phase: PHASES.AWAIT_ISLAND_CHOICE,
      random: new FakeRandomSource([]),
    });

    // When / Then
    assert.equal(game.phase, PHASES.AWAIT_ISLAND_CHOICE);
    assert.equal(game.pendingDecision.kind, 'ISLAND');
    assert.equal(game.pendingDecision.fee, ISLAND_RESCUE_FEE);
  });

  it('구조비를 내면 즉시 탈출하고 정상 굴림 차례가 된다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 10 },
      islandTurns: { s1: 2 },
      phase: PHASES.AWAIT_ISLAND_CHOICE,
      random: new FakeRandomSource([1, 2]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ISLAND_PAY);

    // Then
    assert.equal(game.playerById('s1').cash, STARTING_CASH - ISLAND_RESCUE_FEE);
    assert.equal(game.playerById('s1').isStranded(), false);
    assert.equal(game.phase, PHASES.AWAIT_ROLL);
    assert.ok(eventTypes(events).includes(EVENT_TYPES.ISLAND_ESCAPED));
    assertMoneyConserved(game, '구조비');
  });

  it('구조비가 부족하면 지불할 수 없다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 10 },
      islandTurns: { s1: 2 },
      cash: { s1: 1_000 },
      phase: PHASES.AWAIT_ISLAND_CHOICE,
      random: new FakeRandomSource([]),
    });

    // When / Then
    assert.throws(() => game.execute('s1', COMMAND_TYPES.ISLAND_PAY), {
      code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH,
    });
    assert.equal(game.playerById('s1').isStranded(), true);
  });

  it('더블이 나오면 탈출해 그 눈만큼 이동하고 추가 턴은 없다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 10 },
      islandTurns: { s1: 3 },
      phase: PHASES.AWAIT_ISLAND_CHOICE,
      random: new FakeRandomSource([2, 2]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ISLAND_ROLL);

    // Then
    assert.equal(game.playerById('s1').position, 14);
    assert.equal(game.playerById('s1').isStranded(), false);
    assert.equal(eventTypes(events).includes(EVENT_TYPES.EXTRA_TURN), false);
  });

  it('더블이 아니면 남은 턴이 줄고 턴이 끝난다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 10 },
      islandTurns: { s1: 3 },
      phase: PHASES.AWAIT_ISLAND_CHOICE,
      random: new FakeRandomSource([1, 2]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ISLAND_ROLL);

    // Then
    assert.equal(game.playerById('s1').islandRemainingTurns, 2);
    assert.equal(game.playerById('s1').position, 10);
    assert.ok(eventTypes(events).includes(EVENT_TYPES.ISLAND_STAY));
    assert.equal(game.currentPlayerId, 's2');
  });

  it('3턴을 모두 실패하면 다음 턴에는 자동으로 풀려난다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 10 },
      islandTurns: { s1: 1 },
      phase: PHASES.AWAIT_ISLAND_CHOICE,
      random: new FakeRandomSource([1, 2, 1, 2, 1, 2]),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ISLAND_ROLL);
    game.execute('s2', COMMAND_TYPES.ROLL);
    game.execute('s2', COMMAND_TYPES.SKIP_BUY);

    // Then
    assert.equal(game.currentPlayerId, 's1');
    assert.equal(game.phase, PHASES.AWAIT_ROLL);
  });

  it('조난 중에도 내 도시의 통행료는 받는다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 0, s2: 0 },
      islandTurns: { s2: 3 },
      cities: [{ index: 3, ownerId: 's2' }],
      random: new FakeRandomSource([1, 2]),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s2').cash, STARTING_CASH + 7_000);
  });
});

describe('Game(세계일주 공항)', () => {
  it('공항에 도착하면 다음 자기 턴에 목적지를 고른다', () => {
    // Given
    const game = buildGame({ positions: { s1: 27 }, random: new FakeRandomSource([1, 2, 1, 2]) });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);
    game.execute('s2', COMMAND_TYPES.ROLL);
    game.execute('s2', COMMAND_TYPES.SKIP_BUY);

    // Then
    assert.equal(game.currentPlayerId, 's1');
    assert.equal(game.phase, PHASES.AWAIT_TRAVEL);
    assert.equal(game.pendingDecision.kind, 'TRAVEL');
  });

  it('목적지로 이동하며 출발 칸을 지나면 월급을 받고 도착 칸 효과가 적용된다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 30 },
      airportPending: ['s1'],
      phase: PHASES.AWAIT_TRAVEL,
      random: new FakeRandomSource([]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.TRAVEL, { destination: 1 });

    // Then
    assert.equal(game.playerById('s1').position, 1);
    assert.equal(findEvent(events, EVENT_TYPES.SALARY_PAID).amount, SALARY);
    assert.equal(game.phase, PHASES.AWAIT_BUY);
    assert.equal(game.playerById('s1').airportPending, false);
  });

  it('공항 칸 자체를 목적지로 고를 수 없다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 30 },
      airportPending: ['s1'],
      phase: PHASES.AWAIT_TRAVEL,
      random: new FakeRandomSource([]),
    });

    // When / Then
    assert.throws(() => game.execute('s1', COMMAND_TYPES.TRAVEL, { destination: 30 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });

  it('범위를 벗어난 목적지는 거부한다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 30 },
      airportPending: ['s1'],
      phase: PHASES.AWAIT_TRAVEL,
      random: new FakeRandomSource([]),
    });

    // When / Then
    assert.throws(() => game.execute('s1', COMMAND_TYPES.TRAVEL, { destination: 99 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });

  it('지금 서 있는 칸을 목적지로 고를 수 없다(0칸 이동으로 같은 칸 효과 재발동 금지)', () => {
    // Given (공항이 아닌 칸에서 이동권을 쓰는 상황: 조난 이송 등으로 위치가 바뀔 수 있다)
    const game = buildGame({
      positions: { s1: 17 },
      airportPending: ['s1'],
      phase: PHASES.AWAIT_TRAVEL,
      random: new FakeRandomSource([]),
    });

    // When / Then
    assert.throws(() => game.execute('s1', COMMAND_TYPES.TRAVEL, { destination: 17 }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.equal(game.phase, PHASES.AWAIT_TRAVEL);
    assert.equal(game.playerById('s1').airportPending, true);
    assert.equal(game.version, 0);
  });

  it('pending은 공항 칸과 현재 칸을 모두 금지 목적지로 알려준다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 17 },
      airportPending: ['s1'],
      phase: PHASES.AWAIT_TRAVEL,
      random: new FakeRandomSource([]),
    });

    // When
    const pending = game.pendingDecision;

    // Then
    assert.equal(pending.kind, 'TRAVEL');
    assert.deepEqual([...pending.forbiddenIndexes].sort((a, b) => a - b), [17, 30]);
  });

  it('공항 칸에 서서 이동권을 쓸 때 금지 목적지는 공항 하나로 합쳐진다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 30 },
      airportPending: ['s1'],
      phase: PHASES.AWAIT_TRAVEL,
      random: new FakeRandomSource([]),
    });

    // When
    const pending = game.pendingDecision;

    // Then
    assert.deepEqual(pending.forbiddenIndexes, [30]);
  });

  it('더블로 공항에 도착해도 추가 턴 없이 턴이 끝난다(이동권은 다음 자기 턴에 쓴다)', () => {
    // Given (28에서 1+1 더블 → 30 공항)
    const game = buildGame({ positions: { s1: 28 }, random: new FakeRandomSource([1, 1]) });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(findEvent(events, EVENT_TYPES.AIRPORT_TICKET_GRANTED)?.playerId, 's1');
    assert.equal(findEvent(events, EVENT_TYPES.EXTRA_TURN), undefined);
    assert.equal(game.currentPlayerId, 's2');
    assert.equal(game.playerById('s1').position, 30);
  });

  it('공항 도착 다음 자기 턴은 30번 칸에서 시작하는 AWAIT_TRAVEL이다', () => {
    // Given (더블로 공항 도착 → s2가 한 턴 진행)
    const game = buildGame({ positions: { s1: 28 }, random: new FakeRandomSource([1, 1, 1, 2]) });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    game.execute('s2', COMMAND_TYPES.ROLL);
    game.execute('s2', COMMAND_TYPES.SKIP_BUY);

    // Then
    assert.equal(game.currentPlayerId, 's1');
    assert.equal(game.phase, PHASES.AWAIT_TRAVEL);
    assert.equal(game.playerById('s1').position, 30);
  });
});

describe('Game(라스베이거스 카지노)', () => {
  const casinoGame = (random, options = {}) =>
    buildGame({
      positions: { s1: 20 },
      phase: PHASES.AWAIT_CASINO,
      casinoRoundsLeft: 3,
      random,
      ...options,
    });

  it('홀짝을 맞히면 베팅액의 2배를 받는다', () => {
    // Given
    const game = casinoGame(new FakeRandomSource([3]));

    // When
    const events = game.execute('s1', COMMAND_TYPES.CASINO_BET, {
      game: CASINO_GAMES.ODD_EVEN,
      bet: 10_000,
      choice: 'ODD',
    });

    // Then
    assert.equal(findEvent(events, EVENT_TYPES.CASINO_RESULT).payout, 20_000);
    assert.equal(game.playerById('s1').cash, STARTING_CASH + 10_000);
    assertMoneyConserved(game, '카지노 승');
  });

  it('잃으면 베팅액의 절반이 잭팟에 적립된다', () => {
    // Given
    const game = casinoGame(new FakeRandomSource([4]));

    // When
    game.execute('s1', COMMAND_TYPES.CASINO_BET, {
      game: CASINO_GAMES.ODD_EVEN,
      bet: 20_000,
      choice: 'ODD',
    });

    // Then
    assert.equal(game.jackpot, 10_000);
    assert.equal(game.playerById('s1').cash, STARTING_CASH - 20_000);
    assertMoneyConserved(game, '카지노 패');
  });

  it('한 방문에 최대 3판만 할 수 있다', () => {
    // Given
    const game = casinoGame(new FakeRandomSource([1, 1, 1]));
    const bet = { game: CASINO_GAMES.ODD_EVEN, bet: 10_000, choice: 'ODD' };

    // When
    game.execute('s1', COMMAND_TYPES.CASINO_BET, bet);
    game.execute('s1', COMMAND_TYPES.CASINO_BET, bet);
    const last = game.execute('s1', COMMAND_TYPES.CASINO_BET, bet);

    // Then
    assert.ok(eventTypes(last).includes(EVENT_TYPES.CASINO_LEFT));
    assert.equal(game.currentPlayerId, 's2');
  });

  it('언제든 그만두고 턴을 끝낼 수 있다', () => {
    // Given
    const game = casinoGame(new FakeRandomSource([]));

    // When
    const events = game.execute('s1', COMMAND_TYPES.CASINO_LEAVE);

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.CASINO_LEFT));
    assert.equal(game.currentPlayerId, 's2');
  });

  it('베팅 단위/범위를 어기면 거부하고 현금은 변하지 않는다', () => {
    // Given
    const game = casinoGame(new FakeRandomSource([]));

    // When / Then
    assert.throws(() =>
      game.execute('s1', COMMAND_TYPES.CASINO_BET, {
        game: CASINO_GAMES.ODD_EVEN,
        bet: 15_000,
        choice: 'ODD',
      }),
    );
    assert.equal(game.playerById('s1').cash, STARTING_CASH);
  });

  it('슬롯 7-7-7이면 10배와 잭팟 적립금 전액을 받는다', () => {
    // Given
    const seven = SLOT_SYMBOLS.length - 1;
    const game = casinoGame(new FakeRandomSource([seven, seven, seven]), { jackpot: 300_000 });

    // When
    const events = game.execute('s1', COMMAND_TYPES.CASINO_BET, {
      game: CASINO_GAMES.SLOT,
      bet: 10_000,
      choice: null,
    });

    // Then
    const result = findEvent(events, EVENT_TYPES.CASINO_RESULT);
    assert.equal(result.jackpotWon, 300_000);
    assert.equal(game.jackpot, 0);
    assert.equal(game.playerById('s1').cash, STARTING_CASH + 100_000 - 10_000 + 300_000);
    assertMoneyConserved(game, '잭팟 획득');
  });

  it('현금이 최소 베팅액보다 적어지면 카지노를 떠난다', () => {
    // Given
    const game = casinoGame(new FakeRandomSource([4]), { cash: { s1: 10_000 } });

    // When
    const events = game.execute('s1', COMMAND_TYPES.CASINO_BET, {
      game: CASINO_GAMES.ODD_EVEN,
      bet: 10_000,
      choice: 'ODD',
    });

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.CASINO_LEFT));
    assert.equal(game.currentPlayerId, 's2');
  });

  it('현금이 부족하면 카지노에 들어가지 않는다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 17 },
      cash: { s1: 5_000 },
      random: new FakeRandomSource([1, 2]),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.currentPlayerId, 's2');
  });
});

describe('Game(게임 종료)', () => {
  it('마지막 한 명이 남으면 순위를 계산하고 끝난다', () => {
    // Given
    const game = buildGame({
      cash: { s1: 10_000 },
      cities: [{ index: 39, ownerId: 's2', buildings: ['VILLA', 'BUILDING', 'HOTEL'], landmark: true }],
      positions: { s1: 36 },
      random: new FakeRandomSource([1, 2]),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const events = game.execute('s1', COMMAND_TYPES.DECLARE_BANKRUPTCY);

    // Then
    const over = findEvent(events, EVENT_TYPES.GAME_OVER);
    assert.equal(game.phase, PHASES.GAME_OVER);
    assert.equal(over.reason, 'LAST_SURVIVOR');
    assert.equal(over.rankings[0].playerId, 's2');
    assert.equal(over.rankings[0].rank, 1);
  });

  it('게임이 끝난 뒤에는 어떤 커맨드도 받지 않는다', () => {
    // Given
    const game = buildGame({ phase: PHASES.GAME_OVER, random: new FakeRandomSource([]) });

    // When / Then
    assert.throws(() => game.execute('s1', COMMAND_TYPES.ROLL), {
      code: DOMAIN_ERROR_CODES.INVALID_PHASE,
    });
  });

  it('라운드 제한에 도달하면 총자산 1위가 승리한다', () => {
    // Given
    const game = buildGame({
      roundLimit: 1,
      cash: { s1: 1_000_000, s2: 2_000_000 },
      random: new FakeRandomSource([1, 2, 1, 2]),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);
    game.execute('s1', COMMAND_TYPES.SKIP_BUY);
    game.execute('s2', COMMAND_TYPES.ROLL);
    const events = game.execute('s2', COMMAND_TYPES.SKIP_BUY);

    // Then
    const over = findEvent(events, EVENT_TYPES.GAME_OVER);
    assert.equal(game.isOver(), true);
    assert.equal(over.reason, 'ROUND_LIMIT');
    assert.equal(over.rankings[0].playerId, 's2');
    assert.equal(over.rankings[0].totalAssets, 2_000_000);
  });
});
