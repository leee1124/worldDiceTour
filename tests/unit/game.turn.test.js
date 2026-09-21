import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../../src/domain/game/Game.js';
import { PHASES } from '../../src/domain/game/phases.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { STARTING_CASH, SALARY } from '../../src/domain/game/Player.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { buildGame, eventTypes, findEvent, assertMoneyConserved } from '../support/gameBuilder.js';

describe('Game(게임 시작과 턴 진행)', () => {
  describe('게임 시작', () => {
    it('모든 플레이어가 출발 칸에서 3,000,000원으로 시작하고 첫 플레이어는 주사위 차례다', () => {
      // Given
      const seats = [
        { id: 's1', name: '하나' },
        { id: 's2', name: '두리' },
        { id: 's3', name: '세찌' },
      ];

      // When
      const game = Game.start({ players: seats, random: new FakeRandomSource() });

      // Then
      assert.equal(game.phase, PHASES.AWAIT_ROLL);
      assert.equal(game.currentPlayerId, 's1');
      assert.equal(game.round, 1);
      assert.equal(
        game.players.every((player) => player.cash === STARTING_CASH && player.position === 0),
        true,
      );
      assertMoneyConserved(game, '시작 직후');
    });

    it('2명 미만이면 시작할 수 없다', () => {
      // Given
      const seats = [{ id: 's1', name: '하나' }];

      // When / Then
      assert.throws(() => Game.start({ players: seats, random: new FakeRandomSource() }), {
        code: DOMAIN_ERROR_CODES.NOT_ENOUGH_SEATS,
      });
    });

    it('5명 이상이면 시작할 수 없다', () => {
      // Given
      const seats = [1, 2, 3, 4, 5].map((n) => ({ id: `s${n}`, name: `이름${n}` }));

      // When / Then
      assert.throws(() => Game.start({ players: seats, random: new FakeRandomSource() }), {
        code: DOMAIN_ERROR_CODES.NOT_ENOUGH_SEATS,
      });
    });
  });

  describe('주사위와 이동', () => {
    it('주사위 합만큼 이동하고 이동 이벤트를 남긴다', () => {
      // Given
      const game = buildGame({ random: new FakeRandomSource([2, 5, 0]) });

      // When
      const events = game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      const rolled = findEvent(events, EVENT_TYPES.DICE_ROLLED);
      const moved = findEvent(events, EVENT_TYPES.MOVED);
      assert.deepEqual(
        { die1: rolled.die1, die2: rolled.die2, sum: rolled.sum },
        { die1: 2, die2: 5, sum: 7 },
      );
      assert.equal(moved.to, 7);
      assert.equal(game.playerById('s1').position, 7);
    });

    it('출발 칸을 지나면 월급 200,000원을 받는다', () => {
      // Given
      const game = buildGame({ positions: { s1: 38 }, random: new FakeRandomSource([2, 3]) });

      // When
      const events = game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      const salary = findEvent(events, EVENT_TYPES.SALARY_PAID);
      assert.equal(salary.amount, SALARY);
      assert.equal(game.playerById('s1').cash, STARTING_CASH + SALARY);
      assertMoneyConserved(game, '월급 수령 후');
    });

    it('커맨드를 처리할 때마다 version이 1씩 증가한다', () => {
      // Given
      const game = buildGame({ random: new FakeRandomSource([2, 3]) });
      const before = game.version;

      // When
      game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      assert.equal(game.version, before + 1);
    });
  });

  describe('도시 매입', () => {
    it('빈 도시에 도착하면 매입 여부를 묻는다', () => {
      // Given
      const game = buildGame({ random: new FakeRandomSource([1, 2]) });

      // When
      game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      assert.equal(game.phase, PHASES.AWAIT_BUY);
      assert.equal(game.pendingDecision.kind, 'BUY');
      assert.equal(game.pendingDecision.index, 3);
      assert.equal(game.pendingDecision.price, 70_000);
    });

    it('매입하면 가격을 지불하고 소유자가 된다', () => {
      // Given
      const game = buildGame({ positions: { s1: 0 }, random: new FakeRandomSource([1, 2]) });
      game.execute('s1', COMMAND_TYPES.ROLL);

      // When
      const events = game.execute('s1', COMMAND_TYPES.BUY);

      // Then
      assert.equal(game.playerById('s1').cash, STARTING_CASH - 70_000);
      assert.equal(game.board.cityAt(3).isOwnedBy('s1'), true);
      assert.equal(findEvent(events, EVENT_TYPES.CITY_PURCHASED).price, 70_000);
      assert.equal(game.phase, PHASES.AWAIT_BUILD, '매입 직후 건설 기회가 주어진다');
      game.execute('s1', COMMAND_TYPES.SKIP_BUILD);
      assert.equal(game.currentPlayerId, 's2');
      assertMoneyConserved(game, '매입 후');
    });

    it('매입을 건너뛰면 소유자 없이 턴이 끝난다', () => {
      // Given
      const game = buildGame({ random: new FakeRandomSource([1, 2]) });
      game.execute('s1', COMMAND_TYPES.ROLL);

      // When
      const events = game.execute('s1', COMMAND_TYPES.SKIP_BUY);

      // Then
      assert.equal(game.board.cityAt(3).isOwned(), false);
      assert.ok(eventTypes(events).includes(EVENT_TYPES.PURCHASE_DECLINED));
      assert.equal(game.currentPlayerId, 's2');
    });

    it('현금이 가격보다 적으면 매입 단계 없이 턴이 끝난다', () => {
      // Given
      const game = buildGame({ cash: { s1: 10_000 }, random: new FakeRandomSource([1, 2]) });

      // When
      game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      assert.equal(game.phase, PHASES.AWAIT_ROLL);
      assert.equal(game.currentPlayerId, 's2');
    });
  });

  describe('통행료', () => {
    it('남의 도시에 도착하면 통행료를 소유자에게 지불한다', () => {
      // Given (방콕 70,000원 + 별장 → 배율 0.4)
      const game = buildGame({
        cities: [{ index: 3, ownerId: 's2', buildings: ['VILLA'] }],
        random: new FakeRandomSource([1, 2]),
      });

      // When
      const events = game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      const toll = findEvent(events, EVENT_TYPES.TOLL_PAID);
      assert.equal(toll.amount, 28_000);
      assert.equal(game.playerById('s1').cash, STARTING_CASH - 28_000);
      assert.equal(game.playerById('s2').cash, STARTING_CASH + 28_000);
      assertMoneyConserved(game, '통행료 후');
    });

    it('휴양지 통행료는 소유자의 휴양지 수 × 50,000원이다', () => {
      // Given
      const game = buildGame({
        cities: [
          { index: 5, ownerId: 's2' },
          { index: 15, ownerId: 's2' },
        ],
        random: new FakeRandomSource([2, 3]),
      });

      // When
      const events = game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      assert.equal(findEvent(events, EVENT_TYPES.TOLL_PAID).amount, 100_000);
    });

    it('탈락한 소유자의 도시는 통행료가 없다', () => {
      // Given
      const game = buildGame({
        seats: [
          { id: 's1', name: '하나' },
          { id: 's2', name: '두리' },
          { id: 's3', name: '세찌' },
        ],
        eliminated: ['s3'],
        cities: [{ index: 3, ownerId: 's3' }],
        random: new FakeRandomSource([1, 2]),
      });

      // When
      const events = game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      assert.equal(findEvent(events, EVENT_TYPES.TOLL_PAID), undefined);
      assert.equal(game.playerById('s1').cash, STARTING_CASH);
    });
  });

  describe('더블과 턴 넘김', () => {
    it('더블이면 같은 플레이어가 한 번 더 굴린다', () => {
      // Given
      const game = buildGame({ random: new FakeRandomSource([3, 3]) });

      // When
      game.execute('s1', COMMAND_TYPES.ROLL);
      const events = game.execute('s1', COMMAND_TYPES.SKIP_BUY);

      // Then
      assert.ok(eventTypes(events).includes(EVENT_TYPES.EXTRA_TURN));
      assert.equal(game.currentPlayerId, 's1');
      assert.equal(game.phase, PHASES.AWAIT_ROLL);
    });

    it('실제 굴림으로 쌓인 연속 더블 횟수는 턴이 넘어간 뒤 초기화된다', () => {
      // Given (28에서 더블로 공항(30)에 도착하면 추가 턴 없이 턴이 끝난다)
      const game = buildGame({
        positions: { s1: 28 },
        random: new FakeRandomSource([1, 1, 1, 2]),
      });

      // When
      game.execute('s1', COMMAND_TYPES.ROLL);

      // Then (더블 횟수가 실제로 쌓인 채 턴이 넘어갔다)
      assert.equal(game.playerById('s1').consecutiveDoubles, 1);
      assert.equal(game.currentPlayerId, 's2');

      // When (s2가 턴을 끝내 다시 s1 차례가 된다)
      game.execute('s2', COMMAND_TYPES.ROLL);
      game.execute('s2', COMMAND_TYPES.SKIP_BUY);

      // Then
      assert.equal(game.currentPlayerId, 's1');
      assert.equal(game.playerById('s1').consecutiveDoubles, 0, '내 턴이 시작될 때 초기화된다');
    });

    it('추가 턴으로 이어지는 동안에는 연속 더블 횟수가 쌓인다', () => {
      // Given (0 → 더블 4 → 4번 칸, 매입 포기 후 추가 턴)
      const game = buildGame({ random: new FakeRandomSource([2, 2, 1, 1]) });

      // When
      game.execute('s1', COMMAND_TYPES.ROLL);
      game.execute('s1', COMMAND_TYPES.SKIP_BUY);

      // Then
      assert.equal(game.currentPlayerId, 's1');
      assert.equal(game.playerById('s1').consecutiveDoubles, 1);

      // When (두 번째 더블)
      game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      assert.equal(game.playerById('s1').consecutiveDoubles, 2);
    });

    it('턴이 시작되면 턴 임시 상태가 완전히 초기화된다', () => {
      // Given (방콕을 매입해 건설 기회를 받고 건설까지 마친다)
      const game = buildGame({
        cash: { s1: 1_000_000 },
        random: new FakeRandomSource([1, 2, 1, 2]),
      });
      game.execute('s1', COMMAND_TYPES.ROLL);
      game.execute('s1', COMMAND_TYPES.BUY);
      assert.equal(game.phase, PHASES.AWAIT_BUILD);
      assert.equal(game.toSnapshot().turn.buildIndex, 3, '건설 대상 칸이 기록돼 있다');

      // When (건설로 턴을 끝내고 다음 플레이어 턴이 시작된다)
      game.execute('s1', COMMAND_TYPES.BUILD, { buildings: ['VILLA'] });

      // Then (이전 턴의 흔적이 남지 않는다)
      assert.equal(game.currentPlayerId, 's2');
      assert.deepEqual(game.toSnapshot().turn, {
        rollWasDouble: false,
        casinoRoundsLeft: 0,
        debt: null,
        buildIndex: null,
        acquireIndex: null,
      });
    });

    it('3연속 더블이면 이동 없이 조난 섬으로 이송된다', () => {
      // Given
      const game = buildGame({
        positions: { s1: 4 },
        consecutiveDoubles: { s1: 2 },
        random: new FakeRandomSource([3, 3]),
      });

      // When
      const events = game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      assert.ok(eventTypes(events).includes(EVENT_TYPES.STRANDED));
      assert.equal(game.playerById('s1').position, 10);
      assert.equal(game.playerById('s1').isStranded(), true);
      assert.equal(game.currentPlayerId, 's2');
    });

    it('다음 플레이어를 한 바퀴 돌면 라운드가 증가한다', () => {
      // Given
      const random = new FakeRandomSource([1, 2, 1, 2]);
      const game = buildGame({ random });

      // When
      game.execute('s1', COMMAND_TYPES.ROLL);
      game.execute('s1', COMMAND_TYPES.SKIP_BUY);
      const events = game.execute('s2', COMMAND_TYPES.ROLL);

      // Then
      assert.equal(game.round, 1);
      assert.equal(game.currentPlayerId, 's2');
      assert.equal(eventTypes(events).includes(EVENT_TYPES.ROUND_ADVANCED), false);
      game.execute('s2', COMMAND_TYPES.SKIP_BUY);
      assert.equal(game.round, 2);
      assert.equal(game.currentPlayerId, 's1');
    });

    it('탈락한 플레이어는 턴을 받지 않는다', () => {
      // Given
      const game = buildGame({
        seats: [
          { id: 's1', name: '하나' },
          { id: 's2', name: '두리' },
          { id: 's3', name: '세찌' },
        ],
        eliminated: ['s2'],
        random: new FakeRandomSource([1, 2]),
      });

      // When
      game.execute('s1', COMMAND_TYPES.ROLL);
      game.execute('s1', COMMAND_TYPES.SKIP_BUY);

      // Then
      assert.equal(game.currentPlayerId, 's3');
    });
  });

  describe('세관', () => {
    it('현금의 10%를 납부하고 잭팟에 적립된다', () => {
      // Given
      const game = buildGame({
        positions: { s1: 15 },
        cash: { s1: 1_234_567 },
        random: new FakeRandomSource([1, 2]),
      });

      // When
      const events = game.execute('s1', COMMAND_TYPES.ROLL);

      // Then
      const tax = findEvent(events, EVENT_TYPES.TAX_PAID);
      assert.equal(tax.amount, 123_456);
      assert.equal(game.jackpot, 123_456);
      assert.equal(game.playerById('s1').cash, 1_234_567 - 123_456);
      assertMoneyConserved(game, '세관 후');
    });
  });

  describe('권한과 페이즈 검증', () => {
    it('자기 차례가 아니면 커맨드가 거부되고 상태가 변하지 않는다', () => {
      // Given
      const game = buildGame({ random: new FakeRandomSource([1, 2]) });
      const before = game.version;

      // When / Then
      assert.throws(() => game.execute('s2', COMMAND_TYPES.ROLL), {
        code: DOMAIN_ERROR_CODES.NOT_YOUR_TURN,
      });
      assert.equal(game.version, before);
      assert.equal(game.phase, PHASES.AWAIT_ROLL);
    });

    it('현재 페이즈에서 허용되지 않은 커맨드는 거부된다', () => {
      // Given
      const game = buildGame({ random: new FakeRandomSource([1, 2]) });
      const before = game.version;

      // When / Then
      assert.throws(() => game.execute('s1', COMMAND_TYPES.BUY), {
        code: DOMAIN_ERROR_CODES.INVALID_PHASE,
      });
      assert.equal(game.version, before);
    });

    it('알 수 없는 커맨드는 거부된다', () => {
      // Given
      const game = buildGame();

      // When / Then
      assert.throws(() => game.execute('s1', 'HACK'), {
        code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
      });
    });

    it('존재하지 않는 좌석의 커맨드는 거부된다', () => {
      // Given
      const game = buildGame();

      // When / Then
      assert.throws(() => game.execute('unknown', COMMAND_TYPES.ROLL), {
        code: DOMAIN_ERROR_CODES.NOT_YOUR_TURN,
      });
    });
  });

  describe('직렬화', () => {
    it('스냅샷으로 저장하고 복원하면 상태가 같다', () => {
      // Given
      const game = buildGame({ random: new FakeRandomSource([1, 2]) });
      game.execute('s1', COMMAND_TYPES.ROLL);

      // When
      const snapshot = game.toSnapshot();
      const restored = Game.restore(snapshot, new FakeRandomSource());

      // Then
      assert.deepEqual(restored.toSnapshot(), snapshot);
      assert.equal(restored.phase, game.phase);
      assert.equal(restored.currentPlayerId, game.currentPlayerId);
    });
  });
});
