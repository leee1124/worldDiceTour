/**
 * 테마 토글 버튼(자동/라이트/다크를 한 번 탭으로 순환). 홈 헤더와 게임 상단바가
 * 같은 조각을 쓴다 — 아이콘만 다른 작은 버튼 하나면 된다(문구가 아니라 아이콘 + 배지).
 */

import { button, el, setText } from '../dom.js';
import { cycleTheme, onThemeChange, themeChoice } from '../theme.js';
import { themeChoiceIcon } from './icons.js';

const CHOICE_LABELS = Object.freeze({
  auto: '자동',
  light: '라이트',
  dark: '다크',
});

/** @returns {{ element: HTMLButtonElement, destroy: () => void }} */
export function createThemeToggleButton({ extraClass } = {}) {
  const iconSlot = el('span', { class: 'theme-toggle-icon', 'aria-hidden': 'true' }, [
    themeChoiceIcon(themeChoice()),
  ]);
  const labelNode = el('span', { class: 'visually-hidden' });

  const element = button(
    {
      class: ['btn', 'btn--quiet', 'btn--small', 'theme-toggle', extraClass],
      'aria-label': '테마: 자동/라이트/다크',
      on: {
        click: () => {
          cycleTheme();
        },
      },
    },
    [iconSlot, labelNode],
  );

  function render(choice) {
    const next = choice ?? themeChoice();
    iconSlot.replaceChildren(themeChoiceIcon(next));
    setText(labelNode, `현재 테마: ${CHOICE_LABELS[next] ?? '자동'}`);
    element.title = `테마: ${CHOICE_LABELS[next] ?? '자동'} (탭하면 바뀝니다)`;
  }

  render(themeChoice());
  const unsubscribe = onThemeChange(({ choice }) => render(choice));

  return { element, destroy: unsubscribe };
}
