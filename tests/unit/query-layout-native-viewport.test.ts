import { describe, expect, it } from 'vitest';
import { resizeQueryLayoutNativeViewport, type QueryLayoutNativeWindow } from '../e2e/query-layout-native-viewport';

/** AppKit夹取仅为官方窗口接口端口；不伪造DOM、模型、持久设置或原几何oracle。 */
function windowPort(maximum: [number, number], ignoreZoom = false, roundtrip = false) {
  let content: number[] = [1024, 680], zoom = 1;
  const calls: string[] = [];
  const window: QueryLayoutNativeWindow = {
    setMinimumSize: (width, height) => { calls.push('minimum:' + width + ',' + height); },
    setContentSize: (width, height) => { content = [Math.min(maximum[0], width), Math.min(maximum[1], height)]; calls.push('content:' + width + ',' + height); },
    getContentSize: () => [...content],
    webContents: { setZoomFactor: value => { if (!ignoreZoom) zoom = value; calls.push('zoom:' + value); }, getZoomFactor: () => roundtrip ? zoom * (1 + Number.EPSILON) : zoom },
  };
  return { window, calls };
}
describe('分栏原生场景通过真实窗口夹取值建立CSS尺寸', () => {
  it('正常大屏保持原100%缩放和请求尺寸', () => {
    const f = windowPort([1800, 1200]), scene = resizeQueryLayoutNativeViewport(f.window, { width: 1400, height: 1000 });
    expect(scene).toEqual({ requested: { width: 1400, height: 1000 }, content: { width: 1400, height: 1000 }, scale: 1, css: { width: 1400, height: 1000 } });
  });
  it('小屏夹取后不用降低410前置期待，以官方zoom和物理窗口建立原CSS场景', () => {
    const f = windowPort([1280, 724]); f.window.setContentSize(1400, 1000); expect(f.window.getContentSize()).toEqual([1280, 724]);
    const scene = resizeQueryLayoutNativeViewport(f.window, { width: 1400, height: 1000 });
    expect(scene.scale).toBe(0.724); expect(scene.css.width).toBeGreaterThanOrEqual(1400); expect(scene.css.height).toBeGreaterThanOrEqual(1000);
    expect(scene.content.width).toBeLessThanOrEqual(1280); expect(scene.content.height).toBeLessThanOrEqual(724);
  });
  it('缩小及恢复共用首个缩放，短viewport仍为480CSS像素', () => {
    const f = windowPort([1280, 724]), large = resizeQueryLayoutNativeViewport(f.window, { width: 1400, height: 1000 });
    const small = resizeQueryLayoutNativeViewport(f.window, { width: 1400, height: 480, scale: large.scale });
    const restored = resizeQueryLayoutNativeViewport(f.window, { width: 1400, height: 1000, scale: large.scale });
    expect(small.scale).toBe(large.scale); expect(small.css.height).toBeGreaterThanOrEqual(480); expect(small.css.height).toBeLessThan(482); expect(restored).toEqual(large);
  });
  it('原生zoom未生效则拒绝，不以记录请求值代替实际场景', () => {
    const f = windowPort([1280, 724], true); expect(() => resizeQueryLayoutNativeViewport(f.window, { width: 1400, height: 1000 })).toThrow('未建立');
  });
  it('仅容忍官方zoom的浮点往返尾差，不接受尺寸不足', () => {
    const f = windowPort([1280, 724], false, true), scene = resizeQueryLayoutNativeViewport(f.window, { width: 1400, height: 1000 });
    expect(scene.css.height).toBeCloseTo(1000, 8); expect(scene.scale).toBe(0.724);
  });
  it('拒绝无效原缩放，在窗口资源操作前失败', () => {
    const f = windowPort([1280, 724]); expect(() => resizeQueryLayoutNativeViewport(f.window, { width: 1400, height: 1000, scale: 0 })).toThrow('无效'); expect(f.calls).toEqual([]);
  });
});
