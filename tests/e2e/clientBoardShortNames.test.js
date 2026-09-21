import test from 'node:test';
import assert from 'node:assert/strict';

import { BOARD_SPACES } from '../../src/domain/game/data/board.js';
import { boardCellShortName } from '../../public/js/domain/labels.js';

const MAX_CELL_NAME_LENGTH = 5;

test('보드 칸 축약 이름: 실제 보드 40칸 모두 축약 후 5자 이내가 된다', () => {
  // Given 서버가 정의한 보드 40칸의 실제 이름
  // When 보드 칸 표시용 축약을 적용하면
  for (const space of BOARD_SPACES) {
    const short = boardCellShortName(space.name);
    // Then 어느 칸도 5자를 넘지 않는다(좁은 칸에서 잘리지 않는다)
    assert.ok(
      short.length <= MAX_CELL_NAME_LENGTH,
      `${space.name} → ${short} (${short.length}자)는 ${MAX_CELL_NAME_LENGTH}자를 넘는다`,
    );
  }
});

test('보드 칸 축약 이름: 매핑에 없는 이름은 원래 이름 그대로 돌려준다', () => {
  // Given 축약이 필요 없는 짧은 이름
  // When 축약 함수를 적용하면
  // Then 그대로 나온다(원본을 바꾸지 않는다)
  assert.equal(boardCellShortName('방콕'), '방콕');
  assert.equal(boardCellShortName('출발'), '출발');
  assert.equal(boardCellShortName(undefined), undefined);
});

test('보드 칸 축약 이름: 매핑에 있는 이름만 정확히 줄어들고, 그 외 문자열에는 영향이 없다', () => {
  // Given 예시로 든 긴 도시 이름들
  // When 축약을 적용하면
  // Then 원래 의미를 알아볼 수 있는 축약형으로 바뀐다
  assert.equal(boardCellShortName('부에노스아이레스'), '부에노스');
  assert.equal(boardCellShortName('리우데자네이루'), '리우');
  assert.equal(boardCellShortName('샌프란시스코'), '샌프란');
  assert.equal(boardCellShortName('알프스 설원열차'), '설원열차');
  assert.equal(boardCellShortName('카리브 크루즈'), '크루즈');
  assert.equal(boardCellShortName('멕시코시티'), '멕시코');
  assert.equal(boardCellShortName('암스테르담'), '암스텔');
  assert.equal(boardCellShortName('바르셀로나'), '바르셀');

  // And 시트·모달·로그·aria-label에 쓰이는 원래 이름 문자열 자체는 바뀌지 않는다
  const original = '부에노스아이레스';
  boardCellShortName(original);
  assert.equal(original, '부에노스아이레스');
});
