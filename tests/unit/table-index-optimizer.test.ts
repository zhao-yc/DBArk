import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { editableIndexDefinition, readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { deriveIndexCapabilities } from '../../src/engine/tableIndexMetadata';
import type { IndexStructureRead } from '../../src/engine/tableIndexRead';
import type { TrustedIndexColumn } from '../../src/shared/tableIndexPatches';
import { validateIndexPatches } from '../../src/shared/tableIndexPatches';
import { validateCommand } from '../../src/shared/validation';
import { planTableIndexPatches } from '../../src/engine/tableIndexPatchSql';
import { indexOptimizerVersionSupported, optimizerIndexDefinitions, planTableIndexOptimizer, tableIndexOptimizerAccess, verifyTableIndexOptimizer } from '../../src/engine/tableIndexOptimizerSql';
import type { TableIndexOptimizerFacts } from '../../src/engine/tableIndexOptimizerRead';

const source = "CREATE TABLE `t` (`id` int NOT NULL,`a` int NOT NULL,`b` int DEFAULT NULL,PRIMARY KEY (`id`),KEY `ia` (`a`,`b`) COMMENT '保留') ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='原表尾'";
/** 私有合成目录明确注明来源；真实服务器角色另由实库测试证明。 */
function fixture(sql = source, dialect: 'mysql' | 'mariadb' = 'mysql', version = dialect === 'mysql' ? '8.4.11' : '11.4.13', clustered = 'PRIMARY') {
  const context = { dialect, mode: { ansiQuotes: false, noBackslashEscapes: false } }, definition = parseTableColumnDefinition(sql, context), indexDocument = readTableIndexDefinition(definition);
  const columns = new Map<string, TrustedIndexColumn>(definition.columns.map(column => ['c:' + column.name, { name: column.name, nullable: column.nullable !== false, dataType: 'INT', columnType: column.type.raw, generated: false, hidden: false, fullKeyBytes: 4, prefix: { kind: 'forbidden', reason: '数值' } }]));
  const indexes = new Map(indexDocument.indexes.map(parsed => ['i:' + parsed.name, { parsed, definition: editableIndexDefinition(parsed, columns), visible: !/(?:\bINVISIBLE\b(?:\s*\*\/)?|(?<!NOT\s)\bIGNORED)\s*$/.test(parsed.rawSql), generated: parsed.opaqueReasons.length ? 'unknown' as const : false as const }]));
  const read: IndexStructureRead = { source: sql, context, originalMode: 'STRICT_TRANS_TABLES', normalizedMode: 'STRICT_TRANS_TABLES', serverVersion: version, identity: 'server', nullability: definition.columns.map(column => [column.name, column.nullable !== false]), encodings: definition.columns.map(column => ({ name: column.name, charset: null, collation: null })), columnExtras: definition.columns.map(column => [column.name, '']), tableEncoding: { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, model: { definition, indexDocument, columns, indexes, dependencies: { incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, outgoingComplete: true, foreignKeys: [], autoIncrementColumnRefs: [], hiddenDependencies: [], partition: { kind: 'none' }, automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] } } }, options: { database: 'db', dialect, serverVersion: version, engine: 'InnoDB', sqlMode: context.mode, checks: { foreignKeyChecks: 1, uniqueChecks: 1 }, capabilities: deriveIndexCapabilities({ dialect, serverVersion: version, engine: 'InnoDB', rowFormat: 'DYNAMIC', pageSize: 16384, largePrefix: true }).capabilities! }, catalogDigest: 'catalog', dependencyDigest: 'dependencies', warnings: [], bytes: 1000 };
  const facts: TableIndexOptimizerFacts = { physical: { tableId: '100', nativeName: 'db/t', clusteredIndexName: clustered, dialect, version, os: 'Linux', lowerNames: 0, identity: 'server' }, nativeIndexes: indexDocument.indexes.map((index, ordinal) => ({ name: index.name, id: String(1000 + ordinal), type: index.name === clustered ? 3 : index.kind === 'unique' ? 2 : 0, fields: index.parts.length })), indexes: [...optimizerIndexDefinitions(read).values()], digest: 'facts', bytes: 1000 };
  return { read, facts };
}

describe('索引优化器独立合同、词法与原生计划', () => {
  it('真实IPC接受明确bool及optin，拒绝混批、混属性、undefined或陌生属性', () => {
    const input = { snapshotId: 's', taskId: 'task', patches: [{ op: 'alter', indexRef: 'i:ia', changes: { optimizerVisible: false } }] };
    expect(validateCommand('schema.indexes.preview', input)).toEqual(input);
    expect(validateCommand('schema.indexes.get', { connectionId: 'c', database: 'db', table: 't', taskId: 't', includeOptimizerFacts: true })).toMatchObject({ includeOptimizerFacts: true });
    for (const value of [undefined, null, 0, 'true']) expect(() => validateIndexPatches([{ op: 'alter', indexRef: 'i:ia', changes: { optimizerVisible: value } }])).toThrow();
    expect(() => validateIndexPatches([{ op: 'alter', indexRef: 'i:ia', changes: { optimizerVisible: true, name: 'other' } }])).toThrow('独立');
    expect(() => validateIndexPatches([...input.patches, { op: 'drop', indexRef: 'i:other' }])).toThrow('独立');
    const { read } = fixture(); expect(planTableIndexPatches(read.model, input.patches, read.options!)).toMatchObject({ kind: 'blocked', issues: [{ message: expect.stringContaining('专用') }] });
  });
  it.each([['mysql', '8.0.46', '/*!80000 INVISIBLE */', 'VISIBLE'], ['mysql', '8.4.11', '/*!80000 INVISIBLE */', 'VISIBLE'], ['mariadb', '10.11.19', 'IGNORED', 'NOT IGNORED'], ['mariadb', '11.4.13', 'IGNORED', 'NOT IGNORED']] as const)('%s%s支持隐藏与恢复且旧隐藏操作仍只读', (dialect, version, hidden, restored) => {
    const before = fixture(source, dialect, version), plan = planTableIndexOptimizer(before.read, before.facts, 'i:ia', false, 'db');
    expect(plan.sql).toBe(`ALTER TABLE \`db\`.\`t\` ALTER INDEX \`ia\` ${dialect === 'mysql' ? 'INVISIBLE' : 'IGNORED'}, ALGORITHM=INPLACE, LOCK=NONE;`);
    const after = fixture(source.replace("COMMENT '保留')", `COMMENT '保留' ${hidden})`), dialect, version);
    expect(after.read.model.indexes.get('i:ia')!.definition).toBeUndefined();
    expect(tableIndexOptimizerAccess(after.read, after.facts, 'i:ia').allowed).toBe(true);
    expect(planTableIndexOptimizer(after.read, after.facts, 'i:ia', true, 'db').sql).toContain('`ia` ' + restored);
    expect(verifyTableIndexOptimizer(before.read, before.facts, after.read, after.facts, plan)).toBe(true);
    expect(planTableIndexPatches(after.read.model, [{ op: 'drop', indexRef: 'i:ia' }], after.read.options!).kind).toBe('blocked');
  });
  it('5.7和相似未知版本明确只读', () => {
    for (const version of ['5.7.44', '8.0.45', '8.4.12', '9.0.0']) { const value = fixture(source, 'mysql', version); expect(indexOptimizerVersionSupported('mysql', version)).toBe(false); expect(() => planTableIndexOptimizer(value.read, value.facts, 'i:ia', false, 'db')).toThrow('版本'); }
  });
  it('实际clustered唯一键拒绝，但无PK第二唯一、nullable第一唯一、soleFK和自增支持不套DROP限制', () => {
    const value = fixture(source.replace('PRIMARY KEY (`id`),', 'UNIQUE KEY `u_first` (`id`),UNIQUE KEY `u_second` (`a`),'), 'mysql', '8.4.11', 'u_first');
    expect(tableIndexOptimizerAccess(value.read, value.facts, 'i:u_first').allowed).toBe(false);
    expect(planTableIndexOptimizer(value.read, value.facts, 'i:u_second', false, 'db').sql).toContain('`u_second` INVISIBLE');
    const nullable = fixture(source.replace('PRIMARY KEY (`id`),', 'UNIQUE KEY `u_nullable` (`b`),UNIQUE KEY `u_first` (`id`),'), 'mysql', '8.4.11', 'u_first');
    expect(planTableIndexOptimizer(nullable.read, nullable.facts, 'i:u_nullable', false, 'db').sql).toContain('`u_nullable` INVISIBLE');
    value.read.model.dependencies.foreignKeys = [{ foreignKeyRef: 'fk', direction: 'self', targetColumnRefs: ['c:a'], support: { kind: 'known', candidateIndexRefs: ['i:u_second'], rule: 'child-leading-full' } }];
    value.read.model.dependencies.autoIncrementColumnRefs = ['c:a'];
    expect(planTableIndexOptimizer(value.read, value.facts, 'i:u_second', false, 'db').sql).not.toMatch(/DROP|ADD|MODIFY/);
  });
  it('索引名称及注释内的关键字/注释文字不被当作选项剥离，反引号安全引用', () => {
    const value = fixture(source.replace("KEY `ia` (`a`,`b`) COMMENT '保留'", "KEY `构``INVISIBLE` (`a`,`b`) COMMENT 'IGNORED /*!80000 INVISIBLE */'"));
    const plain = value.facts.indexes.find(index => index.name === '构`INVISIBLE')!;
    expect(plain.visible).toBe(true); expect(plain.definition.comment).toBe('IGNORED /*!80000 INVISIBLE */');
    expect(planTableIndexOptimizer(value.read, value.facts, plain.indexRef, false, 'db').sql).toContain('ALTER INDEX `构``INVISIBLE` INVISIBLE');
  });
  it.each(['INVISIBLE INVISIBLE', 'VISIBLE INVISIBLE', '/*!99999 INVISIBLE */', '/*!80000 INVISIBLE, DROP INDEX ia */', '/*!80000 INVISIBLE */ KEY_BLOCK_SIZE=8'])('未知/重复/版本不符选项不获得资格：%s', suffix => {
    const sql = source.replace("COMMENT '保留')", `COMMENT '保留' ${suffix})`);
    let value: ReturnType<typeof fixture> | undefined, failure: unknown;
    try { value = fixture(sql); } catch (error) { failure = error; }
    if (value) expect(value.facts.indexes.some(index => index.name === 'ia')).toBe(false);
    else expect(failure).toBeInstanceOf(Error);
  });
});

describe('索引优化器后核只豁免一个已确认属性', () => {
  it.each(['table-id', 'index-id', 'index-type', 'column', 'default', 'comment', 'tail', 'another-key', 'actual-visible', 'foreign-key', 'mode'])('%s漂移必须未核验', changed => {
    const before = fixture(), plan = planTableIndexOptimizer(before.read, before.facts, 'i:ia', false, 'db');
    let after = fixture(source.replace("COMMENT '保留')", "COMMENT '保留' /*!80000 INVISIBLE */)"));
    if (changed === 'table-id') after.facts.physical.tableId = '200';
    if (changed === 'index-id') after.facts.nativeIndexes[1].id = '9000';
    if (changed === 'index-type') after.facts.nativeIndexes[1].type = 2;
    if (changed === 'column') after = fixture(after.read.source.replace('`a` int NOT NULL', '`a` bigint NOT NULL'));
    if (changed === 'default') after = fixture(after.read.source.replace('DEFAULT NULL', 'DEFAULT 9'));
    if (changed === 'comment') after = fixture(after.read.source.replace("COMMENT '保留'", "COMMENT '更改'"));
    if (changed === 'tail') after = fixture(after.read.source.replace("COMMENT='原表尾'", "COMMENT='新表尾'"));
    if (changed === 'another-key') after = fixture(after.read.source.replace('PRIMARY KEY (`id`)', 'PRIMARY KEY (`a`)'));
    if (changed === 'actual-visible') after.facts.indexes.find(index => index.name === 'ia')!.visible = true;
    if (changed === 'foreign-key') after.read.model.dependencies.outgoingComplete = false;
    if (changed === 'mode') after.read.normalizedMode = '';
    expect(verifyTableIndexOptimizer(before.read, before.facts, after.read, after.facts, plan)).toBe(false);
  });
});
