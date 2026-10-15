import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { editableIndexDefinition, readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { crossCheckIndexStatistics, deriveIndexCapabilities, deriveTrustedIndexColumn, type IndexColumnMetadata } from '../../src/engine/tableIndexMetadata';
import { deriveSpecialIndexColumn } from '../../src/engine/tableSpecialIndexMetadata';
import { planTableIndexPatches } from '../../src/engine/tableIndexPatchSql';
import { validateIndexPatches, type IndexDefinition, type IndexPlanOptions, type IndexPlanSnapshot } from '../../src/shared/tableIndexPatches';
import { assertSpecialIndexDefinition } from '../../src/shared/specialIndexRules';
import type { TableDefinitionContext } from '../../src/shared/tableColumnPatches';
import type { TableIndexGetOutput } from '../../src/shared/tableIndexTasks';
import { changeIndexDraftKind, indexAcknowledgementsComplete, indexColumnSelectable, indexCreationKinds, indexDraftPermission, makeIndexAlter, validateIndexDrafts } from '../../src/renderer/indexPatches';

const context: TableDefinitionContext = { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } };
const options: IndexPlanOptions = { database: 'fixture', dialect: 'mysql', serverVersion: '8.0.46', engine: 'InnoDB', sqlMode: context.mode, checks: { foreignKeyChecks: 1, uniqueChecks: 1 }, capabilities: deriveIndexCapabilities({ dialect: 'mysql', serverVersion: '8.0.46', engine: 'InnoDB', rowFormat: 'Dynamic', pageSize: 16384 }).capabilities! };
/** 自主目录数据与SQL分别给定，不把生产能力返回值反向制造期望。 */
function column(sql: string, overrides: Partial<IndexColumnMetadata> = {}, version = '8.0.46', dialect: 'mysql' | 'mariadb' = 'mysql', sridAvailable = true) {
  const mode = { ...context, dialect }, parsed = parseTableColumnDefinition(`CREATE TABLE t(${sql})`, mode).columns[0];
  const type = parsed.type.raw.toLowerCase(), text = /^(?:char|varchar|tinytext|text|mediumtext|longtext)/.test(type), length = /\((\d+)\)/.exec(type)?.[1] ?? '65535';
  const metadata: IndexColumnMetadata = { COLUMN_NAME: parsed.name, DATA_TYPE: type.split('(')[0], COLUMN_TYPE: type, IS_NULLABLE: parsed.nullable === false ? 'NO' : 'YES', CHARACTER_SET_NAME: text ? 'utf8mb4' : null, COLLATION_NAME: text ? 'utf8mb4_bin' : null, CHARACTER_MAXIMUM_LENGTH: text || type === 'blob' ? length : null, CHARACTER_OCTET_LENGTH: text || type === 'blob' ? /^(?:char|varchar)/.test(type) ? String(Number(length) * 4) : length : null, EXTRA: '', SRS_ID: 0, ...overrides };
  const trusted = deriveTrustedIndexColumn(parsed, metadata, { definitionContext: mode, charsetMaxBytes: 4 }).column;
  trusted.specialIndexes = deriveSpecialIndexColumn(parsed, metadata, trusted, mode, version, sridAvailable);
  return trusted;
}
/** 名称和稳定引用分离，保留BTREE及同表其他复杂键。 */
function snapshot(indexSql = ''): IndexPlanSnapshot {
  const definition = parseTableColumnDefinition(`CREATE TABLE t(id int NOT NULL,a text,b text,g point NOT NULL SRID 0,PRIMARY KEY(id)${indexSql ? ',' + indexSql : ''}) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`, context);
  const indexDocument = readTableIndexDefinition(definition), columns = new Map([['ref:id', column('id int NOT NULL')], ['ref:a', column('a text')], ['ref:b', column('b text')], ['ref:g', column('g point NOT NULL SRID 0')]]);
  return { definition, indexDocument, columns, indexes: new Map(indexDocument.indexes.map(parsed => [`index:${parsed.name}`, { parsed, definition: editableIndexDefinition(parsed, columns), visible: true, generated: false }])), dependencies: { incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, outgoingComplete: true, foreignKeys: [], autoIncrementColumnRefs: [], partition: { kind: 'none' }, hiddenDependencies: [], automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] } } };
}
function special(kind: 'fulltext' | 'spatial' = 'fulltext', names = [kind === 'fulltext' ? 'a' : 'g']): IndexDefinition { return { name: kind === 'fulltext' ? '全文`键' : '空间键', kind, method: kind === 'fulltext' ? 'FULLTEXT' : 'RTREE', comment: "引号'和\\路径", keyParts: names.map(name => ({ columnRef: `ref:${name}`, direction: 'asc' })) }; }
function plan(value = special(), model = snapshot(), changes: Partial<IndexPlanOptions> = {}) { return planTableIndexPatches(model, [{ op: 'add', clientKey: 'new', definition: value }], { ...options, ...changes }); }
function view(model = snapshot()): TableIndexGetOutput {
  return { target: { connectionId: 'unit', database: 'fixture', table: 't' }, snapshotId: 's', expiresAt: '2030-01-01T00:00:00Z', ddlHash: 'h', writable: true, warnings: [], incomingCoverage: model.dependencies.incomingCoverage, capabilities: { ...options.capabilities, dialect: 'mysql', serverVersion: options.serverVersion }, columns: [...model.columns].map(([columnRef, value]) => ({ ...value, columnRef, typeSql: value.columnType })), indexes: [...model.indexes].map(([indexRef, value]) => ({ indexRef, name: value.parsed.name, kind: value.definition?.kind ?? 'unsupported', rawSql: value.parsed.rawSql, editableDefinition: value.definition, unsupportedReasons: [], access: { drop: { allowed: true, reasons: [] }, rename: { allowed: false, reasons: ['只读'] }, replace: { allowed: false, reasons: ['只读'] } } })) };
}

describe('特殊索引字段、原定义和目录保真', () => {
  it.each(['char(20)', 'varchar(20)', 'tinytext', 'text', 'mediumtext', 'longtext'])('全文接受完整%s，不要求BTREE完整字节预算', type => {
    const value = column(`v ${type}`); expect(value.specialIndexes!.fulltext.allowed).toBe(true);
    if (type.includes('text')) expect(value.fullKeyBytes).toBeUndefined();
  });
  it.each(['int', 'json', 'blob', 'point'])('全文拒绝%s', type => { expect(column(`v ${type}`).specialIndexes!.fulltext.allowed).toBe(false); });
  it.each(['binary', 'ucs2', 'utf16', 'utf16le', 'utf32'])('不猜全文字符集%s的能力', charset => {
    const value = column('v text', { CHARACTER_SET_NAME: charset, COLLATION_NAME: `${charset}_bin` }); expect(value.specialIndexes!.fulltext.allowed).toBe(false);
  });
  it('相同全文元组必须有相同字符集和排序规则', () => {
    const model = snapshot(), definition = special('fulltext', ['a', 'b']); expect(() => assertSpecialIndexDefinition(definition, model.columns, options.capabilities)).not.toThrow();
    model.columns.get('ref:b')!.collation = 'utf8mb4_general_ci'; expect(() => assertSpecialIndexDefinition(definition, model.columns, options.capabilities)).toThrow('相同');
  });
  it.each(['SRID 0', '/*!80003 SRID 0 */', '/*!80003 SRID 4326 */'])('MySQL8只解释严格源SRID并与目录重核：%s', declaration => {
    const expected = declaration.includes('4326') ? 4326 : 0;
    expect(column(`g point NOT NULL ${declaration}`, { SRS_ID: String(expected) }).specialIndexes).toMatchObject({ spatial: { allowed: true }, srid: expected });
  });
  it.each([null, undefined, '0x', -1, 4294967296, 4326])('SRID目录缺失或冲突不冒充0：%j', SRS_ID => { expect(column('g point NOT NULL SRID 0', { SRS_ID }).specialIndexes!.spatial.allowed).toBe(false); });
  it('源无SRID、目录能力缺失或非严格可执行注释均不开放MySQL8空间新增', () => {
    for (const value of [column('g point NOT NULL'), column('g point NOT NULL SRID 0', {}, '8.0.46', 'mysql', false), column('g point NOT NULL /*!80003 SRID 0 INVISIBLE */')]) expect(value.specialIndexes!.spatial.allowed).toBe(false);
  });
  it.each([['mysql', '5.7.44'], ['mariadb', '10.11.19-MariaDB'], ['mariadb', '11.4.13-MariaDB']] as const)('%s %s不外推MySQL8的SRID目录', (dialect, version) => {
    expect(column('g geometry NOT NULL', {}, version, dialect, false).specialIndexes!.spatial.allowed).toBe(true);
    expect(column('g geometry', {}, version, dialect, false).specialIndexes!.spatial.allowed).toBe(false);
    expect(column('g geometry NOT NULL SRID 0', {}, version, dialect, false).specialIndexes!.spatial.allowed).toBe(false);
  });
  it('隐藏、生成或未知附加属性不能成为特殊索引字段', () => {
    for (const [sql, EXTRA] of [['v text INVISIBLE', 'INVISIBLE'], ['v text GENERATED ALWAYS AS (\'x\') STORED', 'STORED GENERATED'], ['v text', 'future_attribute']] as const) expect(column(sql, { EXTRA }).specialIndexes!.fulltext.allowed).toBe(false);
    expect(column('FTS_DOC_ID int').specialIndexes!.fulltext.allowed).toBe(false);
  });
  it.each([['FULLTEXT KEY ft (a)', 'FULLTEXT', 'fulltext'], ['SPATIAL KEY sg (g)', 'RTREE', 'spatial']] as const)('保留种类及方法而不误读为BTREE：%s', (sql, method, kind) => {
    const model = snapshot(sql), value = model.indexes.get(`index:${kind === 'fulltext' ? 'ft' : 'sg'}`)!;
    expect(value.parsed.opaqueReasons).toEqual([]); expect(value.definition).toMatchObject({ kind, method });
    expect(editableIndexDefinition(value.parsed, new Map())).toBeUndefined();
  });
  it.each(['FULLTEXT KEY ft (a) WITH PARSER ngram', 'FULLTEXT KEY ft (a) /*!50100 WITH PARSER ngram */', 'FULLTEXT KEY ft ((lower(a)))', 'FULLTEXT KEY ft (a(8))', 'FULLTEXT KEY ft (a ASC)', 'SPATIAL KEY sg (g DESC)', 'SPATIAL KEY sg USING RTREE(g)', 'SPATIAL KEY sg (g,a)'])('不猜无法保真定义：%s', sql => {
    const model = snapshot(sql), value = [...model.indexes.values()][1]; expect(value.parsed.rawSql).toBe(sql); expect(value.definition).toBeUndefined(); expect(value.parsed.opaqueReasons.length).toBeGreaterThan(0);
  });
  it.each([['FULLTEXT KEY ft(a)', 'FULLTEXT', null, null], ['SPATIAL KEY sg(g)', 'SPATIAL', 'A', 32], ['SPATIAL KEY sg(g)', 'SPATIAL', 'A', null]] as const)('交叉核对实际目录表示%s', (sql, INDEX_TYPE, COLLATION, SUB_PART) => {
    const parsed = [...snapshot(sql).indexes.values()][1].parsed;
    const row = { INDEX_NAME: parsed.name, COLUMN_NAME: parsed.parts[0].columnName, SEQ_IN_INDEX: 1, NON_UNIQUE: 1, INDEX_TYPE, COLLATION, SUB_PART, INDEX_COMMENT: '', EXPRESSION: null, IS_VISIBLE: 'YES' };
    expect(crossCheckIndexStatistics(parsed, [row], { expression: true, visibility: true, ignored: false }).visible).toBe(true);
    for (const change of [{ INDEX_TYPE: 'BTREE' }, { NON_UNIQUE: 0 }, { COLLATION: 'D' }, { SUB_PART: 16 }, { COLUMN_NAME: 'other' }]) expect(() => crossCheckIndexStatistics(parsed, [{ ...row, ...change }], { expression: true, visibility: true, ignored: false })).toThrow();
  });
});

describe('特殊索引SQL和依赖边界', () => {
  it.each(['fulltext', 'spatial'] as const)('%s生成专属ADD SQL，无USING BTREE、前缀或显式ASC', kind => {
    const result = plan(special(kind)); expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect(result.sql).toContain(`ADD ${kind === 'fulltext' ? 'FULLTEXT' : 'SPATIAL'} INDEX`); expect(result.sql).not.toMatch(/USING|\bASC\b|\bDESC\b/); expect(result.sql).toContain(kind === 'fulltext' ? '`全文``键` (`a`)' : '`空间键` (`g`)');
    expect(result.operations).toHaveLength(1); expect(result.warnings.some(w => w.code === 'fulltext-internal-rebuild')).toBe(kind === 'fulltext');
  });
  it.each([{ method: 'BTREE' }, { keyParts: [{ columnRef: 'ref:a', direction: 'desc' }] }, { keyParts: [{ columnRef: 'ref:a', direction: 'asc', prefixLength: 8 }] }, { parser: 'ngram' }])('非法特殊索引不能越过严格协议：%j', change => { expect(() => validateIndexPatches([{ op: 'add', clientKey: 'x', definition: { ...special(), ...change } }])).toThrow(); });
  it('空间索引只能一个完整空间字段，不能自动修改可空状态', () => {
    expect(plan(special('spatial', ['g', 'a'])).kind).toBe('blocked'); expect(plan(special('spatial', ['a'])).kind).toBe('blocked');
    const model = snapshot(); model.columns.get('ref:g')!.nullable = true; expect(plan(special('spatial'), model).kind).toBe('blocked');
  });
  it('未知版本能力、分区或显式全文内部定位列不外推', () => {
    expect(plan(special(), snapshot(), { capabilities: { ...options.capabilities, specialIndexes: undefined } }).kind).toBe('blocked');
    const model = snapshot(); model.dependencies = { ...model.dependencies, partition: { kind: 'unknown', reason: '目录不足' } }; expect(plan(special(), model).kind).toBe('blocked');
    const internal = snapshot(); internal.columns.get('ref:id')!.name = 'FTS_DOC_ID'; expect(plan(special(), internal).kind).toBe('blocked');
    expect(() => validateIndexPatches([{ op: 'add', clientKey: 'x', definition: { ...special(), name: 'FTS_DOC_ID_INDEX' } }])).toThrow('定位索引');
  });
  it('受控特殊索引只允许明确删除，不能改名、重建或跨方法转换', () => {
    const model = snapshot('FULLTEXT KEY ft(a),SPATIAL KEY sg(g)');
    for (const name of ['ft', 'sg']) {
      expect(planTableIndexPatches(model, [{ op: 'drop', indexRef: `index:${name}` }], options)).toMatchObject({ kind: 'ready', sql: `ALTER TABLE \`fixture\`.\`t\` DROP INDEX \`${name}\`;` });
      for (const changes of [{ name: 'renamed' }, { comment: '新注释' }, { kind: 'ordinary' }]) expect(planTableIndexPatches(model, [{ op: 'alter', indexRef: `index:${name}`, changes }], options).kind).toBe('blocked');
    }
    expect(planTableIndexPatches(model, [{ op: 'alter', indexRef: 'index:PRIMARY', changes: { kind: 'fulltext' } }], options).kind).toBe('blocked');
  });
  it('删除无外键支撑能力的特殊索引不要求完整入向目录，但不透明解析器仍只读', () => {
    const model = snapshot('FULLTEXT KEY ft(a)'); model.dependencies = { ...model.dependencies, incomingCoverage: { kind: 'partial', reason: 'permission' }, outgoingComplete: false };
    expect(planTableIndexPatches(model, [{ op: 'drop', indexRef: 'index:ft' }], options).kind).toBe('ready');
    const opaque = snapshot('FULLTEXT KEY ft(a) WITH PARSER ngram'); expect(planTableIndexPatches(opaque, [{ op: 'drop', indexRef: 'index:ft' }], options).kind).toBe('blocked');
    const keep = plan(special('spatial'), opaque); expect(keep.kind).toBe('ready'); if (keep.kind === 'ready') expect(keep.preservedOpaqueIndexRefs).toContain('index:ft');
  });
  it('FULLTEXT不能替代BTREE外键父键，不能误当唯一键', () => {
    const model = snapshot(); model.dependencies = { ...model.dependencies, foreignKeys: [{ foreignKeyRef: 'fk', direction: 'incoming', targetColumnRefs: ['ref:id'], support: { kind: 'known', rule: 'parent-exact-unique', candidateIndexRefs: ['index:PRIMARY'] } }] };
    const result = planTableIndexPatches(model, [{ op: 'drop', indexRef: 'index:PRIMARY' }, { op: 'add', clientKey: 'new', definition: special() }], options); expect(result.kind).toBe('blocked');
  });
  it('一次ALTER至多新增一个全文索引，不拆分或隐式重放', () => { expect(planTableIndexPatches(snapshot(), [{ op: 'add', clientKey: 'a', definition: special() }, { op: 'add', clientKey: 'b', definition: { ...special(), name: '另一个' } }], options).kind).toBe('blocked'); });
});

describe('特殊索引前端纯规则', () => {
  it('候选按算法投影，空间字段不进入普通BTREE候选', () => {
    const value = view(), text = value.columns.find(c => c.name === 'a')!, space = value.columns.find(c => c.name === 'g')!;
    expect(indexColumnSelectable(text, 'fulltext')).toBe(true); expect(indexColumnSelectable(space)).toBe(false); expect(indexColumnSelectable(space, 'spatial')).toBe(true); expect(indexColumnSelectable(text, 'spatial')).toBe(false);
    expect(indexCreationKinds(value)).toContain('spatial'); delete value.capabilities!.specialIndexes; expect(indexCreationKinds(value)).not.toContain('spatial');
  });
  it('新增种类切换移除旧前缀、方向与复合字段，方法同步', () => {
    const value = view(), old: IndexDefinition = { kind: 'ordinary', method: 'BTREE', name: 'x', comment: '', keyParts: [{ columnRef: 'ref:a', direction: 'desc', prefixLength: 8 }, { columnRef: 'ref:b', direction: 'asc', prefixLength: 8 }] };
    expect(changeIndexDraftKind(old, 'spatial', value.columns)).toEqual({ ...old, kind: 'spatial', method: 'RTREE', keyParts: [{ columnRef: 'ref:g', direction: 'asc' }] });
    expect(validateIndexDrafts(value, [{ op: 'add', clientKey: 'x', definition: special() }])).toHaveLength(1);
  });
  it('批量新增不能扩大已有特殊索引修改权限，特殊风险需明确确认', () => {
    const value = view(snapshot('FULLTEXT KEY ft(a)')), old = value.indexes.find(i => i.name === 'ft')!, additions = [{ op: 'add' as const, clientKey: 'x', definition: special('spatial') }];
    expect(indexDraftPermission(value, old.indexRef, 'drop', additions).allowed).toBe(true);
    for (const action of ['rename', 'replace'] as const) expect(indexDraftPermission(value, old.indexRef, action, additions)).toMatchObject({ allowed: false, requiresBatchPreview: false });
    expect(() => makeIndexAlter(old, { ...old.editableDefinition!, name: 'renamed' }, { snapshot: value, patches: additions })).toThrow('只支持');
    const required = ['ddl-implicit-commit', 'external-ddl-window', 'special-index-change']; expect(indexAcknowledgementsComplete(required, new Set(required))).toBe(true); expect(indexAcknowledgementsComplete(required, new Set(required.slice(0, 2)))).toBe(false);
  });
});
