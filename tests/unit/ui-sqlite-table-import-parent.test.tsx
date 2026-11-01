import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import type { SqliteConnectionProfile } from '../../src/shared/contracts';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteTableImportInspectOutput } from '../../src/shared/sqliteTableImport';
import { sqliteTableImportZh as text } from '../../src/renderer/locales/sqliteTableImport.zh-CN';

const { request, sequence } = vi.hoisted(() => ({ request: vi.fn(), sequence: { value: 0 } }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<object>(), invoke: request, uid: () => 'import-parent-' + ++sequence.value }));
// 仅替代无布局的网格/编辑器端口；真实TableTab、Browser、Source、导入事件/effect与store完整运行。
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: ({ rows }: { rows: Record<string, unknown>[] }) => <div role="grid">{rows.map(row => Object.values(row).join('|')).join(';')}</div> }));
vi.mock('../../src/renderer/components/SqliteTableEditGrid', () => ({ SqliteTableEditGrid: ({ page }: { page: SqliteTablePage }) => <div role="grid">{page.result.rows.map(row => Object.values(row).join('|')).join(';')}</div> }));
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: () => null }));
vi.mock('../../src/renderer/components/ResultExportDialog', () => ({ ResultExportDialog: () => null }));
let uiCommands: typeof import('../../src/renderer/uiCommands')['uiCommands'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], baseline: ReturnType<typeof useWorkspace.getState>, Tab: typeof import('../../src/renderer/components/SqliteTableTab')['SqliteTableTab'];
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(window, 'dbark', { configurable: true, value: { onTask: () => () => {} } }); const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: value => node.attributes.set('value', value) }); return node; };
  ({ useWorkspace } = await import('../../src/renderer/store')); ({ uiCommands } = await import('../../src/renderer/uiCommands')); baseline = useWorkspace.getState(); ({ createRoot } = await import('react-dom/client')); ({ SqliteTableTab: Tab } = await import('../../src/renderer/components/SqliteTableTab'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; uiCommands.setBlocked(true); useWorkspace.setState(baseline, true); request.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少React事件端口'); return (node as any)[key]; }
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function input(label: string, value: string) { const node = document.querySelector('[aria-label="' + label + '"]'); expect(node).not.toBeNull(); await act(async () => props(node!).onChange({ target: { value } })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
/** 真实只读原页让保护不依赖已有editor的dirty兜底，覆盖原缺口。 */
async function mount(pendingChoice?: ReturnType<typeof deferred<{ token: string; name: string }>>, writable = false) {
  const tab = { id: 'table-tab', kind: 'table' as const, title: '原表', connectionId: 'sqlite-c', database: 'main', table: 'original' }, profile: SqliteConnectionProfile = { id: tab.connectionId, name: '原连接', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:\\synthetic\\original.sqlite', readOnly: !writable, busyTimeoutMs: 1000 } };
  const original: SqliteTablePage = { target: { connectionId: tab.connectionId, database: 'main', table: tab.table, kind: 'table' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'id', declaredType: 'INTEGER' }], result: { columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], rows: [{ c0: '原页内容不得覆盖🚢' }], truncated: false, elapsedMs: 1, statement: '只读合成页' }, offset: 0, limit: 100, hasMore: false };
  if (writable) original.edit = { kind: 'editable', snapshotId: 'original-edit-snapshot', expiresAt: new Date(Date.now() + 1800000).toISOString(), columns: [{ name: 'id', declaredType: 'INTEGER', generated: false, nullable: true, hasDefault: true }], rows: [[{ kind: 'text', value: '原页内容不得覆盖🚢' }]], locator: { kind: 'rowid', columns: [] } };
  const inspection: SqliteTableImportInspectOutput = { inspectionId: 'original-inspection', target: { connectionId: tab.connectionId, database: 'main', table: tab.table }, source: { sha256: 'b'.repeat(64), bytes: 12 }, sourceColumns: ['source'], sample: [{ source: '原导入样本' }], sampleOmitted: false, records: 1, columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, hasDefault: false, generated: false, affinity: 'integer', autoGenerated: true }], strict: true, readOnly: true, expiresAt: new Date(Date.now() + 60000).toISOString() };
  useWorkspace.setState({ settings: { ...baseline.settings, tabs: [tab], activeTabId: tab.id }, connections: [profile], connectionVersions: { [profile.id]: 0 }, activeJobs: {}, dirtyTabs: {} });
  request.mockImplementation(async (command: string) => { if (command === 'sqlite.tablePage') return original; if (command === 'files.choose') return pendingChoice ? pendingChoice.promise : { token: 'original-token', name: '原导入.csv' }; if (command === 'sqlite.tableImport.inspect') return inspection; if (command === 'sqlite.tableImport.release' || command === 'sqlite.tableEdit.release' || command === 'query.cancel') return; throw Error('专项不允许其它请求：' + command); });
  uiCommands.setBlocked(false); const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<Tab tab={tab} active/>)); expect(document.querySelector('[role="grid"]')!.textContent).toContain('原页内容不得覆盖');
  let structureVersion = 0, structureAutomatic = true;
  return { tab, profile, original, async active(value: boolean) { await act(async () => { useWorkspace.setState(state => ({ settings: { ...state.settings, activeTabId: value ? tab.id : undefined } })); root!.render(<Tab tab={tab} active={value} refreshVersion={structureVersion} refreshAutomatically={structureAutomatic}/>); }); }, async structure(version: number, automatic: boolean) { structureVersion = version; structureAutomatic = automatic; await act(async () => root!.render(<Tab tab={tab} active refreshVersion={version} refreshAutomatically={automatic}/>)); }, async revise() { await act(async () => useWorkspace.getState().invalidateConnection(profile.id)); }, reads: () => request.mock.calls.filter(call => call[0] === 'sqlite.tablePage') };
}
it.each(['revision', 'active', 'structure'] as const)('真实TableTab自动effect遇%s变化，保导入映射/原页/dirty且不发新读取', async mode => {
  const f = await mount(); await click(text.entry); await click(text.choose); await click(text.inspect); await click(text.addMapping); await input(text.sourceColumn(1), 's0'); await input(text.target('source'), 'id'); await input(text.kind('source'), 'integer'); expect(useWorkspace.getState().dirtyTabs[f.tab.id]).toBe(true);
  if (mode === 'revision') await f.revise(); else if (mode === 'structure') await f.structure(1, true); else { await f.active(false); await f.active(true); }
  expect(f.reads()).toHaveLength(1); expect(useWorkspace.getState().dirtyTabs[f.tab.id]).toBe(true); expect(document.querySelector('[role="grid"]')!.textContent).toContain('原页内容不得覆盖'); expect(document.body.textContent).toContain('原导入.csv'); expect(document.querySelector('[aria-label="' + text.target('source') + '"]')).not.toBeNull(); expect(button(text.preview).disabled).toBe(true); expect(document.body.textContent).toContain(text.stale);
});
it('chooser尚未返回只有自有lease时，自动effect也不得drop原页或另发SQL', async () => {
  const pending = deferred<{ token: string; name: string }>(), f = await mount(pending); await click(text.entry); await click(text.choose); expect(useWorkspace.getState().activeJobs[f.tab.id]).toBe(true); await f.revise(); expect(f.reads()).toHaveLength(1); expect(document.querySelector('[role="grid"]')!.textContent).toContain('原页内容不得覆盖'); expect(useWorkspace.getState().activeJobs[f.tab.id]).toBe(true); await act(async () => pending.resolve({ token: 'late-file', name: '不能继承.csv' })); expect(f.reads()).toHaveLength(1); expect(document.body.textContent).not.toContain('不能继承.csv'); expect(useWorkspace.getState().activeJobs[f.tab.id]).toBe(false);
});

/** 原生菜单和工具栏共用真实命令注册，不模拟点击隐藏按钮。 */
it('菜单导入绑定当前活动表，树中另一个数据库选择不能覆盖原目标', async () => {
  const f = await mount(); await act(async () => useWorkspace.getState().select({ connectionId: 'other-connection', database: 'another-db' }));
  const snapshot = uiCommands.getSnapshot(); expect(snapshot.commands.find(item => item.id === 'import')?.enabled).toBe(true);
  await act(async () => { await uiCommands.execute({ id: 'import', revision: snapshot.revision }); });
  await click(text.choose); await click(text.inspect);
  const call = request.mock.calls.find(call => call[0] === 'sqlite.tableImport.inspect');
  expect(call?.[1]).toMatchObject({ connectionId: f.tab.connectionId, database: 'main', table: f.tab.table });
  expect(request.mock.calls.some(call => call[0] === 'connections.open')).toBe(false);
});
it('旧菜单在活动标签切换后失效，不打开原表导入或发送文件请求', async () => {
  const f = await mount(), snapshot = uiCommands.getSnapshot(); await f.active(false);
  await act(async () => { await uiCommands.execute({ id: 'import', revision: snapshot.revision }); });
  expect(document.body.textContent).not.toContain(text.choose);
  expect(request.mock.calls.some(call => call[0] === 'files.choose')).toBe(false);
});

it('未知索引回执只撤旧页能力并保原只读展示，不自动读取或写入', async () => {
  const f = await mount(); await f.structure(1, false); expect(f.reads()).toHaveLength(1); expect(document.querySelector('[role="grid"]')!.textContent).toContain('原页内容不得覆盖');
  expect(document.body.textContent).toContain('SQLite表结构已变化或结果未知'); expect(request.mock.calls.some(call => /apply$/.test(call[0]))).toBe(false);
});
it.each([false, true])('未知结构后的%s读写页切换和后续已核回执均不自动读取，明确刷新才解锁', async writable => {
  const f = await mount(undefined, writable), { sqliteTableBrowseZh: browse } = await import('../../src/renderer/locales/sqliteTableBrowse.zh-CN');
  await f.structure(1, false); await f.active(false); await f.active(true); await f.structure(2, true);
  expect(f.reads()).toHaveLength(1); expect(document.querySelector('[role="grid"]')!.textContent).toContain('原页内容不得覆盖');
  expect(document.body.textContent).toContain('SQLite表结构已变化或结果未知');
  expect(request.mock.calls.some(call => call[0] === 'sqlite.tableEdit.preview' || call[0] === 'sqlite.tableEdit.apply')).toBe(false);
  await click(browse.refresh); expect(f.reads()).toHaveLength(2); expect(f.reads()[1][1]).toMatchObject({ connectionId: f.tab.connectionId, database: 'main', table: f.tab.table, offset: 0 });
  await f.active(false); await f.active(true); expect(f.reads()).toHaveLength(3);
});
it('已核索引回执的干净表页可明确沿原目标刷新，不生成查询或导入任务', async () => {
  const f = await mount(); await f.structure(1, true); expect(f.reads()).toHaveLength(2); expect(f.reads()[1][1]).toMatchObject({ connectionId: f.tab.connectionId, database: 'main', table: f.tab.table, offset: 0 });
  expect(request.mock.calls.some(call => call[0].startsWith('query.') || /apply$/.test(call[0]))).toBe(false);
});

it('索引结构未知回执保真实编辑草稿但立即撤旧快照及旧preview按钮授权', async () => {
  const f = await mount(undefined, true), { sqliteTableEditZh: edit } = await import('../../src/renderer/locales/sqliteTableEdit.zh-CN'); await click(edit.add); expect(useWorkspace.getState().dirtyTabs[f.tab.id]).toBe(true);
  const oldPreview = props(button(edit.preview)).onClick; await f.structure(1, false); expect(useWorkspace.getState().dirtyTabs[f.tab.id]).toBe(true); expect(f.reads()).toHaveLength(1); expect(button(edit.add).disabled).toBe(true); expect(button(edit.preview).disabled).toBe(true);
  expect(document.querySelector('[role="grid"]')!.textContent).toContain('原页内容不得覆盖'); await act(async () => oldPreview()); expect(request.mock.calls.some(call => call[0] === 'sqlite.tableEdit.preview' || call[0] === 'sqlite.tableEdit.apply')).toBe(false);
});
