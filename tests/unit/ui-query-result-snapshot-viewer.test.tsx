import React, { act, useState } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createQueryResultSnapshot, type QueryResultSnapshotDocument } from '../../src/shared/queryResultSnapshot';
import { queryResultSnapshotViewerZh as text } from '../../src/renderer/locales/queryResultSnapshotViewer.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
const rendered = vi.hoisted(() => ({ grids: [] as any[], parents: [] as any[], editors: [] as any[] }));
// 仅隔离虚拟布局与Monaco外界端口，实际ResultsGrid的只读/类型/字节查看逻辑保持生产实现。
vi.mock('react-data-grid', () => ({ SelectColumn: { key: 'select-row' }, DataGrid: (props: any) => { rendered.grids.push(props); return null; } }));
vi.mock('../../src/renderer/components/ResultsGrid', async importOriginal => { const actual = await importOriginal<typeof import('../../src/renderer/components/ResultsGrid')>(), react = await import('react'); return { ...actual, ResultsGrid(props: any) { rendered.parents.push(props); return react.createElement(actual.ResultsGrid, props); } }; });
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: (props: any) => { rendered.editors.push(props); return null; } }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/QueryResultSnapshotDialog')['QueryResultSnapshotDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
const bridge = vi.fn(), globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true }); const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text'; node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client')); ({ QueryResultSnapshotDialog: Dialog } = await import('../../src/renderer/components/QueryResultSnapshotDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
beforeEach(() => { bridge.mockReset(); (window as any).dbark = { invoke: bridge }; store.setState({ connections: [], settings: { ...store.getState().settings, tabs: [], activeTabId: undefined }, notice: undefined, activeJobs: {} }); });
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; rendered.grids = []; rendered.parents = []; rendered.editors = []; delete (window as any).dbark; });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
/** 只有合成文件内容，不伪造数据库执行或真实磁盘读写。 */
function snapshot(note = '原文'): QueryResultSnapshotDocument { return createQueryResultSnapshot({ columns: [{ key: 'id', name: '同名', type: 'BIGINT' }, { key: 'amount', name: '同名', type: 'DECIMAL(30,12)' }, { key: 'time', name: '时间', type: 'DATETIME(6)' }, { key: 'nil', name: '空值', type: 'VARCHAR' }, { key: 'bytes', name: '字节', type: 'BLOB' }, { key: 'text', name: '原文', type: 'JSON' }], rows: [{ id: '18446744073709551615', amount: '0.123456789012', time: '2026-10-28 12:34:56.123456', nil: null, bytes: { type: 'binary', base64: 'AP8=' }, text: note + '{"big":900719925474099312345,"z":-0}' }], elapsedMs: -0, truncated: true, statement: 'DELETE FROM synthetic; -- 仅来源展示，不能执行' }, '合成文件内容'); }
const opened = (name = '原文件.dbark-result.json', value = snapshot()) => ({ name, snapshot: value });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function mount(element: React.ReactNode = <Dialog onClose={vi.fn()}/>) { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await render(element); }
async function render(element: React.ReactNode) { await act(async () => root!.render(element)); }
function button(label: string) { const node = document.body.querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
function props(node: MemoryNode): any { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return (node as any)[key]; }
/** memory-dom不实现CSS class查询，按真实div/classList定位，不伪造布局值。 */
function panel() { const node = document.body.querySelectorAll('div').find(node => node.classList.contains('query-result-snapshot-viewer')); expect(node).toBeDefined(); return node!; }
function parent() { expect(rendered.parents.length).toBeGreaterThan(0); return rendered.parents.at(-1)!; }

it('初始0连接0标签没有自动IO，明确文件选择后接原只读网格和完整精度类型', async () => {
  const value = opened(), settings = store.getState().settings; await mount(); expect(bridge).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.notice);
  bridge.mockResolvedValueOnce(value); await click(text.choose); expect(bridge.mock.calls).toEqual([['resultSnapshotFiles.open', {}]]);
  expect(parent().columns).toEqual(value.snapshot.result.columns); expect(parent().rows).toEqual(value.snapshot.result.rows); expect(parent().binaryFileActions).toBe(false); expect(parent().isCurrent()).toBe(true);
  expect(rendered.grids.at(-1).onRowsChange).toBeUndefined(); expect(rendered.grids.at(-1).columns.every((column: any) => !column.renderEditCell && !column.editable)).toBe(true);
  expect(document.body.textContent).toContain(text.opened(value.name)); expect(document.body.textContent).toContain(text.count(1, 6)); expect(document.body.textContent).toContain(text.truncated); expect(rendered.editors).toHaveLength(0);
  expect(store.getState().connections).toEqual([]); expect(store.getState().settings).toBe(settings);
});
it('源SQL显隐只读，另存始终原Document，取消/坏文件/失败保留当前内容和稳定selectionScope', async () => {
  const value = opened(); await mount(); bridge.mockResolvedValueOnce(value); await click(text.choose); const source = parent(), scope = source.selectionScope;
  await click(text.sourceShow); expect(rendered.editors.at(-1)).toMatchObject({ value: value.snapshot.result.statement, readOnly: true, height: 180 }); expect(rendered.editors.at(-1).onExecute).toBeUndefined(); expect(rendered.editors.at(-1).onChange).toBeUndefined(); expect(parent().selectionScope).toBe(scope);
  bridge.mockResolvedValueOnce(null); await click(text.choose); expect(parent().rows).toBe(source.rows); expect(parent().selectionScope).toBe(scope); expect(source.isCurrent()).toBe(false); expect(parent().isCurrent()).toBe(true);
  bridge.mockResolvedValueOnce({ name: '坏文件', snapshot: { version: 9 } }); await click(text.choose); expect(document.querySelector('[role="alert"]')).not.toBeNull(); expect(parent().rows).toBe(source.rows); expect(document.body.textContent).not.toContain(text.opened('坏文件'));
  bridge.mockRejectedValueOnce(Error('原Main读取失败')); await click(text.choose); expect(document.body.textContent).toContain('原Main读取失败'); expect(parent().rows).toBe(source.rows);
  bridge.mockResolvedValueOnce({ name: '副本.json' }); await click(text.save); expect(bridge.mock.calls.at(-1)).toEqual(['resultSnapshotFiles.save', { snapshot: value.snapshot }]); expect(document.body.textContent).toContain(text.saved('副本.json')); expect(parent().rows).toBe(source.rows);
  bridge.mockResolvedValueOnce(null); await click(text.save); expect(document.body.textContent).toContain(text.cancelled); expect(parent().rows).toBe(source.rows);
});
it('双击及跨打开/另存旧DOM共享同步IO锁，header/footer/Escape均等真实终态', async () => {
  const close = vi.fn(), value = opened(); await mount(<Dialog onClose={close}/>); bridge.mockResolvedValueOnce(value); await click(text.choose);
  const choose = props(button(text.choose)).onClick, save = props(button(text.save)).onClick, pending = deferred<ReturnType<typeof opened> | null>(); bridge.mockReturnValueOnce(pending.promise);
  await act(async () => { choose(); choose(); save(); }); expect(bridge).toHaveBeenCalledTimes(2); expect(button(text.close).disabled).toBe(true); expect(parent().isCurrent()).toBe(false);
  await click(zh.dialogs.text001); await act(async () => { document.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' })); }); expect(close).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.waiting);
  await act(async () => { pending.resolve(null); }); expect(button(text.choose).disabled).toBe(false); await act(async () => save()); expect(bridge).toHaveBeenCalledTimes(2); await click(text.close); expect(close).toHaveBeenCalledOnce();
});
it('save原Promise尚未结束不关闭或再打开，原未知写入错误照实展示且不自动重试', async () => {
  const close = vi.fn(); await mount(<Dialog onClose={close}/>); bridge.mockResolvedValueOnce(opened()); await click(text.choose); const source = parent(), pending = deferred<{ name: string } | null>(); bridge.mockReturnValueOnce(pending.promise);
  await click(text.save); await click(zh.dialogs.text001); expect(close).not.toHaveBeenCalled(); expect(button(text.choose).disabled).toBe(true); expect(source.isCurrent()).toBe(false);
  const original = '原Main：替换已投递但结果未确认'; await act(async () => { pending.reject(Error(original)); }); expect(document.querySelector('[role="alert"]')!.textContent).toBe(original); expect(bridge).toHaveBeenCalledTimes(2); expect(parent().rows).toBe(source.rows); expect(button(text.save).disabled).toBe(false);
});
it('新source立即拒绝旧网格，隐藏及其它dialog/alertdialog同步禁止普通网格动作', async () => {
  await mount(); bridge.mockResolvedValueOnce(opened()); await click(text.choose); const old = parent(); bridge.mockResolvedValueOnce(opened('新文件', snapshot('新原文'))); await click(text.choose); expect(old.isCurrent()).toBe(false); expect(parent().rows).not.toBe(old.rows);
  const source = parent(); panel().hidden = true; expect(source.isCurrent()).toBe(false); panel().hidden = false;
  for (const role of ['dialog', 'alertdialog']) { const other = document.createElement('div'); other.setAttribute('role', role); document.body.appendChild(other); expect(source.isCurrent()).toBe(false); expect(source.binaryIsCurrent()).toBe(false); document.body.removeChild(other); }
  expect(parent().isCurrent()).toBe(true);
});
it('BLOB纯查看内层Escape只关闭内层，原外层header也不能穿透，下一Escape才关外层', async () => {
  const close = vi.fn(); await mount(<Dialog onClose={close}/>); bridge.mockResolvedValueOnce(opened()); await click(text.choose); const grid = rendered.grids.at(-1);
  await act(async () => { grid.onCellDoubleClick({ row: grid.rows[0], column: { key: 'bytes' } }); }); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2); expect(parent().isCurrent()).toBe(false); expect(parent().binaryIsCurrent()).toBe(true);
  await click(zh.dialogs.text001); expect(close).not.toHaveBeenCalled(); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
  await act(async () => { document.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' })); }); expect(close).not.toHaveBeenCalled(); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await act(async () => { document.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' })); }); expect(close).toHaveBeenCalledOnce(); expect(bridge.mock.calls.map(call => call[0])).toEqual(['resultSnapshotFiles.open']);
});
it('StrictMode不自动选择或并发，卸载后的旧open不污染新实例', async () => {
  await mount(<React.StrictMode><Dialog onClose={vi.fn()}/></React.StrictMode>); expect(bridge).not.toHaveBeenCalled(); const pending = deferred<ReturnType<typeof opened> | null>(); bridge.mockReturnValueOnce(pending.promise); await click(text.choose);
  await render(<span/>); await render(<Dialog onClose={vi.fn()}/>); await act(async () => { pending.resolve(opened('旧窗口文件')); }); expect(document.body.textContent).not.toContain('旧窗口文件'); expect(rendered.parents).toHaveLength(0); expect(bridge).toHaveBeenCalledOnce();
});
it.each(['saved', 'error'] as const)('卸载后save %s仍通知物理文件事实或原错，不污染后来内容', async kind => {
  await mount(); bridge.mockResolvedValueOnce(opened()); await click(text.choose); const pending = deferred<{ name: string } | null>(); bridge.mockReturnValueOnce(pending.promise); await click(text.save);
  await render(<span/>); await render(<Dialog onClose={vi.fn()}/>); await act(async () => { if (kind === 'saved') pending.resolve({ name: '迟到副本' }); else pending.reject(Error('原Main保存清理异常')); });
  expect(store.getState().notice?.text).toBe(kind === 'saved' ? text.lateSave : '原Main保存清理异常'); expect(document.body.textContent).not.toContain('迟到副本'); expect(bridge).toHaveBeenCalledTimes(2);
});

/** 从真实App只提取该入口，不能用手写替代按钮或伪造连接/查询状态。 */
function appEntry(invalidate: () => void) {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let declaration = '', button = '', modal = ''; const methods: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(file) === '[resultSnapshot, setResultSnapshot]')) declaration = node.getText(file);
    if (ts.isFunctionDeclaration(node) && ['openResultSnapshot', 'closeResultSnapshot'].includes(node.name?.text ?? '')) methods.push(node.getText(file));
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'button' && node.children.some(item => ts.isJsxExpression(item) && item.expression?.getText(file) === 'queryResultSnapshotViewerZh.entry')) button = node.getText(file);
    if (ts.isBinaryExpression(node) && node.left.getText(file) === 'resultSnapshot' && ts.isJsxSelfClosingElement(node.right)) modal = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file); expect([declaration, button, modal].every(Boolean)).toBe(true); expect(methods).toHaveLength(2);
  const context = createContext({ exports: {}, useState, document, QueryResultSnapshotDialog: Dialog, queryResultSnapshotViewerZh: text, workbenchNavigation: { invalidate }, require: (name: string) => { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止其它App依赖'); } });
  runInContext(ts.transpileModule(`function Entry(){${declaration}\n${methods.join('\n')}\nreturn <>${button}{${modal}}</>};globalThis.Entry=Entry;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.Entry as React.ComponentType;
}
it('真实App无连接入口可开，已有modal拒绝旧入口且开关推进导航意图', async () => {
  const invalidate = vi.fn(), Entry = appEntry(invalidate); await mount(<Entry/>); expect(store.getState().settings.tabs).toEqual([]); expect(store.getState().connections).toEqual([]);
  const old = props(button(text.entry)).onClick, other = document.createElement('div'); other.setAttribute('role', 'dialog'); document.body.appendChild(other); await act(async () => old()); expect(invalidate).not.toHaveBeenCalled(); document.body.removeChild(other);
  await click(text.entry); expect(invalidate).toHaveBeenCalledOnce(); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(bridge).not.toHaveBeenCalled(); await click(text.close); expect(invalidate).toHaveBeenCalledTimes(2); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
});
