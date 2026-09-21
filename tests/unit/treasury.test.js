import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BankLedger } from '../../src/domain/game/BankLedger.js';
import { Casino } from '../../src/domain/game/Casino.js';
import { Player } from '../../src/domain/game/Player.js';
import { Treasury } from '../../src/domain/game/Treasury.js';
import { DOMAIN_ERROR_CODES, DomainError } from '../../src/domain/shared/DomainError.js';
import { MAX_MONEY } from '../../src/domain/shared/Money.js';
import { MoneyIntent } from '../../src/domain/shared/MoneyIntent.js';
import { MONEY_REASONS } from '../../src/domain/game/events.js';

/** 현금 1,000,000원짜리 두 좌석과 빈 장부/잭팟으로 금고를 만든다. */
function createTreasury({ cash = { s1: 1_000_000, s2: 1_000_000 }, jackpot = 0 } = {}) {
  const players = Object.entries(cash).map(([id, amount]) => new Player({ id, name: id, cash: amount }));
  const ledger = new BankLedger();
  const casino = new Casino({ jackpot });
  const initialTotal = players.reduce((sum, player) => sum + player.cash, 0) + jackpot;
  const treasury = new Treasury({ players, ledger, casino, initialTotal });
  return { treasury, players, ledger, casino, byId: (id) => players.find((p) => p.id === id) };
}

describe('Treasury(돈 이동의 유일한 통로)', () => {
  describe('intent 적용', () => {
    it('은행 지불은 현금을 줄이고 장부 toBank를 늘린다', () => {
      // Given
      const { treasury, ledger, byId } = createTreasury();

      // When
      treasury.apply([
        MoneyIntent.toBank({ playerId: 's1', amount: 60_000, reason: MONEY_REASONS.PURCHASE }),
      ]);

      // Then
      assert.equal(byId('s1').cash, 940_000);
      assert.equal(ledger.toBank, 60_000);
      assert.equal(ledger.netFromBank, -60_000);
      assert.equal(treasury.report().balanced, true);
    });

    it('은행 수령은 현금을 늘리고 장부 fromBank를 늘린다', () => {
      // Given
      const { treasury, ledger, byId } = createTreasury();

      // When
      treasury.apply([
        MoneyIntent.fromBank({ playerId: 's1', amount: 200_000, reason: MONEY_REASONS.SALARY }),
      ]);

      // Then
      assert.equal(byId('s1').cash, 1_200_000);
      assert.equal(ledger.fromBank, 200_000);
      assert.equal(treasury.report().balanced, true);
    });

    it('플레이어 간 이동은 양쪽 현금만 바꾸고 장부는 건드리지 않는다', () => {
      // Given
      const { treasury, ledger, byId } = createTreasury();

      // When
      treasury.transfer({
        fromId: 's1',
        toId: 's2',
        amount: 150_000,
        reason: MONEY_REASONS.TOLL,
      });

      // Then
      assert.equal(byId('s1').cash, 850_000);
      assert.equal(byId('s2').cash, 1_150_000);
      assert.equal(ledger.netFromBank, 0);
      assert.equal(treasury.report().balanced, true);
    });

    it('잭팟 적립은 현금을 잭팟으로 옮기고 장부는 건드리지 않는다', () => {
      // Given
      const { treasury, casino, ledger, byId } = createTreasury();

      // When
      const result = treasury.apply([
        MoneyIntent.toJackpot({ playerId: 's1', amount: 100_000, reason: MONEY_REASONS.TAX }),
      ]);

      // Then
      assert.equal(byId('s1').cash, 900_000);
      assert.equal(casino.jackpot, 100_000);
      assert.equal(ledger.netFromBank, 0);
      assert.equal(result.jackpotChanged, true);
      assert.equal(treasury.report().balanced, true);
    });

    it('잭팟 지급은 잭팟을 현금으로 옮긴다', () => {
      // Given
      const { treasury, casino, byId } = createTreasury({ jackpot: 500_000 });

      // When
      treasury.apply([
        MoneyIntent.fromJackpot({ playerId: 's2', amount: 500_000, reason: MONEY_REASONS.CASINO }),
      ]);

      // Then
      assert.equal(casino.jackpot, 0);
      assert.equal(byId('s2').cash, 1_500_000);
      assert.equal(treasury.report().balanced, true);
    });

    it('한 번의 apply는 원자적이다 — 중간에 불변식이 깨져도 끝에서 맞으면 통과한다', () => {
      // Given (파산 분배처럼 지불과 수령이 한 묶음으로 일어난다)
      const { treasury, byId } = createTreasury({ cash: { s1: 300_000, s2: 0, s3: 0 } });

      // When
      treasury.apply([
        MoneyIntent.transfer({ fromId: 's1', toId: 's2', amount: 150_000, reason: MONEY_REASONS.BANKRUPTCY }),
        MoneyIntent.transfer({ fromId: 's1', toId: 's3', amount: 150_000, reason: MONEY_REASONS.BANKRUPTCY }),
      ]);

      // Then
      assert.equal(byId('s1').cash, 0);
      assert.equal(byId('s2').cash, 150_000);
      assert.equal(byId('s3').cash, 150_000);
      assert.equal(treasury.report().balanced, true);
    });

    it('잭팟 변화가 없으면 jackpotChanged는 false다', () => {
      // Given
      const { treasury } = createTreasury();

      // When
      const result = treasury.apply([
        MoneyIntent.toBank({ playerId: 's1', amount: 1_000, reason: MONEY_REASONS.BUILD }),
      ]);

      // Then
      assert.equal(result.jackpotChanged, false);
    });

    it('금액이 0인 intent는 아무것도 바꾸지 않는다', () => {
      // Given
      const { treasury, ledger, byId } = createTreasury();

      // When
      treasury.apply([
        MoneyIntent.transfer({ fromId: 's1', toId: 's2', amount: 0, reason: MONEY_REASONS.TICKET }),
      ]);

      // Then
      assert.equal(byId('s1').cash, 1_000_000);
      assert.equal(byId('s2').cash, 1_000_000);
      assert.deepEqual(ledger.breakdown, {});
    });
  });

  describe('사유별 내역(breakdown)', () => {
    it('사유별 순액을 쌓고 netFromBank와 합계가 일치한다', () => {
      // Given
      const { treasury, ledger } = createTreasury();

      // When
      treasury.apply([
        MoneyIntent.toBank({ playerId: 's1', amount: 60_000, reason: MONEY_REASONS.PURCHASE }),
      ]);
      treasury.apply([
        MoneyIntent.toBank({ playerId: 's1', amount: 18_000, reason: MONEY_REASONS.BUILD }),
      ]);
      treasury.apply([
        MoneyIntent.fromBank({ playerId: 's1', amount: 200_000, reason: MONEY_REASONS.SALARY }),
      ]);

      // Then
      assert.deepEqual(ledger.breakdown, {
        [MONEY_REASONS.PURCHASE]: -60_000,
        [MONEY_REASONS.BUILD]: -18_000,
        [MONEY_REASONS.SALARY]: 200_000,
      });
      const report = treasury.report();
      assert.equal(report.netFromBank, 122_000);
      assert.equal(
        Object.values(report.breakdown).reduce((sum, value) => sum + value, 0),
        report.netFromBank,
      );
      assert.equal(report.breakdownBalanced, true);
    });

    it('한 apply 안에 같은 사유의 지불과 수령이 섞이면 순액 한 건으로 기록된다', () => {
      // Given (카지노: 베팅 지불 + 배당 수령이 한 판이다)
      const { treasury, ledger } = createTreasury();

      // When
      treasury.apply([
        MoneyIntent.toBank({ playerId: 's1', amount: 10_000, reason: MONEY_REASONS.CASINO }),
        MoneyIntent.fromBank({ playerId: 's1', amount: 20_000, reason: MONEY_REASONS.CASINO }),
      ]);

      // Then
      assert.deepEqual(ledger.breakdown, { [MONEY_REASONS.CASINO]: 10_000 });
      assert.equal(ledger.fromBank, 10_000);
      assert.equal(ledger.toBank, 0);
    });

    it('장부를 거치지 않는 이동은 내역에 남지 않는다', () => {
      // Given
      const { treasury, ledger } = createTreasury();

      // When
      treasury.transfer({ fromId: 's1', toId: 's2', amount: 500, reason: MONEY_REASONS.TOLL });

      // Then
      assert.deepEqual(ledger.breakdown, {});
      assert.equal(treasury.report().breakdownBalanced, true);
    });

    it('스냅샷으로 내역을 왕복한다', () => {
      // Given
      const { treasury, ledger } = createTreasury();
      treasury.apply([
        MoneyIntent.toBank({ playerId: 's1', amount: 7_000, reason: MONEY_REASONS.TAX }),
      ]);

      // When
      const restored = new BankLedger(ledger.toSnapshot());

      // Then
      assert.deepEqual(restored.toSnapshot(), ledger.toSnapshot());
      assert.deepEqual(restored.breakdown, { [MONEY_REASONS.TAX]: -7_000 });
    });

    it('내역이 없는 구버전 장부는 미분류 순액으로 드러난다', () => {
      // Given (schemaVersion 1 시절 저장된 장부에는 사유별 내역이 없다)
      const ledger = new BankLedger({ fromBank: 500_000, toBank: 100_000 });

      // Then
      assert.deepEqual(ledger.breakdown, {});
      assert.equal(ledger.netFromBank, 400_000);
      assert.equal(ledger.unattributedNet, 400_000);
    });
  });

  describe('불변식과 금액 검증', () => {
    it('Treasury 밖에서 현금이 바뀌면 다음 apply가 불변식 위반을 잡아낸다', () => {
      // Given
      const { treasury, byId } = createTreasury();
      byId('s1').receive(1_000); // 금고를 우회한 현금 증가

      // When / Then
      assert.throws(
        () =>
          treasury.apply([
            MoneyIntent.toBank({ playerId: 's2', amount: 10, reason: MONEY_REASONS.BUILD }),
          ]),
        DomainError,
      );
    });

    it('불변식은 언제든 직접 점검할 수 있다', () => {
      // Given
      const { treasury, casino } = createTreasury();

      // When
      casino.accumulate(1); // 금고를 우회한 잭팟 증가

      // Then
      assert.throws(() => treasury.assertBalanced(), DomainError);
      assert.equal(treasury.report().balanced, false);
    });

    it('상한(MAX_MONEY)을 넘는 금액은 거부한다', () => {
      // Given
      const { treasury } = createTreasury();

      // When / Then
      assert.throws(
        () =>
          treasury.apply([
            MoneyIntent.fromBank({
              playerId: 's1',
              amount: MAX_MONEY,
              reason: MONEY_REASONS.LOAN,
            }),
          ]),
        DomainError,
        '보유 현금이 상한을 넘으면 거부해야 한다',
      );
    });

    it('현금보다 많은 금액을 지불하는 intent는 거부한다', () => {
      // Given
      const { treasury } = createTreasury();

      // When / Then
      assert.throws(
        () =>
          treasury.apply([
            MoneyIntent.toBank({ playerId: 's1', amount: 2_000_000, reason: MONEY_REASONS.BUILD }),
          ]),
        DomainError,
      );
    });

    it('잭팟보다 많은 금액을 지급하는 intent는 거부한다', () => {
      // Given
      const { treasury } = createTreasury({ jackpot: 1_000 });

      // When / Then
      assert.throws(
        () =>
          treasury.apply([
            MoneyIntent.fromJackpot({
              playerId: 's1',
              amount: 2_000,
              reason: MONEY_REASONS.CASINO,
            }),
          ]),
        DomainError,
      );
    });

    it('알 수 없는 좌석을 가리키는 intent는 거부한다', () => {
      // Given
      const { treasury } = createTreasury();

      // When / Then
      assert.throws(
        () =>
          treasury.apply([
            MoneyIntent.toBank({ playerId: 'ghost', amount: 10, reason: MONEY_REASONS.TICKET }),
          ]),
        DomainError,
      );
      assert.throws(
        () =>
          treasury.transfer({
            fromId: 's1',
            toId: 'ghost',
            amount: 10,
            reason: MONEY_REASONS.TOLL,
          }),
        DomainError,
      );
    });

    it('intent 목록이 배열이 아니면 거부한다', () => {
      // Given
      const { treasury } = createTreasury();

      // When / Then
      assert.throws(() => treasury.apply(null), {
        message: /배열이 아닙니다/,
      });
    });

    it('MoneyIntent가 아닌 값은 적용하기 전에 거부한다(돈을 옮기지 않는다)', () => {
      // Given (직렬화를 거친 평범한 객체가 섞여 들어오면, 상대방을 알 수 없으므로
      //        은행 지불로 오해되어 장부를 우회할 수 있다)
      const { treasury, byId, ledger } = createTreasury();

      // When / Then
      assert.throws(() => treasury.apply([{ playerId: 's1', amount: -1_000, counterparty: 'BANK' }]), {
        message: /MoneyIntent가 아닌/,
      });
      assert.equal(byId('s1').cash, 1_000_000, '거부되면 현금이 그대로다');
      assert.equal(ledger.netFromBank, 0);
    });

    it('빈 목록을 적용하면 아무 일도 일어나지 않는다', () => {
      // Given
      const { treasury, ledger } = createTreasury();

      // When
      const result = treasury.apply([]);

      // Then
      assert.equal(result.jackpotChanged, false);
      assert.deepEqual(ledger.breakdown, {});
      assert.equal(treasury.report().balanced, true);
    });
  });
});

describe('Treasury.apply의 원자성(중간 실패가 돈을 만들지 않는다)', () => {
  it('목록 중간에서 실패하면 **아무것도** 적용되지 않는다', () => {
    // Given (현금 1,000원인 좌석이 +500을 받고 −5,000을 내는 목록.
    //        한 건씩 즉시 적용하면 +500만 반영된 채 두 번째가 터져 돈이 생기고
    //        보존 불변식이 영구히 깨진다 — 그 상태가 파일로 저장되면 그 방은 되살릴 수 없다)
    const players = [new Player({ id: 's1', name: '하나', cash: 1_000 })];
    const ledger = new BankLedger();
    const casino = new Casino();
    const treasury = new Treasury({ players, ledger, casino, initialTotal: 1_000 });

    // When
    assert.throws(
      () =>
        treasury.apply([
          MoneyIntent.fromBank({ playerId: 's1', amount: 500, reason: MONEY_REASONS.SALARY }),
          MoneyIntent.toBank({ playerId: 's1', amount: 5_000, reason: MONEY_REASONS.TAX }),
        ]),
      { code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH },
    );

    // Then
    assert.equal(players[0].cash, 1_000, '첫 intent가 적용된 채로 남았다');
    assert.equal(ledger.netFromBank, 0, '장부가 절반만 기록됐다');
    assert.equal(treasury.report().balanced, true, '보존 불변식이 깨진 채로 남았다');
  });

  it('잭팟이 부족한 지급도 앞의 intent를 남기지 않는다', () => {
    // Given
    const players = [new Player({ id: 's1', name: '하나', cash: 1_000 })];
    const casino = new Casino({ jackpot: 100 });
    const treasury = new Treasury({
      players,
      ledger: new BankLedger(),
      casino,
      initialTotal: 1_100,
    });

    // When
    assert.throws(() =>
      treasury.apply([
        MoneyIntent.fromBank({ playerId: 's1', amount: 700, reason: MONEY_REASONS.SALARY }),
        MoneyIntent.fromJackpot({ playerId: 's1', amount: 9_999, reason: MONEY_REASONS.CASINO }),
      ]),
    );

    // Then
    assert.equal(players[0].cash, 1_000);
    assert.equal(casino.jackpot, 100);
    assert.equal(treasury.report().balanced, true);
  });

  it('모든 intent가 유효하면 그대로 전부 적용된다(정상 경로 불변)', () => {
    // Given
    const players = [
      new Player({ id: 's1', name: '하나', cash: 1_000 }),
      new Player({ id: 's2', name: '두리', cash: 1_000 }),
    ];
    const treasury = new Treasury({
      players,
      ledger: new BankLedger(),
      casino: new Casino(),
      initialTotal: 2_000,
    });

    // When
    treasury.apply([
      MoneyIntent.fromBank({ playerId: 's1', amount: 500, reason: MONEY_REASONS.SALARY }),
      MoneyIntent.transfer({ fromId: 's1', toId: 's2', amount: 300, reason: MONEY_REASONS.TOLL }),
    ]);

    // Then
    assert.equal(players[0].cash, 1_200);
    assert.equal(players[1].cash, 1_300);
    assert.equal(treasury.report().balanced, true);
  });
});
