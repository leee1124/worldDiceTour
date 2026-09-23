/**
 * 라운드 틱 연출: 뉴스 카드 뒤집기 · 국면 전환 배너 · 상장폐지 효과.
 *
 * 세 연출 모두 **안내 카드의 단일 창구**(`noticeCard.js`)를 지난다. 카드를 직접
 * `document.body`에 붙이고 수명을 직접 재면, 백그라운드 탭에서 타이머가 밀렸을 때
 * 오버레이가 화면에 영영 남는다(dev가 "카드가 안 꺼진다"로 잡은 바로 그 경로다).
 * 창구를 지나면 동기 페일세이프·아무 곳이나 눌러 닫기·카드 겹침 방지를 그대로 물려받고,
 * 읽는 시간은 `domain/noticeTiming.js`가 한곳에서 정한다.
 */

import { el } from '../../dom.js';
import { formatWon } from '../../format.js';
import { cyclePhaseLabel } from '../../domain/marketLabels.js';
import { newsChips } from '../../domain/marketModel.js';
import { newsIcon } from '../icons.js';
import { NOTICE_KINDS } from '../../domain/noticeTiming.js';
import { showNotice } from './noticeCard.js';

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

/**
 * 경제 뉴스 카드. 서버가 준 `headline`·`explanation`을 그대로(textContent) 보여 준다.
 * @param {{id?: string, headline: string, explanation: string, round?: number, effects?: object[]}} news
 */
export async function playNewsCard(news) {
  const card = el('div', { class: 'news-card' }, [
    el('div', { class: 'news-face news-face--back', 'aria-hidden': 'true' }, [
      el('span', { class: 'news-back-mark' }, [newsIcon()]),
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

  return showNotice({
    kind: NOTICE_KINDS.NEWS,
    variant: 'news',
    card: () => card,
    // 카드가 화면에 붙은 뒤에 뒤집는다(붙기 전에 클래스를 주면 뒤집힌 채로 나타난다).
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
  return showNotice({
    kind: NOTICE_KINDS.CYCLE,
    variant: 'cycle',
    card: () => banner,
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
  return showNotice({
    kind: NOTICE_KINDS.DELIST,
    variant: 'delist',
    card: () => card,
    onShown: () => card.classList.add('delist-card--in'),
  });
}
