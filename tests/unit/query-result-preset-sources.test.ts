import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { ColumnsMainCapabilities, type ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import { QueryResultPresetSources } from '../../src/main/queryResultPresetSources';
import type { QueryResultPresetStoredSnapshot } from '../../src/shared/queryResultPresets';

const rendererURL = 'file:///DBArk/dist/renderer/index.html';
/** 使用真实主文档捕获器，Electron生命周期及单调时间由受控端口提供，门禁不会恒成功。 */
function fixture() {
  const state = { now: 1000, windowDestroyed: false, contentsDestroyed: false, current: undefined as BrowserWindow | undefined };
  const frame = { url: rendererURL, processId: 17, frameToken: '真实主frame-1', detached: false };
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => state.contentsDestroyed });
  const window = { webContents: contents, isDestroyed: () => state.windowDestroyed };
  state.current = window as unknown as BrowserWindow;
  const capabilities = new ColumnsMainCapabilities(new Map(), {
    currentWindow: () => state.current, rendererURL, connectionRevision: () => 2,
    assertAvailable: connectionId => { if (connectionId !== 'ram-a') throw Error('受控连接不存在'); },
    shuttingDown: () => false, release: async () => undefined
  });
  capabilities.trackWindow(window as unknown as BrowserWindow);
  const owner = {
    assert: (invocation?: ColumnsInvocation) => capabilities.assertCapturedOwner(invocation),
    same: (left: ColumnsInvocation, right: ColumnsInvocation) => capabilities.sharesDocumentOwner(left, right)
  };
  const sources = new QueryResultPresetSources(owner, () => state.now);
  /** 每次均由真实捕获器登记新的IPC调用，不能手工拼接已授权invocation。 */
  function capture() {
    return capabilities.capture({ sender: contents as unknown as WebContents, senderFrame: frame as unknown as WebFrameMain } as IpcMainInvokeEvent);
  }
  const snapshot: QueryResultPresetStoredSnapshot = { version: 1, revision: 3, entries: [], source: { connectionRevision: 2, connectionDigest: 'a'.repeat(64) } };
  const target = { connectionId: 'ram-a' };
  /** 签发真实令牌，并提供独立来源值，后续试验不会无意修改原始绑定。 */
  function issue(invocation = capture()) {
    const issued = sources.issue(invocation, target, snapshot);
    return { issued, invocation, input: { connectionId: target.connectionId, source: { ...issued.source }, bindingToken: issued.bindingToken } };
  }
  return { state, frame, contents, window, sources, capabilities, snapshot, target, capture, issue };
}

describe('查询结果命名方案真实主文档来源租约', () => {
  it('同一主文档多次真实IPC可复用令牌，每次list签发独立UUID且不修改存储快照', () => {
    const f = fixture(), before = structuredClone(f.snapshot), first = f.issue(), second = f.issue();
    expect(first.invocation).not.toBe(second.invocation);
    expect(first.issued.bindingToken).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
    expect(second.issued.bindingToken).not.toBe(first.issued.bindingToken);
    expect(() => f.sources.assert(second.invocation, first.input)).not.toThrow();
    expect(() => f.sources.assert(f.capture(), second.input)).not.toThrow();
    expect(f.snapshot).toEqual(before); expect(Object.hasOwn(f.snapshot, 'bindingToken')).toBe(false);
    expect(first.issued).toEqual({ ...before, bindingToken: first.issued.bindingToken });
  });

  it('缺少或手工伪造调用不能签发或使用令牌，持有真实owner对象也不能代替捕获登记', () => {
    const f = fixture(), first = f.issue(), forged = { owner: first.invocation.owner };
    for (const invocation of [undefined, forged]) {
      expect(() => f.sources.issue(invocation, f.target, f.snapshot)).toThrow('来源');
      expect(() => f.sources.assert(invocation, first.input)).toThrow('来源');
    }
    expect(() => f.sources.assert(f.capture(), first.input)).not.toThrow();
  });

  it('未知令牌、跨连接及来源修订/摘要漂移均拒绝，失败不消费有效令牌', () => {
    const f = fixture(), first = f.issue();
    for (const patch of [
      { bindingToken: '00000000-0000-4000-8000-000000000000' },
      { connectionId: 'ram-b' },
      { source: { ...first.input.source, connectionRevision: 3 } },
      { source: { ...first.input.source, connectionDigest: 'b'.repeat(64) } }
    ]) expect(() => f.sources.assert(f.capture(), { ...first.input, ...patch })).toThrow('变化');
    expect(() => f.sources.assert(f.capture(), first.input)).not.toThrow();
  });

  it('签发时记录独立来源摘要字符串，调用方后来修改快照不能改写既有绑定', () => {
    const f = fixture(), first = f.issue();
    f.snapshot.source.connectionRevision = 99; f.snapshot.source.connectionDigest = 'b'.repeat(64);
    expect(() => f.sources.assert(f.capture(), first.input)).not.toThrow();
    expect(() => f.sources.assert(f.capture(), { ...first.input, source: f.snapshot.source })).toThrow('变化');
    const next = f.issue(); expect(() => f.sources.assert(f.capture(), next.input)).not.toThrow();
    expect(() => f.sources.assert(f.capture(), { ...next.input, source: first.input.source })).toThrow('变化');
  });

  it('同URL重载更换真实document；新旧调用均不能使用旧文档令牌，新令牌可用', () => {
    const f = fixture(), first = f.issue();
    f.contents.emit('did-navigate');
    expect(() => f.sources.assert(first.invocation, first.input)).toThrow('变化');
    expect(() => f.sources.assert(f.capture(), first.input)).toThrow('变化');
    const next = f.issue(); expect(() => f.sources.assert(f.capture(), next.input)).not.toThrow();
    expect(f.frame.url).toBe(rendererURL);
  });

  it('主frame开始新文档导航即撤销旧owner；子frame和同文档导航不换代', () => {
    const f = fixture(), first = f.issue();
    f.contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
    f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    expect(() => f.sources.assert(f.capture(), first.input)).not.toThrow();
    f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(() => f.sources.assert(first.invocation, first.input)).toThrow('变化');
    expect(() => f.sources.assert(f.capture(), first.input)).toThrow('变化');
  });

  it.each(['render-process-gone', 'destroyed'])('%s使原文档失活，不能同对象重取调用复活旧租约', event => {
    const f = fixture(), first = f.issue(); f.contents.emit(event);
    expect(() => f.sources.assert(first.invocation, first.input)).toThrow('变化');
    expect(() => f.capture()).toThrow('来源');
    f.capabilities.trackWindow(f.window as unknown as BrowserWindow);
    expect(() => f.sources.assert(f.capture(), first.input)).toThrow('变化');
    expect(() => f.sources.assert(f.capture(), f.issue().input)).not.toThrow();
  });

  it.each(['window', 'contents', 'frame', 'processId', 'frameToken', 'url', 'detached', 'currentWindow'] as const)('真实%s身份或存活状态变化拒绝旧来源', change => {
    const f = fixture(), first = f.issue();
    if (change === 'window') f.state.windowDestroyed = true;
    else if (change === 'contents') f.state.contentsDestroyed = true;
    else if (change === 'frame') f.contents.mainFrame = { ...f.frame };
    else if (change === 'processId') f.frame.processId++;
    else if (change === 'frameToken') f.frame.frameToken = '另一主frame';
    else if (change === 'url') f.frame.url = rendererURL + '?另一页面';
    else if (change === 'detached') f.frame.detached = true;
    else f.state.current = { ...f.window } as unknown as BrowserWindow;
    expect(() => f.sources.assert(first.invocation, first.input)).toThrow('变化');
    expect(() => f.sources.issue(first.invocation, f.target, f.snapshot)).toThrow('变化');
  });
});

describe('查询结果命名方案单调期限、容量和主动撤销', () => {
  it('十分钟TTL边界严格失效，重复assert不续期且过期令牌不能恢复', () => {
    const f = fixture(), first = f.issue();
    f.state.now += 599999; expect(() => f.sources.assert(f.capture(), first.input)).not.toThrow();
    f.state.now++; expect(() => f.sources.assert(f.capture(), first.input)).toThrow('变化');
    const next = f.issue(); expect(() => f.sources.assert(f.capture(), next.input)).not.toThrow();
    expect(() => f.sources.assert(f.capture(), first.input)).toThrow('变化');
  });

  it('容量允许256项，第257项按签发顺序淘汰最旧项，assert不改变淘汰顺序', () => {
    const f = fixture(), items = Array.from({ length: 256 }, () => f.issue());
    expect(() => f.sources.assert(f.capture(), items[0].input)).not.toThrow();
    expect(() => f.sources.assert(f.capture(), items[255].input)).not.toThrow();
    const next = f.issue();
    expect(() => f.sources.assert(f.capture(), items[0].input)).toThrow('变化');
    expect(() => f.sources.assert(f.capture(), items[1].input)).not.toThrow();
    expect(() => f.sources.assert(f.capture(), items[255].input)).not.toThrow();
    expect(() => f.sources.assert(f.capture(), next.input)).not.toThrow();
  });

  it('签发前先清理过期项，容量释放不会连带淘汰仍在期限内的项', () => {
    const f = fixture();
    const expired = Array.from({ length: 255 }, () => f.issue());
    f.state.now += 300000; const live = f.issue();
    f.state.now += 300000; const replacements = Array.from({ length: 255 }, () => f.issue());
    expect(() => f.sources.assert(f.capture(), expired[254].input)).toThrow('变化');
    expect(() => f.sources.assert(f.capture(), live.input)).not.toThrow();
    expect(() => f.sources.assert(f.capture(), replacements[254].input)).not.toThrow();
    f.issue(); expect(() => f.sources.assert(f.capture(), live.input)).toThrow('变化');
  });

  it('显式invalidate撤销全体连接令牌，新签发不会复活同文档旧票据', () => {
    const f = fixture(), first = f.issue();
    const second = f.sources.issue(f.capture(), { connectionId: 'ram-b' }, f.snapshot);
    const secondInput = { connectionId: 'ram-b', source: { ...second.source }, bindingToken: second.bindingToken };
    expect(() => f.sources.assert(f.capture(), secondInput)).not.toThrow();
    f.sources.invalidate(); f.sources.invalidate();
    expect(() => f.sources.assert(f.capture(), first.input)).toThrow('变化');
    expect(() => f.sources.assert(f.capture(), secondInput)).toThrow('变化');
    const next = f.issue(); expect(() => f.sources.assert(f.capture(), next.input)).not.toThrow();
    expect(() => f.sources.assert(f.capture(), first.input)).toThrow('变化');
  });

  it.each(['assert', 'issue'] as const)('%s遇到时钟回退撤销全部令牌，恢复时间后仍不可复活', operation => {
    const f = fixture(), first = f.issue(); f.state.now += 10; const second = f.issue();
    f.state.now--;
    expect(() => operation === 'assert' ? f.sources.assert(f.capture(), first.input) : f.issue()).toThrow('期限');
    f.state.now += 11;
    expect(() => f.sources.assert(f.capture(), first.input)).toThrow('变化');
    expect(() => f.sources.assert(f.capture(), second.input)).toThrow('变化');
    const next = f.issue(); expect(() => f.sources.assert(f.capture(), next.input)).not.toThrow();
  });

  it.each([NaN, Infinity, -Infinity])('非有限时钟%s撤销已有令牌且不签发新能力', badTime => {
    const f = fixture(), first = f.issue(); f.state.now = badTime;
    expect(() => f.issue()).toThrow('期限');
    f.state.now = 1001;
    expect(() => f.sources.assert(f.capture(), first.input)).toThrow('变化');
    expect(() => f.sources.assert(f.capture(), f.issue().input)).not.toThrow();
  });

  it('invalidate不会重置单调时钟基线，不能通过清空令牌绕过回退检查', () => {
    const f = fixture(); f.issue(); f.state.now += 100; f.issue();
    f.sources.invalidate(); f.state.now -= 50;
    expect(() => f.issue()).toThrow('期限');
    f.state.now += 51;
    expect(() => f.sources.assert(f.capture(), f.issue().input)).not.toThrow();
  });
});
