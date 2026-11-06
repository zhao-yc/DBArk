import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { captureMysqlQueryTransfer, capturePostgresQueryTransfer, captureSqliteQueryTransfer } from '../../src/renderer/postgresRecordTransfer';
import { networkQueryTransferData, networkQueryTransferSource } from '../../src/renderer/networkQueryTransfer';

const source = { connectionId: 'source', label: '源连接', title: '源查询', result: 1 };

describe('复制暂存查询结果到网络表', () => {
  it('投影精确 PostgreSQL 原值和字节，标记不能安全写入数值列的字段', () => {
    const result: QueryResult = { columns: ['NUMERIC', 'BYTEA', 'DOUBLE PRECISION', 'TEXT'].map((type, index) => ({
      key: 'c' + index, name: index < 2 ? '同名' : '字段' + index, type,
    })), rows: [{ c0: '9007199254740993.00000000000000000001', c1: { type: 'binary', base64: 'AP8=' }, c2: 'NaN', c3: '-0' }],
    truncated: true, statement: 'SELECT 精确数据', elapsedMs: 1 };
    const captured = capturePostgresQueryTransfer(source, result, result.columns);
    const transfer = networkQueryTransferData(captured);
    expect(transfer.data).toEqual({ columns: result.columns.map(({ key, name }) => ({ key, name })), rows: result.rows, truncated: true });
    expect([...transfer.textOnly]).toEqual(['c2']);
    expect(networkQueryTransferSource(captureMysqlQueryTransfer(source, 'mysql', result, result.columns))).toBeUndefined();
  });

  it('根据 SQLite 逐格存储类区分负零、同原文文本、空字节和 NULL', () => {
    const result: QueryResult = { columns: ['real', 'text', 'raw', 'nullable'].map((name, index) => ({ key: 'c' + index, name, type: 'SQLITE' })),
      rows: [{ c0: '-0', c1: '-0', c2: { type: 'binary', base64: '' }, c3: null }],
      sqliteStorage: { version: 1, rows: ['rtbn'] }, truncated: false, statement: '', elapsedMs: 1 };
    const captured = captureSqliteQueryTransfer(source, result);
    const transfer = networkQueryTransferData(captured);
    expect(transfer.data.rows).toEqual(result.rows);
    expect([...transfer.textOnly]).toEqual(['c0']);
    expect(() => networkQueryTransferData({ ...captured, sqliteStorage: undefined })).toThrow();
  });
});
