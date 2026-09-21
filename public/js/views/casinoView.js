/**
 * 라스베이거스 카지노(`AWAIT_CASINO`). 네온 야경 톤의 전용 화면.
 *
 * - 탭 3종: 홀짝 / 하이로우세븐 / 슬롯
 * - 베팅액은 서버가 준 `pending.limits`(min·max·unit) 안에서만 움직인다.
 * - **모든 판정은 서버가 한다.** 릴이 도는 동안 바뀌는 심볼은 순수한 눈속임이고,
 *   멈출 때는 언제나 서버가 보내 준 `detail.symbols`에 맞춘다.
 */

import { button, clear, el, replaceChildren, setText, toggleClass } from '../dom.js';
import { formatWon } from '../format.js';
import { canBet, clampBet, quickChips, stepBet } from '../domain/betRules.js';
import { casinoChoiceLabel, casinoGameLabel } from '../domain/labels.js';
import { DURATIONS, prefersReducedMotion, scaled, wait } from '../animation/timing.js';
import { flashScreen } from '../animation/effects.js';

export const CASINO_MODAL_ID = 'casino';

/** 릴이 도는 동안 보여 줄 심볼(연출 전용 — 판정과 무관). */
const REEL_SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'];

const GAMES = [
  { id: 'ODD_EVEN', icon: '🎲', choices: ['ODD', 'EVEN'], payouts: '맞히면 ×2' },
  { id: 'HIGH_LOW_SEVEN', icon: '🎯', choices: ['LOW', 'HIGH', 'SEVEN'], payouts: '로우·하이 ×2 · 세븐 ×5' },
  { id: 'SLOT', icon: '🎰', choices: [], payouts: '3개 일치 ×10 · 2개 일치 ×1.5 · 7️⃣7️⃣7️⃣ 잭팟' },
];

const CHOICE_HINTS = Object.freeze({
  ODD: '주사위 1개 · 홀 (1·3·5)',
  EVEN: '주사위 1개 · 짝 (2·4·6)',
  LOW: '두 눈의 합 2~6 · ×2',
  HIGH: '두 눈의 합 8~12 · ×2',
  SEVEN: '두 눈의 합이 정확히 7 · ×5',
});

function createReel() {
  const symbol = el('span', { class: 'reel-symbol', text: '🎰' });
  return { element: el('div', { class: 'reel' }, [symbol]), symbol };
}

function createCasinoDie() {
  return el('div', { class: 'casino-die', text: '?' });
}

export function createCasinoView({ onBet, onLeave }) {
  let activeGame = 'ODD_EVEN';
  /** @type {Record<string, string|null>} */
  const choiceByGame = { ODD_EVEN: 'ODD', HIGH_LOW_SEVEN: 'LOW', SLOT: null };
  let bet = 10_000;
  let limits = { min: 10_000, max: 0, unit: 10_000 };
  let interactive = false;
  let spinning = false;

  const jackpotNode = el('span', { class: 'neon-amount' });
  const roundsNode = el('div', { class: 'rounds-dots', role: 'img' });
  const cashNode = el('span', { class: 'casino-cash' });

  const tabs = GAMES.map((game) =>
    button(
      {
        class: 'casino-tab',
        role: 'tab',
        id: `casino-tab-${game.id}`,
        'aria-selected': 'false',
        'aria-controls': 'casino-panel',
        dataset: { focusKey: `tab-${game.id}` },
        on: { click: () => selectGame(game.id) },
      },
      [
        el('span', { class: 'tab-icon', 'aria-hidden': 'true', text: game.icon }),
        el('span', { class: 'tab-label', text: casinoGameLabel(game.id) }),
      ],
    ),
  );
  const tabList = el('div', { class: 'casino-tabs', role: 'tablist', 'aria-label': '카지노 게임' }, tabs);

  const choiceRow = el('div', { class: 'choice-row', role: 'group', 'aria-label': '베팅 선택' });
  const payoutNote = el('p', { class: 'casino-payout' });

  const reels = [createReel(), createReel(), createReel()];
  const reelBox = el('div', { class: 'reel-box', 'aria-hidden': 'true' }, reels.map((reel) => reel.element));
  const casinoDice = [createCasinoDie(), createCasinoDie()];
  const diceBox = el('div', { class: 'casino-dice', 'aria-hidden': 'true' }, casinoDice);
  const stageNode = el('div', { class: 'casino-stage' }, [reelBox, diceBox]);
  const bannerNode = el('div', { class: 'casino-banner', role: 'status', 'aria-live': 'polite' });

  const betValueNode = el('span', { class: 'bet-value' });
  const betRange = el('input', {
    class: 'bet-range',
    type: 'range',
    min: '10000',
    max: '500000',
    step: '10000',
    'aria-label': '베팅액',
  });
  const minusButton = button({ class: 'bet-step', 'aria-label': '베팅액 10,000원 줄이기' }, '−');
  const plusButton = button({ class: 'bet-step', 'aria-label': '베팅액 10,000원 늘리기' }, '＋');
  const chipRow = el('div', { class: 'chip-row chip-row--bet' });

  const betButton = button({ class: 'btn btn--neon btn--wide', dataset: { focusKey: 'casino-bet' } }, '베팅하기');
  const leaveButton = button(
    { class: 'btn btn--quiet btn--wide', dataset: { focusKey: 'casino-leave' }, on: { click: () => onLeave() } },
    '카지노에서 나가기',
  );

  const element = el('div', { class: 'casino' }, [
    el('div', { class: 'casino-marquee', 'aria-hidden': 'true' }, [
      el('span', { class: 'marquee-bulb' }),
      el('span', { class: 'marquee-text', text: 'LAS VEGAS' }),
      el('span', { class: 'marquee-bulb' }),
    ]),
    el('div', { class: 'casino-head' }, [
      el('div', { class: 'neon-jackpot' }, [
        el('span', { class: 'neon-label', text: '잭팟 적립금' }),
        jackpotNode,
      ]),
      el('div', { class: 'casino-meta' }, [
        el('div', { class: 'meta-row' }, [el('span', { class: 'meta-label', text: '남은 판' }), roundsNode]),
        el('div', { class: 'meta-row' }, [el('span', { class: 'meta-label', text: '보유 현금' }), cashNode]),
      ]),
    ]),
    tabList,
    el('div', { class: 'casino-panel', id: 'casino-panel', role: 'tabpanel' }, [
      stageNode,
      bannerNode,
      choiceRow,
      payoutNote,
      el('div', { class: 'bet-control' }, [
        el('div', { class: 'bet-head' }, [
          el('span', { class: 'bet-label', text: '베팅액' }),
          betValueNode,
        ]),
        el('div', { class: 'bet-row' }, [minusButton, betRange, plusButton]),
        chipRow,
      ]),
      el('div', { class: 'modal-actions' }, [betButton, leaveButton]),
    ]),
  ]);

  function renderRounds(roundsLeft) {
    clear(roundsNode);
    const max = 3;
    for (let index = 0; index < max; index += 1) {
      roundsNode.appendChild(
        el('span', { class: ['round-dot', index < roundsLeft ? 'round-dot--on' : 'round-dot--off'] }),
      );
    }
    roundsNode.setAttribute('aria-label', `남은 판 ${roundsLeft} / ${max}`);
  }

  function renderChoices() {
    const game = GAMES.find((item) => item.id === activeGame);
    clear(choiceRow);
    setText(payoutNote, game.payouts);
    if (game.choices.length === 0) {
      choiceRow.appendChild(
        el('p', { class: 'casino-hint', text: '슬롯은 고를 것이 없습니다. 베팅액만 정하고 당기세요.' }),
      );
      return;
    }
    for (const choice of game.choices) {
      const active = choiceByGame[activeGame] === choice;
      choiceRow.appendChild(
        button(
          {
            class: ['choice-chip', active ? 'choice-chip--on' : null],
            'aria-pressed': String(active),
            dataset: { focusKey: `choice-${choice}` },
            disabled: !interactive,
            on: {
              click: () => {
                choiceByGame[activeGame] = choice;
                renderChoices();
              },
            },
          },
          [
            el('span', { class: 'choice-label', text: casinoChoiceLabel(choice) }),
            el('span', { class: 'choice-hint', text: CHOICE_HINTS[choice] ?? '' }),
          ],
        ),
      );
    }
  }

  function renderStage() {
    reelBox.hidden = activeGame !== 'SLOT';
    diceBox.hidden = activeGame === 'SLOT';
    casinoDice[1].hidden = activeGame === 'ODD_EVEN';
  }

  function renderBet() {
    const available = canBet(limits);
    bet = available ? clampBet(bet, limits) : 0;
    setText(betValueNode, available ? formatWon(bet) : '베팅 불가');
    betRange.min = String(limits.min);
    betRange.max = String(Math.max(limits.min, limits.max));
    betRange.step = String(limits.unit);
    betRange.value = String(available ? bet : limits.min);
    betRange.disabled = !interactive || !available;
    minusButton.disabled = !interactive || !available || bet <= limits.min;
    plusButton.disabled = !interactive || !available || bet >= limits.max;

    clear(chipRow);
    for (const chip of quickChips(limits)) {
      chipRow.appendChild(
        button(
          {
            class: ['btn', 'btn--chip', chip === bet ? 'btn--chip-on' : null],
            disabled: !interactive,
            on: {
              click: () => {
                bet = clampBet(chip, limits);
                renderBet();
              },
            },
          },
          chip === limits.max ? `최대 ${formatWon(chip)}` : formatWon(chip),
        ),
      );
    }

    const ready = interactive && available && !spinning;
    betButton.disabled = !ready;
    setText(betButton, available ? `${formatWon(bet)} 베팅` : '현금 부족 — 베팅 불가');
    leaveButton.disabled = !interactive || spinning;
  }

  function selectGame(id) {
    activeGame = id;
    for (const [index, tab] of tabs.entries()) {
      const on = GAMES[index].id === id;
      tab.setAttribute('aria-selected', String(on));
      toggleClass(tab, 'casino-tab--on', on);
    }
    toggleClass(element, 'casino--slot', id === 'SLOT');
    renderChoices();
    renderStage();
    renderBet();
  }

  minusButton.addEventListener('click', () => {
    bet = stepBet(bet, -limits.unit, limits);
    renderBet();
  });
  plusButton.addEventListener('click', () => {
    bet = stepBet(bet, limits.unit, limits);
    renderBet();
  });
  betRange.addEventListener('input', () => {
    bet = clampBet(Number(betRange.value), limits);
    setText(betValueNode, formatWon(bet));
  });
  betRange.addEventListener('change', renderBet);
  betButton.addEventListener('click', () => {
    if (!canBet(limits) || spinning) {
      return;
    }
    onBet({ game: activeGame, bet, choice: choiceByGame[activeGame] ?? undefined });
  });

  async function spinReels(symbols) {
    spinning = true;
    renderBet();
    const duration = scaled(DURATIONS.reel);
    if (prefersReducedMotion()) {
      for (const [index, reel] of reels.entries()) {
        setText(reel.symbol, symbols[index] ?? '❔');
      }
      spinning = false;
      renderBet();
      return;
    }
    for (const reel of reels) {
      reel.element.classList.add('reel--spinning');
    }
    const tickers = reels.map((reel) =>
      window.setInterval(() => {
        setText(reel.symbol, REEL_SYMBOLS[Math.floor(Math.random() * REEL_SYMBOLS.length)]);
      }, 70),
    );
    // 릴은 왼쪽부터 차례로 멈추고, 멈출 때는 서버가 보내 준 심볼로 고정한다.
    for (const [index, reel] of reels.entries()) {
      await wait(duration / reels.length);
      window.clearInterval(tickers[index]);
      reel.element.classList.remove('reel--spinning');
      reel.element.classList.add('reel--stopped');
      setText(reel.symbol, symbols[index] ?? '❔');
      window.setTimeout(() => reel.element.classList.remove('reel--stopped'), 240);
    }
    spinning = false;
    renderBet();
  }

  async function spinDice(values) {
    spinning = true;
    renderBet();
    const shown = casinoDice.slice(0, values.length);
    if (!prefersReducedMotion()) {
      for (const die of shown) {
        die.classList.add('casino-die--rolling');
      }
      await wait(scaled(DURATIONS.dice));
      for (const die of shown) {
        die.classList.remove('casino-die--rolling');
      }
    }
    for (const [index, die] of shown.entries()) {
      setText(die, String(values[index]));
    }
    spinning = false;
    renderBet();
  }

  function showBanner(event) {
    const win = Boolean(event.win);
    const jackpot = event.jackpotWon > 0;
    replaceChildren(bannerNode, [
      el('span', { class: 'banner-title', text: jackpot ? '🎉 잭팟 당첨!' : win ? '적중!' : '아쉽네요' }),
      el('span', {
        class: 'banner-amount',
        text: win ? `+${formatWon(event.payout)}` : `−${formatWon(event.bet)}`,
      }),
      jackpot ? el('span', { class: 'banner-jackpot', text: `잭팟 ${formatWon(event.jackpotWon)} 획득` }) : null,
      !win ? el('span', { class: 'banner-note', text: '잃은 베팅액의 절반은 잭팟에 쌓입니다.' }) : null,
    ]);
    bannerNode.dataset.tone = jackpot ? 'jackpot' : win ? 'win' : 'lose';
    bannerNode.classList.add('casino-banner--show');
  }

  return {
    element,

    /** 서버 pending으로 화면을 맞춘다. 내 차례가 아니면 모든 조작을 잠근다. */
    update({ pending, cash, myTurn, playerName }) {
      limits = pending.limits ?? limits;
      interactive = Boolean(myTurn) && pending.roundsLeft > 0;
      setText(jackpotNode, formatWon(pending.jackpot));
      setText(cashNode, formatWon(cash));
      renderRounds(pending.roundsLeft);
      toggleClass(element, 'casino--spectating', !myTurn);
      selectGame(activeGame);
      if (!myTurn) {
        replaceChildren(bannerNode, el('span', { class: 'banner-note', text: `${playerName}의 차례를 구경합니다.` }));
        bannerNode.dataset.tone = 'idle';
      }
    },

    /** CASINO_RESULT 이벤트 연출(주사위/릴 → 결과 배너). */
    async playResult(event) {
      bannerNode.classList.remove('casino-banner--show');
      const detail = event.detail ?? {};
      if (event.game !== activeGame) {
        selectGame(event.game);
      }
      if (event.game === 'SLOT') {
        await spinReels(Array.isArray(detail.symbols) ? detail.symbols : []);
      } else if (event.game === 'ODD_EVEN') {
        await spinDice([detail.die]);
      } else {
        await spinDice([detail.die1, detail.die2]);
      }
      showBanner(event);
      if (event.jackpotWon > 0) {
        element.classList.add('casino--jackpot');
        await flashScreen('neon');
        window.setTimeout(() => element.classList.remove('casino--jackpot'), 1600);
      }
      await wait(scaled(520));
    },
  };
}

/** 카지노 모달 spec. 본문은 카지노 뷰가 직접 들고 있으므로 다시 만들지 않는다. */
export function casinoModalSpec({ casinoView, playerName }) {
  return {
    id: CASINO_MODAL_ID,
    title: '🎰 라스베이거스 카지노',
    subtitle: `${playerName} · 한 방문에 최대 3판`,
    dismissible: false,
    variant: 'neon',
    keepBody: true,
    render: () => casinoView.element,
  };
}
