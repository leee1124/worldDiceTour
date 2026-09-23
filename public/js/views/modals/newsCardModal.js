/**
 * 뉴스 전문 카드(시장 패널의 헤드라인을 누르면 열린다).
 *
 * 연출용 오버레이(`newsOverlay.js`)와 달리 **머무는 시트**다 — 왜 시세가 움직였는지
 * 천천히 읽고 업종별 영향을 확인할 수 있어야 한다.
 */

import { el } from '../../dom.js';
import { formatRateBp } from '../../domain/marketFormat.js';
import { cycleView } from '../../domain/marketLabels.js';
import { newsChips, nudgeRows } from '../../domain/marketModel.js';
import { actionRow, quietButton } from './parts.js';

export const NEWS_MODAL_ID = 'market-news';

function chipList(rows, emptyText) {
  if (rows.length === 0) {
    return el('p', { class: 'modal-help', text: emptyText });
  }
  return el(
    'div',
    { class: 'news-chips news-chips--sheet' },
    rows.map((row) =>
      el('span', { class: 'news-chip', dataset: { tone: row.tone }, 'aria-label': row.ariaLabel }, [
        el('span', { class: 'news-chip-name', text: row.label }),
        el('span', { class: 'news-chip-value', text: `${row.arrow} ${row.text}` }),
      ]),
    ),
  );
}

/**
 * @param {{market: object, onClose: () => void}} input
 */
export function newsCardSpec({ market, onClose }) {
  const news = market?.news ?? null;
  const cycle = cycleView(market?.cycle);
  return {
    id: NEWS_MODAL_ID,
    title: news ? '오늘의 경제 뉴스' : '경제 뉴스',
    subtitle: news && Number.isInteger(news.round) ? `${news.round}라운드` : '아직 뉴스가 없습니다',
    dismissible: true,
    variant: 'sheet',
    onDismiss: onClose,
    render: () =>
      el('div', { class: 'modal-stack' }, [
        el('div', { class: 'news-sheet-cycle' }, [
          el('span', { class: 'cycle-badge', dataset: { tone: cycle.tone } }, [
            el('span', { class: 'cycle-icon', 'aria-hidden': 'true', text: cycle.icon }),
            el('span', { class: 'cycle-label', text: cycle.label }),
          ]),
          el('span', { class: 'news-sheet-rate', text: `기준금리 ${formatRateBp(market?.baseRateBp)}` }),
        ]),
        el('p', { class: 'modal-help', text: cycle.hint }),

        news
          ? el('div', { class: 'news-sheet-card' }, [
              el('h3', { class: 'news-headline', text: news.headline ?? '' }),
              el('p', { class: 'news-why' }, [
                el('span', { class: 'news-why-label', text: '왜 그런지 ' }),
                el('span', { class: 'news-why-text', text: news.explanation ?? '' }),
              ]),
            ])
          : el('p', { class: 'empty-note', text: '첫 라운드에는 아직 뉴스가 뽑히지 않았습니다.' }),

        el('section', { class: 'news-sheet-section' }, [
          el('h3', { class: 'liq-title', text: '이 뉴스가 움직인 것' }),
          chipList(newsChips(news), '업종별 영향이 없는 뉴스입니다.'),
        ]),

        el('section', { class: 'news-sheet-section' }, [
          el('h3', { class: 'liq-title', text: '다음 라운드 반영 예정' }),
          el('p', {
            class: 'modal-help',
            text: '보드에서 벌어진 일이 업종에 남긴 압력입니다. 전원에게 공개되며 다음 라운드에 반영됩니다.',
          }),
          chipList(nudgeRows(market), '쌓인 압력이 없습니다.'),
        ]),

        actionRow([quietButton('닫기', { onClick: onClose, focusKey: 'news-close' })]),
      ]),
  };
}
