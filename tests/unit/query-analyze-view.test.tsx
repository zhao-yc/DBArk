import { act, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { QueryAnalyzePlan } from '../../src/shared/queryAnalyze';
import { QueryAnalyzeView } from '../../src/renderer/components/QueryAnalyzeView';
import { QueryAnalyzeConfirmDialog } from '../../src/renderer/components/QueryAnalyzeConfirmDialog';
import { queryAnalyzeZh as t } from '../../src/renderer/locales/queryAnalyze.zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

// 只隔离与确认授权无关的 Monaco；真实 React 组件、Modal 和事件委派保持运行。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly?: boolean }) => <pre aria-label="冻结 SQL 编辑器" data-read-only={String(readOnly)}>{value}</pre> }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const scroll = vi.fn();
type Node = ReturnType<typeof memoryDocument>['body'];
beforeAll(async () => {
  document = memoryDocument();
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name); (node as any).scrollIntoView = scroll;
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; vi.clearAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 构造已返回的服务端文本，不用浮点数造指标，也不发送查询。 */
function fixture(): QueryAnalyzePlan {
  return { dialect: 'mysql', version: '8.4.11', format: 'tree', raw: '原始服务器计划 <script>保持文字</script>', rawTruncated: false, warnings: [], nodes: [
    { id: 'root', depth: 0, label: 'Filter <img src=x onerror=alert(1)>', metrics: [
      { source: 'cost', value: '9007199254740993.000000000000000001', kind: 'estimate', unit: 'cost' },
      { source: 'actual.last_row_time_ms', value: '0.000000000000000001', kind: 'actual', unit: 'ms' },
    ] },
    { id: 'branch', parent: 'root', depth: 1, label: 'Nested loop', metrics: [{ source: 'actual.loops', value: '9007199254740993', kind: 'actual', unit: 'loops' }] },
    { id: 'leaf', parent: 'branch', depth: 2, label: 'Table scan', metrics: [] },
    { id: 'last', parent: 'root', depth: 1, label: '__proto__ future operation', path: '/__proto__/unknown', neverExecuted: true, metrics: [{ source: 'unknown_source', value: '0', kind: 'actual' }] },
  ] };
}
async function mount(element: ReactNode) {
  const invoke = vi.fn(() => { throw Error('阅读和确认框不得调用 IPC'); }); (window as any).dbark = { invoke };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const render = async (next: ReactNode) => { await act(async () => root!.render(next)); };
  await render(element); return { invoke, render };
}
function button(label: string) { const value = document.querySelectorAll('button').find(node => node.textContent === label); expect(value, label).toBeDefined(); return value!; }
async function click(label: string) { await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
function tree() { return document.querySelectorAll('[role="treeitem"]'); }
function selected() { return tree().find(node => node.getAttribute('aria-selected') === 'true'); }
function props(node: Node) { return (node as any)[Object.keys(node).find(key => key.startsWith('__reactProps$'))!]; }
async function key(node: Node, value: string) { const event = Object.assign(new MemoryEvent('keydown'), { key: value }); await act(async () => node.dispatchEvent(event)); return event; }
async function acknowledge() { const node = document.querySelectorAll('input').find(item => item.type === 'checkbox')!; expect(node).toBeDefined(); await act(async () => { node.checked = true; node.dispatchEvent(new MemoryEvent('click')); }); }

it('实测和估算指标分别展示，保留极小小数和大整数文本，服务器标签仅作为文字', async () => {
  const f = await mount(<QueryAnalyzeView plan={fixture()}/>);
  const detail = document.querySelector(`[aria-label="${t.details}"]`)!;
  expect(detail.textContent).toContain(t.actual); expect(detail.textContent).toContain(t.estimate);
  expect(detail.textContent).toContain('9007199254740993.000000000000000001');
  expect(detail.textContent).toContain('0.000000000000000001 毫秒');
  expect(detail.textContent).toContain('actual.last_row_time_ms'); expect(document.body.textContent).toContain(t.mysqlHint);
  expect(document.body.textContent).toContain(t.estimateHint); expect(document.querySelectorAll('img')).toHaveLength(0);
  expect(document.querySelectorAll('script')).toHaveLength(0); expect(f.invoke).not.toHaveBeenCalled();
});

it('节点选择、收起展开及键盘移动只改变本地阅读状态，未知和未执行节点仍能查看', async () => {
  const f = await mount(<QueryAnalyzeView plan={fixture()}/>);
  await key(tree()[0], 'ArrowDown'); expect(selected()!.getAttribute('data-node-id')).toBe('branch');
  await key(selected()!, 'ArrowLeft'); expect(tree()).toHaveLength(3);
  await key(selected()!, 'ArrowRight'); expect(tree()).toHaveLength(4);
  await key(selected()!, 'ArrowRight'); expect(selected()!.getAttribute('data-node-id')).toBe('leaf');
  await key(selected()!, 'End'); expect(selected()!.getAttribute('data-node-id')).toBe('last');
  const detail = document.querySelector(`[aria-label="${t.details}"]`)!;
  expect(detail.textContent).toContain(t.neverExecuted); expect(detail.textContent).toContain('unknown_source'); expect(detail.textContent).toContain('/__proto__/unknown');
  await click(t.collapse); expect(tree()).toHaveLength(1); await click(t.expand); expect(tree()).toHaveLength(4);
  expect(scroll).toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled();
});

it('原文切换不重新执行，截断警告和解析失败警告始终保留', async () => {
  const plan = fixture(); plan.rawTruncated = true; plan.warnings = ['未知节点保留原始输出'];
  const f = await mount(<QueryAnalyzeView plan={plan}/>); await click(t.raw);
  expect(document.querySelector(`pre[aria-label="${t.raw}"]`)!.textContent).toBe(plan.raw);
  expect(document.querySelector('[role="alert"]')!.textContent).toBe(t.truncated);
  expect(document.body.textContent).toContain(plan.warnings[0]); await click(t.tree);
  expect(document.querySelector('[role="alert"]')!.textContent).toBe(t.truncated); expect(f.invoke).not.toHaveBeenCalled();
  const empty = { ...plan, nodes: [], raw: '' }; await f.render(<QueryAnalyzeView plan={empty}/>);
  expect(document.body.textContent).toContain(t.rawMissing); await click(t.tree); expect(document.body.textContent).toContain(t.empty);
});

it('MariaDB 的包含关系和累计耗时语义独立说明，缺失指标不补成零', async () => {
  const plan = fixture(); plan.dialect = 'mariadb'; plan.format = 'json'; plan.version = '11.4.13';
  plan.nodes = [{ id: 'maria', depth: 0, label: 'query_block', metrics: [{ source: 'r_total_time_ms', kind: 'actual', unit: 'ms', value: '1.234567890123456789' }] }];
  await mount(<QueryAnalyzeView plan={plan}/>);
  const detail = document.querySelector(`[aria-label="${t.details}"]`)!;
  expect(document.body.textContent).toContain(t.mariaHint); expect(detail.textContent).toContain(t.unavailable);
  expect(detail.textContent).toContain('1.234567890123456789 毫秒'); expect(detail.textContent).not.toContain('0 成本');
});

it('结果 A→B→A 重新初始化阅读状态，旧折叠及原文回调不操作新结果', async () => {
  const plan = fixture(), f = await mount(<QueryAnalyzeView plan={plan}/>);
  const oldCollapse = props(button(t.collapse)).onClick, oldRaw = props(button(t.raw)).onClick;
  await click(t.collapse); expect(tree()).toHaveLength(1);
  await f.render(<QueryAnalyzeView plan={{ ...fixture(), raw: '新计划' }}/>); await f.render(<QueryAnalyzeView plan={plan}/>);
  await act(async () => { oldCollapse(); oldRaw(); }); expect(tree()).toHaveLength(4);
  expect(button(t.tree).getAttribute('aria-pressed')).toBe('true'); expect(f.invoke).not.toHaveBeenCalled();
});

it('确认框完整显示冻结语句和目标；未勾选不执行，明确勾选后也只能确认一次', async () => {
  const onConfirm = vi.fn(), onClose = vi.fn(), source = 'UPDATE accounts SET amount=9007199254740993; -- 用户原文';
  const f = await mount(<QueryAnalyzeConfirmDialog source={source} connectionName="测试连接" databaseLabel="test_db" onConfirm={onConfirm} onClose={onClose}/>);
  expect(document.body.textContent).toContain('测试连接'); expect(document.body.textContent).toContain('test_db'); expect(document.body.textContent).toContain(t.risk);
  const editor = document.querySelector('pre[aria-label="冻结 SQL 编辑器"]')!; expect(editor.textContent).toBe(source); expect(editor.getAttribute('data-read-only')).toBe('true');
  expect(button(t.confirm).disabled).toBe(true); await click(t.confirm); expect(onConfirm).not.toHaveBeenCalled();
  await acknowledge(); expect(button(t.confirm).disabled).toBe(false); const staleConfirm = props(button(t.confirm)).onClick;
  await click(t.confirm); await act(async () => staleConfirm()); expect(onConfirm).toHaveBeenCalledTimes(1); expect(onClose).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled();
});

it('取消和卸载撤销旧确认，后续新确认不继承已勾选状态', async () => {
  const onConfirm = vi.fn(), onClose = vi.fn();
  const element = <QueryAnalyzeConfirmDialog source="SELECT 1" connectionName="连接" databaseLabel="库" onConfirm={onConfirm} onClose={onClose}/>;
  const f = await mount(element); await acknowledge(); const staleConfirm = props(button(t.confirm)).onClick;
  await click(t.cancel); await act(async () => staleConfirm()); expect(onClose).toHaveBeenCalledTimes(1); expect(onConfirm).not.toHaveBeenCalled();
  await f.render(null); await f.render(element); expect(button(t.confirm).disabled).toBe(true);
  await act(async () => staleConfirm()); expect(onConfirm).not.toHaveBeenCalled();
});

it.each(['reason', 'source', 'connection', 'database'] as const)('来源 %s 变化后永久失效，恢复原值也不能复用旧勾选', async kind => {
  const onConfirm = vi.fn(), onClose = vi.fn();
  const original = { source: 'SELECT 1', connectionName: '连接', databaseLabel: '库', onConfirm, onClose };
  const f = await mount(<QueryAnalyzeConfirmDialog {...original}/>); await acknowledge();
  const staleConfirm = props(button(t.confirm)).onClick;
  const changed = { ...original, ...(kind === 'reason' ? { invalidReason: '原会话已失效' } : kind === 'source' ? { source: 'SELECT 2' } : kind === 'connection' ? { connectionName: '另一连接' } : { databaseLabel: '另一个库' }) };
  await f.render(<QueryAnalyzeConfirmDialog {...changed}/>); expect(button(t.confirm).disabled).toBe(true);
  await f.render(<QueryAnalyzeConfirmDialog {...original}/>); expect(button(t.confirm).disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')!.textContent).toBe(t.changed);
  await act(async () => staleConfirm()); expect(onConfirm).not.toHaveBeenCalled(); await click(t.cancel); expect(onClose).toHaveBeenCalledTimes(1);
});
