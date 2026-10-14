import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { editableIndexDefinition, readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { planTableIndexPatches } from '../../src/engine/tableIndexPatchSql';
import { verifyIndexAfter } from '../../src/engine/tableIndexVerification';
import type { IndexStructureRead } from '../../src/engine/tableIndexRead';
import type { IndexDefinition, IndexPlanOptions, IndexPlanResult, TrustedIndexColumn } from '../../src/shared/tableIndexPatches';

const options: IndexPlanOptions = { database: 'fixture', dialect: 'mysql', serverVersion: '8.4.11', engine: 'InnoDB', sqlMode: { ansiQuotes: false, noBackslashEscapes: false }, capabilities: { renameIndex: true, descendingIndexes: true, maxKeyParts: 16, maxIndexNameCharacters: 64, maxIndexCommentBytes: 1024, maxKeyBytes: 3072 }, checks: { foreignKeyChecks: 1, uniqueChecks: 1 } };
const columns = "`id` int NOT NULL, `a` varchar(40) NOT NULL, `b` int NOT NULL, `note` varchar(32) DEFAULT '原值'";
const oldIndexes = ["KEY `old_idx` (`a`(3),`b`) COMMENT '旧注释'", 'KEY `spare` (`b`)'];
const constraints = 'CONSTRAINT `fk` FOREIGN KEY (`b`) REFERENCES `parent` (`id`), CONSTRAINT `ck` CHECK (`b` > 0)';
const tail = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='表尾'";
const newIndex = "KEY `new_idx` (`id`,`a`(5) DESC) COMMENT '新注释'";

/** 只拼自主固定夹具，不请求数据库；结构目录使用独立引用并保持原值对应。 */
function source(indexes = oldIndexes, fields = columns, checks = constraints, suffix = tail): string { return `CREATE TABLE \`t\` (${fields}, ${[...indexes, checks].filter(Boolean).join(', ')}) ${suffix}`; }
function read(sql: string): IndexStructureRead {
  const context = { dialect: 'mysql' as const, mode: options.sqlMode }, definition = parseTableColumnDefinition(sql, context), indexDocument = readTableIndexDefinition(definition);
  const columns = new Map<string, TrustedIndexColumn>(definition.columns.map(column => [`column:${column.name}`, {
    name: column.name, nullable: column.nullable !== false, dataType: /^varchar/i.test(column.type.raw) ? 'VARCHAR' : 'INT', columnType: column.type.raw,
    generated: false, hidden: false, fullKeyBytes: /^varchar/i.test(column.type.raw) ? 160 : 4, charsetMaxBytes: 4,
    prefix: /^varchar/i.test(column.type.raw) ? { kind: 'allowed', unit: 'characters', maxLength: 40 } : { kind: 'forbidden', reason: '整数' },
  }]));
  const indexes = new Map(indexDocument.indexes.map(parsed => [`index:${parsed.name}`, { parsed, definition: editableIndexDefinition(parsed, columns), visible: parsed.opaqueReasons.length ? 'unknown' as const : true as const, generated: parsed.opaqueReasons.length ? 'unknown' as const : false as const }]));
  const nullability: [string, boolean][] = definition.columns.map(column => [column.name, column.nullable !== false]);
  return { source: sql, context, originalMode: 'STRICT_ALL_TABLES', normalizedMode: 'STRICT_ALL_TABLES', identity: '可信测试身份', serverVersion: options.serverVersion,
    nullability, encodings: definition.columns.map(column => ({ name: column.name, charset: /^varchar/i.test(column.type.raw) ? 'utf8mb4' : null, collation: /^varchar/i.test(column.type.raw) ? 'utf8mb4_bin' : null })), tableEncoding: { charset: 'utf8mb4', collation: 'utf8mb4_bin' },
    model: { definition, indexDocument, columns, indexes, dependencies: {
      incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, outgoingComplete: true,
      foreignKeys: [{ foreignKeyRef: 'foreign:fk', direction: 'outgoing', targetColumnRefs: ['column:b'], support: { kind: 'known', candidateIndexRefs: ['index:spare'], rule: 'child-leading-full' } }],
      autoIncrementColumnRefs: [], partition: { kind: 'none' }, hiddenDependencies: [], automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] },
    } }, options: structuredClone(options), warnings: [], catalogDigest: '测试目录摘要', dependencyDigest: '测试依赖摘要', bytes: Buffer.byteLength(sql),
  };
}
/** 计划也来自真实纯 SQL 规划器，测试不手工伪造 ready 或核验标记。 */
function plan(before: IndexStructureRead, definition: IndexDefinition = { name: 'new_idx', kind: 'ordinary', method: 'BTREE', comment: '新注释', keyParts: [{ columnRef: 'column:id', direction: 'asc' }, { columnRef: 'column:a', direction: 'desc', prefixLength: 5 }] }): Extract<IndexPlanResult, { kind: 'ready' }> {
  const result = planTableIndexPatches(before.model, [{ op: 'add', clientKey: 'new-key', definition }], before.options!);
  if (result.kind !== 'ready') throw new Error(`测试计划未能产生 ready：${JSON.stringify(result)}`);
  return result;
}

describe('索引 ALTER 生产后核验纯反例', () => {
  it('索引展示顺序变化不是键部分变化，整组实际索引可按名称精确核对', () => {
    const before = read(source()), expected = plan(before), after = read(source([newIndex, oldIndexes[1], oldIndexes[0]]));
    expect(verifyIndexAfter(before, expected, after)).toBe(true);
  });

  it.each([
    ["KEY `new_idx` (`a`(5) DESC,`id`) COMMENT '新注释'", '键部分顺序'],
    ["KEY `new_idx` (`id`,`a`(5)) COMMENT '新注释'", '方向被忽略'],
    ["KEY `new_idx` (`id`,`a`(4) DESC) COMMENT '新注释'", '前缀被截短'],
    ["KEY `new_idx` (`id`,`a`(5) DESC) COMMENT '不同注释'", '注释变化'],
    ["UNIQUE KEY `new_idx` (`id`,`a`(5) DESC) COMMENT '新注释'", '唯一性改变'],
  ])('请求索引的 %s（%s）不相同则不报告完整核验', (ddl) => {
    const before = read(source()); expect(verifyIndexAfter(before, plan(before), read(source([...oldIndexes, ddl])))).toBe(false);
  });

  it('未动的旧键发生方向/前缀/注释变化也拒绝，不能只验新索引', () => {
    const before = read(source());
    for (const old of ["KEY `old_idx` (`a`(2),`b`) COMMENT '旧注释'", "KEY `old_idx` (`a`(3) DESC,`b`) COMMENT '旧注释'", "KEY `old_idx` (`a`(3),`b`) COMMENT 'changed'"]) expect(verifyIndexAfter(before, plan(before), read(source([old, oldIndexes[1], newIndex])))).toBe(false);
  });

  it('普通列的原默认值、类型、名称及相对顺序必须保持', () => {
    const before = read(source());
    for (const fields of [columns.replace("'原值'", "'别的值'"), columns.replace('varchar(32)', 'varchar(33)'), columns.replace('`note`', '`renamed`'), "`a` varchar(40) NOT NULL, `id` int NOT NULL, `b` int NOT NULL, `note` varchar(32) DEFAULT '原值'"]) expect(verifyIndexAfter(before, plan(before), read(source([...oldIndexes, newIndex], fields)))).toBe(false);
  });

  it.each([
    constraints.replace('REFERENCES `parent`', 'REFERENCES `other`'),
    constraints.replace('CHECK (`b` > 0)', 'CHECK (`b` >= 0)'),
    constraints.split(', CONSTRAINT `ck`')[0],
  ])('FK/CHECK 原约束变化或丢失不能标已核验：%s', checks => {
    const before = read(source()); expect(verifyIndexAfter(before, plan(before), read(source([...oldIndexes, newIndex], columns, checks)))).toBe(false);
  });

  it('表尾、真实可空性和字符集目录变化各自拒绝，不由 SQL 文本相同遮盖', () => {
    const before = read(source());
    expect(verifyIndexAfter(before, plan(before), read(source([...oldIndexes, newIndex], columns, constraints, tail.replace("'表尾'", "'另表尾'"))))).toBe(false);
    const nullable = read(source([...oldIndexes, newIndex])); nullable.nullability[0][1] = true; expect(verifyIndexAfter(before, plan(before), nullable)).toBe(false);
    const encoding = read(source([...oldIndexes, newIndex])); encoding.encodings[1].collation = 'utf8mb4_general_ci'; expect(verifyIndexAfter(before, plan(before), encoding)).toBe(false);
  });

  it('新增覆盖键后服务器额外删除旧索引或额外补键均不能蒙混通过', () => {
    const before = read(source());
    expect(verifyIndexAfter(before, plan(before), read(source([oldIndexes[0], newIndex])))).toBe(false);
    expect(verifyIndexAfter(before, plan(before), read(source([...oldIndexes, newIndex, 'KEY server_extra(id)'])))).toBe(false);
  });

  it('既存只读不透明索引可以完整原样保留，片段变化则不能接受', () => {
    const opaque = 'KEY `opaque` (`a`) INVISIBLE', before = read(source([...oldIndexes, opaque])), expected = plan(before);
    expect(expected.preservedOpaqueIndexRefs).toContain('index:opaque');
    expect(verifyIndexAfter(before, expected, read(source([opaque, newIndex, ...oldIndexes])))).toBe(true);
    expect(verifyIndexAfter(before, expected, read(source([...oldIndexes, 'KEY `opaque` (`b`) INVISIBLE', newIndex])))).toBe(false);
  });

  it('外键候选键集合可随合法新增扩大，但规则/列序/身份变化不能忽略', () => {
    const before = read(source()), after = read(source([...oldIndexes, "KEY `new_idx` (`b`,`id`) COMMENT '新注释'"]));
    const expected = plan(before, { name: 'new_idx', kind: 'ordinary', method: 'BTREE', comment: '新注释', keyParts: [{ columnRef: 'column:b', direction: 'asc' }, { columnRef: 'column:id', direction: 'asc' }] });
    after.model.dependencies.foreignKeys[0].support = { kind: 'known', candidateIndexRefs: ['index:spare', 'index:new_idx'], rule: 'child-leading-full' };
    expect(verifyIndexAfter(before, expected, after)).toBe(true);
    after.model.dependencies.foreignKeys[0].targetColumnRefs = ['column:a']; expect(verifyIndexAfter(before, expected, after)).toBe(false);
    after.model.dependencies.foreignKeys[0].targetColumnRefs = ['column:b']; after.model.dependencies.foreignKeys[0].foreignKeyRef = '另一外键'; expect(verifyIndexAfter(before, expected, after)).toBe(false);
  });

  it.each(['外侧子表身份', '外侧有序列元组', 'FOREIGN.TYPE', '外键目录身份'])('入向外键 %s 使可信语义引用变化时，即使目标 SHOW CREATE 不变也拒绝完整核验', change => {
    const before = read(source()), after = read(source([...oldIndexes, newIndex]));
    // 生产 reader 负责将双方身份、列序及 TYPE 纳入 ref；这里验证真实后核验器不能忽略该投影。
    // 不 mock getter、不伪造目录读取成功，也不以此测试代替 reader 的协议/目录测试。
    const incoming = { foreignKeyRef: 'trusted-incoming-original', direction: 'incoming' as const, targetColumnRefs: ['column:b'], support: { kind: 'known' as const, candidateIndexRefs: ['index:spare'], rule: 'parent-leading-full' as const } };
    before.model.dependencies.foreignKeys = [...before.model.dependencies.foreignKeys, structuredClone(incoming)];
    after.model.dependencies.foreignKeys = [...after.model.dependencies.foreignKeys, structuredClone(incoming)];
    const expected = plan(before);
    expect(verifyIndexAfter(before, expected, after)).toBe(true);
    after.model.dependencies.foreignKeys[1].foreignKeyRef = `trusted-incoming-changed-${change}`;
    expect(verifyIndexAfter(before, expected, after)).toBe(false);
  });

  it('身份、模式、能力与完整核验标记不能由列名相同替代', () => {
    const before = read(source()), expected = plan(before);
    for (const field of ['identity', 'normalizedMode'] as const) { const after = read(source([...oldIndexes, newIndex])); after[field] = '已变化'; expect(verifyIndexAfter(before, expected, after)).toBe(false); }
    const unknown = read(source([...oldIndexes, newIndex])); delete unknown.options; expect(verifyIndexAfter(before, expected, unknown)).toBe(false);
    expected.verification.definitionCanBeFullyVerified = false; expect(verifyIndexAfter(before, expected, read(source([...oldIndexes, newIndex])))).toBe(false);
  });
});
