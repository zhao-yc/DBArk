import { describe, expect, it, vi } from 'vitest';
import { analyzeCompletion, type CompletionAnalysisReady } from '../../src/shared/completionAnalysis';
import { completionSuggestions } from '../../src/renderer/completionSuggestions';
import { completionLimits } from '../../src/shared/sqlCompletion';
import { completionCapabilitiesForServer } from '../../src/shared/completionCapabilities';
/** 使用父版真实分析器和候选生成；只有惰性目录是IO替身。 */
function analyze(marked: string, capabilities: any = { windowFunctions: true }) { return analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'), {}, capabilities); }

describe('命名窗口引用的本查询块作用域', () => {
  it('OVER后的候选仅为当前完整命名窗口，不借物理字段或函数目录', async () => {
    const result = analyze('SELECT ROW_NUMBER() OVER rece|suffix FROM sales s WINDOW recent AS(PARTITION BY s.region ORDER BY s.day)');
    expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error('分析未就绪');
    const directory = { load: vi.fn(async () => ({ entries: [{ name: 'recent_column', kind: 'column' as const }], incomplete: false })) };
    const suggestions = await completionSuggestions(result, 'db', directory);
    expect(suggestions.items).toEqual([{ label: 'recent', kind: 'alias', insertText: '`recent`', detail: '命名窗口' }]);
    expect(directory.load).not.toHaveBeenCalled();
  });
  it('已知MySQL5.7不提供新增窗口名称，不错误宣称服务器具备窗口能力', () => {
    const marked = 'SELECT ROW_NUMBER() OVER so|suffix FROM sales s WINDOW sorted AS(ORDER BY s.id)';
    expect(analyze(marked, completionCapabilitiesForServer('mysql', '5.7.44'))).toEqual({ status: 'blocked', reason: 'capability' });
  });
});

/** 名称位置完整返回本地符号，不能靠任何目录结果弥补错误作用域。 */
async function names(marked: string, expected: string[], mode = {}) {
  const analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'), mode, { windowFunctions: true });
  expect(analysis.status).toBe('ready'); if (analysis.status !== 'ready') throw Error('名称未就绪');
  expect(analysis.windowNames).toEqual(expected); expect(analysis.outputAliases).toBeUndefined(); expect(analysis.relations).toEqual([]);
  const directory = { load: vi.fn(async () => { throw Error('命名窗口不能请求目录'); }) };
  const result = await completionSuggestions(analysis, 'other', directory); expect(directory.load).not.toHaveBeenCalled();
  return { analysis, result };
}
async function blocked(marked: string, mode = {}, capabilities: any = { windowFunctions: true }) {
  const analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'), mode, capabilities), directory = { load: vi.fn(async () => ({ entries: [], incomplete: false })) };
  if (analysis.status === 'ready') await completionSuggestions(analysis, 'db', directory);
  expect(analysis.status).toBe('blocked'); expect(directory.load).not.toHaveBeenCalled();
}
describe('命名窗口完整范围、隔离和保守边界', () => {
  it.each([
    ['SELECT ROW_NUMBER() OVER | FROM sales s WINDOW first_win AS(),second_win AS(PARTITION BY s.id ORDER BY s.day)', ['first_win','second_win']],
    ['SELECT SUM(s.id) OVER ch|suffix FROM sales s WINDOW base AS(PARTITION BY s.id),child AS(base ORDER BY s.day),last_win AS(child)', ['base','child','last_win']],
    ['WITH q AS(SELECT 1 AS id) SELECT ROW_NUMBER() OVER w|suffix FROM q WINDOW w AS(ORDER BY id)', ['w']],
    ['WITH q AS(SELECT ROW_NUMBER() OVER in|suffix FROM sales s WINDOW inner_win AS()) SELECT * FROM q WINDOW outer_win AS()', ['inner_win']],
    ['SELECT * FROM sales s JOIN (SELECT ROW_NUMBER() OVER in|suffix FROM orders o WINDOW inner_win AS())d WINDOW outer_win AS()', ['inner_win']],
    ['SELECT (SELECT ROW_NUMBER() OVER in|suffix FROM orders o WINDOW inner_win AS()) FROM sales s WINDOW outer_win AS()', ['inner_win']],
    ['SELECT ROW_NUMBER() OVER left_win FROM sales s WINDOW left_win AS() UNION ALL SELECT ROW_NUMBER() OVER ri|suffix FROM orders o WINDOW right_win AS()', ['right_win']],
    ['SELECT ROW_NUMBER() OVER le|suffix FROM sales s WINDOW left_win AS() UNION ALL SELECT ROW_NUMBER() OVER right_win FROM orders o WINDOW right_win AS()', ['left_win']],
    ['SELECT s.id FROM sales s WINDOW sorted AS(ORDER BY s.id) ORDER BY ROW_NUMBER() OVER so|suffix', ['sorted']],
    ['SELECT 1 WINDOW outer_win AS(); SELECT ROW_NUMBER() OVER lo|suffix WINDOW local_win AS()', ['local_win']],
  ] as const)('仅当前查询块：%s', async (marked, expected) => { await names(marked, [...expected]); });
  it('替换完整右侧suffix，不带入SELECT输出别名', async () => {
    const marked='SELECT s.id AS recent_alias,ROW_NUMBER() OVER rece|suffix FROM sales s WINDOW recent AS(PARTITION BY s.id)',{analysis,result}=await names(marked,['recent']);
    expect(result.items.map(item=>item.label)).toEqual(['recent']);const source=marked.replace('|',''),item=result.items[0];expect(source.slice(0,analysis.target.start)+item.insertText+source.slice(analysis.target.end)).toBe('SELECT s.id AS recent_alias,ROW_NUMBER() OVER '+String.fromCharCode(96)+'recent'+String.fromCharCode(96)+' FROM sales s WINDOW recent AS(PARTITION BY s.id)');
  });
  it.each([
    'SELECT ROW_NUMBER() OVER ba|suffix FROM sales s',
    'SELECT ROW_NUMBER() OVER ba|suffix FROM sales s WINDOW base AS(),BASE AS()',
    'SELECT ROW_NUMBER() OVER ba|suffix FROM sales s WINDOW base AS(next),next AS()',
    'SELECT ROW_NUMBER() OVER ba|suffix FROM sales s WINDOW base AS(base)',
    'SELECT ROW_NUMBER() OVER ba|suffix FROM sales s WINDOW base AS(next),next AS(base)',
    'SELECT ROW_NUMBER() OVER ba|suffix FROM sales s WINDOW base AS(),',
    'SELECT ROW_NUMBER() OVER ba|suffix FROM sales s WINDOW base AS(PARTITION BY s.id,)',
    'SELECT ROW_NUMBER() OVER ba|suffix FROM sales s WINDOW base AS() WINDOW other AS()',
    'SELECT ROW_NUMBER() OVER ba|suffix FROM sales s WINDOW base AS(ORDER BY s.id),child AS(base ORDER BY s.day)',
    'SELECT ROW_NUMBER() OVER ba|suffix FROM sales s WINDOW base AS(),child AS(base PARTITION BY s.id)',
    'SELECT ROW_NUMBER() OVER ba|suffix FROM sales s WINDOW base AS(ORDER BY s.id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)',
    'SELECT ROW_NUMBER() OVER db.ba|suffix FROM sales s WINDOW base AS()',
    'SELECT ROW_NUMBER() OVER (ba|suffix) FROM sales s WINDOW base AS()',
    'SELECT 1 FROM sales s WHERE ROW_NUMBER() OVER ba|suffix WINDOW base AS()',
    'SELECT 1 FROM sales s HAVING ROW_NUMBER() OVER ba|suffix WINDOW base AS()',
    'SELECT 1 FROM sales s GROUP BY ROW_NUMBER() OVER ba|suffix WINDOW base AS()',
    'SELECT 1 FROM sales s WINDOW left_win AS() UNION ALL SELECT 2 FROM orders o WINDOW right_win AS() ORDER BY ROW_NUMBER() OVER ri|suffix',
    'SELECT 1 FROM sales s WINDOW outer_win AS() UNION ALL SELECT ROW_NUMBER() OVER ou|suffix FROM orders o',
    'SELECT (SELECT ROW_NUMBER() OVER ou|suffix FROM orders o) FROM sales s WINDOW outer_win AS()',
  ])('不猜名称或父/兄弟作用域，不读目录：%s', async marked => blocked(marked));
  it.each([{}, {windowFunctions:false}, {windowFunctions:'true'}])('窗口名称能力缺省/关闭/非布尔不开放：%j', async cap=>blocked('SELECT ROW_NUMBER() OVER ba|suffix FROM sales s WINDOW base AS()',{},cap));
  it('预算不扩张，也不把SQL字面量带出worker', async () => {
    const text='SELECT ROW_NUMBER() OVER w|suffix WINDOW '+Array.from({length:completionLimits.entries+1},(_,i)=>'w'+i+' AS()').join(','); await blocked(text);
    const result=analyze("SELECT ROW_NUMBER() OVER w|suffix FROM sales s WINDOW w AS(ORDER BY COALESCE(s.id,'合成敏感值'))");expect(JSON.stringify(result)).not.toContain('合成敏感值');
  });
  it('已取消的本地窗口建议不交付，也不访问目录', async () => { const a=analyze('SELECT ROW_NUMBER() OVER w|suffix WINDOW w AS()'); if(a.status!=='ready')throw Error('分析未就绪');const abort=new AbortController();abort.abort();const directory={load:vi.fn()};expect((await completionSuggestions(a,undefined,directory,abort.signal)).items).toEqual([]);expect(directory.load).not.toHaveBeenCalled(); });
});

describe('已核验服务器的窗口能力门槛',()=>{
  it.each([
    ['mysql','5.7.44',false],['mysql','8.0.1',false],['mysql','8.0.2',true],['mysql','8.0.46',true],['mysql','8.4.11-log',true],['mysql','8.0.46-TiDB',false],['mysql','9.0.1',false],
    ['mariadb','10.1.48-MariaDB',false],['mariadb','10.2.44-MariaDB',true],['mariadb','5.5.5-10.11.19-MariaDB-0+deb12u2',true],['mariadb','11.4.13-MariaDB',true],['mariadb','12.3.2-MariaDB',false],['mariadb','11.4.13-Other',false],['mysql','11.4.13-MariaDB',false],[undefined,'8.4.11',false],['mysql',undefined,false],
  ] as const)('%s %s 窗口能力=%s',(dialect,version,expected)=>expect(completionCapabilitiesForServer(dialect,version).windowFunctions).toBe(expected));
});

describe('命名窗口引号和模式', () => {
  it.each([
    { ansiQuotes: false, noBackslashEscapes: false }, { ansiQuotes: false, noBackslashEscapes: true },
    { ansiQuotes: true, noBackslashEscapes: false }, { ansiQuotes: true, noBackslashEscapes: true },
  ])('反引号中的点号/美元符号不成为目录限定：%j', async mode => {
    const marked = "SELECT ROW_NUMBER() OVER `w.o|suffix` FROM sales s WINDOW `w.ord$` AS(ORDER BY s.id)";
    const { analysis, result } = await names(marked, ['w.ord$'], mode);
    expect(analysis.target.qualifiers).toEqual([]); expect(result.items[0].insertText).toBe('`w.ord$`');
    const source = marked.replace('|', ''); expect(source.slice(0, analysis.target.start) + result.items[0].insertText + source.slice(analysis.target.end)).toBe("SELECT ROW_NUMBER() OVER `w.ord$` FROM sales s WINDOW `w.ord$` AS(ORDER BY s.id)");
  });
  it('名称内的反引号仍转成普通插入文本，不成为片段占位符', async () => {
    const { result } = await names("SELECT ROW_NUMBER() OVER `w|suffix` WINDOW `w``ord$` AS()", ['w`ord$']);
    expect(result.items[0].insertText).toBe('`w``ord$`'); expect(result.items[0].trigger).toBeUndefined();
  });
  it('ANSI_QUOTES明确时双引号是名称，未知模式不猜', async () => {
    const marked = 'SELECT ROW_NUMBER() OVER "win|suffix" WINDOW "window_one" AS()';
    const { result } = await names(marked, ['window_one'], { ansiQuotes: true, noBackslashEscapes: true }); expect(result.items[0].insertText).toBe('`window_one`');
    await blocked(marked); await blocked(marked, { ansiQuotes: false, noBackslashEscapes: true });
  });
  it('不把未知Unicode比较规则或未闭合的列表当可靠名称', async () => {
    await blocked('SELECT ROW_NUMBER() OVER w| WINDOW `窗口` AS()');
    await blocked('SELECT ROW_NUMBER() OVER w| WINDOW w AS(');
  });
  it('字段中的保留字不变成窗口属性或帧', async () => { await names('SELECT ROW_NUMBER() OVER w| FROM sales s WINDOW w AS(PARTITION BY s.rows ORDER BY s.order)', ['w']); });
});

describe('集合括号与输出别名补充边界', () => {
  it('括号内UNION分支的ORDER只取该分支窗口', async () => {
    await names('SELECT 1 WINDOW left_win AS() UNION ALL (SELECT 2 WINDOW right_win AS() ORDER BY ROW_NUMBER() OVER ri|suffix LIMIT 1)', ['right_win']);
  });
  it('括号集合后的全局ORDER不借末分支WINDOW', async () => {
    await blocked('(SELECT 1 WINDOW left_win AS()) UNION ALL (SELECT 2 WINDOW right_win AS()) ORDER BY ROW_NUMBER() OVER ri|suffix');
  });
  it('WHERE不获得窗口名或当前SELECT输出别名，派生输出在外层仍可见', () => {
    const where = analyze('SELECT id AS output_alias,ROW_NUMBER() OVER win AS ranking FROM sales WHERE out|suffix=1 WINDOW win AS()');
    expect(where.status).toBe('ready'); if (where.status === 'ready') { expect(where.outputAliases).toBeUndefined(); expect(where.windowNames).toBeUndefined(); }
    const outer = analyze('SELECT q.rank|suffix FROM (SELECT ROW_NUMBER() OVER win AS ranking WINDOW win AS()) q');
    expect(outer.status).toBe('ready'); if (outer.status === 'ready') expect(outer.relations).toMatchObject([{ name: 'q', columns: ['ranking'] }]);
  });
  it('缺省窗口能力仍阻断新增窗口名称，不向目录泄露未知版本假设', async () => {
    await blocked('SELECT ROW_NUMBER() OVER so|suffix FROM sales s WINDOW sorted AS(ORDER BY s.id)', {}, {});
  });
});
