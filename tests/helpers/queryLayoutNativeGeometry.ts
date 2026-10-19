/** 仅通过真实DOM公开getter取几何数字与类名；不能读取SQL、表单值或认证正文。 */
export function readQueryLayoutNativeGeometry() {
  const tab = document.querySelector<HTMLElement>('.tab-pane:not([hidden]) .query-tab');
  const editor = tab?.querySelector<HTMLElement>('.sql-editor-wrap'), separator = tab?.querySelector('[role="separator"]');
  /** 原生矩形只保留布局数值，不把元素正文加入诊断附件。 */
  const rect = (element: Element | null | undefined) => {
    if (!element) return null;
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  };
  /** 缺少或坏的ARIA值保留为未知，不能把空属性强转成0。 */
  const number = (name: string) => {
    const value = separator?.getAttribute(name);
    return value !== null && value !== undefined && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  };
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    tab: rect(tab), editor: rect(editor), separator: { minimum: number('aria-valuemin'), maximum: number('aria-valuemax'), value: number('aria-valuenow') },
    children: Array.from(tab?.children ?? []).map(child => ({ classes: Array.from(child.classList).join(' '), rect: rect(child) })),
  };
}
