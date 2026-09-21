import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GOLDEN_SCENARIOS, replayScenario } from '../support/goldenReplay.js';

/**
 * 골든 리플레이 회귀 테스트.
 *
 * `refactor/game-money-seams`는 **행동 변경 0**이 합격 기준이다. 리팩터 전 코드로 만든
 * `fixtures/goldenReplay.json`과 지금 코드의 재생 결과가 **바이트 단위로 같아야** 한다.
 * 커맨드 수·최종 라운드·최종 순위·잭팟·은행 순유입·전체 이벤트 종류 순서 해시까지 비교하므로,
 * 규칙이 한 군데라도 달라지면 어떤 시드에서 무엇이 달라졌는지 바로 드러난다.
 *
 * 이 파일의 기댓값은 **사람이 손으로 고치지 않는다.** 값이 달라졌다면 리팩터가 행동을 바꾼 것이다.
 * (골든을 다시 만드는 방법은 tests/support/goldenReplay.js 상단 주석 참고 — 의도적인 규칙 변경에만 쓴다.)
 */
const GOLDEN = JSON.parse(
  readFileSync(new URL('./fixtures/goldenReplay.json', import.meta.url), 'utf8'),
);

describe('E2E: 골든 리플레이(리팩터 전후 행동 동일성)', () => {
  it('골든 파일이 12개 이상의 시나리오를 덮는다', () => {
    // Given / When / Then
    assert.ok(GOLDEN.scenarios.length >= 12, `시나리오가 너무 적다: ${GOLDEN.scenarios.length}`);
    assert.deepEqual(
      GOLDEN.scenarios.map((scenario) => ({ seed: scenario.seed, roundLimit: scenario.roundLimit })),
      GOLDEN_SCENARIOS.map((scenario) => ({ ...scenario })),
      '골든 파일과 하네스의 시나리오 목록이 어긋났다',
    );
  });

  for (const expected of GOLDEN.scenarios) {
    it(`시드 ${expected.seed}(라운드 제한 ${expected.roundLimit ?? '없음'}): 재생 결과가 골든과 완전히 같다`, async () => {
      // Given (골든 파일은 리팩터 이전 코드로 생성됐다)
      // When
      const actual = await replayScenario({
        seed: expected.seed,
        roundLimit: expected.roundLimit,
      });

      // Then
      assert.equal(actual.commands, expected.commands, '커맨드 수가 달라졌다');
      assert.equal(actual.finalRound, expected.finalRound, '최종 라운드가 달라졌다');
      assert.equal(actual.isOver, expected.isOver);
      assert.equal(actual.jackpot, expected.jackpot, '최종 잭팟이 달라졌다');
      assert.equal(actual.initialTotal, expected.initialTotal);
      assert.equal(actual.netFromBank, expected.netFromBank, '은행 순유입이 달라졌다');
      assert.equal(actual.totalCash, expected.totalCash, '최종 총현금이 달라졌다');
      assert.equal(actual.eventCount, expected.eventCount, '이벤트 개수가 달라졌다');
      assert.equal(
        actual.commandSequenceHash,
        expected.commandSequenceHash,
        '커맨드 종류 순서가 달라졌다',
      );
      assert.equal(
        actual.eventSequenceHash,
        expected.eventSequenceHash,
        '이벤트 종류 순서가 달라졌다',
      );
      assert.deepEqual(actual.rankings, expected.rankings, '최종 순위가 달라졌다');
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
});
