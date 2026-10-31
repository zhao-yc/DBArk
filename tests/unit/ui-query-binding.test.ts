import { queryDialectVm } from '../helpers/queryDialectVm';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { savedQueryOriginContext, type QuerySourceBinding } from '../../src/shared/queryBinding';
import { resolveQueryDatabase, queryDatabaseFromSession } from '../../src/shared/queryContext';
import { queryBindingZh } from '../../src/renderer/locales/queryBinding.zh-CN';
import { queryContextZh } from '../../src/renderer/locales/queryContext.zh-CN';
import type { WorkspaceTab } from '../../src/renderer/store';

/** 运行真实保存函数，隔离编辑器与 IPC，核对快照、上下文和失败时的绑定推进。 */
function fixture(tab: Partial<WorkspaceTab> = {}, sessionId = '') {
  const text = readFileSync(new URL('../../src/renderer/components/QueryTab.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('QueryTab.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let source = ''; function find(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'saveQuery') source = node.getText(file); ts.forEachChild(node, find); } find(file);
  const current: WorkspaceTab = { id: 'draft', title: '查询', kind: 'query', connectionId: 'c', sql: '编辑器 SQL', ...tab };
  const result = { name: '名称', source: { ...current.sourceBinding, id: 'new-source', digest: 'b'.repeat(64), context: { state: 'known', database: null } } };
  const invoke = vi.fn(async (command: string) => command === 'query.completionState' ? { databaseKnown: true, database: null } : result);
  const updateTab = vi.fn(), notify = vi.fn(), workspace = { settings: { tabs: [current] }, setBusy: vi.fn(), updateTab, notify };
  const context = createContext({ ...queryDialectVm(),  tab: current, busyRef: { current: false }, sessionRef: { current: sessionId }, editor: { current: { getModel: () => ({ getValue: () => '完整 SQL 900719925474099312345' }) } }, connection: { database: '连接默认库' }, useWorkspace: { getState: () => workspace }, invoke, setBusy: vi.fn(), setSave: vi.fn(), flushSettings: vi.fn(async () => {}), rememberDatabase: vi.fn(), savedQueryOriginContext, queryDatabaseFromSession, resolveQueryDatabase, queryBindingZh, queryContextZh, errorMessage: String });
  runInContext(ts.transpileModule(source + '\nglobalThis.save = saveQuery', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { invoke, updateTab, context, current, save: context.save as (action: 'create' | 'update', name: string) => Promise<void> };
}
const binding = (context: QuerySourceBinding['context']): QuerySourceBinding => ({ id: 'source', digest: 'a'.repeat(64), connectionId: 'c', connectionDigest: 'c'.repeat(64), context });
describe('保存查询真实界面函数', () => {
  it.each([{ state: 'known', database: 'db' }, { state: 'known', database: null }, { state: 'unknown' }, { state: 'legacy', database: 'legacy_db' }] as const)('无会话保存保留来源上下文 %j', async context => {
    const f = fixture({ database: context.state === 'legacy' ? context.database : undefined, databaseContext: context.state === 'legacy' ? undefined : context, sourceBinding: binding(context) });
    await f.save('update', '名称'); expect(f.invoke).toHaveBeenCalledExactlyOnceWith('queries.updateSource', { source: f.current.sourceBinding, content: { name: '名称', sql: '完整 SQL 900719925474099312345', connectionId: 'c', context } });
  });
  it('普通未绑定草稿创建新记录，不能用标签编号覆盖来源', async () => {
    const f = fixture(); await f.save('create', '名称'); expect(f.invoke).toHaveBeenCalledExactlyOnceWith('queries.create', { name: '名称', sql: '完整 SQL 900719925474099312345', connectionId: 'c', context: { state: 'known', database: '连接默认库' } }); expect(f.updateTab).toHaveBeenCalledWith('draft', expect.objectContaining({ sourceBinding: expect.objectContaining({ id: 'new-source' }) }));
  });
  it('已建立会话只读协议状态且失败不推进来源摘要，不执行 SQL 或暗建会话', async () => {
    const f = fixture({ sourceBinding: binding({ state: 'known', database: 'db' }) }, 'session');
    f.invoke.mockImplementation(async command => { if (command === 'query.completionState') return { databaseKnown: true, database: null } as never; throw Error('原查询已修改'); });
    await expect(f.save('update', '名称')).rejects.toThrow('已修改'); expect(f.invoke.mock.calls.map(call => call[0])).toEqual(['query.completionState', 'queries.updateSource']); expect(f.updateTab).not.toHaveBeenCalled(); expect(f.context.busyRef.current).toBe(false);
  });
});
