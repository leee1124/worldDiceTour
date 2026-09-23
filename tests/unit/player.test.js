import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Player, STARTING_CASH } from '../../src/domain/game/Player.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

const newPlayer = (overrides = {}) => new Player({ id: 'p1', name: '가나', ...overrides });

describe('Player(플레이어)', () => {
  it('시작 자금 10,000,000원과 출발 칸에서 시작한다', () => {
    // Given / When
    const player = newPlayer();

    // Then
    assert.equal(player.cash, STARTING_CASH);
    assert.equal(STARTING_CASH, 10_000_000);
    assert.equal(player.position, 0);
    assert.equal(player.eliminated, false);
  });

  describe('현금 지불과 수령', () => {
    it('지불하면 현금이 줄어든다', () => {
      // Given
      const player = newPlayer();

      // When
      player.pay(500_000);

      // Then
      assert.equal(player.cash, 9_500_000);
    });

    it('현금보다 많은 금액은 지불할 수 없다', () => {
      // Given
      const player = newPlayer({ cash: 100_000 });

      // When / Then
      assert.equal(player.canPay(100_001), false);
      assert.throws(() => player.pay(100_001), DomainError);
      assert.equal(player.cash, 100_000);
    });

    it('수령하면 현금이 늘어난다', () => {
      // Given
      const player = newPlayer({ cash: 0 });

      // When
      player.receive(200_000);

      // Then
      assert.equal(player.cash, 200_000);
    });

    it('음수 금액은 지불/수령할 수 없다', () => {
      // Given
      const player = newPlayer();

      // When / Then
      assert.throws(() => player.pay(-1), DomainError);
      assert.throws(() => player.receive(-1), DomainError);
    });
  });

  describe('조난 섬 상태', () => {
    it('조난되면 3턴 동안 갇힌다', () => {
      // Given
      const player = newPlayer();

      // When
      player.strand();

      // Then
      assert.equal(player.isStranded(), true);
      assert.equal(player.islandRemainingTurns, 3);
    });

    it('탈출 실패 턴마다 남은 턴이 줄고 0이 되면 자유로워진다', () => {
      // Given
      const player = newPlayer();
      player.strand();

      // When
      player.spendIslandTurn();
      player.spendIslandTurn();
      player.spendIslandTurn();

      // Then
      assert.equal(player.islandRemainingTurns, 0);
      assert.equal(player.isStranded(), false);
    });

    it('구조비를 내거나 더블로 탈출하면 즉시 자유로워진다', () => {
      // Given
      const player = newPlayer();
      player.strand();

      // When
      player.leaveIsland();

      // Then
      assert.equal(player.isStranded(), false);
    });
  });

  describe('공항 탑승권', () => {
    it('공항에 도착하면 다음 턴에 쓸 이동권을 얻는다', () => {
      // Given
      const player = newPlayer();

      // When
      player.grantAirportTicket();

      // Then
      assert.equal(player.airportPending, true);
    });

    it('이동권을 사용하면 소모된다', () => {
      // Given
      const player = newPlayer();
      player.grantAirportTicket();

      // When
      player.consumeAirportTicket();

      // Then
      assert.equal(player.airportPending, false);
    });
  });

  describe('연속 더블', () => {
    it('더블을 기록하면 연속 횟수가 누적된다', () => {
      // Given
      const player = newPlayer();

      // When
      player.recordDouble();
      player.recordDouble();

      // Then
      assert.equal(player.consecutiveDoubles, 2);
    });

    it('더블이 아니면 연속 횟수가 초기화된다', () => {
      // Given
      const player = newPlayer();
      player.recordDouble();

      // When
      player.resetDoubles();

      // Then
      assert.equal(player.consecutiveDoubles, 0);
    });
  });

  describe('이동', () => {
    it('특정 칸으로 순간이동할 수 있다', () => {
      // Given
      const player = newPlayer();

      // When
      player.moveTo(10);

      // Then
      assert.equal(player.position, 10);
    });
  });

  describe('바퀴(lap)', () => {
    it('1바퀴에서 시작한다', () => {
      // Given / When
      const player = newPlayer();

      // Then
      assert.equal(player.lap, 1);
    });

    it('바퀴를 올리면 1씩 늘어나고 새 바퀴 수를 돌려준다', () => {
      // Given
      const player = newPlayer();

      // When
      const second = player.advanceLap();
      const third = player.advanceLap();

      // Then
      assert.equal(second, 2);
      assert.equal(third, 3);
      assert.equal(player.lap, 3);
    });

    it('스냅샷에 바퀴 수가 담기고 그대로 복원된다', () => {
      // Given
      const player = newPlayer({ lap: 4 });

      // When
      const snapshot = player.toSnapshot();

      // Then
      assert.equal(snapshot.lap, 4);
      assert.equal(new Player({ ...snapshot }).lap, 4);
    });

    it('바퀴 수가 없는 예전 스냅샷은 1바퀴로 복원된다', () => {
      // Given / When
      const player = new Player({ id: 'p1', name: '가나' });

      // Then
      assert.equal(player.lap, 1);
    });

    it('1 미만이거나 정수가 아닌 바퀴 수는 거부한다', () => {
      // Given / When / Then
      for (const lap of [0, -3, 1.5, '2']) {
        assert.throws(() => newPlayer({ lap }), DomainError, `바퀴 값 ${String(lap)}을 통과시켰다`);
      }
    });
  });

  it('파산하면 탈락 처리되고 현금이 0이 된다', () => {
    // Given
    const player = newPlayer();

    // When
    player.eliminate();

    // Then
    assert.equal(player.eliminated, true);
    assert.equal(player.cash, 0);
  });
});
