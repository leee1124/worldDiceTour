import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RoundClock, TURN_OUTCOMES } from '../../src/domain/game/RoundClock.js';
import { EVENT_TYPES, GAME_OVER_REASONS } from '../../src/domain/game/events.js';
import { MONEY_REASONS } from '../../src/domain/shared/MoneyIntent.js';
import { MoneyIntent } from '../../src/domain/shared/MoneyIntent.js';

/** 탈락 여부만 있는 가짜 좌석들. RoundClock은 그 이상을 알 필요가 없다. */
const seats = (...flags) => flags.map((eliminated, index) => ({ id: `s${index + 1}`, eliminated }));

/** 이름을 기록하는 틱 훅. */
function probeHook(name, log, extra = {}) {
  return {
    name,
    run(context) {
      log.push({ name, round: context.round, players: context.players.length });
      return extra;
    },
  };
}

describe('RoundClock(라운드 전이와 틱 훅)', () => {
  describe('턴 넘기기', () => {
    it('한 바퀴 안에서는 라운드가 그대로이고 틱 훅도 돌지 않는다', () => {
      // Given
      const log = [];
      const clock = new RoundClock({ round: 3, turnIndex: 0 });
      clock.registerTick(probeHook('market', log));

      // When
      const result = clock.advance({ players: seats(false, false, false) });

      // Then
      assert.equal(result.outcome, TURN_OUTCOMES.BEGIN_TURN);
      assert.equal(clock.turnIndex, 1);
      assert.equal(clock.round, 3);
      assert.deepEqual(result.events, []);
      assert.deepEqual(log, [], '한 바퀴를 돌지 않았으면 틱이 없다');
    });

    it('좌석 순서가 한 바퀴 돌면 라운드가 1 오르고 ROUND_ADVANCED를 낸다', () => {
      // Given
      const clock = new RoundClock({ round: 1, turnIndex: 2 });

      // When
      const result = clock.advance({ players: seats(false, false, false) });

      // Then
      assert.equal(result.outcome, TURN_OUTCOMES.BEGIN_TURN);
      assert.equal(clock.turnIndex, 0);
      assert.equal(clock.round, 2);
      assert.deepEqual(result.events, [
        { type: EVENT_TYPES.ROUND_ADVANCED, payload: { round: 2 } },
      ]);
    });

    it('탈락한 좌석은 건너뛴다', () => {
      // Given (s2가 탈락)
      const clock = new RoundClock({ round: 1, turnIndex: 0 });

      // When
      const result = clock.advance({ players: seats(false, true, false) });

      // Then
      assert.equal(clock.turnIndex, 2);
      assert.equal(clock.round, 1, '배열 인덱스를 넘지 않았으므로 라운드는 그대로');
      assert.deepEqual(result.events, []);
    });

    it('탈락자를 건너뛰다 배열 끝을 넘으면 라운드가 오른다', () => {
      // Given (마지막 좌석이 탈락 → 0번으로 wrap)
      const clock = new RoundClock({ round: 4, turnIndex: 1 });

      // When
      clock.advance({ players: seats(false, false, true) });

      // Then
      assert.equal(clock.turnIndex, 0);
      assert.equal(clock.round, 5);
    });

    it('생존자가 없으면 마지막 생존자 승리로 게임이 끝난다', () => {
      // Given
      const clock = new RoundClock({ round: 2, turnIndex: 0 });

      // When
      const result = clock.advance({ players: seats(true, true) });

      // Then
      assert.equal(result.outcome, TURN_OUTCOMES.GAME_OVER);
      assert.equal(result.reason, GAME_OVER_REASONS.LAST_SURVIVOR);
      assert.equal(clock.round, 2, '게임이 끝나면 라운드를 올리지 않는다');
    });

    it('자기 자신만 남았으면 같은 좌석이 다시 차례가 되고 라운드가 오른다', () => {
      // Given
      const clock = new RoundClock({ round: 7, turnIndex: 1 });

      // When
      const result = clock.advance({ players: seats(true, false, true) });

      // Then
      assert.equal(result.outcome, TURN_OUTCOMES.BEGIN_TURN);
      assert.equal(clock.turnIndex, 1);
      assert.equal(clock.round, 8);
    });
  });

  describe('라운드 제한', () => {
    it('제한을 넘기면 ROUND_LIMIT으로 끝나고 ROUND_ADVANCED는 그대로 남는다', () => {
      // Given
      const clock = new RoundClock({ round: 20, turnIndex: 1, roundLimit: 20 });

      // When
      const result = clock.advance({ players: seats(false, false) });

      // Then
      assert.equal(result.outcome, TURN_OUTCOMES.GAME_OVER);
      assert.equal(result.reason, GAME_OVER_REASONS.ROUND_LIMIT);
      assert.equal(clock.round, 21);
      assert.deepEqual(result.events, [
        { type: EVENT_TYPES.ROUND_ADVANCED, payload: { round: 21 } },
      ]);
    });

    it('라운드 제한으로 끝나는 전이에서는 틱 훅을 돌리지 않는다', () => {
      // Given (절대 플레이되지 않는 라운드의 시세·뉴스로 최종 순위가 뒤집히면 부당하다)
      const log = [];
      const clock = new RoundClock({ round: 20, turnIndex: 1, roundLimit: 20 });
      clock.registerTick(probeHook('market', log));

      // When
      clock.advance({ players: seats(false, false) });

      // Then
      assert.deepEqual(log, [], '끝나는 전이에서는 틱이 돌지 않아야 한다');
    });

    it('제한에 닿지 않았으면 틱 훅이 돈다', () => {
      // Given
      const log = [];
      const clock = new RoundClock({ round: 19, turnIndex: 1, roundLimit: 20 });
      clock.registerTick(probeHook('market', log));

      // When
      const result = clock.advance({ players: seats(false, false) });

      // Then
      assert.equal(result.outcome, TURN_OUTCOMES.BEGIN_TURN);
      assert.deepEqual(log, [{ name: 'market', round: 20, players: 2 }]);
    });

    it('제한이 없으면 라운드가 끝없이 오른다', () => {
      // Given
      const clock = new RoundClock({ round: 999, turnIndex: 1, roundLimit: null });

      // When
      const result = clock.advance({ players: seats(false, false) });

      // Then
      assert.equal(result.outcome, TURN_OUTCOMES.BEGIN_TURN);
      assert.equal(clock.round, 1_000);
    });
  });

  describe('틱 훅 목록(확장 지점)', () => {
    it('등록 순서대로 실행된다', () => {
      // Given (설계상 순서: 시장 → 대출 → 파생 → 리포트)
      const log = [];
      const clock = new RoundClock({ round: 1, turnIndex: 1 });
      for (const name of ['market', 'loanBook', 'markToMarket', 'recorder']) {
        clock.registerTick(probeHook(name, log));
      }

      // When
      clock.advance({ players: seats(false, false) });

      // Then
      assert.deepEqual(
        log.map((entry) => entry.name),
        ['market', 'loanBook', 'markToMarket', 'recorder'],
      );
      assert.deepEqual(clock.tickHookNames, ['market', 'loanBook', 'markToMarket', 'recorder']);
    });

    it('훅이 낸 이벤트는 ROUND_ADVANCED 뒤에, 등록 순서대로 모인다', () => {
      // Given
      const clock = new RoundClock({ round: 1, turnIndex: 1 });
      clock.registerTick({
        name: 'first',
        run: () => ({ events: [{ type: EVENT_TYPES.JACKPOT_CHANGED, payload: { jackpot: 1 } }] }),
      });
      clock.registerTick({
        name: 'second',
        run: () => ({ events: [{ type: EVENT_TYPES.JACKPOT_CHANGED, payload: { jackpot: 2 } }] }),
      });

      // When
      const result = clock.advance({ players: seats(false, false) });

      // Then
      assert.deepEqual(result.events, [
        { type: EVENT_TYPES.ROUND_ADVANCED, payload: { round: 2 } },
        { type: EVENT_TYPES.JACKPOT_CHANGED, payload: { jackpot: 1 } },
        { type: EVENT_TYPES.JACKPOT_CHANGED, payload: { jackpot: 2 } },
      ]);
    });

    it('훅이 낸 돈 이동 의사를 모아 돌려준다(훅은 돈을 직접 만지지 않는다)', () => {
      // Given
      const intent = MoneyIntent.fromBank({
        playerId: 's1',
        amount: 1_000,
        reason: MONEY_REASONS.SALARY,
      });
      const clock = new RoundClock({ round: 1, turnIndex: 1 });
      clock.registerTick({ name: 'dividends', run: () => ({ intents: [intent] }) });

      // When
      const result = clock.advance({ players: seats(false, false) });

      // Then
      assert.deepEqual(result.intents, [intent]);
    });

    it('아무것도 돌려주지 않는 훅도 허용한다', () => {
      // Given
      const clock = new RoundClock({ round: 1, turnIndex: 1 });
      clock.registerTick({ name: 'silent', run: () => undefined });

      // When
      const result = clock.advance({ players: seats(false, false) });

      // Then
      assert.deepEqual(result.intents, []);
      assert.deepEqual(result.events, [
        { type: EVENT_TYPES.ROUND_ADVANCED, payload: { round: 2 } },
      ]);
    });

    it('같은 이름의 훅이나 형태가 틀린 훅은 거부한다', () => {
      // Given
      const clock = new RoundClock({ round: 1, turnIndex: 0 });
      clock.registerTick(probeHook('market', []));

      // When / Then
      assert.throws(() => clock.registerTick(probeHook('market', [])));
      assert.throws(() => clock.registerTick({ name: 'noRun' }));
      assert.throws(() => clock.registerTick({ run: () => {} }));
    });
  });
});
