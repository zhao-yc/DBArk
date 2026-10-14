import { describe, expect, it } from 'vitest';
import { buildForeignKeyNamespaceEvidence as build, planForeignKeyNameComparisons as plan, mergeForeignKeyNameComparisons as merge, foreignKeyNamespaceLimits, type ForeignKeyNamespaceFacts, type ForeignKeyNamespaceInput, type ForeignKeyNameComparisonPlan, type ForeignKeyNameComparisonReply } from '../../src/engine/tableForeignKeyNamespaceEvidence';

const mysql: ForeignKeyNamespaceFacts = { dialect: 'mysql', serverVersion: '8.4.11', compileOs: 'Linux', lowerCaseTableNames: 0 };
const versions: ForeignKeyNamespaceFacts[] = [
  { ...mysql, serverVersion: '5.7.44' }, { ...mysql, serverVersion: '8.0.46' }, mysql,
  { ...mysql, dialect: 'mariadb', serverVersion: '10.11.19-MariaDB', compileOs: 'debian-linux-gnu' },
  { ...mysql, dialect: 'mariadb', serverVersion: '11.4.13-MariaDB', compileOs: 'debian-linux-gnu' },
];
/** 合成原生目录测试：TYPE 明确按官方源码公式提供，不冒充现有实库夹具曾采集 TYPE。 */
function fixture(facts = mysql, constraint = 'fk_parent', database = 'db'): ForeignKeyNamespaceInput {
  const modern = facts.dialect === 'mysql' && !facts.serverVersion.startsWith('5.7.');
  const id = database + '/' + constraint;
  return {
    facts: { ...facts }, readComplete: { headers: true, nativeColumns: true, rc: true, kcu: true },
    headers: [{ ID: id, FOR_NAME: database + '/child', REF_NAME: 'other/parent', N_COLS: '2', TYPE: modern ? '48' : '0' }],
    nativeColumns: ['a', 'b'].map((suffix, index) => ({ ID: id, FOR_COL_NAME: 'c' + suffix, REF_COL_NAME: 'p' + suffix, POS: index + (modern ? 1 : 0) })),
    rc: [{ CONSTRAINT_SCHEMA: database, CONSTRAINT_NAME: constraint, TABLE_NAME: 'child', UNIQUE_CONSTRAINT_SCHEMA: 'other', REFERENCED_TABLE_NAME: 'parent', MATCH_OPTION: 'NONE', UPDATE_RULE: modern ? 'NO ACTION' : 'RESTRICT', DELETE_RULE: modern ? 'NO ACTION' : 'RESTRICT' }],
    kcu: ['a', 'b'].map((suffix, index) => ({ CONSTRAINT_SCHEMA: database, CONSTRAINT_NAME: constraint, TABLE_SCHEMA: database, TABLE_NAME: 'child', COLUMN_NAME: 'c' + suffix, ORDINAL_POSITION: String(index + 1), REFERENCED_TABLE_SCHEMA: 'other', REFERENCED_TABLE_NAME: 'parent', REFERENCED_COLUMN_NAME: 'p' + suffix })),
  };
}
function empty(facts = mysql): ForeignKeyNamespaceInput { return { ...fixture(facts), headers: [], nativeColumns: [], rc: [], kcu: [] }; }
/** 仅按真实四套目录行拼接多个独立约束，避免测试绕过生产闭合检查。 */
function many(count: number, facts = mysql): ForeignKeyNamespaceInput {
  const value = empty(facts);
  for (let index = 0; index < count; index++) {
    const next = fixture(facts, 'fk_' + index);
    for (const key of ['headers', 'nativeColumns', 'rc', 'kcu'] as const) value[key] = [...value[key], ...next[key]];
  }
  return value;
}
function ready(input = fixture(), candidates = ['new_fk']): Extract<ForeignKeyNameComparisonPlan, { kind: 'ready' }> {
  const result = plan(build(input), 'db', candidates);
  if (result.kind !== 'ready') throw new Error('测试输入未形成可信计划');
  return result;
}
function replies(value: Extract<ForeignKeyNameComparisonPlan, { kind: 'ready' }>, matched: 0 | 1 | '0' | '1' = '0'): ForeignKeyNameComparisonReply[] {
  return value.queries.map(query => ({ id: query.id, rows: query.candidateOrdinals.map(candidateOrdinal => ({ candidateOrdinal: String(candidateOrdinal), matched })) }));
}

describe('全局外键命名空间可信目录闭合', () => {
  it.each(versions)('按 $dialect $serverVersion 的实际 POS 基数接受双向对应', facts => {
    const result = build(fixture(facts));
    expect(result.kind).toBe('complete');
    if (result.kind === 'complete') expect(result.entries[0]).toMatchObject({ id: 'db/fk_parent', childColumns: ['ca', 'cb'], parentColumns: ['pa', 'pb'], type: facts.dialect === 'mysql' && !facts.serverVersion.startsWith('5.7.') ? 48 : 0 });
  });
  it.each([{ ...mysql, serverVersion: '8.4.12' }, { ...mysql, compileOs: 'fake-Linux' }, { ...mysql, compileOs: 'debian-linux-gnu' }, { ...mysql, lowerCaseTableNames: 1 }])('未证明构建和大小写规则只返回 partial', facts => {
    expect(build(empty(facts))).toMatchObject({ kind: 'partial', reason: 'capability' });
  });
  it.each(['headers', 'nativeColumns', 'rc', 'kcu'] as const)('目录 %s 未结束不能以其它目录空集宣布完整', key => {
    const value = empty(); value.readComplete[key] = false;
    expect(build(value)).toMatchObject({ kind: 'partial', reason: 'incomplete' });
  });
  it('四套目录真实完整空集可证明为空', () => { expect(build(empty())).toMatchObject({ kind: 'complete', entries: [] }); });
  it.each([
    ['RESTRICT', 'RESTRICT', 0], ['RESTRICT', 'CASCADE', 4], ['RESTRICT', 'SET NULL', 8], ['RESTRICT', 'NO ACTION', 32],
    ['CASCADE', 'RESTRICT', 1], ['CASCADE', 'CASCADE', 5], ['CASCADE', 'SET NULL', 9], ['CASCADE', 'NO ACTION', 33],
    ['SET NULL', 'RESTRICT', 2], ['SET NULL', 'CASCADE', 6], ['SET NULL', 'SET NULL', 10], ['SET NULL', 'NO ACTION', 34],
    ['NO ACTION', 'RESTRICT', 16], ['NO ACTION', 'CASCADE', 20], ['NO ACTION', 'SET NULL', 24], ['NO ACTION', 'NO ACTION', 48],
  ])('源码动作公式 DELETE %s / UPDATE %s 对应 TYPE %i', (onDelete, onUpdate, type) => {
    const value = fixture(); value.rc[0].DELETE_RULE = onDelete; value.rc[0].UPDATE_RULE = onUpdate; value.headers[0].TYPE = type;
    expect(build(value).kind).toBe('complete');
  });
  it.each([0, 3, 12, 63, 64, -1, '048', true])('不能为默认 NO ACTION 容忍错误或多动作 TYPE %s', type => {
    const value = fixture(); value.headers[0].TYPE = type;
    expect(build(value).kind).toBe('partial');
  });
  it.each([
    ['头遗漏', (x: ForeignKeyNamespaceInput) => { x.headers = []; }],
    ['逻辑规则遗漏', (x: ForeignKeyNamespaceInput) => { x.rc = []; }],
    ['原生列遗漏', (x: ForeignKeyNamespaceInput) => { x.nativeColumns = x.nativeColumns.slice(1); }],
    ['逻辑列遗漏', (x: ForeignKeyNamespaceInput) => { x.kcu = x.kcu.slice(1); }],
    ['重复头', (x: ForeignKeyNamespaceInput) => { x.headers = [...x.headers, x.headers[0]]; }],
    ['重复规则', (x: ForeignKeyNamespaceInput) => { x.rc = [...x.rc, x.rc[0]]; }],
    ['孤立原生列', (x: ForeignKeyNamespaceInput) => { x.nativeColumns[0].ID = 'db/unknown'; }],
    ['同数量不同身份', (x: ForeignKeyNamespaceInput) => { x.headers[0].ID = 'db/other'; }],
    ['不可拆猜的 ID', (x: ForeignKeyNamespaceInput) => { x.headers[0].ID = 'db/child/fk_parent'; }],
    ['不同子表', (x: ForeignKeyNamespaceInput) => { x.headers[0].FOR_NAME = 'db/other'; }],
    ['不同父表', (x: ForeignKeyNamespaceInput) => { x.headers[0].REF_NAME = 'db/parent'; }],
    ['错误基数', (x: ForeignKeyNamespaceInput) => { x.nativeColumns[0].POS = 0; }],
    ['重复原生序号', (x: ForeignKeyNamespaceInput) => { x.nativeColumns[1].POS = 1; }],
    ['重复逻辑序号', (x: ForeignKeyNamespaceInput) => { x.kcu[1].ORDINAL_POSITION = 1; }],
    ['原生序号空档', (x: ForeignKeyNamespaceInput) => { x.nativeColumns[1].POS = 3; }],
    ['子库矛盾', (x: ForeignKeyNamespaceInput) => { x.kcu[0].TABLE_SCHEMA = 'another'; }],
    ['父库矛盾', (x: ForeignKeyNamespaceInput) => { x.kcu[0].REFERENCED_TABLE_SCHEMA = 'another'; }],
    ['列映射矛盾', (x: ForeignKeyNamespaceInput) => { x.nativeColumns[0].REF_COL_NAME = 'pb'; }],
    ['未知 MATCH', (x: ForeignKeyNamespaceInput) => { x.rc[0].MATCH_OPTION = 'FULL'; }],
    ['未知动作', (x: ForeignKeyNamespaceInput) => { x.rc[0].UPDATE_RULE = 'SET DEFAULT'; }],
    ['额外属性', (x: ForeignKeyNamespaceInput) => { x.headers[0].EXTRA = ''; }],
    ['非 ASCII 名称', (x: ForeignKeyNamespaceInput) => { x.rc[0].CONSTRAINT_NAME = '外键'; }],
    ['非 ASCII 列名', (x: ForeignKeyNamespaceInput) => { x.kcu[0].COLUMN_NAME = '列'; }],
  ] as const)('%s 即使其它数量相符也不证明完整', (_, mutate) => { const value = fixture(); mutate(value); expect(build(value).kind).toBe('partial'); });
  it('父支持键名缺失或 null 不伪造绑定；非 ASCII 辅助属性仍拒绝', () => {
    const value = fixture(); value.rc[0].UNIQUE_CONSTRAINT_NAME = null;
    expect(build(value).kind).toBe('complete');
    value.rc[0].UNIQUE_CONSTRAINT_NAME = 'PRIMARY'; expect(build(value).kind).toBe('complete');
    value.rc[0].UNIQUE_CONSTRAINT_NAME = '未知'; expect(build(value).kind).toBe('partial');
  });
  it('原型名称作为普通 Map 身份；序号排序而非返回行顺序形成稳定摘要', () => {
    const value = fixture(mysql, '__proto__', 'constructor');
    const before = build(value); value.nativeColumns = [...value.nativeColumns].reverse(); value.kcu = [...value.kcu].reverse();
    const after = build(value); expect(after).toEqual(before);
    expect(after.kind).toBe('complete');
  });
  it('不同返回顺序不改变摘要，但动作与外侧有序映射改变摘要', () => {
    const value = many(2), before = build(value);
    for (const key of ['headers', 'nativeColumns', 'rc', 'kcu'] as const) value[key] = [...value[key]].reverse();
    expect(build(value)).toEqual(before);
    value.headers[0].TYPE = 0; value.rc[0].UPDATE_RULE = 'RESTRICT'; value.rc[0].DELETE_RULE = 'RESTRICT';
    const changed = build(value); expect(changed.kind).toBe('complete');
    if (changed.kind === 'complete' && before.kind === 'complete') expect(changed.digest).not.toBe(before.digest);
    value.nativeColumns[0].REF_COL_NAME = 'pc'; value.kcu[0].REFERENCED_COLUMN_NAME = 'pc';
    const tuple = build(value); expect(tuple.kind).toBe('complete');
    if (tuple.kind === 'complete' && changed.kind === 'complete') expect(tuple.digest).not.toBe(changed.digest);
  });
  it.each(['headers', 'rc', 'nativeColumns', 'kcu'] as const)('%s 数量先有界拒绝', key => {
    const value = fixture(); value[key] = Array(key === 'headers' || key === 'rc' ? 1001 : 32001).fill(value[key][0]);
    expect(build(value)).toMatchObject({ kind: 'partial', reason: 'budget' });
  });
  it('单字段巨量与 JSON 转义字节也在 4 MiB 预算内检查', () => {
    const value = fixture(); value.headers[0].ID = 'a'.repeat(foreignKeyNamespaceLimits.bytes + 1);
    expect(build(value)).toMatchObject({ kind: 'partial', reason: 'budget' });
    value.headers[0].ID = '\u0001'.repeat(750_000);
    expect(build(value)).toMatchObject({ kind: 'partial', reason: 'budget' });
  });
  it('不调用 getter/toJSON，不接受循环对象、符号字段或稀疏目录', () => {
    let calls = 0; const value = fixture();
    Object.defineProperty(value.headers[0], 'ID', { get() { calls++; return 'db/fk_parent'; }, configurable: true });
    expect(build(value).kind).toBe('partial'); expect(calls).toBe(0);
    const cycle = fixture(); cycle.headers[0].TYPE = cycle; expect(build(cycle).kind).toBe('partial');
    const fn = fixture(); fn.headers[0].toJSON = () => { calls++; return {}; }; expect(build(fn).kind).toBe('partial'); expect(calls).toBe(0);
    const symbol = fixture(); Object.defineProperty(symbol.rc[0], Symbol(), { value: 1 }); expect(build(symbol).kind).toBe('partial');
    const sparse = fixture(); sparse.headers = Array(1); expect(build(sparse).kind).toBe('partial');
  });
});

describe('服务器名称比较计划与严格回复合并', () => {
  it('MySQL 8 只纳入同精确 schema，固定 general_ci 而非目录展示 collation', () => {
    const input = fixture(mysql, 'Existing', 'DB'); const value = ready(input, ['existing']);
    expect(value.queries).toHaveLength(0); expect(merge(value, []).get('existing')).toBe('available');
    const same = plan(build(input), 'DB', ['existing']); expect(same.kind).toBe('ready');
    if (same.kind === 'ready') {
      expect(same.queries[0].sql).toContain("X'4578697374696e67'");
      expect(same.queries[0].sql).toContain('utf8mb3_general_ci'); expect(same.queries[0].sql).not.toContain('tolower');
      expect(merge(same, replies(same, '1')).get('existing')).toBe('conflict');
    }
  });
  it.each([versions[0], versions[3], versions[4]])('SYS 分支 %s 比较全局带 schema 前缀 ID，不用 JS 小写推断', facts => {
    const value = ready(fixture(facts, 'Existing', 'DB'), ['existing']);
    expect(value.queries[0].sql).toContain("X'44422f4578697374696e67'");
    expect(value.queries[0].sql).toContain("X'64622f6578697374696e67'");
    expect(value.queries[0].sql).toContain('latin1_swedish_ci');
    expect(merge(value, replies(value, 0)).get('existing')).toBe('available');
    expect(merge(value, replies(value, 1)).get('existing')).toBe('conflict');
  });
  it('真实完整空目录允许单名直接可用；同批大小写候选仍送服务器互比', () => {
    const single = ready(empty()); expect(single.queries).toEqual([]); expect(merge(single, []).get('new_fk')).toBe('available');
    const batch = ready(empty(), ['fk', 'FK']); expect(batch.queries).toHaveLength(1);
    expect(batch.queries[0].sql).toContain('c.candidateOrdinal <> e.candidateOrdinal');
    expect([...merge(batch, replies(batch, 1)).values()]).toEqual(['conflict', 'conflict']);
    const inconsistent = fixture(); inconsistent.headers = []; inconsistent.nativeColumns = [];
    expect(plan(build(inconsistent), 'db', ['new_fk']).kind).toBe('unknown');
  });
  it('1000 全局外键和 100 候选分为最多 16×64 的实际派生表查询', () => {
    const value = ready(many(1000), Array.from({ length: 100 }, (_, i) => 'new_' + i));
    expect(value.queries).toHaveLength(7 * 18);
    expect(value.queries.every(query => query.candidateOrdinals.length <= 16 && query.existingCount <= 64)).toBe(true);
    expect(value.queries.every(query => query.sql.includes('CROSS JOIN') && query.sql.includes('GROUP BY c.candidateOrdinal'))).toBe(true);
    expect(value.queries.reduce((bytes, query) => bytes + Buffer.byteLength(query.sql), 0)).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect([...merge(value, replies(value)).values()].every(x => x === 'available')).toBe(true);
  });
  it.each([['bad name'], ['中文'], ["a';DROP"], ['a', 'a'], [], Array(101).fill('a')])('拒非法、重复或超额候选 %s', names => {
    expect(() => plan(build(empty()), 'db', names)).toThrow();
  });
  it('候选数组不能借访问器或空槽成为授权名称', () => {
    let called = false; const names: string[] = Array(1);
    expect(() => plan(build(empty()), 'db', names)).toThrow();
    Object.defineProperty(names, '0', { get() { called = true; return 'fk'; } });
    expect(() => plan(build(empty()), 'db', names)).toThrow(); expect(called).toBe(false);
  });
  it.each([0, 1, '0', '1'] as const)('仅明确数字或精确十进制 %s 可作为布尔证明', matched => {
    const value = ready(); expect(merge(value, replies(value, matched)).get('new_fk')).toBe(Number(matched) === 1 ? 'conflict' : 'available');
  });
  it.each([2, -1, true, false, null, '01', 'true', '', undefined])('异常比较值 %s 保持 unknown', matched => {
    const value = ready(), response = replies(value); response[0].rows = [{ candidateOrdinal: 0, matched }];
    expect(merge(value, response).get('new_fk')).toBe('unknown');
  });
  it.each([
    ['缺失', (x: ForeignKeyNameComparisonReply[]) => x.pop()],
    ['额外 query id', (x: ForeignKeyNameComparisonReply[]) => x.push({ id: 'unexpected', rows: [] })],
    ['重复 query id', (x: ForeignKeyNameComparisonReply[]) => x.push(x[0])],
    ['越界序号', (x: ForeignKeyNameComparisonReply[]) => { x[0].rows = [{ candidateOrdinal: 2, matched: 0 }]; }],
    ['缺少行', (x: ForeignKeyNameComparisonReply[]) => { x[0].rows = []; }],
    ['额外字段', (x: ForeignKeyNameComparisonReply[]) => { x[0].rows = [{ candidateOrdinal: 0, matched: 0, extra: true }]; }],
  ] as const)('%s 回复不得宣布可用', (_, mutate) => {
    const value = ready(), response = replies(value); mutate(response); expect(merge(value, response).get('new_fk')).toBe('unknown');
  });
  it('多候选重复 ordinal 拒绝全批；多批迟到缺失不能被前批结果掩盖', () => {
    const value = ready(fixture(), ['a', 'b']), response = replies(value);
    response[0].rows = [{ candidateOrdinal: 0, matched: 0 }, { candidateOrdinal: 0, matched: 0 }];
    expect([...merge(value, response).values()]).toEqual(['unknown', 'unknown']);
    const batches = ready(many(65)), incomplete = replies(batches, 1).slice(0, -1);
    expect(merge(batches, incomplete).get('new_fk')).toBe('unknown');
  });
  it('回复数据属性不调用 getter，空目录额外回复也不能污染初始证明', () => {
    const value = ready(), response = replies(value); let calls = 0;
    Object.defineProperty(response[0], 'rows', { get() { calls++; return []; } });
    expect(merge(value, response).get('new_fk')).toBe('unknown'); expect(calls).toBe(0);
    const vacuous = ready(empty()); expect(merge(vacuous, [{ id: 'extra', rows: [] }]).get('new_fk')).toBe('unknown');
  });
});
