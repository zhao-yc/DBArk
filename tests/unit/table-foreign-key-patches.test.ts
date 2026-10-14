import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableIndexDefinition, editableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { readTableForeignKeyDefinition } from '../../src/engine/tableForeignKeyDefinition';
import { planTableForeignKeyPatches } from '../../src/engine/tableForeignKeyPatchSql';
import { verifyForeignKeyAfter } from '../../src/engine/tableForeignKeyVerification';
import { splitSql } from '../../src/engine/sql';
import { defaultForeignKeyAction, validateForeignKeyPatches, type ForeignKeyDefinition, type ForeignKeyPatch, type ForeignKeyPlanOptions, type ForeignKeyPlanSnapshot, type ForeignKeyTableSnapshot, type TrustedForeignKey } from '../../src/shared/tableForeignKeyPatches';
import type { TrustedIndexColumn } from '../../src/shared/tableIndexPatches';

const options: ForeignKeyPlanOptions = { database: 'db', dialect: 'mysql', serverVersion: '8.4.11', sqlMode: { ansiQuotes: false, noBackslashEscapes: false }, checks: { foreignKeyChecks: 1, uniqueChecks: 1 } };
const childBody = '`id` int NOT NULL, `pid` int, `p2` int, PRIMARY KEY (`id`), KEY `support_child` (`pid`,`p2`), CONSTRAINT `check_positive` CHECK (`id` > 0)';
const parentBody = '`id` int NOT NULL,`a` int,`b` int,PRIMARY KEY(`id`),UNIQUE KEY `support_parent` (`a`,`b`)';
const oldClause = 'CONSTRAINT `old_fk` FOREIGN KEY (`pid`,`p2`) REFERENCES `parent` (`a`,`b`) ON UPDATE RESTRICT ON DELETE RESTRICT';
const childSql = (foreign = oldClause, body = childBody) => `CREATE TABLE child (${body}${foreign ? ', ' + foreign : ''}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
/** 纯测试显式提供可信目录，不把生成 SQL 执行或夹具观察冒充实库产品验收。 */
function table(sql: string, opt = options, database = 'db', prefix = 'child'): ForeignKeyTableSnapshot {
  const definition = parseTableColumnDefinition(sql, { dialect: opt.dialect, mode: opt.sqlMode });
  const columns = new Map<string, TrustedIndexColumn>(definition.columns.map(column => [`${prefix}:${column.name}`, { name: column.name, nullable: column.nullable !== false, dataType: column.type.raw.split(/[\s(]/)[0].toUpperCase(), columnType: column.type.raw, generated: false, hidden: false, fullKeyBytes: 4, prefix: { kind: 'forbidden', reason: '测试整数目录' } }]));
  const indexes = new Map(readTableIndexDefinition(definition).indexes.map(parsed => [`${prefix}:index:${parsed.name}`, { parsed, definition: editableIndexDefinition(parsed, columns), visible: true as const, generated: false as const }]));
  return { target: { database, table: definition.table }, identity: 'same-server', definition, columns, indexes, engine: 'InnoDB', rowFormat: 'Dynamic', pageSize: 16384, isTemporary: false, catalogComplete: true, partition: 'none', metadataDigest: `${database}:${definition.table}:trusted-columns-indexes` };
}
function snapshot(sql = childSql(), opt = options, parentSql = `CREATE TABLE parent (${parentBody}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`): ForeignKeyPlanSnapshot {
  const child = table(sql, opt), parent = table(parentSql, opt, 'db', 'parent');
  const result: ForeignKeyPlanSnapshot = { child, parents: new Map([['parent-ref', parent]]), foreignKeys: new Map(), outgoingComplete: true, incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, externalIncomingDigest: 'external-stable', namespaceNames: { complete: true, names: ['old_fk'], comparisons: new Map(['new_fk', 'renamed_fk', 'other_fk', 'third_fk', 'OLD_FK'].map(name => [name, 'available' as const])) } };
  return foreignKeys(result, opt);
}
/** 用生产只读解析器绑定旧元组，列 refs 与物理顺序独立。 */
function foreignKeys(value: ForeignKeyPlanSnapshot, opt = options): ForeignKeyPlanSnapshot {
  const result = new Map<string, TrustedForeignKey>();
  for (const parsed of readTableForeignKeyDefinition(value.child.definition, 'db', opt.serverVersion).foreignKeys) {
    const parentEntry = [...value.parents].find(([, parent]) => parent.target.database === parsed.parentTarget?.database && parent.target.table === parsed.parentTarget.table);
    const mapped = parentEntry && parsed.name && parsed.onDelete && parsed.onUpdate ? { name: parsed.name, parentRef: parentEntry[0], onUpdate: parsed.onUpdate, onDelete: parsed.onDelete, pairs: parsed.childColumnNames.map((name, i) => ({ childColumnRef: [...value.child.columns].find(([, column]) => column.name === name)![0], parentColumnRef: [...parentEntry[1].columns].find(([, column]) => column.name === parsed.parentColumnNames[i])![0] })) } : undefined;
    result.set('fk:' + parsed.name, { name: parsed.name!, rawSql: parsed.rawSql, range: parsed.range, ...(mapped ? { definition: mapped } : {}), opaqueReasons: parsed.opaqueReasons });
  }
  return { ...value, foreignKeys: result };
}
function definition(name = 'new_fk'): ForeignKeyDefinition { return { name, parentRef: 'parent-ref', pairs: [{ childColumnRef: 'child:pid', parentColumnRef: 'parent:a' }, { childColumnRef: 'child:p2', parentColumnRef: 'parent:b' }], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }; }
const add = (value = definition()): ForeignKeyPatch => ({ op: 'add', clientKey: 'added-ref', definition: value });
const replace = (changes: Partial<ForeignKeyDefinition> = { name: 'renamed_fk', onDelete: 'CASCADE' }): ForeignKeyPatch => ({ op: 'alter', foreignKeyRef: 'fk:old_fk', changes });
function blocked(result: ReturnType<typeof planTableForeignKeyPatches>, reason?: string): void { expect(result.kind).toBe('blocked'); if (reason && result.kind === 'blocked') expect(result.issues.map(issue => issue.message).join(' ')).toContain(reason); }
function ready(before: ForeignKeyPlanSnapshot, patches: ForeignKeyPatch[]) {
  const result = planTableForeignKeyPatches(before, patches, options); expect(result.kind).toBe('ready'); if (result.kind !== 'ready') throw new Error('测试缺少可执行计划'); return result;
}

describe('外键补丁输入及已证动作规范', () => {
  it.each([['mysql', '5.7.44', 'RESTRICT'], ['mysql', '8.0.46', 'NO ACTION'], ['mysql', '8.4.11', 'NO ACTION'], ['mariadb', '10.11.19-MariaDB', 'RESTRICT'], ['mariadb', '11.4.13-MariaDB', 'RESTRICT']] as const)('%s %s 省略动作读为 %s', (dialect, serverVersion, action) => {
    expect(defaultForeignKeyAction({ dialect, serverVersion })).toBe(action);
    const input = [add({ ...definition(), onDelete: 'NO ACTION' })]; expect(validateForeignKeyPatches(input)).toEqual(input);
  });
  it('拒绝未知版本、任意 SQL、额外标识符字段及重复映射', () => {
    expect(() => defaultForeignKeyAction({ dialect: 'mysql', serverVersion: '8.4.12' })).toThrow('尚未证明');
    expect(() => validateForeignKeyPatches([{ ...add(), sql: 'ALTER TABLE other' }])).toThrow();
    expect(() => validateForeignKeyPatches([add({ ...definition(), name: 'a`;DROP' })])).toThrow();
    expect(() => validateForeignKeyPatches([add({ ...definition(), pairs: [definition().pairs[0], definition().pairs[0]] })])).toThrow('重复');
    expect(() => validateForeignKeyPatches([replace({}), replace()])).toThrow();
  });
  it('巨大输入、访问器、toJSON、循环、空洞和非法 Unicode 在 Zod 克隆前拒绝', () => {
    let calls = 0; const accessor = Object.defineProperty({}, 'op', { enumerable: true, get() { calls++; return 'add'; } });
    expect(() => validateForeignKeyPatches([accessor])).toThrow(); expect(calls).toBe(0);
    expect(() => validateForeignKeyPatches([{ toJSON() { calls++; } }])).toThrow(); expect(calls).toBe(0);
    const cycle: unknown[] = []; cycle.push(cycle); expect(() => validateForeignKeyPatches(cycle)).toThrow();
    expect(() => validateForeignKeyPatches(new Array(1))).toThrow();
    expect(() => validateForeignKeyPatches([{ ...add(), extra: '字'.repeat(180000) }])).toThrow();
    expect(() => validateForeignKeyPatches([add({ ...definition(), parentRef: '\ud800' })])).toThrow();
    expect(() => validateForeignKeyPatches([{ op: 'alter', foreignKeyRef: 'x', changes: { name: undefined } }])).toThrow();
  });
});

describe('外键单条差异纯计划', () => {
  it.each([['mysql', '5.7.44'], ['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19-MariaDB'], ['mariadb', '11.4.13-MariaDB']] as const)('%s %s 同名动作修改零 SQL，用户异名才单 ALTER', (dialect, serverVersion) => {
    const opt = { ...options, dialect, serverVersion }, before = snapshot(childSql(), opt);
    blocked(planTableForeignKeyPatches(before, [replace({ onDelete: 'CASCADE' })], opt), '同名');
    const plan = planTableForeignKeyPatches(before, [replace()], opt); expect(plan.kind).toBe('ready');
    if (plan.kind === 'ready') { expect(splitSql(plan.sql)).toHaveLength(1); expect(plan.sql).toContain('DROP FOREIGN KEY `old_fk`, ADD CONSTRAINT `renamed_fk`'); expect(plan.sql).not.toContain('ADD INDEX'); }
  });
  it('独立 ADD/DROP 不修改数据、字段或任何支持索引；同值修改无 SQL', () => {
    const before = snapshot(); const dropped = ready(before, [{ op: 'drop', foreignKeyRef: 'fk:old_fk' }]);
    expect(dropped.sql).toBe('ALTER TABLE `db`.`child` DROP FOREIGN KEY `old_fk`;'); expect(dropped.finalForeignKeys).toEqual([]);
    const added = ready(snapshot(childSql('')), [add()]); expect(added.sql).toContain('FOREIGN KEY (`pid`, `p2`) REFERENCES `db`.`parent` (`a`, `b`)');
    expect(planTableForeignKeyPatches(before, [replace({ onDelete: 'RESTRICT' })], options).kind).toBe('noop');
    blocked(planTableForeignKeyPatches(before, [{ op: 'drop', foreignKeyRef: 'fk:old_fk' }, add(definition('old_fk'))], options), '名称');
  });
  it('缺失/跨快照子父 refs 不能使用名字伪授权；跨服务器父目标拒绝', () => {
    blocked(planTableForeignKeyPatches(snapshot(), [add({ ...definition(), parentRef: 'parent' })], options), '父表引用');
    blocked(planTableForeignKeyPatches(snapshot(), [add({ ...definition(), pairs: [{ childColumnRef: 'pid', parentColumnRef: 'parent:a' }] })], options), '字段引用');
    const before = snapshot(); before.parents.get('parent-ref')!.identity = 'another-server'; blocked(planTableForeignKeyPatches(before, [add()], options), '服务器');
  });
  it('服务器未确认命名空间、显式冲突、纯大小写改名和同批碰撞拒绝', () => {
    const before = snapshot(); before.namespaceNames.comparisons = new Map(); blocked(planTableForeignKeyPatches(before, [add()], options), '服务器确认');
    before.namespaceNames.comparisons = new Map([['new_fk', 'conflict']]); blocked(planTableForeignKeyPatches(before, [add()], options), '服务器确认');
    blocked(planTableForeignKeyPatches(snapshot(), [replace({ name: 'OLD_FK' })], options), '同名');
    blocked(planTableForeignKeyPatches(snapshot(), [add(), { ...add(), clientKey: 'second' }], options), '冲突');
  });
  it('未知旧语法保留但禁止触及，不阻无关新增', () => {
    const before = snapshot(); const old = before.foreignKeys.get('fk:old_fk')!;
    (before.foreignKeys as Map<string, TrustedForeignKey>).set('fk:old_fk', { ...old, definition: undefined, opaqueReasons: ['MATCH 尚未证明'] });
    blocked(planTableForeignKeyPatches(before, [{ op: 'drop', foreignKeyRef: 'fk:old_fk' }], options), '只读');
    expect(ready(before, [add()]).finalForeignKeys).toHaveLength(2);
  });
  it.each(['engine', 'rowFormat', 'pageSize', 'temporary', 'catalog', 'partition', 'mode'])('未证物理能力 %s 阻新增', field => {
    const before = snapshot();
    if (field === 'engine') before.child.engine = 'MyISAM'; if (field === 'rowFormat') before.child.rowFormat = 'Compact'; if (field === 'pageSize') before.child.pageSize = 8192;
    if (field === 'temporary') before.child.isTemporary = true; if (field === 'catalog') before.child.catalogComplete = false; if (field === 'partition') before.child.partition = 'unknown'; if (field === 'mode') before.child.definition.context.mode.ansiQuotes = true;
    blocked(planTableForeignKeyPatches(before, [add()], options));
  });
  it('两侧目录必须严格类型、符号、精度及字符属性一致', () => {
    for (const changes of [{ columnType: 'int unsigned' }, { dataType: 'BIGINT', columnType: 'bigint' }, { charset: 'latin1', collation: 'latin1_bin' }, { generated: true }, { hidden: true }, { fullKeyBytes: undefined }]) {
      const before = snapshot(), parent = before.parents.get('parent-ref')!;
      (parent.columns as Map<string, TrustedIndexColumn>).set('parent:a', { ...parent.columns.get('parent:a')!, ...changes });
      blocked(planTableForeignKeyPatches(before, [add()], options), '兼容');
    }
  });
  it('字符串缺失真实字符集/排序规则时不以双方undefined当兼容，完整同值目录可用', () => {
    const before = snapshot();
    for (const [value, ref] of [[before.child, 'child:pid'], [before.parents.get('parent-ref')!, 'parent:a']] as const) {
      (value.columns as Map<string, TrustedIndexColumn>).set(ref, { ...value.columns.get(ref)!, dataType: 'VARCHAR', columnType: 'varchar(20)', fullKeyBytes: 80 });
    }
    blocked(planTableForeignKeyPatches(before, [add()], options), '兼容');
    for (const [value, ref] of [[before.child, 'child:pid'], [before.parents.get('parent-ref')!, 'parent:a']] as const) {
      (value.columns as Map<string, TrustedIndexColumn>).set(ref, { ...value.columns.get(ref)!, charset: 'utf8mb4', collation: 'utf8mb4_bin' });
    }
    expect(ready(before, [add()]).kind).toBe('ready');
  });
  it.each(['onDelete', 'onUpdate'] as const)('%s SET NULL 逐列检查，不自动改 NOT NULL', action => {
    const value = { ...definition(), [action]: 'SET NULL' as const }; expect(ready(snapshot(), [add(value)]).kind).toBe('ready');
    const before = snapshot(); (before.child.columns as Map<string, TrustedIndexColumn>).set('child:p2', { ...before.child.columns.get('child:p2')!, nullable: false });
    blocked(planTableForeignKeyPatches(before, [add(value)], options), '全部子字段');
  });
  it.each(['missing', 'prefix', 'desc', 'hidden', 'generated', 'nonunique', 'extra-part'])('父支持键 %s 不冒充完整可靠唯一键', kind => {
    const before = snapshot(), parent = before.parents.get('parent-ref')!, indexes = new Map(parent.indexes), entry = indexes.get('parent:index:support_parent')!;
    if (kind === 'missing') indexes.delete('parent:index:support_parent');
    else { const value = { ...structuredClone(entry.definition!) }; if (kind === 'prefix') value.keyParts[0].prefixLength = 1; if (kind === 'desc') value.keyParts[0].direction = 'desc'; if (kind === 'nonunique') value.kind = 'ordinary'; if (kind === 'extra-part') value.keyParts.push({ columnRef: 'parent:id', direction: 'asc' }); indexes.set('parent:index:support_parent', { ...entry, definition: value, visible: kind === 'hidden' ? false : true, generated: kind === 'generated' }); }
    parent.indexes = indexes; blocked(planTableForeignKeyPatches(before, [add()], options), '父表缺少');
  });
  it('缺子支持键、TEXT前缀和顺序不符拒；不会生成隐式索引策略', () => {
    const before = snapshot(); before.child.indexes = new Map(); blocked(planTableForeignKeyPatches(before, [add()], options), '子表支持');
    blocked(planTableForeignKeyPatches(snapshot(), [add({ ...definition(), pairs: [...definition().pairs].reverse() })], options), '支持');
    const text = snapshot(); (text.child.columns as Map<string, TrustedIndexColumn>).set('child:pid', { ...text.child.columns.get('child:pid')!, dataType: 'TEXT', columnType: 'text' }); blocked(planTableForeignKeyPatches(text, [add()], options), '兼容');
  });
  it('子表已有完整覆盖键可支持前导映射，父表仍要求精确唯一元组', () => {
    const before = snapshot(childSql('', childBody.replace('(`pid`,`p2`)', '(`pid`,`p2`,`id`)')));
    expect(ready(before, [add()]).sql).not.toContain('ADD INDEX');
  });
  it.each([false, true])('跨库目标与原型/反引号字段只从 refs 安全引用，NBE=%s', noBackslashEscapes => {
    const opt = { ...options, sqlMode: { ...options.sqlMode, noBackslashEscapes } };
    const before = snapshot(childSql(''), opt);
    const child = table('CREATE TABLE child(`__proto__` int,`构``造` int, KEY support_child(`__proto__`,`构``造`)) ENGINE=InnoDB', opt);
    const parent = table('CREATE TABLE `父``表`(`__proto__` int,`构``造` int, UNIQUE KEY u(`__proto__`,`构``造`)) ENGINE=InnoDB', opt, '跨``库', 'parent');
    before.child = child; before.parents = new Map([['parent-ref', parent]]);
    const value = { ...definition(), pairs: [{ childColumnRef: 'child:__proto__', parentColumnRef: 'parent:__proto__' }, { childColumnRef: 'child:构`造', parentColumnRef: 'parent:构`造' }] };
    const result = planTableForeignKeyPatches(before, [add(value)], opt); expect(result.kind).toBe('ready');
    if (result.kind === 'ready') { expect(result.sql).toContain('REFERENCES `跨````库`.`父``表` (`__proto__`, `构``造`)'); expect(splitSql(result.sql, noBackslashEscapes)).toHaveLength(1); }
  });
  it('约束检查关闭或低于受证版本不能靠服务器最后拒绝代替纯裁决', () => {
    blocked(planTableForeignKeyPatches(snapshot(), [add()], { ...options, checks: { foreignKeyChecks: 0, uniqueChecks: 1 } } as unknown as ForeignKeyPlanOptions), '检查');
    blocked(planTableForeignKeyPatches(snapshot(), [add()], { ...options, serverVersion: '8.4.12' }), '版本');
  });
  it('partial 入向保留独立操作但不伪完整核验，出向未闭合则阻计划', () => {
    const before = snapshot(); before.incomingCoverage = { kind: 'partial', reason: 'permission' };
    const plan = ready(before, [{ op: 'drop', foreignKeyRef: 'fk:old_fk' }]); expect(plan.verification.definitionCanBeFullyVerified).toBe(false);
    expect(ready(before, [add()]).warnings.some(warning => warning.code === 'incoming-partial')).toBe(true);
    before.outgoingComplete = false; blocked(planTableForeignKeyPatches(before, [add()], options), '完整核对');
  });
  it('Maria 表级风险阻全部ALTER；quoted binary仍允许不重述但保持未核验', () => {
    const opt = { ...options, dialect: 'mariadb' as const, serverVersion: '11.4.13-MariaDB' };
    const risky = snapshot(childSql(oldClause, childBody + ", risky varchar(50) DEFAULT concat('a','b')"), opt);
    blocked(planTableForeignKeyPatches(risky, [{ op: 'drop', foreignKeyRef: 'fk:old_fk' }], opt), '默认值');
    const binary = snapshot(childSql(oldClause, childBody + ", bytes varbinary(10) DEFAULT 'x'"));
    expect(ready(binary, [replace()]).verification.definitionCanBeFullyVerified).toBe(false);
  });
});

describe('外键最终定义独立核验', () => {
  const replaced = oldClause.replace('old_fk', 'renamed_fk').replace('ON DELETE RESTRICT', 'ON DELETE CASCADE');
  it('独立drop/add/异名replace核验最终集，其他属性保持', () => {
    const before = snapshot(); expect(verifyForeignKeyAfter(before, ready(before, [replace()]), snapshot(childSql(replaced)))).toBe(true);
    expect(verifyForeignKeyAfter(before, ready(before, [{ op: 'drop', foreignKeyRef: 'fk:old_fk' }]), snapshot(childSql('')))).toBe(true);
    const empty = snapshot(childSql('')); expect(verifyForeignKeyAfter(empty, ready(empty, [add()]), snapshot(childSql(oldClause.replace('old_fk', 'new_fk'))))).toBe(true);
  });
  it.each(['action', 'mapping', 'name', 'extra-fk', 'column', 'index-drop', 'index-added', 'check', 'tail', 'identity', 'metadata', 'incoming'])('实际 %s 漂移不得报告完整核验', kind => {
    const before = snapshot(), plan = ready(before, [replace()]); let after = snapshot(childSql(replaced));
    if (kind === 'action') after = snapshot(childSql(replaced.replace('ON DELETE CASCADE', 'ON DELETE NO ACTION')));
    if (kind === 'mapping') after.foreignKeys.get('fk:renamed_fk')!.definition!.pairs.reverse();
    if (kind === 'name') after = snapshot(childSql(replaced.replace('renamed_fk', 'third_fk')));
    if (kind === 'extra-fk') after = snapshot(childSql(replaced + ', ' + oldClause));
    if (kind === 'column') after = snapshot(childSql(replaced, childBody.replace('`p2` int', '`p2` bigint')));
    if (kind === 'index-drop') after.child.indexes = new Map();
    if (kind === 'index-added') after = snapshot(childSql(replaced, childBody + ',KEY implicit_new(p2)'));
    if (kind === 'check') after = snapshot(childSql(replaced, childBody.replace('`id` > 0', '`id` > 1')));
    if (kind === 'tail') after = snapshot(childSql(replaced) + " COMMENT='changed'");
    if (kind === 'identity') after.child.identity = 'different-server';
    if (kind === 'metadata') after.child.metadataDigest = 'different';
    if (kind === 'incoming') after.externalIncomingDigest = 'different-actions-or-outside-columns';
    expect(verifyForeignKeyAfter(before, plan, after)).toBe(false);
  });
  it('外键显示顺序不影响语义，未改 FK 原片段仍需保留', () => {
    const second = oldClause.replace('old_fk', 'another_old');
    const before = snapshot(childSql(oldClause + ',' + second)), plan = ready(before, [replace()]);
    expect(verifyForeignKeyAfter(before, plan, snapshot(childSql(second + ',' + replaced)))).toBe(true);
  });
  it('父表发生变化和元数据失去完整证明均不假核验', () => {
    const before = snapshot(), plan = ready(before, [replace()]);
    const after = snapshot(childSql(replaced), options, `CREATE TABLE parent (${parentBody}) ENGINE=InnoDB COMMENT='changed'`);
    expect(verifyForeignKeyAfter(before, plan, after)).toBe(false);
    const partial = snapshot(childSql(replaced)); partial.child.catalogComplete = false; expect(verifyForeignKeyAfter(before, plan, partial)).toBe(false);
  });
  it('删除外键仍核对已知旧父表，目录漂移或漏读不能报告完整核验', () => {
    const before = snapshot(), plan = ready(before, [{ op: 'drop', foreignKeyRef: 'fk:old_fk' }]);
    expect(plan.verification.parentRefs).toEqual(['parent-ref']);
    const unchanged = snapshot(childSql('')); expect(verifyForeignKeyAfter(before, plan, unchanged)).toBe(true);
    const drifted = snapshot(childSql('')); drifted.parents.get('parent-ref')!.metadataDigest = 'old-parent-changed';
    expect(verifyForeignKeyAfter(before, plan, drifted)).toBe(false);
    const missing = snapshot(childSql('')); missing.parents = new Map();
    expect(verifyForeignKeyAfter(before, plan, missing)).toBe(false);
  });
  it('替换父目标核验旧新父表并集，旧父原定义变化或缺失都拒绝verified', () => {
    const before = snapshot(), next = table(`CREATE TABLE parent_next (${parentBody}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, options, 'db', 'parent');
    before.parents = new Map([...before.parents, ['next-parent-ref', next]]);
    const plan = ready(before, [replace({ name: 'renamed_fk', parentRef: 'next-parent-ref' })]);
    expect(plan.verification.parentRefs).toEqual(['parent-ref', 'next-parent-ref']);
    const after = snapshot(childSql(''));
    after.child = table(childSql(oldClause.replace('old_fk', 'renamed_fk').replace('REFERENCES `parent`', 'REFERENCES `parent_next`')));
    after.parents = new Map([...after.parents, ['next-parent-ref', next]]);
    const actual = foreignKeys(after); expect(verifyForeignKeyAfter(before, plan, actual)).toBe(true);
    const oldChanged = table(`CREATE TABLE parent (${parentBody}) ENGINE=InnoDB COMMENT='external change'`, options, 'db', 'parent');
    expect(verifyForeignKeyAfter(before, plan, { ...actual, parents: new Map([['parent-ref', oldChanged], ['next-parent-ref', next]]) })).toBe(false);
    expect(verifyForeignKeyAfter(before, plan, { ...actual, parents: new Map([['next-parent-ref', next]]) })).toBe(false);
  });
  it('self 修改核验父表时不错误要求子表整份DDL不变', () => {
    const body = childBody + ',UNIQUE KEY self_parent(pid,p2)', selfOld = oldClause.replace('REFERENCES `parent` (`a`,`b`)', 'REFERENCES `child` (`pid`,`p2`)');
    const make = (clause: string) => { const value = snapshot(childSql(clause, body)); value.parents = new Map([['parent-ref', value.child]]); return foreignKeys(value); };
    const before = make(selfOld), plan = ready(before, [replace()]);
    const after = make(selfOld.replace('old_fk', 'renamed_fk').replace('ON DELETE RESTRICT', 'ON DELETE CASCADE'));
    expect(verifyForeignKeyAfter(before, plan, after)).toBe(true);
    const inconsistent = make(selfOld); inconsistent.parents = new Map([['parent-ref', { ...inconsistent.child, metadataDigest: 'earlier-self-read' }]]);
    blocked(planTableForeignKeyPatches(inconsistent, [replace()], options), '自引用');
  });
  it('旧 FK 指向未持有的父快照时，删除可计划但不能承诺或报告完整核验', () => {
    const before = snapshot(); before.parents = new Map();
    const plan = ready(before, [{ op: 'drop', foreignKeyRef: 'fk:old_fk' }]);
    expect(plan.verification.parentRefs).toEqual([]);
    expect(plan.verification.definitionCanBeFullyVerified).toBe(false);
    expect(plan.warnings.some(warning => warning.code === 'parent-snapshot-incomplete')).toBe(true);
    expect(verifyForeignKeyAfter(before, plan, snapshot(childSql('')))).toBe(false);
  });
  it('改到已持有的新父表不能掩盖旧父快照缺失', () => {
    const before = snapshot(), next = table(`CREATE TABLE parent_next (${parentBody}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, options, 'db', 'parent');
    before.parents = new Map([['next-parent-ref', next]]);
    const plan = ready(before, [replace({ name: 'renamed_fk', parentRef: 'next-parent-ref' })]);
    expect(plan.verification.parentRefs).toEqual(['next-parent-ref']);
    expect(plan.verification.definitionCanBeFullyVerified).toBe(false);
    const after = snapshot(childSql(oldClause.replace('old_fk', 'renamed_fk').replace('REFERENCES `parent`', 'REFERENCES `parent_next`')));
    after.parents = before.parents;
    expect(verifyForeignKeyAfter(before, plan, foreignKeys(after))).toBe(false);
  });
  it('独立核验不信旧计划 full 标志：缺失旧父与被裁掉的父引用均拒绝', () => {
    const before = snapshot(), plan = ready(before, [{ op: 'drop', foreignKeyRef: 'fk:old_fk' }]);
    const incompletePlan = { ...plan, verification: { ...plan.verification, parentRefs: [] } };
    expect(verifyForeignKeyAfter(before, incompletePlan, snapshot(childSql('')))).toBe(false);
    before.parents = new Map();
    expect(verifyForeignKeyAfter(before, incompletePlan, snapshot(childSql('')))).toBe(false);
  });
});
