import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { connectionReplacementAcknowledgements } from '../../src/shared/connectionTransfer';
import { connectionsTransferZh as text } from '../../src/renderer/locales/connectionsTransfer.zh-CN';
import { assertQueryFileSourceSettings, assertQueryFileSourceSql, sameQueryFileSource } from '../../src/shared/queryFileSources';
import { queryFilesZh } from '../../src/renderer/locales/queryFiles.zh-CN';

/** 提取真实统一提交/持久化/打开lease；Zustand与校验器真实执行，仅IPC和计时器为RAM。 */
function settingsFixture() {
  const source = readFileSync(new URL('../../src/renderer/store.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('store.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Set(['commitWorkspaceSettings', 'persist', 'beginQueryFileOpen', 'wasQueryFileOpenTarget']), functions: string[] = []; let update = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) functions.push(node.getText(tree));
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'updateSettings') update = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); if (functions.length !== names.size || !update) throw Error('缺少真实配置提交或文件打开函数');
  const invoke = vi.fn(async (_command: string, _input: unknown) => undefined), notify = vi.fn();
  const store = createStore<any>(() => ({ settings: { tabs: [] }, queryFileDirty: {}, queryFileOpenings: {}, dirtyTabs: {}, connections: [{ id: 'target' }], connectionVersions: { target: 0 }, notify }));
  let sequence = 0;
  const timers = new Map<number, () => void>(), schedule = vi.fn((action: () => void, _delay: number) => { const id = ++sequence; timers.set(id, action); return id; });
  const port = createContext({ exports: {}, JSON, Error, WeakSet, queryFileOpenTargets: new WeakSet(), useWorkspace: store, assertQueryFileSourceSettings, assertQueryFileSourceSql, sameQueryFileSource, queryFilesZh, invoke, errorMessage: String, saveTimer: undefined,
    setTimeout: schedule, clearTimeout: (id: number | undefined) => { if (id !== undefined) timers.delete(id); },
  });
  runInContext(ts.transpileModule(functions.join('\n') + '\nglobalThis.update=(' + update + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, port);
  // 观察包装仍调用提取的真实persist，不能用空stub绕过400ms正文保存。
  const realPersist = port.persist, persist = vi.fn((settings: unknown) => realPersist(settings)); port.persist = persist;
  return { port, store, invoke, persist, schedule, timers, drain: () => { for (const [id, action] of [...timers]) { timers.delete(id); action(); } } };
}

/** 只回放生产处理器和门表达式，不启动浏览器、DOM、Electron或原生剪贴板。 */
function fixture() {
  const source = readFileSync(new URL('../../src/renderer/components/ConnectionsTransferDialog.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('dialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = new Map<string, string>(); let confirmed = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && ['clearReview', 'changeDecision', 'execute', 'reviewReplacement', 'choose'].includes(node.name.text)) functions.set(node.name.text, node.getText(tree));
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'confirmed') confirmed = node.initializer!.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); if (functions.size !== 5 || !confirmed) throw Error('缺少生产确认处理器');
  const state = { previewToken: 'preview', expiresAt: new Date(Date.now() + 100000).toISOString(), entries: [] };
  const review = { confirmationToken: 'confirmation', entries: [] };
  const invoke = vi.fn<(...args: any[]) => Promise<any>>(async (command: string) => command === 'connections.importApply' ? { connections: [], added: 0, replaced: 1, skipped: 0, replacementIds: ['target'] } : undefined);
  const workspace = { setConnections: vi.fn(), invalidateConnection: vi.fn() };
  const port = createContext({ Date, Error, Set, structuredClone, connectionReplacementAcknowledgements, text, errorMessage: String, formatText: (value: string) => value, invoke, useWorkspace: { getState: () => workspace }, flushSettings: vi.fn(async () => undefined),
    mode: 'import', file: { token: 'file', name: 'source.json' }, preview: state, decisions: [{ sourceId: 'source', action: 'replace', targetId: 'target' }], staged: true, review, replacing: true, confirmed: true, acknowledged: new Set(connectionReplacementAcknowledgements),
    lock: { current: false }, sequence: { current: 0 }, currentPreview: { current: state }, currentReview: { current: review }, applied: { current: false }, done: '', selected: new Set(), canReview: true,
    setBusy: vi.fn(), setError: vi.fn(), setDone: vi.fn(), setFailed: vi.fn(), setStaged: vi.fn(), setPreview: vi.fn(), setFile: vi.fn(), setReview: vi.fn(), setAcknowledged: vi.fn(), setDecisions: vi.fn(),
  });
  runInContext(ts.transpileModule([...functions.values()].join('\n') + '\nglobalThis.handlers={execute,changeDecision,clearReview,reviewReplacement,choose,confirmed:()=>(' + confirmed + ')};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, port);
  return { port, invoke, workspace };
}

describe('C03确认与布局事实的纯回放', () => {
  it.each(connectionReplacementAcknowledgements)('缺%s时生产最终门关闭，不能发起替换', async id => {
    const f = fixture(); f.port.acknowledged.delete(id); f.port.confirmed = f.port.handlers.confirmed();
    expect(f.port.confirmed).toBe(false); await f.port.handlers.execute(); expect(f.invoke).not.toHaveBeenCalled();
  });
  it('缺二次审阅同样关闭最终门，默认新增仍不要求替换风险', () => {
    const f = fixture(); f.port.review = null; expect(f.port.handlers.confirmed()).toBe(false); f.port.replacing = false; expect(f.port.handlers.confirmed()).toBe(true);
  });
  it('同目标重选也清除审阅/全部风险与暂存确认，并只释放当前令牌', () => {
    const f = fixture(); f.port.handlers.changeDecision('source', { sourceId: 'source', action: 'replace', targetId: 'target' });
    expect(f.port.currentReview.current).toBeNull(); expect(f.port.setReview).toHaveBeenCalledWith(null); expect(f.port.setAcknowledged.mock.calls[0][0].size).toBe(0); expect(f.port.setStaged).toHaveBeenCalledWith(false);
    expect(f.invoke).toHaveBeenCalledWith('connections.importReviewRelease', { previewToken: 'preview', confirmationToken: 'confirmation' });
  });
  it('双击只发一次最终提交，成功仅失效明确替换ID，不连接/关闭/执行或重放', async () => {
    const f = fixture(); let finish!: (value: unknown) => void; f.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const applying = f.port.handlers.execute(); await f.port.handlers.execute();
    expect(f.invoke.mock.calls.filter(([command]) => command === 'connections.importApply')).toHaveLength(1);
    finish({ connections: [], added: 0, replaced: 1, skipped: 0, replacementIds: ['target'] }); await applying;
    expect(f.workspace.invalidateConnection.mock.calls).toEqual([['target']]); expect(f.port.applied.current).toBe(true); expect(f.invoke.mock.calls.map(([command]) => command)).toEqual(['connections.importApply']);
  });
  it('提交失败清空预览和确认、不重试；迟到审阅只释放，不重新发布', async () => {
    const f = fixture(); f.invoke.mockRejectedValueOnce(Error('合成CAS失败')); await f.port.handlers.execute();
    expect(f.port.setPreview).toHaveBeenCalledWith(null); expect(f.invoke.mock.calls.filter(([command]) => command === 'connections.importApply')).toHaveLength(1);
    const g = fixture(); g.port.currentReview.current = null; let finish!: (value: unknown) => void;
    g.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const reviewing = g.port.handlers.reviewReplacement();
    g.port.handlers.clearReview(); finish({ confirmationToken: 'late', entries: [] }); await reviewing;
    expect(g.port.currentReview.current).toBeNull(); expect(g.invoke).toHaveBeenCalledWith('connections.importReviewRelease', { previewToken: 'preview', confirmationToken: 'late' }); expect(g.port.setReview.mock.calls.every(([value]: unknown[]) => value === null)).toBe(true);
  });
  it('源文件重选前先撤销确认并同步标签；默认决策仍只有新增或跳过', async () => {
    const f = fixture(); f.invoke.mockImplementation(async command => command === 'files.choose' ? { token: 'new-file', name: 'new.json' } : command === 'connections.importPreview' ? { previewToken: 'next', entries: [{ sourceId: 'same', matches: [{}] }, { sourceId: 'fresh', matches: [] }] } : undefined);
    await f.port.handlers.choose(); expect(f.port.flushSettings).toHaveBeenCalledOnce();
    expect(f.port.setDecisions).toHaveBeenCalledWith([{ sourceId: 'same', action: 'skip' }, { sourceId: 'fresh', action: 'add' }]); expect(f.port.setStaged).toHaveBeenCalledWith(false);
  });
  it('标签身份即时保存而正文继续防抖，主进程不会只看到400ms前的空标签', () => {
    const { port, invoke, persist, schedule, timers, drain } = settingsFixture();
    port.update({ tabs: [{ id: 'tab', connectionId: 'target', kind: 'table' }] }); expect(invoke).toHaveBeenCalledOnce(); expect(persist).not.toHaveBeenCalled();
    port.update({ tabs: [{ id: 'tab', connectionId: 'target', kind: 'table', sql: '正文变更' }] }); expect(invoke).toHaveBeenCalledOnce(); expect(persist).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 400); expect(timers.size).toBe(1);
    drain(); expect(invoke).toHaveBeenCalledTimes(2); expect(invoke.mock.calls[1]).toEqual(['settings.save', { tabs: [{ id: 'tab', connectionId: 'target', kind: 'table', sql: '正文变更' }] }]);
  });
  it('文件占位与opening原子登记，完整来源正文与解除阶段同次提交', () => {
    const f = settingsFixture(), origin = { id: 'origin', kind: 'query', connectionId: 'target', sql: '原查询' }, target = { id: 'file', kind: 'query', connectionId: 'target', sql: '' };
    f.port.update({ tabs: [origin], activeTabId: origin.id }); f.invoke.mockClear();
    const notifications: any[] = []; f.store.subscribe(state => notifications.push(state));
    const lease = f.port.beginQueryFileOpen(origin, target, () => true);
    expect(notifications).toHaveLength(1); expect(notifications[0].settings.tabs[1]).toBe(target); expect(notifications[0].queryFileOpenings.file.target).toBe(target);
    expect(f.invoke).toHaveBeenCalledExactlyOnceWith('settings.save', expect.objectContaining({ tabs: [origin, target] })); expect(f.port.wasQueryFileOpenTarget(target)).toBe(true);
    const sql = 'SELECT 1;\nSELECT 2;', binding = { ref: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1 }, name: '完整LF.sql' };
    expect(lease.apply(sql, binding)).toBe(true); expect(notifications).toHaveLength(2);
    const loaded = notifications[1].settings.tabs[1]; expect(loaded).not.toBe(target); expect(loaded).toMatchObject({ id: target.id, sql, fileSourceBinding: binding.ref });
    expect(notifications[1].queryFileOpenings.file).toBeUndefined(); expect(notifications[1].settings.activeTabId).toBe(target.id); expect(notifications[1].queryFileDirty.file).toBe(true);
    expect(f.port.wasQueryFileOpenTarget(loaded)).toBe(false); expect(lease.apply('迟到正文', binding)).toBe(false);
  });
  it.each(['view', 'connection'] as const)('打开期间%s父门失效后恢复也不能消费原文回包', changed => {
    const f = settingsFixture(), origin = { id: 'origin', kind: 'query', connectionId: 'target', sql: '原查询' }, target = { id: 'file', kind: 'query', connectionId: 'target', sql: '' }; let alive = true;
    f.port.update({ tabs: [origin], activeTabId: origin.id }); const lease = f.port.beginQueryFileOpen(origin, target, () => alive);
    if (changed === 'view') { alive = false; expect(lease.current()).toBe(false); alive = true; }
    else { f.store.setState({ connectionVersions: { target: 1 } }); f.store.setState({ connectionVersions: { target: 0 } }); }
    expect(lease.current()).toBe(false); expect(lease.apply('迟到正文', { name: '迟到.sql', ref: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1 } })).toBe(false);
    expect(f.store.getState().settings.tabs[1]).toBe(target); expect(target.sql).toBe(''); lease.dispose(true); expect(f.store.getState().settings.tabs).toEqual([origin]);
  });
});
