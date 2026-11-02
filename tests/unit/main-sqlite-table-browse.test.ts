import { describe, expect, it, vi } from 'vitest';
import { mainColumnsHarness, deferred } from './main-columns-owner-harness';

const profile = { id: 'sqlite-file', name: '本例文件', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: '仅作已存概要，不打开文件', readOnly: true, busyTimeoutMs: 1000 } };
const input = { connectionId: profile.id, database: 'main', table: 'subject', taskId: 'read-page', offset: 0, limit: 10, mode: 'and', filters: [], sort: [] };
const page = { schemaKey: 'a'.repeat(64), target: { connectionId: profile.id, database: 'main', table: 'subject', kind: 'table' }, columns: [], result: { columns: [], rows: [], elapsedMs: 0, truncated: false, statement: '' }, offset: 0, limit: 10, hasMore: false };

/** 经过正式IPC校验与Main分派；只替换数据库执行边界，不打开本机文件或网络连接。 */
describe('SQLite表页Main任务边界', () => {
  it.each(['count-desc', 'count-asc'] as const)('次数排序%s通过原IPC原样交付并绑定晚发布门', async order => {
    const request = { connectionId: profile.id, database: 'main', table: 'subject', column: 'n', schemaKey: 'a'.repeat(64), taskId: 'frequency', mode: 'and', filters: [], search: '', order };
    const f = mainColumnsHarness(); Object.assign(f.context.store, { connections: () => [profile] }); f.request.mockImplementation(async (command, input) => { expect(command).toBe('sqlite.valueOptions'); expect(input).toEqual(request); return { request, values: [], truncated: false }; });
    expect(await f.invoke('sqlite.valueOptions', request)).toEqual({ ok: true, result: { request, values: [], truncated: false } }); expect(f.request).toHaveBeenCalledTimes(1);
    const bad = mainColumnsHarness(); Object.assign(bad.context.store, { connections: () => [profile] }); expect((await bad.invoke('sqlite.valueOptions', { ...request, order: 'DESC' })).ok).toBe(false); expect(bad.request).not.toHaveBeenCalled();
  });
  it('不同值通过真实IPC校验与Main分派，不进入查询历史；原窗口和连接修订变化拒绝晚发布', async () => {
    const request = { connectionId: profile.id, database: 'main', table: 'subject', column: 'v', schemaKey: 'a'.repeat(64), taskId: 'value-options', mode: 'and', filters: [], search: '敏感搜索' };
    for (const mode of ['current', 'revision', 'destroyed', 'blocked'] as const) {
      const f = mainColumnsHarness(), pending = deferred(); Object.assign(f.context.store, { connections: () => [profile], addHistory: () => { throw Error('不同值不得添加用户历史'); } });
      f.request.mockImplementation(async (command, input) => { expect(command).toBe('sqlite.valueOptions'); expect(input).toEqual(request); expect(input).not.toHaveProperty('profile'); return pending.promise; });
      const reading = f.invoke('sqlite.valueOptions', request); expect(f.request).toHaveBeenCalledTimes(1);
      if (mode === 'revision') f.setRevision(99); if (mode === 'destroyed') f.context.window.destroyContents(); if (mode === 'blocked') { f.setBlocked(true); f.context.connectionConfig.assertAvailable = (id: string) => { expect(id).toBe(profile.id); throw Error('准确SQLite连接配置正在保存'); }; }
      const output = { request, values: [], truncated: false }; pending.resolve(output); const reply = await reading;
      if (mode === 'current') expect(reply).toEqual({ ok: true, result: output }); else { expect(reply.ok, mode).toBe(false); expect(reply).not.toHaveProperty('result'); }
      expect(f.request).toHaveBeenCalledTimes(1); expect(f.context.preparingTasks.size).toBe(0);
    }
  });
  it('已保存SQLite概要只交给对应任务，不解密网络秘密、不添加SQL执行历史', async () => {
    const f = mainColumnsHarness(), saveTask = vi.fn();
    Object.assign(f.context.store, { connections: () => [profile], saveTask, addHistory: () => { throw Error('表浏览不能进入查询历史'); } });
    f.request.mockImplementation(async (command, value) => { expect(command).toBe('sqlite.tablePage'); expect(value).toEqual(input); expect(value).not.toHaveProperty('profile'); return page; });
    await expect(f.run('sqlite.tablePage', input)).resolves.toEqual(page);
    expect(f.request).toHaveBeenCalledOnce(); expect(f.tasks.get(input.taskId)).toMatchObject({ kind: 'sqlite.tablePage', status: 'completed' });
    expect(f.events).toContainEqual(expect.objectContaining({ taskId: input.taskId, status: 'completed' })); expect(saveTask).toHaveBeenCalled(); expect(f.context.preparingTasks.size).toBe(0);
  });
  it('无连接、网络方言或退出状态在数据库投递前拒绝，不生成任务或读取任意文件路径', async () => {
    for (const mode of ['missing', 'network', 'shutdown']) {
      const f = mainColumnsHarness(); Object.assign(f.context.store, { connections: () => mode === 'missing' ? [] : [{ ...profile, dialect: mode === 'network' ? 'mysql' : 'sqlite' }] }); f.context.shuttingDown = mode === 'shutdown';
      await expect(f.run('sqlite.tablePage', input)).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.size).toBe(0);
    }
  });
  it('读取中的取消只携带原准确task编号，收尾失败保留失败且不自动重放', async () => {
    const f = mainColumnsHarness(); Object.assign(f.context.store, { connections: () => [profile] });
    let reject!: (reason: Error) => void;
    f.request.mockImplementation(async command => { if (command === 'sqlite.tablePage') return await new Promise((_yes, no) => { reject = no; }); if (command === 'query.cancel') return; throw Error('不允许其它数据库请求'); });
    const reading = f.run('sqlite.tablePage', input), rejected = expect(reading).rejects.toThrow('准确进程退出未确认');
    await f.run('query.cancel', { taskId: input.taskId });
    expect(f.request.mock.calls[1]).toEqual(['query.cancel', { taskId: input.taskId }]);
    reject(Error('准确进程退出未确认')); await rejected;
    expect(f.tasks.get(input.taskId)?.status).toBe('failed'); expect(f.request).toHaveBeenCalledTimes(2); expect(f.context.preparingTasks.size).toBe(0);
  });
});
