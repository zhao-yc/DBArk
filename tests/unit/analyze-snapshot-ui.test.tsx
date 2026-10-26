import { act, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { QueryOutcome } from '../../src/shared/contracts';
import { parseExplainPlan } from '../../src/shared/explain';
import { parseQueryAnalyzePlan } from '../../src/shared/queryAnalyze';
import { captureExplainSnapshot, capturePlanSnapshot, encodePlanSnapshot, explainSnapshotLimits, planSnapshotOutcome, type AnalyzeSnapshotDocument, type PlanSnapshotDocument } from '../../src/shared/explainSnapshot';
import { explainSnapshotZh as text } from '../../src/shared/explainSnapshot.zh-CN';
import { queryAnalyzeZh as analysisText } from '../../src/renderer/locales/queryAnalyze.zh-CN';
import { explainZh as explainText } from '../../src/renderer/locales/explain.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

// 只隔离文件交互之外的结果网格；真实计划、快照codec、Modal及React事件委派均运行。
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: () => null }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/ExplainSnapshotDialog')['ExplainSnapshotDialog'];
let View: typeof import('../../src/renderer/components/QueryAnalyzeView')['QueryAnalyzeView'];
let Save: typeof import('../../src/renderer/components/ExplainSnapshotSaveButton')['ExplainSnapshotSaveButton'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const bridge = vi.fn();
type Node = ReturnType<typeof memoryDocument>['body'];
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name); (node as any).scrollIntoView = vi.fn();
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  ({ createRoot } = await import('react-dom/client'));
  ({ ExplainSnapshotDialog: Dialog } = await import('../../src/renderer/components/ExplainSnapshotDialog'));
  ({ QueryAnalyzeView: View } = await import('../../src/renderer/components/QueryAnalyzeView'));
  ({ ExplainSnapshotSaveButton: Save } = await import('../../src/renderer/components/ExplainSnapshotSaveButton'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; bridge.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 使用正式解析器还原服务器形状，包含精确指标及允许出现在计划内的业务字面值。 */
function fixture(name = 'customer'): QueryOutcome {
  const raw = `-> Nested loop inner join (cost=9007199254740993 rows=2) (actual time=0.000000000000000001..2.000000000000000001 rows=2 loops=1)\n    -> Filter: (${name}.note = '计划内业务字面值') (cost=10 rows=2) (actual time=0.001..0.002 rows=2 loops=1)\n        -> Table scan on ${name} (cost=12 rows=3) (actual time=0.0001..0.0002 rows=3 loops=1)\n    -> Index lookup on orders (cost=2 rows=1) (actual time=0.000000000000000002..0.000000000000000003 rows=1 loops=2)`;
  return { elapsedMs: 5, analysis: parseQueryAnalyzePlan(raw, 'mysql', '8.4.11', 'tree'), results: [{ columns: [{ key: 'plan', name: 'EXPLAIN', type: 'VAR_STRING' }], rows: [{ plan: raw }], elapsedMs: 5, statement: "EXPLAIN ANALYZE SELECT '仅原SQL字段不应入快照' FROM customer", truncated: false }] };
}
function actualDocument(outcome = fixture()): AnalyzeSnapshotDocument {
  const document = capturePlanSnapshot(outcome); if (document.kind !== 'dbark.analyze-snapshot') throw Error('夹具不是实际分析快照'); return document;
}
function estimated(): QueryOutcome {
  const raw = '{"query_block":{"table":{"table_name":"legacy_table","access_type":"ALL","rows_examined_per_scan":9007199254740993}}}';
  return { elapsedMs: 1, explain: parseExplainPlan(raw, 'mysql', '5.7.44'), results: [{ columns: [{ key: 'EXPLAIN', name: 'EXPLAIN', type: 'JSON' }], rows: [{ EXPLAIN: raw }], elapsedMs: 1, statement: 'EXPLAIN SELECT 仅旧SQL字段', truncated: false }] };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function mount(element: ReactNode) { (window as any).dbark = { invoke: bridge }; const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await render(element); }
async function render(element: ReactNode) { await act(async () => root!.render(element)); }
function button(label: string) { const node = document.querySelectorAll('button').find(item => item.textContent === label || item.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
function props(node: Node) { return (node as any)[Object.keys(node).find(key => key.startsWith('__reactProps$'))!]; }
async function key(node: Node, value: string) { await act(async () => node.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: value }))); }
function selected() { return document.querySelectorAll('[role="treeitem"]').find(node => node.getAttribute('aria-selected') === 'true'); }

it('实际计划显式保存原精度和计划条件，不主动保存原SQL字段，忙碌及回执不重置阅读', async () => {
  const outcome = fixture(), pending = deferred<{ name: string } | null>(), onBusy = vi.fn();
  await mount(<View plan={outcome.analysis!} outcome={outcome} fileActions onFileBusyChange={onBusy}/>); expect(bridge).not.toHaveBeenCalled();
  const nodes = document.querySelectorAll('[role="treeitem"]'); expect(nodes).toHaveLength(4);
  await key(nodes[0], 'ArrowDown'); await key(selected()!, 'ArrowLeft'); await key(selected()!, 'ArrowDown');
  const chosen = selected()!.getAttribute('data-node-id'); expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
  await click(analysisText.raw); bridge.mockReturnValueOnce(pending.promise); await click(text.save);
  expect(bridge).toHaveBeenCalledTimes(1); expect(bridge.mock.calls[0]).toEqual(['explainFiles.save', { snapshot: actualDocument(outcome) }]);
  const payload = JSON.stringify(bridge.mock.calls[0][1]); expect(payload).toContain('9007199254740993'); expect(payload).toContain('0.000000000000000001'); expect(payload).toContain('计划内业务字面值'); expect(payload).not.toContain('仅原SQL字段不应入快照');
  await render(<View plan={outcome.analysis!} outcome={outcome} fileActions busy onFileBusyChange={onBusy}/>); expect(button(text.saving).disabled).toBe(true);
  await act(async () => pending.resolve({ name: '实测.dbark-plan.json' })); expect(document.body.textContent).toContain(text.saved('实测.dbark-plan.json')); expect(onBusy.mock.calls).toEqual([[true], [false]]);
  await render(<View plan={outcome.analysis!} outcome={outcome} fileActions busy={false} onFileBusyChange={onBusy}/>);
  expect(button(analysisText.raw).getAttribute('aria-pressed')).toBe('true'); expect(document.querySelector(`pre[aria-label="${analysisText.raw}"]`)!.textContent).toBe(outcome.analysis!.raw);
  await click(analysisText.tree); expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(3); expect(selected()!.getAttribute('data-node-id')).toBe(chosen); expect(bridge).toHaveBeenCalledTimes(1);
});

it('实际快照保存取消不报成功，未知写入失败原样提示且不重试或抹掉原文', async () => {
  const outcome = fixture(); await mount(<View plan={outcome.analysis!} outcome={outcome} fileActions/>); await click(analysisText.raw);
  const raw = document.querySelector(`pre[aria-label="${analysisText.raw}"]`); bridge.mockResolvedValueOnce(null); await click(text.save);
  expect(document.body.textContent).not.toContain('计划快照已保存：'); expect(document.querySelector(`pre[aria-label="${analysisText.raw}"]`)).toBe(raw);
  bridge.mockRejectedValueOnce(Error(text.unknownWrite)); await click(text.save);
  expect(document.querySelector('[role="alert"]')!.textContent).toBe(text.unknownWrite); expect(button(text.save).disabled).toBe(false); expect(bridge).toHaveBeenCalledTimes(2); expect(document.querySelector(`pre[aria-label="${analysisText.raw}"]`)).toBe(raw);
});

it('通用保存按钮保留同步占有及A→B→A回执保护，旧点击不能绕过busy', async () => {
  const a = fixture('A'), b = fixture('B'), pending = deferred<{ name: string } | null>();
  await mount(<Save outcome={a} busy={false}/>); const old = props(button(text.save)).onClick;
  await render(<Save outcome={a} busy/>); await act(async () => old()); expect(bridge).not.toHaveBeenCalled();
  await render(<Save outcome={a} busy={false}/>); bridge.mockReturnValueOnce(pending.promise); const save = props(button(text.save)).onClick;
  await act(async () => { save(); save(); }); expect(bridge).toHaveBeenCalledTimes(1);
  await render(<Save outcome={b} busy={false}/>); await render(<Save outcome={a} busy={false}/>); expect(button(text.saving).disabled).toBe(true);
  await act(async () => pending.resolve({ name: '过期旧文件' })); expect(document.body.textContent).not.toContain('过期旧文件'); expect(button(text.save).disabled).toBe(false);
  await act(async () => old()); expect(bridge).toHaveBeenCalledTimes(1);
});

it('实际计划缺少对应结果时禁保存，默认纯阅读不增加任何文件或数据库调用', async () => {
  const a = fixture(), b = fixture('另一个计划'); await mount(<View plan={a.analysis!}/>);
  expect(document.body.textContent).not.toContain(text.save); expect(bridge).not.toHaveBeenCalled();
  await render(<View plan={a.analysis!} outcome={b} fileActions/>); expect(button(text.save).disabled).toBe(true); expect(button(text.save).getAttribute('title')).toBe(text.unavailable);
  await click(text.save); expect(bridge).not.toHaveBeenCalled();
});

it('离线打开实际快照明确历史实测语义，取消和坏文件保留原文件名、原文及阅读状态', async () => {
  await mount(<Dialog onClose={vi.fn()}/>); expect(bridge).not.toHaveBeenCalled();
  const snapshot = actualDocument(); bridge.mockResolvedValueOnce({ name: '原实测文件', snapshot }); await click(text.choose); expect(document.body.textContent).toContain(text.notice); expect(document.body.textContent).toContain(text.actual);
  expect(document.querySelector(`[aria-label="${analysisText.view}"]`)).not.toBeNull(); expect(document.querySelector(`[aria-label="${explainText.title}"]`)).toBeNull();
  const buttons = document.querySelectorAll('button').map(node => node.textContent); expect(buttons).not.toContain(analysisText.open); expect(buttons).not.toContain(analysisText.confirm); expect(buttons).not.toContain(explainText.text);
  await click(analysisText.raw); const raw = document.querySelector(`pre[aria-label="${analysisText.raw}"]`); bridge.mockResolvedValueOnce(null); await click(text.choose); expect(document.querySelector(`pre[aria-label="${analysisText.raw}"]`)).toBe(raw);
  bridge.mockResolvedValueOnce({ name: '坏新文件', snapshot: { kind: 'dbark.analyze-snapshot', version: 9 } }); await click(text.choose);
  expect(document.body.textContent).toContain(text.invalid); expect(document.body.textContent).toContain('原实测文件'); expect(document.body.textContent).not.toContain('坏新文件'); expect(document.querySelector(`pre[aria-label="${analysisText.raw}"]`)).toBe(raw);
  expect(bridge.mock.calls.map(call => call[0])).toEqual(['explainFiles.open', 'explainFiles.open', 'explainFiles.open']);
});

it('实际文件另存持有原共享I/O锁，打开、关闭和Escape不能交叉提交', async () => {
  const onClose = vi.fn(), snapshot = actualDocument(), pending = deferred<{ name: string } | null>(); await mount(<Dialog onClose={onClose}/>); bridge.mockResolvedValueOnce({ name: '原实测', snapshot }); await click(text.choose);
  await click(analysisText.raw); const raw = document.querySelector(`pre[aria-label="${analysisText.raw}"]`), choose = props(button(text.choose)).onClick;
  bridge.mockReturnValueOnce(pending.promise); const save = props(button(text.saveAs)).onClick;
  await act(async () => { save(); save(); choose(); }); expect(bridge.mock.calls.map(call => call[0])).toEqual(['explainFiles.open', 'explainFiles.save']); expect(bridge.mock.calls[1][1]).toEqual({ snapshot }); expect(button(text.choose).disabled).toBe(true);
  await click(zh.dialogs.text001); await act(async () => document.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' }))); expect(onClose).not.toHaveBeenCalled();
  await act(async () => pending.resolve(null)); expect(button(text.choose).disabled).toBe(false); expect(document.querySelector(`pre[aria-label="${analysisText.raw}"]`)).toBe(raw); expect(button(analysisText.raw).getAttribute('aria-pressed')).toBe('true');
  await click(text.close); expect(onClose).toHaveBeenCalledTimes(1);
});

it('通用离线入口仍兼容原估算v1，再打开实测文件时按明确kind分流且零数据库IPC', async () => {
  await mount(<Dialog onClose={vi.fn()}/>); const old = captureExplainSnapshot(estimated()); bridge.mockResolvedValueOnce({ name: '原估算文件', snapshot: old }); await click(text.choose);
  expect(document.body.textContent).toContain(text.estimated); expect(document.querySelector(`[aria-label="${explainText.title}"]`)).not.toBeNull(); expect(document.querySelector(`[aria-label="${analysisText.view}"]`)).toBeNull();
  bridge.mockResolvedValueOnce({ name: '估算副本' }); await click(text.saveAs); expect(bridge.mock.calls[1]).toEqual(['explainFiles.save', { snapshot: old }]);
  const actual = actualDocument(); bridge.mockResolvedValueOnce({ name: '实测文件', snapshot: actual }); await click(text.choose);
  expect(document.querySelector(`[aria-label="${analysisText.view}"]`)).not.toBeNull(); expect(document.querySelector(`[aria-label="${explainText.title}"]`)).toBeNull();
  expect(bridge.mock.calls.map(call => call[0])).toEqual(['explainFiles.open', 'explainFiles.save', 'explainFiles.open']);
});

it('实际文件的新解析诊断不写回原文档，1MiB边界仍可精确另存', async () => {
  const snapshot = actualDocument(); snapshot.dialect = 'mariadb'; snapshot.serverVersion = '11.4.13'; snapshot.format = 'json'; snapshot.raw = '{' + ' '.repeat(16000); snapshot.result.rows[0].plan = snapshot.raw;
  snapshot.warnings = [...Array.from({ length: 63 }, () => 'w'.repeat(16000)), ''];
  const remaining = explainSnapshotLimits.bytes - Buffer.byteLength(JSON.stringify(snapshot) + '\n', 'utf8'); expect(remaining).toBeGreaterThan(0); expect(remaining).toBeLessThan(16000); snapshot.warnings[63] = 'x'.repeat(remaining);
  expect(Buffer.byteLength(encodePlanSnapshot(snapshot), 'utf8')).toBe(explainSnapshotLimits.bytes);
  const parsed = planSnapshotOutcome(snapshot).analysis!, diagnostics = parsed.warnings.filter(warning => !snapshot.warnings.includes(warning)); expect(diagnostics.length).toBeGreaterThan(0);
  await mount(<Dialog onClose={vi.fn()}/>); bridge.mockResolvedValueOnce({ name: '边界实测', snapshot }); await click(text.choose); expect(document.body.textContent).toContain(diagnostics[0]);
  bridge.mockResolvedValueOnce({ name: '边界实测副本' }); await click(text.saveAs); expect(bridge.mock.calls[1]).toEqual(['explainFiles.save', { snapshot }]); expect(document.querySelector('[role="alert"]')).toBeNull(); expect(document.body.textContent).toContain(text.saved('边界实测副本'));
});

it('卸载后的保存和打开迟到回执不污染新的离线窗口', async () => {
  const outcome = fixture(), oldSave = deferred<{ name: string } | null>(); await mount(<View plan={outcome.analysis!} outcome={outcome} fileActions/>); bridge.mockReturnValueOnce(oldSave.promise); await click(text.save);
  await render(<span/>); await render(<Dialog onClose={vi.fn()}/>); await act(async () => oldSave.resolve({ name: '失效保存回执' })); expect(document.body.textContent).not.toContain('失效保存回执');
  const oldOpen = deferred<{ name: string; snapshot: PlanSnapshotDocument } | null>(); bridge.mockReturnValueOnce(oldOpen.promise); await click(text.choose); await render(<span/>); await render(<Dialog onClose={vi.fn()}/>);
  await act(async () => oldOpen.resolve({ name: '失效打开回执', snapshot: actualDocument() })); expect(document.body.textContent).not.toContain('失效打开回执'); expect(bridge.mock.calls.map(call => call[0])).toEqual(['explainFiles.save', 'explainFiles.open']);
});
