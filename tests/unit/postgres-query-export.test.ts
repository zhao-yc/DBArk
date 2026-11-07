import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { exportPostgresQuery } from '../../src/engine/postgres/queryExport';
import type { PostgresConnection } from '../../src/engine/postgres/connection';

const base = {connectionId: 'pg', database: 'postgres', fileToken: 'choice', taskId: 'task', format: 'csv', encoding: 'utf8'} as const;

it('完整导出只接纳文件令牌及支持的格式，拒绝渲染进程指定的路径或会话', () => {
  const input = {...base, sql: 'SELECT 1', csvDelimiter: ';'};
  expect(validateCommand('postgres.query.export', input)).toEqual(input);
  for (const patch of [{filePath: '/tmp/other.csv'}, {sessionId: 'workbench'}, {format: 'sql'}, {format: 'json'}]) {
    expect(() => validateCommand('postgres.query.export', {...input, ...patch})).toThrow();
  }
});

it.each(['SELECT 1; SELECT 2', 'DELETE FROM records', 'SELECT $1', 'SELECT $$未闭合'])('不向导出会话投递不符合边界的 SQL %s', async sql => {
  const query = vi.fn();
  const connection = {query, standardStrings: true} as unknown as PostgresConnection;
  await expect(exportPostgresQuery({...base, sql, filePath: join(tmpdir(), 'pg-export-preflight.csv')},
    action => action(connection), () => {}, () => {}, () => {})).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});
