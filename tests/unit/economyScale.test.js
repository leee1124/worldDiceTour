import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BOARD_SPACES, SPACE_KINDS } from '../../src/domain/game/data/board.js';
import { City } from '../../src/domain/game/City.js';
import {
  SALARY,
  ISLAND_RESCUE_FEE,
  LOAN_PRINCIPAL,
  LOAN_DEBT,
} from '../../src/domain/game/Player.js';
import { Casino } from '../../src/domain/game/Casino.js';
import { TICKETS } from '../../src/domain/game/data/tickets.js';

/** 명세 D47(보드 경제 1.5배)이 확정한 도시/휴양지 가격표. */
const EXPECTED_CITY_PRICES = {
  하노이: 90_000,
  방콕: 105_000,
  자카르타: 120_000,
  뭄바이: 150_000,
  두바이: 180_000,
  카이로: 180_000,
  이스탄불: 210_000,
  아테네: 240_000,
  프라하: 240_000,
  빈: 270_000,
  암스테르담: 300_000,
  바르셀로나: 330_000,
  멕시코시티: 360_000,
  리우데자네이루: 390_000,
  부에노스아이레스: 390_000,
  토론토: 420_000,
  시카고: 450_000,
  샌프란시스코: 480_000,
  시드니: 525_000,
  베를린: 570_000,
  파리: 600_000,
  런던: 675_000,
  도쿄: 750_000,
  뉴욕: 900_000,
  서울: 1_200_000,
};

/** 명세 D47이 확정한 행운 티켓 금액표(id 기준). */
const EXPECTED_TICKET_AMOUNTS = {
  T01: 150_000,
  T02: 300_000,
  T03: 75_000,
  T04: 225_000,
  T05: 75_000,
  T06: 150_000,
  T07: 120_000,
  T08: 90_000,
  T15: 75_000,
  T16: 45_000,
  T17: 60_000,
  T18: 45_000,
};

describe('보드 경제 1.5배(D47)', () => {
  it('모든 도시 칸의 가격이 5,000원의 양의 배수이고 명세 가격표와 일치한다', () => {
    // Given
    const cities = BOARD_SPACES.filter((space) => space.kind === SPACE_KINDS.CITY);

    // When / Then
    assert.equal(cities.length, Object.keys(EXPECTED_CITY_PRICES).length);
    for (const city of cities) {
      assert.ok(EXPECTED_CITY_PRICES[city.name] !== undefined, `명세에 없는 도시입니다: ${city.name}`);
      assert.equal(city.price, EXPECTED_CITY_PRICES[city.name], `${city.name} 가격이 명세와 다릅니다`);
      assert.ok(city.price > 0 && city.price % 5_000 === 0, `${city.name} 가격이 5,000원 배수가 아닙니다`);
    }
  });

  it('모든 휴양지 칸의 가격은 300,000원이고 5,000원의 양의 배수다', () => {
    // Given
    const resorts = BOARD_SPACES.filter((space) => space.kind === SPACE_KINDS.RESORT);

    // When / Then
    assert.ok(resorts.length > 0, '휴양지 칸이 있어야 의미 있는 검사다');
    for (const resort of resorts) {
      assert.equal(resort.price, 300_000, `${resort.name} 가격이 명세와 다릅니다`);
      assert.ok(resort.price > 0 && resort.price % 5_000 === 0);
    }
  });

  it('월급·구조비·대출 원금·대출 채무가 1.5배 값으로 바뀌었다', () => {
    // Given / When / Then
    assert.equal(SALARY, 300_000);
    assert.equal(ISLAND_RESCUE_FEE, 300_000);
    assert.equal(LOAN_PRINCIPAL, 1_500_000);
    assert.equal(LOAN_DEBT, 1_800_000);
  });

  it('카지노 최대 베팅액은 750,000원이다(현금이 충분할 때)', () => {
    // Given
    const casino = new Casino();

    // When
    const limits = casino.betLimits(10_000_000);

    // Then
    assert.equal(limits.max, 750_000);
  });

  it('휴양지 통행료 단가는 75,000원이다(휴양지 1개 소유 기준)', () => {
    // Given
    const resort = new City({
      index: 5,
      name: '제주 올레길',
      kind: SPACE_KINDS.RESORT,
      price: 300_000,
      ownerId: 'p1',
    });

    // When / Then
    assert.equal(resort.tollFor({ resortCount: 1 }), 75_000);
  });

  it('행운 티켓 12장의 금액이 명세 가격표와 일치한다', () => {
    // Given / When / Then
    for (const [ticketId, amount] of Object.entries(EXPECTED_TICKET_AMOUNTS)) {
      const ticket = TICKETS.find((candidate) => candidate.id === ticketId);
      assert.ok(ticket, `티켓을 찾을 수 없습니다: ${ticketId}`);
      assert.equal(ticket.effect.amount, amount, `${ticketId} 금액이 명세와 다릅니다`);
    }
  });
});
