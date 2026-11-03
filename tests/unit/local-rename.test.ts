import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { analyzeMysqlLocalRename } from '../../src/shared/mysqlLocalRename';
import { analyzeSqliteLocalRename } from '../../src/shared/sqliteLocalRename';
import { quoteLocalRename, validLocalRename, type LocalRename } from '../../src/shared/localRename';
import { sqliteReferenceContext } from '../../src/shared/sqliteCompletionAnalysis';

/** 只应用生产返回的范围，独立核对准确SQL文本及SQLite真实查询结果。 */
function apply(source: string, result: LocalRename) {
  expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error('未确认重命名');
  for (const edit of [...result.edits].reverse()) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}
for (const [dialect, analyze] of [['mysql', analyzeMysqlLocalRename], ['sqlite', (source: string, offset: number, _mode: {}, _caps: {}, name?: string) => analyzeSqliteLocalRename(source, offset, name)]] as const) {
  it.each([
    ['SELECT |s.id, s.name FROM subject AS s WHERE s.id=1', 'alias'],
    ['SELECT |s.id FROM subject s WHERE s.id>0', 'alias'],
    ['SELECT |d.id FROM (SELECT id FROM subject) AS d', 'alias'],
    ['WITH |q AS (SELECT id FROM subject) SELECT q.id FROM q', 'cte'],
    ['WITH RECURSIVE |q(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM q WHERE n<3) SELECT q.n FROM q', 'cte'],
    ['WITH |q(n) AS (SELECT 1), r AS (SELECT n FROM q) SELECT q.n FROM q JOIN r ON 1=1', 'cte'],
    ['SELECT |s.id,(SELECT s.id FROM child c) FROM subject s', 'alias'],
    ['SELECT |s.id FROM subject s UNION ALL SELECT t.id FROM child t', 'alias'],
    ['SELECT t.id FROM child t; SELECT |s.id FROM subject s', 'alias'],
    ["SELECT |s.id,'s.id' FROM subject s /* s.id */ WHERE s.id=1", 'alias'],
  ])('%s准备与完整引用修改：%s', (marked, kind) => {
    const source = marked.replace('|', ''), offset = marked.indexOf('|'), prepare = analyze(source, offset, {}, {});
    expect(prepare).toMatchObject({ status: 'ready', kind, edits: [] });
    const changed = analyze(source, offset, {}, {}, 'next alias');
    const quoted = dialect === 'sqlite' ? '"next alias"' : '`next alias`';
    const expected = source.replace(/\bs(?=\.)|(?<=subject (?:AS )?)s\b|\bd(?=\.)|(?<=AS )d\b|\bq\b/g, word => word === (source[offset] === 'd' ? 'd' : source[offset] === 'q' ? 'q' : 's') ? quoted : word);
    // 注释和字符串不得跟随普通全文替换；只核实际标识符及其位置。
    const output = apply(source, changed);
    expect(output).toContain(quoted); expect(changed.status === 'ready' && changed.edits.length).toBeGreaterThanOrEqual(2);
    if (!source.includes("'s.id'") && !source.includes('/*')) expect(output).toBe(expected);
    else { expect(output).toContain("'s.id'"); expect(output).toContain('/* s.id */'); }
    if (dialect === 'sqlite') expect(validLocalRename(changed, sqliteReferenceContext(source, offset), dialect, 'next alias')).toBe(true);
  });
  it.each([
    'SELECT |subject.id FROM subject',
    'SELECT |s.id FROM subject s WHERE s=1',
    'SELECT |s.id,(SELECT s.id FROM child s) FROM subject s',
    'SELECT |s.id FROM subject s WHERE s.f()=1',
    'SELECT |s.id FROM subject s JOIN other s ON 1=1',
    "SELECT '|s.id' FROM subject s", 'SELECT |id FROM subject',
  ])('%s拒绝物理表／字段／不完整同名组：%s', marked => {
    expect(analyze(marked.replace('|', ''), marked.indexOf('|'), {}, {}, 'renamed').status).toBe('blocked');
  });
  it.each(['subject', 'other', 'T', 'id'])('%s拒绝捕获已有名称%s', name => {
    const source = 'SELECT s.id,t.id FROM subject s JOIN other t ON s.id=t.id';
    expect(analyze(source, 7, {}, {}, name)).toEqual({ status: 'blocked', reason: 'collision' });
  });
  it.each(['', ' ', 'a\0b', 'a\nb', '\ud800', 'x'.repeat(513)])('%s无效新名称不产生编辑', name => {
    expect(analyze('SELECT s.id FROM subject s', 7, {}, {}, name)).toMatchObject({ status: 'blocked', reason: 'name' });
  });
  it('%s同名无修改，引用字符作为单个名称引用', () => {
    const source = 'SELECT s.id FROM subject s';
    expect(analyze(source, 7, {}, {}, 's')).toMatchObject({ status: 'ready', edits: [] });
    const result = analyze(source, 7, {}, {}, 'a.`"b');
    expect(apply(source, result)).toBe(dialect === 'mysql' ? 'SELECT `a.``"b`.id FROM subject `a.``"b`' : 'SELECT "a.`""b".id FROM subject "a.`""b"');
  });
}
it('SQLite真实查询在ASCII混合引用、递归CTE和派生重命名后结果保持', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE subject(id INTEGER,name TEXT);INSERT INTO subject VALUES(1,\'甲\'),(2,\'乙\')');
    for (const marked of ['SELECT |s.id,S.name FROM subject "S" ORDER BY s.id', 'WITH RECURSIVE |Q(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM q WHERE n<3) SELECT q.n FROM Q', 'SELECT |d.id FROM (SELECT id FROM subject) d ORDER BY d.id']) {
      const source = marked.replace('|', ''), result = analyzeSqliteLocalRename(source, marked.indexOf('|'), '船🚢"新');
      expect(db.prepare(apply(source, result)).all()).toEqual(db.prepare(source).all());
    }
  } finally { db.close(); }
});
it('SQLite不同非ASCII名称不会误合并，ASCII相同的外部新名称冲突拒绝', () => {
  const source = 'SELECT "Ä".id,"ä".id FROM subject "Ä" JOIN other "ä" ON 1';
  expect(analyzeSqliteLocalRename(source, 8, 'x')).toMatchObject({ status: 'ready' });
  expect(analyzeSqliteLocalRename(source, 8, 'ä')).toMatchObject({ status: 'blocked', reason: 'collision' });
});
it('名称范围保持方言预算和Unicode边界', () => {
  expect(quoteLocalRename('船🚢', 'sqlite')).toBe('"船🚢"'); expect(quoteLocalRename('船🚢', 'mysql')).toBeUndefined();
  expect(quoteLocalRename('x'.repeat(256), 'mysql')).toBeDefined(); expect(quoteLocalRename('x'.repeat(257), 'mysql')).toBeUndefined();
  expect(quoteLocalRename('x'.repeat(512), 'sqlite')).toBeDefined();
  expect(analyzeMysqlLocalRename('WITH q AS (SELECT 1 n) SELECT q.n FROM q', 5, {}, {}, 'x'.repeat(65))).toMatchObject({ status: 'blocked', reason: 'name' });
  expect(analyzeMysqlLocalRename('SELECT s.id FROM subject s', 7, {}, {}, 'x'.repeat(256))).toMatchObject({ status: 'ready' });
});
it('严格回包拒绝跨句、部分编辑、任意正文、URI和扩展字段', () => {
  const source = 'SELECT s.id FROM subject s; SELECT s.id FROM other s', context = sqliteReferenceContext(source, 7), result = analyzeSqliteLocalRename(source, 7, 'next');
  expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error('缺少结果');
  for (const forged of [{ ...result, uri: 'file:///other' }, { ...result, edits: result.edits.slice(1) }, { ...result, edits: [...result.edits].reverse() }, { ...result, edits: result.edits.map(item => ({ ...item, text: 'DROP TABLE subject' })) }, { ...result, edits: [...result.edits, { start: source.lastIndexOf('s'), end: source.length, text: '"next"' }] }, { ...result, target: { ...result.target, sql: source } }]) expect(validLocalRename(forged, context, 'sqlite', 'next')).toBe(false);
});
