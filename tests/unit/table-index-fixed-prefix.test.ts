import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { editableIndexDefinition, readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { crossCheckIndexStatistics, deriveIndexCapabilities, deriveTrustedIndexColumn, type IndexColumnMetadata } from '../../src/engine/tableIndexMetadata';
import { planTableIndexPatches } from '../../src/engine/tableIndexPatchSql';
import { verifyIndexAfter } from '../../src/engine/tableIndexVerification';
import type { IndexStructureRead } from '../../src/engine/tableIndexRead';
import type { IndexDefinition, IndexPatch, IndexPlanOptions } from '../../src/shared/tableIndexPatches';
import type { TableDefinitionContext } from '../../src/shared/tableColumnPatches';

const fields = "id int NOT NULL,c char(255) DEFAULT '原值' COMMENT '字符列',d char(255),e char(255),b binary(255)";
const oldKeys = "KEY old_c(c(2)) COMMENT '原索引',KEY spare(id)";
const suffix = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='原表尾'";
const ddl = (keys = oldKeys) => `CREATE TABLE t(${fields},${keys},CONSTRAINT ck CHECK(id>0)) ${suffix}`;
/** 目录是显式合成事实；不从前缀请求反填字段长度、单位或字符集。 */
function metadata(name: string): IndexColumnMetadata {
  const integer = name === 'id', binary = name === 'b';
  return { COLUMN_NAME: name, DATA_TYPE: integer ? 'int' : binary ? 'binary' : 'char', COLUMN_TYPE: integer ? 'int' : binary ? 'binary(255)' : 'char(255)', IS_NULLABLE: integer ? 'NO' : 'YES', CHARACTER_SET_NAME: integer || binary ? null : 'utf8mb4', COLLATION_NAME: integer || binary ? null : 'utf8mb4_bin', CHARACTER_MAXIMUM_LENGTH: integer ? null : '255', CHARACTER_OCTET_LENGTH: integer ? null : binary ? '255' : '1020', EXTRA: '' };
}
/** 使用真实列目录适配器、解析器、能力门和规划器；这里不导入数据库连接或真实测试入口。 */
function read(source = ddl(), dialect: 'mysql' | 'mariadb' = 'mysql'): IndexStructureRead {
  const context: TableDefinitionContext = { dialect, mode: { ansiQuotes: false, noBackslashEscapes: false } }, version = dialect === 'mysql' ? '8.4.11' : '11.4.13-MariaDB';
  const definition = parseTableColumnDefinition(source, context), indexDocument = readTableIndexDefinition(definition);
  const columns = new Map(definition.columns.map(column => [column.name, deriveTrustedIndexColumn(column, metadata(column.name), { definitionContext: context, ...(column.name === 'id' || column.name === 'b' ? {} : { charsetMaxBytes: 4 }) }).column]));
  const indexes = new Map(indexDocument.indexes.map(parsed => [parsed.name, { parsed, definition: editableIndexDefinition(parsed, columns), visible: true as const, generated: false as const }]));
  const capabilities = deriveIndexCapabilities({ dialect, serverVersion: version, engine: 'InnoDB', rowFormat: 'Dynamic', pageSize: 16384 }).capabilities!;
  const options: IndexPlanOptions = { database: 'db', dialect, serverVersion: version, engine: 'InnoDB', sqlMode: context.mode, capabilities, checks: { foreignKeyChecks: 1, uniqueChecks: 1 } };
  return { source, context, originalMode: 'STRICT_ALL_TABLES', normalizedMode: 'STRICT_ALL_TABLES', identity: '合成固定身份', serverVersion: version, nullability: definition.columns.map(column => [column.name, column.name !== 'id']), encodings: definition.columns.map(column => ({ name: column.name, charset: metadata(column.name).CHARACTER_SET_NAME, collation: metadata(column.name).COLLATION_NAME })), tableEncoding: { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, model: { definition, indexDocument, columns, indexes, dependencies: { incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, outgoingComplete: true, foreignKeys: [], autoIncrementColumnRefs: [], partition: { kind: 'none' }, hiddenDependencies: [], automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] } } }, options, warnings: [], catalogDigest: '合成目录摘要', dependencyDigest: '合成依赖摘要', bytes: Buffer.byteLength(source) };
}
/** 请求只携带结构化键部分，不拼字段名长度表达式冒充正式前缀。 */
const index = (parts: IndexDefinition['keyParts'], kind: IndexDefinition['kind'] = 'ordinary'): IndexDefinition => ({ name: kind === 'primary' ? 'PRIMARY' : 'added', kind, method: 'BTREE', comment: '', keyParts: parts });
const part = (columnRef: string, prefixLength: number) => ({ columnRef, prefixLength, direction: 'asc' as const });
/** 能力取自上述独立合成服务器事实，经真实门限函数产生，不硬编码ready结果。 */
function plan(before: IndexStructureRead, value: IndexDefinition) { return planTableIndexPatches(before.model, [{ op: 'add', clientKey: 'new', definition: value }], before.options!); }

describe.each(['mysql', 'mariadb'] as const)('%s已有表CHAR/BINARY前缀纯链路', dialect => {
  it.each(['c', 'b'])('%s可新增普通前缀，并由原SHOW及目录模型独立后核', name => {
    const before = read(ddl(), dialect), result = plan(before, index([part(name, 8)]));
    expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect(result.sql).toContain(`INDEX \`added\` USING BTREE (\`${name}\`(8) ASC)`);
    const after = read(ddl(`${oldKeys},KEY added(${name}(8)) COMMENT ''`), dialect);
    expect(verifyIndexAfter(before, result, after)).toBe(true);
    expect(before.model.columns.get(name)!.prefix).toEqual({ kind: 'allowed', unit: name === 'b' ? 'bytes' : 'characters', maxLength: 255 });
  });
  it('三个CHAR前缀和BINARY前缀累计3072字节可用，3073字节拒绝且不自动截短', () => {
    const before = read(ddl(), dialect), parts = [part('c', 255), part('d', 255), part('e', 255)];
    expect(plan(before, index([...parts, part('b', 12)])).kind).toBe('ready');
    expect(plan(before, index([...parts, part('b', 13)])).kind).toBe('blocked');
  });
  it.each(['c', 'b'])('%s字段最大长度255可用，256及非法整数拒绝', name => {
    const before = read(ddl(), dialect); expect(plan(before, index([part(name, 255)])).kind).toBe('ready');
    for (const length of [0, -1, 1.5, 256, NaN, Infinity]) expect(plan(before, index([part(name, length)])).kind).toBe('blocked');
  });
  it.each(['c', 'b'])('%s单位矛盾、缺失或未知能力不能进入计划', name => {
    for (const prefix of [{ kind: 'allowed', unit: name === 'b' ? 'characters' : 'bytes', maxLength: 255 }, { kind: 'unknown', reason: '目录未知' }, { kind: 'forbidden', reason: '只读' }] as const) {
      const before = read(ddl(), dialect); before.model.columns.get(name)!.prefix = prefix;
      expect(plan(before, index([part(name, 2)])).kind).toBe('blocked');
    }
    const before = read(ddl(), dialect); delete before.model.columns.get('c')!.charsetMaxBytes;
    expect(plan(before, index([part('c', 2)])).kind).toBe('blocked');
  });
  it('唯一前缀仍生成UNIQUE，不降级为普通键；主键前缀拒绝', () => {
    const before = read(ddl(), dialect), value = plan(before, index([part('c', 2), part('b', 2)], 'unique'));
    expect(value.kind).toBe('ready'); if (value.kind === 'ready') expect(value.sql).toContain('UNIQUE INDEX `added`');
    expect(plan(before, index([part('c', 2)], 'primary')).kind).toBe('blocked');
  });
  it('替换只改指定索引，原注释、列默认、旁键、CHECK及表尾必须保持', () => {
    const before = read(ddl(), dialect), patches: IndexPatch[] = [{ op: 'alter', indexRef: 'old_c', changes: { keyParts: [part('c', 3), part('b', 2)] } }];
    const result = planTableIndexPatches(before.model, patches, before.options!); expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect(result.sql).toContain("COMMENT '原索引'"); expect(result.sql).not.toMatch(/MODIFY|CHANGE COLUMN|ROW_FORMAT/);
    const replacement = "KEY old_c(c(3),b(2)) COMMENT '原索引',KEY spare(id)";
    expect(verifyIndexAfter(before, result, read(ddl(replacement), dialect))).toBe(true);
    for (const changed of [ddl(replacement).replace("DEFAULT '原值'", "DEFAULT '变更'"), ddl(replacement).replace('CHECK(id>0)', 'CHECK(id>=0)'), ddl(replacement).replace("COMMENT='原表尾'", "COMMENT='新表尾'"), ddl(replacement).replace('KEY spare(id)', 'KEY spare(d)'), ddl(replacement).replace("COMMENT '原索引'", "COMMENT '变更'")]) expect(verifyIndexAfter(before, result, read(changed, dialect))).toBe(false);
  });
  it.each(['c', 'b'])('%s前缀被服务器截短不能报完整后核', name => {
    const before = read(ddl(), dialect), result = plan(before, index([part(name, 3)])); expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect(verifyIndexAfter(before, result, read(ddl(`${oldKeys},KEY added(${name}(2)) COMMENT ''`), dialect))).toBe(false);
  });
});

describe('CHAR/BINARY真实目录形状的拒绝边界', () => {
  it.each(['c', 'b'])('%s不得默认缺失、NULL、零或冲突的长度', name => {
    const parsed = read().model.definition.columns.find(column => column.name === name)!;
    for (const change of [{ CHARACTER_MAXIMUM_LENGTH: null }, { CHARACTER_OCTET_LENGTH: null }, { CHARACTER_MAXIMUM_LENGTH: '0' }, { CHARACTER_MAXIMUM_LENGTH: '254' }, { CHARACTER_OCTET_LENGTH: '254' }]) expect(() => deriveTrustedIndexColumn(parsed, { ...metadata(name), ...change }, { definitionContext: read().context, charsetMaxBytes: 4 })).toThrow();
  });
  it('已有CHAR前缀的SUB_PART必须与原SHOW逐项相同', () => {
    const parsed = read().model.indexDocument.indexes[0], row = { INDEX_NAME: 'old_c', COLUMN_NAME: 'c', SEQ_IN_INDEX: 1, NON_UNIQUE: 1, INDEX_TYPE: 'BTREE', COLLATION: 'A', SUB_PART: 2, INDEX_COMMENT: '原索引' };
    const capabilities = { visibility: false, ignored: false, expression: false };
    expect(() => crossCheckIndexStatistics(parsed, [row], capabilities)).not.toThrow();
    for (const value of [null, 1, 3]) expect(() => crossCheckIndexStatistics(parsed, [{ ...row, SUB_PART: value }], capabilities)).toThrow('前缀');
  });
  it.each([{ generated: true }, { hidden: true }, { dataType: 'JSON' }])('生成隐藏及未知类型继续拒绝：%j', change => {
    const before = read(); Object.assign(before.model.columns.get('c')!, change); expect(plan(before, index([part('c', 2)])).kind).toBe('blocked');
  });
});
