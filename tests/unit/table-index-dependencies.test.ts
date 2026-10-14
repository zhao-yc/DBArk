import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { editableIndexDefinition, readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { planIndexDependencies } from '../../src/engine/tableIndexDependencies';
import type {
  ForeignKeyDependency, IndexDefinition, IndexDependencyDecision, IndexDependencyInput,
  IndexPlanOperation, IndexPlanOptions, IndexPlanSnapshot, PlannedIndex, TrustedIndexColumn,
} from '../../src/shared/tableIndexPatches';

const options: IndexPlanOptions = {
  database: 'fixture', dialect: 'mysql', serverVersion: '8.4.11', engine: 'InnoDB',
  sqlMode: { ansiQuotes: false, noBackslashEscapes: false },
  capabilities: { renameIndex: true, descendingIndexes: true, maxKeyParts: 16, maxIndexNameCharacters: 64, maxIndexCommentBytes: 1024, maxKeyBytes: 3072 },
  checks: { foreignKeyChecks: 1, uniqueChecks: 1 },
};
/** 引用刻意不同于列名/索引名，避免测试把稳定引用退化为按名称查找。 */
const col = (name: string): string => `column:${name}`;
const ix = (name: string): string => `index:${name}`;

/** 只构造自主结构及显式可信依赖，不能把本地夹具当成远端目录已采集。 */
function snapshot(indexSql = 'KEY ka(a), KEY kb(b)', changes: Partial<IndexDependencyInput> = {}): IndexPlanSnapshot {
  const definition = parseTableColumnDefinition(`CREATE TABLE t(a int NOT NULL,b int NOT NULL,c int NOT NULL,v varchar(20) NOT NULL,\`__proto__\` int NOT NULL,\`constructor\` int NOT NULL${indexSql ? ',' + indexSql : ''}) ENGINE=InnoDB`, { dialect: 'mysql', mode: options.sqlMode });
  const indexDocument = readTableIndexDefinition(definition);
  const columns = new Map<string, TrustedIndexColumn>(definition.columns.map(column => [col(column.name), {
    name: column.name, nullable: false, dataType: column.name === 'v' ? 'VARCHAR' : 'INT', columnType: column.type.raw,
    generated: false, hidden: false, fullKeyBytes: column.name === 'v' ? 80 : 4,
    prefix: column.name === 'v' ? { kind: 'allowed', unit: 'characters', maxLength: 20 } : { kind: 'forbidden', reason: '整数字段' },
  }]));
  const indexes = new Map(indexDocument.indexes.map(parsed => [ix(parsed.name), { parsed, definition: editableIndexDefinition(parsed, columns), visible: true as const, generated: false as const }]));
  return { definition, indexDocument, columns, indexes, dependencies: {
    incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, outgoingComplete: true, foreignKeys: [],
    autoIncrementColumnRefs: [], partition: { kind: 'none' }, hiddenDependencies: [],
    automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] }, ...changes,
  } };
}

/** 完整模型仅描述键，不输入 SQL、行值或客户端 access 标志。 */
function key(name: string, columns: string[], kind: IndexDefinition['kind'] = 'ordinary'): IndexDefinition {
  return { kind, name, method: 'BTREE', keyParts: columns.map(name => ({ columnRef: col(name), direction: 'asc' })), comment: '' };
}

/** 真实依赖的两侧使用独立有序元组，即使自引用的 foreignKeyRef 相同也不合并。 */
function fk(columns: string[], indexes: string[], rule: Extract<ForeignKeyDependency['support'], { kind: 'known' }>['rule'] = 'child-leading-full', direction: ForeignKeyDependency['direction'] = 'outgoing'): ForeignKeyDependency {
  return { foreignKeyRef: 'foreign:one', direction, targetColumnRefs: columns.map(col), support: { kind: 'known', rule, candidateIndexRefs: indexes.map(ix) } };
}

interface Plan { final: PlannedIndex[]; operations: IndexPlanOperation[]; }
/** 保留原集合，在每个测试明确指定的变动上形成闭合最终集合。 */
function unchanged(state: IndexPlanSnapshot): Plan {
  return { final: [...state.indexes].map(([sourceIndexRef, value]) => ({ sourceIndexRef, ...(value.definition ? { definition: value.definition } : {}) })), operations: [] };
}
/** 新增操作采用独立 clientKey，与旧引用不可混用。 */
function add(plan: Plan, definition: IndexDefinition): Plan {
  const clientKey = `new:${definition.name}`;
  plan.final.push({ clientKey, definition }); plan.operations.push({ clientKey, strategy: 'add', clauses: ['不会解析此 SQL 片段'] }); return plan;
}
/** 删除/重建/改名仅更新指定引用，其他旧索引始终留在最终集合。 */
function change(plan: Plan, name: string, strategy: 'drop' | 'replace' | 'rename', definition?: IndexDefinition): Plan {
  const sourceIndexRef = ix(name);
  plan.final = plan.final.filter(value => value.sourceIndexRef !== sourceIndexRef);
  if (strategy !== 'drop') plan.final.push({ sourceIndexRef, definition });
  plan.operations.push({ sourceIndexRef, strategy, clauses: ['受控测试操作'] }); return plan;
}
/** 成功必须没有 blocker；失败必须匹配具体原因，不能只检查一个布尔值。 */
function decide(state: IndexPlanSnapshot, plan: Plan): IndexDependencyDecision { return planIndexDependencies(state, plan.final, plan.operations, options); }
function allowed(result: IndexDependencyDecision): void { expect(result).toMatchObject({ allowed: true, blockers: [] }); }
function blocked(result: IndexDependencyDecision, code: string): void { expect(result.allowed).toBe(false); expect(result.blockers.map(issue => issue.code)).toContain(code); }

describe('索引依赖按可信最终集合判定', () => {
  it('checks 两项都必须为真实 1，不能由默认值或界面权限代替', () => {
    for (const field of ['foreignKeyChecks', 'uniqueChecks'] as const) {
      const state = snapshot(), plan = add(unchanged(state), key('kc', ['c']));
      const unsafe = structuredClone(options); (unsafe.checks as Record<string, number>)[field] = 0;
      blocked(planIndexDependencies(state, plan.final, plan.operations, unsafe), 'checks-unproven');
    }
  });

  it.each(['permission', 'budget', 'identity-unproven', 'unsupported-catalog', 'inconsistent'] as const)('入向目录 %s 时独立新增与纯改名仍可用，潜在父键删除/重建拒绝', reason => {
    const state = snapshot(undefined, { incomingCoverage: { kind: 'partial', reason } });
    const added = decide(state, add(unchanged(state), key('kc', ['c']))); allowed(added);
    expect(added.warnings.map(issue => issue.code)).toContain('foreign-coverage-partial');
    allowed(decide(state, change(unchanged(state), 'ka', 'rename', key('renamed', ['a']))));
    blocked(decide(state, change(unchanged(state), 'ka', 'drop')), 'foreign-coverage-incomplete');
    blocked(decide(state, change(unchanged(state), 'ka', 'replace', key('ka', ['c']))), 'foreign-coverage-incomplete');
  });

  it('出向目录不完整时不能破坏旧支持键，来源未知的重叠新增也不能当作无副作用', () => {
    const state = snapshot(undefined, { outgoingComplete: false, automaticForeignKeyIndexProvenance: { kind: 'unknown' } });
    blocked(decide(state, change(unchanged(state), 'ka', 'drop')), 'foreign-coverage-incomplete');
    blocked(decide(state, add(unchanged(state), key('overlap', ['a', 'c']))), 'automatic-index-provenance-unknown');
    allowed(decide(state, add(unchanged(state), key('kc', ['c']))));
  });

  it('已知外键旧支持键不允许同条等价 DROP+ADD，即使最终另有可靠替代', () => {
    const state = snapshot('KEY kab(a,b), KEY extra(a,b,c)', { foreignKeys: [fk(['a', 'b'], ['kab'])] });
    for (const plan of [change(unchanged(state), 'kab', 'replace', key('kab', ['a', 'b'])), change(unchanged(state), 'kab', 'drop')]) {
      const result = decide(state, plan); blocked(result, 'foreign-bound-index-rebuild');
      expect(result.blockers.find(issue => issue.code === 'foreign-bound-index-rebuild')).toMatchObject({ indexRefs: [ix('kab')], columnRefs: [col('a'), col('b')], foreignKeyRefs: ['foreign:one'] });
    }
    allowed(decide(state, change(unchanged(state), 'kab', 'rename', key('renamed', ['a', 'b']))));
  });

  it.each(['KEY kv(v(2),b)', 'KEY kv(b,v)'])('外键不能由错误顺序或前缀键证明：%s', ddl => {
    const state = snapshot(ddl, { foreignKeys: [fk(['v', 'b'], ['kv'])] });
    blocked(decide(state, add(unchanged(state), key('kc', ['c']))), 'foreign-final-support-missing');
  });

  it('完整前导列允许后缀；父键 exact-unique 不能接受普通键或更长唯一键', () => {
    const child = snapshot('KEY kabc(a,b,c)', { foreignKeys: [fk(['a', 'b'], ['kabc'])] });
    allowed(decide(child, unchanged(child)));
    const parent = snapshot('KEY kabc(a,b,c)', { foreignKeys: [fk(['a', 'b'], ['kabc'], 'parent-leading-full', 'incoming')] });
    allowed(decide(parent, unchanged(parent)));
    for (const ddl of ['KEY parent(a,b)', 'UNIQUE KEY parent(a,b,c)']) {
      const strict = snapshot(ddl, { foreignKeys: [fk(['a', 'b'], ['parent'], 'parent-exact-unique', 'incoming')] });
      blocked(decide(strict, unchanged(strict)), 'foreign-final-support-missing');
    }
    const exact = snapshot('UNIQUE KEY parent(a,b)', { foreignKeys: [fk(['a', 'b'], ['parent'], 'parent-exact-unique', 'incoming')] });
    allowed(decide(exact, unchanged(exact)));
  });

  it('同一个 self 外键分别验证子列和父列，不能用其中一个元组替另一侧作证', () => {
    const state = snapshot('KEY child(a,b), UNIQUE KEY parent(b,c)', { foreignKeys: [fk(['a', 'b'], ['child'], 'child-leading-full', 'self'), fk(['b', 'c'], ['parent'], 'parent-exact-unique', 'self')] });
    allowed(decide(state, add(unchanged(state), key('other', ['c']))));
    blocked(decide(state, change(unchanged(state), 'parent', 'drop')), 'foreign-bound-index-rebuild');
    const incorrect = snapshot('KEY child(a,b), UNIQUE KEY parent(c,b)', { foreignKeys: state.dependencies.foreignKeys });
    blocked(decide(incorrect, unchanged(incorrect)), 'foreign-final-support-missing');
  });

  it('外键字段或支持键引用缺失不能降级成没有依赖', () => {
    const missingKey = snapshot(undefined, { foreignKeys: [fk(['a'], ['absent'])] });
    blocked(decide(missingKey, unchanged(missingKey)), 'foreign-support-unproven');
    const missingColumn = snapshot(undefined, { foreignKeys: [fk(['absent'], ['ka'])] });
    blocked(decide(missingColumn, unchanged(missingColumn)), 'foreign-columns-unproven');
  });

  it('未知外键规则保护相关旧键，但不推断缺失规则或禁止无关新增', () => {
    const state = snapshot(undefined, { foreignKeys: [{ foreignKeyRef: 'foreign:unknown', direction: 'incoming', targetColumnRefs: [col('a')], support: { kind: 'unknown', reason: '不能使用此私有 SQL 文本' } }] });
    blocked(decide(state, change(unchanged(state), 'ka', 'drop')), 'foreign-support-unknown');
    allowed(decide(state, change(unchanged(state), 'kb', 'drop')));
    allowed(decide(state, add(unchanged(state), key('kc', ['c']))));
  });

  it('自增列删除最后支撑键拒绝，同计划显式提供可靠替代才可通过', () => {
    const state = snapshot('KEY ka(a)', { autoIncrementColumnRefs: [col('a')] });
    blocked(decide(state, change(unchanged(state), 'ka', 'drop')), 'auto-increment-support-missing');
    allowed(decide(state, add(change(unchanged(state), 'ka', 'drop'), key('new', ['a', 'b']))));
    blocked(decide(state, add(change(unchanged(state), 'ka', 'drop'), key('wrong', ['b', 'a']))), 'auto-increment-support-missing');
  });

  it('自增支持按整个最终集合判定，不能用被删除键或第二顺位列作证', () => {
    const state = snapshot('KEY first(a), KEY second(a,b)', { autoIncrementColumnRefs: [col('a')] });
    allowed(decide(state, change(unchanged(state), 'first', 'drop')));
    blocked(decide(state, change(change(unchanged(state), 'first', 'drop'), 'second', 'replace', key('second', ['b', 'a']))), 'auto-increment-support-missing');
  });

  it('未知定义只能原样保留，不能猜它可支持自增或外键，也不能直接改名/删除', () => {
    const state = snapshot('KEY hidden(a) INVISIBLE');
    expect(state.indexes.get(ix('hidden'))!.definition).toBeUndefined();
    allowed(decide(state, add(unchanged(state), key('kb', ['b']))));
    blocked(decide(state, change(unchanged(state), 'hidden', 'drop')), 'readonly-index-operation');
    blocked(decide(state, change(unchanged(state), 'hidden', 'rename', key('renamed', ['a']))), 'readonly-index-operation');
    state.dependencies.autoIncrementColumnRefs = [col('a')];
    blocked(decide(state, add(unchanged(state), key('kb', ['b']))), 'auto-increment-support-missing');
    state.dependencies.autoIncrementColumnRefs = [];
    state.dependencies.foreignKeys = [fk(['a'], ['hidden'])];
    blocked(decide(state, add(unchanged(state), key('kb', ['b']))), 'foreign-final-support-missing');
  });

  it('隐藏依赖精确到引用，只阻触及目标；空引用保护表级唯一选择', () => {
    const state = snapshot(undefined, { hiddenDependencies: [{ indexRefs: [ix('ka')], reason: '隐藏结构' }] });
    allowed(decide(state, add(unchanged(state), key('kc', ['c']))));
    allowed(decide(state, change(unchanged(state), 'kb', 'drop')));
    blocked(decide(state, change(unchanged(state), 'ka', 'rename', key('new', ['a']))), 'hidden-index-dependency');
    state.dependencies.hiddenDependencies = [{ indexRefs: [], reason: '未知表级属性' }];
    allowed(decide(state, add(unchanged(state), key('kc', ['c']))));
    allowed(decide(state, change(unchanged(state), 'ka', 'rename', key('renamed', ['a']))));
    blocked(decide(state, add(unchanged(state), key('unique', ['c'], 'unique'))), 'table-dependency-unproven');
    blocked(decide(state, add(unchanged(state), key('PRIMARY', ['a'], 'primary'))), 'table-dependency-unproven');
    blocked(decide(state, change(unchanged(state), 'ka', 'replace', key('ka', ['a'], 'unique'))), 'table-dependency-unproven');
    allowed(decide(state, unchanged(state)));
  });

  it('表级隐式聚簇选择未证明时不能删除唯一键或以普通键替换主键', () => {
    const state = snapshot('PRIMARY KEY(a), UNIQUE KEY uq(b)', { hiddenDependencies: [{ indexRefs: [], reason: '隐式选择未证明' }] });
    blocked(decide(state, change(unchanged(state), 'uq', 'drop')), 'table-dependency-unproven');
    blocked(decide(state, change(unchanged(state), 'PRIMARY', 'replace', key('normal', ['a']))), 'table-dependency-unproven');
  });

  it('未对应快照的隐藏引用不能误判为本次操作无关', () => {
    const state = snapshot(undefined, { hiddenDependencies: [{ indexRefs: ['missing'], reason: '陈旧目录' }] });
    blocked(decide(state, add(unchanged(state), key('kc', ['c']))), 'hidden-reference-unproven');
  });

  it('显式分区的新增/替换唯一键必须完整包含全部分区字段', () => {
    const state = snapshot(undefined, { partition: { kind: 'explicit', requiredColumnRefs: [col('a'), col('b')] } });
    blocked(decide(state, add(unchanged(state), key('unique', ['a'], 'unique'))), 'partition-unique-columns');
    blocked(decide(state, change(unchanged(state), 'ka', 'replace', key('ka', ['a'], 'unique'))), 'partition-unique-columns');
    allowed(decide(state, add(unchanged(state), key('unique', ['c', 'b', 'a'], 'unique'))));
    allowed(decide(state, add(unchanged(state), key('ordinary', ['c']))));
  });

  it('分区唯一键首批不接受前缀，即使 required 列名全部出现', () => {
    const state = snapshot(undefined, { partition: { kind: 'explicit', requiredColumnRefs: [col('v')] } });
    const prefixed = key('unique', ['v'], 'unique'); prefixed.keyParts[0].prefixLength = 2;
    blocked(decide(state, add(unchanged(state), prefixed)), 'partition-unique-columns');
  });

  it.each(['implicit-key', 'unknown'] as const)('%s 分区拒可能改选择的唯一键/主键，普通新增及受控改名保持可用', kind => {
    const state = snapshot('UNIQUE KEY uq(a), KEY kb(b)', { partition: { kind, reason: '未证明分区选择', ...(kind === 'implicit-key' ? { selectedIndexRef: ix('uq') } : {}) } });
    for (const plan of [change(unchanged(state), 'uq', 'drop'), add(unchanged(state), key('new_unique', ['b'], 'unique')), add(unchanged(state), key('PRIMARY', ['a'], 'primary'))]) blocked(decide(state, plan), 'partition-selection-unproven');
    allowed(decide(state, add(unchanged(state), key('new_ordinary', ['c']))));
    allowed(decide(state, change(unchanged(state), 'uq', 'rename', key('renamed', ['a'], 'unique'))));
  });

  it('来源未知时覆盖出向外键的新索引可能让服务器自动删旧键，拒绝隐式副作用', () => {
    const state = snapshot('KEY child(a,b)', { foreignKeys: [fk(['a', 'b'], ['child'])], automaticForeignKeyIndexProvenance: { kind: 'unknown' } });
    blocked(decide(state, add(unchanged(state), key('cover', ['a', 'b', 'c']))), 'automatic-index-provenance-unknown');
    allowed(decide(state, add(unchanged(state), key('not_cover', ['b', 'a']))));
    allowed(decide(state, add(unchanged(state), key('not_cover_short', ['a']))));
    state.dependencies.automaticForeignKeyIndexProvenance = { kind: 'known', indexRefs: [] };
    allowed(decide(state, add(unchanged(state), key('cover', ['a', 'b', 'c']))));
  });

  it('已经证明自动生成的索引同样不能被新增覆盖后悄悄删除', () => {
    const state = snapshot('KEY child(a,b)', { foreignKeys: [fk(['a', 'b'], ['child'])], automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [ix('child')] } });
    blocked(decide(state, add(unchanged(state), key('cover', ['a', 'b', 'c']))), 'automatic-index-removal-risk');
    allowed(decide(state, add(unchanged(state), key('unrelated', ['c']))));
  });

  it('自引用的父侧覆盖不冒充自动子索引覆盖，子侧仍严格检查', () => {
    const state = snapshot('KEY child(a,b), UNIQUE KEY parent(b,c)', { foreignKeys: [fk(['a', 'b'], ['child'], 'child-leading-full', 'self'), fk(['b', 'c'], ['parent'], 'parent-exact-unique', 'self')], automaticForeignKeyIndexProvenance: { kind: 'unknown' } });
    allowed(decide(state, add(unchanged(state), key('parent_cover', ['b', 'c']))));
    blocked(decide(state, add(unchanged(state), key('child_cover', ['a', 'b', 'c']))), 'automatic-index-provenance-unknown');
  });

  it('出向完整性未知且旧索引不透明时，不能以列名看似不相关排除自动索引副作用', () => {
    const state = snapshot('KEY hidden(a) INVISIBLE', { outgoingComplete: false, automaticForeignKeyIndexProvenance: { kind: 'unknown' } });
    blocked(decide(state, add(unchanged(state), key('kb', ['b']))), 'automatic-index-provenance-unknown');
  });

  it('纯改名不得伪装列序、唯一性或注释变化', () => {
    const state = snapshot('KEY kab(a,b)');
    for (const replacement of [key('new', ['b', 'a']), key('new', ['a', 'b'], 'unique'), { ...key('new', ['a', 'b']), comment: '变化' }]) blocked(decide(state, change(unchanged(state), 'kab', 'rename', replacement)), 'rename-changes-definition');
  });

  it('最终集合必须声明每次增删改且引用来自本快照', () => {
    const state = snapshot(), dropped = unchanged(state); dropped.final.pop();
    blocked(decide(state, dropped), 'undeclared-index-removal');
    const altered = unchanged(state); altered.final[0].definition = key('ka', ['c']);
    blocked(decide(state, altered), 'undeclared-index-change');
    const added = unchanged(state); added.final.push({ clientKey: 'new', definition: key('new', ['c']) });
    blocked(decide(state, added), 'undeclared-index-addition');
    const foreign = add(unchanged(state), key('new', ['absent']));
    blocked(decide(state, foreign), 'unknown-column-reference');
    const duplicate = unchanged(state); duplicate.final.push(duplicate.final[0]);
    blocked(decide(state, duplicate), 'invalid-final-reference');
  });

  it('原型同名引用使用 Map 精确匹配，名称相似不能支撑另一个列', () => {
    const state = snapshot('KEY `__proto__`(`__proto__`), KEY `constructor`(`constructor`)', { autoIncrementColumnRefs: [col('__proto__')] });
    allowed(decide(state, change(unchanged(state), 'constructor', 'rename', key('other', ['constructor']))));
    blocked(decide(state, change(unchanged(state), '__proto__', 'drop')), 'auto-increment-support-missing');
    expect({}.constructor).toBe(Object); expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('裁决没有修改输入，也不把 SQL、注释、目录原错误或行值放进警告', () => {
    const secret = '不能出现在裁决中的私有字符串';
    const state = snapshot(undefined, { foreignKeys: [{ foreignKeyRef: 'foreign:unknown', direction: 'incoming', targetColumnRefs: [col('a')], support: { kind: 'unknown', reason: secret } }] });
    const plan = add(unchanged(state), { ...key('kc', ['c']), comment: secret }); plan.operations[0].clauses = [secret];
    const beforeState = structuredClone(state), beforePlan = structuredClone(plan);
    allowed(decide(state, plan)); expect(JSON.stringify(decide(state, plan))).not.toContain(secret);
    expect(state).toEqual(beforeState); expect(plan).toEqual(beforePlan);
  });
});
