import { expect, it } from 'vitest';
import { focusActionMenuControl } from '../../src/renderer/actionMenuFocus';

it.each([
  { top: 110, bottom: 130, scroll: 200 },
  { top: 70, bottom: 90, scroll: 168 },
  { top: 160, bottom: 185, scroll: 223 },
  { top: 110, bottom: 300, scroll: 208 },
])('本层视口显示目标 $top 到 $bottom，背景保持原滚动位置', ({ top, bottom, scroll }) => {
  let background = 500, focused = false;
  const control = {
    focus(options?: FocusOptions) { focused = true; if (!options?.preventScroll) background = 0; },
    getBoundingClientRect: () => ({ top, bottom, height: bottom - top }),
  } as unknown as HTMLElement;
  const viewport = { clientHeight: 60, clientTop: 2, scrollTop: 200, getBoundingClientRect: () => ({ top: 100 }) } as unknown as HTMLElement;
  focusActionMenuControl(control, viewport);
  expect(focused).toBe(true); expect(background).toBe(500); expect(viewport.scrollTop).toBe(scroll);
});

it('恢复锚点只聚焦，不滚动其它区域；不存在的目标不做操作', () => {
  let background = 500, focused = 0;
  const anchor = { focus(options?: FocusOptions) { focused++; if (!options?.preventScroll) background = 0; } } as unknown as HTMLElement;
  focusActionMenuControl(anchor); focusActionMenuControl(undefined); focusActionMenuControl(null);
  expect(focused).toBe(1); expect(background).toBe(500);
});
