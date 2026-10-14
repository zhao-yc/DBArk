import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { editableIndexDefinition, readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { planTableIndexPatches } from '../../src/engine/tableIndexPatchSql';
import { splitSql } from '../../src/engine/sql';
import type { TableDefinitionContext } from '../../src/shared/tableColumnPatches';
import type { IndexDefinition, IndexPatch, IndexPlanOptions, IndexPlanSnapshot, TrustedIndexColumn } from '../../src/shared/tableIndexPatches';

const mysql: TableDefinitionContext = { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } };
const plain = 'CREATE TABLE `t` (`a` int NOT NULL, `b` int NOT NULL, `v` varchar(1000), KEY `i` (`a`) COMMENT \'原注释\') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
/** 纯测试显式给出可信目录能力，不把这些固定值当成实际引擎自动推断。 */
function snapshot(sql = plain, context = mysql): IndexPlanSnapshot {
  const definition = parseTableColumnDefinition(sql, context), indexDocument = readTableIndexDefinition(definition);
  const columns = new Map<string, TrustedIndexColumn>(definition.columns.map(column => {
    const type = /^[A-Za-z]+/.exec(column.type.raw)![0].toUpperCase(), length = Number(/\((\d+)\)/.exec(column.type.raw)?.[1] ?? 1000), binary = type.includes('BINARY') || type.endsWith('BLOB'), string = ['VARCHAR', 'VARBINARY'].includes(type) || /TEXT|BLOB/.test(type);
    return [column.name, { name: column.name, nullable: column.nullable !== false, dataType: type, columnType: column.type.raw, generated: false, hidden: false, fullKeyBytes: string ? length * (binary ? 1 : 4) : 4, charsetMaxBytes: binary ? 1 : 4, prefix: string ? { kind: 'allowed', unit: binary ? 'bytes' : 'characters', maxLength: length } : { kind: 'forbidden', reason: '非字符串' } }];
  }));
  const indexes = new Map(indexDocument.indexes.map(parsed => [parsed.name, { parsed, definition: editableIndexDefinition(parsed, columns), visible: true as const, generated: false as const }]));
  return { definition, indexDocument, columns, indexes, dependencies: { incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, outgoingComplete: true, foreignKeys: [], autoIncrementColumnRefs: [], partition: { kind: 'none' }, hiddenDependencies: [], automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] } } };
}
function options(context = mysql): IndexPlanOptions { return { database: '库', dialect: context.dialect, serverVersion: context.dialect === 'mysql' ? '8.4.11' : '11.4.13-MariaDB', engine: 'InnoDB', sqlMode: context.mode, capabilities: { renameIndex: true, descendingIndexes: true, maxKeyParts: 16, maxIndexNameCharacters: 64, maxIndexCommentBytes: 1024, maxKeyBytes: 3072 }, checks: { foreignKeyChecks: 1, uniqueChecks: 1 } }; }
function definition(name = 'new', parts: IndexDefinition['keyParts'] = [{ columnRef: 'b', direction: 'asc' }]): IndexDefinition { return { kind: 'ordinary', name, method: 'BTREE', keyParts: parts, comment: '' }; }
function add(value = definition()): IndexPatch { return { op: 'add', clientKey: 'new', definition: value }; }
function alter(changes: Extract<IndexPatch, { op: 'alter' }>['changes'], indexRef = 'i'): IndexPatch { return { op: 'alter', indexRef, changes }; }
function blocked(result: ReturnType<typeof planTableIndexPatches>, text?: string): void { expect(result.kind).toBe('blocked'); if (result.kind === 'blocked' && text) expect(result.issues.map(value => value.message).join('\n')).toContain(text); }

describe('索引差异单条 ALTER 纯计划', () => {
  it('只改变目标索引，其他列/外键/CHECK/表尾原范围留作核验', () => {
    const state = snapshot("CREATE TABLE t(a int NOT NULL,b int NOT NULL,v varchar(20) DEFAULT '中文',KEY i(a),KEY j(b),CONSTRAINT ck CHECK (a>0)) ENGINE=InnoDB COMMENT='表尾'"), before = state.definition.source;
    const result = planTableIndexPatches(state, [alter({ keyParts: [{ columnRef: 'b', direction: 'desc' }, { columnRef: 'a', direction: 'asc' }] })], options());
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.sql).toContain('DROP INDEX `i`, ADD INDEX `i` USING BTREE (`b` DESC, `a` ASC)');
    expect(result.sql).not.toContain('MODIFY'); expect(result.sql).not.toContain("DEFAULT '中文'");
    expect(splitSql(result.sql)).toHaveLength(1); expect(result.verification.unchangedIndexRefs).toEqual(['j']);
    expect(result.verification.unchangedConstraintRanges.map(range => before.slice(range.start, range.end))).toEqual([expect.stringContaining('CHECK')]);
    expect(state.definition.source).toBe(before);
  });
  it('纯改名预选原生语法并保持原键定义，不生成 DROP+ADD', () => {
    const result = planTableIndexPatches(snapshot(), [alter({ name: '重``命名' })], options());
    expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect(result.sql).toBe('ALTER TABLE `库`.`t` RENAME INDEX `i` TO `重````命名`;');
    expect(result.operations[0].strategy).toBe('rename');
    const unsupported = options(); unsupported.capabilities.renameIndex = false;
    blocked(planTableIndexPatches(snapshot(), [alter({ name: 'renamed' })], unsupported), '原生');
  });
  it('注释未改时完整保留其原 SQL 转义片段', () => {
    const state = snapshot("CREATE TABLE t(a int NOT NULL,b int NOT NULL,KEY i (a) COMMENT '中''文\\\\路径')");
    const result = planTableIndexPatches(state, [alter({ kind: 'unique' })], options());
    expect(result.kind).toBe('ready'); if (result.kind === 'ready') expect(result.sql).toContain("COMMENT '中''文\\\\路径'");
  });
  it.each([false, true])('新增注释按 NBE=%s 编码，分号/注释标记仍只有一条语句', noBackslashEscapes => {
    const context = { ...mysql, mode: { ...mysql.mode, noBackslashEscapes } }, value = definition(); value.comment = "引号'\\路径; DROP TABLE t; --\n下一行";
    const result = planTableIndexPatches(snapshot(plain, context), [add(value)], options(context));
    expect(result.kind).toBe('ready'); if (result.kind === 'ready') expect(splitSql(result.sql, noBackslashEscapes)).toHaveLength(1);
  });
  it('同值修改没有 SQL；大小写/列顺序真实变化不能被忽略', () => {
    expect(planTableIndexPatches(snapshot(), [alter({ name: 'i', comment: '原注释' })], options()).kind).toBe('noop');
    expect(planTableIndexPatches(snapshot(), [alter({ name: 'I' })], options()).kind).toBe('ready');
    const prefix = snapshot('CREATE TABLE t(v varchar(20),KEY i(v(3)))');
    expect(planTableIndexPatches(prefix, [alter({ keyParts: [{ prefixLength: 3, direction: 'asc', columnRef: 'v' }] })], options()).kind).toBe('noop');
  });
  it('名称最终碰撞和交换改名拒绝，不生成临时名称', () => {
    const state = snapshot('CREATE TABLE t(a int NOT NULL,b int NOT NULL,KEY i(a),KEY j(b))');
    blocked(planTableIndexPatches(state, [add(definition('I'))], options()), '重复');
    blocked(planTableIndexPatches(state, [alter({ name: 'j' }), alter({ name: 'i' }, 'j')], options()), '占用');
  });
  it('显式删除再使用该名称时把 DROP 放在同一 ALTER 的 ADD 之前', () => {
    const result = planTableIndexPatches(snapshot(), [add(definition('i')), { op: 'drop', indexRef: 'i' }], options());
    expect(result.kind).toBe('ready'); if (result.kind === 'ready') expect(result.sql).toMatch(/DROP INDEX `i`, ADD INDEX `i`/);
  });
  it('拒绝不存在的旧索引及来自其他快照的字段引用', () => {
    blocked(planTableIndexPatches(snapshot(), [{ op: 'drop', indexRef: 'other' }], options()), '当前快照');
    blocked(planTableIndexPatches(snapshot(), [add(definition('new', [{ columnRef: 'foreign-ref', direction: 'asc' }]))], options()), '当前快照');
    const incomplete = snapshot(); incomplete.indexes = new Map(); blocked(planTableIndexPatches(incomplete, [add()], options()), '不完整');
  });
  it('主键只接已 NOT NULL 的完整列；不自动修改可空性或允许主键改名', () => {
    const value = definition('PRIMARY'); value.kind = 'primary';
    expect(planTableIndexPatches(snapshot(), [add(value)], options()).kind).toBe('ready');
    value.keyParts = [{ columnRef: 'v', prefixLength: 3, direction: 'asc' }]; blocked(planTableIndexPatches(snapshot(), [add(value)], options()), 'NOT NULL');
    const state = snapshot('CREATE TABLE t(a int NOT NULL,b int NOT NULL,PRIMARY KEY(a))');
    blocked(planTableIndexPatches(state, [alter({ name: 'p' }, 'PRIMARY')], options()), 'PRIMARY');
  });
  it('未知索引只读但保留，不阻止独立新增已知普通索引', () => {
    const state = snapshot('CREATE TABLE t(a int NOT NULL,b int NOT NULL,KEY i(a) INVISIBLE)');
    blocked(planTableIndexPatches(state, [{ op: 'drop', indexRef: 'i' }], options()), '只读');
    const result = planTableIndexPatches(state, [add()], options());
    expect(result.kind).toBe('ready'); if (result.kind === 'ready') expect(result.preservedOpaqueIndexRefs).toEqual(['i']);
  });
  it('按实证能力拒绝 MySQL 5.7 忽略的 DESC', () => {
    const opt = options(); opt.serverVersion = '5.7.44'; opt.capabilities.descendingIndexes = false;
    blocked(planTableIndexPatches(snapshot(), [add(definition('new', [{ columnRef: 'b', direction: 'desc' }]))], opt), 'DESC');
  });
  it.each(['mysql', 'mariadb'] as const)('%s 字符前缀 768 可用、769 在发送前拒绝，不能依赖成功截短', dialect => {
    const context = { ...mysql, dialect };
    expect(planTableIndexPatches(snapshot(plain, context), [add(definition('p', [{ columnRef: 'v', prefixLength: 768, direction: 'asc' }]))], options(context)).kind).toBe('ready');
    blocked(planTableIndexPatches(snapshot(plain, context), [add(definition('p', [{ columnRef: 'v', prefixLength: 769, direction: 'asc' }]))], options(context)), '最大键字节');
  });
  it('复合键累计字节与字段声明长度分别检查', () => {
    blocked(planTableIndexPatches(snapshot(), [add(definition('p', [{ columnRef: 'v', prefixLength: 768, direction: 'asc' }, { columnRef: 'a', direction: 'asc' }]))], options()), '最大键字节');
    blocked(planTableIndexPatches(snapshot(), [add(definition('p', [{ columnRef: 'v', prefixLength: 1001, direction: 'asc' }]))], options()), '字段长度');
  });
  it('二进制前缀按字节，TEXT/BLOB 必须显式前缀，非字符串不放宽', () => {
    const state = snapshot('CREATE TABLE t(a int NOT NULL,b varbinary(1000),v text)');
    expect(planTableIndexPatches(state, [add(definition('p', [{ columnRef: 'b', prefixLength: 1000, direction: 'asc' }]))], options()).kind).toBe('ready');
    blocked(planTableIndexPatches(state, [add(definition('p', [{ columnRef: 'v', direction: 'asc' }]))], options()), '显式');
    blocked(planTableIndexPatches(state, [add(definition('p', [{ columnRef: 'a', prefixLength: 1, direction: 'asc' }]))], options()), '前缀');
  });
  it('隐藏、生成、未知类型和缺少可信字节上限的字段不生成 SQL', () => {
    for (const mutation of [{ generated: true }, { hidden: true }, { dataType: 'JSON' }, { fullKeyBytes: undefined }]) {
      const state = snapshot(); Object.assign(state.columns.get('b')!, mutation); blocked(planTableIndexPatches(state, [add()], options()));
    }
  });
  it('不能把错误模式、目标、checks 或未知能力当默认值', () => {
    const opt = options(); opt.sqlMode = { ansiQuotes: true, noBackslashEscapes: false }; blocked(planTableIndexPatches(snapshot(), [add()], opt), '模式');
    const checks = options(); (checks.checks as { foreignKeyChecks: number }).foreignKeyChecks = 0; blocked(planTableIndexPatches(snapshot(), [add()], checks), '检查');
    blocked(planTableIndexPatches(snapshot('CREATE TABLE other.t(a int NOT NULL,b int NOT NULL)'), [add()], options()), '数据库');
    const cap = options(); cap.capabilities.maxKeyBytes = NaN; blocked(planTableIndexPatches(snapshot(), [add()], cap), '能力');
  });
  it('Maria 任意索引 ALTER 遇危险默认整表拒绝，二进制默认只标未核验', () => {
    const context = { ...mysql, dialect: 'mariadb' as const };
    const dangerous = snapshot("CREATE TABLE t(a int NOT NULL,b int NOT NULL,v varchar(80) DEFAULT concat(_utf8mb4'xC3x80',_utf8mb4'xE6xB1x89'),KEY i(a))", context);
    blocked(planTableIndexPatches(dangerous, [add()], options(context)), '风险默认值');
    const binary = snapshot("CREATE TABLE t(a int NOT NULL,b int NOT NULL,v varbinary(10) DEFAULT '?',KEY i(a))", context);
    const result = planTableIndexPatches(binary, [add()], options(context)); expect(result.kind).toBe('ready');
    if (result.kind === 'ready') { expect(result.verification.definitionCanBeFullyVerified).toBe(false); expect(result.warnings.map(value => value.code)).toContain('binary-default-unverified'); }
  });
  it('使用真实依赖规划器，目录不完整时不默许删除潜在父键', () => {
    const state = snapshot(); state.dependencies.incomingCoverage = { kind: 'partial', reason: 'permission' };
    blocked(planTableIndexPatches(state, [{ op: 'drop', indexRef: 'i' }], options()));
    expect(planTableIndexPatches(state, [add()], options()).kind).toBe('ready');
  });
});
