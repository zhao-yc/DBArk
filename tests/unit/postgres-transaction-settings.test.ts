import { describe, expect, it, vi } from 'vitest';
import { readPostgresTransactionSettings, applyPostgresTransactionSettings } from '../../src/engine/postgres/transactionSettings';
import type { PostgresConnection } from '../../src/engine/postgres/connection';
import { postgresTransactionDefaultsSql, type PostgresTransactionDefaults, type PostgresTransactionSnapshot } from '../../src/shared/postgresTransactionSettings';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { PostgresEngine } from '../../src/engine/postgres/engine';
import type { TaskEvent } from '../../src/shared/contracts';

const defaults: PostgresTransactionDefaults = {isolation: 'READ COMMITTED', readOnly: false, deferrable: false};
const next: PostgresTransactionDefaults = {isolation: 'SERIALIZABLE', readOnly: true, deferrable: true};
const expected: PostgresTransactionSnapshot = {...defaults, processId: 123, backendStart: '1000.123456', database: 'db', transactionOpen: false, transactionFailed: false};

/** 只替换物理协议端口，真实 SHOW 读取、复核、SET 生成及读回全部运行产品代码。 */
function fixture() {
  let values = {...defaults}, hook: ((sql: string) => void) | undefined;
  const state = {transactionOpen: false, transactionFailed: false, transactionKnown: true, broken: false};
  const connection = {processId: 123, backendStart: '1000.123456', database: 'db', broken: false,
    state: () => ({...state}), close: vi.fn(async () => {}), error: (reason: unknown) => reason instanceof Error ? reason : Error('未知错误'),
    query: vi.fn(async (sql: string) => {
      hook?.(sql);
      if (sql.startsWith('SET ')) { expect(sql).toBe(postgresTransactionDefaultsSql(next)); values = {...next}; return {postgresCommand: 'SET', columns: [], rows: []}; }
      const text: Record<string, string> = {default_transaction_isolation: values.isolation.toLowerCase(), default_transaction_read_only: values.readOnly ? 'on' : 'off', default_transaction_deferrable: values.deferrable ? 'on' : 'off'};
      const name = sql.slice(5); if (!Object.hasOwn(text, name)) throw Error('拒绝未知语句');
      return {postgresCommand: 'SHOW', columns: [{key: 'c0', name, type: 'TEXT'}], rows: [{c0: text[name]}], truncated: false};
    }),
  };
  return {connection, state, sql: () => connection.query.mock.calls.map(([sql]) => sql), values: () => values,
    hook(action: (sql: string) => void) { hook = action; }, managed: connection as unknown as PostgresConnection};
}

describe('PostgreSQL 原会话事务默认值', () => {
  it('严格注册两条 IPC，不允许原 SQL、附加字段及伪造快照扩展', () => {
    expect(publicCommands['postgres.transactionSettings.read']).toBe(true);
    expect(validateCommand('postgres.transactionSettings.read', {sessionId: 's', taskId: 't'})).toEqual({sessionId: 's', taskId: 't'});
    const input = {sessionId: 's', taskId: 't', expected, defaults: next};
    expect(validateCommand('postgres.transactionSettings.apply', input)).toEqual(input);
    for (const bad of [{...input, sql: 'COMMIT'}, {...input, defaults: {...next, isolation: 'SERIALIZABLE;COMMIT'}},
      {...input, expected: {...expected, password: '不得接受'}}, {...input, defaults: {...next, readOnly: 'on'}}, {...input, expected: {...expected, processId: 0}}])
      expect(() => validateCommand('postgres.transactionSettings.apply', bad)).toThrow();
  });
  it('枚举生成唯一 SET SESSION，不接受当前事务或 GLOBAL SQL 片段', () => {
    expect(postgresTransactionDefaultsSql(next)).toBe('SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL SERIALIZABLE, READ ONLY, DEFERRABLE');
    expect(postgresTransactionDefaultsSql(defaults)).toContain('READ WRITE, NOT DEFERRABLE');
    expect(() => postgresTransactionDefaultsSql({...next, isolation: 'GLOBAL' as never})).toThrow();
  });
  it('只用三条 SHOW，在活动健康事务中读取不修改原状态', async () => {
    const f = fixture(); f.state.transactionOpen = true;
    expect(await readPostgresTransactionSettings(f.managed, () => {})).toEqual({...expected, transactionOpen: true});
    expect(f.sql()).toEqual(['SHOW default_transaction_isolation', 'SHOW default_transaction_read_only', 'SHOW default_transaction_deferrable']);
    expect(f.state.transactionOpen).toBe(true);
  });
  it('空闲原会话先读旧值，再单条 SET 并重新读取确认', async () => {
    const f = fixture(); expect(await applyPostgresTransactionSettings(f.managed, expected, next, () => {})).toEqual({...expected, ...next});
    expect(f.sql()).toHaveLength(7); expect(f.sql().filter(sql => sql.startsWith('SET '))).toEqual([postgresTransactionDefaultsSql(next)]);
    expect(f.sql().some(sql => /BEGIN|COMMIT|ROLLBACK|SELECT/.test(sql))).toBe(false);
  });
  it.each(['transactionOpen', 'transactionFailed', 'transactionKnown', 'broken'] as const)('%s状态拒绝修改，不发送SET', async key => {
    const f = fixture(); f.state[key] = key !== 'transactionKnown';
    if (key === 'transactionFailed') f.state.transactionOpen = true;
    await expect(applyPostgresTransactionSettings(f.managed, expected, next, () => {})).rejects.toThrow(); expect(f.sql().some(sql => sql.startsWith('SET '))).toBe(false);
  });
  it.each(['processId', 'backendStart', 'database', 'isolation', 'readOnly', 'deferrable'] as const)('%s旧快照漂移拒绝写入', async key => {
    const f = fixture(), before = {...expected}; Object.assign(before, {[key]: typeof before[key] === 'number' ? 999 : typeof before[key] === 'boolean' ? true : key === 'isolation' ? 'REPEATABLE READ' : key === 'backendStart' ? '999.1' : 'other'});
    await expect(applyPostgresTransactionSettings(f.managed, before, next, () => {})).rejects.toThrow('变化'); expect(f.sql()).toHaveLength(3);
  });
  it('SET后读回失败只提示可能改变，保留新值而不重发或回滚', async () => {
    const f = fixture(); let set = false;
    f.hook(sql => { if (sql.startsWith('SET ')) set = true; else if (set) throw Error('读回断线'); });
    await expect(applyPostgresTransactionSettings(f.managed, expected, next, () => {})).rejects.toThrow('设置可能已改变');
    expect(f.values()).toEqual(next); expect(f.sql().filter(sql => sql.startsWith('SET '))).toHaveLength(1); expect(f.sql().some(sql => /ROLLBACK/.test(sql))).toBe(false);
  });
  it('SET前取消零写入；SET后取消保留可能改变边界', async () => {
    for (const phase of ['before', 'after']) {
      const f = fixture(); let cancelled = false;
      f.hook(sql => { if (phase === 'before' && sql === 'SHOW default_transaction_deferrable' || phase === 'after' && sql.startsWith('SET ')) cancelled = true; });
      await expect(applyPostgresTransactionSettings(f.managed, expected, next, () => { if (cancelled) throw Error('已取消'); })).rejects.toThrow(phase === 'after' ? '设置可能已改变' : '已取消');
      expect(f.sql().filter(sql => sql.startsWith('SET '))).toHaveLength(phase === 'after' ? 1 : 0);
    }
  });
  it('缺行、未知值、截断及错误命令回执都不能伪造确认', async () => {
    for (const output of [{postgresCommand: 'SHOW', columns: [], rows: []}, {postgresCommand: 'SHOW', columns: [{key: 'c0'}], rows: [{c0: 'unknown'}]},
      {postgresCommand: 'SET', columns: [{key: 'c0'}], rows: [{c0: 'read committed'}]}, {postgresCommand: 'SHOW', columns: [{key: 'c0'}], rows: [{c0: 'read committed'}], truncated: true}]) {
      const f = fixture(); f.connection.query.mockResolvedValue(output as never); await expect(readPostgresTransactionSettings(f.managed, () => {})).rejects.toThrow();
    }
  });
  it('真实引擎路由读取与修改使用同一物理会话及任务，不产生用户查询事件', async () => {
    const f = fixture(), events: TaskEvent[] = [], engine = new PostgresEngine(event => events.push(event));
    (engine as unknown as {sessions: Map<string, unknown>}).sessions.set('s', {id: 's', connectionId: 'c', managed: f.managed});
    try {
      const snapshot = await engine.handle('postgres.transactionSettings.read', {sessionId: 's', taskId: 'read'});
      expect(snapshot).toEqual(expected);
      expect(await engine.handle('postgres.transactionSettings.apply', {sessionId: 's', taskId: 'apply', expected, defaults: next})).toEqual({...expected, ...next});
      expect(events.filter(event => event.status === 'completed')).toHaveLength(2); expect(events.some(event => 'executionSql' in event || 'batch' in event)).toBe(false);
      await expect(engine.handle('postgres.transactionSettings.read', {sessionId: 's', taskId: 'read'})).rejects.toThrow('编号');
    } finally { await engine.closeAll(); }
  });
});
