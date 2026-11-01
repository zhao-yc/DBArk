/** 菜单聚焦不滚动背景；键盘仅调整本层菜单视口，避免祖先滚动事件撤销原菜单。 */
export function focusActionMenuControl(control: HTMLElement | null | undefined, viewport?: HTMLElement | null): void {
  if (!control) return;
  control.focus({ preventScroll: true });
  const height = viewport?.clientHeight;
  if (!viewport || !height) return;
  const item = control.getBoundingClientRect(), frame = viewport.getBoundingClientRect(), top = frame.top + viewport.clientTop;
  if (item.top < top || item.height > height) viewport.scrollTop += item.top - top;
  else if (item.bottom > top + height) viewport.scrollTop += item.bottom - top - height;
}
