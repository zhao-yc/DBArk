import { act, type ComponentProps } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { SqliteFilteredSelectIntent, type SqliteFilteredSelectPlan } from '../../src/renderer/sqliteFilteredSelectUi';
import { sqliteFilteredSelectZh as text } from '../../src/renderer/locales/sqliteFilteredSelect.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, Dialog: typeof import('../../src/renderer/components/SqliteFilteredSelectDialog')['SqliteFilteredSelectDialog'];
const request = vi.fn(() => { throw Error('生成草稿表单禁止IPC'); });
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { configurable: true, value: null }); const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; if (name === 'input') Object.defineProperty(node, 'type', { configurable: true, get: () => node.attributes.get('type') ?? 'text', set: value => node.attributes.set('type', value) }); return node; };
  ({ createRoot } = await import('react-dom/client')); ({ SqliteFilteredSelectDialog: Dialog } = await import('../../src/renderer/components/SqliteFilteredSelectDialog'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; request.mockClear(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function control(label: string) { const node = document.querySelectorAll('input,textarea').find(node => node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.getAttribute('aria-label') === label || node.textContent === label); expect(node, label).toBeDefined(); return node!; }
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少React真实事件端口'); return Reflect.get(node, key); }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function choose(label: string, checked = true) { const node = control(label); expect(node.disabled).toBe(false); await act(async () => props(node).onChange({ target: { checked } })); }
async function input(value: string) { const node = control(text.limit); expect(node.disabled).toBe(false); await act(async () => props(node).onChange({ target: { value } })); }
/** 真实React/Modal/Intent/SQL编译，只有DOM与父级导航端口为RAM，无数据库或原窗口宣称。 */
async function mount() {
  const page: SqliteTablePage = { target: { connectionId: 'owned', database: 'main', table: '原表🚢', kind: 'table' }, schemaKey: 'd'.repeat(64), columns: ['id', 'memo', 'payload'].map(name => ({ name, declaredType: '' })), offset: 100, limit: 20, hasMore: true, result: {} as SqliteTablePage['result'] };
  const dataRead = vi.fn(() => { throw Error('不应读取数据行'); }); Object.defineProperties(page, { result: { enumerable: true, get: dataRead }, edit: { enumerable: true, get: dataRead } });
  const alive = { value: true }, guard = () => { const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]'); return alive.value && (dialogs.length === 0 || dialogs.length === 1 && !!dialogs[0].querySelector('[data-sqlite-filtered-select-owner="select-1"]')); };
  const intent = new SqliteFilteredSelectIntent(page, { limit: 20, mode: 'and', filters: [{ column: 'id', operator: 'gte', value: { kind: 'integer', value: '9007199254740993' } }], sort: [{ column: 'id', direction: 'asc' }] }, guard), onOpen = vi.fn((plan: SqliteFilteredSelectPlan) => intent.consume(plan)), onClose = vi.fn(), base: ComponentProps<typeof Dialog> = { intent, ownerId: 'select-1', onOpen, onClose };
  let value = base; Object.defineProperty(window, 'dbark', { configurable: true, value: { invoke: request } }); const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element); await act(async () => root!.render(<Dialog {...value}/>));
  return { intent, page, alive, onOpen, onClose, dataRead, async render(patch: Partial<typeof base> = {}) { value = { ...base, ...patch }; await act(async () => root!.render(<Dialog {...value}/>)); } };
}
it('默认全字段、无LIMIT/OFFSET准确只读预览，取消零consume／导航／IPC', async () => {
  const f = await mount(); expect(control(text.preview).value).toContain('9007199254740993'); expect(control(text.preview).value).not.toMatch(/LIMIT|OFFSET/); expect(control(text.preview).getAttribute('readonly')).toBe(''); expect(control(text.noLimit).checked).toBe(true); expect(document.body.textContent).toContain(text.hint); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onOpen).not.toHaveBeenCalled(); expect(f.intent.current()).toBe(true); expect(f.dataRead).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
});
it('全不选禁用，逐项选择与移动准确改变投影顺序，交付的就是最后预览', async () => {
  const f = await mount(); await click(text.none); expect(button(text.open).disabled).toBe(true); expect(control(text.preview).value).toBe(''); await choose(text.choose('payload')); await choose(text.choose('id')); await click(text.moveUp('payload')); await click(text.moveUp('payload')); const sql = control(text.preview).value; expect(sql).toMatch(/^SELECT "payload", "id"/); await click(text.open); expect(f.onOpen).toHaveBeenCalledOnce(); expect(f.onOpen.mock.calls[0][0].sql).toBe(sql); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.intent.current()).toBe(false); expect(f.dataRead).not.toHaveBeenCalled();
});
it('全选恢复保持刚编辑的顺序；显式LIMIT3、切回无限制均不会执行', async () => {
  const f = await mount(); await click(text.moveUp('payload')); await click(text.none); await click(text.all); expect(control(text.preview).value).toMatch(/^SELECT "id", "payload", "memo"/); await choose(text.limited); await input('3'); expect(control(text.preview).value).toMatch(/ LIMIT 3$/); await choose(text.noLimit); expect(control(text.preview).value).not.toContain('LIMIT'); expect(f.onOpen).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
});
it.each(['', '0', '-1', '1.5', '1000001'])('非法LIMIT%s不保留旧预览或交付旧plan，可明确修正', async value => {
  const f = await mount(); await choose(text.limited); await input(value); expect(control(text.preview).value).toBe(''); expect(button(text.open).disabled).toBe(true); expect(f.onOpen).not.toHaveBeenCalled(); await input('2'); expect(control(text.preview).value).toMatch(/ LIMIT 2$/); expect(button(text.open).disabled).toBe(false);
});
it('同轮连续数字全文事件保留最新值，旧按钮回调不能交旧plan', async () => {
  const f = await mount(); const old = props(button(text.open)).onClick; await choose(text.limited); const onChange = props(control(text.limit)).onChange; await act(async () => { onChange({ target: { value: '2' } }); onChange({ target: { value: '25' } }); }); expect(control(text.preview).value).toMatch(/ LIMIT 25$/); await act(async () => old()); expect(f.onOpen).not.toHaveBeenCalled(); await click(text.open); expect(f.onOpen.mock.calls[0][0].limit).toBe(25);
});
it('来源失效后不复活但仍可关闭自己窗口', async () => {
  const f = await mount(); f.alive.value = false; await f.render(); expect(button(text.open).disabled).toBe(true); f.alive.value = true; await f.render(); expect(button(text.open).disabled).toBe(true); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onOpen).not.toHaveBeenCalled();
});
it('外来Modal使原来源失效，关闭外来窗口也不复活旧计划', async () => {
  const f = await mount(), foreign = document.createElement('div'); foreign.setAttribute('role', 'dialog'); document.body.appendChild(foreign); await f.render(); document.body.removeChild(foreign); await f.render(); expect(button(text.open).disabled).toBe(true); await click(text.cancel); expect(f.onOpen).not.toHaveBeenCalled();
});
it.each(['false', 'throws'] as const)('父级%s保留预览和输入，一份plan只交付一次', async failure => {
  const f = await mount(); f.onOpen.mockImplementation(() => { if (failure === 'throws') throw Error('父级拒绝'); return false; }); const sql = control(text.preview).value; await click(text.open); expect(f.onClose).not.toHaveBeenCalled(); expect(control(text.preview).value).toBe(sql); expect(button(text.open).disabled).toBe(true); await choose(text.limited); await input('3'); expect(button(text.open).disabled).toBe(false); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce();
});
it('同步导航重入只交付一次，父级成功后source失效不误判', async () => {
  const f = await mount(); const original = props(button(text.open)).onClick; f.onOpen.mockImplementation(plan => { original(); const accepted = f.intent.consume(plan); f.alive.value = false; return accepted; }); await click(text.open); expect(f.onOpen).toHaveBeenCalledOnce(); expect(f.onClose).toHaveBeenCalledOnce();
});
