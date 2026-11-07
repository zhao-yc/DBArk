import { describe, expect, it, vi } from 'vitest';
import type { PostgresConnection } from '../../src/engine/postgres/connection';
import { applyPostgresSearchPath, readPostgresSearchPath } from '../../src/engine/postgres/searchPath';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';

const identity = {processId: 123, backendStart: '1000.123456', database: 'db'};
const initial = {...identity, role: 'app', path: 'public', effective: ['pg_catalog', 'public'],
  candidates: ['public', '新 schema'], candidatesTruncated: false};

function fakeConnection() {
  let path = initial.path;
  const state = {broken: false, transactionKnown: true, transactionOpen: false, transactionFailed: false};
  const query = vi.fn(async (_sql: string, params?: unknown[]) => params
    ? {postgresCommand: 'SELECT', columns: [{}], rows: [{c0: path = String(params[0] ?? 'public')}], truncated: false}
    : {postgresCommand: 'SELECT', columns: [{}, {}, {}, {}], rows: [{
      c0: path, c1: initial.role, c2: JSON.stringify(initial.effective), c3: JSON.stringify(initial.candidates),
    }], truncated: false});
  const connection = {...identity, broken: false, state: () => state, query};
  return {connection: connection as unknown as PostgresConnection, query, state};
}

describe('PostgreSQL 原会话搜索路径', () => {
  it('只接受有界路径和明确恢复动作', () => {
    expect(publicCommands['postgres.searchPath.read']).toBe(true);
    expect(publicCommands['postgres.searchPath.apply']).toBe(true);
    const input = {sessionId: 's', taskId: 't', expected: initial, change: {mode: 'set', path: ''}};
    expect(validateCommand('postgres.searchPath.apply', input)).toEqual(input);
    for (const change of [{mode: 'set', path: '\0'}, {mode: 'set', path: 'x'.repeat(4097)}, {mode: 'reset', path: 'public'}]) {
      expect(() => validateCommand('postgres.searchPath.apply', {...input, change})).toThrow();
    }
  });

  it('在健康、失败或未知事务状态均不发送目录查询', async () => {
    const {connection, query, state} = fakeConnection();
    state.transactionOpen = true;
    await expect(readPostgresSearchPath(connection, () => {})).rejects.toThrow('回滚');
    state.transactionFailed = true;
    await expect(applyPostgresSearchPath(connection, initial, {mode: 'reset'}, () => {})).rejects.toThrow('回滚');
    state.transactionOpen = false; state.transactionFailed = false; state.transactionKnown = false;
    await expect(readPostgresSearchPath(connection, () => {})).rejects.toThrow('回滚');
    expect(query).not.toHaveBeenCalled();
  });

  it('比较旧路径与原身份后仅绑定一次用户值，恢复绑定 NULL', async () => {
    const {connection, query} = fakeConnection();
    const path = '"含有引号""和逗号,的 schema", public';
    const applied = await applyPostgresSearchPath(connection, initial, {mode: 'set', path}, () => {});
    expect(applied.path).toBe(path);
    expect(query.mock.calls).toHaveLength(3);
    expect(query.mock.calls[1].slice(0, 2)).toEqual(["SELECT pg_catalog.set_config('search_path', $1::pg_catalog.text, false)", [path]]);
    await expect(applyPostgresSearchPath(connection, initial, {mode: 'reset'}, () => {})).rejects.toThrow('已变化');
    expect(query.mock.calls).toHaveLength(4);
    await expect(applyPostgresSearchPath(connection, applied, {mode: 'reset'}, () => {})).resolves.toEqual(initial);
    expect(query.mock.calls[5][1]).toEqual([null]);
  });

  it('读回失败保留未知结果，既不重试也不回滚用户会话', async () => {
    const {connection, query} = fakeConnection();
    const perform = query.getMockImplementation()!;
    query.mockImplementationOnce(perform).mockImplementationOnce(perform).mockRejectedValueOnce(Error('连接中断'));
    await expect(applyPostgresSearchPath(connection, initial, {mode: 'set', path: 'next'}, () => {})).rejects.toThrow('重新读取');
    expect(query.mock.calls).toHaveLength(3);
    expect(query.mock.calls.map(call => call[0]).join(' ')).not.toContain('ROLLBACK');
  });
});
