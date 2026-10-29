import { installNavigationMenuRamPort, navigationMenuRamButton, navigationMenuRamInput, navigationMenuRamCheckbox } from '../helpers/navigationMenuRamPort';
import { queryWarningsZh } from '../../src/renderer/locales/queryWarnings.zh-CN';
import { queryContinueOnErrorZh } from '../../src/renderer/locales/queryContinueOnError.zh-CN';
let restoreNavigationMenuPort: () => void = () => {};
import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { createQueryResultSnapshot, type QueryResultSnapshotDocument } from '../../src/shared/queryResultSnapshot';
import type { QueryResultSnapshotServices } from '../../src/renderer/components/QueryResultSnapshotActions';
import { QueryResultSnapshotIntent } from '../../src/renderer/queryResultSnapshotIntent';
import { queryResultSnapshotUiZh as text } from '../../src/renderer/locales/queryResultSnapshot.zh-CN';
import { queryResultComparisonZh } from '../../src/renderer/locales/queryResultComparison.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';

const renders = vi.hoisted(() => ({ grids: [] as any[], editors: [] as any[] }));
vi.mock('react-data-grid', () => ({ SelectColumn: { key: 'select-row' }, DataGrid: (props: any) => { renders.grids.push(props); return null; } }));
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: (props: any) => { renders.editors.push(props); return null; } }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let QueryTab: typeof import('../../src/renderer/components/QueryTab')['QueryTab'], store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'];
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); restoreNavigationMenuPort = installNavigationMenuRamPort(document); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout, confirm: () => true }); Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name); if (name === 'input') node.type = 'text';
    // 仅反射浏览器属性，真实QueryTab/固定结果/文件Actions/store均运行产品代码。
    if (name === 'option') { let selected = false; Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) }); Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = !!value; if (selected && node.parentNode?.tagName === 'SELECT') for (const option of node.parentNode.querySelectorAll('option')) if (option !== node) (option as any).selected = false; } }); }
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ QueryTab } = await import('../../src/renderer/components/QueryTab')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } if ((window as any).dbark) await flush(); delete (window as any).dbark; document.body.textContent = ''; renders.grids = []; renders.editors = []; });
afterAll(() => { restoreNavigationMenuPort(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 仅合成已返回行，不把RAM数据或回包当作真实数据库/文件选择器验收。 */
function result(note = '原值'): QueryResult { return { columns: [{ key: 'id', name: '同名', type: 'BIGINT' }, { key: 'value', name: '同名', type: 'VARCHAR' }, { key: 'bytes', name: '字节', type: 'BLOB' }], rows: [{ id: '18446744073709551615', value: note, bytes: { type: 'binary', base64: 'AP8=' } }, { id: '9007199254740993', value: null, bytes: { type: 'binary', base64: '' } }], truncated: true, elapsedMs: 3, statement: 'DELETE FROM synthetic; -- 仅来源展示，绝不自动执行' }; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function section() { return document.body.querySelector('[data-snapshot-tab="q"]') ?? document.body; }
/** RAM DOM只支持标签/属性选择器，类名通过真实classList读取，避免空结果冒充通过。 */
function nodes(className: string, parent: MemoryNode = section()) { return parent.querySelectorAll('div').filter(node => node.classList.contains(className)); }
function button(label: string) { const node = (navigationMenuRamButton(section(), label) ?? section().querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label || label === zh.query.text010 && node.textContent.startsWith(label))); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
function grid() { expect(renders.grids.length).toBeGreaterThan(0); return renders.grids.at(-1)!; }
function callback(node: MemoryNode): () => void { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React按钮事件'); return (node as any)[key].onClick; }

/** 所有IPC只在RAM中记录，未知命令立即拒绝，不访问磁盘、网络或系统剪贴板。 */
async function mount(options: { open?: QueryResultSnapshotServices['open']; save?: QueryResultSnapshotServices['save']; execute?: boolean; strict?: boolean } = {}) {
  const source = result(), snapshot = createQueryResultSnapshot(result('来自文件'), '离线文件快照'), commands: { command: string; input: any }[] = [], saved: QueryResultSnapshotDocument[] = [];
  const open = vi.fn<QueryResultSnapshotServices['open']>(options.open ?? (async () => ({ name: 'result.dbark-result.json', snapshot })));
  const save = vi.fn<QueryResultSnapshotServices['save']>(options.save ?? (async document => { saved.push(document); return { name: 'saved.dbark-result.json' }; }));
  (window as any).dbark = { onTask: () => () => {}, onMenu: () => () => {}, invoke: async (command: string, input: any) => {
    commands.push({ command, input });
    if (command === 'resultSnapshotFiles.open') return open(); if (command === 'resultSnapshotFiles.save') return save(input.snapshot);
    if (['settings.save', 'connections.open', 'sessions.close'].includes(command)) return;
    if (command === 'sessions.open') return { sessionId: 'ram-session' };
    if (command === 'query.completionState') return { databaseKnown: true, database: null, temporaryObjects: [] };
    if (command === 'query.execute' && options.execute) return { results: [source], elapsedMs: 3, transactionOpen: true };
    throw Error('结果快照RAM边界禁止额外IO：' + command);
  } };
  const tab = { id: 'q', kind: 'query' as const, connectionId: 'c', title: '原查询', sql: 'SELECT 原正文不得替换', databaseContext: { state: 'known' as const, database: null } };
  store.setState({ settings: { theme: 'light', sidebarWidth: 260, resultLimit: 1000, pageSize: 50, activeTabId: 'q', tabs: [tab] }, connections: options.execute ? [{ id: 'c', name: 'RAM', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'ram' }] : [], connectionVersions: { c: 1 }, activeJobs: {}, dirtyTabs: {}, notice: undefined });
  function Harness() { const settings = store(state => state.settings); return <>{settings.tabs.map(tab => <section key={tab.id} data-snapshot-tab={tab.id} hidden={settings.activeTabId !== tab.id}><QueryTab tab={tab} onHistory={() => {}}/></section>)}</>; }
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(options.strict ? <React.StrictMode><Harness/></React.StrictMode> : <Harness/>)); if (options.execute) await click(zh.query.text010);
  return { source, snapshot, commands, open, save, saved, tab };
}
it('真实QueryTab无结果无连接也能离线打开，复用原网格/来源SQL/两份固定结果比较且不执行', async () => {
  const f = await mount(), before = structuredClone(store.getState().settings); expect(button(text.save).disabled).toBe(true); expect(button(text.open).disabled).toBe(false);
  const toolbar = nodes('result-toolbar')[0], menu = document.body.querySelectorAll('div').find(node => node.getAttribute('role') === 'menu' && node.getAttribute('aria-label') === '快照'); expect(toolbar).toBeDefined(); expect(menu).toBeDefined(); expect(menu!.parentNode).toBe(document.body); expect(nodes('query-result-snapshot-actions')).toHaveLength(0); expect(nodes('action-menu-panel', toolbar)).toHaveLength(0);
  await click(text.open); expect(grid().rows).toEqual(f.snapshot.result.rows); expect(document.body.textContent).toContain(text.truncated); expect(store.getState().settings).toEqual(before);
  await click(zh.query.pinnedStatement); expect(renders.editors.some(props => props.readOnly === true && props.value === f.snapshot.result.statement)).toBe(true); await click(zh.common.close);
  f.open.mockResolvedValue({ name: 'second.json', snapshot: createQueryResultSnapshot(result('第二份'), '第二快照') }); await click(text.open); await click(queryResultComparisonZh.open);
  expect(document.body.querySelector('[aria-label="' + queryResultComparisonZh.title + '"]')).not.toBeNull(); expect(document.body.textContent).toContain('第二快照');
  expect(f.commands.filter(item => /^(?:connections\.open|sessions\.|query\.)/.test(item.command))).toEqual([]); expect(store.getState().settings.tabs[0].sql).toBe(f.tab.sql);
});
it('结果上限仅在整理菜单展示，原受控值与1至100000边界保留且不执行SQL', async () => {
  await mount(); const before = structuredClone(store.getState().settings.tabs);
  expect(section().querySelector('[aria-label="' + zh.query.text021 + '"]')).toBeNull();
  const input = navigationMenuRamInput(section(), zh.query.text021); expect(input).toBeDefined();
  const key = Object.keys(input!).find(key => key.startsWith('__reactProps$'))!;
  const change = (input as any)[key].onChange as (event: { target: { value: string } }) => void;
  await act(async () => change({ target: { value: '2' } })); expect(store.getState().settings.resultLimit).toBe(2); expect(Number(input!.value)).toBe(2);
  await act(async () => change({ target: { value: '100001' } })); expect(store.getState().settings.resultLimit).toBe(100000); expect(Number(input!.value)).toBe(100000);
  await act(async () => change({ target: { value: '0' } })); expect(store.getState().settings.resultLimit).toBe(1); expect(Number(input!.value)).toBe(1);
  expect(store.getState().settings.tabs).toEqual(before); expect(renders.grids).toHaveLength(0);
});
it('会话菜单按需展示原执行checkbox，保留受控值、风险说明及键盘焦点', async () => {
  await mount(); const before = structuredClone(store.getState().settings.tabs);
  expect(section().querySelector('[aria-label="' + queryWarningsZh.option + '"]')).toBeNull();
  const warnings = navigationMenuRamCheckbox(section(), queryWarningsZh.option); expect(warnings).toBeDefined(); expect(warnings!.checked).toBe(false);
  const change = (node: MemoryNode, checked: boolean) => { const key = Object.keys(node).find(key => key.startsWith('__reactProps$'))!; (node as any)[key].onChange({ target: { checked } }); };
  await act(async () => change(warnings!, true)); expect(warnings!.checked).toBe(true); expect(document.body.textContent).toContain(queryWarningsZh.hint);
  const continuation = navigationMenuRamCheckbox(section(), queryContinueOnErrorZh.option); expect(continuation).toBeDefined(); expect(continuation!.parentNode!.getAttribute('title')).toBe(queryContinueOnErrorZh.hint);
  await act(async () => change(continuation!, true)); expect(continuation!.checked).toBe(true);
  warnings!.focus(); await act(async () => warnings!.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'ArrowDown' }))); expect(document.activeElement).toBe(continuation);
  expect(store.getState().settings.tabs).toEqual(before); expect(renders.grids).toHaveLength(0);
});
it('保存已返回当前结果或打开的固定结果，保来源SQL/列/精度/NULL/字节且不重跑', async () => {
  const f = await mount({ execute: true }), before = structuredClone(store.getState().settings), queryCount = f.commands.filter(item => item.command === 'query.execute').length;
  await click(text.save); expect(f.saved).toHaveLength(1); expect(f.saved[0].result).toEqual(f.source); expect(f.saved[0]).not.toHaveProperty('connectionId'); expect(store.getState().settings).toEqual(before); expect(store.getState().dirtyTabs.q).toBe(true);
  await click(text.open); const oldOutcome = f.source; await click(text.save); expect(f.saved).toHaveLength(2); expect(f.saved[1].result).toEqual(f.snapshot.result); expect(oldOutcome).toEqual(f.source);
  expect(f.commands.filter(item => item.command === 'query.execute')).toHaveLength(queryCount); expect(f.commands.filter(item => item.command.startsWith('query.transaction'))).toEqual([]); expect(store.getState().settings.tabs[0].sql).toBe(f.tab.sql); expect(store.getState().dirtyTabs.q).toBe(true);
});
it('撤销回包不提前释放原chooser/IO占用，原Promise结束后不新增pin', async () => {
  const pending = deferred<{ name: string; snapshot: QueryResultSnapshotDocument } | null>(), f = await mount({ open: () => pending.promise });
  await click(text.open); expect(store.getState().activeJobs.q).toBe(true); await click(text.cancel); expect(store.getState().activeJobs.q).toBe(true); expect(f.open).toHaveBeenCalledOnce();
  await act(async () => { pending.resolve({ name: 'late.json', snapshot: f.snapshot }); }); expect(store.getState().activeJobs.q).toBe(false); expect(renders.grids).toHaveLength(0); expect(document.body.textContent).toContain(text.stale);
});
it('StrictMode挂载清理不自动打开文件，明确点击只领取一个chooser并正常释放', async () => {
  const f = await mount({ strict: true }); expect(f.open).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); await click(text.open);
  expect(f.open).toHaveBeenCalledOnce(); expect(grid().rows).toEqual(f.snapshot.result.rows); expect(store.getState().activeJobs.q).toBe(false);
});
it.each(['active', 'version', 'tab', 'closed'] as const)('%s来源ABA/关闭后迟到文件不能接入后来页面', async change => {
  const pending = deferred<{ name: string; snapshot: QueryResultSnapshotDocument } | null>(), f = await mount({ open: () => pending.promise }); await click(text.open);
  const state = store.getState(); await act(async () => {
    if (change === 'active') { store.getState().updateSettings({ activeTabId: 'other' }); store.getState().updateSettings({ activeTabId: 'q' }); }
    if (change === 'version') { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); }
    if (change === 'tab') { store.getState().updateTab('q', { sql: '临时变化' }); store.setState({ settings: state.settings }); }
    if (change === 'closed') { store.getState().updateSettings({ tabs: [] }); store.setState({ settings: state.settings }); }
  });
  await act(async () => { pending.resolve({ name: 'late.json', snapshot: f.snapshot }); }); expect(renders.grids).toHaveLength(0); expect(f.open).toHaveBeenCalledOnce(); expect(store.getState().settings.tabs[0].sql).toBe(f.tab.sql);
});
it('别的作业覆盖同true后旧finally不清它，原结果回包不发布', async () => {
  const pending = deferred<{ name: string; snapshot: QueryResultSnapshotDocument } | null>(), f = await mount({ open: () => pending.promise }); await click(text.open);
  await act(async () => { store.getState().setBusy('q', true); }); await act(async () => { pending.resolve({ name: 'late.json', snapshot: f.snapshot }); });
  expect(store.getState().activeJobs.q).toBe(true); expect(renders.grids).toHaveLength(0); expect(f.open).toHaveBeenCalledOnce();
  expect(button(text.open).disabled).toBe(true); await act(async () => { store.getState().setBusy('q', false); }); expect(button(text.open).disabled).toBe(false);
  await click(text.open); expect(f.open).toHaveBeenCalledTimes(2); expect(grid().rows).toEqual(f.snapshot.result.rows); expect(store.getState().activeJobs.q).toBe(false);
});
it('同轮store先改原tab后旧DOM按钮不能启动chooser，下一次明确新按钮可用', async () => {
  const f = await mount(), old = callback(button(text.open)); await act(async () => { store.getState().updateTab('q', { sql: '同轮新正文' }); old(); });
  expect(f.open).not.toHaveBeenCalled(); expect(store.getState().activeJobs.q).not.toBe(true); expect(store.getState().settings.tabs[0].sql).toBe('同轮新正文');
  await click(text.open); expect(f.open).toHaveBeenCalledOnce(); expect(store.getState().settings.tabs[0].sql).toBe('同轮新正文');
});
it('五份固定结果已满时拒绝第六份而不再启动chooser，原pin和结果均保留', async () => {
  const f = await mount(); for (let index = 0; index < 5; index++) await click(text.open); const before = grid().rows; await click(text.open);
  expect(f.open).toHaveBeenCalledTimes(5); expect(grid().rows).toBe(before); expect(document.body.textContent).toContain(zh.query.pinCountLimit); expect(nodes('pinned-result')).toHaveLength(5);
});
it('文件本身合规但累计固定容量超过16MiB时完整拒绝，不丢旧pin或截断行', async () => {
  const large: QueryResult = { columns: Array.from({ length: 9 }, (_, index) => ({ key: 'k' + index, name: 'k' + index, type: 'TEXT' })), rows: [Object.fromEntries(Array.from({ length: 9 }, (_, index) => ['k' + index, 'a'.repeat(1_000_000)]))], statement: '仅合成9MB快照', elapsedMs: 0, truncated: false };
  const snapshot = createQueryResultSnapshot(large), f = await mount({ open: async () => ({ name: 'large.json', snapshot }) }); await click(text.open); const before = grid().rows; await click(text.open);
  expect(f.open).toHaveBeenCalledTimes(2); expect(grid().rows).toBe(before); expect(nodes('pinned-result')).toHaveLength(1); expect(document.body.textContent).toContain(zh.query.pinMemoryLimit); expect(grid().rows[0].k0).toHaveLength(1_000_000);
});
it('保存已投递后原来源失效明确报不确定，不自动重试也不清编辑器/原事务状态', async () => {
  const pending = deferred<{ name: string } | null>(), f = await mount({ execute: true, save: () => pending.promise }), before = structuredClone(store.getState().settings), rows = grid().rows;
  await click(text.save); const oldSave = callback(button(text.save)); await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); });
  await act(async () => { pending.resolve({ name: 'committed.json' }); }); expect(store.getState().notice?.text).toBe(text.uncertain); expect(button(text.save).disabled).toBe(false); await act(async () => oldSave());
  expect(f.save).toHaveBeenCalledOnce(); expect(store.getState().settings).toEqual(before); expect(grid().rows).toBe(rows); expect(store.getState().dirtyTabs.q).toBe(true);
  await click(text.save); expect(f.save).toHaveBeenCalledTimes(2); expect(store.getState().settings).toEqual(before);
});
it('保存IPC拒绝如实显示原错且没有自动重试，只有下一次明确点击才选择文件', async () => {
  const f = await mount({ execute: true }); f.save.mockRejectedValueOnce(Error('原生保存权限不足，未创建文件')); await click(text.save);
  expect(document.body.textContent).toContain('原生保存权限不足，未创建文件'); expect(store.getState().notice?.text).not.toBe(text.uncertain); expect(f.save).toHaveBeenCalledOnce(); expect(button(text.save).disabled).toBe(false);
  await click(text.save); expect(f.save).toHaveBeenCalledTimes(2);
});
it('原页卸载后保存reject仍转发原Main错误，不猜测写入结果或自动重试', async () => {
  const pending = deferred<{ name: string } | null>(), f = await mount({ execute: true, save: () => pending.promise }); await click(text.save);
  await act(async () => { store.getState().updateSettings({ tabs: [] }); });
  const original = '原Main保存失败：句柄清理异常'; await act(async () => { pending.reject(Error(original)); });
  expect(store.getState().notice?.text).toBe(original); expect(store.getState().notice?.text).not.toBe(text.uncertain); expect(f.save).toHaveBeenCalledOnce(); expect(store.getState().activeJobs.q).toBe(false);
});
it('文件在途释放已有pin会永久撤销原回包，不借后来相同结果重新接纳', async () => {
  const f = await mount(); await click(text.open); const pending = deferred<{ name: string; snapshot: QueryResultSnapshotDocument } | null>(); f.open.mockImplementationOnce(() => pending.promise);
  await click(text.open); await click(formatText(zh.query.releasePin, f.snapshot.name!)); expect(store.getState().activeJobs.q).toBe(true);
  await act(async () => { pending.resolve({ name: 'late.json', snapshot: f.snapshot }); }); expect(nodes('pinned-result')).toHaveLength(0); expect(f.open).toHaveBeenCalledTimes(2); expect(store.getState().activeJobs.q).toBe(false);
});
it('原生选择取消只回null，无pin变动且正常释放；文件损坏错误保持原pin', async () => {
  const f = await mount({ open: async () => null }); await click(text.open); expect(document.body.textContent).toContain(text.cancelled); expect(store.getState().activeJobs.q).toBe(false); expect(renders.grids).toHaveLength(0);
  f.open.mockResolvedValue({ name: 'ok.json', snapshot: f.snapshot }); await click(text.open); const rows = grid().rows;
  f.open.mockResolvedValue({ name: 'bad.json', snapshot: { ...f.snapshot, version: 2 } as unknown as QueryResultSnapshotDocument }); await click(text.open); expect(grid().rows).toBe(rows); expect(nodes('pinned-result')).toHaveLength(1);
});
it('独立意图拒绝结果/pins替换及ABA，消费一次且guard异常不会放行', () => {
  const result = {}, pins: unknown[] = [], source = new QueryResultSnapshotIntent([result, pins], () => true); source.observe([{}, pins]); source.observe([result, pins]); expect(source.current()).toBe(false);
  const consumed = new QueryResultSnapshotIntent([], () => true); consumed.consume(); expect(() => consumed.consume()).toThrow(text.stale);
  expect(new QueryResultSnapshotIntent([], () => { throw Error('未知owner'); }).current()).toBe(false);
});
