import { DomainError } from '../shared/DomainError.js';
import { MAX_MONEY, assertAmount } from '../shared/Money.js';
import { COUNTERPARTIES, MoneyIntent } from '../shared/MoneyIntent.js';

/**
 * 금고. **플레이어 현금 · 은행 장부 · 잭팟을 바꾸는 유일한 곳**이다.
 *
 * 게임 안의 모든 돈 이동은 `MoneyIntent` 목록으로 표현되어 `apply()` 한 곳을 지난다.
 * 그래서 새 금융 상품(주식·예금·대출·파생)이 붙어도 장부 코드를 고칠 필요가 없고,
 * 돈의 보존 불변식이 **구조적으로** 지켜진다.
 *
 * `apply()` 한 번이 **원자적인 한 건의 이동**이다. 파산 분배나 「생일 축하」처럼 지불과 수령이
 * 짝을 이루는 흐름은 반드시 한 번의 `apply()`로 묶어야 한다 — 불변식은 호출 경계에서 검사한다.
 */
export class Treasury {
  /** @type {import('./Player.js').Player[]} */
  #players;
  /** @type {import('./BankLedger.js').BankLedger} */
  #ledger;
  /** @type {import('./Casino.js').Casino} */
  #casino;
  #initialTotal;
  /** @type {{onMoneyMoved: (playerId: string, reason: string, amount: number) => void}|null} */
  #observer;

  /**
   * @param {{observer?: {onMoneyMoved: (playerId: string, reason: string, amount: number) => void}}} params
   *   `observer`는 **적용된 모든 돈 이동**을 좌석 기준으로 관찰한다(성적표의 사유별 손익).
   *   돈이 움직이는 길이 이 클래스 하나뿐이므로 어떤 흐름도 이 관찰을 빠져나갈 수 없다.
   *
   *   **좌석 간 이동은 양쪽을 따로 알린다.** `MoneyIntent.transfer`는 지불자 기준 1건이지만
   *   돈은 두 좌석에서 움직이므로, 수령 측을 알리지 않으면 "사유별 손익의 합 + 현금 = 순자산"이
   *   원리적으로 성립하지 않는다(통행료를 낸 기록만 있고 받은 기록이 없게 된다).
   *
   *   관찰자는 상태를 바꾸지 않고 던지지도 않아야 한다(부가 기능이 게임을 멈추면 안 된다).
   */
  constructor({ players, ledger, casino, initialTotal, observer = null }) {
    this.#players = players;
    this.#ledger = ledger;
    this.#casino = casino;
    this.#initialTotal = assertAmount(initialTotal, '초기 총액');
    this.#observer = observer;
  }

  get jackpot() {
    return this.#casino.jackpot;
  }

  /**
   * 돈 이동 의사를 순서대로 적용한다.
   * @param {MoneyIntent[]} intents
   * @returns {{jackpotChanged: boolean}} 잭팟이 실제로 바뀌었는지(UI 이벤트 판단용)
   */
  apply(intents) {
    if (!Array.isArray(intents)) {
      throw DomainError.invalidArgument('돈 이동 의사 목록이 배열이 아닙니다');
    }
    const jackpotBefore = this.#casino.jackpot;
    /** @type {Map<string, number>} 사유 → 장부 순변화 */
    const ledgerNet = new Map();

    for (const intent of intents) {
      if (!(intent instanceof MoneyIntent)) {
        throw DomainError.invalidArgument('MoneyIntent가 아닌 값은 적용할 수 없습니다');
      }
    }

    // **전량을 먼저 검증한 뒤에 옮긴다(원자성).**
    // 한 건씩 즉시 옮기면 목록 중간에서 실패했을 때 앞의 이동만 반영된 채 예외가 나가고,
    // 그 순간 돈이 생기거나 사라져 **보존 불변식이 영구히 깨진다** — 그 상태는 커맨드가 실패해도
    // 이미 메모리에 남고, 불변식을 건드리지 않는 다음 커맨드가 성공하면 그대로 파일에 저장된다.
    // (실제로 "매도 명목금액은 받았는데 수수료를 못 내는" 경로에서 이 일이 일어났다.)
    this.#assertApplicable(intents);

    for (const intent of intents) {
      this.#move(intent);
      this.#notify(intent);
      if (intent.affectsLedger) {
        ledgerNet.set(intent.reason, (ledgerNet.get(intent.reason) ?? 0) + intent.amount);
      }
    }

    // 장부는 사유별 순변화로 한 번에 기록한다(같은 한 건의 이동이 두 줄로 쪼개지지 않게).
    for (const [reason, net] of ledgerNet) {
      this.#ledger.applyNet(net, reason);
    }

    this.assertBalanced();
    return { jackpotChanged: this.#casino.jackpot !== jackpotBefore };
  }

  /**
   * 목록 전체가 적용 가능한지 **옮기기 전에** 확인한다.
   *
   * 같은 좌석이 여러 번 등장할 수 있으므로(예: 매수의 명목금액 + 수수료) 잔액을 누적해서 본다.
   * 잭팟도 같은 방식으로 누적한다. 여기서 통과한 목록은 `#move` 단계에서 실패하지 않는다.
   */
  #assertApplicable(intents) {
    /** @type {Map<string, number>} 좌석 → 적용 중 잔액 */
    const cash = new Map();
    const balanceOf = (playerId) => {
      if (!cash.has(playerId)) {
        cash.set(playerId, this.#require(playerId).cash);
      }
      return cash.get(playerId);
    };
    let jackpot = this.#casino.jackpot;

    for (const intent of intents) {
      const amount = Math.abs(intent.amount);
      const paying = intent.amount < 0;
      const payerId = paying ? intent.playerId : intent.otherPlayerId;
      const receiverId = paying ? intent.otherPlayerId : intent.playerId;

      if (intent.counterparty === COUNTERPARTIES.PLAYER) {
        this.#assertCanPay(payerId, balanceOf(payerId), amount);
        cash.set(payerId, balanceOf(payerId) - amount);
        this.#assertCanReceive(receiverId, balanceOf(receiverId), amount);
        cash.set(receiverId, balanceOf(receiverId) + amount);
        continue;
      }

      if (intent.counterparty === COUNTERPARTIES.JACKPOT) {
        if (paying) {
          this.#assertCanPay(intent.playerId, balanceOf(intent.playerId), amount);
          cash.set(intent.playerId, balanceOf(intent.playerId) - amount);
          jackpot += amount;
          continue;
        }
        if (amount > jackpot) {
          throw DomainError.invalidArgument(
            `잭팟 적립금 ${jackpot}원에서 ${amount}원을 지급할 수 없습니다`,
          );
        }
        jackpot -= amount;
        this.#assertCanReceive(intent.playerId, balanceOf(intent.playerId), amount);
        cash.set(intent.playerId, balanceOf(intent.playerId) + amount);
        continue;
      }

      // BANK / EXCHANGE
      if (paying) {
        this.#assertCanPay(intent.playerId, balanceOf(intent.playerId), amount);
        cash.set(intent.playerId, balanceOf(intent.playerId) - amount);
      } else {
        this.#assertCanReceive(intent.playerId, balanceOf(intent.playerId), amount);
        cash.set(intent.playerId, balanceOf(intent.playerId) + amount);
      }
    }
  }

  #assertCanPay(playerId, balance, amount) {
    this.#require(playerId);
    if (balance < amount) {
      throw DomainError.insufficientCash(
        `현금 ${balance}원으로 ${amount}원을 지불할 수 없습니다: ${playerId}`,
      );
    }
  }

  #assertCanReceive(playerId, balance, amount) {
    this.#require(playerId);
    if (balance + amount > MAX_MONEY) {
      throw DomainError.invalidArgument(
        `보유 현금이 상한(${MAX_MONEY})을 넘습니다: ${playerId} ${balance} + ${amount}`,
      );
    }
  }

  /** 좌석 간 이동(가장 흔한 형태의 단축 통로). */
  transfer({ fromId, toId, amount, reason, meta }) {
    return this.apply([MoneyIntent.transfer({ fromId, toId, amount, reason, meta })]);
  }

  /** 은행에 지불. */
  payToBank({ playerId, amount, reason, meta }) {
    return this.apply([MoneyIntent.toBank({ playerId, amount, reason, meta })]);
  }

  /** 은행에서 수령. */
  receiveFromBank({ playerId, amount, reason, meta }) {
    return this.apply([MoneyIntent.fromBank({ playerId, amount, reason, meta })]);
  }

  /**
   * 돈의 보존 불변식 점검용 보고.
   * `breakdown`은 사유별 순액이며 `netFromBank === sum(breakdown)`이 성립해야 한다.
   */
  report() {
    const totalCash = this.#players.reduce((sum, player) => sum + player.cash, 0);
    const actual = totalCash + this.#casino.jackpot;
    const expected = this.#initialTotal + this.#ledger.netFromBank;
    return {
      totalCash,
      jackpot: this.#casino.jackpot,
      initialTotal: this.#initialTotal,
      netFromBank: this.#ledger.netFromBank,
      actual,
      expected,
      balanced: actual === expected,
      breakdown: this.#ledger.breakdown,
      breakdownBalanced: this.#ledger.unattributedNet === 0,
    };
  }

  /** 불변식이 깨졌으면 즉시 멈춘다(돈이 새는 상태로 진행하는 것이 가장 나쁘다). */
  assertBalanced(label = '') {
    const report = this.report();
    if (!report.balanced) {
      throw DomainError.invalidState(
        `돈의 보존 불변식 위반${label ? ` (${label})` : ''}: ${JSON.stringify(report)}`,
      );
    }
  }

  /** 적용된 이동을 관찰자에게 알린다(좌석 간 이동은 양쪽 모두). */
  #notify(intent) {
    if (!this.#observer) {
      return;
    }
    this.#observer.onMoneyMoved(intent.playerId, intent.reason, intent.amount);
    if (intent.counterparty === COUNTERPARTIES.PLAYER) {
      this.#observer.onMoneyMoved(intent.otherPlayerId, intent.reason, -intent.amount);
    }
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  /** intent 한 건의 현금/잭팟 이동. 장부 기록은 호출자가 사유별로 모아 처리한다. */
  #move(intent) {
    const player = this.#require(intent.playerId);
    const amount = Math.abs(intent.amount);
    const paying = intent.amount < 0;

    if (intent.counterparty === COUNTERPARTIES.PLAYER) {
      const other = this.#require(intent.otherPlayerId);
      const [payer, receiver] = paying ? [player, other] : [other, player];
      payer.pay(amount);
      this.#credit(receiver, amount);
      return;
    }

    if (intent.counterparty === COUNTERPARTIES.JACKPOT) {
      if (paying) {
        player.pay(amount);
        this.#casino.accumulate(amount);
      } else {
        this.#claimFromJackpot(amount);
        this.#credit(player, amount);
      }
      return;
    }

    // BANK / EXCHANGE — 둘 다 은행 창구다.
    if (paying) {
      player.pay(amount);
    } else {
      this.#credit(player, amount);
    }
  }

  /** 수령은 상한을 넘지 않는 범위에서만(손상된 상태가 안전 정수 경계까지 커지지 않게). */
  #credit(player, amount) {
    if (player.cash + amount > MAX_MONEY) {
      throw DomainError.invalidArgument(
        `보유 현금이 상한(${MAX_MONEY})을 넘습니다: ${player.id} ${player.cash} + ${amount}`,
      );
    }
    player.receive(amount);
  }

  #claimFromJackpot(amount) {
    if (amount > this.#casino.jackpot) {
      throw DomainError.invalidArgument(
        `잭팟 적립금 ${this.#casino.jackpot}원에서 ${amount}원을 지급할 수 없습니다`,
      );
    }
    this.#casino.payOut(amount);
  }

  #require(playerId) {
    const player = this.#players.find((candidate) => candidate.id === playerId);
    if (!player) {
      throw DomainError.invalidArgument(`좌석을 찾을 수 없습니다: ${playerId}`);
    }
    return player;
  }
}
