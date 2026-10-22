import { describe, expect, it } from 'vitest';
import { validateColumnPatches } from '../../src/shared/tableColumnPatches';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { buildTableColumnPatchSql } from '../../src/engine/tableColumnPatchSql';
import type { TableColumnAutoIncrementFacts } from '../../src/engine/tableColumnAutoIncrementRead';
import type { IndexStructureRead } from '../../src/engine/tableIndexRead';
import type { TrustedIndexColumn, TrustedIndexDefinition } from '../../src/shared/tableIndexPatches';
import { planTableColumnAutoIncrement, tableColumnAutoIncrementAccess, tableColumnAutoIncrementExecutionMode, sameTableColumnAutoIncrementMode, verifyTableColumnAutoIncrement } from '../../src/engine/tableColumnAutoIncrementSql';

const original = "CREATE TABLE `t` (`id` bigint NOT NULL COMMENT 'AUTO_INCREMENT文字',`k` int NOT NULL,`v` decimal(30,6) DEFAULT NULL,PRIMARY KEY (`k`),KEY `idx_id_k` (`id`,`k`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
/** 纯计划输入是显式合成的可信事实；本文件不将其标记为实际服务器目录验证。 */
function fixture(source = original, version = '8.4.11', dialect: 'mysql' | 'mariadb' = 'mysql') {
  const context = { dialect, mode: { ansiQuotes: false, noBackslashEscapes: false } }, document = parseTableColumnDefinition(source, context), indexDocument = readTableIndexDefinition(document);
  const columns = new Map<string, TrustedIndexColumn>(document.columns.map(column => [column.name + '-ref', { name: column.name, dataType: column.type.raw.split(/[ (]/)[0], columnType: column.type.raw, nullable: column.nullable !== false, generated: false, hidden: false, prefix: { kind: 'forbidden', reason: '数值列不取前缀' } }]));
  const indexes = new Map<string, TrustedIndexDefinition>(indexDocument.indexes.map(index => [index.name + '-ref', { parsed: index, definition: { kind: index.kind as 'primary' | 'ordinary', name: index.name, method: 'BTREE', keyParts: index.parts.map(part => ({ columnRef: part.columnName + '-ref', direction: 'asc' as const })), comment: index.comment ?? '' }, generated: false, visible: true }]));
  const base = { source, context, originalMode: 'STRICT_TRANS_TABLES', normalizedMode: 'STRICT_TRANS_TABLES', identity: 'server', serverVersion: version, nullability: document.columns.map(column => [column.name, column.nullable !== false] as [string, boolean]), encodings: document.columns.map(column => ({ name: column.name, charset: null, collation: null })), tableEncoding: { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }, columnExtras: document.columns.map(column => [column.name, column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : ''] as [string, string]) };
  const indexRead: IndexStructureRead = { ...base, model: { definition: document, indexDocument, columns, indexes, dependencies: { incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, outgoingComplete: true, foreignKeys: [], autoIncrementColumnRefs: document.columns.filter(column => column.attributes.some(attribute => attribute.kind === 'auto-increment')).map(column => column.name + '-ref'), partition: { kind: 'none' }, hiddenDependencies: [], automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] } } }, catalogDigest: 'catalog', dependencyDigest: source.includes(' NOT NULL AUTO_INCREMENT') ? 'after-dependency' : 'before-dependency', warnings: [], bytes: 1024 };
  const facts: TableColumnAutoIncrementFacts = { physical: { tableId: '100', serverIdentity: 'server', dialect, version, os: 'Linux', lowerNames: 0, catalog: dialect === 'mysql' && version.startsWith('8.') ? 'INNODB_TABLES' : 'INNODB_SYS_TABLES', nativeName: 'db/t' }, columns: document.columns.map((column, index) => ({ name: column.name, ordinal: index + 1, typeSql: column.type.raw, dataType: column.type.raw.split(/[ (]/)[0], nullable: column.nullable === false ? 'NO' : 'YES', defaultValue: null, extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '', generationExpression: '', charset: null, collation: null, comment: column.comment ?? '' })), indexes: indexRead, policy: { sessionIncrement: '1', sessionOffset: '1', globalIncrement: '1', globalOffset: '1', lockMode: '1', readOnly: '0', superReadOnly: '0', innodbReadOnly: '0', forceRecovery: '0' }, bytes: 2048 };
  return { document, facts, base };
}
const plan = (value: ReturnType<typeof fixture>, enabled: boolean) => planTableColumnAutoIncrement(value.document, value.facts, 'id-ref', 'id', enabled, 'db', value.base.normalizedMode);

/** 非索引旁生成列的SHOW、完整目录及可信列模型一致；g只引用a，绝不制造id依赖。 */
function unrelatedGenerated(storage: 'STORED' | 'VIRTUAL') {
  const value = fixture(original.replace('PRIMARY KEY (`k`)', '`a` char(5) DEFAULT NULL,`g` varchar(5) GENERATED ALWAYS AS (`a`) ' + storage + ',PRIMARY KEY (`k`)'));
  const encodings = value.document.columns.map(column => ({ name: column.name, charset: ['a', 'g'].includes(column.name) ? 'utf8mb4' : null, collation: ['a', 'g'].includes(column.name) ? 'utf8mb4_general_ci' : null }));
  const extras = value.document.columns.map(column => [column.name, column.name === 'g' ? storage + ' GENERATED' : ''] as [string, string]);
  Object.assign(value.base, { encodings, columnExtras: extras }); Object.assign(value.facts.indexes, { encodings, columnExtras: extras });
  for (const column of value.facts.columns) {
    if (['a', 'g'].includes(column.name)) { column.charset = 'utf8mb4'; column.collation = 'utf8mb4_general_ci'; }
    if (column.name === 'g') { column.extra = storage + ' GENERATED'; column.generationExpression = '`a`'; }
  }
  value.facts.indexes.model.columns.get('g-ref')!.generated = true;
  return value;
}

describe('现有整数列AUTO_INCREMENT专属契约和计划', () => {
  it.each(['STORED', 'VIRTUAL'] as const)('不相关%s生成列也必须整表只读，不能把同份SHOW当作COPY数据保真证据', storage => {
    const value = unrelatedGenerated(storage);
    expect(value.facts.columns.find(column => column.name === 'g')).toMatchObject({ generationExpression: '`a`', extra: storage + ' GENERATED', charset: 'utf8mb4' });
    expect(value.facts.indexes.model.columns.get('g-ref')?.generated).toBe(true);
    expect(value.facts.indexes.model.dependencies.hiddenDependencies).toEqual([]);
    expect(value.facts.indexes.model.indexDocument.indexes.every(index => index.parts.every(part => part.columnName !== 'g'))).toBe(true);
    expect(tableColumnAutoIncrementAccess(value.document, 'id', value.facts).access.editable).toBe(false);
  });
  it.each(['STORED', 'VIRTUAL'] as const)('专属计划必须在发送DDL前拒绝不相关%s生成列，不能仅事后标未核验', storage => {
    expect(() => plan(unrelatedGenerated(storage), true)).toThrow();
  });
  it('仅接受单批单列明确布尔，旧generic不能忽略新字段', () => {
    for (const autoIncrement of [false, true]) expect(validateColumnPatches([{ kind: 'alter', columnRef: 'id-ref', changes: { autoIncrement } }])[0]).toMatchObject({ changes: { autoIncrement } });
    for (const autoIncrement of [undefined, null, 0, 1, 'true']) expect(() => validateColumnPatches([{ kind: 'alter', columnRef: 'id-ref', changes: { autoIncrement } }])).toThrow();
    expect(() => validateColumnPatches([{ kind: 'alter', columnRef: 'id-ref', changes: { autoIncrement: true, nullable: false } }])).toThrow('独立');
    expect(() => validateColumnPatches([{ kind: 'alter', columnRef: 'id-ref', changes: { autoIncrement: true } }, { kind: 'alter', columnRef: 'k-ref', changes: { comment: '旁列' } }])).toThrow('独立');
    const value = fixture(); expect(() => buildTableColumnPatchSql(value.document, [{ kind: 'alter', columnRef: 'id-ref', changes: { autoIncrement: true } }], { database: 'db', serverVersion: '8.4.11', columnRefs: new Map([...value.facts.indexes.model.columns].map(([ref, column]) => [ref, column.name])) })).toThrow('专用');
  });
  it.each([['mysql', '5.7.44'], ['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19'], ['mariadb', '11.4.13']] as const)('%s%s保留非唯一复合键与完整定义，仅启用属性并明确COPY/EXCLUSIVE', (dialect, version) => {
    const value = fixture(original, version, dialect), result = plan(value, true);
    expect(result.sql).toContain("MODIFY COLUMN `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'AUTO_INCREMENT文字'");
    expect(result.sql).toContain('ALGORITHM=COPY'); expect(result.sql).toContain('LOCK=EXCLUSIVE'); expect(result.requiredAcknowledgements).toEqual(['column-auto-increment-copy']);
    expect(result.executionMode).toBe('STRICT_TRANS_TABLES,NO_AUTO_VALUE_ON_ZERO'); expect(result.preserved.constraints).toEqual(value.document.items.filter(item => item.kind === 'constraint').map(item => item.raw));
    expect(result.sql).not.toMatch(/ADD (?:UNIQUE|PRIMARY)|DROP (?:INDEX|FOREIGN)|UPDATE |INSERT |MAX\(/);
  });
  it('取消只删除原AUTO_INCREMENT属性，不碰同名备注文字，原键及NOT NULL保留', () => {
    const enabled = fixture(original.replace('bigint NOT NULL', 'bigint NOT NULL AUTO_INCREMENT')), result = plan(enabled, false);
    expect(result.sql).toContain("`id` bigint NOT NULL  COMMENT 'AUTO_INCREMENT文字'"); expect(result.sql).not.toContain('AUTO_INCREMENT COMMENT'); expect(result.preserved.constraints).toHaveLength(2); expect(result.enabled).toBe(false);
    expect(() => plan(enabled, true)).toThrow('没有实际'); expect(() => plan(fixture(), false)).toThrow('没有实际');
  });
  it('没有显式PK仍允许合法首列普通索引；不自动改变原聚簇键选择', () => {
    const value = fixture(original.replace('PRIMARY KEY (`k`),', ''));
    value.facts.indexes.model.dependencies.hiddenDependencies = [{ indexRefs: [], reason: '无显式主键时的隐式聚簇键选择尚未证明，不能改变相关唯一键或主键' }];
    expect(plan(value, true).sql).toContain('AUTO_INCREMENT');
  });
  it.each(['no-leading', 'prefix', 'hidden', 'expression', 'no-coverage', 'outgoing', 'partition', 'foreign-key', 'catalog-extra', 'catalog-type', 'unknown-version'])('%s不伪造目录/索引/依赖资格', failure => {
    const value = fixture(), entry = value.facts.indexes.model.indexes.get('idx_id_k-ref')!;
    if (failure === 'no-leading') entry.parsed = { ...entry.parsed, parts: [...entry.parsed.parts].reverse() };
    if (failure === 'prefix') entry.parsed = { ...entry.parsed, parts: entry.parsed.parts.map((part, index) => index ? part : { ...part, prefixLength: 1 }) };
    if (failure === 'hidden') entry.visible = false;
    if (failure === 'expression') entry.parsed = { ...entry.parsed, parts: entry.parsed.parts.map((part, index) => index ? part : { ...part, expressionSql: 'id+1' }) };
    if (failure === 'no-coverage') value.facts.indexes.model.dependencies.incomingCoverage = { kind: 'partial', reason: 'permission' };
    if (failure === 'outgoing') value.facts.indexes.model.dependencies.outgoingComplete = false;
    if (failure === 'partition') value.facts.indexes.model.dependencies.partition = { kind: 'unknown', reason: '未证明' };
    if (failure === 'foreign-key') value.facts.indexes.model.dependencies.foreignKeys = [{ foreignKeyRef: 'fk', direction: 'incoming', targetColumnRefs: ['id-ref'], support: { kind: 'known', candidateIndexRefs: ['idx_id_k-ref'], rule: 'parent-leading-full' } }];
    if (failure === 'catalog-extra') value.facts.columns[0].extra = 'INVISIBLE';
    if (failure === 'catalog-type') value.facts.columns[0].typeSql = 'bigint unsigned';
    if (failure === 'unknown-version') value.facts.physical.version = '8.4.12';
    expect(tableColumnAutoIncrementAccess(value.document, 'id', value.facts).access.editable).toBe(false); expect(() => plan(value, true)).toThrow();
  });
  it.each([original.replace('bigint NOT NULL', 'decimal(30,6) NOT NULL'), original.replace('bigint NOT NULL', 'bigint NULL'), original.replace('bigint NOT NULL', 'bigint NOT NULL DEFAULT 0'), original.replace('`k` int NOT NULL', '`k` int NOT NULL AUTO_INCREMENT'), original.replace('`v` decimal(30,6) DEFAULT NULL', '`v` decimal(30,6) GENERATED ALWAYS AS (`id` + 1) VIRTUAL'), original.replace('ENGINE=InnoDB', 'ENGINE=InnoDB PARTITION BY HASH(id) PARTITIONS 2')])('不隐式修正原类型/default/nullable/其它自增或关系：%s', source => {
    const value = fixture(source); expect(() => plan(value, true)).toThrow();
  });
  it('模式保留所有原位，只容忍服务器重排顺序，不能丢strict/NBE或额外引入模式', () => {
    expect(tableColumnAutoIncrementExecutionMode('STRICT_TRANS_TABLES,NO_BACKSLASH_ESCAPES')).toBe('STRICT_TRANS_TABLES,NO_BACKSLASH_ESCAPES,NO_AUTO_VALUE_ON_ZERO');
    expect(tableColumnAutoIncrementExecutionMode('NO_AUTO_VALUE_ON_ZERO,STRICT_TRANS_TABLES')).toBe('NO_AUTO_VALUE_ON_ZERO,STRICT_TRANS_TABLES');
    expect(sameTableColumnAutoIncrementMode('NO_AUTO_VALUE_ON_ZERO,STRICT_TRANS_TABLES', 'STRICT_TRANS_TABLES,NO_AUTO_VALUE_ON_ZERO')).toBe(true);
    for (const mode of ['NO_AUTO_VALUE_ON_ZERO', 'STRICT_TRANS_TABLES', 'STRICT_TRANS_TABLES,NO_AUTO_VALUE_ON_ZERO,ANSI_QUOTES', 'STRICT_TRANS_TABLES,,NO_AUTO_VALUE_ON_ZERO']) expect(sameTableColumnAutoIncrementMode(mode, 'STRICT_TRANS_TABLES,NO_AUTO_VALUE_ON_ZERO')).toBe(false);
  });
});

describe('COPY后的专属结构及实际目录后核', () => {
  function pair() {
    const before = fixture(), requested = plan(before, true), after = fixture(original.replace('bigint NOT NULL', 'bigint NOT NULL AUTO_INCREMENT').replace('ENGINE=InnoDB', 'ENGINE=InnoDB AUTO_INCREMENT=9007199254740994'));
    after.base.originalMode = after.base.normalizedMode = 'NO_AUTO_VALUE_ON_ZERO,STRICT_TRANS_TABLES'; after.facts.physical.tableId = '200';
    return { before, after, requested };
  }
  it('只允许目标属性和真实表尾计数变化，COPY可换物理ID及源文本偏移', () => {
    const { before, after, requested } = pair(); expect(verifyTableColumnAutoIncrement(before.facts, after.facts, before.base, after.base, requested)).toBe(true);
    expect(after.facts.indexes.dependencyDigest).not.toBe(before.facts.indexes.dependencyDigest);
  });
  it.each(['target-default', 'target-type', 'target-null', 'other-default', 'tail-comment', 'constraint', 'mode', 'identity', 'extra', 'relation', 'policy'])('%s发生变化不能冒充仅自增切换', failure => {
    const { before, after, requested } = pair();
    if (failure === 'target-default') after.base.source = after.base.source.replace('NOT NULL AUTO_INCREMENT', 'NOT NULL DEFAULT 9 AUTO_INCREMENT');
    if (failure === 'target-type') after.base.source = after.base.source.replace('`id` bigint', '`id` int');
    if (failure === 'target-null') after.base.source = after.base.source.replace('NOT NULL AUTO_INCREMENT', 'NULL AUTO_INCREMENT');
    if (failure === 'other-default') after.facts.columns[2].defaultValue = '9';
    if (failure === 'tail-comment') after.base.source += " COMMENT='AUTO_INCREMENT=9'";
    if (failure === 'constraint') after.base.source = after.base.source.replace('(`id`,`k`)', '(`id`)');
    if (failure === 'mode') after.base.originalMode = after.base.normalizedMode = 'NO_AUTO_VALUE_ON_ZERO';
    if (failure === 'identity') after.facts.physical.serverIdentity = 'other-server';
    if (failure === 'extra') after.facts.columns[0].extra = 'auto_increment INVISIBLE';
    if (failure === 'relation') after.facts.indexes.model.dependencies.outgoingComplete = false;
    if (failure === 'policy') after.facts.policy.globalOffset = '2';
    expect(verifyTableColumnAutoIncrement(before.facts, after.facts, before.base, after.base, requested)).toBe(false);
  });
});
