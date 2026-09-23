import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PHASES } from '../../src/domain/game/phases.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { EVENT_TYPES } from '../../src/domain/game/events.js';
import { BUILDING_TYPES } from '../../src/domain/game/City.js';
import { STARTING_CASH } from '../../src/domain/game/Player.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { buildGame, eventTypes, findEvent, assertMoneyConserved } from '../support/gameBuilder.js';

const { VILLA, BUILDING, HOTEL, LANDMARK } = BUILDING_TYPES;

/** 0번 칸에서 주사위 1+2로 3번 방콕(70,000원)에 도착시킨다. */
const rollToBangkok = () => new FakeRandomSource([1, 2]);

describe('Game(건설 기회)', () => {
  it('빈 도시를 매입하면 같은 턴에 건설 기회를 얻는다', () => {
    // Given
    const game = buildGame({ laps: { s1: 3 }, random: rollToBangkok() });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    game.execute('s1', COMMAND_TYPES.BUY);

    // Then
    assert.equal(game.phase, PHASES.AWAIT_BUILD);
    assert.equal(game.pendingDecision.kind, 'BUILD');
    assert.deepEqual(game.pendingDecision.options.map((option) => option.type), [VILLA, BUILDING, HOTEL]);
  });

  it('내 도시에 도착하면 건설 기회를 얻는다', () => {
    // Given
    const game = buildGame({
      cities: [{ index: 3, ownerId: 's1' }],
      random: rollToBangkok(),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.phase, PHASES.AWAIT_BUILD);
    assert.equal(game.pendingDecision.index, 3);
  });

  it('원하는 조합을 한 번에 지으면 합계 비용을 지불한다', () => {
    // Given
    const game = buildGame({
      laps: { s1: 3 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const events = game.execute('s1', COMMAND_TYPES.BUILD, { buildings: [VILLA, HOTEL] });

    // Then
    const built = findEvent(events, EVENT_TYPES.BUILT);
    assert.deepEqual(built.buildings, [VILLA, HOTEL]);
    assert.equal(built.cost, 21_000 + 63_000);
    assert.equal(game.playerById('s1').cash, STARTING_CASH - 84_000);
    assert.equal(game.currentPlayerId, 's2');
    assertMoneyConserved(game, '건설 후');
  });

  it('3종을 모두 지은 다음 기회에만 관광명소를 지을 수 있다', () => {
    // Given
    const game = buildGame({
      cities: [{ index: 3, ownerId: 's1', buildings: [VILLA, BUILDING, HOTEL] }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const events = game.execute('s1', COMMAND_TYPES.BUILD, { buildings: [LANDMARK] });

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.LANDMARK_BUILT));
    assert.equal(game.board.cityAt(3).landmark, true);
    assert.equal(game.playerById('s1').cash, STARTING_CASH - 70_000);
  });

  it('3종을 완성하는 기회에서 관광명소를 함께 요청하면 거부한다', () => {
    // Given
    const game = buildGame({
      laps: { s1: 3 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.throws(
      () => game.execute('s1', COMMAND_TYPES.BUILD, { buildings: [VILLA, BUILDING, HOTEL, LANDMARK] }),
      { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
    );
    assert.equal(game.phase, PHASES.AWAIT_BUILD);
    assert.equal(game.playerById('s1').cash, STARTING_CASH);
  });

  it('건설을 건너뛸 수 있다', () => {
    // Given
    const game = buildGame({ cities: [{ index: 3, ownerId: 's1' }], random: rollToBangkok() });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    game.execute('s1', COMMAND_TYPES.SKIP_BUILD);

    // Then
    assert.deepEqual(game.board.cityAt(3).buildings, []);
    assert.equal(game.currentPlayerId, 's2');
  });

  it('관광명소까지 지은 내 도시에 도착하면 건설 기회가 없다', () => {
    // Given
    const game = buildGame({
      cities: [{ index: 3, ownerId: 's1', buildings: [VILLA, BUILDING, HOTEL], landmark: true }],
      random: rollToBangkok(),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.currentPlayerId, 's2');
  });

  it('건설비를 낼 현금이 없으면 건설 기회 없이 턴이 끝난다', () => {
    // Given
    const game = buildGame({
      cash: { s1: 1_000 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: rollToBangkok(),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.currentPlayerId, 's2');
  });

  it('현금보다 비싼 조합은 거부한다', () => {
    // Given
    const game = buildGame({
      laps: { s1: 2 },
      cash: { s1: 30_000 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.throws(() => game.execute('s1', COMMAND_TYPES.BUILD, { buildings: [VILLA, BUILDING] }), {
      code: DOMAIN_ERROR_CODES.INSUFFICIENT_CASH,
    });
    assert.equal(game.playerById('s1').cash, 30_000);
  });
});

describe('Game(바퀴별 건설 제한)', () => {
  const optionTypes = (options) => options.map((option) => option.type);

  it('1바퀴 플레이어는 별장만 고를 수 있고 나머지는 잠긴 것으로 알려 준다', () => {
    // Given
    const game = buildGame({ laps: { s1: 1 }, random: rollToBangkok() });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const events = game.execute('s1', COMMAND_TYPES.BUY);

    // Then
    const pending = game.pendingDecision;
    assert.deepEqual(optionTypes(pending.options), [VILLA]);
    assert.deepEqual(pending.lockedOptions, [
      { type: BUILDING, cost: 42_000, locked: true, unlockLap: 2 },
      { type: HOTEL, cost: 63_000, locked: true, unlockLap: 3 },
    ]);
    assert.deepEqual(optionTypes(findEvent(events, EVENT_TYPES.BUILD_OFFERED).options), [VILLA]);
  });

  it('2바퀴 플레이어는 별장과 빌딩까지 고를 수 있다', () => {
    // Given
    const game = buildGame({
      laps: { s1: 2 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: rollToBangkok(),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.deepEqual(optionTypes(game.pendingDecision.options), [VILLA, BUILDING]);
    assert.deepEqual(optionTypes(game.pendingDecision.lockedOptions), [HOTEL]);
  });

  it('3바퀴 플레이어는 3종을 한 번에 지을 수 있다', () => {
    // Given
    const game = buildGame({
      laps: { s1: 3 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    game.execute('s1', COMMAND_TYPES.BUILD, { buildings: [VILLA, BUILDING, HOTEL] });

    // Then
    assert.deepEqual(game.board.cityAt(3).buildings, [VILLA, BUILDING, HOTEL]);
    assert.deepEqual(game.pendingDecision, null);
    assertMoneyConserved(game, '3바퀴 일괄 건설 후');
  });

  it('1바퀴에 별장을 이미 지은 내 도시에 도착하면 건설 기회가 열리지 않는다', () => {
    // Given
    const game = buildGame({
      laps: { s1: 1 },
      cities: [{ index: 3, ownerId: 's1', buildings: [VILLA] }],
      random: rollToBangkok(),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(findEvent(events, EVENT_TYPES.BUILD_OFFERED), undefined);
    assert.equal(game.currentPlayerId, 's2');
  });

  it('잠긴 건물을 BUILD로 요청하면 거부하고 상태가 그대로다', () => {
    // Given (2바퀴 — 호텔은 3바퀴부터)
    const game = buildGame({
      laps: { s1: 2 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);
    const versionBefore = game.version;

    // When / Then
    assert.throws(() => game.execute('s1', COMMAND_TYPES.BUILD, { buildings: [HOTEL] }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.throws(() => game.execute('s1', COMMAND_TYPES.BUILD, { buildings: [VILLA, HOTEL] }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.equal(game.phase, PHASES.AWAIT_BUILD);
    assert.equal(game.version, versionBefore);
    assert.deepEqual(game.board.cityAt(3).buildings, []);
    assert.equal(game.playerById('s1').cash, STARTING_CASH);
  });

  it('출발 보너스 후보는 그 바퀴에 지을 것이 있는 도시만 나온다', () => {
    // Given (출발 칸 도착으로 2바퀴가 되는 플레이어: 빌딩까지만 열린다)
    const game = buildGame({
      positions: { s1: 37 },
      cities: [
        { index: 3, ownerId: 's1', buildings: [VILLA, BUILDING] },
        { index: 39, ownerId: 's1' },
      ],
      random: new FakeRandomSource([1, 2]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.playerById('s1').lap, 2);
    assert.deepEqual(
      findEvent(events, EVENT_TYPES.START_BONUS_OFFERED).candidates.map((item) => item.index),
      [39],
    );
    assert.deepEqual(optionTypes(game.pendingDecision.candidates[0].options), [VILLA, BUILDING]);
    assert.deepEqual(optionTypes(game.pendingDecision.candidates[0].lockedOptions), [HOTEL]);
  });

  it('그 바퀴에 지을 수 있는 도시가 하나도 없으면 출발 보너스를 건너뛴다', () => {
    // Given (2바퀴가 되지만 도시에는 별장·빌딩이 이미 있다)
    const game = buildGame({
      positions: { s1: 37 },
      cities: [{ index: 3, ownerId: 's1', buildings: [VILLA, BUILDING] }],
      random: new FakeRandomSource([1, 2]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(findEvent(events, EVENT_TYPES.START_BONUS_OFFERED), undefined);
    assert.notEqual(game.phase, PHASES.AWAIT_START_BUILD);
    assert.equal(game.currentPlayerId, 's2');
  });

  it('출발 보너스로 잠긴 건물을 요청하면 거부하고 상태가 그대로다', () => {
    // Given (출발 칸 도착으로 2바퀴)
    const game = buildGame({
      positions: { s1: 37 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: new FakeRandomSource([1, 2]),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);
    const versionBefore = game.version;

    // When / Then
    assert.throws(
      () => game.execute('s1', COMMAND_TYPES.START_BUILD, { cityIndex: 3, buildings: [HOTEL] }),
      { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
    );
    assert.equal(game.phase, PHASES.AWAIT_START_BUILD);
    assert.equal(game.version, versionBefore);
    assert.deepEqual(game.board.cityAt(3).buildings, []);
  });

  it('인수 직후의 건설 기회도 인수자의 바퀴를 따른다', () => {
    // Given (1바퀴 플레이어가 남의 빈 도시를 인수한다)
    const game = buildGame({
      laps: { s1: 1 },
      cities: [{ index: 3, ownerId: 's2' }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    game.execute('s1', COMMAND_TYPES.ACQUIRE);

    // Then
    assert.equal(game.phase, PHASES.AWAIT_BUILD);
    assert.deepEqual(optionTypes(game.pendingDecision.options), [VILLA]);
  });

  it('인수한 도시의 건물은 인수자의 바퀴와 무관하게 남고 관광명소만 제안된다', () => {
    // Given (1바퀴 플레이어가 3종이 완성된 남의 도시를 인수한다)
    const game = buildGame({
      laps: { s1: 1 },
      cities: [{ index: 3, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL] }],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    game.execute('s1', COMMAND_TYPES.ACQUIRE);

    // Then
    assert.deepEqual(game.board.cityAt(3).buildings, [VILLA, BUILDING, HOTEL]);
    assert.deepEqual(optionTypes(game.pendingDecision.options), [LANDMARK]);
    assert.deepEqual(game.pendingDecision.lockedOptions, []);
  });
});

describe('Game(출발 칸 보너스)', () => {
  it('출발 칸에 정확히 도착하면 내 도시 한 곳에 건설 기회를 준다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 37 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: new FakeRandomSource([1, 2]),
    });

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.phase, PHASES.AWAIT_START_BUILD);
    assert.equal(findEvent(events, EVENT_TYPES.START_BONUS_OFFERED).candidates.length, 1);
    assert.equal(game.pendingDecision.kind, 'START_BUILD');
  });

  it('고른 도시에 원하는 건물을 짓는다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 37 },
      cities: [
        { index: 3, ownerId: 's1' },
        { index: 39, ownerId: 's1' },
      ],
      random: new FakeRandomSource([1, 2]),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const events = game.execute('s1', COMMAND_TYPES.START_BUILD, {
      cityIndex: 3,
      buildings: [VILLA],
    });

    // Then
    assert.deepEqual(game.board.cityAt(3).buildings, [VILLA]);
    assert.equal(findEvent(events, EVENT_TYPES.BUILT).cost, 21_000);
    assert.equal(game.currentPlayerId, 's2');
  });

  it('내 도시가 아닌 곳은 고를 수 없다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 37 },
      cities: [
        { index: 3, ownerId: 's1' },
        { index: 39, ownerId: 's2' },
      ],
      random: new FakeRandomSource([1, 2]),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When / Then
    assert.throws(
      () => game.execute('s1', COMMAND_TYPES.START_BUILD, { cityIndex: 39, buildings: [VILLA] }),
      { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
    );
  });

  it('보너스를 건너뛸 수 있다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 37 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: new FakeRandomSource([1, 2]),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    game.execute('s1', COMMAND_TYPES.SKIP_START_BUILD);

    // Then
    assert.deepEqual(game.board.cityAt(3).buildings, []);
    assert.equal(game.currentPlayerId, 's2');
  });

  it('건설할 수 있는 내 도시가 없으면 보너스를 건너뛴다', () => {
    // Given
    const game = buildGame({ positions: { s1: 37 }, random: new FakeRandomSource([1, 2]) });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.equal(game.currentPlayerId, 's2');
  });

  it('출발 칸을 지나가기만 하면 보너스가 없다', () => {
    // Given
    const game = buildGame({
      positions: { s1: 38 },
      cities: [{ index: 3, ownerId: 's1' }],
      random: new FakeRandomSource([1, 2]),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.notEqual(game.phase, PHASES.AWAIT_START_BUILD);
  });
});

describe('Game(도시 인수)', () => {
  const tollAndAcquire = (overrides = {}) =>
    buildGame({
      cities: [{ index: 3, ownerId: 's2' }],
      random: rollToBangkok(),
      ...overrides,
    });

  it('통행료를 낸 뒤 관광명소가 없는 남의 도시를 인수할 수 있다', () => {
    // Given
    const game = tollAndAcquire();

    // When
    const events = game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.TOLL_PAID));
    assert.equal(game.phase, PHASES.AWAIT_ACQUIRE);
    assert.equal(game.pendingDecision.kind, 'ACQUIRE');
    assert.equal(game.pendingDecision.price, 140_000);
  });

  it('인수하면 투자액의 2배를 소유자에게 주고 건물과 함께 넘겨받는다', () => {
    // Given
    const game = tollAndAcquire({
      cities: [{ index: 3, ownerId: 's2', buildings: [VILLA] }],
    });
    game.execute('s1', COMMAND_TYPES.ROLL);
    const cashAfterToll = game.playerById('s1').cash;
    const ownerCash = game.playerById('s2').cash;
    const price = game.pendingDecision.price;

    // When
    const events = game.execute('s1', COMMAND_TYPES.ACQUIRE);

    // Then
    assert.equal(price, (70_000 + 21_000) * 2);
    assert.equal(findEvent(events, EVENT_TYPES.ACQUIRED).price, price);
    assert.equal(game.board.cityAt(3).isOwnedBy('s1'), true);
    assert.deepEqual(game.board.cityAt(3).buildings, [VILLA]);
    assert.equal(game.playerById('s1').cash, cashAfterToll - price);
    assert.equal(game.playerById('s2').cash, ownerCash + price);
    assertMoneyConserved(game, '인수 후');
  });

  it('인수 직후 건설 기회를 얻는다', () => {
    // Given
    const game = tollAndAcquire();
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    game.execute('s1', COMMAND_TYPES.ACQUIRE);

    // Then
    assert.equal(game.phase, PHASES.AWAIT_BUILD);
    assert.equal(game.pendingDecision.index, 3);
  });

  it('인수를 거절하면 턴이 끝난다', () => {
    // Given
    const game = tollAndAcquire();
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    const events = game.execute('s1', COMMAND_TYPES.SKIP_ACQUIRE);

    // Then
    assert.ok(eventTypes(events).includes(EVENT_TYPES.ACQUIRE_DECLINED));
    assert.equal(game.board.cityAt(3).isOwnedBy('s2'), true);
    assert.equal(game.currentPlayerId, 's2');
  });

  it('관광명소 도시는 인수 제안을 하지 않는다', () => {
    // Given
    const game = tollAndAcquire({
      cities: [{ index: 3, ownerId: 's2', buildings: [VILLA, BUILDING, HOTEL], landmark: true }],
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.notEqual(game.phase, PHASES.AWAIT_ACQUIRE);
    assert.equal(game.currentPlayerId, 's2');
  });

  it('휴양지는 인수할 수 없다', () => {
    // Given
    const game = buildGame({
      cities: [{ index: 5, ownerId: 's2' }],
      random: new FakeRandomSource([2, 3]),
    });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.notEqual(game.phase, PHASES.AWAIT_ACQUIRE);
  });

  it('보유 현금으로 인수 가격을 낼 수 없으면 제안하지 않는다', () => {
    // Given
    const game = tollAndAcquire({ cash: { s1: 100_000 } });

    // When
    game.execute('s1', COMMAND_TYPES.ROLL);

    // Then
    assert.notEqual(game.phase, PHASES.AWAIT_ACQUIRE);
    assert.equal(game.currentPlayerId, 's2');
  });

  it('통행료를 정리 매각으로 낸 뒤에는 인수를 제안하지 않고 턴이 끝난다', () => {
    // Given (통행료 28,000원을 현금 5,000원으로는 못 내고, 서울을 팔아 충당)
    const game = buildGame({
      cash: { s1: 5_000 },
      cities: [
        { index: 3, ownerId: 's2', buildings: [VILLA] },
        { index: 39, ownerId: 's1' },
      ],
      random: rollToBangkok(),
    });
    game.execute('s1', COMMAND_TYPES.ROLL);

    // When
    game.execute('s1', COMMAND_TYPES.SELL, { cityIndex: 39 });

    // Then (매각 대금으로 인수하는 것은 "현금으로만 인수" 규칙 위반)
    assert.notEqual(game.phase, PHASES.AWAIT_ACQUIRE);
    assert.equal(game.currentPlayerId, 's2');
    assertMoneyConserved(game, '매각 후 인수 금지');
  });
});
