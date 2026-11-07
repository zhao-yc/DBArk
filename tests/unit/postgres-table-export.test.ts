import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { postgresBackupSetSchema, postgresTableExportChooseSchema, postgresTableExportExtension, postgresTableExportSchema } from '../../src/shared/postgresTable';
import { exportPostgresTable } from '../../src/engine/postgres/tableExport';
import { PostgresTableWorkspace } from '../../src/engine/postgres/tableWorkspace';

const request = {
  connectionId: '连接', database: '库', table: '"模式"."表"', tabId: '标签', taskId: randomUUID(), fileToken: randomUUID(),
  exportToken: randomUUID(), format: 'csv', encoding: 'utf8', columns: ['c1', 'c0'], csvDelimiter: ';',
};

describe('PostgreSQL 表页导出协议', () => {
  it('只接受服务端快照和主进程文件令牌，保留显式列顺序', () => {
    expect(postgresTableExportSchema.parse(request).columns).toEqual(['c1', 'c0']);
    for (const unexpected of [{ filePath: '/private/file' }, { sql: 'SELECT 1' }, { filter: { column: 'id', text: '' } }]) {
      expect(postgresTableExportSchema.safeParse({ ...request, ...unexpected }).success).toBe(false);
    }
  });

  it('拒绝重复列及不适用的 CSV 或 XLSX 参数', () => {
    expect(postgresTableExportSchema.safeParse({ ...request, columns: ['c0', 'c0'] }).success).toBe(false);
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'json' }).success).toBe(false);
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'xlsx', csvDelimiter: undefined, encoding: 'utf16le' }).success).toBe(false);
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'html' }).success).toBe(false);
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'html', csvDelimiter: undefined }).success).toBe(true);
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'html', csvDelimiter: undefined, encoding: 'utf16le' }).success).toBe(false);
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'sql', csvDelimiter: undefined }).success).toBe(true);
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'sql', csvDelimiter: undefined, encoding: 'gb18030' }).success).toBe(false);
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'sql-backup', csvDelimiter: undefined }).success).toBe(true);
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'sql-backup', csvDelimiter: undefined, encoding: 'gb18030' }).success).toBe(false);
    expect(postgresTableExportExtension('sql-backup')).toBe('sql');
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'copy', csvDelimiter: '\t' }).success).toBe(true);
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'copy', encoding: 'utf16le' }).success).toBe(false);
    expect(postgresTableExportSchema.safeParse({ ...request, format: 'copy', csvDelimiter: '|' }).success).toBe(false);
  });

  it('保存对话框只接收建议文件名，路径由系统选择', () => {
    expect(postgresTableExportChooseSchema.safeParse({ format: 'json', suggestedName: '表.json' }).success).toBe(true);
    expect(postgresTableExportExtension(postgresTableExportChooseSchema.parse({ format: 'copy', suggestedName: '表.csv' }).format)).toBe('csv');
    expect(postgresTableExportExtension(postgresTableExportChooseSchema.parse({ format: 'html', suggestedName: '表.html' }).format)).toBe('html');
    for (const suggestedName of ['../表.json', 'C:\\表.json', '/表.json']) {
      expect(postgresTableExportChooseSchema.safeParse({ format: 'json', suggestedName }).success).toBe(false);
    }
  });

  it('多表备份只接收唯一、限定 schema 的目录表名和文件令牌', () => {
    const { connectionId, database, fileToken, taskId } = request;
    const backup = { connectionId, database, fileToken, taskId, format: 'sql-backup-set', tables: ['"归档"."带""引号"'] };
    expect(postgresBackupSetSchema.parse(backup)).toEqual(backup);
    for (const tables of [[], ['public.t'], [backup.tables[0], backup.tables[0]], ['"public"."x"; DROP TABLE foo'], ['"public"."x\0y"']])
      expect(postgresBackupSetSchema.safeParse({ ...backup, tables }).success).toBe(false);
    expect(postgresBackupSetSchema.safeParse({ ...backup, filePath: '/private/out.sql' }).success).toBe(false);
    expect(postgresTableExportExtension('sql-backup-set')).toBe('sql');
  });
});

it('PostgreSQL HTML 在游标任务确认结束后才发布，读取失败保留已存在的文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dbark-pg-table-html-'));
  const filePath = join(dir, 'out.html');
  const input = { ...postgresTableExportSchema.parse({ ...request, format: 'html', csvDelimiter: undefined }), filePath, owner: '本例窗口', connectionRevision: 0 };
  const workspace = new PostgresTableWorkspace();
  const cursor = vi.spyOn(workspace, 'exportData');
  let fail = true;
  cursor.mockImplementation(async (_input, _connect, _check, _delimiter, consume) => {
    await consume({ kind: 'cursor', columns: [{ key: 'c1', name: '<标签>', type: 'text', nullable: false, defaultValue: false, generated: false, primary: false, binary: false }],
      rows: (async function* () { yield ['<img src=x> & 中文']; })() });
    expect(await readFile(filePath, 'utf8')).toBe('原文件');
    if (fail) throw Error('游标未确认关闭');
  });
  const execute = () => exportPostgresTable(workspace, input, vi.fn(), () => {}, () => {}, () => {});
  try {
    await writeFile(filePath, '原文件');
    await expect(execute()).rejects.toThrow('游标未确认关闭');
    expect(await readdir(dir)).toEqual(['out.html']);
    fail = false;
    expect(await execute()).toEqual({ rows: 1, fileCommitted: true });
    const html = await readFile(filePath, 'utf8');
    expect(html).toContain('<th scope="col">&lt;标签&gt;</th>');
    expect(html).toContain('<td>&lt;img src=x&gt; &amp; 中文</td>');
  } finally { await rm(dir, {recursive: true, force: true}); }
});
