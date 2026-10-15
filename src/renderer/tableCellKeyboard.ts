const gridNavigationKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End', 'PageUp', 'PageDown']);

/** 二进制仍可粘贴与导航；仅阻止网格自行把键盘输入交给普通文本编辑器。 */
export function blocksBinaryTextInput(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  return !event.ctrlKey && !event.metaKey && !gridNavigationKeys.has(event.key) && !(event.shiftKey && event.key === ' ');
}
