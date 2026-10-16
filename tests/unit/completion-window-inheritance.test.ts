import { describe, expect, it, vi } from 'vitest';
import { analyzeCompletion, type CompletionAnalysisReady } from '../../src/shared/completionAnalysis';
import { completionSuggestions } from '../../src/renderer/completionSuggestions';
import type { CompletionDirectoryRequest } from '../../src/shared/sqlCompletion';

/** 运行真实解析器到实际建议生成；只有目录结果替换为可核对的只读夹具。 */
function analyze(marked: string): CompletionAnalysisReady {
  const result = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'),{},{windowFunctions:true});
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error('继承窗口分析未就绪');
  return result;
}
/** 目录仅返回固定名称，完整目标和调用数由各用例核对。 */
function directory() { return { load: vi.fn(async (request: CompletionDirectoryRequest) => ({ entries: request.kind === 'columns' ? [{ name: 'value_col', kind: 'column' as const }] : [], incomplete: false })) }; }

describe('Q01命名窗口继承ORDER字段有界切片', () => {
  it.each([
    'WITH q AS(SELECT 1 AS value_col) SELECT SUM(value_col) OVER(base ORDER BY val|suffix) FROM q WINDOW base AS()',
    'WITH q AS(SELECT 1 AS value_col) SELECT SUM(value_col) OVER(base ORDER BY q.val|suffix) FROM q WINDOW base AS(PARTITION BY value_col)',
    'WITH q AS(SELECT 1 AS value_col) SELECT SUM(value_col) OVER child FROM q WINDOW base AS(PARTITION BY value_col),child AS(base ORDER BY val|suffix)',
    'WITH q AS(SELECT 1 AS value_col) SELECT SUM(value_col) OVER(base ORDER BY val|suffix) FROM q WINDOW previous AS(PARTITION BY value_col),base AS(previous)',
  ])('本块已定义空/分区窗口及引用链使用真实CTE投影：%s', async marked => {
    const a = analyze(marked), d = directory(), r = await completionSuggestions(a, undefined, d);
    expect(r.items.some(item => item.label === 'value_col' && item.insertText === (a.target.qualifiers.length ? '`value_col`' : '`q`.`value_col`'))).toBe(true);
    expect(d.load).not.toHaveBeenCalled(); expect(a.outputAliases).toBeUndefined();
    expect(marked.replace('|', '').slice(a.target.start, a.target.end)).toBe('valsuffix');
  });
  it('已知物理来源仍走原有惰性目录及完整Monaco替换范围', async () => {
    const marked = 'SELECT SUM(u.value_col) OVER(base ORDER BY u.val|suffix) FROM db.users u WINDOW base AS(PARTITION BY u.id)', a = analyze(marked), d = directory();
    const r = await completionSuggestions(a, 'ignored', d);
    expect(r.items).toContainEqual({ label: 'value_col', kind: 'column', insertText: '`value_col`', detail: 'u · 字段' });
    expect(d.load.mock.calls.map(([query]) => query)).toEqual([{ kind: 'columns', database: 'db', table: 'users', prefix: 'val' }]);
    const source = marked.replace('|', ''); expect(source.slice(0, a.target.start) + '`value_col`' + source.slice(a.target.end)).toContain('OVER(base ORDER BY u.`value_col`)');
  });
  it('原来保守停止的同块命名窗口现已有明确正向对照', async () => {
    const a = analyze('SELECT ROW_NUMBER() OVER w FROM users u WINDOW base AS(),w AS(base ORDER BY u.|)'), d = directory();
    expect((await completionSuggestions(a, 'db', d)).items.some(item => item.insertText === '`value_col`')).toBe(true);
    expect(d.load.mock.calls.map(([query]) => query)).toEqual([{ kind: 'columns', database: 'db', table: 'users', prefix: '' }]);
  });
  it.each([
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(),BASE AS()',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(base)',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(next),next AS(base)',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(unknown)',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(next),next AS()',
    'SELECT SUM(u.id) OVER child FROM users u WINDOW child AS(base ORDER BY u.val|suffix),base AS()',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(ORDER BY u.id)',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(PARTITION BY u.id ORDER BY u.id)',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(ROWS UNBOUNDED PRECEDING)',
    'SELECT SUM(u.id) OVER(base PARTITION BY u.val|suffix) FROM users u WINDOW base AS()',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix ROWS 1 PRECEDING) FROM users u WINDOW base AS()',
    'SELECT SUM(u.id) OVER(`窗口` ORDER BY u.val|suffix) FROM users u WINDOW `窗口` AS()',
  ])('未知、重复、循环、覆盖属性及未支持形式停止且零目录：%s', async marked => {
    const a = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'),{},{windowFunctions:true}), d = directory();
    if (a.status === 'ready') await completionSuggestions(a, 'db', d);
    expect(a.status).toBe('blocked'); expect(d.load).not.toHaveBeenCalled();
  });
  it.each([
    'SELECT 1 FROM users u WINDOW base AS() UNION ALL SELECT SUM(o.id) OVER(base ORDER BY o.val|suffix) FROM orders o',
    'SELECT (SELECT SUM(o.id) OVER(base ORDER BY o.val|suffix) FROM orders o) FROM users u WINDOW base AS()',
    'WITH q AS(SELECT SUM(o.id) OVER(base ORDER BY o.val|suffix) FROM orders o) SELECT * FROM q WINDOW base AS()',
  ])('窗口名不能来自UNION兄弟、祖先或CTE外部：%s', marked => { expect(analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'),{},{windowFunctions:true}).status).toBe('blocked'); });
  it('内层窗口同名时只验证内层定义，不借外层安全定义绕过重复排序', () => {
    const marked = 'SELECT (SELECT SUM(o.id) OVER(base ORDER BY o.val|suffix) FROM orders o WINDOW base AS(ORDER BY o.id)) FROM users u WINDOW base AS()';
    expect(analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'),{},{windowFunctions:true}).status).toBe('blocked');
  });
  it('合法内层同名定义遮蔽外层，字段来源仍只属于当前普通派生表', async () => {
    const a = analyze('SELECT * FROM users u JOIN (SELECT SUM(o.id) OVER(base ORDER BY o.val|suffix) FROM orders o WINDOW base AS(PARTITION BY o.id))d WINDOW base AS(ORDER BY u.id)'), d = directory();
    expect(a.relations.map(item => item.name)).toEqual(['o']);
    await completionSuggestions(a, 'db', d);
    expect(d.load.mock.calls.map(([query]) => query)).toEqual([{ kind: 'columns', database: 'db', table: 'orders', prefix: 'val' }]);
  });
  it('窗口字段不泄露外层输出别名；窗口关闭后的外层ORDER保持原规则', () => {
    const a = analyze('SELECT u.id AS output_alias FROM users u WINDOW base AS() ORDER BY SUM(u.id) OVER(base ORDER BY out|suffix)');
    expect(a.outputAliases).toBeUndefined();
    const b = analyze('SELECT u.id AS output_alias,SUM(u.id) OVER child FROM users u WINDOW base AS(),child AS(base ORDER BY u.id) ORDER BY out|suffix');
    expect(b.outputAliases?.aliases).toContain('output_alias');
  });
  it.each(['base', '`base`', 'BASE'])('ASCII引用名称%s按同一窗口解析，限定保留字字段仍是字段', async reference => {
    const a = analyze(`SELECT SUM(u.id) OVER(${reference} ORDER BY u.val|suffix) FROM users u WINDOW base AS(PARTITION BY u.rows)`), d = directory();
    expect((await completionSuggestions(a, 'db', d)).items.some(item => item.insertText === '`value_col`')).toBe(true);
  });
  it.each([
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(),bad AS(',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS() WINDOW other AS()',
    'SELECT SUM(u.id) OVER(base ORDER BY u.id ORDER BY u.val|suffix) FROM users u WINDOW base AS()',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(next PARTITION BY u.id),next AS()',
    'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(PARTITION BY u.id ROWS 1 PRECEDING)',
  ])('不完整、重复子句和未支持叠加仍保守：%s', marked => {
    const result = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'),{},{windowFunctions:true});
    expect(result.status).toBe('blocked');
  });
  it('其它合法但未使用的命名窗口不阻止当前已证明目标', () => {
    const marked = 'SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS(PARTITION BY u.id),other AS(base)';
    expect(analyze(marked).relations).toMatchObject([{ name: 'u', table: 'users' }]);
  });
  it('既有Worker可克隆结果直接进入标准建议生成，不增加目录或执行协议', async () => {
    const a = structuredClone(analyze('WITH q AS(SELECT 1 AS value_col) SELECT SUM(value_col) OVER(base ORDER BY val|suffix) FROM q WINDOW base AS()')), d = directory();
    const result = await completionSuggestions(a, undefined, d);
    expect(result.items.some(item => item.insertText === '`q`.`value_col`')).toBe(true); expect(d.load).not.toHaveBeenCalled();
  });
  it('取消继续遵守原补全管道，不读取目录或交付窗口字段', async () => {
    const a = analyze('SELECT SUM(u.id) OVER(base ORDER BY u.val|suffix) FROM users u WINDOW base AS()'), d = directory(), controller = new AbortController();
    controller.abort(); expect((await completionSuggestions(a, 'db', d, controller.signal)).items).toEqual([]); expect(d.load).not.toHaveBeenCalled();
  });
  it('引用链超过已有深度预算时停止，不借未展开名称猜字段', () => {
    const definitions = Array.from({ length: 65 }, (_, index) => `w${index} AS(${index === 0 ? '' : 'w' + (index - 1)})`).join(',');
    const marked = `SELECT SUM(u.id) OVER(w64 ORDER BY u.val|suffix) FROM users u WINDOW ${definitions}`;
    expect(analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'),{},{windowFunctions:true}).status).toBe('blocked');
  });
});
