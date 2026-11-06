import { describe, expect, it } from 'vitest';
import type { SqliteEditColumn } from '../../src/shared/sqliteTableEdit';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { captureMysqlQueryTransfer, capturePostgresQueryTransfer } from '../../src/renderer/postgresRecordTransfer';
import { defaultSqliteTransferMapping, queryToSqliteValues, prepareSqliteRecordTransfer, sqliteTransferTargets } from '../../src/renderer/sqliteRecordTransfer';
import { sqlitePastePlanValues } from '../../src/renderer/sqliteTableClipboard';

const column = (name: string, declaredType: string, extra: Partial<SqliteEditColumn> = {}): SqliteEditColumn =>
  ({ name, declaredType, nullable: true, generated: false, hasDefault: false, ...extra });
const source = (names = ['exact', 'precise', 'raw', 'missing']) => {
  const columns = ['BIGINT', 'NUMERIC', 'BYTEA', 'TEXT'].map((type, index) => ({ key: 'c' + index, name: names[index], type }));
  return capturePostgresQueryTransfer({ connectionId: 'pg', label: 'PG', database: 'postgres', title: '源', result: 1 }, {
    columns, rows: [{ c0: '9223372036854775807', c1: '9007199254740993.000000000000000001', c2: { type: 'binary', base64: 'AP8=' }, c3: null },
      { c0: '-9223372036854775808', c1: '0.000000000000000001', c2: { type: 'binary', base64: '' }, c3: '' }],
    truncated: false, elapsedMs: 0, statement: '',
  }, columns);
};
function destination(columns: SqliteEditColumn[], strict?: true): SqliteTablePage {
  return { target: { connectionId: 'sqlite', database: 'main', table: '目标', kind: 'table' }, schemaKey: 'schema',
    columns, result: { columns: [], rows: [], truncated: false, elapsedMs: 0, statement: '' }, offset: 0, limit: 10, hasMore: false,
    edit: { kind: 'editable', snapshotId: 'page', expiresAt: '2000-01-01T00:00:00Z', columns, rows: [], strict, locator: { kind: 'rowid', columns: [] } } };
}

describe('PostgreSQL 查询结果复制到 SQLite', () => {
  it('保留整数上下界、精确小数、字节及空值，STRICT ANY 可保存小数原文', () => {
    const snapshot = source(), values = queryToSqliteValues(snapshot);
    const page = destination([column('exact', 'INTEGER'), column('precise', 'ANY'), column('raw', 'BLOB'), column('missing', 'TEXT')], true);
    const mapping = defaultSqliteTransferMapping(snapshot, page, values);
    expect(mapping.map(item => item.column)).toEqual(['exact', 'precise', 'raw', 'missing']);
    expect(sqlitePastePlanValues(prepareSqliteRecordTransfer(page, values, mapping), page)).toEqual([
      [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'text', value: '9007199254740993.000000000000000001' }, { kind: 'blob', value: '00ff' }, { kind: 'null' }],
      [{ kind: 'integer', value: '-9223372036854775808' }, { kind: 'text', value: '0.000000000000000001' }, { kind: 'blob', value: '' }, { kind: 'text', value: '' }],
    ]);
  });

  it('拒绝隐式小数浮点转换和 NULL 主键，重复别名不自动匹配', () => {
    const snapshot = source(['precise', 'precise', 'raw', 'missing']), values = queryToSqliteValues(snapshot);
    const page = destination([column('precise', 'NUMERIC'), column('safe', 'TEXT'), column('raw', 'BLOB'), column('missing', 'INTEGER', { primary: true })]);
    const mapping = defaultSqliteTransferMapping(snapshot, page, values);
    expect(mapping.map(item => item.column)).toEqual([null, null, 'raw', null]);
    expect(sqliteTransferTargets(page, values, 1).map(item => item.name)).toEqual(['safe', 'raw']);
    mapping[1].column = 'precise';
    expect(() => prepareSqliteRecordTransfer(page, values, mapping)).toThrow('不能原样保留');
    expect(sqliteTransferTargets(page, values, 3).map(item => item.name)).toEqual(['safe', 'raw']);
  });
});

describe('MySQL 和 MariaDB 查询结果复制到 SQLite', () => {
  it.each(['mysql', 'mariadb'] as const)('%s 超出 int64 的整数列整体保留文本，定点数和实际字节独立映射', dialect => {
    const columns = [
      { key: 'c0', name: 'unsigned', type: 'LONGLONG' }, { key: 'c1', name: 'signed', type: 'LONGLONG' },
      { key: 'c2', name: 'precise', type: 'NEWDECIMAL' }, { key: 'c3', name: 'raw', type: 'BLOB' },
      { key: 'c4', name: 'note', type: 'BLOB' }, { key: 'c5', name: 'small', type: 'LONG' },
    ];
    const capture = (unsigned: string | number) => captureMysqlQueryTransfer({ connectionId: 'src', label: dialect, title: '源', result: 1 }, dialect, {
      columns, rows: [
        { c0: unsigned, c1: '-9223372036854775808', c2: '9007199254740993.00000000000000000001', c3: { type: 'binary', base64: 'AP8=' }, c4: '0007', c5: 17 },
        { c0: '0', c1: '9223372036854775807', c2: '0.00000000000000000001', c3: { type: 'binary', base64: '' }, c4: null, c5: 0 },
      ], truncated: false, elapsedMs: 0, statement: '',
    }, columns);
    const snapshot = capture('18446744073709551615'), values = queryToSqliteValues(snapshot);
    const page = destination([column('unsigned', 'TEXT'), column('signed', 'INTEGER'), column('precise', 'ANY'),
      column('raw', 'BLOB'), column('note', 'TEXT'), column('small', 'INT'), column('lossy', 'REAL')], true);
    expect(sqliteTransferTargets(page, values, 0).map(item => item.name)).toEqual(['unsigned', 'precise', 'note']);
    const mapping = defaultSqliteTransferMapping(snapshot, page, values);
    expect(mapping.map(item => item.column)).toEqual(['unsigned', 'signed', 'precise', 'raw', 'note', 'small']);
    expect(sqlitePastePlanValues(prepareSqliteRecordTransfer(page, values, mapping), page)).toEqual([
      [{ kind: 'text', value: '18446744073709551615' }, { kind: 'integer', value: '-9223372036854775808' },
        { kind: 'text', value: '9007199254740993.00000000000000000001' }, { kind: 'blob', value: '00ff' }, { kind: 'text', value: '0007' }, { kind: 'integer', value: '17' }, undefined],
      [{ kind: 'text', value: '0' }, { kind: 'integer', value: '9223372036854775807' },
        { kind: 'text', value: '0.00000000000000000001' }, { kind: 'blob', value: '' }, { kind: 'null' }, { kind: 'integer', value: '0' }, undefined],
    ]);
    const inRange = capture('9223372036854775807'), inRangeValues = queryToSqliteValues(inRange);
    expect(inRangeValues[0][0]).toEqual({ kind: 'integer', value: '9223372036854775807' });
    const nextBatch = prepareSqliteRecordTransfer(page, inRangeValues, defaultSqliteTransferMapping(inRange, page, inRangeValues));
    expect(sqlitePastePlanValues(nextBatch, page).map(row => row[0]))
      .toEqual([{ kind: 'text', value: '9223372036854775807' }, { kind: 'text', value: '0' }]);
    expect(() => queryToSqliteValues(capture(9007199254740992))).toThrow('缺少可验证的精确整数原值');
  });
});
