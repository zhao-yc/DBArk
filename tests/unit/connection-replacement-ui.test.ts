import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { connectionReplacementAcknowledgements } from '../../src/shared/connectionTransfer';
import { connectionsTransferZh as text } from '../../src/renderer/locales/connectionsTransfer.zh-CN';
import { assertQueryFileSourceSettings, sameQueryFileSource } from '../../src/shared/queryFileSources';

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
    const source = readFileSync(new URL('../../src/renderer/store.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('store.ts', source, ts.ScriptTarget.Latest, true);
    let update = ''; function visit(node: ts.Node) { if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'updateSettings') update = node.initializer.getText(tree); ts.forEachChild(node, visit); } visit(tree); if (!update) throw Error('缺少生产布局更新器');
    const current = { settings: { tabs: [] as unknown[] }, queryFileDirty: {}, notify: vi.fn() }, invoke = vi.fn(async () => undefined), persist = vi.fn();
    // 原更新器新增的来源验证与引用比较使用真实实现，不用空函数绕过校验。
    const port = createContext({ JSON, clearTimeout, assertQueryFileSourceSettings, sameQueryFileSource, saveTimer: undefined, get: () => current, set: (value: unknown) => Object.assign(current, value), invoke, persist, errorMessage: String });
    runInContext(ts.transpileModule('globalThis.update=(' + update + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, port);
    port.update({ tabs: [{ id: 'tab', connectionId: 'target', kind: 'table' }] }); expect(invoke).toHaveBeenCalledOnce(); expect(persist).not.toHaveBeenCalled();
    port.update({ tabs: [{ id: 'tab', connectionId: 'target', kind: 'table', sql: '正文变更' }] }); expect(invoke).toHaveBeenCalledOnce(); expect(persist).toHaveBeenCalledOnce();
  });
});
