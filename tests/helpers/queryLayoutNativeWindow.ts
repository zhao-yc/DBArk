/** 从原application的Main公开API读取同一窗口；不创建窗口或改变显示环境。 */
export function readQueryLayoutNativeWindow(api: Pick<typeof import('electron'), 'BrowserWindow' | 'screen'>, expected: { id: number; contents: number }) {
  const window = api.BrowserWindow.fromId(expected.id);
  if (!Number.isSafeInteger(expected.id) || expected.id <= 0 || !Number.isSafeInteger(expected.contents) || expected.contents <= 0 || !window || window.isDestroyed()) throw Error('分栏尺寸观察的原窗口身份已失效');
  const id = window.id, contents = window.webContents.id;
  if (id !== expected.id || contents !== expected.contents) throw Error('分栏尺寸观察的原窗口身份已失效');
  // 身份和实际尺寸是必需证据，读取失败不能降级为诊断未知。
  const actual = window.getContentSize();
  /** 补充诊断失败仅保留未知，不覆盖尺寸/布局失败，也不在catch后补读其他getter。 */
  const diagnostics = (() => {
    try {
      const bounds = window.getBounds(), contentBounds = window.getContentBounds(), minimumSize = window.getMinimumSize();
      const display = api.screen.getDisplayMatching(bounds);
      return { bounds, contentBounds, minimumSize, zoomFactor: window.webContents.getZoomFactor(), display: { id: display.id, bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor } };
    } catch { return null; }
  })();
  return { id, contents, actual, diagnostics };
}
