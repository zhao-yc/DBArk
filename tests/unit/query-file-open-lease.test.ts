import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceTab } from '../../src/renderer/store';

const io = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke: io.invoke, uid: () => '新标签', errorMessage: () => '配置失败' }));
let store: typeof import('../../src/renderer/store');
const source = { id: '11111111-1111-4111-8111-111111111111', revision: 1 };
const binding = { ref: source, name: '完整原文.sql', displayPath: '仅RAM', encoding: 'utf8' as const, bom: 'none' as const, eol: 'lf' as const, savedSqlDigest: 'b'.repeat(64) };
const origin = (): WorkspaceTab => ({ id: '原标签', kind: 'query', connectionId: 'c', title: '原查询', sql: '原查询正文', databaseContext: { state: 'known', database: '原库' } });
const target = (): WorkspaceTab => ({ id: '占位', kind: 'query', connectionId: 'c', title: '等待原文', sql: '', databaseContext: { state: 'known', database: '原库' } });

beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); vi.stubGlobal('window', new EventTarget()); io.invoke.mockReset(); io.invoke.mockResolvedValue(undefined);
  store = await import('../../src/renderer/store');
  store.useWorkspace.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, tabs: [origin()], activeTabId: '原标签' }, connections: [{ id: 'c', name: '原连接', dialect: 'mysql', group: '', color: '', host: '仅RAM', port: 1, user: '无秘密' }], connectionVersions: {}, queryFileOpenings: {}, activeJobs: {}, dirtyTabs: {} });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function begin() { return store.beginQueryFileOpen(store.useWorkspace.getState().settings.tabs[0], target(), () => true); }

it('空标签/阶段和原文/绑定/解除阶段各自原子；所有settings.save都不携带内存owner', async () => {
  const states: any[] = [], off = store.useWorkspace.subscribe(state => states.push({ tab: state.settings.tabs.find(tab => tab.id === '占位'), opening: state.queryFileOpenings['占位'] }));
  const lease = begin(); expect(lease.current()).toBe(true); expect(states[0].opening.target).toBe(states[0].tab); expect(states[0].tab.sql).toBe('');
  expect(lease.apply('甲\n乙\n', binding)).toBe(true); expect(states.at(-1)).toMatchObject({ tab: { sql: '甲\n乙\n', fileSourceBinding: source } }); expect(states.at(-1).opening).toBeUndefined();
  expect(states.every(state => !state.tab || state.tab.fileSourceBinding || state.opening?.target === state.tab)).toBe(true);
  lease.dispose(true); expect(store.useWorkspace.getState().settings.tabs).toHaveLength(2); await store.flushSettings();
  expect(io.invoke.mock.calls.every(([, settings]) => !('queryFileOpenings' in settings))).toBe(true); off();
});
it('取消或首轮flush失败仅可移除本owner仍未修改的占位，不动原草稿/活动身份', () => {
  const before = store.useWorkspace.getState().settings.tabs[0], lease = begin(); lease.dispose(true); lease.dispose(true);
  expect(store.useWorkspace.getState().settings.tabs).toEqual([before]); expect(store.useWorkspace.getState().settings.activeTabId).toBe('原标签'); expect(store.useWorkspace.getState().queryFileOpenings).toEqual({});
});
it.each(['目标正文', '目标标题', '目标来源ABA', '原来源ABA', '原连接修订ABA', '原数据库ABA', '关闭重建', '连接概要替换', '目标事务dirty'] as const)('%s永久撤销旧租约，dispose不能删后来文稿', kind => {
  const lease = begin(), before = store.useWorkspace.getState().settings.tabs.find(tab => tab.id === '占位')!;
  const state = store.useWorkspace.getState();
  if (kind === '目标正文') state.updateTab('占位', { sql: '后来正文' });
  if (kind === '目标标题') state.updateTab('占位', { title: '后来标题' });
  if (kind === '目标来源ABA') { state.updateTab('占位', { fileSourceBinding: source }); state.updateSettings({ tabs: store.useWorkspace.getState().settings.tabs.map(tab => tab.id === '占位' ? before : tab) }); }
  if (kind === '原来源ABA') { const original = state.settings.tabs[0]; state.updateTab('原标签', { fileSourceBinding: source }); state.updateSettings({ tabs: store.useWorkspace.getState().settings.tabs.map(tab => tab.id === '原标签' ? original : tab) }); }
  if (kind === '原连接修订ABA') { state.invalidateConnection('c'); store.useWorkspace.setState({ connectionVersions: {} }); }
  if (kind === '原数据库ABA') { state.updateTab('原标签', { database: '别库' }); state.updateTab('原标签', { database: undefined }); }
  if (kind === '关闭重建') { state.closeTab('占位'); state.openTab({ ...before, sql: '重建正文' }); }
  if (kind === '连接概要替换') state.setConnections([{ ...state.connections[0] }]);
  if (kind === '目标事务dirty') state.setDirty('占位', true);
  const current = store.useWorkspace.getState().settings.tabs.find(tab => tab.id === '占位');
  expect(lease.current()).toBe(false); expect(lease.apply('旧原文', binding)).toBe(false); lease.dispose(true);
  const untouched = ['原来源ABA', '原连接修订ABA', '原数据库ABA', '连接概要替换'].includes(kind);
  expect(store.useWorkspace.getState().settings.tabs.find(tab => tab.id === '占位')).toBe(untouched ? undefined : current); expect(store.useWorkspace.getState().queryFileOpenings).toEqual({});
});
it('旧owner收尾不得解除同id新owner阶段或覆盖新来源', () => {
  const old = begin(); store.useWorkspace.getState().closeTab('占位'); old.dispose(); const current = begin();
  const marker = store.useWorkspace.getState().queryFileOpenings['占位']; old.dispose(true); expect(old.apply('旧回包', binding)).toBe(false);
  expect(store.useWorkspace.getState().queryFileOpenings['占位']).toBe(marker); expect(current.current()).toBe(true); expect(current.apply('新原文\n', binding)).toBe(true);
});
it('原标签正常输入和改标题继续保留；文件回包只更新新标签', () => {
  const lease = begin(); store.useWorkspace.getState().updateTab('原标签', { sql: '等待期间新输入', title: '用户标题' });
  expect(lease.current()).toBe(true); expect(lease.apply('文件原文\n', binding)).toBe(true);
  expect(store.useWorkspace.getState().settings.tabs[0]).toMatchObject({ sql: '等待期间新输入', title: '用户标题' });
});
it('重复id登记拒绝且不替换现有owner；坏回包拒绝且不创建伪来源', () => {
  const lease = begin(), marker = store.useWorkspace.getState().queryFileOpenings['占位']; expect(begin).toThrow();
  expect(store.useWorkspace.getState().queryFileOpenings['占位']).toBe(marker); expect(() => lease.apply('坏\0正文', binding)).toThrow();
  expect(() => lease.apply('正文', { ...binding, ref: { ...source, revision: 0 } })).toThrow(); lease.dispose(true);
  expect(store.useWorkspace.getState().settings.tabs).toHaveLength(1);
});
it('首次读取仅内存阶段不进入重启设置；恢复的现有正文没有加载标记', async () => {
  const lease = begin(); await store.flushSettings(); const persisted = io.invoke.mock.calls.at(-1)![1]; expect(persisted.queryFileOpenings).toBeUndefined();
  lease.dispose(true); const restored = { ...persisted, tabs: [{ ...target(), sql: '已恢复正文\r\n', fileSourceBinding: source }] };
  store.useWorkspace.getState().updateSettings(restored); expect(store.useWorkspace.getState().queryFileOpenings).toEqual({}); expect(store.useWorkspace.getState().settings.tabs[0].sql).toBe('已恢复正文\r\n');
});
