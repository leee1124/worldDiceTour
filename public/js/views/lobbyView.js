/**
 * 대기실: 방 코드 · LAN 접속 주소 · 좌석 목록(온라인/이 기기) · 핫시트 추가 · 호스트 도구.
 */

import { button, clear, el, setText } from '../dom.js';
import { isHostSeatMine, isMySeat } from '../store.js';
import { validateName } from './homeView.js';

const ROUND_LIMIT_OPTIONS = [
  { value: null, label: '무제한' },
  { value: 20, label: '20라운드' },
  { value: 30, label: '30라운드' },
];

export function createLobbyView({
  onAddLocalPlayer,
  onLeaveSeat,
  onKickSeat,
  onAddComputer,
  onSetRoundLimit,
  onStart,
  onExit,
}) {
  const codeNode = el('strong', { class: 'lobby-code', 'aria-label': '방 코드' });
  const urlListNode = el('ul', { class: 'lan-url-list' });
  const seatListNode = el('ul', { class: 'seat-list' });
  const seatCountNode = el('span', { class: 'seat-count' });
  const hostToolsNode = el('div', { class: 'host-tools' });
  const startHintNode = el('p', { class: 'card-note', text: '' });

  const localNameInput = el('input', {
    class: 'text-input',
    id: 'local-seat-name',
    type: 'text',
    maxlength: 10,
    autocomplete: 'off',
    placeholder: '예: 세찌',
    'aria-label': '이 기기에 추가할 플레이어 이름',
  });
  const localHint = el('p', { class: 'input-hint', text: '한 기기에서 여러 명이 번갈아 플레이할 수 있습니다.' });
  const addLocalButton = button({ class: 'btn btn--ghost' }, '추가');

  function submitLocalPlayer() {
    const result = validateName(localNameInput.value);
    setText(localHint, result.ok ? '한 기기에서 여러 명이 번갈아 플레이할 수 있습니다.' : result.reason);
    if (!result.ok) {
      localNameInput.focus();
      return;
    }
    onAddLocalPlayer(localNameInput.value);
    localNameInput.value = '';
  }

  addLocalButton.addEventListener('click', submitLocalPlayer);
  localNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submitLocalPlayer();
    }
  });

  const element = el('div', { class: 'screen screen--lobby' }, [
    el('header', { class: 'lobby-head' }, [
      el('div', { class: 'lobby-code-block' }, [
        el('span', { class: 'lobby-code-label', text: '방 코드' }),
        codeNode,
      ]),
      el('div', { class: 'lobby-invite' }, [
        el('h2', { class: 'card-title' }, ['다른 기기에서 이 주소로 접속']),
        urlListNode,
        el('p', { class: 'card-note', text: '같은 와이파이에 연결한 뒤 브라우저 주소창에 그대로 입력하세요.' }),
      ]),
      button({ class: 'btn btn--quiet lobby-exit', on: { click: () => onExit() } }, '방에서 나가기'),
    ]),
    el('div', { class: 'lobby-grid' }, [
      el('section', { class: 'card card--seats' }, [
        el('div', { class: 'card-head' }, [
          el('h2', { class: 'card-title' }, ['좌석']),
          seatCountNode,
        ]),
        seatListNode,
        el('div', { class: 'seat-add' }, [
          el('label', { class: 'field-title', for: 'local-seat-name', text: '이 기기에서 플레이어 추가' }),
          el('div', { class: 'seat-add-row' }, [localNameInput, addLocalButton]),
          localHint,
        ]),
      ]),
      el('section', { class: 'card card--host' }, [
        el('h2', { class: 'card-title' }, ['호스트 도구']),
        hostToolsNode,
        startHintNode,
      ]),
    ]),
  ]);

  function renderUrls(state) {
    const urls = state.serverInfo?.urls ?? [];
    clear(urlListNode);
    if (urls.length === 0) {
      urlListNode.appendChild(
        el('li', { class: 'lan-url lan-url--empty', text: state.serverInfo?.localUrl ?? '주소를 확인할 수 없습니다.' }),
      );
      return;
    }
    for (const url of urls) {
      urlListNode.appendChild(el('li', { class: 'lan-url' }, [el('code', { text: url })]));
    }
  }

  function seatBadges(state, seat) {
    const badges = [];
    if (seat.isHost) {
      badges.push({ text: '호스트', tone: 'gold' });
    }
    if (seat.kind === 'COMPUTER') {
      badges.push({ text: '컴퓨터', tone: 'muted' });
    }
    if (isMySeat(state, seat.id)) {
      badges.push({ text: '이 기기', tone: 'mine' });
    }
    if (seat.autopilot) {
      badges.push({ text: '자동 진행', tone: 'warn' });
    }
    return badges.map((badge) => el('span', { class: ['badge', `badge--${badge.tone}`], text: badge.text }));
  }

  function renderSeats(state) {
    const room = state.room;
    clear(seatListNode);
    if (!room) {
      return;
    }
    setText(seatCountNode, `${room.seats.length} / ${room.maxSeats}`);
    const amHost = isHostSeatMine(state);

    for (const seat of room.seats) {
      const mine = isMySeat(state, seat.id);
      const actions = [];
      if (mine) {
        actions.push(
          button(
            { class: 'btn btn--quiet', on: { click: () => onLeaveSeat(seat.id) } },
            '좌석 비우기',
          ),
        );
      } else if (amHost) {
        actions.push(
          button(
            { class: 'btn btn--quiet', on: { click: () => onKickSeat(seat.id) } },
            '강퇴',
          ),
        );
      }

      seatListNode.appendChild(
        el('li', { class: ['seat-row', mine ? 'seat-row--mine' : null] }, [
          el('span', {
            class: ['online-dot', seat.online ? 'online-dot--on' : 'online-dot--off'],
            role: 'img',
            'aria-label': seat.online ? '접속 중' : '오프라인',
          }),
          el('div', { class: 'seat-main' }, [
            el('span', { class: 'seat-name', text: seat.name }),
            el('div', { class: 'badge-row' }, seatBadges(state, seat)),
          ]),
          el('div', { class: 'row-actions' }, actions),
        ]),
      );
    }
  }

  function renderHostTools(state) {
    const room = state.room;
    clear(hostToolsNode);
    if (!room) {
      return;
    }
    if (!isHostSeatMine(state)) {
      hostToolsNode.appendChild(
        el('p', { class: 'empty-note', text: '호스트가 게임을 시작하면 자동으로 보드가 열립니다.' }),
      );
      setText(startHintNode, '');
      return;
    }

    const seatsLeft = room.maxSeats - room.seats.length;
    const computerName = `컴퓨터${room.seats.filter((seat) => seat.kind === 'COMPUTER').length + 1}`;

    hostToolsNode.appendChild(
      el('div', { class: 'tool-row' }, [
        el('div', { class: 'tool-label' }, [
          el('span', { class: 'tool-title', text: '컴퓨터 좌석' }),
          el('span', { class: 'tool-note', text: '규칙 기반으로 서버가 대신 플레이합니다.' }),
        ]),
        button(
          {
            class: 'btn btn--ghost',
            disabled: seatsLeft <= 0,
            on: { click: () => onAddComputer(computerName) },
          },
          seatsLeft <= 0 ? '좌석 만석' : '컴퓨터 추가',
        ),
      ]),
    );

    const roundButtons = ROUND_LIMIT_OPTIONS.map((option) =>
      button(
        {
          class: ['btn', 'btn--chip', room.options.roundLimit === option.value ? 'btn--chip-on' : null],
          'aria-pressed': String(room.options.roundLimit === option.value),
          on: { click: () => onSetRoundLimit(option.value) },
        },
        option.label,
      ),
    );
    hostToolsNode.appendChild(
      el('div', { class: 'tool-row' }, [
        el('div', { class: 'tool-label' }, [
          el('span', { class: 'tool-title', text: '라운드 제한' }),
          el('span', { class: 'tool-note', text: '제한에 닿으면 총자산 1위가 우승합니다.' }),
        ]),
        el('div', { class: 'chip-row' }, roundButtons),
      ]),
    );

    // 다음 브랜치에서 붙일 증권 기능 자리. 지금은 눌리지 않는 예약 행으로 보여 준다.
    hostToolsNode.appendChild(
      el('div', { class: 'tool-row tool-row--reserved' }, [
        el('div', { class: 'tool-label' }, [
          el('span', { class: 'tool-title', text: '투자 모드' }),
          el('span', { class: 'tool-note', text: '도시 지분을 사고파는 증권 규칙 — 다음 업데이트' }),
        ]),
        button({ class: 'btn btn--chip', disabled: true, 'aria-disabled': 'true' }, '준비 중'),
      ]),
    );

    const canStart = room.seats.length >= 2;
    hostToolsNode.appendChild(
      button(
        {
          class: 'btn btn--primary btn--block btn--start',
          disabled: !canStart || state.busy,
          on: { click: () => onStart() },
        },
        '게임 시작',
      ),
    );
    setText(startHintNode, canStart ? '' : '좌석이 2명 이상이어야 시작할 수 있습니다.');
  }

  return {
    element,
    update(state) {
      setText(codeNode, state.room?.code ?? '----');
      renderUrls(state);
      renderSeats(state);
      renderHostTools(state);
      const seatsFull = (state.room?.seats.length ?? 0) >= (state.room?.maxSeats ?? 4);
      addLocalButton.disabled = Boolean(state.busy) || seatsFull;
      localNameInput.disabled = seatsFull;
      if (seatsFull) {
        setText(localHint, '좌석이 모두 찼습니다.');
      }
    },
  };
}
