import { emptyTableFilteredDeleteOwners } from './table-filtered-delete-owner-fixture';
import { emptyTableFilteredUpdateOwners } from './table-filtered-update-owner-fixture';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { connectionOrganizationZh } from '../../src/shared/connectionOrganization.zh-CN';

/** 执行真实Main分派；存储CAS由独立SQLite测试覆盖，本例只替换持久化/引擎边界。 */
function harness(shuttingDown = false) {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function dispatch('), source.indexOf('/** 按平台生成中文原生菜单'));
  const snapshot = { revision: 2, connections: [] }, get = vi.fn(() => snapshot), apply = vi.fn(() => snapshot), available = vi.fn(), request = vi.fn(() => { throw Error('不允许引擎调用'); });
  const tasks = new Map(), has = vi.fn(() => false), invalidateAll = vi.fn();
  const context = createContext({ filteredDeletes: emptyTableFilteredDeleteOwners(), filteredUpdates: emptyTableFilteredUpdateOwners(),
    // 未打开结果写入用途时的真实初始空协调器，不登记任务、预览或写入能力。
    resultInserts: { observe() {}, invalidateConnection(_connectionId: string) {}, engineExited() {}, has: (_taskId: string) => false },
     shuttingDown, tasks, queryInsertExports: { has, invalidateAll }, connectionOrganizationZh, structureTokens: new Map(), sessions: new Map(), savedQueryPages: undefined, historyPages: undefined, store: { connectionOrganization: get, applyConnectionOrganization: apply }, connectionConfig: { assertAvailable: available }, broker: { request } });
  runInContext(ts.transpileModule(body + '\nglobalThis.dispatch=dispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { get, apply, available, request, snapshot, tasks, has, invalidateAll, dispatch: context.dispatch as (command: string, input: unknown) => Promise<unknown> };
}
it('整理读取只取公开存储概要，不触引擎或秘密解析', async () => { const f = harness(); await expect(f.dispatch('connections.organizationGet', {})).resolves.toEqual(f.snapshot); expect(f.get).toHaveBeenCalledOnce(); expect(f.request).not.toHaveBeenCalled(); });
it('同步检查整批目标可用后一次交存储，不创建查询任务或重连', async () => {
  const f = harness(), input = { expectedRevision: 1, ids: ['a', 'b'], changes: { group: '新组', color: '#123456' } };
  await expect(f.dispatch('connections.organizationApply', input)).resolves.toEqual(f.snapshot); expect(f.available.mock.calls).toEqual([[undefined], ['a'], ['b']]); expect(f.apply).toHaveBeenCalledExactlyOnceWith(input); expect(f.request).not.toHaveBeenCalled();
});
it('任一连接正在保存时，在任何存储变更之前整批拒绝', async () => {
  const f = harness(); f.available.mockImplementation(id => { if (id === 'b') throw Error('配置正在保存'); });
  await expect(f.dispatch('connections.organizationApply', { expectedRevision: 1, ids: ['a', 'b'], changes: { group: '' } })).rejects.toThrow('配置正在保存'); expect(f.apply).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
});
it.each(['connections.organizationGet', 'connections.organizationApply'])('退出期间%s不进入存储或引擎', async command => {
  const f = harness(true); await expect(f.dispatch(command, { ids: ['a'] })).rejects.toThrow('退出'); expect(f.get).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
});
it.each(['running', 'completed', 'cancelled', 'failed'])('INSERT 导出账本未释放时即使状态为%s仍拒绝整理其他连接', async status => {
  const f = harness(); f.tasks.set('export', { id: 'export', kind: 'query.exportStream', status, connectionId: 'other' }); f.has.mockReturnValue(true);
  await expect(f.dispatch('connections.organizationApply', { expectedRevision: 1, ids: ['a'], changes: { group: '' } })).rejects.toThrow(connectionOrganizationZh.busyExport);
  expect(f.has).toHaveBeenCalledWith('export'); expect(f.apply).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled(); expect(f.invalidateAll).not.toHaveBeenCalled();
});
it.each(['running', 'completed'])('没有 INSERT 账本的%s流式导出不阻止整理', async status => {
  const f = harness(); f.tasks.set('export', { id: 'export', kind: 'query.exportStream', status });
  await expect(f.dispatch('connections.organizationApply', { expectedRevision: 1, ids: ['a'], changes: { group: '' } })).resolves.toEqual(f.snapshot);
  expect(f.apply).toHaveBeenCalledOnce(); expect(f.request).not.toHaveBeenCalled(); expect(f.invalidateAll).not.toHaveBeenCalled();
});
