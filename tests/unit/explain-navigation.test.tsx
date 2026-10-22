import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { QueryOutcome } from '../../src/shared/contracts';
import type { ExplainNode } from '../../src/shared/explain';
import { explainZh as text } from '../../src/renderer/locales/explain.zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

// 只隔离与计划导航无关的网格；实际计划组件、React生命周期及事件委派保持运行。
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

/** 固定有界计划由公共契约输入，不调用SQL，也不以另一个导航控制器替代真实组件。 */
function fixture(): QueryOutcome {
  const node = (id: string, parent?: string, extra: Partial<ExplainNode> = {}): ExplainNode => ({ id, parent, depth: parent ? parent === 'root' ? 1 : 2 : 0, path: '', kind: parent ? 'table' : 'plan', unknown: false, costs: [], ...extra });
  return { elapsedMs: 1, results: [], explain: { dialect: 'mysql', version: '8.4', format: 'json', raw: '{}', rawTruncated: false, warnings: [], nodes: [node('root'), node('branch', 'root', { kind: 'nested_loop', name: '分支' }), node('first', 'branch', { name: '匹配甲', access: 'ref', index: 'idx_shared', rows: { source: 'rows_examined_per_scan', value: '9007199254740993' }, properties: [{ source: 'attached_condition', value: '用户条件甲' }] }), node('last', 'root', { name: '匹配乙', index: 'idx_shared', costs: [{ source: 'cost_info.read_cost', value: '0.0000000000000001' }], properties: [{ source: 'used_columns', value: '["用户条件乙"]' }] })] } };
}
async function mount(outcome = fixture(), busy = false) {
  const onText = vi.fn(), invoke = vi.fn(() => { throw Error('本地计划阅读不得调用IPC'); }); (window as any).dbark = { invoke };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const render = async (next = outcome, nextBusy = busy) => { await act(async () => root!.render(<View outcome={next} busy={nextBusy} onText={onText}/>)); };
  await render(); return { outcome, onText, invoke, render };
}
function button(label: string) { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
function tree() { return document.querySelectorAll('[role="treeitem"]'); }
function selected() { return tree().find(node => node.getAttribute('aria-selected') === 'true'); }
function input() { return document.querySelector(`input[aria-label="${text.find}"]`)!; }
function count() { return document.querySelector(`[aria-label="${text.findCount}"]`)!.textContent; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function search(value: string) { await act(async () => { input().value = value; input().dispatchEvent(new MemoryEvent('input')); }); }
async function key(node: Node, value: string, shiftKey = false) { const event = Object.assign(new MemoryEvent('keydown'), { key: value, shiftKey }); await act(async () => node.dispatchEvent(event)); return event; }
/** 仅用于保存真实旧回调后跨结果触发，验证闭包失效；不另造查找逻辑。 */
function props(node: Node) { return (node as any)[Object.keys(node).find(key => key.startsWith('__reactProps$'))!]; }

it('搜索完整节点集，收起命中后仅展开祖先并选中、聚焦、请求滚动', async () => {
  const f = await mount(); await click(text.collapse); expect(tree()).toHaveLength(1); await search('用户条件甲'); expect(count()).toBe(text.matches(0, 1)); await click(text.next);
  expect(tree()).toHaveLength(4); expect(selected()!.textContent).toContain('匹配甲'); expect(document.activeElement).toBe(selected()); expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' }); expect(count()).toBe(text.matches(1, 1)); expect(f.onText).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled();
});

it('前后查找按节点而非文本出现次数计数，首尾环绕且Enter/Shift+Enter等价', async () => {
  await mount(); await search('匹配'); await click(text.previous); expect(selected()!.textContent).toContain('匹配乙'); expect(count()).toBe(text.matches(2, 2)); await click(text.next); expect(selected()!.textContent).toContain('匹配甲'); await key(input(), 'Enter', true); expect(selected()!.textContent).toContain('匹配乙'); await key(input(), 'Enter'); expect(selected()!.textContent).toContain('匹配甲');
});

it('空串和无匹配不更改有效选择，清空按钮及Escape仅取消查找', async () => {
  await mount(); const original = selected(); expect(button(text.next).disabled).toBe(true); await search('不存在'); expect(count()).toBe(text.matches(0, 0)); expect(button(text.previous).disabled).toBe(true); expect(selected()).toBe(original); await click(text.clear); expect(input().value).toBe(''); expect(count()).toBe(text.findIdle); await search('匹配'); await click(text.next); const chosen = selected(); const event = await key(input(), 'Escape'); expect(event.defaultPrevented).toBe(true); expect(input().value).toBe(''); expect(selected()).toBe(chosen);
});

it('中文输入组合中的Enter不触发节点跳转或取消输入法确认', async () => {
  await mount(); await search('匹配'); const original = selected(), event = Object.assign(new MemoryEvent('keydown'), { key: 'Enter', isComposing: true }); await act(async () => input().dispatchEvent(event)); expect(selected()).toBe(original); expect(count()).toBe(text.matches(0, 2)); expect(event.defaultPrevented).toBe(false);
});

it('原生输入上限200且程序超长事件明确拒绝，不发布新查找或重新扫描', async () => {
  const outcome = fixture(), read = vi.fn(() => [{ source: 'message', value: 'x'.repeat(200) }]); Object.defineProperty(outcome.explain!.nodes[3], 'properties', { get: read }); const f = await mount(outcome);
  expect(input().getAttribute('maxlength')).toBe('200'); expect(document.body.textContent).toContain(text.findHint); await search('匹配'); await click(text.next); const original = selected(), oldCount = count(), reads = read.mock.calls.length;
  await search('x'.repeat(201)); expect(input().value).toBe('匹配'); expect(input().getAttribute('aria-invalid')).toBe('true'); expect(document.querySelector('[role="alert"]')!.textContent).toBe(text.findTooLong); expect(count()).toBe(oldCount); expect(selected()).toBe(original); expect(read).toHaveBeenCalledTimes(reads);
  await search('x'.repeat(202)); expect(input().value).toBe('匹配'); expect(read).toHaveBeenCalledTimes(reads); await key(input(), 'Escape'); expect(input().value).toBe(''); expect(document.querySelector('[role="alert"]')).toBeNull(); expect(input().getAttribute('aria-invalid')).toBeNull();
  await search('x'.repeat(200)); expect(input().value).toHaveLength(200); expect(count()).toBe(text.matches(0, 1)); await click(text.next); expect(selected()!.textContent).toContain('匹配乙'); expect(f.onText).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled();
});

it.each(['TABLE', 'ref', 'idx_shared', '9007199254740993', 'cost_info.read_cost', '0.0000000000000001', 'used_columns', '附加条件'])('类型/访问/索引/精确指标/原属性字段可查找：%s', async term => {
  await mount(); await search(term); expect(button(text.next).disabled).toBe(false); await click(text.next); expect(count()).not.toBe(text.matches(0, 0));
});

it('Unicode、原型同名和正则字符始终按字面量匹配', async () => {
  const outcome = fixture(); outcome.explain!.nodes[2].name = 'constructor 用户😀 [.*]'; outcome.explain!.nodes[3].kind = '__proto__'; await mount(outcome);
  for (const term of ['constructor', '用户😀', '[.*]']) { await search(term); await click(text.next); expect(selected()!.textContent).toContain('constructor 用户😀 [.*]'); expect(count()).toBe(text.matches(1, 1)); }
  await search('__proto__'); await click(text.next); expect(selected()!.textContent).toContain('__proto__');
});

it('详情保留真实来源、原字符串及布尔文本，XSS仅显示文本并明确截断', async () => {
  const outcome = fixture(); outcome.explain!.nodes[0].properties = [{ source: 'attached_condition', value: '<img src=x onerror=alert(1)>' }, { source: 'using_filesort', value: 'false' }, { source: 'using_temporary_table', value: 'true' }, { source: '__proto__', value: '源文本…', truncated: true }]; await mount(outcome);
  const detail = document.querySelector(`[aria-label="${text.details}"]`)!; expect(detail.textContent).toContain(text.propertyLabels.attached_condition); for (const value of ['attached_condition', '<img src=x onerror=alert(1)>', 'false', 'true', '__proto__', text.propertyTruncated]) expect(detail.textContent).toContain(value); expect(detail.querySelectorAll('img')).toHaveLength(0); expect(detail.querySelectorAll('script')).toHaveLength(0);
});

it('忙碌时本地查找和阅读仍可用，只有文本计划入口继续受禁用约束', async () => {
  const f = await mount(fixture(), true); expect(button(text.text).disabled).toBe(true); await search('用户条件甲'); await click(text.next); expect(selected()!.textContent).toContain('匹配甲'); await click(text.raw); await click(text.next); expect(document.querySelector('[role="tree"]')).not.toBeNull(); expect(f.onText).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled(); await f.render(f.outcome, false); await click(text.text); expect(f.onText).toHaveBeenCalledTimes(1);
});

it('父结果A→B→A换代重置所选、收起及搜索，旧回调不能操作新代或调用文本计划', async () => {
  const f = await mount(); await search('匹配'); await click(text.next); await click(text.collapse); const staleNext = props(button(text.next)).onClick, staleInput = props(input()).onInput, staleText = props(button(text.text)).onClick;
  const replacement = fixture(); replacement.explain!.nodes[0].name = '新根'; await f.render(replacement); expect(input().value).toBe(''); expect(tree()).toHaveLength(4); expect(selected()!.textContent).toContain('新根'); await f.render(f.outcome); expect(tree()).toHaveLength(4); expect(selected()!.textContent).not.toContain('匹配甲'); await act(async () => { staleNext(); staleInput({ currentTarget: { value: '旧回调' } }); staleText(); }); expect(input().value).toBe(''); expect(selected()).toBe(tree()[0]); expect(f.onText).not.toHaveBeenCalled();
});

it('已有树键盘方向/Home/End/空格/Enter行为保持且不发查询', async () => {
  const f = await mount(); await key(tree()[0], 'ArrowDown'); expect(selected()).toBe(tree()[1]); await key(tree()[1], 'ArrowLeft'); expect(tree()).toHaveLength(3); await key(tree()[1], 'ArrowRight'); expect(tree()).toHaveLength(4); await key(tree()[1], 'ArrowRight'); expect(selected()).toBe(tree()[2]); await key(tree()[2], 'ArrowLeft'); expect(selected()).toBe(tree()[1]); await key(tree()[1], 'End'); expect(selected()).toBe(tree().at(-1)); await key(tree().at(-1)!, 'Home'); expect(selected()).toBe(tree()[0]); await key(tree()[0], ' '); await key(tree()[0], 'Enter'); expect(selected()).toBe(tree()[0]); expect(f.onText).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled();
});
