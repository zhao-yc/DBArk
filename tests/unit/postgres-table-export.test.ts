import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { postgresTableExportChooseSchema, postgresTableExportExtension, postgresTableExportSchema } from '../../src/shared/postgresTable';

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
    for (const suggestedName of ['../表.json', 'C:\\表.json', '/表.json']) {
      expect(postgresTableExportChooseSchema.safeParse({ format: 'json', suggestedName }).success).toBe(false);
    }
  });
});
