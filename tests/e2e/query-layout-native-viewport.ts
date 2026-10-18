/** 仅使用所属BrowserWindow官方接口建立CSS场景，不改DOM、model或产品设置。 */
export interface QueryLayoutNativeWindow {
  setMinimumSize(width: number, height: number): void;
  setContentSize(width: number, height: number): void;
  getContentSize(): number[];
  webContents: { setZoomFactor(value: number): void; getZoomFactor(): number };
}
/** macOS默认限制窗口大于屏幕：首次用真实夹取值固定缩放，随后大小场景共用该缩放。 */
export function resizeQueryLayoutNativeViewport(window: QueryLayoutNativeWindow, input: { width: number; height: number; scale?: number }) {
  if (![input.width, input.height].every(value => Number.isSafeInteger(value) && value > 0) || input.scale !== undefined && (!Number.isFinite(input.scale) || input.scale <= 0 || input.scale > 1)) throw Error('分栏场景尺寸或原缩放无效');
  let scale = input.scale;
  if (scale === undefined) {
    window.setMinimumSize(720, 320); window.setContentSize(input.width, input.height);
    const actual = window.getContentSize();
    if (actual.length !== 2 || actual.some(value => !Number.isFinite(value) || value <= 0)) throw Error('未取得实际窗口内容尺寸');
    scale = Math.min(1, actual[0] / input.width, actual[1] / input.height);
  }
  window.setMinimumSize(Math.ceil(720 * scale), Math.ceil(320 * scale));
  window.webContents.setZoomFactor(scale);
  window.setContentSize(Math.ceil(input.width * scale), Math.ceil(input.height * scale));
  const content = window.getContentSize(), zoom = window.webContents.getZoomFactor();
  // Chromium的factor↔level往返有浮点尾差；仅容忍数值舍入，原410/拖动/短屏断言不变。
  if (!Number.isFinite(zoom) || zoom <= 0 || Math.abs(zoom - scale) > 1e-10 || content.length !== 2 || content.some(value => !Number.isFinite(value) || value <= 0) || content[0] / zoom + 1e-7 < input.width || content[1] / zoom + 1e-7 < input.height) throw Error('实际窗口未建立要求的分栏CSS场景');
  return { requested: { width: input.width, height: input.height }, content: { width: content[0], height: content[1] }, scale, css: { width: content[0] / zoom, height: content[1] / zoom } };
}
