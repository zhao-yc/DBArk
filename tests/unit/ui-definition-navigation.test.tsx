import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { definitionNavigationResult } from '../../src/engine/definitionNavigation';
import type { DefinitionSearchOpen } from '../../src/shared/definitionNavigation';
import { definitionNavigationZh as t } from '../../src/renderer/locales/definitionNavigation.zh-CN';

// 仅替换编辑器宿主和IPC端口；真实ReactDOM、DefinitionViewer及导航控制器不替换。
const editors = vi.hoisted(() => ({ mounts: [] as { value: string; readOnly: boolean; onReady(editor: any): void }[] }));
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: (props: any) => { editors.mounts.push(props); return <pre aria-label="定义原文">{props.value}</pre>; } }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Viewer: typeof import('../../src/renderer/components/DefinitionViewer')['DefinitionViewer'], workspace: typeof import('../../src/renderer/store')['useWorkspace'];
let Builder: any, modelPrototype: any, Uri: any;
let closed: ReturnType<typeof vi.fn>, requests: { command: string; input: any }[], read: (input: any) => Promise<string>;
const resources: { dispose(): void }[] = [];
const sql = 'CREATE VIEW `对象` AS SELECT \'😀标记\'\r\n-- 标记';

beforeAll(async () => {
  document = memoryDocument(); Object.assign(window, { setTimeout, clearTimeout });
  ({ createRoot } = await import('react-dom/client')); ({ DefinitionViewer: Viewer } = await import('../../src/renderer/components/DefinitionViewer')); ({ useWorkspace: workspace } = await import('../../src/renderer/store'));
  const base = dirname(createRequire(import.meta.url).resolve('monaco-editor/package.json'));
  Builder = (await import(/* @vite-ignore */ pathToFileURL(join(base, 'esm/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js')).href)).PieceTreeTextBufferBuilder;
  modelPrototype = (await import(/* @vite-ignore */ pathToFileURL(join(base, 'esm/vs/editor/common/model/textModel.js')).href)).TextModel.prototype;
  Uri = (await import(/* @vite-ignore */ pathToFileURL(join(base, 'esm/vs/base/common/uri.js')).href)).URI;
});
beforeEach(() => {
  workspace.setState({ connections: [{ id: 'c' }] as any, connectionVersions: { c: 1 } }); requests = []; closed = vi.fn(); editors.mounts = []; read = async () => sql;
  (window as any).dbark = { invoke: async (command: string, input: any) => { requests.push({ command, input }); if (command === 'connections.open') return {}; if (command === 'metadata.ddl') return read(input); throw Error('纯测试禁止命令：' + command); } };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } for (const value of resources.splice(0)) value.dispose(); document.body.textContent = ''; delete (window as any).dbark; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 来源使用实际正文匹配器计算摘要及UTF16跨度，不伪造组件导航状态。 */
function search(text = sql, name = '对象'): DefinitionSearchOpen { return { connectionId: 'c', connectionVersion: 1, database: '库', name, kind: 'view', invalidated: false, result: definitionNavigationResult(text, { mode: 'contains', text: '标记', caseSensitive: true }) }; }
/** 保持同一React根，覆盖原组件props切换及StrictMode重订阅。 */
async function render(source = search(), strict = false): Promise<void> { await act(async () => { const element = <Viewer connectionId={source.connectionId} database={source.database} object={{ name: source.name, kind: source.kind }} search={source} onClose={closed}/>; root!.render(strict ? <StrictMode>{element}</StrictMode> : element); }); }
async function click(label: string): Promise<void> { const button = document.querySelectorAll('button').find(node => node.textContent === label); expect(button, label).toBeDefined(); await act(async () => { button!.dispatchEvent(new MemoryEvent('click')); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

/** 行列与逆偏移来自已安装Monaco真实TextModel；宿主只记录装饰、光标和监听。 */
function editor(text = sql) {
  const builder = new Builder(); builder.acceptChunk(text); const buffer = builder.finish().create(1).textBuffer;
  const events = { content: new Set<() => void>(), dispose: new Set<() => void>(), model: new Set<() => void>(), editor: new Set<() => void>() };
  const listen = (key: keyof typeof events, fn: () => void) => { events[key].add(fn); return { dispose: () => events[key].delete(fn) }; };
  let version = 1, active: any;
  const model: any = Object.assign(Object.create(modelPrototype), { _buffer: buffer, _isDisposed: false, _associatedResource: Uri.parse('inmemory://definition/组件模型'), getVersionId: () => version, isDisposed: () => false, onDidChangeContent: (fn: () => void) => listen('content', fn), onWillDispose: (fn: () => void) => listen('dispose', fn) }); active = model;
  const decorations = { set: vi.fn(), clear: vi.fn() }, port = { getModel: () => active, createDecorationsCollection: vi.fn(() => decorations), setPosition: vi.fn(), revealPositionInCenter: vi.fn(), focus: vi.fn(), onDidChangeModel: (fn: () => void) => listen('model', fn), onDidDispose: (fn: () => void) => listen('editor', fn) };
  resources.push({ dispose: () => buffer.dispose() });
  return { port, model, decorations, events, emit(key: keyof typeof events) { if (key === 'content') version++; if (key === 'model') active = Object.assign(Object.create(modelPrototype), model); for (const fn of [...events[key]]) fn(); } };
}
async function settled() { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)); }); expect(editors.mounts.length).toBeGreaterThan(0); }); }
async function ready(value = editor()) { await settled(); const mount = editors.mounts.at(-1)!; expect(mount.readOnly).toBe(true); await act(async () => mount.onReady(value.port)); return value; }

describe('定义正文真实React生命周期与Monaco端口（仅RAM）', () => {
  it.each([false, true])('正常读取、全部高亮、准确UTF16行列和前后循环，StrictMode=%s', async strict => {
    await render(search(), strict); const value = await ready(); expect(document.body.textContent).toContain(t.count(0, 2)); expect(value.decorations.set.mock.calls.at(-1)![0]).toHaveLength(2);
    const first = sql.indexOf('标记'), second = sql.lastIndexOf('标记'); expect(value.port.setPosition).toHaveBeenLastCalledWith(value.model.getPositionAt(first));
    await click(t.previous); expect(value.port.setPosition).toHaveBeenLastCalledWith(value.model.getPositionAt(second)); expect(document.body.textContent).toContain(t.position(2, 4));
    await click(t.next); expect(value.port.setPosition).toHaveBeenLastCalledWith(value.model.getPositionAt(first)); expect(value.model.getValue()).toBe(sql);
    expect(requests.every(item => ['connections.open', 'metadata.ddl'].includes(item.command))).toBe(true); expect(requests.filter(item => item.command === 'metadata.ddl').at(-1)?.input).toEqual({ connectionId: 'c', database: '库', name: '对象', kind: 'view' });
  });
  it('迟到定义不覆盖新对象原文及当前模型定位', async () => {
    const pending = deferred<string>(); read = input => input.name === '对象' ? pending.promise : Promise.resolve(sql.replaceAll('对象', '第二对象'));
    await render(); await render(search(sql.replaceAll('对象', '第二对象'), '第二对象')); const current = await ready(editor(sql.replaceAll('对象', '第二对象')));
    const count = current.port.setPosition.mock.calls.length; await act(async () => pending.resolve(sql)); expect(document.body.textContent).toContain('第二对象'); expect(current.port.setPosition).toHaveBeenCalledTimes(count); expect(document.body.textContent).toContain(t.count(0, 2));
  });
  it('换对象后旧编辑器onReady回调不得影响当前导航', async () => {
    await render(); await settled(); const old = editors.mounts.at(-1)!; read = async () => sql.replaceAll('对象', '第二对象'); await render(search(sql.replaceAll('对象', '第二对象'), '第二对象')); const value = await ready(editor(sql.replaceAll('对象', '第二对象'))); const stale = editor();
    await act(async () => old.onReady(stale.port)); expect(stale.port.createDecorationsCollection).not.toHaveBeenCalled(); await click(t.next); expect(value.port.setPosition).toHaveBeenCalledTimes(2);
  });
  it.each(['修订ABA', '删除恢复'])('%s同步撤销已有高亮，不靠下一次点击才清理', async mode => {
    await render(); const value = await ready(); await act(async () => { workspace.setState(mode === '修订ABA' ? { connectionVersions: { c: 2 } } : { connections: [] }); workspace.setState({ connections: [{ id: 'c' }] as any, connectionVersions: { c: 1 } }); });
    expect(value.decorations.clear).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(t.invalid); expect(document.querySelectorAll('button').some(node => node.textContent === t.next)).toBe(false);
  });
  it.each(['content', 'model', 'dispose', 'editor'] as const)('实际模型事件%s撤销高亮且不回写正文', async event => {
    await render(); const value = await ready(); await act(async () => value.emit(event)); expect(value.decorations.clear).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(t.invalid); expect(value.port.setPosition).toHaveBeenCalledOnce(); expect(value.model.getValue()).toBe(sql);
  });
  it('关闭高亮只清理本次导航，继续展示原定义且不重新领取', async () => {
    const source = search(); await render(source); const value = await ready(); await click(t.close); await render(source); expect(value.decorations.clear).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(sql); expect(document.body.textContent).not.toContain(t.count(0, 2)); expect(closed).not.toHaveBeenCalled();
  });
  it('读取途中关闭，迟到回包不得创建编辑器或高亮', async () => {
    const pending = deferred<string>(); read = () => pending.promise; await render(); await click('取消'); await act(async () => pending.resolve(sql)); expect(closed).toHaveBeenCalledOnce(); expect(editors.mounts).toHaveLength(0);
  });
  it('摘要不符保留当前原文且明确失效，不沿用旧命中', async () => {
    read = async () => sql + ' -- 服务器已改'; await render(); await settled(); expect(document.body.textContent).toContain('服务器已改'); expect(document.body.textContent).toContain(t.invalid); const value = await ready(editor(sql + ' -- 服务器已改')); expect(value.port.setPosition).not.toHaveBeenCalled();
  });
  it('Monaco规范化混合行尾时整组降级，不强行替换模型文字', async () => {
    const mixed = '标记\r\n标记\n标记'; read = async () => mixed; await render(search(mixed)); const value = await ready(editor(mixed)); expect(value.model.getValue()).not.toBe(mixed); expect(document.body.textContent).toContain(t.unlocatable); expect(value.port.setPosition).not.toHaveBeenCalled();
  });
  it('卸载后旧onReady不创建装饰或泄漏模型监听', async () => {
    await render(); await settled(); const mount = editors.mounts.at(-1)!, value = await ready(); await act(async () => root!.unmount()); root = undefined; await act(async () => mount.onReady(value.port)); expect(value.decorations.clear).toHaveBeenCalledOnce(); expect(Object.values(value.events).reduce((sum, set) => sum + set.size, 0)).toBe(0);
  });
});
