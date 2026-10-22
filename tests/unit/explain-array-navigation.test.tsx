import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { QueryOutcome } from '../../src/shared/contracts';
import { parseExplainPlan } from '../../src/shared/explain';
import { explainZh as text } from '../../src/renderer/locales/explain.zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

// 仅隔离结果网格，计划解析、React 提交和导航均使用实际代码。
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: () => null }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let View: typeof import('../../src/renderer/components/ExplainPlanView')['ExplainPlanView'];
type Node = ReturnType<typeof memoryDocument>['body'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const scroll = vi.fn();
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name); (node as any).scrollIntoView = scroll; const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client')); ({ ExplainPlanView: View } = await import('../../src/renderer/components/ExplainPlanView'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; vi.clearAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 手写优化器形状保留包装字段及子查询块边界，不用另一个解析器伪造期望节点。 */
function fixture(): QueryOutcome {
  const raw = JSON.stringify({ query_block: { union_result: { query_specifications: [
    { dependent: false, cacheable: true, query_block: { select_id: 1, dependent: true, cacheable: false, table: { table_name: '分支甲', rows: 2 } } },
    { dependent: true, cacheable: false, query_block: { select_id: 2, dependent: false, cacheable: true, table: { table_name: '分支乙', rows: 3 } } },
  ] } } });
  return { elapsedMs: 1, results: [], explain: parseExplainPlan(raw, 'mariadb', '11.4') };
}
async function mount(outcome = fixture()) {
  const onText = vi.fn(), invoke = vi.fn(() => { throw Error('本地计划阅读不得调用 IPC'); }); (window as any).dbark = { invoke };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const render = async (next = outcome) => { await act(async () => root!.render(<View outcome={next} busy={false} onText={onText}/>)); };
  await render(); return { outcome, onText, invoke, render };
}
function tree() { return document.querySelectorAll('[role="treeitem"]'); }
function selected() { return tree().find(node => node.getAttribute('aria-selected') === 'true'); }
function button(label: string) { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
function input() { return document.querySelector(`input[aria-label="${text.find}"]`)!; }
function count() { return document.querySelector(`[aria-label="${text.findCount}"]`)!.textContent; }
function detail() { return document.querySelector(`[aria-label="${text.details}"]`)!; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function search(value: string) { await act(async () => { input().value = value; input().dispatchEvent(new MemoryEvent('input')); }); }
async function select(node: Node) { await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
/** 保留真实旧回调，只验证卸载代不能继续修改新结果。 */
function props(node: Node) { return (node as any)[Object.keys(node).find(key => key.startsWith('__reactProps$'))!]; }

it('两个多字段查询包装使用数组位置标题，容器与子查询块保持独立', async () => {
  const f = await mount();
  for (const title of ['查询分支 · 第 1 项', '查询分支 · 第 2 项']) expect(tree().filter(node => node.textContent.includes(title))).toHaveLength(1);
  expect(tree().some(node => node.textContent.includes('查询分支列表'))).toBe(true);
  expect(tree().filter(node => node.textContent.includes('查询块'))).toHaveLength(3);
  expect(document.body.textContent).not.toContain(text.unknown); expect(f.invoke).not.toHaveBeenCalled();
});

it('完整人读标题匹配收起分支，展开祖先并聚焦真实包装节点', async () => {
  const f = await mount(); await click(text.collapse); expect(tree()).toHaveLength(1);
  await search('查询分支 · 第 2 项'); expect(count()).toBe(text.matches(0, 1)); await click(text.next);
  expect(selected()!.textContent).toContain('查询分支 · 第 2 项'); expect(document.activeElement).toBe(selected());
  expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' }); expect(detail().querySelector('strong')!.textContent).toBe('查询分支 · 第 2 项 ');
  expect(detail().textContent).toContain('/query_block/union_result/query_specifications/1');
  expect(tree().some(node => node.textContent.includes('分支乙'))).toBe(false); expect(f.onText).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled();
});

it('包装布尔属性、子块属性和原始详情不相互合并，数字 kind 仍可查找', async () => {
  const f = await mount(); await search('查询分支 · 第 1 项'); await click(text.next);
  const wrapper = f.outcome.explain!.nodes.find(node => node.path === '/query_block/union_result/query_specifications/0')!;
  expect(wrapper.kind).toBe('0'); expect(wrapper.unknown).toBe(false); expect(wrapper.properties).toEqual([{ source: 'dependent', value: 'false' }, { source: 'cacheable', value: 'true' }]);
  expect(JSON.parse(detail().querySelector('pre')!.textContent)).toMatchObject({ dependent: false, cacheable: true, query_block: { select_id: '1', dependent: true, cacheable: false } });
  const child = f.outcome.explain!.nodes.find(node => node.path === wrapper.path + '/query_block')!;
  expect(child.properties).toEqual([{ source: 'dependent', value: 'true' }, { source: 'cacheable', value: 'false' }]);
  await select(tree().find(node => node.textContent.includes('查询块 · 1'))!); expect(detail().textContent).toContain(wrapper.path + '/query_block');
  expect(JSON.parse(detail().querySelector('pre')!.textContent)).not.toHaveProperty('query_block');
  await search('0'); expect(count()).toBe(text.matches(0, 1)); await click(text.next); expect(selected()!.textContent).toContain('查询分支 · 第 1 项');
});

it.each(['subqueries', 'attached_subqueries', 'optimized_away_subqueries', 'having_subqueries', 'select_list_subqueries'])('%s 白名单包装以子查询项标题显示而不改原名称', async container => {
  const raw = JSON.stringify({ query_block: { [container]: [{ dependent: false, cacheable: true, table_name: '包装名', query_block: { select_id: 2 } }] } });
  const outcome: QueryOutcome = { elapsedMs: 1, results: [], explain: parseExplainPlan(raw, 'mysql', '8.4') };
  await mount(outcome); await search('子查询项 · 第 1 项'); expect(count()).toBe(text.matches(0, 1)); await click(text.next);
  expect(selected()!.textContent).toContain('子查询项 · 第 1 项 · 包装名'); expect(detail().querySelector('strong')!.textContent).toBe('子查询项 · 第 1 项 包装名');
});

it('未知扩展保留未知警告，伪造或继承的条目元数据保持原 kind', async () => {
  const outcome: QueryOutcome = { elapsedMs: 1, results: [], explain: parseExplainPlan('{"query_block":{"vendor_extensions":[{"dependent":false,"query_block":{"select_id":9}}]}}', 'mysql', '8.4') };
  const node = outcome.explain!.nodes.find(item => item.kind === '0')!; const read = vi.fn(() => 'query_specifications');
  const invalid = [Object.create({ container: 'query_specifications', index: 0 }), { container: 'vendor_extensions', index: 0 }, { container: 'query_specifications', index: -1 }, { container: 'query_specifications', index: 1.5 }, { container: 'query_specifications', index: Number.MAX_SAFE_INTEGER + 1 }, Object.defineProperty({ index: 0 }, 'container', { get: read }), Object.defineProperty({ container: 'query_specifications' }, 'index', { get: read })];
  for (const entry of invalid) {
    Object.defineProperty(node, 'arrayEntry', { value: entry, configurable: true }); const f = await mount(outcome);
    expect(tree().find(item => item.textContent.includes('未知节点') && item.textContent.includes('0'))).toBeDefined(); expect(document.body.textContent).not.toContain('查询分支 · 第');
    expect(outcome.explain!.warnings.some(warning => warning.includes('未知'))).toBe(true); expect(f.invoke).not.toHaveBeenCalled();
    await act(async () => root!.unmount()); root = undefined; document.body.textContent = '';
  }
  expect(read).not.toHaveBeenCalled();
});

it('合法标题元数据不替解析器清除未知状态或警告', async () => {
  const outcome: QueryOutcome = { elapsedMs: 1, results: [], explain: parseExplainPlan('{"query_block":{"vendor_extensions":[{"dependent":false,"query_block":{"select_id":9}}]}}', 'mysql', '8.4') };
  const node = outcome.explain!.nodes.find(item => item.kind === '0')!;
  Object.defineProperty(node, 'arrayEntry', { value: { container: 'query_specifications', index: 0 } });
  await mount(outcome); await search('查询分支 · 第 1 项'); await click(text.next);
  expect(selected()!.textContent).toContain(text.unknown); expect(node.unknown).toBe(true); expect(outcome.explain!.warnings.some(warning => warning.includes('未知'))).toBe(true);
});

it('结果换代使旧完整标题查找和文本回调失效，仍保留 200 字限制', async () => {
  const f = await mount(); await search('查询分支 · 第 2 项'); const oldNext = props(button(text.next)).onClick, oldInput = props(input()).onInput, oldText = props(button(text.text)).onClick;
  const replacement = fixture(); await f.render(replacement); await f.render(f.outcome);
  await act(async () => { oldNext(); oldInput({ currentTarget: { value: '查询分支 · 第 2 项' } }); oldText(); });
  expect(input().value).toBe(''); expect(selected()).toBe(tree()[0]); expect(f.onText).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled();
  await search('查询分支 · 第 1 项'); await search('长'.repeat(201)); expect(input().value).toBe('查询分支 · 第 1 项'); expect(input().getAttribute('maxlength')).toBe('200'); expect(document.querySelector('[role="alert"]')!.textContent).toBe(text.findTooLong);
});
