import { describe, expect, it, vi } from 'vitest';
import { mainColumnsHarness } from './main-columns-owner-harness';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';

/** 运行现有AST夹具提取的真实Main IPC/dispatch；存储原子性由SQLite专项验证。 */
function fixture() {
  const f = mainColumnsHarness(), snapshot = { revision: 'a'.repeat(64), groups: [], unfiledCount: 0, totalCount: 0 }, get = vi.fn(() => snapshot), apply = vi.fn(() => snapshot), forbidden = vi.fn(() => { throw Error('组织命令不得触碰连接、任务、历史或Engine'); });
  Object.assign(f.context.store, { queryOrganization: get, applyQueryOrganization: apply, saveTask: forbidden, saveHistory: forbidden, resolveConnection: forbidden, queries: forbidden }); f.context.connectionConfig.assertAvailable = forbidden; f.request.mockImplementation(forbidden);
  return { ...f, snapshot, get, apply, forbidden };
}

describe('保存查询组织真实Main IPC与严格白名单', () => {
  it('仅公开两个无任务组织命令，经真实wrapper分发并保持零Engine/任务/历史', async () => {
    const f = fixture(); expect(publicCommands['queries.organizationGet']).toBe(true); expect(publicCommands['queries.organizationApply']).toBe(true);
    expect(await f.run('queries.organizationGet', {})).toEqual(f.snapshot); const input = { expectedRevision: 'a'.repeat(64), operation: { kind: 'create', name: '本地组', parentId: null } }; expect(await f.run('queries.organizationApply', input)).toEqual(f.snapshot); expect(f.get).toHaveBeenCalledOnce(); expect(f.apply).toHaveBeenCalledExactlyOnceWith(input); expect(f.forbidden).not.toHaveBeenCalled(); expect(f.tasks.size).toBe(0); expect(f.events).toEqual([]);
  });
  it.each(['queries.organizationGet', 'queries.organizationApply'])('退出期间%s在任何存储调用前拒绝', async command => {
    const f = fixture(); f.context.shuttingDown = true; const input = command.endsWith('Get') ? {} : { expectedRevision: 'a'.repeat(64), operation: { kind: 'dissolve', id: '原组' } }; await expect(f.run(command, input)).rejects.toThrow('退出'); expect(f.get).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });
  it('严格schema拒绝自造创建ID、任意SQL/路径/秘密、任务号及全量查询', async () => {
    const f = fixture(), input = { expectedRevision: 'a'.repeat(64), operation: { kind: 'create', name: '本地组', parentId: null } };
    for (const extra of [{ taskId: '伪任务' }, { sql: 'SELECT 1' }, { password: '合成秘密' }, { path: 'C:/不能写' }, { queries: [] }]) expect((await f.invoke('queries.organizationApply', { ...input, ...extra })).ok).toBe(false);
    expect((await f.invoke('queries.organizationApply', { ...input, operation: { ...input.operation, id: 'renderer分配' } })).ok).toBe(false); expect((await f.invoke('queries.organizationGet', { taskId: '伪任务' })).ok).toBe(false); expect(f.get).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });
  it('原IPC拒绝其它窗口、旧frame与未知命令，不能旁路本地组织入口', async () => {
    const f = fixture(), event = f.event(); for (const sender of [{ ...event, sender: {} }, { ...event, senderFrame: { ...event.senderFrame } }]) expect((await f.invoke('queries.organizationGet', {}, sender)).ok).toBe(false);
    expect((await f.invoke('queries.organizationDelete', {})).ok).toBe(false); expect(f.get).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });
  it('全部五种operation经过原校验，错误摘要与重复目标不进入存储', () => {
    const revision = 'a'.repeat(64), operations = [{ kind: 'create', name: '组', parentId: null }, { kind: 'rename', id: '组', name: '新名' }, { kind: 'moveGroup', id: '组', parentId: null }, { kind: 'dissolve', id: '组' }, { kind: 'moveQueries', queries: [{ id: '查询', digest: 'b'.repeat(64) }], groupId: null }];
    for (const operation of operations) expect(validateCommand('queries.organizationApply', { expectedRevision: revision, operation })).toEqual({ expectedRevision: revision, operation });
    for (const queries of [[{ id: '查询', digest: 'bad' }], [{ id: '查询', digest: revision }, { id: '查询', digest: revision }], []]) expect(() => validateCommand('queries.organizationApply', { expectedRevision: revision, operation: { kind: 'moveQueries', queries, groupId: null } })).toThrow();
  });
});
