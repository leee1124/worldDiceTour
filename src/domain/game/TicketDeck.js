import { TICKETS, TICKETS_BY_ID } from './data/tickets.js';

/**
 * 행운 티켓 덱. 남은 티켓 id 목록만 상태로 가지며, 소진되면 20장을 다시 채운다.
 */
export class TicketDeck {
  /** @type {string[]} */
  #drawPile;

  constructor(drawPile) {
    this.#drawPile = [...drawPile];
  }

  static createDefault() {
    return new TicketDeck(TICKETS.map((ticket) => ticket.id));
  }

  /** 스냅샷 복원. 알 수 없는 id는 버린다(스키마 방어). */
  static restore({ drawPile = [] } = {}) {
    const valid = drawPile.filter((id) => Object.hasOwn(TICKETS_BY_ID, id));
    return new TicketDeck(valid);
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
    return TICKETS_BY_ID[id];
  }

  #refill() {
    this.#drawPile = TICKETS.map((ticket) => ticket.id);
  }

  toSnapshot() {
    return { drawPile: [...this.#drawPile] };
  }
}
