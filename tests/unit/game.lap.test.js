import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { SALARY, STARTING_CASH } from '../../src/domain/game/Player.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { buildGame, eventTypes, findEvent } from '../support/gameBuilder.js';

/** 행운 티켓 칸(2번)에 도착시키고 지정한 티켓 한 장만 남긴다. */
const ticketGame = (ticketId, options = {}) =>
  buildGame({
    positions: { s1: 0 },
    drawPile: [ticketId],
    random: new FakeRandomSource([1, 1, 0]),
    ...options,
  });

const lapOf = (game, seatId) => game.playerById(seatId).lap;

describe('Game(바퀴 수 증가)', () => {
  it('주사위로 출발 칸을 지나가면 바퀴가 오른다', () => {
    // Given (38번 칸에서 3칸 → 1번 하노이, 출발 칸 통과)
    const game = buildGame({ positions: { s1: 38 }, random: new FakeRandomSource([1, 2]) });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(lapOf(game, 's1'), 2);
    assert.deepEqual(findEvent(events, EVENT_TYPES.LAP_ADVANCED), {
      type: EVENT_TYPES.LAP_ADVANCED,
      playerId: 's1',
      lap: 2,
    });
  });

  it('바퀴 증가는 월급 지급보다 먼저 알린다', () => {
    // Given
    const game = buildGame({ positions: { s1: 38 }, random: new FakeRandomSource([1, 2]) });

    // When
    const types = eventTypes(game.execute('s1', COMMAND_TYPES.ROLL));

    // Then
    assert.ok(types.includes(EVENT_TYPES.LAP_ADVANCED), '바퀴 증가 이벤트가 없습니다');
    assert.ok(
      types.indexOf(EVENT_TYPES.LAP_ADVANCED) < types.indexOf(EVENT_TYPES.SALARY_PAID),
      `이벤트 순서가 어긋났습니다: ${types.join(' → ')}`,
    );
  });

  it('출발 칸에 정확히 도착해도 바퀴가 오른다', () => {
    // Given (37번 칸에서 3칸 → 0번 출발)
    const game = buildGame({ positions: { s1: 37 }, random: new FakeRandomSource([1, 2]) });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').position, 0);
    assert.equal(lapOf(game, 's1'), 2);
  });

  it('뒤로 밀려 출발 칸에 도착하면 바퀴가 오르지 않는다', () => {
    // Given (2번 티켓 칸 → 역풍으로 뒤로 2칸 → 0번 출발)
    const game = ticketGame('T10');

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').position, 0);
    assert.equal(lapOf(game, 's1'), 1);
    assert.equal(findEvent(events, EVENT_TYPES.LAP_ADVANCED), undefined);
  });

  it('월급이 대출 상환에 전액 압류돼도 바퀴는 오른다', () => {
    // Given (채무가 남은 플레이어가 출발 칸을 지난다)
    const game = buildGame({
      positions: { s1: 38 },
      loans: { s1: { used: true, debt: 1_200_000 } },
      random: new FakeRandomSource([1, 2]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(findEvent(events, EVENT_TYPES.SALARY_SEIZED).amount, SALARY);
    assert.equal(findEvent(events, EVENT_TYPES.SALARY_PAID), undefined);
    assert.equal(lapOf(game, 's1'), 2);
    assert.equal(findEvent(events, EVENT_TYPES.LAP_ADVANCED).lap, 2);
  });

  it('더블로 한 번 더 굴려도 한 번 지난 바퀴는 한 번만 오른다', () => {
    // Given (39번 칸에서 더블 1+1 → 1번 하노이, 출발 통과 후 추가 턴)
    const game = buildGame({
      positions: { s1: 39 },
      random: new FakeRandomSource([1, 1, 3, 2]),
    });

    // When
    const first = game.execute('s1', COMMAND_TYPES.ROLL);
    game.execute('s1', COMMAND_TYPES.SKIP_BUY);

    // Then (추가 턴을 받고도 바퀴는 2에 머문다)
    assert.equal(first.filter((event) => event.type === EVENT_TYPES.LAP_ADVANCED).length, 1);
    assert.equal(game.currentPlayerId, 's1');
    assert.equal(game.phase, PHASES.AWAIT_ROLL);
    assert.equal(lapOf(game, 's1'), 2);

    // When (추가 턴에서 출발 칸을 지나지 않으면)
    const second = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(findEvent(second, EVENT_TYPES.LAP_ADVANCED), undefined);
    assert.equal(lapOf(game, 's1'), 2);
  });

  it('한 커맨드에서 출발 칸을 두 번 지나면 바퀴도 두 번 오른다', () => {
    // Given (39번 칸에서 3칸 → 2번 행운 티켓 칸[출발 통과] → 출발 칸 직행 티켓으로 또 한 바퀴)
    const game = buildGame({
      positions: { s1: 39 },
      drawPile: ['T11'],
      random: new FakeRandomSource([1, 2, 0]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then (월급도 두 번 나오므로 바퀴도 두 번 오른다 — 명세 10장 D22)
    assert.deepEqual(
      events.filter((event) => event.type === EVENT_TYPES.LAP_ADVANCED).map((event) => event.lap),
      [2, 3],
    );
    assert.equal(events.filter((event) => event.type === EVENT_TYPES.SALARY_PAID).length, 2);
    assert.equal(lapOf(game, 's1'), 3);
    assert.equal(game.moneyReport().balanced, true);
  });

  it('공항 이동으로 출발 칸을 지나면 바퀴가 오른다', () => {
    // Given (공항 칸에서 이동권을 든 채 3번 방콕으로 날아간다)
    const game = buildGame({
      positions: { s1: 30 },
      airportPending: ['s1'],
      phase: PHASES.AWAIT_TRAVEL,
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.TRAVEL, { destination: 3 });

    // Then
    assert.equal(findEvent(events, EVENT_TYPES.SALARY_PAID).amount, SALARY);
    assert.equal(findEvent(events, EVENT_TYPES.LAP_ADVANCED).lap, 2);
    assert.equal(lapOf(game, 's1'), 2);
  });

  it('출발 칸 직행 티켓도 바퀴를 올린다', () => {
    // Given (2번 티켓 칸 → 출발 칸으로 직행)
    const game = ticketGame('T11');

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').position, 0);
    assert.equal(findEvent(events, EVENT_TYPES.SALARY_PAID).amount, SALARY);
    assert.equal(lapOf(game, 's1'), 2);
  });

  it('조난 섬으로 이송되면 바퀴가 오르지 않는다', () => {
    // Given (폭풍우 티켓)
    const game = ticketGame('T13');

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(lapOf(game, 's1'), 1);
    assert.equal(findEvent(events, EVENT_TYPES.LAP_ADVANCED), undefined);
    assert.equal(game.playerById('s1').cash, STARTING_CASH);
  });

  it('3연속 더블로 조난 섬에 이송돼도 바퀴가 오르지 않는다', () => {
    // Given (이미 두 번 더블을 굴린 39번 칸의 플레이어)
    const game = buildGame({
      positions: { s1: 39 },
      consecutiveDoubles: { s1: 2 },
      random: new FakeRandomSource([3, 3]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.STRANDED));
    assert.equal(lapOf(game, 's1'), 1);
    assert.equal(findEvent(events, EVENT_TYPES.LAP_ADVANCED), undefined);
  });

  it('바퀴 수는 스냅샷에 저장되고 그대로 복원된다', () => {
    // Given
    const game = buildGame({ laps: { s1: 3, s2: 2 }, random: new FakeRandomSource([1, 2]) });

    // When
    const snapshot = game.toSnapshot();

    // Then
    assert.deepEqual(
      snapshot.players.map((player) => player.lap),
      [3, 2],
    );
  });
});
