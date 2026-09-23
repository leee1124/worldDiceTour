import { TICKETS, TICKETS_BY_ID } from './data/tickets.js';

/**
 * 행운 티켓 덱. 남은 티켓 id 목록만 상태로 가지며, 소진되면 카탈로그 전체로 다시 채운다.
 *
 * `catalog`는 기본적으로 배포 티켓 22장이며, **테스트에서만** 다른 목록을 주입한다
 * (예: 티켓 연쇄 상한처럼 배포 데이터로는 재현할 수 없는 상황을 실제로 만들어 검증할 때).
 */
export class TicketDeck {
  /** @type {string[]} */
  #drawPile;
  /** @type {Record<string, object>} */
  #catalog;

  constructor(drawPile, catalog = TICKETS_BY_ID) {
    this.#catalog = catalog;
    this.#drawPile = drawPile.filter((id) => Object.hasOwn(catalog, id));
  }

  static createDefault() {
    return new TicketDeck(TICKETS.map((ticket) => ticket.id));
  }

  /** 스냅샷 복원. 알 수 없는 id는 버린다(스키마 방어). */
  static restore({ drawPile = [] } = {}, catalog = TICKETS_BY_ID) {
    return new TicketDeck(drawPile, catalog);
  }

  get remaining() {
    return this.#drawPile.length;
  }

  /**
   * 티켓 한 장을 뽑는다.
   * @param {import('../shared/interfaces.js').RandomSource} random
   */
  draw(random) {
    if (this.#drawPile.length === 0) {
      this.#refill();
    }
    const pick = random.nextInt(0, this.#drawPile.length - 1);
    const [id] = this.#drawPile.splice(pick, 1);
    return this.#catalog[id];
  }

  #refill() {
    this.#drawPile = Object.keys(this.#catalog);
  }

  toSnapshot() {
    return { drawPile: [...this.#drawPile] };
  }
}
