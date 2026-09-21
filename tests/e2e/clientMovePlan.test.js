/**
 * 말 이동 연출 계획(순수 로직) 테스트.
 * "한 칸씩 걷기 vs 순간이동" 판정과 칸당 시간·총 시간 상한을 화면 없이 검증한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MOVE_TIMING, planMove } from '../../public/js/domain/movePlan.js';

test('이동 계획: 주사위 7칸은 한 칸씩 걷고 경로에 중간 칸이 모두 들어간다', () => {
  // Given 0번에서 7칸 전진하는 이동
  // When 연출 계획을 세우면
  const plan = planMove({ from: 0, to: 7, steps: 7 });

  // Then 걷기이고 1~7번 칸을 차례로 밟는다
  assert.equal(plan.kind, 'walk');
  assert.deepEqual(plan.path, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(plan.stepMs, MOVE_TIMING.baseStepMs);
  assert.equal(plan.totalMs, MOVE_TIMING.baseStepMs * 7);
});

test('이동 계획: 뒤로 2칸(행운 티켓)도 한 칸씩 되돌아간다', () => {
  // Given 3번에서 뒤로 2칸
  // When 연출 계획을 세우면
  const plan = planMove({ from: 3, to: 1, steps: -2 });

  // Then 걷기이고 2번 → 1번 순서다
  assert.equal(plan.kind, 'walk');
  assert.deepEqual(plan.path, [2, 1]);
});

test('이동 계획: 모서리를 넘어가는 이동도 번호가 39 → 0으로 이어진다', () => {
  // Given 38번에서 4칸 전진(39 → 0 → 1 → 2)
  // When 연출 계획을 세우면
  const plan = planMove({ from: 38, to: 2, steps: 4 });

  // Then 보드를 한 바퀴 도는 순서가 그대로 나온다
  assert.equal(plan.kind, 'walk');
  assert.deepEqual(plan.path, [39, 0, 1, 2]);
});

test('이동 계획: 긴 이동은 칸당 시간을 줄여 총 연출 시간 상한을 지킨다', () => {
  // Given 한 번에 12칸(더블 최대치)을 가는 이동
  const plan = planMove({ from: 0, to: 12, steps: 12 });

  // When 총 시간을 보면
  // Then 상한을 넘지 않고, 칸당 시간은 기본값보다 짧아진다
  assert.equal(plan.kind, 'walk');
  assert.equal(plan.path.length, 12);
  assert.ok(plan.totalMs <= MOVE_TIMING.maxTotalMs, `총 ${plan.totalMs}ms가 상한을 넘었다`);
  assert.ok(plan.stepMs < MOVE_TIMING.baseStepMs);
  assert.ok(plan.stepMs >= MOVE_TIMING.minStepMs);
});

test('이동 계획: 짧은 이동은 상한과 무관하게 기본 속도를 그대로 쓴다', () => {
  // Given 2·3칸짜리 짧은 이동
  for (const steps of [1, 2, 3]) {
    // When 계획을 세우면
    const plan = planMove({ from: 0, to: steps, steps });
    // Then 칸당 시간이 기본값이다(짧다고 더 느려지지 않는다)
    assert.equal(plan.stepMs, MOVE_TIMING.baseStepMs, `${steps}칸 이동이 기본 속도가 아니다`);
  }
});

test('이동 계획: 칸 수를 모르는 이동(공항·조난 이송)은 순간이동으로 분류한다', () => {
  // Given steps가 없는 이동(서버가 목적지만 알려 준 경우)
  const plan = planMove({ from: 3, to: 27, steps: null });

  // When 계획을 세우면
  // Then 30칸을 걷는 대신 순간이동이고 도착 칸만 남는다
  assert.equal(plan.kind, 'teleport');
  assert.deepEqual(plan.path, [27]);
  assert.equal(plan.totalMs, MOVE_TIMING.teleportMs);
});

test('이동 계획: 걷기 상한을 넘는 칸 수도 순간이동으로 돌린다', () => {
  // Given 걸어서 보여 주기에는 너무 먼 이동
  const steps = MOVE_TIMING.maxWalkSteps + 1;

  // When 계획을 세우면
  const plan = planMove({ from: 0, to: steps, steps });

  // Then 순간이동이다
  assert.equal(plan.kind, 'teleport');
  assert.deepEqual(plan.path, [steps]);
});

test('이동 계획: 제자리(0칸) 이동은 연출이 없다', () => {
  // Given 움직이지 않은 이동 이벤트
  const plan = planMove({ from: 5, to: 5, steps: 0 });

  // When 계획을 세우면
  // Then 아무것도 재생하지 않는다
  assert.equal(plan.kind, 'none');
  assert.deepEqual(plan.path, []);
  assert.equal(plan.totalMs, 0);
});

test('이동 계획: 컴퓨터 차례는 같은 경로를 더 빠르게 지나간다', () => {
  // Given 같은 7칸 이동을 사람과 컴퓨터가 각각 할 때
  const human = planMove({ from: 0, to: 7, steps: 7 });
  const computer = planMove({ from: 0, to: 7, steps: 7, fast: true });

  // When 두 계획을 비교하면
  // Then 경로는 같고 컴퓨터 쪽이 더 짧다(그래도 걷는 모습은 남는다)
  assert.deepEqual(computer.path, human.path);
  assert.equal(computer.kind, 'walk');
  assert.ok(computer.stepMs < human.stepMs);
  assert.ok(computer.stepMs >= MOVE_TIMING.minStepMs);
});

test('이동 계획: 모션 축소 설정에서는 칸마다 아주 짧게만 머문다(그래도 칸을 건너뛰지 않는다)', () => {
  // Given 모션 축소를 켠 사용자의 7칸 이동
  const plan = planMove({ from: 0, to: 7, steps: 7, reducedMotion: true });

  // When 계획을 보면
  // Then 경로는 그대로지만 칸당 시간이 아주 짧고 페이드로 넘어간다
  assert.deepEqual(plan.path, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(plan.stepMs, MOVE_TIMING.reducedStepMs);
  assert.equal(plan.style, 'fade');
  assert.equal(plan.kind, 'walk');
});

test('이동 계획: 보통 설정에서는 통통 튀는 방식으로 표시된다', () => {
  // Given 기본 설정의 이동
  // When 계획을 보면 / Then 연출 방식이 hop이다
  assert.equal(planMove({ from: 0, to: 4, steps: 4 }).style, 'hop');
});

test('이동 계획: 이벤트가 비어 있어도 예외 없이 "연출 없음"을 돌려준다', () => {
  // Given 잘못된 입력
  // When 계획을 세우면 / Then 예외 없이 안전한 값이 나온다
  assert.equal(planMove().kind, 'none');
  assert.equal(planMove({}).kind, 'teleport'); // to 기본값 0번 칸으로의 순간이동
});
