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
