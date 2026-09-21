/**
 * 보드 중앙 코어: 라운드 · 잭팟 · 현재 차례와 페이즈 안내 · 주사위 · 주 행동 버튼 ·
 * 다음 업데이트용 예약 패널(증권거래소).
 *
 * 넓은 화면에서는 보드 안쪽(9×9)에 겹쳐 놓이고, 세로 화면에서는 보드 아래로 내려간다(CSS).
 */

import { button, clear, el, setText, toggleClass } from '../dom.js';
import { formatWon } from '../format.js';
import { phasePrompt } from '../domain/labels.js';
import { currentLocationLabel } from '../domain/locationLabel.js';
import { countTo, DURATIONS } from '../animation/timing.js';
import { centerOf } from '../animation/effects.js';
import { isMySeatOnAutopilot, isMyTurn, seatNameOf, slotOf, spaceOf } from '../store.js';
import { createDicePair } from './diceView.js';

/** 페이즈별 "결정 창 열기" 버튼 문구. */
const DECISION_LABELS = Object.freeze({
  AWAIT_BUY: '매입 결정하기',
  AWAIT_BUILD: '건설 결정하기',
  AWAIT_START_BUILD: '출발 보너스 쓰기',
  AWAIT_ACQUIRE: '인수 결정하기',
  AWAIT_CASINO: '카지노 열기',
  AWAIT_ISLAND_CHOICE: '탈출 방법 고르기',
  AWAIT_LIQUIDATION: '지불 정리하기',
});

export function createCenterView({ onRoll, onOpenDecision, onShowRankings, onLeaveGame, onResumeControl }) {
  const roundNode = el('span', { class: 'core-stat-value' });
  const jackpotNode = el('span', { class: 'core-stat-value core-stat-value--gold' });
  const jackpotBox = el('div', { class: 'core-stat core-stat--jackpot' }, [
    el('span', { class: 'core-stat-label', text: '🎰 잭팟' }),
    jackpotNode,
  ]);

  const turnChip = el('span', { class: 'turn-chip' });
  const turnNameNode = el('span', { class: 'turn-name' });
  const turnTagNode = el('span', { class: 'turn-tag' });
  const promptTitle = el('p', { class: 'prompt-title' });
  const promptHint = el('p', { class: 'prompt-hint' });

  // "내 말이 어디 있는지 모르겠다" — 그림만으로는 부족해서 칸 이름을 글자로도 말해 준다.
  const locationNode = el('p', { class: 'core-location', text: currentLocationLabel(null) });

  const dice = createDicePair();

  const actionsNode = el('div', { class: 'core-actions' });

  const element = el('div', { class: 'board-core' }, [
    el('div', { class: 'core-stats' }, [
      el('div', { class: 'core-stat' }, [el('span', { class: 'core-stat-label', text: '라운드' }), roundNode]),
      jackpotBox,
    ]),
    el('div', { class: 'core-turn', role: 'status', 'aria-live': 'polite' }, [
      el('div', { class: 'turn-line' }, [turnChip, turnNameNode, turnTagNode]),
      locationNode,
      promptTitle,
      promptHint,
    ]),
    dice.element,
    actionsNode,
    el('details', { class: 'reserved-panel' }, [
      el('summary', { class: 'reserved-summary' }, [
        el('span', { text: '📈 증권거래소' }),
        el('span', { class: 'reserved-tag', text: '준비 중' }),
      ]),
      el('div', { class: 'reserved-body' }, [
        el('p', {
          text: '도시 지분을 사고파는 투자 모드가 다음 업데이트에서 이 자리에 들어옵니다.',
        }),
        el('div', { class: 'reserved-skeleton', 'aria-hidden': 'true' }, [
          el('span', { class: 'skeleton-bar' }),
          el('span', { class: 'skeleton-bar' }),
          el('span', { class: 'skeleton-bar' }),
        ]),
      ]),
    ]),
  ]);

  let lastJackpot = null;
  let rollButton = null;
  /** 같은 눈을 함께 보여 줄 다른 주사위 묶음(모바일 상황판). */
  const diceMirrors = [];

  function renderActions(state) {
    clear(actionsNode);
    rollButton = null;
    const view = state.view;
    if (!view) {
      return;
    }

    if (view.isOver) {
      actionsNode.appendChild(
        button({ class: 'btn btn--primary btn--block', on: { click: () => onShowRankings() } }, '🏆 최종 순위 보기'),
      );
      actionsNode.appendChild(
        button({ class: 'btn btn--quiet btn--block', on: { click: () => onLeaveGame() } }, '나가기'),
      );
      return;
    }

    const myTurn = isMyTurn(state);
    if (!myTurn) {
      // 내 좌석이지만 자동 진행에 맡겨진 차례 → 서버가 커맨드를 거절하므로 복귀 버튼만 준다.
      if (isMySeatOnAutopilot(state)) {
        actionsNode.appendChild(
          el('p', { class: 'spectate-note', text: '이 좌석은 자동 진행 중입니다. 직접 플레이로 돌아올 수 있습니다.' }),
        );
        actionsNode.appendChild(
          button(
            { class: 'btn btn--primary btn--block', on: { click: () => onResumeControl(view.currentSeatId) } },
            '▶ 직접 플레이로 복귀',
          ),
        );
      } else {
        const seat = state.room?.seats.find((item) => item.id === view.currentSeatId);
        const waiting =
          seat?.kind === 'COMPUTER' || seat?.autopilot ? '자동으로 진행됩니다.' : '차례가 끝나면 알려 드립니다.';
        actionsNode.appendChild(el('p', { class: 'spectate-note', text: `관전 중 — ${waiting}` }));
      }
      actionsNode.appendChild(
        button({ class: 'btn btn--quiet btn--block', on: { click: () => onLeaveGame() } }, '나가기'),
      );
      return;
    }

    if (view.phase === 'AWAIT_ROLL') {
      const locked = Boolean(state.locked);
      rollButton = button(
        {
          class: 'btn btn--primary btn--block btn--roll',
          disabled: locked,
          'aria-busy': locked ? 'true' : undefined,
          on: { click: () => onRoll() },
        },
        ['🎲 주사위 굴리기', el('kbd', { class: 'btn-kbd', text: 'Space' })],
      );
      actionsNode.appendChild(rollButton);
    } else if (view.phase === 'AWAIT_TRAVEL') {
      actionsNode.appendChild(
        el('p', { class: 'spectate-note', text: '보드에서 갈 칸을 눌러 목적지를 고르세요.' }),
      );
    } else if (DECISION_LABELS[view.phase]) {
      actionsNode.appendChild(
        button(
          { class: 'btn btn--primary btn--block', on: { click: () => onOpenDecision() } },
          DECISION_LABELS[view.phase],
        ),
      );
    }
    actionsNode.appendChild(
      button({ class: 'btn btn--quiet btn--block', on: { click: () => onLeaveGame() } }, '나가기'),
    );
  }

  return {
    element,

    update(state) {
      const view = state.view;
      if (!view) {
        return;
      }
      setText(roundNode, view.roundLimit ? `${view.round} / ${view.roundLimit}` : String(view.round));

      if (lastJackpot === null) {
        lastJackpot = view.jackpot;
        setText(jackpotNode, formatWon(view.jackpot));
      }

      const currentName = seatNameOf(state, view.currentSeatId);
      const slot = slotOf(state, view.currentSeatId);
      turnChip.dataset.slot = slot.color;
      turnChip.dataset.shape = slot.shape;
      setText(turnNameNode, view.isOver ? '게임 종료' : currentName);
      const myTurn = isMyTurn(state);
      setText(turnTagNode, view.isOver ? '' : myTurn ? '이 기기' : '차례');
      toggleClass(turnTagNode, 'turn-tag--mine', myTurn);
      toggleClass(element, 'board-core--my-turn', myTurn);

      // 이 줄은 aria-live 영역 안이다 — 값이 그대로면 다시 쓰지 않는다(같은 문장을 반복해 읽지 않게).
      const currentPlayer = view.players.find((player) => player.seatId === view.currentSeatId) ?? null;
      const locationText = currentLocationLabel(
        currentPlayer ? spaceOf(state, currentPlayer.position)?.name ?? null : null,
      );
      if (locationNode.textContent !== locationText) {
        setText(locationNode, locationText);
      }

      const prompt = phasePrompt(view.isOver ? 'GAME_OVER' : view.phase);
      setText(promptTitle, myTurn || view.isOver ? prompt.title : `${currentName}의 차례입니다`);
      setText(promptHint, prompt.hint);

      renderActions(state);
    },

    /** 같은 눈을 함께 보여 줄 주사위 묶음을 등록한다(모바일 상황판). */
    attachDiceMirror(pair) {
      diceMirrors.push(pair);
    },

    /** 다른 방으로 옮길 때: 이전 방의 눈이 남아 있으면 안 된다. */
    resetDice() {
      dice.reset();
      for (const mirror of diceMirrors) {
        mirror.reset();
      }
    },

    /** 서버가 정한 눈으로 주사위 연출을 재생한다(난수는 클라이언트가 만들지 않는다). */
    async rollDice(value1, value2, options = {}) {
      for (const mirror of diceMirrors) {
        mirror.setRolling(true);
      }
      await dice.roll(value1, value2, options);
      for (const mirror of diceMirrors) {
        mirror.show(value1, value2, options);
      }
    },

    /**
     * 연출 없이 눈만 맞춘다.
     * 큐가 밀려 빨리 감기로 넘어갈 때도 **모든 기기가 같은 눈을 본다**(DICE_ROLLED가 유일한 출처).
     */
    showDice(value1, value2, options = {}) {
      dice.show(value1, value2, options);
      for (const mirror of diceMirrors) {
        mirror.show(value1, value2, options);
      }
    },

    /** 잭팟 금액이 바뀌면 숫자를 굴려 보여 준다. */
    animateJackpot(value) {
      const from = lastJackpot ?? value;
      lastJackpot = value;
      if (from !== value) {
        jackpotBox.classList.add('core-stat--bump');
        window.setTimeout(() => jackpotBox.classList.remove('core-stat--bump'), DURATIONS.jackpot);
      }
      countTo({
        from,
        to: value,
        duration: DURATIONS.jackpot,
        onStep: (current) => setText(jackpotNode, formatWon(current)),
      });
    },

    /** 잭팟 표시의 화면 좌표(세금이 잭팟으로 날아가는 연출의 도착점). */
    jackpotCenter() {
      return centerOf(jackpotBox);
    },

    /** 주사위 버튼(키보드 단축키가 있을 때만 존재). */
    get rollButton() {
      return rollButton;
    },
  };
}
