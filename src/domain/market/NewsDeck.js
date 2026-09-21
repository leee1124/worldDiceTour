import { DomainError } from '../shared/DomainError.js';
import { newsCardById, newsCardsOfPhase } from './data/news.js';

/**
 * 경제 뉴스 덱(설계서 §2.2).
 *
 * **국면마다 독립된 덱**을 두고 그 국면의 6장 안에서만 비복원 추출한다(소진되면 다시 채운다 —
 * `TicketDeck`과 같은 패턴). 그래서 뉴스는 독립 난수가 아니라 **국면의 함수**가 되고,
 * 침체에 호황 뉴스가 나오는 일이 없다.
 *
 * 난수는 한 번 뽑을 때 **정확히 한 번** 쓴다(리셔플이 일어나도 마찬가지).
 */
export class NewsDeck {
  /** @type {Map<string, string[]>} 국면 → 남은 카드 id */
  #piles;

  constructor({ piles = {} } = {}) {
    if (typeof piles !== 'object' || piles === null || Array.isArray(piles)) {
      throw DomainError.invalidArgument('뉴스 덱 스냅샷이 객체가 아닙니다');
    }
    this.#piles = new Map();
    for (const [phase, ids] of Object.entries(piles)) {
      if (!Array.isArray(ids)) {
        throw DomainError.invalidArgument(`뉴스 덱(${phase})이 배열이 아닙니다`);
      }
      // 알 수 없는 id는 버린다(스키마 방어) — 그 국면의 카드가 아닌 id도 함께 걸러 낸다.
      const kept = ids.filter((id) => newsCardById(id)?.phase === phase);
      this.#piles.set(phase, kept);
    }
  }

  /** 그 국면에 남은 카드 수(테스트·진단용). */
  remainingOf(phase) {
    return this.#piles.get(phase)?.length ?? 0;
  }

  /**
   * 그 국면의 덱에서 뉴스 한 장을 뽑는다.
   * @param {string} phase
   * @param {import('../shared/interfaces.js').RandomSource} random
   */
  draw(phase, random) {
    const cards = newsCardsOfPhase(phase);
    if (cards.length === 0) {
      throw DomainError.invalidArgument(`뉴스 덱이 없는 국면입니다: ${String(phase)}`);
    }
    let pile = this.#piles.get(phase) ?? [];
    if (pile.length === 0) {
      pile = cards.map((card) => card.id);
    }
    const pick = random.nextInt(0, pile.length - 1);
    const [id] = pile.splice(pick, 1);
    this.#piles.set(phase, pile);
    return newsCardById(id);
  }

  /** 아직 한 장도 뽑지 않은 국면은 담지 않는다(방 파일을 작게 유지). */
  toSnapshot() {
    const piles = {};
    for (const [phase, ids] of this.#piles) {
      piles[phase] = [...ids];
    }
    return { piles };
  }
}
