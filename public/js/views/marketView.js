/**
 * 증권거래소 시장 패널. 중앙 코어(넓은 화면) / 보드 아래 코어(폰)에 들어가는 **티커**다.
 *
 * - `view.market`이 `null`(투자 모드 OFF)이면 패널 자체를 숨긴다 — 그 방의 화면은 예전과 한 픽셀도 다르지 않다.
 * - 남의 턴에도 항상 보인다(할 일 없는 대기를 만들지 않는다).
 * - 폰에서는 접힌 상태가 기본이고, 접힌 머리줄만으로도 국면·기준금리·오늘 뉴스를 읽을 수 있다.
 * - 종목 카드는 가로 스크롤 스냅 캐러셀(폰) / 격자(넓은 화면).
 */

import { button, clear, el, replaceChildren, setHidden, setText, svg, toggleClass } from '../dom.js';
import { formatWon } from '../format.js';
import { priceBreakdownText } from '../domain/marketModel.js';
import { formatRateBp } from '../domain/marketFormat.js';
import { cycleView } from '../domain/marketLabels.js';
import { instrumentCards, netWorthRows, nudgeRows, queueRows } from '../domain/marketModel.js';
import { countTo } from '../animation/timing.js';
import { chartIcon, cycleIcon, exchangeIcon, newsIcon, questionIcon, receiptIcon } from './icons.js';

const PHONE_QUERY = '(max-width: 68rem)';

/** 폰에서는 접은 상태로 시작한다(보드 아래 자리가 좁다). */
function startsCollapsed() {
  try {
    return window.matchMedia(PHONE_QUERY).matches;
  } catch (error) {
    console.error('[market] 화면 폭을 확인하지 못했습니다', error.name);
    return false;
  }
}

function sparkSvg(card) {
  const { spark } = card;
  const node = svg(
    'svg',
    {
      class: 'instr-spark',
      viewBox: `0 0 ${spark.width} ${spark.height}`,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': card.sparkLabel,
    },
    spark.empty
      ? [svg('title', {}, card.sparkLabel)]
      : [
          svg('title', {}, card.sparkLabel),
          svg('path', { class: 'instr-spark-area', d: spark.area }),
          svg('path', { class: 'instr-spark-line', d: spark.path }),
          svg('circle', {
            class: 'instr-spark-dot',
            cx: spark.points[spark.points.length - 1].x,
            cy: spark.points[spark.points.length - 1].y,
            r: 2.2,
          }),
        ],
  );
  return node;
}

export function createMarketView({
  onOpenTrade = () => {},
  onOpenQueue = () => {},
  onOpenNews = () => {},
  onOpenTutorial = () => {},
  onCancelQueued = () => {},
}) {
  let expanded = !startsCollapsed();

  /* ── 머리줄(접혀도 보이는 부분) ───────────────────────────── */

  const cycleBadge = el('span', { class: 'cycle-badge' }, [
    el('span', { class: 'cycle-icon', 'aria-hidden': 'true' }),
    el('span', { class: 'cycle-label' }),
  ]);
  const cycleAge = el('span', { class: 'cycle-age' });
  const rateNode = el('span', { class: 'market-rate-value' });
  const toggleIcon = el('span', { class: 'market-toggle-icon', 'aria-hidden': 'true', text: '▾' });

  const toggleButton = button(
    {
      class: 'market-toggle',
      'aria-expanded': String(expanded),
      on: {
        click: () => {
          expanded = !expanded;
          applyExpanded();
        },
      },
    },
    [
      el('span', { class: 'market-toggle-main' }, [
        el('span', { class: 'market-eyebrow' }, [chartIcon(), ' 증권거래소']),
        el('span', { class: 'market-head-line' }, [
          cycleBadge,
          cycleAge,
          el('span', { class: 'market-rate' }, [el('span', { class: 'market-rate-label', text: '금리' }), rateNode]),
        ]),
      ]),
      toggleIcon,
    ],
  );

  /* ── 뉴스 한 줄(눌러서 전문 보기) ─────────────────────────── */

  const newsHeadline = el('span', { class: 'market-news-headline' });
  const newsRoundNode = el('span', { class: 'market-news-round' });
  const newsButton = button(
    { class: 'market-news', on: { click: () => onOpenNews() } },
    [
      el('span', { class: 'market-news-icon', 'aria-hidden': 'true' }, [newsIcon()]),
      el('span', { class: 'market-news-main' }, [newsRoundNode, newsHeadline]),
      el('span', { class: 'market-news-more', 'aria-hidden': 'true', text: '＋' }),
    ],
  );

  /* ── 관전/거래 안내 줄 ───────────────────────────────────── */

  const spectateNode = el('p', { class: 'market-spectate', role: 'status' });

  /* ── 본문 ────────────────────────────────────────────────── */

  const railNode = el('div', { class: 'market-rail', role: 'list', 'aria-label': '종목 시세' });
  const nudgeNode = el('div', { class: 'market-nudges' });
  const mineNode = el('div', { class: 'market-mine' });
  const queueNode = el('div', { class: 'market-queue' });

  const queueButton = button(
    { class: 'btn btn--ghost btn--small', on: { click: () => onOpenQueue() } },
    [receiptIcon(), ' 예약 주문'],
  );
  const tutorialButton = button(
    { class: 'btn btn--quiet btn--small', on: { click: () => onOpenTutorial() } },
    [questionIcon(), ' 주식·예금 설명'],
  );
  const tradeButton = button(
    { class: 'btn btn--primary btn--small market-open-trade', on: { click: () => onOpenTrade() } },
    [exchangeIcon(), ' 거래 창구 열기'],
  );
  const actionsNode = el('div', { class: 'market-actions' }, [tradeButton, queueButton, tutorialButton]);

  const bodyNode = el('div', { class: 'market-body' }, [railNode, nudgeNode, mineNode, actionsNode, queueNode]);

  const element = el('section', { class: 'market-panel', 'aria-label': '증권거래소' }, [
    toggleButton,
    newsButton,
    spectateNode,
    bodyNode,
  ]);

  function applyExpanded() {
    toggleButton.setAttribute('aria-expanded', String(expanded));
    setText(toggleIcon, expanded ? '▾' : '▸');
    setHidden(bodyNode, !expanded);
    toggleClass(element, 'market-panel--open', expanded);
  }
  applyExpanded();

  /* ── 종목 카드 ───────────────────────────────────────────── */

  /** @type {Map<string, object>} */
  const cardNodes = new Map();
  /** @type {Map<string, number>} */
  const lastPrice = new Map();
  let renderedIds = '';

  function buildCard(card) {
    const name = el('span', { class: 'instr-name' });
    const sector = el('span', { class: 'instr-sector' });
    const price = el('span', { class: 'instr-price' });
    const change = el('span', { class: 'instr-change' });
    const mine = el('span', { class: 'instr-mine' });
    const pnl = el('span', { class: 'instr-pnl' });
    const dividend = el('span', { class: 'instr-dividend' });
    const state = el('span', { class: 'instr-state' });
    const sparkSlot = el('div', { class: 'instr-spark-slot', 'aria-hidden': 'false' });

    const root = el('article', { class: 'instr-card', role: 'listitem', dataset: { instrument: card.id } }, [
      el('div', { class: 'instr-head' }, [name, sector]),
      el('div', { class: 'instr-figures' }, [price, change]),
      sparkSlot,
      el('div', { class: 'instr-foot' }, [mine, pnl]),
      el('div', { class: 'instr-foot instr-foot--meta' }, [dividend, state]),
    ]);

    const entry = { root, name, sector, price, change, mine, pnl, dividend, state, sparkSlot };
    cardNodes.set(card.id, entry);
    return root;
  }

  function updateCard(entry, card, { animate }) {
    setText(entry.name, card.name);
    setText(entry.sector, card.sectorLabel);

    const previous = lastPrice.get(card.id);
    lastPrice.set(card.id, card.price);
    if (animate && previous !== undefined && previous !== card.price) {
      entry.price.classList.add(card.price > previous ? 'instr-price--up' : 'instr-price--down');
      window.setTimeout(() => entry.price.classList.remove('instr-price--up', 'instr-price--down'), 720);
      countTo({ from: previous, to: card.price, onStep: (value) => setText(entry.price, formatWon(value)) });
    } else {
      setText(entry.price, formatWon(card.price));
    }

    setText(entry.change, card.change.text);
    entry.change.dataset.tone = card.change.tone;
    entry.change.setAttribute('aria-label', card.change.label);

    replaceChildren(entry.sparkSlot, sparkSvg(card));

    if (card.qty > 0) {
      setText(entry.mine, card.pnl.holdingText);
      setText(entry.pnl, card.pnl.pnlText);
      entry.pnl.dataset.tone = card.pnl.tone;
      setHidden(entry.pnl, false);
    } else {
      setText(entry.mine, '보유 없음');
      setText(entry.pnl, '');
      setHidden(entry.pnl, true);
    }

    setText(entry.dividend, `배당 ${card.dividendText}`);
    setText(entry.state, card.delisted ? '상장폐지' : '');
    setHidden(entry.state, !card.delisted);
    toggleClass(entry.root, 'instr-card--delisted', card.delisted);
    entry.root.dataset.tone = card.change.tone;
    entry.root.setAttribute('aria-label', card.ariaLabel);
  }

  function renderRail(cards, { animate }) {
    const key = cards.map((card) => card.id).join('|');
    if (key !== renderedIds) {
      clear(railNode);
      cardNodes.clear();
      for (const card of cards) {
        railNode.appendChild(buildCard(card));
      }
      renderedIds = key;
    }
    for (const card of cards) {
      const entry = cardNodes.get(card.id);
      if (entry) {
        updateCard(entry, card, { animate });
      }
    }
  }

  function renderNudges(market) {
    const rows = nudgeRows(market);
    clear(nudgeNode);
    if (rows.length === 0) {
      setHidden(nudgeNode, true);
      return;
    }
    setHidden(nudgeNode, false);
    nudgeNode.appendChild(el('span', { class: 'market-nudge-label', text: '다음 라운드 반영 예정' }));
    for (const row of rows) {
      nudgeNode.appendChild(
        el('span', { class: 'nudge-chip', dataset: { tone: row.tone }, 'aria-label': row.ariaLabel }, [
          el('span', { class: 'nudge-chip-name', text: row.label }),
          el('span', { class: 'nudge-chip-value', text: `${row.arrow} ${row.text}` }),
        ]),
      );
    }
  }

  function renderMine(state, market, seatId) {
    clear(mineNode);
    if (!seatId) {
      setHidden(mineNode, true);
      return;
    }
    setHidden(mineNode, false);
    const player = state.view?.players.find((item) => item.seatId === seatId) ?? null;
    const rows = netWorthRows(player).filter((row) => row.key === 'stock' || row.key === 'deposit');
    mineNode.appendChild(el('span', { class: 'market-mine-label', text: '내 금융자산' }));
    for (const row of rows) {
      mineNode.appendChild(
        el('span', { class: 'market-mine-chip' }, [
          el('span', { class: 'market-mine-key', text: row.label }),
          el('span', { class: 'market-mine-value', text: formatWon(row.amount) }),
        ]),
      );
    }
  }

  function renderQueue(state, market, seatNameOf, mySeatIds) {
    const rows = queueRows(market, { mySeatIds, seatNameOf });
    clear(queueNode);
    if (rows.length === 0) {
      setHidden(queueNode, true);
      return;
    }
    setHidden(queueNode, false);
    queueNode.appendChild(
      el('div', { class: 'market-queue-head' }, [
        el('span', { class: 'market-queue-title', text: '예약 주문' }),
        el('span', { class: 'market-queue-note', text: '모두에게 공개됩니다' }),
      ]),
    );
    const list = el('ul', { class: 'queue-list' });
    for (const row of rows) {
      list.appendChild(
        el('li', { class: ['queue-row', row.mine ? 'queue-row--mine' : null] }, [
          el('span', { class: 'queue-seat', text: row.seatName }),
          el('span', { class: ['queue-kind', `queue-kind--${row.kind}`], text: row.kindLabel }),
          el('span', { class: 'queue-detail', text: row.detail }),
          row.cancellable
            ? button(
                {
                  class: 'btn btn--quiet btn--small',
                  disabled: Boolean(state.locked),
                  on: { click: () => onCancelQueued(row.seatId, row.orderId) },
                },
                '취소',
              )
            : el('span', { class: 'queue-spacer', 'aria-hidden': 'true' }),
        ]),
      );
    }
    queueNode.appendChild(list);
  }

  /** 시세 갱신 직후 종목 카드의 등락 줄에 분해 내역을 잠깐 덮어쓴다(다음 update가 원래 문구로 되돌린다). */
  let breakdownTimer = null;
  function showBreakdown(changes, { cyclePhase } = {}) {
    if (!Array.isArray(changes)) {
      return;
    }
    window.clearTimeout(breakdownTimer);
    for (const change of changes) {
      const entry = cardNodes.get(change?.instrumentId);
      if (!entry) {
        continue;
      }
      setText(entry.change, priceBreakdownText(change, { cyclePhase }));
      entry.change.dataset.detail = 'on';
    }
    breakdownTimer = window.setTimeout(() => {
      for (const entry of cardNodes.values()) {
        delete entry.change.dataset.detail;
      }
      breakdownTimer = null;
    }, 4_000);
  }

  return {
    showBreakdown,
    element,

    /**
     * @param {object} state 스토어 상태
     * @param {object} context
     * @param {string|null} context.mySeatId 시장을 "내 것"으로 볼 좌석(없으면 관전)
     * @param {boolean} context.canTrade 지금 거래 창구를 열 수 있는지(AWAIT_TRADE + 내 좌석)
     * @param {string|null} context.tradingSeatName 거래 중인 좌석 이름(관전 안내)
     * @param {boolean} context.animate 시세 변화를 숫자 카운트로 보여 줄지
     */
    update(state, context = {}) {
      const market = state.view?.market ?? null;
      // 투자 모드 OFF — 패널 자체가 없다.
      setHidden(element, !market);
      if (!market) {
        return;
      }

      const cycle = cycleView(market.cycle);
      element.dataset.cycle = cycle.tone;
      const cycleIconSlot = cycleBadge.querySelector('.cycle-icon');
      clear(cycleIconSlot);
      cycleIconSlot.append(cycleIcon(cycle.icon));
      setText(cycleBadge.querySelector('.cycle-label'), cycle.label);
      cycleBadge.dataset.tone = cycle.tone;
      cycleBadge.setAttribute('title', cycle.hint);
      setText(cycleAge, cycle.age ? `${cycle.age}라운드째` : '');
      setText(rateNode, formatRateBp(market.baseRateBp));

      const news = market.news;
      setHidden(newsButton, !news);
      if (news) {
        setText(newsRoundNode, Number.isInteger(news.round) ? `${news.round}R` : '뉴스');
        setText(newsHeadline, news.headline ?? '');
      }

      const seatId = context.mySeatId ?? null;
      renderRail(instrumentCards(market, seatId), { animate: context.animate !== false });
      renderNudges(market);
      renderMine(state, market, seatId);
      renderQueue(state, market, context.seatNameOf ?? (() => ''), context.mySeatIds ?? []);

      setHidden(tradeButton, !context.canTrade);
      tradeButton.disabled = Boolean(state.locked);
      queueButton.disabled = (context.mySeatIds ?? []).length === 0 || Boolean(state.locked);

      // 남이 거래하는 동안에는 무엇을 기다리는지 분명히 말해 준다.
      const spectating = Boolean(context.tradingSeatName) && !context.canTrade;
      setHidden(spectateNode, !spectating);
      if (spectating) {
        setText(spectateNode, `${context.tradingSeatName} 거래 중… 예약 주문은 지금도 담을 수 있습니다.`);
      }
    },

    /** 라운드 틱 연출이 끝난 뒤 시세만 다시 그린다(카운트 애니메이션 포함). */
    get expanded() {
      return expanded;
    },

    /** 연출(뉴스 카드)에서 패널을 펼쳐 시세를 보여 주고 싶을 때. */
    expand() {
      if (!expanded) {
        expanded = true;
        applyExpanded();
      }
    },
  };
}
