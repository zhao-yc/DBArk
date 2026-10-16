import { describe, expect, it, vi } from 'vitest';
import type { ColumnInfo, DataRow, TableInfo } from '../../src/shared/contracts';
import { duplicateRecordDraft, recordDuplicateReadonlyReason } from '../../src/renderer/recordDuplicate';
import { collectChanges, type DraftRow } from '../../src/renderer/dataChanges';
import type { RecordContext } from '../../src/renderer/recordViews';
import { buildChanges, buildPageSql } from '../../src/engine/sql';

// 仅替换目录读端口，不连接数据库或读取实际环境；目录解析与SQL构造使用生产实现。
vi.mock('../../src/engine/connection', () => ({ execute: vi.fn() }));
import { execute } from '../../src/engine/connection';
import { tableInfo } from '../../src/engine/metadata';

/** 普通INVISIBLE值与默认值不同；源original和当前data均完整拥有NULL与字节包装。 */
function fixture() {
  const columns: ColumnInfo[] = [['id', 'bigint unsigned', 'auto_increment'], ['note', 'text', ''], ['server_hidden', 'varchar(40)', 'INVISIBLE'], ['nullable', 'text', ''], ['payload', 'blob', ''], ['computed', 'int', 'STORED GENERATED']].map(([name, type, extra]) => ({ name, type, extra, nullable: name !== 'id', defaultValue: name === 'server_hidden' ? '服务器默认值' : null, generated: name === 'computed', comment: '' }));
  const info: TableInfo = { database: 'db', name: 'records', objectKind: 'table', engine: 'InnoDB', columns, indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], ddl: '' };
  const data: DataRow = { id: '18446744073709551615', note: '源值', server_hidden: '源记录非默认值', nullable: null, payload: { type: 'binary', base64: 'AP8=' }, computed: '7' };
  const row: DraftRow = { id: 'source', data, original: structuredClone(data), inserted: false, deleted: false };
  const context: RecordContext = { target: { connectionId: 'test', database: info.database, table: info.name }, info, loaded: true, busy: false, stale: false, connectionVersion: 1, generation: 2 };
  return { info, row, rows: [row], context };
}

describe('完整已加载原行复制：缺失不是DEFAULT', () => {
  it.each(['note', 'server_hidden', 'nullable', 'payload'])('普通字段%s任一侧或双侧缺失必须拒绝，不产生部分草稿', field => {
    for (const side of ['data', 'original', 'both'] as const) {
      const f = fixture(); if (side !== 'original') delete f.row.data[field]; if (side !== 'data') delete f.row.original![field]; const refs = [f.row.data, f.row.original];
      expect(recordDuplicateReadonlyReason(f.context, f.row)).toContain('未完整加载'); expect(() => duplicateRecordDraft(f.rows, 'source', f.context, 'copy')).toThrow('不能复制为服务器默认值');
      expect(f.rows).toHaveLength(1); expect(f.row.data).toBe(refs[0]); expect(f.row.original).toBe(refs[1]);
    }
  });
  it.each(['data', 'original'] as const)('%s有自有undefined也拒绝，不能以hasOwn单独放行', side => {
    const f = fixture(); Object.defineProperty(side === 'data' ? f.row.data : f.row.original!, 'nullable', { value: undefined, enumerable: true }); expect(() => duplicateRecordDraft(f.rows, 'source', f.context, 'copy')).toThrow('未完整加载');
  });
  it('自有NULL、空串、零字节和完整INVISIBLE原值均允许，不被当作缺失', () => {
    const f = fixture(); f.row.data.note = ''; f.row.data.payload = { type: 'binary', base64: '' }; const copy = duplicateRecordDraft(f.rows, 'source', f.context, 'copy')[1];
    expect(copy.data.nullable).toBeNull(); expect(copy.data.note).toBe(''); expect(copy.data.payload).toEqual({ type: 'binary', base64: '' }); expect(copy.data.server_hidden).toBe('源记录非默认值');
    const sql = buildChanges(f.info, collectChanges([copy])); expect(sql.statements[0].sql).toContain('`server_hidden`'); expect(sql.statements[0].params).toContain('源记录非默认值');
  });
  it('原型继承的字段不算已加载值；原型同名字段必须有自有值', () => {
    const f = fixture(); delete f.row.data.server_hidden; Object.setPrototypeOf(f.row.data, { server_hidden: '继承值' }); expect(() => duplicateRecordDraft(f.rows, 'source', f.context, 'copy')).toThrow('未完整加载');
    Object.defineProperty(f.row.data, 'server_hidden', { value: '自有值', enumerable: true }); expect(duplicateRecordDraft(f.rows, 'source', f.context, 'copy')[1].data.server_hidden).toBe('自有值');
  });
  it('只有生成/自增非定位字段可以缺失；可靠定位键original仍必需', () => {
    const f = fixture(); delete f.row.data.id; delete f.row.data.computed; delete f.row.original!.computed; expect(() => duplicateRecordDraft(f.rows, 'source', f.context, 'copy')).not.toThrow(); delete f.row.original!.id; expect(() => duplicateRecordDraft(f.rows, 'source', f.context, 'copy')).toThrow('可靠键');
  });
  it.each(['data', 'original'] as const)('目录与%s出现未知字段时保守拒绝，不静默丢弃', side => {
    const f = fixture(); (side === 'data' ? f.row.data : f.row.original!).unknown_column = '未在目录中的值'; expect(() => duplicateRecordDraft(f.rows, 'source', f.context, 'copy')).toThrow('身份已变化');
  });
  it('生产目录保留INVISIBLE而SELECT星号遗漏时，复制必须拒绝，不能生成省略字段的INSERT', async () => {
    const f = fixture(); vi.mocked(execute).mockImplementation(async (_connection: unknown, sql: string) => {
      const rows = sql.includes('information_schema.COLUMNS') ? f.info.columns.map(column => ({ ...column, nullable: column.nullable ? 'YES' : 'NO' }))
        : sql.includes('information_schema.STATISTICS') ? [{ name: 'PRIMARY', nonUnique: 0, columnName: 'id', subPart: null, indexType: 'BTREE', sortDirection: 'A' }]
        : sql.includes('information_schema.KEY_COLUMN_USAGE') ? []
        : sql.includes('information_schema.TABLES') ? [{ engine: 'InnoDB', tableType: 'BASE TABLE', charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci', comment: '' }]
        : sql.startsWith('SHOW CREATE') ? [{ 'Create Table': "CREATE TABLE records (id BIGINT PRIMARY KEY AUTO_INCREMENT, server_hidden VARCHAR(40) INVISIBLE DEFAULT '服务器默认值')" }]
        : (() => { throw new Error('未授权的目录语句'); })(); return { rows, fields: [] } as never;
    });
    f.context.info = await tableInfo({ status: { dialect: 'mysql' }, sqlMode: '' } as never, 'db', 'records'); expect(f.context.info.columns.find(column => column.name === 'server_hidden')).toMatchObject({ generated: false, extra: 'INVISIBLE' });
    expect(buildPageSql(f.context.info, 1, 50, [], []).sql).toMatch(/^SELECT \* FROM/); delete f.row.data.server_hidden; delete f.row.original!.server_hidden;
    expect(recordDuplicateReadonlyReason(f.context, f.row)).toContain('server_hidden'); expect(() => duplicateRecordDraft(f.rows, 'source', f.context, 'copy')).toThrow(); expect(collectChanges(f.rows)).toEqual([]);
  });
});
