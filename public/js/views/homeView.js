/**
 * 시작 화면: 방 만들기 / 방 목록에서 참가 / 코드로 참가 / 이 기기에 저장된 방 재접속.
 *
 * 입력 검증은 서버 정규식을 거울처럼 따라가지만, **판정의 권위는 항상 서버**다.
 */

import { button, clear, el, replaceChildren, setText } from '../dom.js';

/** 서버 `NAME_PATTERN`과 같은 규칙(src/server/validation.js). */
const NAME_PATTERN = /^[가-힣a-zA-Z0-9 ]{1,10}$/;
/** 서버 방 코드 규칙(헷갈리는 I·O·0·1 제외). */
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}$/;

export function validateName(value) {
  const name = String(value ?? '');
  if (name.trim().length === 0) {
    return { ok: false, reason: '이름을 입력해 주세요.' };
  }
  if (!NAME_PATTERN.test(name)) {
    return { ok: false, reason: '이름은 한글·영문·숫자·공백 1~10자입니다.' };
  }
  return { ok: true, reason: '' };
}

export function validateCode(value) {
  const code = String(value ?? '').toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    return { ok: false, reason: '방 코드는 4자리입니다 (I·O·0·1 제외).' };
  }
  return { ok: true, reason: '' };
}

function labeledInput({ id, label, placeholder, maxLength, hint, uppercase = false }) {
  const input = el('input', {
    class: ['text-input', uppercase ? 'text-input--code' : null],
    id,
    type: 'text',
    autocomplete: 'off',
    placeholder,
    maxlength: maxLength,
    'aria-describedby': `${id}-hint`,
  });
  if (uppercase) {
    input.addEventListener('input', () => {
      const caret = input.selectionStart;
      input.value = input.value.toUpperCase();
      input.setSelectionRange(caret, caret);
    });
  }
  const hintNode = el('p', { class: 'input-hint', id: `${id}-hint`, text: hint ?? '' });
  const wrapper = el('div', { class: 'field' }, [
    el('label', { class: 'field-title', for: id, text: label }),
    input,
    hintNode,
  ]);
  return { wrapper, input, hintNode };
}

export function createHomeView({ onCreateRoom, onJoinRoom, onReconnect, onForget }) {
  const create = labeledInput({
    id: 'host-name',
    label: '내 이름',
    placeholder: '예: 하나',
    maxLength: 10,
    hint: '한글·영문·숫자·공백 1~10자',
  });
  const joinCode = labeledInput({
    id: 'join-code',
    label: '방 코드',
    placeholder: 'ABCD',
    maxLength: 4,
    hint: '호스트 화면에 크게 표시됩니다',
    uppercase: true,
  });
  const joinName = labeledInput({
    id: 'join-name',
    label: '내 이름',
    placeholder: '예: 두리',
    maxLength: 10,
    hint: '한글·영문·숫자·공백 1~10자',
  });

  const createButton = button({ class: 'btn btn--primary btn--block' }, '방 만들기');
  const joinButton = button({ class: 'btn btn--primary btn--block' }, '참가하기');

  const roomListNode = el('div', { class: 'room-list' });
  const savedListNode = el('div', { class: 'saved-list' });
  const savedCard = el('section', { class: 'card card--saved' }, [
    el('h2', { class: 'card-title' }, ['📱 이 기기에 저장된 방']),
    el('p', { class: 'card-note', text: '좌석 토큰이 이 브라우저에 남아 있어 자리를 그대로 되찾습니다.' }),
    savedListNode,
  ]);

  function submitCreate() {
    const result = validateName(create.input.value);
    setText(create.hintNode, result.ok ? '한글·영문·숫자·공백 1~10자' : result.reason);
    create.wrapper.classList.toggle('field--invalid', !result.ok);
    if (!result.ok) {
      create.input.focus();
      return;
    }
    onCreateRoom(create.input.value);
  }

  function submitJoin() {
    const codeResult = validateCode(joinCode.input.value);
    const nameResult = validateName(joinName.input.value);
    setText(joinCode.hintNode, codeResult.ok ? '호스트 화면에 크게 표시됩니다' : codeResult.reason);
    setText(joinName.hintNode, nameResult.ok ? '한글·영문·숫자·공백 1~10자' : nameResult.reason);
    joinCode.wrapper.classList.toggle('field--invalid', !codeResult.ok);
    joinName.wrapper.classList.toggle('field--invalid', !nameResult.ok);
    if (!codeResult.ok) {
      joinCode.input.focus();
      return;
    }
    if (!nameResult.ok) {
      joinName.input.focus();
      return;
    }
    onJoinRoom(joinCode.input.value.toUpperCase(), joinName.input.value);
  }

  createButton.addEventListener('click', submitCreate);
  joinButton.addEventListener('click', submitJoin);
  create.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submitCreate();
    }
  });
  for (const input of [joinCode.input, joinName.input]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        submitJoin();
      }
    });
  }

  const element = el('div', { class: 'screen screen--home' }, [
    el('header', { class: 'home-hero' }, [
      el('p', { class: 'hero-eyebrow', text: 'WORLD DICE TOUR' }),
      el('h1', { class: 'hero-title' }, ['월드 다이스 투어']),
      el('p', { class: 'hero-lead' }, [
        '같은 와이파이의 폰·태블릿·PC가 한 보드에 모여 세계를 한 바퀴 돕니다. 주사위와 카드 운, 그리고 ',
        el('strong', { text: '살까 · 지을까 · 걸까' }),
        ' 세 가지 선택만 있습니다.',
      ]),
      el('div', { class: 'hero-dice', 'aria-hidden': 'true' }, [
        el('span', { class: 'hero-die hero-die--a', text: '🎲' }),
        el('span', { class: 'hero-die hero-die--b', text: '🎲' }),
      ]),
    ]),
    el('div', { class: 'home-grid' }, [
      el('section', { class: 'card card--create' }, [
        el('h2', { class: 'card-title' }, ['🚩 방 만들기']),
        el('p', { class: 'card-note', text: '방을 만든 좌석이 호스트가 됩니다.' }),
        create.wrapper,
        createButton,
      ]),
      el('section', { class: 'card card--join' }, [
        el('h2', { class: 'card-title' }, ['🎫 코드로 참가']),
        el('p', { class: 'card-note', text: '호스트에게 받은 4자리 코드를 입력하세요.' }),
        joinCode.wrapper,
        joinName.wrapper,
        joinButton,
      ]),
      el('section', { class: 'card card--rooms' }, [
        el('h2', { class: 'card-title' }, ['🌐 같은 네트워크의 방']),
        el('p', { class: 'card-note', text: '대기실이고 자리가 남은 방만 보입니다. 3초마다 새로 고쳐집니다.' }),
        roomListNode,
      ]),
      savedCard,
    ]),
  ]);

  function renderRoomList(state) {
    if (state.roomListError) {
      replaceChildren(roomListNode, el('p', { class: 'empty-note', text: state.roomListError }));
      return;
    }
    if (state.roomList.length === 0) {
      replaceChildren(
        roomListNode,
        el('p', { class: 'empty-note', text: '아직 참가할 수 있는 방이 없습니다. 방을 만들어 보세요.' }),
      );
      return;
    }
    clear(roomListNode);
    for (const room of state.roomList) {
      const full = room.seatCount >= room.maxSeats;
      roomListNode.appendChild(
        el('div', { class: 'room-row' }, [
          el('span', { class: 'room-code', text: room.code }),
          el('div', { class: 'room-meta' }, [
            el('span', { class: 'room-host', text: `${room.hostName ?? '?'} 님의 방` }),
            el('span', {
              class: 'room-seats',
              text: `좌석 ${room.seatCount}/${room.maxSeats} · ${
                room.options?.roundLimit ? `${room.options.roundLimit}라운드` : '무제한'
              }`,
            }),
          ]),
          button(
            {
              class: 'btn btn--ghost',
              disabled: full,
              on: {
                click: () => {
                  joinCode.input.value = room.code;
                  joinName.input.focus();
                  joinName.input.scrollIntoView({ block: 'center', behavior: 'smooth' });
                },
              },
            },
            full ? '만석' : '참가',
          ),
        ]),
      );
    }
  }

  function renderSavedRooms(state) {
    const rooms = state.savedRooms ?? [];
    savedCard.hidden = rooms.length === 0;
    clear(savedListNode);
    for (const saved of rooms) {
      savedListNode.appendChild(
        el('div', { class: 'room-row' }, [
          el('span', { class: 'room-code', text: saved.code }),
          el('div', { class: 'room-meta' }, [
            el('span', {
              class: 'room-host',
              text: saved.seats.map((seat) => seat.name).filter(Boolean).join(', ') || '내 좌석',
            }),
            el('span', { class: 'room-seats', text: `내 좌석 ${saved.seats.length}개` }),
          ]),
          el('div', { class: 'row-actions' }, [
            button({ class: 'btn btn--primary', on: { click: () => onReconnect(saved.code) } }, '재접속'),
            button(
              { class: 'btn btn--quiet', 'aria-label': `${saved.code} 방 기록 삭제`, on: { click: () => onForget(saved.code) } },
              '삭제',
            ),
          ]),
        ]),
      );
    }
  }

  return {
    element,
    update(state) {
      renderRoomList(state);
      renderSavedRooms(state);
      createButton.disabled = state.busy;
      joinButton.disabled = state.busy;
    },
  };
}
