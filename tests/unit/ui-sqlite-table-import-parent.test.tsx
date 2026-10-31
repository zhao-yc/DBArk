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
vi.mock('../../src/renderer/uiCommands', () => ({ useUiCommandScope: () => {} }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], baseline: ReturnType<typeof useWorkspace.getState>, Tab: typeof import('../../src/renderer/components/SqliteTableTab')['SqliteTableTab'];
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(window, 'dbark', { configurable: true, value: { onTask: () => () => {} } }); const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: value => node.attributes.set('value', value) }); return node; };
  ({ useWorkspace } = await import('../../src/renderer/store')); baseline = useWorkspace.getState(); ({ createRoot } = await import('react-dom/client')); ({ SqliteTableTab: Tab } = await import('../../src/renderer/components/SqliteTableTab'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; useWorkspace.setState(baseline, true); request.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少React事件端口'); return (node as any)[key]; }
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function input(label: string, value: string) { const node = document.querySelector('[aria-label="' + label + '"]'); expect(node).not.toBeNull(); await act(async () => props(node!).onChange({ target: { value } })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
/** 真实只读原页让保护不依赖已有editor的dirty兜底，覆盖原缺口。 */
async function mount(pendingChoice?: ReturnType<typeof deferred<{ token: string; name: string }>>) {
  const tab = { id: 'table-tab', kind: 'table' as const, title: '原表', connectionId: 'sqlite-c', database: 'main', table: 'original' }, profile: SqliteConnectionProfile = { id: tab.connectionId, name: '原连接', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:\\synthetic\\original.sqlite', readOnly: true, busyTimeoutMs: 1000 } };
  const original: SqliteTablePage = { target: { connectionId: tab.connectionId, database: 'main', table: tab.table, kind: 'table' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'id', declaredType: 'INTEGER' }], result: { columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], rows: [{ c0: '原页内容不得覆盖🚢' }], truncated: false, elapsedMs: 1, statement: '只读合成页' }, offset: 0, limit: 100, hasMore: false };
  const inspection: SqliteTableImportInspectOutput = { inspectionId: 'original-inspection', target: { connectionId: tab.connectionId, database: 'main', table: tab.table }, source: { sha256: 'b'.repeat(64), bytes: 12 }, sourceColumns: ['source'], sample: [{ source: '原导入样本' }], sampleOmitted: false, records: 1, columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, hasDefault: false, generated: false, affinity: 'integer', autoGenerated: true }], strict: true, readOnly: true, expiresAt: new Date(Date.now() + 60000).toISOString() };
  useWorkspace.setState({ settings: { ...baseline.settings, tabs: [tab], activeTabId: tab.id }, connections: [profile], connectionVersions: { [profile.id]: 0 }, activeJobs: {}, dirtyTabs: {} });
  request.mockImplementation(async (command: string) => { if (command === 'sqlite.tablePage') return original; if (command === 'files.choose') return pendingChoice ? pendingChoice.promise : { token: 'original-token', name: '原导入.csv' }; if (command === 'sqlite.tableImport.inspect') return inspection; if (command === 'sqlite.tableImport.release' || command === 'sqlite.tableEdit.release' || command === 'query.cancel') return; throw Error('专项不允许其它请求：' + command); });
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<Tab tab={tab} active/>)); expect(document.querySelector('[role="grid"]')!.textContent).toContain('原页内容不得覆盖');
  return { tab, profile, original, async active(value: boolean) { await act(async () => { useWorkspace.setState(state => ({ settings: { ...state.settings, activeTabId: value ? tab.id : undefined } })); root!.render(<Tab tab={tab} active={value}/>); }); }, async revise() { await act(async () => useWorkspace.getState().invalidateConnection(profile.id)); }, reads: () => request.mock.calls.filter(call => call[0] === 'sqlite.tablePage') };
}
it.each(['revision', 'active'] as const)('真实TableTab自动effect遇%s变化，保导入映射/原页/dirty且不发新读取', async mode => {
  const f = await mount(); await click(text.entry); await click(text.choose); await click(text.inspect); await click(text.addMapping); await input(text.sourceColumn(1), 's0'); await input(text.target('source'), 'id'); await input(text.kind('source'), 'integer'); expect(useWorkspace.getState().dirtyTabs[f.tab.id]).toBe(true);
  if (mode === 'revision') await f.revise(); else { await f.active(false); await f.active(true); }
  expect(f.reads()).toHaveLength(1); expect(useWorkspace.getState().dirtyTabs[f.tab.id]).toBe(true); expect(document.querySelector('[role="grid"]')!.textContent).toContain('原页内容不得覆盖'); expect(document.body.textContent).toContain('原导入.csv'); expect(document.querySelector('[aria-label="' + text.target('source') + '"]')).not.toBeNull(); expect(button(text.preview).disabled).toBe(true); expect(document.body.textContent).toContain(text.stale);
});
it('chooser尚未返回只有自有lease时，自动effect也不得drop原页或另发SQL', async () => {
  const pending = deferred<{ token: string; name: string }>(), f = await mount(pending); await click(text.entry); await click(text.choose); expect(useWorkspace.getState().activeJobs[f.tab.id]).toBe(true); await f.revise(); expect(f.reads()).toHaveLength(1); expect(document.querySelector('[role="grid"]')!.textContent).toContain('原页内容不得覆盖'); expect(useWorkspace.getState().activeJobs[f.tab.id]).toBe(true); await act(async () => pending.resolve({ token: 'late-file', name: '不能继承.csv' })); expect(f.reads()).toHaveLength(1); expect(document.body.textContent).not.toContain('不能继承.csv'); expect(useWorkspace.getState().activeJobs[f.tab.id]).toBe(false);
});
