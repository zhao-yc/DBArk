import { emptyTableFilteredDeleteOwners } from './table-filtered-delete-owner-fixture';
import { emptyTableFilteredUpdateOwners } from './table-filtered-update-owner-fixture';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';

const commands = ['table.incomingReferences', 'table.childReferencePage'] as const;
/** 运行真实Main分派原文，仅替换Electron、存储及进程传输边界。 */
function fixture() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function dispatch('), end = source.indexOf('/** 按平台生成中文原生菜单');
  if (start < 0 || end <= start) throw Error('生产分派入口已变化');
  const tasks = new Map<string, TaskRecord>(), events: TaskEvent[] = [], saves = vi.fn(), history = vi.fn(); let revision = 7;
  const profile = { id: 'connection', password: '仅内存合成凭据' };
  const request = vi.fn(async (_command: string, _input: any): Promise<any> => ({ ready: true }));
  const assertAvailable = vi.fn();
  const context = createContext({ filteredDeletes: emptyTableFilteredDeleteOwners(), filteredUpdates: emptyTableFilteredUpdateOwners(), Date, Map, Set, Error, SavedQuerySearchCancelled, tableApplyReceipts: undefined, savedQueryPages: undefined, historyPages: undefined, savedQuerySearches: { has: () => false },
    tasks, completionTasks: new Set(), pendingQueryHistory: new Map(), preparingTasks: new Map(), exportProgress: new Map(), structureProgress: new Map(), structureTokens: new Map(), sessions: new Map(), tablePresetReads: new Map(), shuttingDown: false,
    connectionConfig: { assertAvailable }, store: { saveTask: saves, addHistory: history, connectionRevision: () => revision, resolveConnection: (id: string) => { if (id !== profile.id) throw Error('未知连接'); return profile; } }, broker: { request },
    taskEvent(event: TaskEvent) { events.push(event); tasks.set(event.taskId, { ...tasks.get(event.taskId)!, status: event.status }); },
  });
  runInContext(ts.transpileModule(source.slice(start, end) + '\nglobalThis.dispatch=dispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, request, tasks, events, saves, history, profile, assertAvailable, revise: () => { revision++; }, dispatch: context.dispatch as (command: string, input: any) => Promise<any> };
}

describe('入向关联Main真实分派与公开边界（仅RAM）', () => {
  it.each(commands)('%s注入Main可信配置，按独立编号登记终态，不写SQL执行历史', async command => {
    const f = fixture(), input = { connectionId: 'connection', database: '父库', table: '父表', taskId: 'read' };
    await expect(f.dispatch(command, input)).resolves.toEqual({ ready: true });
    expect(f.request).toHaveBeenCalledExactlyOnceWith(command, { ...input, profile: f.profile });
    expect(f.assertAvailable).toHaveBeenCalledWith('connection'); expect(f.saves).toHaveBeenCalledOnce();
    expect(f.tasks.get('read')).toMatchObject({ kind: command, status: 'completed' });
    expect(f.context.preparingTasks.size).toBe(0); expect(f.history).not.toHaveBeenCalled();
  });
  it.each(commands)('%s取消回执不结算原读取，原编号直到Promise终态不能复用', async command => {
    const f = fixture(); let reject!: (reason: Error) => void;
    f.request.mockImplementationOnce(() => new Promise((_yes, no) => { reject = no; }));
    const input = { connectionId: 'connection', taskId: 'pending' }, pending = f.dispatch(command, input);
    const failure = expect(pending).rejects.toThrow('原读取已取消');
    await f.dispatch('query.cancel', { taskId: 'pending' }); expect(f.tasks.get('pending')?.status).toBe('running');
    await expect(f.dispatch(command, input)).rejects.toThrow('编号');
    expect(f.request.mock.calls.map(call => call[0])).toEqual([command, 'query.cancel']);
    reject(Error('原读取已取消')); await failure;
    expect(f.tasks.get('pending')?.status).toBe('failed'); expect(f.context.preparingTasks.size).toBe(0);
  });
  it.each(commands)('%s拒绝修订变化或退出后的迟到数据，未自动重读', async command => {
    for (const cause of ['revision', 'shutdown']) {
      const f = fixture(); f.request.mockImplementationOnce(async () => { if (cause === 'revision') f.revise(); else f.context.shuttingDown = true; return { privateRows: ['私密子记录'] }; });
      await expect(f.dispatch(command, { connectionId: 'connection', taskId: 'late' })).rejects.toThrow('已变化');
      expect(f.request).toHaveBeenCalledOnce(); expect(f.tasks.get('late')?.status).toBe('failed');
      expect(f.context.preparingTasks.size).toBe(0); expect(f.history).not.toHaveBeenCalled();
    }
  });
  it.each(commands)('%s在退出或配置锁定时零引擎投递', async command => {
    const f = fixture(); f.context.shuttingDown = true;
    await expect(f.dispatch(command, { connectionId: 'connection', taskId: 'closed' })).rejects.toThrow('退出');
    f.context.shuttingDown = false; f.assertAvailable.mockImplementationOnce(() => { throw Error('配置保存锁'); });
    await expect(f.dispatch(command, { connectionId: 'connection', taskId: 'locked' })).rejects.toThrow('配置保存锁');
    expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.size).toBe(0);
  });
  it('公开命令保留精确复合值、分组筛选和多列排序，并拒绝目标或SQL注入', () => {
    const common = { connectionId: 'connection', database: '父库', table: '父表', taskId: 'read' };
    const child = { ...common, relation: { database: '子库', table: '子表', foreignKeyName: 'fk', digest: 'a'.repeat(64) }, matchValues: ['18446744073709551614', { type: 'binary', base64: 'AP8=' }, null], page: 1, pageSize: 50, filters: [], sort: [{ column: 'id', direction: 'DESC' }, { column: 'name', direction: 'ASC' }] };
    for (const command of commands) expect(Object.hasOwn(publicCommands, command)).toBe(true);
    expect(validateCommand(commands[0], common)).toEqual(common); expect(validateCommand(commands[1], child)).toEqual(child);
    for (const input of [{ ...common, sql: 'SELECT *' }, { ...common, cursor: 'not a cursor' }, { ...common, profile: {} }]) expect(() => validateCommand(commands[0], input)).toThrow();
    for (const input of [{ ...child, matchValues: undefined }, { ...child, matchValues: [] }, { ...child, relation: { ...child.relation, columns: ['fake'] } }, { ...child, sql: 'SELECT *' }, { ...child, sessionId: 'user-transaction' }, { ...child, matchValues: [undefined] }, { ...child, matchValues: ['x'.repeat(262145)] }]) expect(() => validateCommand(commands[1], input)).toThrow();
  });
  it.each(commands)('%s持久化概要不保存关联值、驱动错误或返回记录', command => {
    for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) {
      const message = persistedTaskMessage(command, { taskId: 't', status, progress: 0, message: '私密父值 子记录 SQL原文 认证信息' });
      for (const secret of ['私密', 'SQL原文', '认证信息']) expect(message).not.toContain(secret);
      expect(message).toContain('子记录'); expect(message.length).toBeGreaterThan(10);
    }
  });
});
