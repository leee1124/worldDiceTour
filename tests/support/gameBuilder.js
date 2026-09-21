import assert from 'node:assert/strict';

import { Game } from '../../src/domain/game/Game.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { STARTING_CASH } from '../../src/domain/game/Player.js';
import { TICKETS } from '../../src/domain/game/data/tickets.js';
import { FakeRandomSource } from './FakeRandomSource.js';

const DEFAULT_SEATS = [
  { id: 's1', name: '하나' },
  { id: 's2', name: '두리' },
];

/**
 * 특정 상황의 Game을 스냅샷 복원으로 만든다(테스트 가독성 + 직렬화 왕복 검증).
 */
export function buildGame({
  seats = DEFAULT_SEATS,
  phase = PHASES.AWAIT_ROLL,
  turnIndex = 0,
  round = 1,
  roundLimit = null,
  cash = {},
  positions = {},
  eliminated = [],
  islandTurns = {},
  airportPending = [],
  consecutiveDoubles = {},
  loans = {},
  cities = [],
  jackpot = 0,
  drawPile = TICKETS.map((ticket) => ticket.id),
  casinoRoundsLeft = 0,
  rollWasDouble = false,
  debt = null,
  random = new FakeRandomSource(),
} = {}) {
  const players = seats.map((seat) => ({
    id: seat.id,
    name: seat.name,
    cash: cash[seat.id] ?? STARTING_CASH,
    position: positions[seat.id] ?? 0,
    eliminated: eliminated.includes(seat.id),
    islandRemainingTurns: islandTurns[seat.id] ?? 0,
    airportPending: airportPending.includes(seat.id),
    consecutiveDoubles: consecutiveDoubles[seat.id] ?? 0,
    loanUsed: loans[seat.id]?.used ?? false,
    loanDebt: loans[seat.id]?.debt ?? 0,
  }));

  const initialTotal = players.reduce((sum, player) => sum + player.cash, 0) + jackpot;

  const snapshot = {
    version: 0,
    phase,
    turnIndex,
    round,
    options: { roundLimit },
    initialTotal,
    players,
    board: cities.map((city) => ({
      index: city.index,
      ownerId: city.ownerId ?? null,
      buildings: city.buildings ?? [],
      landmark: city.landmark ?? false,
    })),
    deck: { drawPile },
    casino: { jackpot },
    ledger: { fromBank: 0, toBank: 0 },
    turn: { rollWasDouble, casinoRoundsLeft, debt },
  };

  return Game.restore(snapshot, random);
}

/** 이벤트 목록에서 특정 종류를 찾는다. */
export function findEvent(events, type) {
  return events.find((event) => event.type === type);
}

export function eventTypes(events) {
  return events.map((event) => event.type);
}

/** 돈의 보존 불변식: 총현금 + 잭팟 = 초기 총액 + 은행 순유입. */
export function assertMoneyConserved(game, label = '') {
  const report = game.moneyReport();
  assert.equal(
    report.balanced,
    true,
    `돈 보존 불변식 위반 ${label}: ${JSON.stringify(report)}`,
  );
}
