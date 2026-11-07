import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { exportPostgresQuery } from '../../src/engine/postgres/queryExport';
import type { PostgresConnection } from '../../src/engine/postgres/connection';
import { postgresParameterValues } from '../../src/engine/postgres/parameters';
import { postgresExportParameterNames } from '../../src/shared/postgresQueryExport';

const base = {connectionId: 'pg', database: 'postgres', fileToken: 'choice', taskId: 'task', format: 'csv', encoding: 'utf8'} as const;

it('导出参数名称只按词法识别，忽略 dollar 正文、注释和字符串内的位置文字', () => {
  expect(postgresExportParameterNames("SELECT $1, $2, $1, '$3', $$ $4 $$ /* $5 */;").names).toEqual(['p1', 'p2']);
  for (const sql of ['SELECT $2', 'SELECT $1, $3', 'SELECT $1; SELECT $2', "SELECT 'a\\'; SELECT $1; -- '"])
    expect(() => postgresExportParameterNames(sql)).toThrow();
});

it('PostgreSQL 绑定保留38位小数原文、精确整数、NULL及字节', () => {
  const decimal = '0.12345678901234567890123456789012345678';
  expect(postgresParameterValues([1, 2, 3, 4], [
    {name: 'p1', type: 'integer', value: '9007199254740993'}, {name: 'p2', type: 'decimal', value: decimal},
    {name: 'p3', type: 'null'}, {name: 'p4', type: 'binary', value: '00ff'},
  ])).toEqual(['9007199254740993', decimal, null, Buffer.from([0, 255])]);
  expect(postgresParameterValues([])).toBeUndefined();
  expect(() => postgresParameterValues([1])).toThrow();
  expect(() => postgresParameterValues([1], [{name: 'p2', type: 'text', value: '值'}])).toThrow();
  expect(() => postgresParameterValues([1, 3], [{name: 'p1', type: 'null'}, {name: 'p3', type: 'null'}])).toThrow();
});

it('参数导出IPC接纳严格类型，拒绝附加字段、重复名称及超预算', () => {
  const input = {...base, sql: 'SELECT $1', parameters: [{name: 'p1', type: 'text', value: "原文'😀"}]};
  expect(validateCommand('postgres.query.export', input)).toEqual(input);
  for (const parameters of [[{...input.parameters[0], extra: true}], [input.parameters[0], input.parameters[0]],
    [{name: 'p1', type: 'text', value: 'x'.repeat(65537)}]])
    expect(() => validateCommand('postgres.query.export', {...input, parameters})).toThrow();
});

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
