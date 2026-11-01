import React, { act, StrictMode, type ComponentProps } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import type { SqliteTablePresetSnapshot, SqliteTablePresetTarget, SqliteTablePresetSave, SqliteTablePresetSelect } from '../../src/shared/sqliteTablePresets';
import type { SqliteTablePresetServices } from '../../src/renderer/components/SqliteTablePresetPanel';
import { sqliteTablePresetsZh as t } from '../../src/renderer/locales/sqliteTablePresets.zh-CN';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(() => { throw Error('不允许外部IPC'); }) }));
vi.mock('../../src/renderer/lib', () => ({ invoke, errorMessage: (e: unknown) => e instanceof Error ? e.message : String(e) }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, Panel: typeof import('../../src/renderer/components/SqliteTablePresetPanel')['SqliteTablePresetPanel'];
const id = '11111111-1111-4111-8111-111111111111', bindingToken = '22222222-2222-4222-8222-222222222222';
const target = { connectionId: 'sqlite', database: 'main' as const, table: 'subject' }, query = { limit: 5, mode: 'and' as const, filters: [{ column: 'id', operator: 'in' as const, enabled: false, values: [{ kind: 'integer' as const, value: '9223372036854775807' }] }], sort: [] };
const snapshot: SqliteTablePresetSnapshot = { version: 1, target, revision: 3, source: { connectionRevision: 1, connectionDigest: 'a'.repeat(64) }, bindingToken, entries: [{ id, name: '常用', connectionDigest: 'a'.repeat(64), query }] };
beforeAll(async () => {
  doc = memoryDocument(); const create = doc.createElement.bind(doc);
  doc.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (k, v) => { set(k.toLowerCase(), v); if (k === 'disabled') node.disabled = true; }; node.removeAttribute = k => { remove(k.toLowerCase()); if (k === 'disabled') node.disabled = false; }; if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); return node; };
  ({ createRoot } = await import('react-dom/client')); ({ SqliteTablePresetPanel: Panel } = await import('../../src/renderer/components/SqliteTablePresetPanel'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; invoke.mockClear(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(k => k.startsWith('__reactProps$')); if (!key) throw Error('缺少React控件端口'); return Reflect.get(node, key); }
function button(label: string) { const node = doc.querySelectorAll('button').find(n => n.textContent === label); if (!node) throw Error('缺少按钮' + label); return node; }
async function click(label: string) { expect(button(label).disabled).toBe(false); await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
async function change(label: string, value: string) { const node = doc.querySelectorAll('input,select').find(n => n.getAttribute('aria-label') === label); if (!node) throw Error('缺少输入' + label); await act(async () => props(node).onChange({ target: { value } })); }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
/** 真实React组件，RAM异步端口只验UI门禁，不称作真实数据库或Main验收。 */
async function mount(strict = false) {
  const api = { list: vi.fn(async (_target: SqliteTablePresetTarget) => structuredClone(snapshot)), save: vi.fn(async (_input: SqliteTablePresetSave) => ({ ...structuredClone(snapshot), revision: 4 })), remove: vi.fn(async (_input: SqliteTablePresetSelect) => ({ ...structuredClone(snapshot), revision: 4, entries: [] })), read: vi.fn(async (_input: SqliteTablePresetSelect) => structuredClone(query)) } satisfies SqliteTablePresetServices;
  const state = { current: true }, confirm = vi.fn(() => true), onLoad = vi.fn(() => true), configuration = vi.fn(() => structuredClone(query)); Object.assign(window, { confirm });
  let value: ComponentProps<typeof Panel> = { scope: {}, target, columns: ['id'], draftKey: 'A', current: () => state.current, configuration, onLoad, services: api };
  const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as any);
  const render = async (changes: Partial<typeof value> = {}) => { value = { ...value, ...changes }; await act(async () => root!.render(strict ? <StrictMode><Panel {...value}/></StrictMode> : <Panel {...value}/>)); }; await render();
  return { api, state, confirm, onLoad, configuration, render };
}
it('挂载只本机list，载入仅交付原typed配置，不自动保存或执行查询', async () => {
  const f = await mount(); expect(f.api.list).toHaveBeenCalledExactlyOnceWith(target); expect(f.api.read).not.toHaveBeenCalled();
  await change(t.selection, id); await click(t.load); expect(f.onLoad).toHaveBeenCalledExactlyOnceWith(query); expect(doc.body.textContent).toContain(t.loaded); expect(invoke).not.toHaveBeenCalled();
});
it('明确保存当前配置及CAS，不将保存回包回填草稿，同步重入不能重复提交', async () => {
  const f = await mount(); await change(t.name, '新方案'); const pending = deferred<SqliteTablePresetSnapshot>(); f.api.save.mockImplementationOnce(() => pending.promise);
  const save = props(button(t.save)).onClick; await act(async () => { save(); save(); }); expect(f.api.save).toHaveBeenCalledTimes(1);
  expect(f.api.save.mock.calls[0][0]).toMatchObject({ ...target, name: '新方案', expectedRevision: 3, source: snapshot.source, bindingToken, query });
  await act(async () => pending.resolve({ ...snapshot, revision: 4 })); expect(f.onLoad).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain(t.saved);
});
it('覆盖与删除准确所选项需确认，取消不调用写端口，成功不改表单', async () => {
  const f = await mount(); await change(t.selection, id); f.confirm.mockReturnValue(false); await click(t.replace); await click(t.remove); expect(f.api.save).not.toHaveBeenCalled(); expect(f.api.remove).not.toHaveBeenCalled();
  f.confirm.mockReturnValue(true); await click(t.replace); expect(f.confirm).toHaveBeenCalledWith(t.confirmReplace('常用')); expect(f.api.save.mock.calls[0][0]).toMatchObject({ replaceId: id, name: '常用', expectedRevision: 3 });
  await click(t.remove); expect(f.api.remove.mock.calls[0][0]).toMatchObject({ id, expectedRevision: 4 }); expect(f.onLoad).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain(t.removed);
});
it.each(['edit', 'aba'] as const)('等待载入期间%s拒绝晚回包，不覆盖后来表单', async mode => {
  const f = await mount(), pending = deferred<typeof query>(); f.api.read.mockImplementationOnce(() => pending.promise); await change(t.selection, id); await click(t.load);
  await f.render({ draftKey: 'B' }); if (mode === 'aba') await f.render({ draftKey: 'A' }); await act(async () => pending.resolve(query));
  expect(f.onLoad).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain(t.changed);
});
it.each(['scope', 'columns', 'api', 'unmount', 'busy'] as const)('%s失效后的旧读回包不能交付或污染后继页', async mode => {
  const f = await mount(), pending = deferred<typeof query>(); f.api.read.mockImplementationOnce(() => pending.promise); await change(t.selection, id); await click(t.load);
  if (mode === 'scope') await f.render({ scope: {} }); if (mode === 'columns') await f.render({ columns: ['id', 'new'] }); if (mode === 'api') await f.render({ services: { ...f.api } });
  if (mode === 'unmount') { await act(async () => root!.unmount()); root = undefined; } if (mode === 'busy') { f.state.current = false; await f.render(); f.state.current = true; await f.render(); }
  await act(async () => pending.resolve(query)); expect(f.onLoad).not.toHaveBeenCalled();
});
it('缺字段回包整份拒绝，CAS失败保留名称和条件，不自动重试', async () => {
  const f = await mount(); f.api.read.mockResolvedValueOnce({ ...query, filters: [{ ...query.filters[0], column: 'gone' }] }); await change(t.selection, id); await click(t.load); expect(f.onLoad).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain('字段');
  await change(t.name, '保留名称'); f.api.save.mockRejectedValueOnce(Error('CAS已变化')); await click(t.save); expect(doc.body.textContent).toContain('CAS已变化'); expect(doc.querySelector('input')!.value).toBe('保留名称'); expect(f.api.save).toHaveBeenCalledTimes(1);
});
it('目标错误或坏快照不授予保存能力；手动刷新可恢复', async () => {
  const f = await mount(); f.api.list.mockResolvedValueOnce({ ...snapshot, target: { ...target, table: 'wrong' } }); await click(t.reload); expect(button(t.save).disabled).toBe(true); expect(doc.body.textContent).toContain(t.changed);
  await click(t.reload); expect(button(t.save).disabled).toBe(false); expect(f.api.save).not.toHaveBeenCalled();
});
it('StrictMode挂载的第一代迟到结果不能覆盖第二代，仍可正常载入', async () => {
  const f = await mount(true); expect(f.api.list).toHaveBeenCalledTimes(2); await change(t.selection, id); await click(t.load); expect(f.onLoad).toHaveBeenCalledOnce();
});
