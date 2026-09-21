import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { MONEY_REASONS, MoneyIntent } from '../../src/domain/shared/MoneyIntent.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { assertMoneyConserved, buildGame, eventTypes } from '../support/gameBuilder.js';

/** 라운드 틱이 돌 때마다 라운드 번호를 기록하는 훅. */
function recordingHook(log, extra = {}) {
  return {
    name: 'probe',
    run({ round }) {
      log.push(round);
      return extra;
    },
  };
}

describe('Game 라운드 틱(구독 지점)', () => {
  it('좌석이 한 바퀴 돌면 틱이 정확히 1회 돌고, ROUND_ADVANCED 뒤에 훅 이벤트가 온다', () => {
    // Given (두 좌석, 두리 차례 → 한 수 두면 라운드가 넘어간다)
    const log = [];
    const game = buildGame({ turnIndex: 1, cash: { s2: 0 }, random: new FakeRandomSource([1, 2]) });
    game.registerRoundTickHook(
      recordingHook(log, { events: [{ type: EVENT_TYPES.JACKPOT_CHANGED, payload: { jackpot: 0 } }] }),
    );

    // When
    const events = game.execute('s2', COMMAND_TYPES.ROLL);

    // Then
    assert.deepEqual(log, [2], '라운드 틱은 ROUND_ADVANCED 1회당 1회');
    assert.equal(game.round, 2);
    const types = eventTypes(events);
    assert.ok(
      types.indexOf(EVENT_TYPES.ROUND_ADVANCED) < types.indexOf(EVENT_TYPES.JACKPOT_CHANGED),
      `훅 이벤트가 ROUND_ADVANCED보다 먼저 왔다: ${types.join(', ')}`,
    );
  });

  it('더블 추가 턴에는 라운드 틱이 돌지 않는다', () => {
    // Given (두리가 더블 → 같은 좌석이 한 번 더. 차례가 넘어가지 않으므로 틱도 없다)
    const log = [];
    const game = buildGame({ turnIndex: 1, cash: { s2: 0 }, random: new FakeRandomSource([3, 3]) });
    game.registerRoundTickHook(recordingHook(log));

    // When
    const events = game.execute('s2', COMMAND_TYPES.ROLL);

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.EXTRA_TURN), '더블 추가 턴이어야 한다');
    assert.equal(game.currentPlayerId, 's2');
    assert.equal(game.round, 1);
    assert.deepEqual(log, [], '더블로 거래 창구/틱을 여러 번 얻는 일은 없다');
  });

  it('라운드 제한으로 끝나는 전이에서는 틱을 돌리지 않는다', () => {
    // Given (제한 20라운드, 지금 20라운드 마지막 좌석 차례)
    const log = [];
    const game = buildGame({
      turnIndex: 1,
      round: 20,
      roundLimit: 20,
      cash: { s2: 0 },
      random: new FakeRandomSource([1, 2]),
    });
    game.registerRoundTickHook(recordingHook(log));

    // When
    const events = game.execute('s2', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.isOver(), true);
    assert.equal(game.round, 21);
    const types = eventTypes(events);
    assert.ok(types.includes(EVENT_TYPES.ROUND_ADVANCED));
    assert.ok(types.includes(EVENT_TYPES.GAME_OVER));
    assert.deepEqual(log, [], '플레이되지 않는 라운드의 사건으로 순위가 뒤집혀서는 안 된다');
  });

  it('훅이 낸 돈 이동 의사는 Treasury를 거쳐 적용되고 보존 불변식이 유지된다', () => {
    // Given (앞으로의 배당·이자가 붙는 자리)
    const game = buildGame({ turnIndex: 1, cash: { s2: 0 }, random: new FakeRandomSource([1, 2]) });
    const before = game.playerById('s1').cash;
    game.registerRoundTickHook({
      name: 'dividends',
      run: () => ({
        intents: [
          MoneyIntent.fromBank({ playerId: 's1', amount: 50_000, reason: MONEY_REASONS.SALARY }),
        ],
      }),
    });

    // When
    game.execute('s2', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').cash, before + 50_000);
    assertMoneyConserved(game, '틱 훅이 돈을 옮긴 뒤');
  });

  it('같은 이름의 훅을 두 번 등록할 수 없다', () => {
    // Given
    const game = buildGame();

    // When
    game.registerRoundTickHook(recordingHook([]));

    // Then
    assert.throws(() => game.registerRoundTickHook(recordingHook([])));
  });
});
