import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseCommandBody } from '../../src/server/validation.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';
import { ERROR_CATALOG } from '../../src/application/errors.js';
import { DOMAIN_ERROR_CODES, DomainError } from '../../src/domain/shared/DomainError.js';
import { AppError } from '../../src/application/errors.js';
import { TokenBucketLimiter } from '../../src/application/RateLimiter.js';
import { TRADE_COMMAND_TYPES } from '../../src/application/tradeCommands.js';

const body = (type, payload) => ({ type, payload });
const parse = (type, payload) => parseCommandBody(body(type, payload));

/** 형식 위반은 무조건 ERR001이며 예외가 새지 않아야 한다. */
function assertRejected(type, payload, label) {
  assert.throws(() => parse(type, payload), { code: 'ERR001' }, `거부되지 않았다: ${label}`);
}

describe('거래 커맨드 페이로드 화이트리스트(설계서 §4.3)', () => {
  it('BUY_STOCK / SELL_STOCK은 종목 형식과 수량 1~200만 통과시킨다', () => {
    // Given / When / Then
    for (const type of [COMMAND_TYPES.BUY_STOCK, COMMAND_TYPES.SELL_STOCK]) {
      assert.deepEqual(parse(type, { instrumentId: 'AIR', quantity: 10 }).payload, {
        instrumentId: 'AIR',
        quantity: 10,
      });
      assert.deepEqual(parse(type, { instrumentId: 'ROCK', quantity: 200 }).payload, {
        instrumentId: 'ROCK',
        quantity: 200,
      });

      for (const [payload, label] of [
        [{ instrumentId: 'air', quantity: 1 }, '소문자'],
        [{ instrumentId: 'A', quantity: 1 }, '한 글자'],
        [{ instrumentId: 'TOOLONGID', quantity: 1 }, '너무 긴 id'],
        [{ instrumentId: 'AI-R', quantity: 1 }, '기호 포함'],
        [{ instrumentId: 'AIR' }, '수량 없음'],
        [{ instrumentId: 'AIR', quantity: 0 }, '수량 0'],
        [{ instrumentId: 'AIR', quantity: -5 }, '음수 수량'],
        [{ instrumentId: 'AIR', quantity: 201 }, '상한 초과'],
        [{ instrumentId: 'AIR', quantity: 1.5 }, '소수'],
        [{ instrumentId: 'AIR', quantity: '10' }, '문자열 수량'],
        [{ instrumentId: 'AIR', quantity: Number.NaN }, 'NaN'],
        [{ instrumentId: 'AIR', quantity: 1e21 }, '지수 표기'],
        [{ instrumentId: 'AIR', quantity: Number.MAX_SAFE_INTEGER + 2 }, '안전 정수 초과'],
        [{ instrumentId: 'AIR', quantity: -0 }, '-0'],
        [{ instrumentId: { toString: 1 }, quantity: 1 }, '문자열화가 터지는 값'],
        [{ instrumentId: ['AIR'], quantity: 1 }, '배열'],
      ]) {
        assertRejected(type, payload, `${type} ${label}`);
      }
    }
  });

  it('DEPOSIT / WITHDRAW는 10,000원 단위·10,000~10,000,000원만 통과시킨다', () => {
    // Given / When / Then
    for (const type of [COMMAND_TYPES.DEPOSIT, COMMAND_TYPES.WITHDRAW]) {
      assert.deepEqual(parse(type, { amount: 10_000 }).payload, { amount: 10_000 });
      assert.deepEqual(parse(type, { amount: 10_000_000 }).payload, { amount: 10_000_000 });

      for (const [amount, label] of [
        [0, '0'],
        [-10_000, '음수'],
        [5_000, '단위 미달'],
        [15_000, '단위 아님'],
        [10_000_001, '상한 초과'],
        [1.5, '소수'],
        ['10000', '문자열'],
        [Number.NaN, 'NaN'],
        [Number.POSITIVE_INFINITY, '무한'],
        [1e21, '지수 표기'],
        [undefined, '없음'],
      ]) {
        assertRejected(type, { amount }, `${type} ${label}`);
      }
    }
  });

  it('CLOSE_TRADING은 페이로드가 없다(알 수 없는 필드는 버린다)', () => {
    // Given / When / Then
    assert.deepEqual(parse(COMMAND_TYPES.CLOSE_TRADING, { hack: 1 }).payload, {});
  });

  it('QUEUE_ORDER는 종류별로 필요한 필드만 통과시킨다', () => {
    // Given / When / Then
    assert.deepEqual(
      parse(COMMAND_TYPES.QUEUE_ORDER, { kind: 'BUY_STOCK', instrumentId: 'AIR', quantity: 10 }).payload,
      { kind: 'BUY_STOCK', instrumentId: 'AIR', quantity: 10 },
    );
    assert.deepEqual(parse(COMMAND_TYPES.QUEUE_ORDER, { kind: 'DEPOSIT', amount: 50_000 }).payload, {
      kind: 'DEPOSIT',
      amount: 50_000,
    });

    for (const [payload, label] of [
      [{ kind: 'BUY_COIN', instrumentId: 'HAN', quantity: 1 }, '없는 종류'],
      [{ kind: 'BUY_STOCK', amount: 10_000 }, '주식인데 금액'],
      [{ kind: 'DEPOSIT', instrumentId: 'AIR', quantity: 1 }, '예금인데 종목'],
      [{ kind: 'BUY_STOCK', instrumentId: 'AIR', quantity: 999 }, '수량 초과'],
      [{ kind: 'WITHDRAW', amount: 1 }, '금액 단위'],
      [{}, '빈 페이로드'],
    ]) {
      assertRejected(COMMAND_TYPES.QUEUE_ORDER, payload, label);
    }
  });

  it('CANCEL_QUEUED_ORDER는 ord-숫자 형식만 통과시킨다', () => {
    // Given / When / Then
    assert.deepEqual(parse(COMMAND_TYPES.CANCEL_QUEUED_ORDER, { orderId: 'ord-12' }).payload, {
      orderId: 'ord-12',
    });
    for (const [orderId, label] of [
      ['ord-', '숫자 없음'],
      ['ORD-1', '대문자'],
      ['ord-99999', '너무 긴 번호'],
      ['ord-1; DROP', '기호 포함'],
      [1, '숫자'],
      [undefined, '없음'],
    ]) {
      assertRejected(COMMAND_TYPES.CANCEL_QUEUED_ORDER, { orderId }, label);
    }
  });

  it('SELL_ASSET은 자산군 화이트리스트와 id 형식·수량을 검증한다', () => {
    // Given / When / Then
    assert.deepEqual(
      parse(COMMAND_TYPES.SELL_ASSET, { assetKind: 'STOCK', assetId: 'AIR', quantity: 5 }).payload,
      { assetKind: 'STOCK', assetId: 'AIR', quantity: 5 },
    );
    assert.deepEqual(parse(COMMAND_TYPES.SELL_ASSET, { assetKind: 'PROPERTY', assetId: '3' }).payload, {
      assetKind: 'PROPERTY',
      assetId: '3',
      quantity: null,
    });
    assert.deepEqual(
      parse(COMMAND_TYPES.SELL_ASSET, { assetKind: 'DEPOSIT', assetId: 'CASH', quantity: 20_000 })
        .payload,
      { assetKind: 'DEPOSIT', assetId: 'CASH', quantity: 20_000 },
    );

    for (const [payload, label] of [
      [{ assetKind: 'CRYPTO', assetId: 'HAN' }, '아직 없는 자산군'],
      [{ assetKind: 'STOCK', assetId: '' }, '빈 id'],
      [{ assetKind: 'STOCK', assetId: 'a'.repeat(17) }, '너무 긴 id'],
      [{ assetKind: 'STOCK', assetId: '../../etc' }, '경로 문자'],
      [{ assetKind: 'STOCK', assetId: 'AIR', quantity: 0 }, '수량 0'],
      [{ assetKind: 'STOCK', assetId: 'AIR', quantity: -1 }, '음수 수량'],
      [{ assetKind: 'STOCK', assetId: 'AIR', quantity: 1.5 }, '소수 수량'],
      [{ assetKind: 'STOCK', assetId: 'AIR', quantity: 1e21 }, '지수 표기'],
      [{ assetId: 'AIR' }, '자산군 없음'],
    ]) {
      assertRejected(COMMAND_TYPES.SELL_ASSET, payload, label);
    }
  });

  it('기존 커맨드의 페이로드 검증은 달라지지 않았다', () => {
    // Given / When / Then
    assert.deepEqual(parse(COMMAND_TYPES.SELL, { cityIndex: 3 }).payload, { cityIndex: 3 });
    assert.deepEqual(parse(COMMAND_TYPES.ROLL, {}).payload, {});
    assertRejected(COMMAND_TYPES.SELL, { cityIndex: 40 }, '보드 범위');
  });
});

describe('새 에러 코드', () => {
  it('ERR018(409 주문 한도)과 ERR019(429 레이트 리밋)가 카탈로그에 있다', () => {
    // Given / When / Then
    assert.deepEqual(ERROR_CATALOG.ERR018, {
      status: 409,
      message: '주문 한도를 초과했습니다.',
    });
    assert.deepEqual(ERROR_CATALOG.ERR019, {
      status: 429,
      message: '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.',
    });
  });

  it('설계서가 예고한 ERR015/ERR016의 기존 뜻은 그대로다', () => {
    // Given / When / Then (이미 다른 뜻으로 쓰이고 있어 번호를 새로 발급했다)
    assert.equal(ERROR_CATALOG.ERR015.status, 403);
    assert.equal(ERROR_CATALOG.ERR016.status, 503);
  });

  it('도메인의 TRADE_LIMIT 사유가 ERR018로 매핑된다', () => {
    // Given
    const error = DomainError.tradeLimit('창구 예산을 넘습니다');

    // When
    const app = AppError.from(error);

    // Then
    assert.equal(app.code, 'ERR018');
    assert.equal(app.status, 409);
    assert.deepEqual(app.toBody(), { code: 'ERR018', message: '주문 한도를 초과했습니다.' });
  });

  it('다른 도메인 사유의 매핑은 달라지지 않았다', () => {
    // Given / When / Then
    assert.equal(AppError.from(DomainError.insufficientCash('x')).code, 'ERR008');
    assert.equal(AppError.from(DomainError.invalidPhase('x')).code, 'ERR005');
    assert.equal(AppError.from(DomainError.notYourTurn('x')).code, 'ERR006');
    assert.equal(AppError.from(DomainError.forbidden('x')).code, 'ERR003');
    assert.equal(AppError.from(new DomainError(DOMAIN_ERROR_CODES.INVALID_ARGUMENT, 'x')).code, 'ERR001');
  });
});

describe('좌석당 거래 레이트 리밋(토큰 버킷)', () => {
  it('창 안에서 상한까지만 통과시키고 넘으면 거부한다', () => {
    // Given (5초에 10건)
    let now = 1_000;
    const limiter = new TokenBucketLimiter({ capacity: 10, windowMs: 5_000, now: () => now });

    // When / Then
    for (let index = 0; index < 10; index += 1) {
      assert.equal(limiter.tryConsume('AB2C:seat-1'), true, `${index + 1}번째가 막혔다`);
    }
    assert.equal(limiter.tryConsume('AB2C:seat-1'), false, '11번째는 막혀야 한다');
  });

  it('시간이 지나면 조금씩 회복된다', () => {
    // Given
    let now = 1_000;
    const limiter = new TokenBucketLimiter({ capacity: 10, windowMs: 5_000, now: () => now });
    for (let index = 0; index < 10; index += 1) {
      limiter.tryConsume('AB2C:seat-1');
    }

    // When (창의 절반이 지나면 5건이 회복된다)
    now += 2_500;

    // Then
    for (let index = 0; index < 5; index += 1) {
      assert.equal(limiter.tryConsume('AB2C:seat-1'), true, `회복 ${index + 1}번째`);
    }
    assert.equal(limiter.tryConsume('AB2C:seat-1'), false);
  });

  it('좌석마다 따로 센다(남의 거래가 내 한도를 깎지 않는다)', () => {
    // Given
    let now = 1_000;
    const limiter = new TokenBucketLimiter({ capacity: 2, windowMs: 5_000, now: () => now });

    // When
    limiter.tryConsume('AB2C:seat-1');
    limiter.tryConsume('AB2C:seat-1');

    // Then
    assert.equal(limiter.tryConsume('AB2C:seat-1'), false);
    assert.equal(limiter.tryConsume('AB2C:seat-2'), true, '다른 좌석은 영향이 없다');
    assert.equal(limiter.tryConsume('CD3E:seat-1'), true, '다른 방도 영향이 없다');
  });

  it('오래 쓰지 않은 항목은 정리되어 메모리가 무한히 늘지 않는다', () => {
    // Given
    let now = 1_000;
    const limiter = new TokenBucketLimiter({ capacity: 2, windowMs: 5_000, now: () => now });
    for (let index = 0; index < 50; index += 1) {
      limiter.tryConsume(`AB2C:seat-${index}`);
    }
    assert.equal(limiter.size, 50);

    // When (창을 두 번 넘긴 뒤 새 요청이 들어오면 청소된다)
    now += 5_000 * 2 + 1;
    limiter.tryConsume('ZZ9Z:seat-1');

    // Then
    assert.equal(limiter.size, 1);
  });

  it('거래 커맨드 목록이 제한 대상이고 기존 커맨드는 제한하지 않는다', () => {
    // Given / When / Then
    assert.deepEqual([...TRADE_COMMAND_TYPES].sort(), [
      'BUY_STOCK',
      'CANCEL_QUEUED_ORDER',
      'DEPOSIT',
      'QUEUE_ORDER',
      'SELL_STOCK',
      'WITHDRAW',
    ]);
    assert.ok(!TRADE_COMMAND_TYPES.has(COMMAND_TYPES.ROLL), '주사위는 제한 대상이 아니다');
    assert.ok(
      !TRADE_COMMAND_TYPES.has(COMMAND_TYPES.CLOSE_TRADING),
      '창구 마감은 막히면 턴이 멈춘다 — 제한 대상이 아니다',
    );
    assert.ok(
      !TRADE_COMMAND_TYPES.has(COMMAND_TYPES.SELL_ASSET),
      '정리 매각은 강제 지불 경로다 — 막히면 판이 멈춘다',
    );
  });
});
