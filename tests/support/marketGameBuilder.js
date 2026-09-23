import { Game } from '../../src/domain/game/Game.js';
import { STARTING_CASH } from '../../src/domain/game/Player.js';
import { TICKETS } from '../../src/domain/game/data/tickets.js';
import { DEFAULT_FINANCE_OPTIONS } from '../../src/domain/room/FinanceOptions.js';
import { FakeRandomSource } from './FakeRandomSource.js';
import { ScriptedRandomSource } from './ScriptedRandomSource.js';

const DEFAULT_SEATS = [
  { id: 's1', name: '하나' },
  { id: 's2', name: '두리' },
  { id: 's3', name: '세찌' },
];

/**
 * 투자 모드가 켜진 게임을 **새 판으로 시작해** 만든다.
 *
 * 거래 창구는 **턴이 시작될 때** 열리므로, 복원만으로는 창구가 열린 상태를 재현할 수 없다
 * (복원은 페이즈를 그대로 되살리는 것이 옳다). 그래서 상태를 복원한 뒤 `Game.restore`의
 * 테스트 전용 seam `beginTurn`으로 **실제 턴 시작 경로를 그대로 태운다** — 창구가 열릴지,
 * 무엇이 먼저 나올지를 빌더가 흉내내지 않고 도메인이 결정한다.
 */
export function buildStockGame({
  seats = 2,
  investmentMode = 'STOCKS',
  roundLimit = null,
  cash = {},
  positions = {},
  laps = {},
  eliminated = [],
  islandTurns = {},
  airportPending = [],
  cities = [],
  drawPile = TICKETS.map((ticket) => ticket.id),
  random = new ScriptedRandomSource(),
} = {}) {
  const seatList = DEFAULT_SEATS.slice(0, seats);
  const started = Game.start({
    players: seatList,
    options: { roundLimit, finance: { ...DEFAULT_FINANCE_OPTIONS, investmentMode } },
    random: new FakeRandomSource(),
  });

  const snapshot = started.toSnapshot();
  const players = snapshot.players.map((player) => ({
    ...player,
    cash: cash[player.id] ?? STARTING_CASH,
    position: positions[player.id] ?? 0,
    lap: laps[player.id] ?? player.lap,
    eliminated: eliminated.includes(player.id),
    islandRemainingTurns: islandTurns[player.id] ?? 0,
    airportPending: airportPending.includes(player.id),
  }));

  const restored = Game.restore(
    {
      ...snapshot,
      // 아직 아무 일도 없었던 판으로 되돌린다(초기 총액은 바꾼 현금 합계로 맞춘다).
      phase: 'AWAIT_ROLL',
      turn: { rollWasDouble: false, casinoRoundsLeft: 0, buildIndex: null, acquireIndex: null, debt: null, afterTrade: null },
      players,
      initialTotal: players.reduce((sum, player) => sum + player.cash, 0),
      board: cities.map((city) => ({
        index: city.index,
        ownerId: city.ownerId ?? null,
        buildings: city.buildings ?? [],
        landmark: city.landmark ?? false,
      })),
      deck: { drawPile },
      market: snapshot.market,
    },
    random,
    { beginTurn: true },
  );

  return restored;
}
