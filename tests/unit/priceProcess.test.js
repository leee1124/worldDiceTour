import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PriceProcess } from '../../src/domain/market/PriceProcess.js';

describe('PriceProcess — 평균 회귀(기준가에서 멀어질수록 되돌아오는 힘)', () => {
  // 오너 피드백 2026-09-23: 43라운드 방에서 카지노 종목이 6,000 → 2,000원(33%)까지 눌러붙음.
  // 25라운드 밸런스는 맞았지만 긴 판에서는 극단이 고착된다 → 현실의 밸류에이션처럼 복원력을 둔다.
  const params = { basePrice: 6_000 };

  it('기준가에서는 0이다', () => {
    // Given / When / Then
    assert.equal(PriceProcess.reversionBp({ price: 6_000, ...params }), 0);
  });

  it('기준가의 1/3까지 떨어지면 라운드당 +6%(상한)로 끌어올린다', () => {
    assert.equal(PriceProcess.reversionBp({ price: 2_000, ...params }), 600);
  });

  it('정상 범위(기준가의 0.5배~2.5배) 안에서는 정확히 0이다 — 설계된 상승 추세를 거스르지 않는다', () => {
    // 고정 기준가로 되돌리는 힘을 항상 걸면 25라운드에 1.3~1.5배로 끝나야 할 종목에 매 라운드 −2%의 역풍이 된다
    // (실측: 분산 1바퀴 +6.9% → +2.7%로 붕괴). 그래서 극단에서만 작동하는 데드존을 둔다.
    for (const price of [3_000, 4_000, 5_400, 6_000, 6_600, 9_000, 12_000, 15_000]) {
      assert.equal(PriceProcess.reversionBp({ price, ...params }), 0, `${price}원`);
    }
  });

  it('기준가의 3배를 넘으면 음수로 끌어내린다(폭주 방지)', () => {
    const up = PriceProcess.reversionBp({ price: 18_000, ...params });
    assert.ok(up < 0 && up >= -600, `up=${up}`);
  });

  it('밴드 바로 안쪽(기준가의 0.4배)에서도 침체 역풍(약 −400)보다 세게 끌어올린다 — 상장폐지 선 위에 눌러붙지 않게', () => {
    // 실측: K=0.15에서는 2,400원(0.4배)에서 +335로 비겨 10라운드 내내 2,400원에 정체했다.
    assert.ok(PriceProcess.reversionBp({ price: 2_400, ...params }) > 450);
  });

  it('tickBp에 복원항이 더해진다', () => {
    const bp = PriceProcess.tickBp({ driftBp: 0, newsBp: 0, nudgeBp: 0, shockBp: 0, reversionBp: 600 });
    assert.equal(bp, 600);
  });
});
