/**
 * 거래 창구(`AWAIT_TRADE`) 바텀시트 · 예약 주문 폼.
 *
 * 한 컴포넌트가 두 가지 모드로 쓰인다:
 * - `TRADE`: 내 턴의 거래 창구. `BUY_STOCK`/`SELL_STOCK`/`DEPOSIT`/`WITHDRAW` + `CLOSE_TRADING`.
 * - `QUEUE`: 남의 턴에 담아 두는 예약 주문(`QUEUE_ORDER`). 게임 상태는 바뀌지 않는다.
 *
 * 규칙
 * - **한도 숫자는 전부 `market.rules`에서 온다**(하드코딩 금지).
 * - 버튼이 비활성일 때는 **왜 그런지 항상 한 줄로 말한다**(`marketOrder.previewOrder`의 이유 코드).
 * - 서버가 유일한 권위다. 여기 미리보기는 "예상"이고, 체결 결과는 서버가 준 뷰로만 반영한다.
 * - `ERR019`(레이트 리밋)를 받으면 잠깐 주문 버튼을 잠근다(즉시 재시도 금지).
 */

import { button, clear, el, replaceChildren, setHidden, setText, toggleClass } from '../dom.js';
import { formatWon } from '../format.js';
import { formatRateBp } from '../domain/marketFormat.js';
import { orderKindLabel } from '../domain/marketLabels.js';
import { holdingPnl, instrumentCards, queueRows, queuedCountOf } from '../domain/marketModel.js';
import {
  depositChips,
  maxBuyQuantity,
  maxSellQuantity,
  normalizeRules,
  quantizeAmount,
  stepQuantity,
} from '../domain/marketRules.js';
import { previewOrder } from '../domain/marketOrder.js';
import { assetKindIcon, diceIcon } from './icons.js';

export const TRADE_MODAL_ID = 'trade';

const TABS = Object.freeze([
  { id: 'STOCK', icon: 'STOCK', label: '주식' },
  { id: 'DEPOSIT', icon: 'DEPOSIT', label: '예금' },
]);

/** 금액 한 줄(모달 공통 `money-row`와 같은 언어). */
function figureRow(label, value, { tone = '', strong = false } = {}) {
  return el('div', { class: ['money-row', tone ? `money-row--${tone}` : null, strong ? 'money-row--strong' : null] }, [
    el('span', { class: 'money-row-label', text: label }),
    el('span', { class: 'money-row-value', text: value }),
  ]);
}

export function createTradeView({ onOrder, onCloseTrading, onQueueOrder, onCancelQueued }) {
  /* ── 폼 상태(서버 상태가 아니라 화면 상태다) ───────────────── */
  let tab = 'STOCK';
  let instrumentId = null;
  let side = 'BUY_STOCK';
  let quantity = 1;
  let depositSide = 'DEPOSIT';
  let amount = 0;
  let cooldownUntil = 0;
  let cooldownTimer = null;

  /** 마지막 update로 받은 바깥 세상. */
  let ctx = {
    market: null,
    budget: null,
    cash: 0,
    deposit: 0,
    seatId: null,
    seatName: '',
    mode: 'TRADE',
    interactive: false,
    locked: false,
    afterTrade: 'ROLL',
    seatNameOf: () => '',
    mySeatIds: [],
    /** 핫시트에서 예약할 좌석 후보 `[{seatId, name}]`. */
    queueSeats: [],
    onSelectSeat: null,
  };

  /* ── 뼈대 ────────────────────────────────────────────────── */

  const tabButtons = TABS.map((item) =>
    button(
      {
        class: 'trade-tab',
        role: 'tab',
        id: `trade-tab-${item.id}`,
        'aria-selected': 'false',
        'aria-controls': 'trade-panel',
        dataset: { focusKey: `trade-tab-${item.id}` },
        on: { click: () => selectTab(item.id) },
      },
      [
        el('span', { class: 'tab-icon', 'aria-hidden': 'true' }, [assetKindIcon(item.icon)]),
        el('span', { class: 'tab-label', text: item.label }),
      ],
    ),
  );
  const tabList = el('div', { class: 'trade-tabs', role: 'tablist', 'aria-label': '거래 종류' }, tabButtons);

  const seatPickerNode = el('div', { class: 'trade-seats', role: 'group', 'aria-label': '예약할 좌석' });
  const pickerNode = el('div', { class: 'trade-picker', role: 'group', 'aria-label': '종목 고르기' });
  const sideNode = el('div', { class: 'trade-sides', role: 'group', 'aria-label': '매수 또는 매도' });
  const stepperNode = el('div', { class: 'trade-stepper' });
  const previewNode = el('div', { class: 'trade-preview' });
  const reasonNode = el('p', { class: 'trade-reason', role: 'status' });
  const noteNode = el('p', { class: 'trade-note' });
  const submitButton = button({ class: 'btn btn--accent btn--block', dataset: { focusKey: 'trade-submit' } }, '주문');

  const budgetNode = el('p', { class: 'trade-budget' });
  const closeButton = button(
    { class: 'btn btn--primary btn--block trade-close', dataset: { focusKey: 'trade-close' }, on: { click: () => onCloseTrading() } },
    [diceIcon(), ' 거래 마치고 주사위 굴리기'],
  );
  const holdNote = el('p', { class: 'trade-hold-note' });
  const queueListNode = el('div', { class: 'trade-queue' });

  const panelNode = el('div', { class: 'trade-panel', id: 'trade-panel', role: 'tabpanel' }, [
    seatPickerNode,
    pickerNode,
    sideNode,
    stepperNode,
    previewNode,
  ]);

  // 주문 버튼과 마감 버튼은 **항상 손에 닿아야 한다** — 폰에서 시트 본문이 길어도 아래에 붙여 둔다.
  // 색으로도 역할이 갈린다: 주문은 청록(되돌릴 수 있는 한 건), 마감은 금색(차례를 넘기는 결정).
  // 못 누르는 이유도 같이 붙여 둔다 — 버튼은 보이는데 이유만 스크롤 위에 있으면 아무 말도 안 한 셈이다.
  const footerNode = el('div', { class: 'trade-footer' }, [
    reasonNode,
    noteNode,
    submitButton,
    budgetNode,
    closeButton,
    holdNote,
  ]);

  const element = el('div', { class: 'trade' }, [tabList, panelNode, queueListNode, footerNode]);

  /* ── 파생값 ──────────────────────────────────────────────── */

  const rules = () => normalizeRules(ctx.market?.rules);

  function cards() {
    return instrumentCards(ctx.market, ctx.seatId);
  }

  function selectedCard() {
    const list = cards();
    return list.find((card) => card.id === instrumentId) ?? list.find((card) => card.tradable) ?? list[0] ?? null;
  }

  function rawInstrument(id) {
    return (ctx.market?.instruments ?? []).find((item) => item?.id === id) ?? null;
  }

  function heldOf(id) {
    const list = ctx.market?.holdings?.[ctx.seatId];
    if (!Array.isArray(list)) {
      return 0;
    }
    return list.find((item) => item?.instrumentId === id)?.qty ?? 0;
  }

  const queueMode = () => ctx.mode === 'QUEUE';

  function maxQuantityNow() {
    const card = selectedCard();
    if (!card) {
      return 0;
    }
    if (side === 'SELL_STOCK') {
      return maxSellQuantity({ held: heldOf(card.id), rules: rules() });
    }
    return maxBuyQuantity({
      price: card.price,
      cash: ctx.cash,
      rules: rules(),
      budget: ctx.budget,
      held: heldOf(card.id),
      queueMode: queueMode(),
    });
  }

  function maxAmountNow() {
    const limits = rules();
    if (depositSide === 'WITHDRAW') {
      return ctx.deposit;
    }
    // 예치는 현금과 남은 예금 한도 중 작은 쪽까지.
    return Math.min(ctx.cash, Math.max(0, limits.depositCap - ctx.deposit));
  }

  function currentPreview() {
    const limits = rules();
    const card = selectedCard();
    const shared = {
      rules: limits,
      budget: ctx.budget,
      cash: ctx.cash,
      deposit: ctx.deposit,
      queueMode: queueMode(),
      queuedCount: queuedCountOf(ctx.market, ctx.seatId),
    };
    if (tab === 'STOCK') {
      return previewOrder({
        ...shared,
        kind: side,
        instrument: card ? rawInstrument(card.id) : null,
        quantity,
        held: card ? heldOf(card.id) : 0,
      });
    }
    return previewOrder({ ...shared, kind: depositSide, amount });
  }

  function inCooldown() {
    return cooldownUntil > Date.now();
  }

  /* ── 렌더 ────────────────────────────────────────────────── */

  function selectTab(id) {
    tab = id;
    render();
  }

  function renderTabs() {
    for (const [index, node] of tabButtons.entries()) {
      const on = TABS[index].id === tab;
      node.setAttribute('aria-selected', String(on));
      toggleClass(node, 'trade-tab--on', on);
    }
  }

  /** 핫시트(한 기기에 여러 좌석): 어느 좌석으로 예약할지 고르게 한다. */
  function renderSeatPicker() {
    const seats = queueMode() ? ctx.queueSeats ?? [] : [];
    clear(seatPickerNode);
    if (seats.length < 2) {
      setHidden(seatPickerNode, true);
      return;
    }
    setHidden(seatPickerNode, false);
    seatPickerNode.appendChild(el('span', { class: 'trade-seats-label', text: '예약할 좌석' }));
    for (const seat of seats) {
      const on = seat.seatId === ctx.seatId;
      seatPickerNode.appendChild(
        button(
          {
            class: ['btn', 'btn--chip', on ? 'btn--chip-on' : null],
            'aria-pressed': String(on),
            disabled: ctx.locked,
            on: { click: () => ctx.onSelectSeat?.(seat.seatId) },
          },
          seat.name,
        ),
      );
    }
  }

  function renderPicker() {
    clear(pickerNode);
    if (tab !== 'STOCK') {
      setHidden(pickerNode, true);
      return;
    }
    setHidden(pickerNode, false);
    const list = cards();
    if (list.length === 0) {
      pickerNode.appendChild(el('p', { class: 'empty-note', text: '거래할 종목이 없습니다.' }));
      return;
    }
    const chosen = selectedCard();
    instrumentId = chosen?.id ?? null;
    for (const card of list) {
      const on = card.id === instrumentId;
      pickerNode.appendChild(
        button(
          {
            class: ['instr-chip', on ? 'instr-chip--on' : null, card.delisted ? 'instr-chip--off' : null],
            'aria-pressed': String(on),
            disabled: !ctx.interactive || card.delisted,
            dataset: { focusKey: `pick-${card.id}` },
            'aria-label': card.ariaLabel,
            on: {
              click: () => {
                instrumentId = card.id;
                quantity = 1;
                render();
              },
            },
          },
          [
            el('span', { class: 'instr-chip-name', text: card.name }),
            el('span', { class: 'instr-chip-price', text: formatWon(card.price) }),
            el('span', { class: 'instr-chip-change', dataset: { tone: card.change.tone }, text: card.change.text }),
            card.qty > 0
              ? el('span', { class: 'instr-chip-qty', text: card.pnl.holdingText })
              : el('span', { class: 'instr-chip-qty instr-chip-qty--none', text: card.delisted ? '상장폐지' : '보유 없음' }),
          ],
        ),
      );
    }
  }

  function renderSides() {
    clear(sideNode);
    const options =
      tab === 'STOCK'
        ? [
            { id: 'BUY_STOCK', label: '매수', active: side === 'BUY_STOCK' },
            { id: 'SELL_STOCK', label: '매도', active: side === 'SELL_STOCK' },
          ]
        : [
            { id: 'DEPOSIT', label: '예치', active: depositSide === 'DEPOSIT' },
            { id: 'WITHDRAW', label: '인출', active: depositSide === 'WITHDRAW' },
          ];
    for (const option of options) {
      sideNode.appendChild(
        button(
          {
            class: ['trade-side', option.active ? 'trade-side--on' : null],
            'aria-pressed': String(option.active),
            disabled: !ctx.interactive,
            dataset: { focusKey: `side-${option.id}` },
            on: {
              click: () => {
                if (tab === 'STOCK') {
                  side = option.id;
                  quantity = 1;
                } else {
                  depositSide = option.id;
                  amount = 0;
                }
                render();
              },
            },
          },
          option.label,
        ),
      );
    }
  }

  function stepButton(label, ariaLabel, onClick, { disabled }) {
    return button(
      {
        class: 'trade-step',
        'aria-label': ariaLabel,
        disabled,
        on: { click: onClick },
      },
      label,
    );
  }

  function renderStockStepper() {
    const limits = rules();
    const max = maxQuantityNow();
    quantity = max === 0 ? 0 : Math.min(Math.max(quantity, limits.minQuantity), max);
    const card = selectedCard();
    const locked = !ctx.interactive;

    const valueNode = el('div', { class: 'trade-quantity' }, [
      el('span', { class: 'trade-quantity-value', text: `${quantity}` }),
      el('span', { class: 'trade-quantity-unit', text: '주' }),
    ]);

    replaceChildren(stepperNode, [
      el('div', { class: 'trade-stepper-head' }, [
        el('span', { class: 'trade-stepper-label', text: side === 'BUY_STOCK' ? '살 수량' : '팔 수량' }),
        // "최대"는 스테퍼 줄이 아니라 머리줄에 둔다 — 360px 폰에서 ±버튼 5개와 함께 두면 줄이 접힌다.
        button(
          {
            class: 'btn btn--chip trade-max',
            disabled: locked || max === 0,
            dataset: { focusKey: 'trade-max' },
            on: {
              click: () => {
                quantity = max;
                render();
              },
            },
          },
          max > 0 ? `최대 ${max}주` : '가능 수량 0주',
        ),
      ]),
      el('div', { class: 'trade-stepper-row' }, [
        stepButton('−10', '10주 줄이기', () => {
          quantity = stepQuantity(quantity, -10, { rules: limits, max });
          render();
        }, { disabled: locked || max === 0 || quantity <= limits.minQuantity }),
        stepButton('−1', '1주 줄이기', () => {
          quantity = stepQuantity(quantity, -1, { rules: limits, max });
          render();
        }, { disabled: locked || max === 0 || quantity <= limits.minQuantity }),
        valueNode,
        stepButton('＋1', '1주 늘리기', () => {
          quantity = stepQuantity(quantity, 1, { rules: limits, max });
          render();
        }, { disabled: locked || max === 0 || quantity >= max }),
        stepButton('＋10', '10주 늘리기', () => {
          quantity = stepQuantity(quantity, 10, { rules: limits, max });
          render();
        }, { disabled: locked || max === 0 || quantity >= max }),
      ]),
      card
        ? el('p', { class: 'trade-stepper-note', text: `현재가 ${formatWon(card.price)} · 배당 ${card.dividendText}` })
        : null,
    ]);
  }

  function renderDepositStepper() {
    const limits = rules();
    const max = maxAmountNow();
    amount = quantizeAmount(amount === 0 ? limits.depositUnit : amount, { rules: limits, max });
    const locked = !ctx.interactive;

    const chips = depositChips(max, limits).map((chip) =>
      button(
        {
          class: ['btn', 'btn--chip', chip === amount ? 'btn--chip-on' : null],
          disabled: locked,
          on: {
            click: () => {
              amount = quantizeAmount(chip, { rules: limits, max });
              render();
            },
          },
        },
        chip === max ? `최대 ${formatWon(chip)}` : formatWon(chip),
      ),
    );

    replaceChildren(stepperNode, [
      el('div', { class: 'trade-stepper-head' }, [
        el('span', { class: 'trade-stepper-label', text: depositSide === 'DEPOSIT' ? '맡길 금액' : '뺄 금액' }),
        el('span', {
          class: 'trade-stepper-max',
          text: max >= limits.depositUnit ? `최대 ${formatWon(max)}` : '가능 금액 없음',
        }),
      ]),
      el('div', { class: 'trade-stepper-row' }, [
        stepButton(`−${formatWon(limits.depositUnit)}`, '금액 줄이기', () => {
          amount = quantizeAmount(amount - limits.depositUnit, { rules: limits, max });
          render();
        }, { disabled: locked || amount <= limits.depositUnit }),
        el('div', { class: 'trade-quantity' }, [
          el('span', { class: 'trade-quantity-value', text: formatWon(amount) }),
        ]),
        stepButton(`＋${formatWon(limits.depositUnit)}`, '금액 늘리기', () => {
          amount = quantizeAmount(amount + limits.depositUnit, { rules: limits, max });
          render();
        }, { disabled: locked || amount >= max }),
      ]),
      chips.length > 0 ? el('div', { class: 'chip-row' }, chips) : null,
      el('p', {
        class: 'trade-stepper-note',
        text: `예금 잔액 ${formatWon(ctx.deposit)} · 이자율(기준금리) ${formatRateBp(ctx.market?.baseRateBp)} / 라운드`,
      }),
    ]);
  }

  function renderPreview(preview) {
    const isStock = tab === 'STOCK';
    const buying = isStock ? side === 'BUY_STOCK' : depositSide === 'DEPOSIT';
    const held = isStock ? selectedCard() : null;
    // 보유 중인 종목이면 "내가 얼마에 샀나"를 주문 미리보기 맨 위에 둔다(팔지 말지 판단의 기준).
    const holdingRows =
      held && held.qty > 0
        ? [
            figureRow('보유 · 평단', held.pnl.holdingText.replace('보유 ', '')),
            figureRow('평가손익', held.pnl.pnlText, { tone: held.pnl.tone === 'up' ? 'in' : held.pnl.tone === 'down' ? 'out' : '' }),
          ]
        : [];
    const rows = isStock
      ? [
          ...holdingRows,
          figureRow('명목금액', formatWon(preview.notional)),
          figureRow('수수료', formatWon(preview.fee), { tone: 'out' }),
          figureRow(buying ? '총 지출' : '실 수령', formatWon(preview.total), {
            tone: buying ? 'out' : 'in',
            strong: true,
          }),
          figureRow('주문 뒤 현금', formatWon(preview.cashAfter)),
        ]
      : [
          figureRow(buying ? '맡길 금액' : '뺄 금액', formatWon(preview.total), { tone: buying ? 'out' : 'in', strong: true }),
          figureRow('주문 뒤 현금', formatWon(preview.cashAfter)),
          figureRow('주문 뒤 예금', formatWon(preview.depositAfter)),
        ];
    replaceChildren(previewNode, rows);
  }

  function renderSubmit(preview) {
    const cooling = inCooldown();
    const ready = ctx.interactive && preview.ok && !ctx.locked && !cooling;
    submitButton.disabled = !ready;
    submitButton.setAttribute('aria-busy', ctx.locked ? 'true' : 'false');

    const kindLabel = orderKindLabel(tab === 'STOCK' ? side : depositSide);
    setText(submitButton, queueMode() ? `${kindLabel} 예약 담기` : `${kindLabel} 주문 넣기`);

    const reason = cooling
      ? '주문이 너무 잦습니다 — 잠시 뒤 다시 눌러 주세요.'
      : !ctx.interactive
        ? '지금은 이 기기에서 주문할 수 없습니다.'
        : preview.reasonText;
    setText(reasonNode, reason);
    setHidden(reasonNode, reason.length === 0);
    setText(noteNode, preview.ok ? preview.note : '');
    setHidden(noteNode, !preview.ok || preview.note.length === 0);
  }

  function renderFooter() {
    const limits = rules();
    const budget = ctx.budget;
    if (queueMode() || !budget?.open) {
      const used = queuedCountOf(ctx.market, ctx.seatId);
      setText(budgetNode, `예약 ${limits.maxQueuedOrders}건 중 ${used}건 사용`);
      setHidden(closeButton, true);
      setText(holdNote, '내 차례가 시작될 때 자동으로 체결됩니다.');
      setHidden(holdNote, false);
      return;
    }
    const used = Number.isInteger(budget.ordersUsed) ? budget.ordersUsed : 0;
    const max = Number.isInteger(budget.ordersMax) ? budget.ordersMax : limits.maxOrdersPerWindow;
    setText(budgetNode, `주문 ${max}건 중 ${used}건 · 예산 ${formatWon(budget.notionalLeft)} 남음`);
    setHidden(closeButton, false);
    closeButton.disabled = !ctx.interactive || ctx.locked;
    closeButton.setAttribute('aria-busy', ctx.locked ? 'true' : 'false');
    // "창을 닫아도 턴은 넘어가지 않는다"를 못 박는다(닫기 버튼과 CTA를 헷갈리지 않게).
    setText(holdNote, '닫기(X)를 눌러도 차례는 그대로입니다(금색 버튼을 눌러야 넘어갑니다).');
    setHidden(holdNote, false);
  }

  function renderQueueList() {
    const rows = queueRows(ctx.market, { mySeatIds: ctx.mySeatIds, seatNameOf: ctx.seatNameOf });
    clear(queueListNode);
    if (rows.length === 0) {
      setHidden(queueListNode, true);
      return;
    }
    setHidden(queueListNode, false);
    queueListNode.appendChild(el('h3', { class: 'trade-queue-title', text: '예약 주문 (전원 공개)' }));
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
                  disabled: ctx.locked,
                  dataset: { focusKey: `cancel-${row.orderId}` },
                  on: { click: () => onCancelQueued(row.seatId, row.orderId) },
                },
                '취소',
              )
            : el('span', { class: 'queue-spacer', 'aria-hidden': 'true' }),
        ]),
      );
    }
    queueListNode.appendChild(list);
  }

  function render() {
    renderTabs();
    renderSeatPicker();
    renderPicker();
    renderSides();
    if (tab === 'STOCK') {
      renderStockStepper();
    } else {
      renderDepositStepper();
    }
    const preview = currentPreview();
    renderPreview(preview);
    renderSubmit(preview);
    renderFooter();
    renderQueueList();
  }

  submitButton.addEventListener('click', () => {
    const preview = currentPreview();
    if (!preview.ok || !ctx.interactive || ctx.locked || inCooldown()) {
      return;
    }
    if (tab === 'STOCK') {
      const card = selectedCard();
      if (!card) {
        return;
      }
      const payload = { instrumentId: card.id, quantity };
      if (queueMode()) {
        onQueueOrder(ctx.seatId, { kind: side, ...payload });
      } else {
        onOrder(side, payload);
      }
      return;
    }
    if (queueMode()) {
      onQueueOrder(ctx.seatId, { kind: depositSide, amount });
    } else {
      onOrder(depositSide, { amount });
    }
  });

  return {
    element,

    /** 좌석을 바꿔 열 때(핫시트) 폼 상태를 처음으로 되돌린다. */
    resetForm() {
      tab = 'STOCK';
      instrumentId = null;
      side = 'BUY_STOCK';
      quantity = 1;
      depositSide = 'DEPOSIT';
      amount = 0;
    },

    /** `ERR019`를 받았을 때 잠깐 주문 버튼을 잠근다. */
    startCooldown(ms) {
      if (!Number.isFinite(ms) || ms <= 0) {
        return;
      }
      cooldownUntil = Date.now() + ms;
      if (cooldownTimer !== null) {
        window.clearTimeout(cooldownTimer);
      }
      cooldownTimer = window.setTimeout(() => {
        cooldownTimer = null;
        render();
      }, ms + 30);
      render();
    },

    update(next) {
      ctx = { ...ctx, ...next };
      render();
    },
  };
}

/**
 * 거래 시트 spec. 본문은 거래 뷰가 직접 들고 있으므로 다시 만들지 않는다(입력 상태 보존).
 * **닫을 수 있게** 둔다 — 보드를 확인하러 나갔다가 다시 열 수 있어야 한다(턴은 넘어가지 않는다).
 */
export function tradeModalSpec({ tradeView, seatName, mode, onDismiss }) {
  const queueing = mode === 'QUEUE';
  return {
    id: TRADE_MODAL_ID,
    title: queueing ? '예약 주문' : '거래 창구',
    subtitle: queueing ? `${seatName} · 내 차례에 자동 체결` : `${seatName} · 주문 뒤 아래에서 마감`,
    dismissible: true,
    variant: 'sheet',
    keepBody: true,
    onDismiss,
    render: () => tradeView.element,
  };
}
