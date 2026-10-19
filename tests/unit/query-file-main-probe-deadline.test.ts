import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { installMainProbe, detachMainProbe } from '../helpers/queryFileMainProbe';

const choice = { nonce: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', deadline: 2000, window: 7, contents: 11 };
/** 原Main闭包只在RAM执行，SDK端口记录发起时刻，指定读取晚回后禁止下一getter/注册。 */
function fixture(cross = '', changedClock = 2000) {
  let now = 1000; const reads: string[] = [], late: string[] = [], outputs: string[] = [], removed: string[] = [];
  const dispatch = vi.fn(() => { throw Error('观察器不得派发'); });
  function sdk<T>(name: string, value: T): T { reads.push(name); if (!Number.isFinite(now) || now < 1000 || now >= choice.deadline) late.push(name); if (name === cross) now = changedClock; return value; }
  const contents = new EventEmitter(), window = new EventEmitter();
  Object.defineProperty(window, 'id', { get: () => sdk('window.id', 7) });
  Object.defineProperty(contents, 'id', { get: () => sdk('contents.id', 11) });
  Object.defineProperty(window, 'webContents', { get: () => sdk('window.webContents', contents) });
  Object.assign(window, { isDestroyed: () => sdk('window.isDestroyed', false) });
  Object.assign(contents, { isDestroyed: () => sdk('contents.isDestroyed', false) });
  // 注册/解绑分别计数：过期只能清理已经捕获的自身listener，不读取新SDK。
  contents.on = ((name: string, listener: (...args: any[]) => void) => { sdk('contents.on:' + name, null); EventEmitter.prototype.on.call(contents, name, listener); return contents; }) as typeof contents.on;
  contents.once = ((name: string, listener: (...args: any[]) => void) => { sdk('contents.once:' + name, null); EventEmitter.prototype.on.call(contents, name, listener); return contents; }) as typeof contents.once;
  window.once = ((name: string, listener: (...args: any[]) => void) => { sdk('window.once:' + name, null); EventEmitter.prototype.on.call(window, name, listener); return window; }) as typeof window.once;
  contents.removeListener = ((name: string, listener: (...args: any[]) => void) => { removed.push('contents:' + name); EventEmitter.prototype.removeListener.call(contents, name, listener); return contents; }) as typeof contents.removeListener;
  window.removeListener = ((name: string, listener: (...args: any[]) => void) => { removed.push('window:' + name); EventEmitter.prototype.removeListener.call(window, name, listener); return window; }) as typeof window.removeListener;
  /** SDK属性用getter计时；不提供click/save/focus的可用路径。 */
  function item(name: string, label: string, submenu?: { items: unknown[] }) {
    const target: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({ label, submenu, enabled: true, visible: true, accelerator: name === 'save' ? 'CmdOrCtrl+S' : undefined })) Object.defineProperty(target, key, { get: () => sdk(name + '.' + key, value) });
    Object.defineProperty(target, 'click', { get: dispatch, set: dispatch }); return target;
  }
  const leaf = item('save', '保存查询'), submenu = { get items() { return sdk('submenu.items', [leaf]); } }, ancestor = item('ancestor', '文件', submenu);
  const menu = { get items() { return sdk('menu.items', [ancestor]); } };
  const api = { BrowserWindow: { fromId: () => sdk('BrowserWindow.fromId', window) }, Menu: { getApplicationMenu: () => sdk('Menu.getApplicationMenu', menu) } };
  const context = { Date: { now: () => now++ }, process: { stdout: { write: (value: string) => { outputs.push(value); return true; } } }, setTimeout: vi.fn(() => { sdk('timer', null); return 1; }), clearTimeout: vi.fn() };
  const application = { evaluate: async (action: Function, value: unknown) => runInNewContext('(' + action.toString() + ')', context)(api, value) } as any;
  return { application, reads, late, outputs, removed, contents, window, dispatch, context };
}

describe('Main安装每次同步SDK读取的原期限护栏', () => {
  const stages = ['BrowserWindow.fromId', 'window.isDestroyed', 'window.webContents', 'window.id', 'contents.id', 'contents.isDestroyed', 'Menu.getApplicationMenu', 'menu.items', 'ancestor.label', 'ancestor.submenu', 'submenu.items', 'save.label', 'save.submenu', 'ancestor.enabled', 'ancestor.visible', 'ancestor.accelerator', 'save.enabled', 'save.visible', 'save.accelerator'];
  it.each(stages)('%s跨deadline后没有下一次getter/注册或安全帧', async stage => {
    const f = fixture(stage); await expect(installMainProbe(f.application, choice)).rejects.toThrow(/^Main观察安装失败，保留现场$/);
    expect(f.reads.at(-1)).toBe(stage); expect(f.late).toEqual([]); expect(f.removed).toEqual([]);
    expect(f.reads.some(name => /^(contents\.on|contents\.once|window\.once|timer)/.test(name))).toBe(false);
    expect(f.contents.eventNames()).toEqual([]); expect(f.window.eventNames()).toEqual([]); expect(f.dispatch).not.toHaveBeenCalled();
    // 窗口及菜单遍历阶段尚未发帧；后续菜单状态跨时只保留此前已发帧，无ready。
    const frames = f.outputs.map(text => JSON.parse(text.slice(text.indexOf(':{') + 1)));
    expect(frames.some(value => value.stage === 0 || value.stage === 5)).toBe(false);
    if (stages.indexOf(stage) <= stages.indexOf('save.submenu')) expect(frames).toEqual([]);
  });
  it.each(['timer', 'contents.on:before-input-event', 'contents.once:destroyed', 'window.once:closed'])('%s晚回后不再下一注册，仅解绑已捕获listener', async stage => {
    const f = fixture(stage); await expect(installMainProbe(f.application, choice)).rejects.toThrow();
    expect(f.reads.at(-1)).toBe(stage); expect(f.late).toEqual([]); expect(f.contents.eventNames()).toEqual([]); expect(f.window.eventNames()).toEqual([]);
    expect(f.outputs.some(value => value.includes('"stage":0'))).toBe(false); expect(f.dispatch).not.toHaveBeenCalled();
    if (stage === 'timer') expect(f.removed).toEqual([]);
  });
  it.each([NaN, Infinity, 999])('菜单getter使时钟为%s后立即停链，不继续读submenu', async clock => {
    const f = fixture('save.label', clock); await expect(installMainProbe(f.application, choice)).rejects.toThrow();
    expect(f.reads.at(-1)).toBe('save.label'); expect(f.late).toEqual([]); expect(f.outputs).toEqual([]); expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('有限递增时钟内完成原安装/解绑，不重复读取submenu或菜单状态', async () => {
    const f = fixture(); await installMainProbe(f.application, choice); await detachMainProbe(f.application, choice);
    for (const stage of ['ancestor.submenu', 'save.submenu', 'submenu.items', 'ancestor.enabled', 'ancestor.visible', 'save.enabled', 'save.visible']) expect(f.reads.filter(name => name === stage)).toHaveLength(1);
    expect(f.late).toEqual([]); expect(f.contents.eventNames()).toEqual([]); expect(f.window.eventNames()).toEqual([]); expect(f.dispatch).not.toHaveBeenCalled();
  });
});
