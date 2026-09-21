import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_FINANCE_OPTIONS,
  DEFAULT_FINANCE_OPTIONS,
  FINANCE_OPTION_KEYS,
  normalizeFinanceOptions,
} from '../../src/domain/room/FinanceOptions.js';
import { ROOM_SCHEMA_VERSION, ROOM_STATUS, Room } from '../../src/domain/room/Room.js';
import { toRoomDto } from '../../src/application/dto.js';
import { parseHostActionBody } from '../../src/server/validation.js';
import { DOMAIN_ERROR_CODES } from '../../src/domain/shared/DomainError.js';
import { FakeRandomSource } from '../support/FakeRandomSource.js';

const NOW = 1_700_000_000_000;
const lobby = () => Room.create({ code: 'AB2C', hostName: '하나', token: 'a'.repeat(64), now: NOW });

describe('FinanceOptions(구조화된 금융 옵션)', () => {
  it('기본값은 전부 꺼진 상태다', () => {
    // Given / When / Then
    assert.deepEqual(DEFAULT_FINANCE_OPTIONS, {
      investmentMode: 'OFF',
      financeSystem: 'BASIC',
      tradeTimerSec: 0,
      scenario: 'STANDARD',
    });
    assert.deepEqual(FINANCE_OPTION_KEYS, [
      'investmentMode',
      'financeSystem',
      'tradeTimerSec',
      'scenario',
    ]);
  });

  it('없거나 비어 있으면 기본값으로 채운다', () => {
    // Given / When / Then
    assert.deepEqual(normalizeFinanceOptions(undefined), DEFAULT_FINANCE_OPTIONS);
    assert.deepEqual(normalizeFinanceOptions(null), DEFAULT_FINANCE_OPTIONS);
    assert.deepEqual(normalizeFinanceOptions({}), DEFAULT_FINANCE_OPTIONS);
    assert.notEqual(normalizeFinanceOptions({}), DEFAULT_FINANCE_OPTIONS, '사본을 준다');
  });

  it('기본값과 같은 값을 명시해도 통과한다', () => {
    // Given / When / Then
    assert.deepEqual(normalizeFinanceOptions({ ...DEFAULT_FINANCE_OPTIONS }), DEFAULT_FINANCE_OPTIONS);
  });

  it('아직 구현되지 않은 값은 거부한다(있는 척하는 옵션을 만들지 않는다)', () => {
    // Given (설계상 존재하지만 기능이 없는 값들)
    const notYet = [
      { investmentMode: 'STOCKS_CRYPTO' },
      { investmentMode: 'ADVANCED' },
      { financeSystem: 'ADVANCED' },
      { tradeTimerSec: 30 },
      { scenario: 'BUBBLE' },
    ];

    // When / Then
    for (const raw of notYet) {
      assert.throws(
        () => normalizeFinanceOptions(raw),
        { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
        `거부되지 않았다: ${JSON.stringify(raw)}`,
      );
    }
  });

  it('모르는 키나 객체가 아닌 값은 거부한다', () => {
    // Given / When / Then
    assert.throws(() => normalizeFinanceOptions({ margin: true }), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.throws(() => normalizeFinanceOptions('OFF'), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
    assert.throws(() => normalizeFinanceOptions([]), {
      code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT,
    });
  });

  it('허용 목록은 앞으로 값이 추가될 자리다', () => {
    // Given / When / Then
    for (const key of FINANCE_OPTION_KEYS) {
      assert.ok(Array.isArray(ALLOWED_FINANCE_OPTIONS[key]), `${key} 허용 목록이 없다`);
      assert.ok(
        ALLOWED_FINANCE_OPTIONS[key].includes(DEFAULT_FINANCE_OPTIONS[key]),
        `${key} 기본값이 허용 목록에 없다`,
      );
    }
  });
});

describe('Room.setOptions(금융 옵션)', () => {
  it('새 방은 금융 옵션 기본값을 갖는다', () => {
    // Given / When
    const room = lobby();

    // Then
    assert.deepEqual(room.options.finance, DEFAULT_FINANCE_OPTIONS);
  });

  it('호스트가 투자 모드를 STOCKS로 켤 수 있다(증권거래소 개방)', () => {
    // Given
    const room = lobby();

    // When
    room.setOptions({
      roundLimit: 30,
      finance: { investmentMode: 'STOCKS' },
      bySeatId: room.hostSeatId,
      now: NOW,
    });

    // Then (보낸 키만 바뀌고 나머지는 기본값을 유지한다)
    assert.deepEqual(room.options.finance, {
      ...DEFAULT_FINANCE_OPTIONS,
      investmentMode: 'STOCKS',
    });
  });

  it('호스트가 대기실에서 금융 옵션을 바꿀 수 있다(기본값 범위 안에서)', () => {
    // Given
    const room = lobby();

    // When
    room.setOptions({
      roundLimit: 20,
      finance: { investmentMode: 'OFF', tradeTimerSec: 0 },
      bySeatId: room.hostSeatId,
      now: NOW,
    });

    // Then
    assert.equal(room.options.roundLimit, 20);
    assert.deepEqual(room.options.finance, DEFAULT_FINANCE_OPTIONS);
  });

  it('금융 옵션을 빼고 보내면 기존 값이 유지된다(가산 호환)', () => {
    // Given
    const room = lobby();

    // When
    room.setOptions({ roundLimit: 30, bySeatId: room.hostSeatId, now: NOW });

    // Then
    assert.deepEqual(room.options.finance, DEFAULT_FINANCE_OPTIONS);
  });

  it('구현되지 않은 값은 도메인이 거부한다', () => {
    // Given
    const room = lobby();

    // When / Then
    assert.throws(
      () =>
        room.setOptions({
          roundLimit: null,
          finance: { financeSystem: 'ADVANCED' },
          bySeatId: room.hostSeatId,
          now: NOW,
        }),
      { code: DOMAIN_ERROR_CODES.INVALID_ARGUMENT },
    );
    assert.deepEqual(room.options.finance, DEFAULT_FINANCE_OPTIONS, '거부되면 상태가 그대로다');
  });

  it('게임이 시작된 뒤에는 바꿀 수 없다(판 중간에 밸런스가 바뀌면 안 된다)', () => {
    // Given
    const room = lobby();
    room.join({ name: '두리', token: 'b'.repeat(64), now: NOW });
    room.start({ bySeatId: room.hostSeatId, random: new FakeRandomSource(), now: NOW });

    // When / Then
    assert.equal(room.status, ROOM_STATUS.PLAYING);
    assert.throws(
      () =>
        room.setOptions({
          roundLimit: null,
          finance: { ...DEFAULT_FINANCE_OPTIONS },
          bySeatId: room.hostSeatId,
          now: NOW,
        }),
      { code: DOMAIN_ERROR_CODES.INVALID_STATE },
    );
  });

  it('스냅샷을 왕복해도 금융 옵션이 유지된다', () => {
    // Given
    const room = lobby();

    // When
    const restored = Room.restore(room.toSnapshot(), new FakeRandomSource());

    // Then
    assert.deepEqual(restored.options.finance, DEFAULT_FINANCE_OPTIONS);
    assert.deepEqual(restored.toSnapshot().options, room.toSnapshot().options);
  });
});

describe('금융 옵션 입력 검증(컨트롤러)', () => {
  it('finance를 빼면 그대로 통과한다(기존 클라이언트 호환)', () => {
    // Given / When
    const action = parseHostActionBody({ type: 'SET_OPTIONS', roundLimit: 20 });

    // Then
    assert.deepEqual(action, { type: 'SET_OPTIONS', roundLimit: 20 });
  });

  it('기본값 범위의 finance는 통과한다', () => {
    // Given / When
    const action = parseHostActionBody({
      type: 'SET_OPTIONS',
      roundLimit: null,
      finance: { investmentMode: 'OFF', financeSystem: 'BASIC', tradeTimerSec: 0, scenario: 'STANDARD' },
    });

    // Then
    assert.deepEqual(action, {
      type: 'SET_OPTIONS',
      roundLimit: null,
      finance: DEFAULT_FINANCE_OPTIONS,
    });
  });

  it('보낸 키만 도메인으로 넘긴다(생략한 옵션을 기본값으로 되돌리지 않는다)', () => {
    // Given (한 항목만 바꾸려는 요청 — 컨트롤러가 빈 자리를 채워 넘기면
    //        도메인의 "생략하면 유지" 규칙이 죽어 나머지가 조용히 초기화된다)
    const action = parseHostActionBody({
      type: 'SET_OPTIONS',
      roundLimit: 20,
      finance: { tradeTimerSec: 0 },
    });

    // Then
    assert.deepEqual(action.finance, { tradeTimerSec: 0 });
    assert.deepEqual(Object.keys(action.finance), ['tradeTimerSec']);
  });

  it('빈 finance 객체는 아무 항목도 바꾸지 않는 요청이 된다', () => {
    // Given / When
    const action = parseHostActionBody({ type: 'SET_OPTIONS', roundLimit: null, finance: {} });

    // Then
    assert.deepEqual(action.finance, {});
  });

  it('아직 없는 값·모르는 키·객체가 아닌 finance는 ERR001이다', () => {
    // Given
    const bad = [
      { investmentMode: 'STOCKS_CRYPTO' },
      { tradeTimerSec: 45 },
      { scenario: 'DEPRESSION' },
      { unknown: 1 },
      'OFF',
      [],
      42,
    ];

    // When / Then
    for (const finance of bad) {
      assert.throws(
        () => parseHostActionBody({ type: 'SET_OPTIONS', roundLimit: null, finance }),
        { code: 'ERR001' },
        `거부되지 않았다: ${JSON.stringify(finance)}`,
      );
    }
  });
});

describe('금융 옵션과 스키마 버전의 결합(다음 Phase를 위한 계약)', () => {
  it('허용 값 목록을 넓히면 스키마 버전도 함께 올려야 한다', () => {
    // Given (구버전 서버는 모르는 값을 담은 방 파일을 손상으로 보고 **격리**한다. 그래서 값을
    //        넓히는 변경은 schemaVersion 승급과 함께 가야 한다. 값을 늘리면 이 테스트가
    //        깨지며 그 약속을 상기시킨다.)
    const allowedCount = FINANCE_OPTION_KEYS.reduce(
      (sum, key) => sum + ALLOWED_FINANCE_OPTIONS[key].length,
      0,
    );

    // When / Then
    assert.equal(
      allowedCount,
      // investmentMode만 값이 둘(OFF·STOCKS)이고 나머지 세 키는 하나씩이다.
      FINANCE_OPTION_KEYS.length + 1,
      '허용 값을 추가했다면 ROOM_SCHEMA_VERSION을 올리고 MIGRATIONS에 한 줄 추가한 뒤 이 숫자를 갱신할 것',
    );
    assert.equal(ROOM_SCHEMA_VERSION, 3);
  });
});

describe('RoomDto(금융 옵션 가산)', () => {
  it('방 상세 DTO가 options.finance를 함께 담는다', () => {
    // Given
    const room = lobby();

    // When
    const dto = toRoomDto(room);

    // Then
    assert.deepEqual(dto.options, { roundLimit: null, finance: DEFAULT_FINANCE_OPTIONS });
  });
});
