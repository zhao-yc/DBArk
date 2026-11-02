import { describe, expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, validateSqliteCompletionAnalysis } from '../../src/shared/sqliteCompletionAnalysis';
import type { SqliteCompletionLookup, SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
import { sqliteFieldHover } from '../../src/renderer/sqliteFieldHover';
import { sqliteFieldHoverZh as text } from '../../src/renderer/locales/sqliteFieldHover.zh-CN';

/** 原SQL的|仅是单元光标标记；使用真实SQLite分析，不借用MySQL或改写SQL。 */
function analyze(marked: string) {
  const offset = marked.indexOf('|'), source = marked.replace('|', ''); expect(offset).toBeGreaterThanOrEqual(0);
  const value = analyzeSqliteCompletion(source, offset, 'hover');
  expect(validateSqliteCompletionAnalysis(value, source, offset, 'hover')).toEqual(value);
  return value;
}
function directory(names = ['field_🚢']) {
  const load = vi.fn(async (query: SqliteCompletionLookup): Promise<SqliteCompletionOutput> => ({ entries: query.kind === 'columns' ? names.map(name => ({ kind: 'column', name, schema: query.schema ?? 'main', table: query.table, declaredType: 'INTEGER', generated: false, hidden: false })) : [], incomplete: false, stamp: '1:0' }));
  return { load };
}
async function hover(marked: string, port = directory()) { const analysis = analyze(marked); return { value: analysis.status === 'ready' ? await sqliteFieldHover(analysis, port) : undefined, analysis, port }; }

describe('SQLite字段悬停完整词法与准确目录', () => {
  it.each(['SELECT s.fi|eld_🚢 FROM subject s', 'SELECT s."fi|eld_🚢" FROM subject s', 'SELECT s.`fi|eld_🚢` FROM subject s', 'SELECT s.[fi|eld_🚢] FROM subject s'])('完整标识符而非光标前缀：%s', async marked => {
    const result = await hover(marked); expect(result.analysis).toMatchObject({ status: 'ready', target: { prefix: 'field_🚢' } }); expect(result.value).toContain('"field_🚢"'); expect(result.value).toContain(text.declaredType + '："INTEGER"'); expect(result.port.load.mock.calls[0][0]).toMatchObject({ kind: 'columns', table: 'subject', prefix: 'field_🚢' });
  });
  it.each(['SELECT -- fi|eld_🚢', "SELECT 'fi|eld_🚢' FROM subject", 'SELECT :fi|eld_🚢 FROM subject', 'SELECT 12|34 FROM subject', 'SEL|ECT field_🚢 FROM subject', 'SELECT COU|NT(field_🚢) FROM subject', 'SELECT s."fi|eld_🚢 FROM subject s', 'SELECT CAST(field_🚢 AS TE|XT) FROM subject', 'SELECT field_🚢 COLLATE no|case FROM subject'])('非字段不请求目录：%s', async marked => {
    const result = await hover(marked); expect(result.value).toBeUndefined(); expect(result.port.load).not.toHaveBeenCalled();
  });
  it.each(['SELECT id AS field_🚢 FROM subject ORDER BY fi|eld_🚢', 'SELECT id field_🚢 FROM subject WHERE fi|eld_🚢 > 0', 'SELECT id AS fi|eld_🚢 FROM subject', 'WITH c(fi|eld_🚢) AS (SELECT id FROM subject) SELECT * FROM c'])('输出别名／声明不伪装同名物理列：%s', async marked => {
    const result = await hover(marked); expect(result.value).toBeUndefined(); expect(result.port.load).not.toHaveBeenCalled();
  });
  it('显式限定仍可解析真实列，不把另一个输出别名套到它', async () => {
    expect((await hover('SELECT id AS field_🚢, s.fi|eld_🚢 FROM subject s')).value).toContain(text.declaredType);
  });
  it('进入相关子查询或CTE体后只检查活动层别名，不借外层别名压制内层真实列', async () => {
    for (const sql of ['SELECT 1 AS field_🚢 FROM outer_table WHERE EXISTS(SELECT fi|eld_🚢 FROM subject)', 'WITH c AS (SELECT fi|eld_🚢 FROM subject) SELECT 1 AS field_🚢 FROM c']) {
      const result = await hover(sql); expect(result.value).toContain(text.declaredType); expect(result.port.load.mock.calls[0][0]).toMatchObject({ table: 'subject' });
    }
  });
  it('相关子查询仅在内层不存在字段时回退外层；内层歧义不能借外层消歧', async () => {
    const port = directory(); port.load.mockImplementation(async query => ({ entries: query.kind === 'columns' && query.table !== 'inner_table' ? [{ kind: 'column', schema: 'main', table: query.table, name: 'field_🚢', declaredType: 'TEXT', generated: false, hidden: false }] : [], incomplete: false, stamp: '1:0' }));
    const result = await hover('SELECT 1 FROM outer_table o WHERE EXISTS(SELECT fi|eld_🚢 FROM inner_table i)', port);
    expect(result.value).toContain('"outer_table"'); expect(port.load.mock.calls.map(([q]) => q.kind === 'columns' ? q.table : q.kind)).toEqual(['inner_table', 'outer_table']);
    const ambiguous = directory(); expect((await hover('SELECT 1 FROM outer_table o WHERE EXISTS(SELECT fi|eld_🚢 FROM inner_first a JOIN inner_second b ON a.id=b.id)', ambiguous)).value).toBeUndefined();
    expect(ambiguous.load.mock.calls.map(([q]) => q.kind === 'columns' ? q.table : q.kind)).toEqual(['inner_first', 'inner_second']);
  });
  it('悬停层级仅限悬停回包，不能放宽原键盘补全协议', () => {
    const source = 'SELECT s.field_name FROM subject s', offset = source.indexOf('field_name') + 2, value = analyzeSqliteCompletion(source, offset);
    expect(value.status).toBe('ready'); if (value.status !== 'ready') throw Error('缺少原补全分析'); value.relations[0].scopeDepth = 1;
    expect(() => validateSqliteCompletionAnalysis(value, source, offset)).toThrow();
  });
  it.each(['SELECT SUM(id) OVER wi|n FROM subject WINDOW win AS (ORDER BY id)', 'SELECT SUM(id) OVER win FROM subject WINDOW wi|n AS (ORDER BY id)'])('窗口名称不借同名字段目录：%s', async sql => {
    const result = await hover(sql); expect(result.value).toBeUndefined(); expect(result.port.load).not.toHaveBeenCalled();
  });
  it('准确完整名称匹配而非前缀，ASCII大小写折叠不扩展到Unicode', async () => {
    const port = directory(['FIELD_🚢', 'field_🚢_other']); expect((await hover('SELECT s.fi|eld_🚢 FROM subject s', port)).value).toContain('"FIELD_🚢"');
    expect((await hover('SELECT s.ä| FROM subject s', directory(['Ä']))).value).toBeUndefined();
  });
  it('遍历所有绑定后拒绝同名歧义，限定来源恢复；不完整目录不猜唯一', async () => {
    const port = directory(); expect((await hover('SELECT fi|eld_🚢 FROM first a JOIN second b ON a.id=b.id', port)).value).toBeUndefined(); expect(port.load).toHaveBeenCalledTimes(2);
    expect((await hover('SELECT b.fi|eld_🚢 FROM first a JOIN second b ON a.id=b.id')).value).toContain('"second"');
    const incomplete = directory(); incomplete.load.mockImplementation(async () => ({ entries: [], incomplete: true, stamp: '1:0' })); expect((await hover('SELECT fi|eld_🚢 FROM subject', incomplete)).value).toBeUndefined();
  });
  it('局部CTE／派生输出只展示本地来源及未知类型，不读取同名永久表', async () => {
    for (const sql of ['WITH subject(field_🚢) AS (SELECT 1) SELECT s.fi|eld_🚢 FROM subject s', 'SELECT s.fi|eld_🚢 FROM (SELECT 1 AS field_🚢) s']) {
      const result = await hover(sql); expect(result.value).toContain(text.unknown); expect(result.port.load).not.toHaveBeenCalled(); expect(result.value).not.toContain('INTEGER');
    }
  });
  it('显式schema与临时对象、生成隐藏标记按真实目录，不推断默认或存储类型', async () => {
    const port = directory(); port.load.mockImplementation(async query => ({ entries: query.kind === 'columns' ? [{ kind: 'column', schema: 'temp', table: query.table, name: 'field_🚢', declaredType: '', generated: true, hidden: true }] : [], incomplete: false, stamp: '1:0' }));
    const result = await hover('SELECT temp.subject.fi|eld_🚢 FROM temp.subject', port); expect(result.value).toContain(text.temporary); expect(result.value).toContain(text.noDeclaredType); expect(result.value).toContain(text.generated + '：是'); expect(result.value).toContain(text.hidden + '：是'); expect(result.value).toContain(text.dynamic); expect(port.load.mock.calls[0][0]).toMatchObject({ schema: 'temp' });
  });
  it('512单位名称完整核对，目录前缀不切坏代理对，也不放宽键盘补全预算', async () => {
    const name = 'a'.repeat(127) + '🚢' + 'b'.repeat(383), marked = 'SELECT s.' + name.slice(0, 2) + '|' + name.slice(2) + ' FROM subject s', port = directory([name]);
    const result = await hover(marked, port); expect(result.value).toContain(name); expect(port.load.mock.calls[0][0]).toMatchObject({ prefix: 'a'.repeat(127) });
    expect(analyzeSqliteCompletion('SELECT s.' + name + ' FROM subject s', 9 + name.length).status).toBe('blocked');
  });
  it('名称／类型内容始终为纯文本代码块，命令链接及HTML不活化', async () => {
    const name = 'field_🚢', port = directory(); port.load.mockImplementation(async query => ({ entries: query.kind === 'columns' ? [{ kind: 'column', schema: 'main', table: query.table, name, declaredType: '[open](command:run)\n<img src=x>', generated: false, hidden: false }] : [], incomplete: false, stamp: '1:0' }));
    const result = await hover('SELECT s.fi|eld_🚢 FROM subject s', port); expect(result.value!.split('\n').every(line => line.startsWith('    '))).toBe(true); expect(result.value).toContain('\\n<img');
  });
});
