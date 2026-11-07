import { expect, it, vi } from 'vitest';
import type { PostgresConnection } from '../../src/engine/postgres/connection';
import { applyPostgresQueryTimeouts, readPostgresQueryTimeouts } from '../../src/engine/postgres/queryTimeouts';
import { validateCommand } from '../../src/shared/validation';

const identity = {processId: 123, backendStart: '1000.123456', database: 'db'};
const defaults = {statementMs: 120000, lockMs: 0};
const initial = {...identity, ...defaults, defaults};
function fixture() {
  let values = defaults;
  const state = {broken: false, transactionKnown: true, transactionOpen: false, transactionFailed: false};
  const query = vi.fn(async (_sql: string, params?: unknown[]) => {
    if (params) {
      values = {statementMs: Number(params[0] ?? defaults.statementMs), lockMs: Number(params[1] ?? defaults.lockMs)};
      return {postgresCommand: 'SELECT', columns: [{}, {}], rows: [{c0: '600ms', c1: '150ms'}], truncated: false};
    }
    return {postgresCommand: 'SELECT', columns: [{}, {}, {}, {}], rows: [
      {c0: 'lock_timeout', c1: String(values.lockMs), c2: String(defaults.lockMs), c3: 'ms'},
      {c0: 'statement_timeout', c1: String(values.statementMs), c2: String(defaults.statementMs), c3: 'ms'},
    ], truncated: false};
  });
  const connection = {...identity, broken: false, state: () => state, query} as unknown as PostgresConnection;
  return {connection, query, state};
}

it('只允许毫秒整数与明确恢复动作', () => {
  const input = {sessionId: 's', taskId: 't', expected: initial, change: {mode: 'set', values: {statementMs: 0, lockMs: 2147483647}}};
  expect(validateCommand('postgres.queryTimeouts.apply', input)).toEqual(input);
  for (const value of ['100', 1.25, -1, 2147483648]) {
    expect(() => validateCommand('postgres.queryTimeouts.apply', {...input, change: {mode: 'set', values: {statementMs: value, lockMs: 0}}})).toThrow();
  }
});

it('活动或未知事务不发送任何目录查询', async () => {
  const {connection, state, query} = fixture();
  state.transactionOpen = true;
  await expect(readPostgresQueryTimeouts(connection, () => {})).rejects.toThrow('回滚');
  state.transactionOpen = false; state.transactionKnown = false;
  await expect(applyPostgresQueryTimeouts(connection, initial, {mode: 'reset'}, () => {})).rejects.toThrow('回滚');
  expect(query).not.toHaveBeenCalled();
});

it('在同一条语句绑定两项，读回毫秒，拒绝过期值，并恢复非零默认值', async () => {
  const {connection, query} = fixture();
  const values = {statementMs: 600, lockMs: 150};
  const applied = await applyPostgresQueryTimeouts(connection, initial, {mode: 'set', values}, () => {});
  expect(applied).toEqual({...initial, ...values});
  expect(query.mock.calls).toHaveLength(3);
  expect(query.mock.calls[1][0]).toContain("'statement_timeout', $1");
  expect(query.mock.calls[1][0]).toContain("'lock_timeout', $2");
  expect(query.mock.calls[1][1]).toEqual(['600', '150']);
  await expect(applyPostgresQueryTimeouts(connection, initial, {mode: 'reset'}, () => {})).rejects.toThrow('已变化');
  expect(query.mock.calls).toHaveLength(4);
  await expect(applyPostgresQueryTimeouts(connection, applied, {mode: 'reset'}, () => {})).resolves.toEqual(initial);
  expect(query.mock.calls[5][1]).toEqual([null, null]);
});

it('写入后的读回失败提示重新读取，不自动重发', async () => {
  const {connection, query} = fixture();
  const perform = query.getMockImplementation()!;
  query.mockImplementationOnce(perform).mockImplementationOnce(perform).mockRejectedValueOnce(Error('连接已断开'));
  await expect(applyPostgresQueryTimeouts(connection, initial, {mode: 'reset'}, () => {})).rejects.toThrow('可能已改变');
  expect(query.mock.calls).toHaveLength(3);
});
