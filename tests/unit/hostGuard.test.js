import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isAllowedHost, parseAllowedHosts } from '../../src/server/hostGuard.js';

describe('Host 헤더 검증(DNS 리바인딩 방어)', () => {
  describe('허용되는 주소', () => {
    const allowed = [
      'localhost',
      'localhost:5173',
      '127.0.0.1',
      '127.0.0.1:5173',
      '127.1.2.3:5173',
      '[::1]',
      '[::1]:5173',
      '10.0.0.5:5173',
      '10.255.255.254',
      '172.16.0.1:5173',
      '172.31.255.254',
      '192.168.0.12:5173',
      '192.168.1.1',
      '169.254.10.20:5173',
      'mypc',
      'mypc:5173',
      'my-pc-2:5173',
      'mypc.local',
      'mypc.local:5173',
      'MyPC.LOCAL:5173',
    ];

    for (const host of allowed) {
      it(`${host}는 허용한다`, () => {
        // Given / When / Then
        assert.equal(isAllowedHost(host), true);
      });
    }
  });

  describe('거부되는 주소', () => {
    const rejected = [
      [undefined, '헤더 없음'],
      ['', '빈 값'],
      ['evil.com', '외부 도메인'],
      ['evil.com:5173', '포트가 붙은 외부 도메인'],
      ['attacker.localhost.evil.com', '접미사 위장'],
      ['172.15.0.1', 'RFC1918 밖의 172.x'],
      ['172.32.0.1', 'RFC1918 밖의 172.x'],
      ['11.0.0.1', '사설 대역 밖'],
      ['192.169.0.1', '사설 대역 밖'],
      ['8.8.8.8:5173', '공인 IP'],
      ['[2001:db8::1]:5173', '루프백이 아닌 IPv6'],
      ['localhost.evil', '단일 라벨이 아닌 위장'],
      ['192.168.0.12:not-a-port', '포트 형식 오류'],
      ['192.168.0.12:99999', '포트 범위 초과'],
      ['my pc', '공백이 든 호스트명'],
    ];

    for (const [host, reason] of rejected) {
      it(`${reason}은 거부한다(${String(host)})`, () => {
        // Given / When / Then
        assert.equal(isAllowedHost(host), false);
      });
    }
  });

  describe('우회 시도', () => {
    const bypassAttempts = [
      ['user@evil.com', '사용자 정보로 위장'],
      ['localhost@evil.com', '루프백 이름을 사용자 정보에 넣은 위장'],
      ['192.168.0.1@evil.com', '사설 IP를 사용자 정보에 넣은 위장'],
      ['localhost.', '뒤에 점을 붙인 루프백'],
      ['mypc.local.', '뒤에 점을 붙인 mDNS'],
      ['localhost:5173/../evil', '경로를 섞은 값'],
      ['localhost\r\nX-Injected: 1', '헤더 주입 시도'],
      ['localhost\nevil.com', '줄바꿈으로 이은 값'],
      [' evil.com ', '공백으로 감싼 외부 도메인'],
      ['localhost evil.com', '공백으로 이은 값'],
      ['::1', '대괄호 없는 IPv6 루프백(Host 문법 위반)'],
      ['0:0:0:0:0:0:0:1', '축약하지 않은 IPv6 루프백(대괄호 없음)'],
      ['[::ffff:192.168.0.1]', 'IPv4 매핑 IPv6'],
      ['192.168.0.1.evil.com', '사설 IP를 접두사로 붙인 도메인'],
      ['evil.com:192.168.0.1', '포트 자리에 IP'],
      ['192.168.0.256', '범위를 넘는 옥텟'],
      ['0177.0.0.1', '8진수 표기'],
      ['2130706433', '정수 표기 루프백'],
      ['0x7f.0.0.1', '16진수 표기'],
      ['192.168.0.1:0', '0번 포트'],
      ['mypc..local', '빈 라벨'],
      ['-mypc', '하이픈으로 시작하는 라벨'],
      ['mypc-', '하이픈으로 끝나는 라벨'],
      ['', '빈 문자열'],
      [':5173', '호스트 없이 포트만'],
    ];

    for (const [host, reason] of bypassAttempts) {
      it(`${reason}은 통하지 않는다(${JSON.stringify(host)})`, () => {
        // Given / When / Then
        assert.equal(isAllowedHost(host), false);
      });
    }

    it('대소문자만 바꾼 외부 도메인도 거부한다', () => {
      // Given / When / Then
      assert.equal(isAllowedHost('EVIL.COM'), false);
      assert.equal(isAllowedHost('EvIl.CoM:5173'), false);
    });

    it('허용 목록 항목의 접두/접미로 붙인 값은 거부한다', () => {
      // Given
      const allowedHosts = parseAllowedHosts('myhost.test');

      // When / Then
      assert.equal(isAllowedHost('myhost.test.evil.com', { allowedHosts }), false);
      assert.equal(isAllowedHost('evil.com.myhost.test', { allowedHosts }), false);
      assert.equal(isAllowedHost('xmyhost.test', { allowedHosts }), false);
      // 포트가 붙은 같은 이름은 허용한다(브라우저가 항상 포트를 붙이므로).
      assert.equal(isAllowedHost('myhost.test:5173', { allowedHosts }), true);
    });
  });

  describe('ALLOWED_HOSTS 환경변수', () => {
    it('정확히 일치하는 호스트만 추가로 허용한다', () => {
      // Given
      const allowedHosts = parseAllowedHosts('game.example.com:5173, myhost.test');

      // When / Then
      assert.equal(isAllowedHost('game.example.com:5173', { allowedHosts }), true);
      assert.equal(isAllowedHost('myhost.test', { allowedHosts }), true);
      assert.equal(isAllowedHost('other.example.com:5173', { allowedHosts }), false);
      // 접미사 위장은 통하지 않는다
      assert.equal(isAllowedHost('evil-myhost.test', { allowedHosts }), false);
    });

    it('포트 없이 적은 항목은 포트가 붙어 와도 허용한다', () => {
      // Given (브라우저는 항상 `:5173`을 붙여 보내므로 이게 막히면 서버가 전부 거부한다)
      const allowedHosts = parseAllowedHosts('game.example.com');

      // When / Then
      assert.equal(isAllowedHost('game.example.com', { allowedHosts }), true);
      assert.equal(isAllowedHost('game.example.com:5173', { allowedHosts }), true);
      assert.equal(isAllowedHost('game.example.com:41823', { allowedHosts }), true);
      // 다른 이름은 여전히 거부한다
      assert.equal(isAllowedHost('evil.com:5173', { allowedHosts }), false);
      assert.equal(isAllowedHost('game.example.com.evil.com:5173', { allowedHosts }), false);
      assert.equal(isAllowedHost('xgame.example.com', { allowedHosts }), false);
    });

    it('포트까지 적은 항목은 그 포트와 포트 없는 요청만 허용한다', () => {
      // Given
      const allowedHosts = parseAllowedHosts('game.example.com:5173');

      // When / Then
      assert.equal(isAllowedHost('game.example.com:5173', { allowedHosts }), true);
      assert.equal(isAllowedHost('game.example.com:9999', { allowedHosts }), false);
    });

    it('대소문자는 구분하지 않는다', () => {
      // Given
      const allowedHosts = parseAllowedHosts('Game.Example.COM');

      // When / Then
      assert.equal(isAllowedHost('game.example.com', { allowedHosts }), true);
    });

    it('빈 값이면 추가 허용이 없다', () => {
      // Given / When / Then
      assert.deepEqual(parseAllowedHosts(''), []);
      assert.deepEqual(parseAllowedHosts(undefined), []);
      assert.deepEqual(parseAllowedHosts('  ,  '), []);
    });
  });
});
