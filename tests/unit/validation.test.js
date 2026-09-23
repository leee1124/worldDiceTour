import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractToken,
  parseCommandBody,
  parseCreateRoomBody,
  parseHostActionBody,
  parseJoinSeatBody,
  parsePresenceParam,
  requireSeatId,
  safeText,
} from '../../src/server/validation.js';
import { COMMAND_TYPES } from '../../src/domain/game/commands.js';

const TOKEN = 'a'.repeat(64);

describe('입력 검증(화이트리스트)', () => {
  describe('이름', () => {
    it('한글/영문/숫자/공백 1~10자만 허용한다', () => {
      // Given / When / Then
      assert.deepEqual(parseCreateRoomBody({ hostName: '하나 Kim 2' }), { hostName: '하나 Kim 2' });
      assert.deepEqual(parseJoinSeatBody({ name: '두리' }), { name: '두리' });
    });

    it('특수문자·빈값·11자 이상은 거부한다', () => {
      // Given
      const invalidNames = ['', '   ', '<script>', '이름'.repeat(6), '탭\t포함'];

      // When / Then
      for (const name of invalidNames) {
        assert.throws(() => parseJoinSeatBody({ name }), { code: 'ERR001' }, `허용되면 안 됨: ${name}`);
      }
    });

    it('본문이 객체가 아니면 거부한다', () => {
      // Given / When / Then
      assert.throws(() => parseCreateRoomBody('문자열'), { code: 'ERR001' });
      assert.throws(() => parseJoinSeatBody([1, 2]), { code: 'ERR001' });
    });

    it('알 수 없는 필드는 무시한다', () => {
      // Given / When
      const parsed = parseCreateRoomBody({ hostName: '하나', isAdmin: true, __proto__: {} });

      // Then
      assert.deepEqual(Object.keys(parsed), ['hostName']);
    });
  });

  describe('토큰 헤더', () => {
    it('Bearer 형식의 64자리 hex만 허용한다', () => {
      // Given / When / Then
      assert.equal(extractToken({ authorization: `Bearer ${TOKEN}` }), TOKEN);
    });

    it('헤더가 없거나 형식이 다르면 인증 에러다', () => {
      // Given / When / Then
      assert.throws(() => extractToken({}), { code: 'ERR002' });
      assert.throws(() => extractToken({ authorization: TOKEN }), { code: 'ERR002' });
      assert.throws(() => extractToken({ authorization: 'Bearer 짧음' }), { code: 'ERR002' });
      assert.throws(() => extractToken({ authorization: `Bearer ${'Z'.repeat(64)}` }), { code: 'ERR002' });
    });
  });

  describe('좌석 id', () => {
    it('seat-숫자 형식만 허용한다', () => {
      // Given / When / Then
      assert.equal(requireSeatId('seat-12'), 'seat-12');
      assert.throws(() => requireSeatId('../etc/passwd'), { code: 'ERR001' });
      assert.throws(() => requireSeatId('seat-'), { code: 'ERR001' });
    });
  });

  describe('호스트 동작', () => {
    it('허용된 동작만 통과시킨다', () => {
      // Given / When / Then
      assert.deepEqual(parseHostActionBody({ type: 'START', extra: 1 }), { type: 'START' });
      assert.deepEqual(parseHostActionBody({ type: 'ADD_COMPUTER', name: '컴퓨터1' }), {
        type: 'ADD_COMPUTER',
        name: '컴퓨터1',
      });
      assert.deepEqual(parseHostActionBody({ type: 'SET_OPTIONS', roundLimit: 20 }), {
        type: 'SET_OPTIONS',
        roundLimit: 20,
      });
      assert.deepEqual(parseHostActionBody({ type: 'SET_OPTIONS' }), {
        type: 'SET_OPTIONS',
        roundLimit: null,
      });
      assert.deepEqual(
        parseHostActionBody({ type: 'SET_AUTOPILOT', seatId: 'seat-2', enabled: true }),
        { type: 'SET_AUTOPILOT', seatId: 'seat-2', enabled: true },
      );
    });

    it('허용되지 않은 값은 거부한다', () => {
      // Given / When / Then
      assert.throws(() => parseHostActionBody({ type: 'SHUTDOWN' }), { code: 'ERR001' });
      assert.throws(() => parseHostActionBody({ type: 'SET_OPTIONS', roundLimit: 7 }), { code: 'ERR001' });
      assert.throws(() => parseHostActionBody({ type: 'SET_AUTOPILOT', seatId: 'x', enabled: true }), {
        code: 'ERR001',
      });
      assert.throws(() => parseHostActionBody({ type: 'SET_AUTOPILOT', seatId: 'seat-2', enabled: 'yes' }), {
        code: 'ERR001',
      });
    });
  });

  describe('게임 커맨드', () => {
    it('커맨드 종류는 enum으로 제한한다', () => {
      // Given / When / Then
      assert.deepEqual(parseCommandBody({ type: 'ROLL' }), {
        type: 'ROLL',
        seatId: undefined,
        payload: {},
      });
      assert.throws(() => parseCommandBody({ type: 'EVAL' }), { code: 'ERR001' });
    });

    it('건설 목록은 정해진 건물만, 중복 없이 받는다', () => {
      // Given / When / Then
      assert.deepEqual(parseCommandBody({ type: 'BUILD', payload: { buildings: ['VILLA', 'HOTEL'] } }).payload, {
        buildings: ['VILLA', 'HOTEL'],
      });
      assert.throws(() => parseCommandBody({ type: 'BUILD', payload: { buildings: [] } }), { code: 'ERR001' });
      assert.throws(() => parseCommandBody({ type: 'BUILD', payload: { buildings: ['CASTLE'] } }), {
        code: 'ERR001',
      });
      assert.throws(() => parseCommandBody({ type: 'BUILD', payload: { buildings: ['VILLA', 'VILLA'] } }), {
        code: 'ERR001',
      });
      assert.throws(() => parseCommandBody({ type: 'BUILD', payload: { buildings: 'VILLA' } }), {
        code: 'ERR001',
      });
    });

    it('칸 번호는 0~39 정수만 받는다', () => {
      // Given / When / Then
      assert.deepEqual(parseCommandBody({ type: 'TRAVEL', payload: { destination: 39 } }).payload, {
        destination: 39,
      });
      assert.deepEqual(parseCommandBody({ type: 'SELL', payload: { cityIndex: 0 } }).payload, {
        cityIndex: 0,
      });
      assert.throws(() => parseCommandBody({ type: 'TRAVEL', payload: { destination: 40 } }), {
        code: 'ERR001',
      });
      assert.throws(() => parseCommandBody({ type: 'TRAVEL', payload: { destination: -1 } }), {
        code: 'ERR001',
      });
      assert.throws(() => parseCommandBody({ type: 'TRAVEL', payload: { destination: 1.5 } }), {
        code: 'ERR001',
      });
      assert.throws(() => parseCommandBody({ type: 'SELL', payload: {} }), { code: 'ERR001' });
    });

    it('출발 보너스 건설은 칸 번호와 건물 목록을 함께 검증한다', () => {
      // Given / When / Then
      assert.deepEqual(
        parseCommandBody({ type: 'START_BUILD', payload: { cityIndex: 3, buildings: ['VILLA'] } }).payload,
        { cityIndex: 3, buildings: ['VILLA'] },
      );
      assert.throws(
        () => parseCommandBody({ type: 'START_BUILD', payload: { cityIndex: 99, buildings: ['VILLA'] } }),
        { code: 'ERR001' },
      );
    });

    it('카지노 베팅은 게임 종류·금액 단위·선택값을 검증한다', () => {
      // Given
      const bet = (payload) => parseCommandBody({ type: 'CASINO_BET', payload }).payload;

      // When / Then
      assert.deepEqual(bet({ game: 'ODD_EVEN', bet: 10_000, choice: 'ODD' }), {
        game: 'ODD_EVEN',
        bet: 10_000,
        choice: 'ODD',
      });
      assert.deepEqual(bet({ game: 'SLOT', bet: 750_000 }), {
        game: 'SLOT',
        bet: 750_000,
        choice: null,
      });
      assert.throws(() => bet({ game: 'ROULETTE', bet: 10_000 }), { code: 'ERR001' });
      assert.throws(() => bet({ game: 'ODD_EVEN', bet: 15_000, choice: 'ODD' }), { code: 'ERR001' });
      assert.throws(() => bet({ game: 'ODD_EVEN', bet: 760_000, choice: 'ODD' }), { code: 'ERR001' });
      assert.throws(() => bet({ game: 'ODD_EVEN', bet: 10_000, choice: 'MAYBE' }), { code: 'ERR001' });
      assert.throws(() => bet({ game: 'HIGH_LOW_SEVEN', bet: 10_000, choice: 'ODD' }), { code: 'ERR001' });
    });

    it('payload가 객체가 아니면 빈 payload로 취급한다', () => {
      // Given / When
      const parsed = parseCommandBody({ type: 'ROLL', payload: '악의적인 값' });

      // Then
      assert.deepEqual(parsed.payload, {});
    });
  });

  describe('presence 파라미터', () => {
    it('형식이 맞는 좌석:토큰 쌍만 남긴다', () => {
      // Given
      const raw = `seat-1:${TOKEN},seat-2:짧음,깨진쌍,seat-3:${'b'.repeat(64)}`;

      // When
      const pairs = parsePresenceParam(raw);

      // Then
      assert.deepEqual(pairs, [
        { seatId: 'seat-1', token: TOKEN },
        { seatId: 'seat-3', token: 'b'.repeat(64) },
      ]);
    });

    it('빈 값이나 지나치게 긴 값은 무시한다', () => {
      // Given / When / Then
      assert.deepEqual(parsePresenceParam(undefined), []);
      assert.deepEqual(parsePresenceParam(''), []);
      assert.deepEqual(parsePresenceParam('x'.repeat(2_000)), []);
    });

    it('좌석 수 상한(4쌍)까지만 읽는다', () => {
      // Given
      const raw = Array.from({ length: 10 }, (_unused, index) => `seat-${index + 1}:${TOKEN}`).join(',');

      // When
      const pairs = parsePresenceParam(raw);

      // Then
      assert.equal(pairs.length, 4);
    });
  });

  describe('원시 문자열화 공격(toString 오염)', () => {
    /** JSON으로 보낼 수 있으면서 `${value}`를 터뜨리는 페이로드들. */
    const hostilePayloads = [
      ['toString이 숫자', { toString: 1 }],
      ['toString이 null', { toString: null }],
      ['toString이 객체', { toString: {} }],
      ['toString과 valueOf가 모두 숫자', { toString: 1, valueOf: 1 }],
    ];

    for (const [label, hostile] of hostilePayloads) {
      it(`${label}인 값도 ERR001로 거부한다(정수 검증)`, () => {
        // Given / When / Then
        assert.throws(
          () => parseCommandBody({ type: COMMAND_TYPES.TRAVEL, payload: { destination: hostile } }),
          { code: 'ERR001' },
        );
      });

      it(`${label}인 값도 ERR001로 거부한다(커맨드 종류)`, () => {
        // Given / When / Then
        assert.throws(() => parseCommandBody({ type: hostile }), { code: 'ERR001' });
      });

      it(`${label}인 값도 ERR001로 거부한다(건물 목록)`, () => {
        // Given / When / Then
        assert.throws(
          () => parseCommandBody({ type: COMMAND_TYPES.BUILD, payload: { buildings: [hostile] } }),
          { code: 'ERR001' },
        );
      });

      it(`${label}인 값도 ERR001로 거부한다(호스트 동작)`, () => {
        // Given / When / Then
        assert.throws(() => parseHostActionBody({ type: hostile }), { code: 'ERR001' });
      });

      it(`${label}인 값도 ERR001로 거부한다(카지노 선택값)`, () => {
        // Given / When / Then
        assert.throws(
          () =>
            parseCommandBody({
              type: COMMAND_TYPES.CASINO_BET,
              payload: { game: 'ODD_EVEN', bet: 10_000, choice: hostile },
            }),
          { code: 'ERR001' },
        );
      });

      it(`${label}인 이름도 ERR001로 거부한다`, () => {
        // Given / When / Then
        assert.throws(() => parseCreateRoomBody({ hostName: hostile }), { code: 'ERR001' });
      });
    }

    it('오류 메시지에는 공격자 값이 그대로 들어가지 않는다', () => {
      // Given
      const hostile = { toString: 1, secret: 'x'.repeat(5_000) };

      // When
      let detail = '';
      try {
        parseCommandBody({ type: COMMAND_TYPES.TRAVEL, payload: { destination: hostile } });
      } catch (error) {
        detail = error.detail ?? error.message;
      }

      // Then (길이가 제한되고 원본 문자열이 통째로 실리지 않는다)
      assert.ok(detail.length < 500, `메시지가 너무 깁니다: ${detail.length}자`);
      assert.equal(detail.includes('x'.repeat(200)), false);
    });
  });
});

describe('안전한 문자열화(safeText)', () => {
  it('원시값은 그대로 보여준다', () => {
    // Given / When / Then
    assert.equal(safeText(42), '42');
    assert.equal(safeText('hi'), 'hi');
    assert.equal(safeText(null), 'null');
    assert.equal(safeText(undefined), 'undefined');
    assert.equal(safeText(true), 'true');
  });

  it('객체는 JSON으로, 길면 잘라서 보여준다', () => {
    // Given / When
    const text = safeText({ a: 1 });
    const long = safeText({ a: 'y'.repeat(1_000) });

    // Then
    assert.equal(text, '{"a":1}');
    assert.ok(long.length <= 130, `잘리지 않았습니다: ${long.length}자`);
  });

  it('toString이 오염된 객체에도 예외를 던지지 않는다', () => {
    // Given / When / Then
    assert.doesNotThrow(() => safeText({ toString: 1 }));
    assert.doesNotThrow(() => safeText({ toString: null }));
    assert.equal(typeof safeText({ toString: 1 }), 'string');
  });

  it('JSON으로 만들 수 없는 값도 종류만 알려준다', () => {
    // Given (순환 참조)
    const circular = {};
    circular.self = circular;

    // When / Then
    assert.equal(typeof safeText(circular), 'string');
    assert.match(safeText(circular), /object/);
  });
});
