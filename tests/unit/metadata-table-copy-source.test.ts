import { describe, expect, it, vi } from 'vitest';
import { tableInfo, type MetadataQuery } from '../../src/engine/metadata';
vi.mock('../../src/engine/connection', () => ({ execute: vi.fn() }));
import { execute, type ManagedConnection } from '../../src/engine/connection';

/** 相同服务器目录分别通过原execute及可取消端口进入真实解析，不制造第二套元数据算法。 */
function directory(sql: string) {
  const rows = sql.includes('information_schema.COLUMNS') ? [{ name: 'id', type: 'bigint', extra: 'auto_increment', nullable: 'NO', defaultValue: null }, { name: 'hidden', type: 'text', extra: 'INVISIBLE', nullable: 'YES', defaultValue: null }]
    : sql.includes('information_schema.STATISTICS') ? [{ name: 'PRIMARY', nonUnique: 0, columnName: 'id', subPart: null, indexType: 'BTREE', sortDirection: 'A' }]
    : sql.includes('information_schema.KEY_COLUMN_USAGE') ? []
    : sql.includes('information_schema.TABLES') ? [{ engine: 'InnoDB', tableType: 'BASE TABLE', charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci', comment: '' }]
    : sql.startsWith('SHOW CREATE') ? [{ 'Create Table': 'CREATE TABLE records(id BIGINT PRIMARY KEY AUTO_INCREMENT,hidden TEXT INVISIBLE)' }]
    : sql === 'SELECT @@SESSION.sql_mode AS mode' ? [{ mode: '' }]
    : (() => { throw new Error('非预期目录SQL'); })();
  return { rows, fields: [] };
}
describe('表目录可选同会话查询回调', () => {
  it.each(['mysql', 'mariadb'] as const)('%s旧协议保持原样，新增端口覆盖包括DDL在内全部目录SQL', async dialect => {
    const managed = { status: { dialect }, sqlMode: '' } as ManagedConnection; vi.mocked(execute).mockReset().mockImplementation(async (_connection, sql) => directory(sql) as never);
    const legacy = await tableInfo(managed, 'db', 'records'), calls = vi.mocked(execute).mock.calls.map(([, sql, params]) => [sql, params ?? []]); expect(calls.length).toBe(dialect === 'mysql' ? 5 : 6); vi.mocked(execute).mockClear();
    const port = vi.fn(async (sql: string, params: unknown[] = []) => directory(sql)); const actual = await tableInfo(managed, 'db', 'records', port as MetadataQuery);
    expect(actual).toEqual(legacy); expect(port.mock.calls.map(([sql, params]) => [sql, params ?? []])).toEqual(calls); expect(execute).not.toHaveBeenCalled(); expect(actual.columns[1]).toMatchObject({ extra: 'INVISIBLE', generated: false });
  });
  it('任何目录步骤取消都沿同端口立即退出，未悄悄退回普通execute', async () => { vi.mocked(execute).mockClear(); const port = vi.fn(async (sql: string) => { if (sql.startsWith('SHOW CREATE')) throw new Error('受控取消'); return directory(sql); }); await expect(tableInfo({ status: { dialect: 'mysql' }, sqlMode: '' } as ManagedConnection, 'db', 'records', port as MetadataQuery)).rejects.toThrow('受控取消'); expect(execute).not.toHaveBeenCalled(); });
});
