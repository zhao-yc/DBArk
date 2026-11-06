import { describe, expect, it } from 'vitest';
import type { PostgresTableColumn, PostgresTablePage } from '../../src/shared/postgresTable';
import { captureMysqlQueryTransfer, capturePostgresQueryTransfer, capturePostgresRecordTransfer, captureSqliteQueryTransfer, defaultPostgresTransferMapping, postgresTransferChanges, samePostgresTransferTable } from '../../src/renderer/postgresRecordTransfer';
import { ResultExportSelection } from '../../src/renderer/resultExport';

const relation = { connectionId: '源连接', database: '源库', table: '"样本"."记录"', label: '来源' };
const note: PostgresTableColumn = { key: 'c0', name: '原备注', type: 'text', nullable: true, generated: false, defaultValue: false, primary: false, binary: false };
const amount = { ...note, key: 'c1', name: '金额', type: 'numeric(40,18)' };
const bytes = { ...note, key: 'c2', name: '字节', type: 'bytea', binary: true };
const id: PostgresTableColumn = { ...note, key: 'c3', name: 'id', type: 'bigint', nullable: false, primary: true, sequenceDefault: true, defaultValue: true };
const source: PostgresTablePage = {
  exportToken: '源页', columns: [note, amount, bytes, id], rows: [
    { c0: null, c1: '9007199254740993.000000000000000001', c2: { type: 'binary', base64: 'AP8=' }, c3: '1' },
    { c0: '', c1: '0.000000000000000001', c2: { type: 'binary', base64: '' }, c3: '2' },
  ], capabilities: { insert: false, update: false, delete: false }, hasNext: false, truncated: false, order: 'unstable', relationKind: 'v',
};
const target: PostgresTablePage = {
  ...source, pageToken: '目标页', capabilities: { insert: true, update: false, delete: false }, relationKind: 'r',
  columns: [{ ...note, key: 'c2', name: '备注' }, { ...amount, key: 'c0' }, { ...bytes, key: 'c1' }, id],
};
const capture = () => capturePostgresRecordTransfer(relation, source, source.columns, new Set([1, 0]));

describe('PostgreSQL 跨库记录草稿', () => {
  it.each(['mysql', 'mariadb'] as const)('%s 以实际协议值匹配目标，未用类型名猜测二进制或整数范围', dialect => {
    const columns = [
      { key: 'c0', name: '大整数', type: 'LONGLONG' },
      { key: 'c1', name: '金额', type: 'NEWDECIMAL' },
      { key: 'c2', name: '字节', type: 'BLOB' },
      { key: 'c3', name: '文本', type: 'BLOB' },
      { key: 'c4', name: '混合', type: 'VAR_STRING' },
    ];
    const rows = [
      { c0: '18446744073709551615', c1: '1.000000000000000001', c2: { type: 'binary' as const, base64: 'AP8=' }, c3: '0007', c4: 'text' },
      { c0: '0', c1: '0.000000000000000001', c2: null, c3: '', c4: { type: 'binary' as const, base64: '' } },
    ];
    const snapshot = captureMysqlQueryTransfer({ ...relation, title: '网络查询', result: 2 }, dialect,
      { columns, rows, truncated: false, elapsedMs: 0, statement: 'USE other;' }, columns);
    expect(snapshot.source).toMatchObject({ dialect, result: 2 });
    expect(snapshot.source).not.toHaveProperty('database');
    expect(snapshot.columns.map(column => [column.binary, column.automaticType])).toEqual([
      [false, 'numeric'], [false, 'numeric'], [true, 'bytea'], [false, undefined], [true, undefined],
    ]);
    const destinations = [{ ...amount, key: 'c0', name: '大整数', type: 'numeric' },
      { ...amount, key: 'c1', type: 'numeric' }, bytes, { ...note, key: 'c3', name: '文本' }];
    const mapping = defaultPostgresTransferMapping(snapshot, destinations);
    expect([...mapping]).toEqual([['c0', 'c0'], ['c1', 'c1'], ['c2', 'c2']]);
    mapping.set('c3', 'c3');
    expect(postgresTransferChanges(snapshot, { ...target, columns: destinations }, mapping)[0]).toEqual({
      kind: 'insert', fields: [{ column: 'c0', value: { mode: 'text', value: '18446744073709551615' } },
        { column: 'c1', value: { mode: 'text', value: '1.000000000000000001' } },
        { column: 'c2', value: { mode: 'binary', value: '00ff' } }, { column: 'c3', value: { mode: 'text', value: '0007' } }],
    });
    mapping.set('c2', 'c4');
    expect(() => postgresTransferChanges(snapshot, { ...target, columns: destinations }, mapping)).toThrow('不匹配');
  });

  it('SQLite 类型随勾选行及可见列投影，整数原文、BLOB 与文本分别映射', () => {
    const columns = ['整数', '隐藏', '字节', '原备注'].map((name, index) => ({ key: 'c' + index, name, type: 'SQLITE' }));
    const result = { columns, rows: [
      { c0: '9223372036854775807', c1: '隐', c2: { type: 'binary' as const, base64: 'AP8=' }, c3: '0007' },
      { c0: '-9223372036854775808', c1: '隐', c2: null, c3: '' },
      { c0: '7', c1: '隐', c2: '42', c3: '未勾选' },
    ], sqliteStorage: { version: 1 as const, rows: ['itbt', 'itnt', 'itit'] }, truncated: false, elapsedMs: 0, statement: '' };
    const selection = new ResultExportSelection(), visible = [columns[2], columns[3], columns[0]];
    const binding = selection.bind(result, [], visible)!;
    expect(selection.select(binding, { scope: binding, rows: result.rows, columns: visible, indices: new Set([1, 0]) })).toBe(true);
    const selected = selection.sqliteSnapshot(binding);
    expect(selected.sqliteStorage?.rows).toEqual(['bti', 'nti']);
    const snapshot = captureSqliteQueryTransfer({ ...relation, title: '源', result: 1 }, selected);
    expect(snapshot.columns.map(column => [column.name, column.type, column.automaticType])).toEqual([
      ['字节', 'BLOB / NULL', 'bytea'], ['原备注', 'TEXT', 'text'], ['整数', 'INTEGER', 'bigint'],
    ]);
    const destinations = [{ ...bytes, key: 'c0' }, { ...note, key: 'c1' }, { ...id, key: 'c2', name: '整数', sequenceDefault: undefined }];
    const mapping = defaultPostgresTransferMapping(snapshot, destinations);
    expect(postgresTransferChanges(snapshot, { ...target, columns: destinations }, mapping)).toEqual([
      { kind: 'insert', fields: [{ column: 'c0', value: { mode: 'binary', value: '00ff' } }, { column: 'c1', value: { mode: 'text', value: '0007' } },
        { column: 'c2', value: { mode: 'text', value: '9223372036854775807' } }] },
      { kind: 'insert', fields: [{ column: 'c0', value: { mode: 'null' } }, { column: 'c1', value: { mode: 'text', value: '' } },
        { column: 'c2', value: { mode: 'text', value: '-9223372036854775808' } }] },
    ]);
    result.sqliteStorage.rows[0] = 'ttbt';
    expect(() => selection.sqliteSnapshot(binding)).toThrow();
  });

  it('SQLite 缺少存储证据拒绝，混合 BLOB 和标量不可映射，全 NULL 可映射到 BYTEA', () => {
    const columns = ['混合', '全空'].map((name, index) => ({ key: 'c' + index, name, type: 'SQLITE' }));
    const rows = [{ c0: '7', c1: null }, { c0: { type: 'binary' as const, base64: '' }, c1: null }];
    const source = { ...relation, title: 'SQLite 查询', result: 1 };
    const selected = { columns, rows, truncated: true, elapsedMs: 0, statement: '' };
    expect(() => captureSqliteQueryTransfer(source, selected)).toThrow();
    expect(() => captureSqliteQueryTransfer(source, { ...selected, sqliteStorage: { version: 1, rows: ['tn', 'tn'] } })).toThrow();
    const snapshot = captureSqliteQueryTransfer(source, { ...selected, sqliteStorage: { version: 1, rows: ['in', 'bn'] } });
    const destination = { ...target, columns: [bytes] };
    expect(snapshot.columns[0].mixedBinary).toBe(true);
    expect(() => postgresTransferChanges(snapshot, destination, new Map([[bytes.key, 'c0']]))).toThrow('不匹配');
    expect(postgresTransferChanges(snapshot, destination, new Map([[bytes.key, 'c1']]))).toEqual(
      rows.map(() => ({ kind: 'insert', fields: [{ column: bytes.key, value: { mode: 'null' } }] })),
    );
  });

  it('查询结果保留显示顺序、二进制类型及截断状态，重复别名不自动匹配', () => {
    const columns = [
      { key: 'c0', name: '备注', type: 'TEXT' },
      { key: 'c3', name: '备注', type: 'TEXT' },
      { key: 'c2', name: '字节', type: 'BYTEA' },
    ];
    const query = { ...relation, title: '只读查询', result: 2 };
    const selected = {
      columns: columns.map(column => ({ ...column, type: '' })),
      rows: [{ c0: '乙', c3: '其他', c2: { type: 'binary' as const, base64: '' } },
        { c0: '甲', c3: '其他', c2: { type: 'binary' as const, base64: 'AP8=' } }],
      truncated: true, elapsedMs: 0, statement: '原始 SQL',
    };
    const snapshot = capturePostgresQueryTransfer(query, selected, columns);
    expect(snapshot.source).toMatchObject({ title: '只读查询', result: 2, truncated: true });
    expect(samePostgresTransferTable(snapshot.source, relation)).toBe(false);
    expect(snapshot.columns.map(column => [column.position, column.type])).toEqual([[1, 'text'], [2, 'text'], [3, 'bytea']]);
    expect([...snapshot.rows[0]]).toEqual(Object.entries(selected.rows[0]));
    expect([...defaultPostgresTransferMapping(snapshot, target.columns)]).toEqual([['c1', 'c2']]);
    expect(() => capturePostgresQueryTransfer(query, selected, [...columns].reverse())).toThrow('变化');
  });

  it('按原页顺序保留精确小数、字节、NULL 与空字符串，序列由目标库维护', () => {
    const snapshot = capture();
    const mapping = defaultPostgresTransferMapping(snapshot, target.columns);
    expect([...mapping]).toEqual([['c0', 'c1'], ['c1', 'c2']]);
    mapping.set('c2', 'c0');
    expect(postgresTransferChanges(snapshot, target, mapping)).toEqual([
      { kind: 'insert', fields: [{ column: 'c0', value: { mode: 'text', value: '9007199254740993.000000000000000001' } },
        { column: 'c1', value: { mode: 'binary', value: '00ff' } }, { column: 'c2', value: { mode: 'null' } }] },
      { kind: 'insert', fields: [{ column: 'c0', value: { mode: 'text', value: '0.000000000000000001' } },
        { column: 'c1', value: { mode: 'binary', value: '' } }, { column: 'c2', value: { mode: 'text', value: '' } }] },
    ]);
    expect(samePostgresTransferTable(relation, { ...relation, database: '目标库' })).toBe(false);
    expect(samePostgresTransferTable(relation, { ...relation, label: '改名' })).toBe(true);
  });

  it('拒绝缺失字段、生成列、字节到文本、必填目标缺少映射与 NULL', () => {
    const snapshot = capture();
    const columns = [{ ...target.columns[0], nullable: false }, ...target.columns.slice(1), { ...note, key: 'c4', generated: true }];
    const required = { ...target, columns };
    for (const [mapping, message] of [
      [new Map([['c4', 'c0']]), '不匹配'],
      [new Map([['c2', 'c2']]), '不匹配'],
      [new Map([['c2', 'c8']]), '不匹配'],
      [new Map([['c0', 'c1']]), '没有默认值'],
      [new Map([['c2', 'c0']]), 'NULL'],
    ] as const) expect(() => postgresTransferChanges(snapshot, required, mapping)).toThrow(message);
  });

  it('仅复制选择的可见字段，拒绝不完整和超出预算的来源', () => {
    const snapshot = capturePostgresRecordTransfer(relation, source, [amount], new Set([1]));
    expect([...snapshot.rows[0]]).toEqual([['c1', '0.000000000000000001']]);
    expect(() => capturePostgresRecordTransfer(relation, { ...source, truncated: true }, [amount], new Set([1]))).toThrow('变化');
    expect(() => capturePostgresRecordTransfer(relation, { ...source, rows: [{}] }, [amount], new Set([0]))).toThrow('不完整');
    expect(() => capturePostgresRecordTransfer(relation, { ...source, rows: [{ c1: 'x'.repeat(262145) }] }, [amount], new Set([0]))).toThrow('1 MiB');
    const large = capturePostgresRecordTransfer(relation, { ...source, rows: [{ c1: 'x'.repeat(65536) }] }, [amount], new Set([0]));
    const destinations = Array.from({ length: 4 }, (_, index) => ({ ...amount, key: 'c' + index }));
    expect(() => postgresTransferChanges(large, { ...target, columns: destinations },
      new Map(destinations.map(column => [column.key, amount.key])))).toThrow('1 MiB');
  });
});
