import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Board } from '../../src/domain/game/Board.js';
import { SPACE_KINDS, BOARD_SPACES } from '../../src/domain/game/data/board.js';
import { DomainError } from '../../src/domain/shared/DomainError.js';

describe('Board(보드 40칸)', () => {
  describe('보드 데이터', () => {
    it('40칸으로 구성되고 모서리 4칸이 명세와 같다', () => {
      // Given
      const board = Board.createDefault();

      // When / Then
      assert.equal(board.size, 40);
      assert.equal(board.spaceAt(0).kind, SPACE_KINDS.START);
      assert.equal(board.spaceAt(10).kind, SPACE_KINDS.ISLAND);
      assert.equal(board.spaceAt(20).kind, SPACE_KINDS.CASINO);
      assert.equal(board.spaceAt(30).kind, SPACE_KINDS.AIRPORT);
    });

    it('명세의 가격표와 일치한다', () => {
      // Given
      const board = Board.createDefault();

      // When / Then
      assert.equal(board.cityAt(1).name, '하노이');
      assert.equal(board.cityAt(1).price, 60_000);
      assert.equal(board.cityAt(39).name, '서울');
      assert.equal(board.cityAt(39).price, 800_000);
      assert.equal(board.cityAt(5).kind, SPACE_KINDS.RESORT);
      assert.equal(board.cityAt(5).price, 200_000);
    });

    it('행운 티켓 6칸, 세관 1칸, 휴양지 4칸을 가진다', () => {
      // Given
      const count = (kind) => BOARD_SPACES.filter((space) => space.kind === kind).length;

      // When / Then
      assert.equal(count(SPACE_KINDS.TICKET), 6);
      assert.equal(count(SPACE_KINDS.TAX), 1);
      assert.equal(count(SPACE_KINDS.RESORT), 4);
    });

    it('소유 가능한 칸이 아니면 cityAt으로 접근할 수 없다', () => {
      // Given
      const board = Board.createDefault();

      // When / Then
      assert.throws(() => board.cityAt(2), DomainError);
    });
  });

  describe('이동 계산', () => {
    it('앞으로 전진하며 출발 칸 통과 여부를 알려준다', () => {
      // Given
      const board = Board.createDefault();

      // When
      const normal = board.advance(3, 5);
      const wrapped = board.advance(38, 4);

      // Then
      assert.deepEqual(normal, { index: 8, passedStart: false });
      assert.deepEqual(wrapped, { index: 2, passedStart: true });
    });

    it('출발 칸에 정확히 도착해도 통과로 본다', () => {
      // Given
      const board = Board.createDefault();

      // When
      const result = board.advance(35, 5);

      // Then
      assert.deepEqual(result, { index: 0, passedStart: true });
    });

    it('뒤로 이동하면 출발 칸을 통과하지 않는다', () => {
      // Given
      const board = Board.createDefault();

      // When
      const result = board.advance(3, -5);

      // Then
      assert.deepEqual(result, { index: 38, passedStart: false });
    });

    it('목적지까지 전진 걸음 수를 계산한다', () => {
      // Given
      const board = Board.createDefault();

      // When / Then
      assert.equal(board.stepsTo(35, 2), 7);
      assert.equal(board.stepsTo(2, 35), 33);
      assert.equal(board.stepsTo(7, 7), 0);
    });

    it('가장 가까운 휴양지를 앞 방향으로 찾는다', () => {
      // Given
      const board = Board.createDefault();

      // When / Then
      assert.equal(board.nearestResortFrom(1), 5);
      assert.equal(board.nearestResortFrom(36), 5);
      assert.equal(board.nearestResortFrom(15), 25);
    });

    it('특정 종류 칸의 위치를 찾는다', () => {
      // Given
      const board = Board.createDefault();

      // When / Then
      assert.equal(board.indexOfKind(SPACE_KINDS.CASINO), 20);
      assert.equal(board.indexOfKind(SPACE_KINDS.AIRPORT), 30);
      assert.equal(board.indexOfKind(SPACE_KINDS.ISLAND), 10);
    });

    it('범위를 벗어난 칸 번호는 거부한다', () => {
      // Given
      const board = Board.createDefault();

      // When / Then
      assert.throws(() => board.spaceAt(40), DomainError);
      assert.throws(() => board.spaceAt(-1), DomainError);
    });
  });

  describe('소유 현황 집계', () => {
    it('플레이어가 가진 칸/휴양지 수/건물 단계 합/총자산을 집계한다', () => {
      // Given
      const board = Board.createDefault();
      board.cityAt(1).buy('p1');
      board.cityAt(5).buy('p1');
      board.cityAt(15).buy('p1');
      board.cityAt(39).buy('p2');
      board.cityAt(1).upgrade();
      board.cityAt(1).upgrade();

      // When / Then
      assert.equal(board.ownedBy('p1').length, 3);
      assert.equal(board.resortCountOf('p1'), 2);
      assert.equal(board.buildingLevelSumOf('p1'), 2);
      assert.equal(board.totalAssetValueOf('p1'), 60_000 + 60_000 + 200_000 + 200_000);
      assert.equal(board.cityCountOf('p1'), 1);
    });

    it('파산한 플레이어의 모든 칸을 주인 없는 상태로 되돌린다', () => {
      // Given
      const board = Board.createDefault();
      board.cityAt(1).buy('p1');
      board.cityAt(5).buy('p1');
      board.cityAt(5).upgrade === undefined;

      // When
      board.releaseAllOf('p1');

      // Then
      assert.equal(board.ownedBy('p1').length, 0);
      assert.equal(board.cityAt(1).isOwned(), false);
    });

    it('주인 없는 칸 목록을 알려준다', () => {
      // Given
      const board = Board.createDefault();
      const beforeCount = board.unowned().length;
      board.cityAt(1).buy('p1');

      // When
      const after = board.unowned();

      // Then
      assert.equal(after.length, beforeCount - 1);
      assert.equal(
        after.some((city) => city.index === 1),
        false,
      );
    });
  });
});
