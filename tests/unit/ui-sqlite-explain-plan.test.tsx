import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { QueryOutcome, QueryResult } from '../../src/shared/contracts';
import { sqliteExplainLimits } from '../../src/shared/sqliteExplain';
import { sqliteExplainZh as text } from '../../src/renderer/locales/sqliteExplain.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

const grids = vi.hoisted(() => ({ calls: [] as any[] }));
// 仅隔离虚拟网格 DOM；原始列/行、只读属性和来源守卫在此端口精确核对。
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: (props: any) => { grids.calls.push(props); return <div role="grid"/>; } }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let View: typeof import('../../src/renderer/components/SqliteExplainPlanView')['SqliteExplainPlanView'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const), scroll = vi.fn();
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); Reflect.set(node, 'scrollIntoView', scroll); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client')); ({ SqliteExplainPlanView: View } = await import('../../src/renderer/components/SqliteExplainPlanView'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; grids.calls = []; vi.clearAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

function fixture(): QueryOutcome {
  const result: QueryResult = { columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }, { key: 'c1', name: 'parent', type: 'SQLITE' }, { key: 'c2', name: 'notused', type: 'SQLITE' }, { key: 'c3', name: 'detail', type: 'SQLITE' }], rows: [{ c0: '9007199254740993', c1: '0', c2: '0', c3: 'SCAN "表🧭"' }], truncated: false, elapsedMs: 0, statement: 'EXPLAIN QUERY PLAN SELECT 1' };
  return { results: [result], elapsedMs: 1, sqliteExplain: { dialect: 'sqlite', version: '3.合成', initialView: 'tree', raw: 'id\tparent\tnotused\tdetail\n9007199254740993\t0\t0\tSCAN "表🧭"', rawTruncated: false, warnings: ['原生输出不包含实际耗时。'], nodes: [
    { id: '9007199254740993', depth: 0, auxiliary: '0', detail: '根计划原文' },
    { id: '2', parent: '9007199254740993', depth: 1, auxiliary: '0', detail: 'SEARCH "表🧭" USING INDEX idx_name (name=?)' },
    { id: '3', parent: '2', depth: 2, auxiliary: '0', detail: '保留原文 <script>不得运行</script>' },
    { id: '4', parent: '9007199254740993', depth: 1, auxiliary: '0', detail: 'USE TEMP B-TREE FOR ORDER BY' },
  ] } };
}
async function mount(outcome = fixture(), busy = false) {
  let allowed = true; const invoke = vi.fn(() => { throw Error('本地计划阅读禁止 IPC'); }); Reflect.set(window, 'dbark', { invoke }); const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element);
  const render = async (next = outcome, nextBusy = busy) => { await act(async () => root!.render(<View outcome={next} busy={nextBusy} isCurrent={() => allowed}/>)); }; await render();
  return { outcome, invoke, render, async allowed(value: boolean) { allowed = value; await render(); } };
}
function button(label: string): MemoryNode { const node = document.querySelectorAll('button').find(node => node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function tree(): MemoryNode[] { return document.querySelectorAll('[role="treeitem"]'); }
function selected() { return tree().find(node => node.getAttribute('aria-selected') === 'true'); }
function callback(node: MemoryNode, name = 'onClick'): (...args: any[]) => unknown { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return Reflect.get(node, key)[name]; }
async function click(label: string) { await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
async function key(node: MemoryNode, value: string) { const event = Object.assign(new MemoryEvent('keydown'), { key: value }); await act(async () => node.dispatchEvent(event)); return event; }

describe('SQLite 计划专属视图真实 React RAM', () => {
  it('原数值id和detail逐字保留，不解释脚本或构造MySQL估计指标', async () => {
    const f = await mount(); expect(document.querySelector('[data-sqlite-explain-view]')).not.toBeNull(); expect(tree()).toHaveLength(4); expect(tree()[0].textContent).toContain('9007199254740993'); expect(tree()[1].textContent).toContain(f.outcome.sqliteExplain!.nodes[1].detail); expect(tree()[2].textContent).toContain('<script>不得运行</script>'); expect(document.querySelectorAll('script')).toHaveLength(0); expect(document.body.textContent).toContain(text.estimates); expect(document.body.textContent).toContain('原生输出不包含实际耗时。'); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('tree/table/raw切换读取同一原回包，原网格列行不复制不推断类型，零请求', async () => {
    const f = await mount(); await click(text.tableLabel); const grid = grids.calls.at(-1); expect(grid.columns).toBe(f.outcome.results[0].columns); expect(grid.rows).toBe(f.outcome.results[0].rows); expect(grid.binaryFileActions).toBe(false); for (const action of ['onSortChange', 'onFilterCell', 'onSelectionChange', 'onStatistics']) expect(grid[action]).toBeUndefined();
    await click(text.rawLabel); expect(document.querySelector('[aria-label="' + text.rawContent + '"]')!.textContent).toBe(f.outcome.sqliteExplain!.raw); await click(text.treeLabel); expect(tree()).toHaveLength(4); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('初始table严格沿后端指示；不完整树保留警告和原始表格', async () => {
    const value = fixture(); value.sqliteExplain!.initialView = 'table'; value.sqliteExplain!.nodes = []; value.sqliteExplain!.warnings.push('原始结果截断，树关系未确认。'); const f = await mount(value); expect(button(text.tableLabel).getAttribute('aria-pressed')).toBe('true'); expect(grids.calls.at(-1).rows).toBe(value.results[0].rows); await click(text.treeLabel); expect(tree()).toHaveLength(0); expect(document.body.textContent).toContain(text.empty); expect(document.body.textContent).toContain('原始结果截断，树关系未确认。'); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('键盘折叠/展开与父子移动，选择和焦点停留真实可见节点', async () => {
    const f = await mount(); await key(tree()[0], 'ArrowRight'); expect(selected()!.textContent).toContain('SEARCH'); await key(selected()!, 'ArrowRight'); expect(selected()!.textContent).toContain('不得运行'); await key(selected()!, 'ArrowLeft'); expect(selected()!.textContent).toContain('SEARCH'); await key(selected()!, 'ArrowLeft'); expect(tree()).toHaveLength(3); expect(selected()!.getAttribute('aria-expanded')).toBe('false'); await key(selected()!, 'Enter'); expect(tree()).toHaveLength(4); await key(selected()!, 'End'); expect(selected()!.textContent).toContain('TEMP B-TREE'); expect(document.activeElement).toBe(selected()); await click(text.collapse); expect(tree()).toHaveLength(1); await click(text.expand); expect(tree()).toHaveLength(4); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('新outcome及A→B→A重置本地状态，旧节点和切换回调不能操作后继计划', async () => {
    const f = await mount(), oldCollapse = callback(button(text.collapse)), oldNode = callback(tree()[1]); await click(text.collapse); const next = fixture(); next.sqliteExplain!.nodes[0].detail = '新计划'; await f.render(next); await f.render(f.outcome); expect(tree()).toHaveLength(4); await act(async () => { oldCollapse(); oldNode(); }); expect(tree()).toHaveLength(4); expect(selected()!.textContent).toContain('根计划'); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('旧原文/表格按钮在render代次变更后不能复用，来源拒绝也禁本地旧动作', async () => {
    const f = await mount(), oldRaw = callback(button(text.rawLabel)); await click(text.tableLabel); await act(async () => oldRaw()); expect(button(text.tableLabel).getAttribute('aria-pressed')).toBe('true'); await f.allowed(false); await act(async () => callback(button(text.treeLabel))()); expect(button(text.tableLabel).getAttribute('aria-pressed')).toBe('true'); expect(grids.calls.at(-1).isCurrent()).toBe(false); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('300节点及64深度仍用扁平有界DOM；超界不截成另一棵完整树', async () => {
    const value = fixture(); value.sqliteExplain!.nodes = Array.from({ length: sqliteExplainLimits.nodes }, (_, index) => ({ id: String(index), depth: index < sqliteExplainLimits.depth ? index : 0, ...(index > 0 && index < sqliteExplainLimits.depth ? { parent: String(index - 1) } : {}), auxiliary: '0', detail: '节点 ' + index })); const f = await mount(value); expect(tree()).toHaveLength(300); expect(tree()[63].getAttribute('aria-level')).toBe('64'); const oversized = fixture(); oversized.sqliteExplain!.nodes = [...value.sqliteExplain!.nodes, { id: 'extra', depth: 0, auxiliary: '0', detail: '超界' }]; await f.render(oversized); await click(text.treeLabel); expect(tree()).toHaveLength(0); expect(document.body.textContent).toContain(text.bounds);
    const tooDeep = fixture(); tooDeep.sqliteExplain!.nodes[0].depth = sqliteExplainLimits.depth; await f.render(tooDeep); await click(text.treeLabel); expect(tree()).toHaveLength(0); expect(document.body.textContent).toContain(text.bounds); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('原文截断警告不冒充完整结果，保存类busy仍保相同计划与本地阅读状态', async () => {
    const value = fixture(); value.sqliteExplain!.rawTruncated = true; const f = await mount(value); await click(text.rawLabel); await f.render(value, true); expect(button(text.rawLabel).getAttribute('aria-pressed')).toBe('true'); expect(document.body.textContent).toContain(text.truncated); await click(text.tableLabel); expect(grids.calls.at(-1).isCurrent()).toBe(false); expect(f.invoke).not.toHaveBeenCalled();
  });
});
