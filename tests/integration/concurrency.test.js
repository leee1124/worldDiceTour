import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { KeyedMutex } from '../../src/application/KeyedMutex.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';
import { createAppFixture, startedRoom } from '../support/appFixture.js';

const scriptedRandom = (diceValues = []) => new FakeRandomSource([3, 3, 3, 3, ...diceValues]);

/**
 * 이 파일은 실제 `setTimeout`을 쓴다(가짜 타이머를 주입하지 않는다).
 * 검증 대상이 "겹치는 비동기 작업의 **실행 순서**"이기 때문이다. 타이머를 가짜로 바꾸면
 * 마이크로태스크 큐가 흐르는 방식까지 바뀌어, 정작 확인하려는 경합을 재현할 수 없다.
 * 대기 시간은 20ms 이하로 짧게 두어 테스트 전체 실행 시간에 영향이 없게 했다.
 */
describe('KeyedMutex(키별 직렬화)', () => {
  it('같은 키의 작업은 순서대로 하나씩 실행된다', async () => {
    // Given
    const mutex = new KeyedMutex();
    const order = [];
    const slowTask = async (label, delay) => {
      order.push(`${label}-시작`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      order.push(`${label}-끝`);
    };

    // When
    await Promise.all([
      mutex.runExclusive('A', () => slowTask('첫째', 20)),
      mutex.runExclusive('A', () => slowTask('둘째', 1)),
    ]);

    // Then
    assert.deepEqual(order, ['첫째-시작', '첫째-끝', '둘째-시작', '둘째-끝']);
  });

  it('다른 키의 작업은 동시에 진행된다', async () => {
    // Given
    const mutex = new KeyedMutex();
    const order = [];

    // When
    await Promise.all([
      mutex.runExclusive('A', async () => {
        order.push('A-시작');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('A-끝');
      }),
      mutex.runExclusive('B', async () => {
        order.push('B-시작');
        order.push('B-끝');
      }),
    ]);

    // Then
    assert.deepEqual(order, ['A-시작', 'B-시작', 'B-끝', 'A-끝']);
  });

  it('앞 작업이 실패해도 뒤 작업은 실행된다', async () => {
    // Given
    const mutex = new KeyedMutex();

    // When
    const failed = mutex.runExclusive('A', async () => {
      throw new Error('실패');
    });
    const succeeded = mutex.runExclusive('A', async () => '성공');

    // Then
    await assert.rejects(() => failed, /실패/);
    assert.equal(await succeeded, '성공');
  });
});

describe('동시 요청 처리', () => {
  it('같은 방에 동시에 온 커맨드가 서로의 결과를 덮어쓰지 않는다', async () => {
    // Given
    const fixture = createAppFixture({ random: scriptedRandom([1, 2, 1, 2, 1, 2]) });
    const started = await startedRoom(fixture, { guestCount: 1 });
    const command = () =>
      fixture.gameService.execute({
        code: started.code,
        token: started.host.seatToken,
        type: COMMAND_TYPES.ROLL,
      });

    // When (같은 좌석이 주사위 커맨드를 두 번 동시에 보낸다)
    const results = await Promise.allSettled([command(), command()]);

    // Then (하나만 성공하고, 저장된 버전은 정확히 1이다)
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, 'ERR005');
    const room = await fixture.repository.findByCode(started.code);
    assert.equal(room.game.version, 1);
  });

  it('동시에 참가한 좌석이 모두 저장된다', async () => {
    // Given
    const fixture = createAppFixture({
      random: new FakeRandomSource(Array.from({ length: 40 }, (_unused, index) => index % 32)),
    });
    const host = await fixture.roomService.createRoom({ hostName: '하나' });

    // When
    await Promise.all([
      fixture.roomService.joinSeat({ code: host.room.code, name: '둘' }),
      fixture.roomService.joinSeat({ code: host.room.code, name: '셋' }),
      fixture.roomService.joinSeat({ code: host.room.code, name: '넷' }),
    ]);

    // Then
    const room = await fixture.repository.findByCode(host.room.code);
    assert.equal(room.seats.length, 4);
    assert.deepEqual(
      room.seats.map((seat) => seat.name).sort(),
      ['넷', '둘', '셋', '하나'],
    );
  });
});
