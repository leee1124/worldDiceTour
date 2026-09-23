/**
 * 테마 토글 버튼(자동/라이트/다크를 한 번 탭으로 순환). 홈 헤더와 게임 상단바가
 * 같은 조각을 쓴다 — 아이콘만 다른 작은 버튼 하나면 된다(문구가 아니라 아이콘 + 배지).
 */

import { button, el } from '../dom.js';
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

  const element = button(
    {
      class: ['btn', 'btn--quiet', 'theme-toggle', extraClass],
      on: {
        click: () => {
          cycleTheme();
        },
      },
    },
    [iconSlot],
  );

  // aria-label은 정적 문구를 두면 접근성 이름 계산에서 늘 이 값이 이긴다(내부 텍스트는 무시됨).
  // 그래서 현재 상태를 매번 aria-label 자체에 담아 갱신한다("한 번 탭하면 바뀐다"는 것도 함께 안내).
  function render(choice) {
    const next = choice ?? themeChoice();
    iconSlot.replaceChildren(themeChoiceIcon(next));
    element.setAttribute('aria-label', `테마: 자동/라이트/다크 (현재 ${CHOICE_LABELS[next] ?? '자동'}, 탭하면 다음으로)`);
    element.title = `테마: ${CHOICE_LABELS[next] ?? '자동'} (탭하면 바뀝니다)`;
  }

  render(themeChoice());
  const unsubscribe = onThemeChange(({ choice }) => render(choice));

  return { element, destroy: unsubscribe };
}
