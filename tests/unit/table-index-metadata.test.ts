import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { planTableIndexPatches } from '../../src/engine/tableIndexPatchSql';
import type { IndexPlanSnapshot } from '../../src/shared/tableIndexPatches';
import { crossCheckIndexStatistics, deriveIndexCapabilities, deriveStatisticsCapabilities, deriveTrustedIndexColumn, type IndexCapabilityMetadata, type IndexColumnMetadata } from '../../src/engine/tableIndexMetadata';
import type { TableDefinitionContext } from '../../src/shared/tableColumnPatches';

const context: TableDefinitionContext = { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } };
/** 仅构造显式目录记录，不从被测返回值反向制造期待值。 */
function metadata(type = 'int', overrides: Partial<IndexColumnMetadata> = {}): IndexColumnMetadata {
  return { COLUMN_NAME: 'v', DATA_TYPE: type.split('(')[0].split(' ')[0], COLUMN_TYPE: type, IS_NULLABLE: 'YES', CHARACTER_SET_NAME: null, COLLATION_NAME: null, CHARACTER_MAXIMUM_LENGTH: null, CHARACTER_OCTET_LENGTH: null, EXTRA: '', ...overrides };
}
function column(sql = '`v` int', data = metadata(), charsetMaxBytes?: string | number) {
  const parsed = parseTableColumnDefinition(`CREATE TABLE t(${sql})`, context).columns[0];
  return deriveTrustedIndexColumn(parsed, data, { definitionContext: context, ...(charsetMaxBytes === undefined ? {} : { charsetMaxBytes }) });
}
const base: IndexCapabilityMetadata = { dialect: 'mysql', serverVersion: '8.4.11', engine: 'InnoDB', rowFormat: 'Dynamic', pageSize: '16384' };
const varchar = () => metadata('varchar(20)', { CHARACTER_SET_NAME: 'utf8mb4', COLLATION_NAME: 'utf8mb4_bin', CHARACTER_MAXIMUM_LENGTH: '20', CHARACTER_OCTET_LENGTH: '80' });

describe('索引可信能力与列目录适配', () => {
  it.each([
    ['mysql', '5.7.44', false], ['mysql', '8.0.46', true], ['mysql', '8.4.11', true],
    ['mariadb', '10.11.19-MariaDB-ubu2204', true], ['mariadb', '11.4.13-MariaDB-ubu2404', true],
  ] as const)('只开放已证 %s %s 的方向和改名', (dialect, serverVersion, descendingIndexes) => {
    expect(deriveIndexCapabilities({ ...base, dialect, serverVersion, largePrefix: true })).toEqual({ writable: true, reasons: [], capabilities: { renameIndex: true, descendingIndexes, maxKeyParts: dialect === 'mysql' ? 16 : 32, maxIndexNameCharacters: 64, maxIndexCommentBytes: 1024, maxKeyBytes: 3072, specialIndexes: { fulltext: true, spatial: true, spatialRequiresSrid: dialect === 'mysql' && serverVersion.startsWith('8.') } } } );
  });
  it.each([['mysql', '8.4.11', 16], ['mariadb', '11.4.13-MariaDB', 32]] as const)('%s 键列上限直接限制纯计划，不能等待服务器拒绝', (dialect, serverVersion, maximum) => {
    const definitionContext = { ...context, dialect };
    const definition = parseTableColumnDefinition(`CREATE TABLE t(${Array.from({ length: 32 }, (_, i) => `c${i} int NOT NULL`).join(',')})`, definitionContext);
    const columns = new Map(definition.columns.map(parsed => [parsed.name, deriveTrustedIndexColumn(parsed, metadata('int', { COLUMN_NAME: parsed.name, IS_NULLABLE: 'NO' }), { definitionContext }).column]));
    const snapshot: IndexPlanSnapshot = { definition, indexDocument: readTableIndexDefinition(definition), columns, indexes: new Map(), dependencies: { incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, outgoingComplete: true, foreignKeys: [], autoIncrementColumnRefs: [], partition: { kind: 'none' }, hiddenDependencies: [], automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] } } };
    const capabilities = deriveIndexCapabilities({ ...base, dialect, serverVersion }).capabilities!;
    const plan = (count: number) => planTableIndexPatches(snapshot, [{ op: 'add', clientKey: 'new', definition: { kind: 'ordinary', name: 'many_parts', method: 'BTREE', comment: '', keyParts: Array.from({ length: count }, (_, i) => ({ columnRef: `c${i}`, direction: 'asc' as const })) } }], { database: 'db', dialect, serverVersion, engine: 'InnoDB', sqlMode: context.mode, capabilities, checks: { foreignKeyChecks: 1, uniqueChecks: 1 } });
    expect(plan(maximum).kind).toBe('ready');
    expect(plan(17).kind).toBe(dialect === 'mysql' ? 'blocked' : 'ready');
  });
  it.each([
    { serverVersion: '8.4.12' }, { engine: 'MyISAM' }, { rowFormat: 'Compact' }, { rowFormat: 'Compressed' },
    { pageSize: 8192 }, { pageSize: '16384x' }, { serverVersion: '5.7.44' }, { serverVersion: '5.7.44', largePrefix: false },
  ])('未知组合明确只读，不伪造可写 capability：%j', change => {
    const result = deriveIndexCapabilities({ ...base, ...change }); expect(result.writable).toBe(false); expect(result.capabilities).toBeUndefined(); expect(result.reasons.length).toBeGreaterThan(0);
  });
  it('可空省略时使用可信目录真值，显式冲突不能被目录覆盖', () => {
    expect(column().column.nullable).toBe(true);
    expect(column('v int NOT NULL', metadata('int', { IS_NULLABLE: 'NO' })).column.nullable).toBe(false);
    expect(() => column('v int NOT NULL')).toThrow('可空');
  });
  it('VARCHAR 完整长度和前缀按真实字符集 MAXLEN 核验', () => {
    const result = column('v varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', varchar(), '4');
    expect(result.writable).toBe(true); expect(result.column.fullKeyBytes).toBe(80);
    expect(result.column.prefix).toEqual({ kind: 'allowed', unit: 'characters', maxLength: 20 });
    expect(result.column.characterMaxLength).toBe('20');
    expect(() => column('v varchar(20)', varchar())).toThrow('MAXLEN');
    expect(() => column('v varchar(20)', { ...varchar(), CHARACTER_OCTET_LENGTH: '40' }, 4)).toThrow('MAXLEN');
    expect(() => column('v varchar(20)', { ...varchar(), CHARACTER_MAXIMUM_LENGTH: '21' }, 4)).toThrow();
  });
  it('VARBINARY 按字节，LOB 保留前缀但不提供完整键长度', () => {
    const binary = column('v varbinary(20)', metadata('varbinary(20)', { CHARACTER_MAXIMUM_LENGTH: '20', CHARACTER_OCTET_LENGTH: 20 }));
    expect(binary.column.fullKeyBytes).toBe(20); expect(binary.column.prefix).toEqual({ kind: 'allowed', unit: 'bytes', maxLength: 20 });
    for (const type of ['text', 'blob']) {
      const result = column(`v ${type}`, metadata(type, { CHARACTER_MAXIMUM_LENGTH: '65535', CHARACTER_OCTET_LENGTH: '65535', ...(type === 'text' ? { CHARACTER_SET_NAME: 'utf8mb4', COLLATION_NAME: 'utf8mb4_bin' } : {}) }), type === 'text' ? 4 : undefined);
      expect(result.writable).toBe(true); expect(result.column.fullKeyBytes).toBeUndefined(); expect(result.column.prefix.kind).toBe('allowed');
    }
  });
  it.each(['char', 'binary'])('%s 完整键可有长度证明，未验证前缀仍拒绝', type => {
    const result = column(`v ${type}(4)`, metadata(`${type}(4)`, { CHARACTER_MAXIMUM_LENGTH: 4, CHARACTER_OCTET_LENGTH: type === 'char' ? 16 : 4, ...(type === 'char' ? { CHARACTER_SET_NAME: 'utf8mb4', COLLATION_NAME: 'utf8mb4_bin' } : {}) }), type === 'char' ? 4 : undefined);
    expect(result.writable).toBe(true); expect(result.column.prefix.kind).toBe('forbidden');
    expect(result.column.fullKeyBytes).toBe(type === 'char' ? 16 : 4);
  });
  it.each([
    ['tinyint', 1], ['smallint unsigned', 2], ['mediumint(8)', 3], ['int', 4], ['bigint unsigned', 8],
    ['decimal(30,6)', 14], ['decimal(65,30)', 30], ['float', 8], ['double', 8], ['bit(1)', 1], ['bit(9)', 2], ['bit(64)', 8],
    ['date', 3], ['year', 1], ['time(6)', 6], ['datetime(6)', 8], ['timestamp(6)', 7],
  ] as const)('%s 只采用公开保守字节上界 %s，禁止前缀', (type, bytes) => {
    const result = column(`v ${type}`, metadata(type)); expect(result.writable).toBe(true); expect(result.column.fullKeyBytes).toBe(bytes); expect(result.column.prefix.kind).toBe('forbidden');
  });
  it('未知类型与 JSON/空间类型保持只读，无猜测的普通 BTREE 成本', () => {
    for (const type of ['json', 'geometry', 'point']) { const result = column(`v ${type}`, metadata(type)); expect(result.writable).toBe(false); expect(result.column.fullKeyBytes).toBeUndefined(); }
    const json = column('v json', metadata('json', { CHARACTER_SET_NAME: 'utf8mb4', COLLATION_NAME: 'utf8mb4_bin', CHARACTER_MAXIMUM_LENGTH: '4294967295', CHARACTER_OCTET_LENGTH: '4294967295' }));
    expect(json.writable).toBe(false);
  });
  it('生成列、不可见列和未识别 EXTRA 不形成可写证明', () => {
    const generated = column('v int GENERATED ALWAYS AS (1) STORED', metadata('int', { EXTRA: 'STORED GENERATED' })); expect(generated.column.generated).toBe(true); expect(generated.writable).toBe(false);
    const hidden = column('v int INVISIBLE', metadata('int', { EXTRA: 'INVISIBLE' })); expect(hidden.column.hidden).toBe(true); expect(hidden.writable).toBe(false);
    expect(column('v int', metadata('int', { EXTRA: 'future_attribute' })).writable).toBe(false);
    expect(() => column('v int GENERATED ALWAYS AS (1) STORED', metadata('int', { EXTRA: 'VIRTUAL GENERATED' }))).toThrow('存储方式');
    expect(() => column('v int', metadata('int', { EXTRA: 'INVISIBLE' }))).toThrow('不可见');
  });
  it('类型、名字、字符集、自增及更新时间精度冲突立即拒绝', () => {
    expect(() => column('v int', metadata('int unsigned'))).toThrow('类型');
    expect(() => column('v int', metadata('int', { COLUMN_NAME: 'V' }))).toThrow('名称');
    expect(() => column('v varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', { ...varchar(), COLLATION_NAME: 'utf8mb4_general_ci' }, 4)).toThrow('排序规则');
    expect(() => column('v int', metadata('int', { EXTRA: 'auto_increment' }))).toThrow('自增');
    expect(() => column('v timestamp(6) ON UPDATE CURRENT_TIMESTAMP(6)', metadata('timestamp(6)', { EXTRA: 'on update CURRENT_TIMESTAMP(3)' }))).toThrow('精度');
    expect(column('v timestamp(6) ON UPDATE CURRENT_TIMESTAMP(6)', metadata('timestamp(6)', { EXTRA: 'on update CURRENT_TIMESTAMP(6)' })).writable).toBe(true);
  });
  it('合法原型敏感和 Unicode 名称保持精确，缺字段/unsafe number 不冒充 NULL', () => {
    expect(column('`__proto__` int', metadata('int', { COLUMN_NAME: '__proto__' })).column.name).toBe('__proto__');
    expect(column('`构``造` int', metadata('int', { COLUMN_NAME: '构`造' })).column.name).toBe('构`造');
    const missing = metadata(); delete (missing as Partial<IndexColumnMetadata>).EXTRA; expect(() => column('v int', missing)).toThrow('缺少');
    expect(() => column('v varchar(20)', { ...varchar(), CHARACTER_MAXIMUM_LENGTH: Number.MAX_SAFE_INTEGER + 1 }, 4)).toThrow('整数');
    let calls = 0; const accessor = metadata(); Object.defineProperty(accessor, 'EXTRA', { get() { calls++; return ''; } }); expect(() => column('v int', accessor)).toThrow('可信'); expect(calls).toBe(0);
  });
});

const mandatory = ['INDEX_NAME', 'COLUMN_NAME', 'SEQ_IN_INDEX', 'NON_UNIQUE', 'INDEX_TYPE', 'COLLATION', 'SUB_PART', 'INDEX_COMMENT'];
const row = () => ({ INDEX_NAME: 'i', COLUMN_NAME: 'v', SEQ_IN_INDEX: '1', NON_UNIQUE: 1, INDEX_TYPE: 'BTREE', COLLATION: 'D', SUB_PART: '3', INDEX_COMMENT: '注释', IS_VISIBLE: 'YES', EXPRESSION: null });
function parsedIndex() { return readTableIndexDefinition(parseTableColumnDefinition("CREATE TABLE t(v varchar(20),KEY i(v(3) DESC) COMMENT '注释')", context)).indexes[0]; }
describe('STATISTICS 能力与单索引交叉核对', () => {
  it('实际能力字段不完整/重复/超预算拒绝', () => {
    expect(() => deriveStatisticsCapabilities([])).toThrow(); expect(() => deriveStatisticsCapabilities([...mandatory, 'index_name'])).toThrow('重复');
    expect(() => deriveStatisticsCapabilities(['INDEX_NAME'])).toThrow('必需'); expect(() => deriveStatisticsCapabilities(Array(65).fill('A'))).toThrow('预算');
  });
  it('缺少可见性只返回 unknown，不从目录缺列推断 MySQL 5.7', () => {
    const result = crossCheckIndexStatistics(parsedIndex(), [row()], deriveStatisticsCapabilities(mandatory));
    expect(result.visible).toBe('unknown'); expect(result.generated).toBe('unknown'); expect(result.reasons.length).toBeGreaterThan(0);
  });
  it('可见性字段已证明才读，生成来源始终需要额外证据', () => {
    const caps = deriveStatisticsCapabilities([...mandatory, 'IS_VISIBLE', 'EXPRESSION']);
    expect(crossCheckIndexStatistics(parsedIndex(), [row()], caps)).toMatchObject({ visible: true, generated: 'unknown' });
    expect(crossCheckIndexStatistics(parsedIndex(), [{ ...row(), IS_VISIBLE: 'NO' }], caps).visible).toBe(false);
    const missing: Record<string, unknown> = row(); delete missing.IS_VISIBLE; expect(() => crossCheckIndexStatistics(parsedIndex(), [missing], caps)).toThrow('缺少');
  });
  it.each([{ SUB_PART: 2 }, { COLLATION: 'A' }, { SEQ_IN_INDEX: 0 }, { COLUMN_NAME: 'other' }, { NON_UNIQUE: 0 }, { INDEX_COMMENT: '变更' }])('目录与原片段的真实差异不能被忽略：%j', change => {
    expect(() => crossCheckIndexStatistics(parsedIndex(), [{ ...row(), ...change }], deriveStatisticsCapabilities([...mandatory, 'IS_VISIBLE', 'EXPRESSION']))).toThrow();
  });
});
