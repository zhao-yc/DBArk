import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, ConnectionProfile } from '../../src/shared/contracts';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke: request, uid: () => 'new-tab', errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));
type Tab = AppSettings['tabs'][number];
const query = (id: string, patch: Partial<Tab> = {}): Tab => ({ id, kind: 'query', title: '同名', connectionId: 'c', sql: '原文', ...patch });
const table = (id: string): Tab => ({ id, kind: 'table', title: '同名', connectionId: 'other', database: 'db', table: 'subject' });
const fileId = '11111111-1111-4111-8111-111111111111';

describe('工作台重排沿真实store及原配置持久化通道', () => {
  let workspace: typeof import('../../src/renderer/store');
  beforeEach(async () => {
    vi.useFakeTimers(); vi.resetModules(); request.mockReset(); request.mockResolvedValue(undefined); vi.stubGlobal('window', new EventTarget());
    workspace = await import('../../src/renderer/store'); workspace.useWorkspace.setState({ ready: true });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  function install(tabs: Tab[], activeTabId = tabs[0]?.id) { workspace.useWorkspace.setState({ settings: { ...workspace.useWorkspace.getState().settings, tabs, activeTabId } }); request.mockClear(); return workspace.useWorkspace.getState().tabOrderSnapshot(); }

  it('100混合/同名跨连接标签只移动原对象，活动页/dirty/任务/表草稿/文件视图保持', () => {
    const tabs = Array.from({ length: 100 }, (_, index) => index % 2 ? table('t' + index) : query('q' + index)); tabs[0] = query('q0', { fileSourceBinding: { id: fileId, revision: 1 } });
    const dirtyTabs = { q0: true, t1: true }, activeJobs = { q0: true }, tableLayoutDrafts = { t1: true }, queryFileDirty = { q0: false }, queryFileTasks = {}, queryFileOpenings = {};
    workspace.useWorkspace.setState({ dirtyTabs, activeJobs, tableLayoutDrafts, queryFileDirty, queryFileTasks, queryFileOpenings, selection: { connectionId: 'c', database: 'original' }, tasks: [{ id: 'task', kind: 'query.execute', status: 'running', progress: 1, message: '保留', startedAt: '原时刻' }] });
    const refs = install(tabs, 'q0'), before = workspace.useWorkspace.getState(); expect(before.moveTab(refs[99], { kind: 'direction', direction: 'first' })).toBe(true);
    const now = workspace.useWorkspace.getState(); expect(now.settings.tabs).toEqual([tabs[99], ...tabs.slice(0, 99)]); for (const tab of tabs) expect(now.settings.tabs.find(item => item.id === tab.id)).toBe(tab);
    expect(now.settings.activeTabId).toBe('q0'); expect(now.dirtyTabs).toBe(dirtyTabs); expect(now.activeJobs).toBe(activeJobs); expect(now.tableLayoutDrafts).toBe(tableLayoutDrafts); expect(now.queryFileDirty).toBe(queryFileDirty); expect(now.queryFileTasks).toBe(queryFileTasks); expect(now.queryFileOpenings).toBe(queryFileOpenings); expect(now.tasks).toBe(before.tasks); expect(now.selection).toBe(before.selection); expect(now.settings.tabs.find(tab => tab.id === 'q0')?.fileSourceBinding).toBe(tabs[0].fileSourceBinding);
    expect(request).toHaveBeenCalledExactlyOnceWith('settings.save', now.settings);
  });
  it('400毫秒正文待保存期间用旧ref重排最新SQL/标题，立即持久化顺序并取消旧timer', async () => {
    const original = query('a'), other = table('b'), refs = install([original, other], 'a');
    workspace.useWorkspace.getState().updateTab('a', { sql: '最新SQL 9007199254740993😀', title: '最新标题' }); await vi.advanceTimersByTimeAsync(200); expect(request).not.toHaveBeenCalled();
    const edited = workspace.useWorkspace.getState().settings.tabs[0]; expect(edited).not.toBe(original); expect(workspace.useWorkspace.getState().resolveTabOrder(refs[0])).toBe(edited);
    expect(workspace.useWorkspace.getState().moveTab(refs[0], { kind: 'direction', direction: 'last' })).toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith('settings.save', expect.objectContaining({ tabs: [other, edited], activeTabId: 'a' }));
    await vi.advanceTimersByTimeAsync(1000); expect(request).toHaveBeenCalledTimes(1); expect(workspace.useWorkspace.getState().settings.tabs[1]).toBe(edited);
  });
  it('边界/邻位同位/自身/伪造ref不写盘、不切活动标签，也不抹原防抖编辑', async () => {
    const refs = install([query('a'), query('b')], 'b'), state = workspace.useWorkspace.getState();
    expect(state.moveTab(refs[0], { kind: 'direction', direction: 'left' })).toBe(false); expect(state.moveTab(refs[1], { kind: 'direction', direction: 'last' })).toBe(false); expect(state.moveTab(refs[0], { kind: 'relative', target: refs[1], placement: 'before' })).toBe(false); expect(state.moveTab(refs[0], { kind: 'relative', target: refs[0], placement: 'after' })).toBe(false); expect(state.moveTab({ id: 'a', token: {} }, { kind: 'direction', direction: 'last' })).toBe(false); expect(request).not.toHaveBeenCalled();
    state.updateTab('a', { sql: '保留待写正文' }); expect(state.moveTab(refs[0], { kind: 'direction', direction: 'left' })).toBe(false); await vi.advanceTimersByTimeAsync(400); expect(request).toHaveBeenCalledTimes(1); expect(workspace.useWorkspace.getState().settings.activeTabId).toBe('b');
  });
  it('同保存来源的digest和同文件id的revision延续文档token，源id换绑则永久拒旧ref', () => {
    const saved = query('saved', { sourceBinding: { id: 'source', digest: 'a'.repeat(64), context: { state: 'known', database: null } } }), file = query('file', { fileSourceBinding: { id: fileId, revision: 1 } }), refs = install([saved, file]);
    workspace.useWorkspace.getState().updateTab('saved', { sourceBinding: { ...saved.sourceBinding!, digest: 'b'.repeat(64) } }); workspace.useWorkspace.getState().updateTab('file', { fileSourceBinding: { id: fileId, revision: 2 } });
    expect(workspace.useWorkspace.getState().resolveTabOrder(refs[0])?.sourceBinding?.digest).toBe('b'.repeat(64)); expect(workspace.useWorkspace.getState().resolveTabOrder(refs[1])?.fileSourceBinding?.revision).toBe(2);
    workspace.useWorkspace.getState().updateTab('saved', { sourceBinding: { ...saved.sourceBinding!, id: 'other' } }); workspace.useWorkspace.getState().updateTab('saved', { sourceBinding: saved.sourceBinding }); expect(workspace.useWorkspace.getState().resolveTabOrder(refs[0])).toBeUndefined();
    workspace.useWorkspace.getState().updateTab('file', { fileSourceBinding: { id: '22222222-2222-4222-8222-222222222222', revision: 1 } }); workspace.useWorkspace.getState().updateTab('file', { fileSourceBinding: file.fileSourceBinding }); expect(workspace.useWorkspace.getState().resolveTabOrder(refs[1])).toBeUndefined();
  });
  it.each([{ connectionId: 'other' }, { databaseContext: { state: 'known', database: null } }, { databaseContext: { state: 'unknown' } }, { database: 'another' }] as Partial<Tab>[])('连接/库上下文%j的正式update A→B→A拒绝旧ref', patch => {
    const original = query('a'), refs = install([original, query('b')]); workspace.useWorkspace.getState().updateTab('a', patch); workspace.useWorkspace.getState().updateTab('a', { connectionId: original.connectionId, database: original.database, databaseContext: original.databaseContext });
    request.mockClear(); expect(workspace.useWorkspace.getState().moveTab(refs[0], { kind: 'direction', direction: 'last' })).toBe(false); expect(request).not.toHaveBeenCalled();
  });
  it('generic同id对象替换不继承令牌；直接setState删除后同一原对象重加也不复活', () => {
    const original = query('a'), refs = install([original, query('b')]); workspace.useWorkspace.getState().updateSettings({ tabs: [{ ...original }, workspace.useWorkspace.getState().settings.tabs[1]] }); expect(workspace.useWorkspace.getState().resolveTabOrder(refs[0])).toBeUndefined();
    const now = workspace.useWorkspace.getState().settings.tabs[0], newer = workspace.useWorkspace.getState().tabOrderSnapshot()[0], settings = workspace.useWorkspace.getState().settings;
    workspace.useWorkspace.setState({ settings: { ...settings, tabs: settings.tabs.filter(tab => tab !== now) } }); workspace.useWorkspace.setState({ settings: { ...settings, tabs: [now, settings.tabs[1]] } }); expect(workspace.useWorkspace.getState().resolveTabOrder(newer)).toBeUndefined();
  });
  it('工作区恢复即使拿回同一tab对象也换整轮token，普通notice/任务通知不换', async () => {
    const tabs = [query('a'), query('b')], refs = install(tabs), settings = workspace.useWorkspace.getState().settings;
    workspace.useWorkspace.getState().notify('普通通知'); workspace.useWorkspace.getState().onTask({ taskId: 'x', status: 'running', progress: 0, message: '任务' }); expect(workspace.useWorkspace.getState().resolveTabOrder(refs[0])).toBe(tabs[0]);
    request.mockImplementation((command: string) => Promise.resolve(command === 'settings.get' ? settings : [])); await workspace.useWorkspace.getState().initialize(); expect(workspace.useWorkspace.getState().settings.tabs[0]).toBe(tabs[0]); expect(workspace.useWorkspace.getState().resolveTabOrder(refs[0])).toBeUndefined();
  });
  it('超100或重复组不发布部分ref，恢复旧对象后旧ref仍失效且不触DB', () => {
    const tabs = [query('a'), query('b')], refs = install(tabs), settings = workspace.useWorkspace.getState().settings;
    workspace.useWorkspace.setState({ settings: { ...settings, tabs: Array.from({ length: 101 }, (_, index) => query(String(index))) } }); expect(() => workspace.useWorkspace.getState().tabOrderSnapshot()).toThrow(); workspace.useWorkspace.setState({ settings }); expect(workspace.useWorkspace.getState().resolveTabOrder(refs[0])).toBeUndefined();
    const newer = workspace.useWorkspace.getState().tabOrderSnapshot()[0]; workspace.useWorkspace.setState({ settings: { ...settings, tabs: [tabs[0], tabs[0]] } }); expect(workspace.useWorkspace.getState().moveTab(newer, { kind: 'direction', direction: 'last' })).toBe(false); expect(request).not.toHaveBeenCalled();
  });
  it('重排不夺取原文件打开占位授权，也不改原queryFileOpenings view', () => {
    const origin = query('origin'), target = query('loading', { sql: '' }), profile: ConnectionProfile = { id: 'c', name: '离线合成', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: 'offline' };
    install([origin, query('other')]); workspace.useWorkspace.setState({ connections: [profile] }); const lease = workspace.beginQueryFileOpen(origin, target, () => true), before = workspace.useWorkspace.getState().queryFileOpenings;
    const ref = workspace.useWorkspace.getState().tabOrderSnapshot().find(ref => ref.id === target.id)!; expect(workspace.useWorkspace.getState().moveTab(ref, { kind: 'direction', direction: 'first' })).toBe(true); expect(lease.current()).toBe(true); expect(workspace.useWorkspace.getState().queryFileOpenings).toBe(before);
    expect(lease.apply('已加载完整SQL', { ref: { id: fileId, revision: 1 }, name: '源文件.sql', displayPath: '公开合成位置', encoding: 'utf8', bom: 'none', eol: 'none', savedSqlDigest: 'a'.repeat(64) })).toBe(true); expect(workspace.useWorkspace.getState().settings.tabs.find(tab => tab.id === target.id)?.sql).toBe('已加载完整SQL'); expect(workspace.useWorkspace.getState().resolveTabOrder(ref)).toBeUndefined();
    expect(request.mock.calls.every(([command]) => command === 'settings.save')).toBe(true);
  });
});
