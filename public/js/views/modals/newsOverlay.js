/**
 * 라운드 틱 연출: 뉴스 카드 뒤집기 · 국면 전환 배너 · 상장폐지 효과.
 *
 * 행운 티켓(`ticketOverlay.js`)과 같은 패턴을 쓴다 — 모달 스택 밖의 짧은 오버레이라
 * 포커스를 가로채지 않고, 연출을 건너뛰어도 게임 진행을 막지 않는다.
 * **한 틱당 총 2.5초를 넘기지 않도록** 각 연출의 수명을 짧게 잡았다.
 */

import { el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { cyclePhaseLabel } from '../../domain/marketLabels.js';
import { newsChips } from '../../domain/marketModel.js';
import { nextFrame, prefersReducedMotion, scaled, wait } from '../../animation/timing.js';

/** 뉴스 카드가 머무는 시간(모션 축소면 훨씬 짧아진다). */
const NEWS_LIFETIME_MS = 1_500;
const BANNER_LIFETIME_MS = 900;
const DELIST_LIFETIME_MS = 900;

function chipRow(news) {
  const chips = newsChips(news);
  if (chips.length === 0) {
    return null;
  }
  return el(
    'div',
    { class: 'news-chips' },
    chips.map((chip) =>
      el('span', { class: 'news-chip', dataset: { tone: chip.tone }, 'aria-label': chip.ariaLabel }, [
        el('span', { class: 'news-chip-name', text: chip.label }),
        el('span', { class: 'news-chip-value', text: `${chip.arrow} ${chip.text}` }),
      ]),
    ),
  );
}

/** 오버레이를 띄우고 수명이 끝나거나 사용자가 누르면 치운다. */
async function playOverlay(overlay, { lifetime, onShown }) {
  document.body.appendChild(overlay);
  let done = false;
  overlay.addEventListener('click', () => {
    done = true;
  });

  if (!prefersReducedMotion()) {
    await nextFrame();
  }
  onShown?.();

  const span = scaled(lifetime);
  const started = performance.now();
  while (!done && performance.now() - started < span) {
    await wait(60);
  }
  overlay.classList.add('news-overlay--leaving');
  await wait(prefersReducedMotion() ? 20 : 180);
  overlay.remove();
}

/**
 * 경제 뉴스 카드. 서버가 준 `headline`·`explanation`을 그대로(textContent) 보여 준다.
 * @param {{id?: string, headline: string, explanation: string, round?: number, effects?: object[]}} news
 */
export async function playNewsCard(news) {
  const card = el('div', { class: 'news-card' }, [
    el('div', { class: 'news-face news-face--back', 'aria-hidden': 'true' }, [
      el('span', { class: 'news-back-mark', text: '📰' }),
      el('span', { class: 'news-back-title', text: '오늘의 경제 뉴스' }),
    ]),
    el('div', { class: 'news-face news-face--front' }, [
      el('span', {
        class: 'news-eyebrow',
        text: Number.isInteger(news?.round) ? `${news.round}라운드 · 경제 뉴스` : '경제 뉴스',
      }),
      el('h3', { class: 'news-headline', text: news?.headline ?? '' }),
      el('p', { class: 'news-why' }, [
        el('span', { class: 'news-why-label', text: '왜 그런지 ' }),
        el('span', { class: 'news-why-text', text: news?.explanation ?? '' }),
      ]),
      chipRow(news),
    ]),
  ]);

  const overlay = el('div', { class: 'news-overlay', role: 'status', 'aria-live': 'polite' }, [card]);
  await playOverlay(overlay, {
    lifetime: NEWS_LIFETIME_MS,
    onShown: () => card.classList.add('news-card--flipped'),
  });
}

/**
 * 경기 국면 전환 배너(뉴스와 확실히 다른 모습이어야 한다 — 뜻이 다른 사건이다).
 * @param {{from?: string, to?: string, round?: number}} event
 */
export async function playCycleBanner(event) {
  const from = cyclePhaseLabel(event?.from);
  const to = cyclePhaseLabel(event?.to);
  const banner = el('div', { class: 'cycle-banner', dataset: { phase: event?.to ?? 'UNKNOWN' } }, [
    el('span', { class: 'cycle-banner-eyebrow', text: '경기 국면 전환' }),
    el('div', { class: 'cycle-banner-line' }, [
      el('span', { class: 'cycle-banner-from', text: from }),
      el('span', { class: 'cycle-banner-arrow', 'aria-hidden': 'true', text: '→' }),
      el('span', { class: 'cycle-banner-to', text: to }),
    ]),
    el('span', { class: 'cycle-banner-note', text: `${from}에서 ${to}(으)로 바뀌었습니다` }),
  ]);
  const overlay = el('div', { class: 'news-overlay news-overlay--banner', role: 'status', 'aria-live': 'polite' }, [banner]);
  await playOverlay(overlay, {
    lifetime: BANNER_LIFETIME_MS,
    onShown: () => banner.classList.add('cycle-banner--in'),
  });
}

/**
 * 상장폐지 — 짧고 강하게. 보유 수량이 소각된 좌석이 있으면 함께 적는다.
 * @param {{name: string, price: number, wiped?: Array<{playerName: string, quantity: number}>}} input
 */
export async function playDelistingCard({ name, price, wiped = [] }) {
  const card = el('div', { class: 'delist-card' }, [
    el('span', { class: 'delist-stamp', 'aria-hidden': 'true', text: '상장폐지' }),
    el('h3', { class: 'delist-name', text: name ?? '' }),
    el('p', { class: 'delist-price', text: `마지막 가격 ${formatWon(price)}` }),
    wiped.length > 0
      ? el(
          'ul',
          { class: 'delist-wiped' },
          wiped.map((item) =>
            el('li', { class: 'delist-wiped-row', text: `${item.playerName} 보유 ${item.quantity}주 소각` }),
          ),
        )
      : el('p', { class: 'delist-note', text: '보유한 사람은 없었습니다.' }),
  ]);
  const overlay = el('div', { class: 'news-overlay news-overlay--delist', role: 'status', 'aria-live': 'polite' }, [card]);
  await playOverlay(overlay, {
    lifetime: DELIST_LIFETIME_MS,
    onShown: () => card.classList.add('delist-card--in'),
  });
}
