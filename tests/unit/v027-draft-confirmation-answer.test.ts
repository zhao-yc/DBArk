import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v027DraftConfirmation } from '../helpers/v027Acceptance';
const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
/** 只提供RAM浏览器确认端口；不运行桌面、Playwright或真实对话框。 */
beforeEach(() => { Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: vi.fn(() => false) } }); });
afterEach(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
describe('0.27准确提示的一次确认回答', () => {
  it('准确提示返回true，原函数即时恢复，旧回答不可重用', () => {
    const gate = v027DraftConfirmation('准确返回草稿');
    expect(window.confirm('准确返回草稿')).toBe(true); expect(gate.calls).toBe(1); expect(window.confirm).toBe(gate.original);
    expect(() => gate.replacement('准确返回草稿')).toThrow('归属未知'); expect(gate.original).not.toHaveBeenCalled();
  });
  it('不同提示不回答、不调用原函数，也不签发完成', () => {
    const gate = v027DraftConfirmation('准确返回草稿');
    expect(() => window.confirm('其它确认')).toThrow('归属未知'); expect(gate.calls).toBe(0); expect(window.confirm).toBe(gate.replacement); expect(gate.original).not.toHaveBeenCalled();
  });
  it('外来替换使原回答失效，不覆盖新的函数', () => {
    const gate = v027DraftConfirmation('准确返回草稿'), other = vi.fn(() => false); window.confirm = other;
    expect(() => gate.replacement('准确返回草稿')).toThrow('归属未知'); expect(gate.calls).toBe(0); expect(window.confirm).toBe(other); expect(other).not.toHaveBeenCalled();
  });
});
