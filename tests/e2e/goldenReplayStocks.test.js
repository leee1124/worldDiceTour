import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { STOCKS_GOLDEN_SCENARIOS, replayScenario } from '../support/goldenReplay.js';

/**
 * 증권거래소 골든 리플레이(투자 모드 `STOCKS`).
 *
 * `goldenReplay.test.js`(투자 모드 OFF)가 **기존 규칙이 안 바뀌었음**을 증명한다면, 이 파일은
 * **증권거래소의 규칙이 의도치 않게 바뀌지 않았음**을 증명한다. 시세·국면·금리·보유·예금까지
 * 지문에 담으므로, 틱 공식이나 뉴스 효과가 한 군데라도 달라지면 어떤 시드에서 무엇이 달라졌는지
 * 바로 드러난다.
 *
 * 이 파일의 기댓값은 **사람이 손으로 고치지 않는다.** 값이 달라졌다면 규칙이 바뀐 것이다.
 * (재생성 방법은 tests/support/goldenReplay.js의 `replayAllStocks` 주석 참고 —
 *  의도적인 규칙·밸런스 변경에만 쓰고, SPEC 12장의 숫자도 함께 고친다.)
 */
const GOLDEN = JSON.parse(
  readFileSync(new URL('./fixtures/goldenReplayStocks.json', import.meta.url), 'utf8'),
);

describe('E2E: 증권거래소 골든 리플레이', () => {
  it('골든 파일이 하네스의 시나리오 목록과 정확히 맞는다', () => {
    // Given / When / Then
    assert.ok(GOLDEN.scenarios.length >= 12, `시나리오가 너무 적다: ${GOLDEN.scenarios.length}`);
    assert.deepEqual(
      GOLDEN.scenarios.map((scenario) => ({
        seed: scenario.seed,
        roundLimit: scenario.roundLimit,
      })),
      STOCKS_GOLDEN_SCENARIOS.map((scenario) => ({ ...scenario })),
      '골든 파일과 하네스의 시나리오 목록이 어긋났다',
    );
  });

  for (const expected of GOLDEN.scenarios) {
    it(`시드 ${expected.seed}(라운드 제한 ${expected.roundLimit ?? '없음'}): 재생 결과가 골든과 완전히 같다`, async () => {
      // Given / When
      const actual = await replayScenario({
        seed: expected.seed,
        roundLimit: expected.roundLimit,
        investmentMode: 'STOCKS',
      });

      // Then
      assert.equal(actual.commands, expected.commands, '커맨드 수가 달라졌다');
      assert.equal(actual.finalRound, expected.finalRound, '최종 라운드가 달라졌다');
      assert.equal(actual.isOver, expected.isOver);
      assert.equal(actual.jackpot, expected.jackpot, '최종 잭팟이 달라졌다');
      assert.equal(actual.netFromBank, expected.netFromBank, '은행 순유입이 달라졌다');
      assert.equal(actual.totalCash, expected.totalCash, '최종 총현금이 달라졌다');
      assert.equal(actual.eventCount, expected.eventCount, '이벤트 개수가 달라졌다');
      assert.equal(actual.commandSequenceHash, expected.commandSequenceHash, '커맨드 순서가 달라졌다');
      assert.equal(actual.eventSequenceHash, expected.eventSequenceHash, '이벤트 순서가 달라졌다');
      assert.deepEqual(actual.rankings, expected.rankings, '최종 순위가 달라졌다');
      assert.deepEqual(actual.market, expected.market, '최종 시장 상태가 달라졌다');
    });
  }

  it('모든 시나리오에서 돈의 보존 불변식이 최종 상태에서도 성립한다', () => {
    // Given / When / Then
    for (const scenario of GOLDEN.scenarios) {
      assert.equal(
        scenario.totalCash + scenario.jackpot,
        scenario.initialTotal + scenario.netFromBank,
        `시드 ${scenario.seed}: 골든 기록 자체가 불변식을 어긴다`,
      );
    }
  });

  it('모든 시나리오에서 시장이 살아 있었다(골든이 빈 시장을 굳히지 않았는지)', () => {
    // Given / When / Then
    for (const scenario of GOLDEN.scenarios) {
      assert.ok(scenario.market, `시드 ${scenario.seed}: 시장 지문이 없다`);
      assert.equal(
        Object.keys(scenario.market.prices).length,
        5,
        `시드 ${scenario.seed}: 상장 종목이 5개가 아니다`,
      );
      assert.ok(
        scenario.market.baseRateBp >= 25 && scenario.market.baseRateBp <= 400,
        `시드 ${scenario.seed}: 기준금리가 범위 밖이다`,
      );
    }
  });
});
