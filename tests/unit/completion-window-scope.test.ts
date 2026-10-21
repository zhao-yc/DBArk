import{describe,it,expect,vi}from'vitest';
import{analyzeCompletion,type CompletionAnalysisReady}from'../../src/shared/completionAnalysis';
import{completionSuggestions}from'../../src/renderer/completionSuggestions';
import type{CompletionDirectoryRequest}from'../../src/shared/sqlCompletion';
import{SessionObjects}from'../../src/engine/sessionObjects';
import{SessionCompletionDirectory}from'../../src/renderer/sessionCompletionDirectory';

/** 真实解析器提供作用域；仅目录读取使用可检查的替身，不模拟语义结果。 */
function analyze(marked:string):CompletionAnalysisReady{const result=analyzeCompletion(marked.replace('|',''),marked.indexOf('|'),{},{windowFunctions:true});expect(result.status).toBe('ready');if(result.status!=='ready')throw Error('分析未就绪');return result;}
function directory(){return{load:vi.fn(async(query:CompletionDirectoryRequest)=>({entries:query.kind==='columns'?[{name:query.table==='users'?'user_value':'order_value',kind:'column' as const}]:[],incomplete:false}))};}

describe('普通SELECT窗口字段作用域',()=>{
  it.each(['PARTITION BY','ORDER BY'])('内联%s仅从当前CTE投影插入字段',async clause=>{const a=analyze(`WITH q AS(SELECT 1 AS value_col) SELECT ROW_NUMBER() OVER(${clause} val|suffix) FROM q`),d=directory(),r=await completionSuggestions(a,undefined,d);expect(r.items).toContainEqual({label:'value_col',kind:'column',insertText:'`q`.`value_col`',detail:'q · 公共表表达式'});expect(a.outputAliases).toBeUndefined();expect(d.load).not.toHaveBeenCalled();});
  it.each(['PARTITION BY','ORDER BY'])('命名WINDOW的%s保留限定来源与完整替换范围',async clause=>{const marked=`SELECT ROW_NUMBER() OVER w FROM (SELECT 1 AS value_col)d WINDOW w AS (${clause} d.val|suffix)`,a=analyze(marked),d=directory(),r=await completionSuggestions(a,undefined,d);expect(a.target).toMatchObject({start:marked.indexOf('val|'),end:marked.indexOf('val|')+'valsuffix'.length,qualifiers:['d']});expect(r.items.some(item=>item.insertText==='`value_col`')).toBe(true);expect(a.relations.map(item=>item.name)).toEqual(['d']);expect(d.load).not.toHaveBeenCalled();});
  it('多个独立命名窗口仍读取本块真实关系',async()=>{const a=analyze('SELECT ROW_NUMBER() OVER w2 FROM db.users u WINDOW w1 AS(PARTITION BY u.id),w2 AS(ORDER BY u.use|suffix)'),d=directory(),r=await completionSuggestions(a,'ignored',d);expect(r.items.some(item=>item.insertText==='`user_value`')).toBe(true);expect(d.load.mock.calls.map(([query])=>query)).toEqual([{kind:'columns',database:'db',table:'users',prefix:'use'}]);});
  it('限定保留字字段和带点引用窗口名不会变成帧或另一层关系',()=>{expect(analyze('SELECT ROW_NUMBER() OVER(ORDER BY u.rows,u.|) FROM users u').relations).toMatchObject([{name:'u',table:'users'}]);expect(analyze('SELECT ROW_NUMBER() OVER `w.一` FROM users u WINDOW `w.一` AS(ORDER BY u.|)').relations).toMatchObject([{name:'u',table:'users'}]);});
  it.each(['PARTITION BY','ORDER BY'])('外层ORDER BY不能把输出别名泄露进OVER的%s',async clause=>{const a=analyze(`SELECT u.id AS output_alias FROM users u ORDER BY SUM(u.id) OVER(${clause} out|suffix)`),r=await completionSuggestions(a,'db',directory());expect(a.outputAliases).toBeUndefined();expect(r.items.some(item=>item.insertText==='`output_alias`')).toBe(false);});
  it.each(['PARTITION BY','ORDER BY'])('窗口中不把同名物理字段当成输出别名：%s',async clause=>{const a=analyze(`SELECT u.id AS user_value,ROW_NUMBER() OVER(${clause} use|suffix) FROM users u`),r=await completionSuggestions(a,'db',directory());expect(r.items.some(item=>item.insertText==='`u`.`user_value`')).toBe(true);expect(r.items.some(item=>item.detail==='SELECT 输出别名')).toBe(false);});
  it.each(['ORDER BY','GROUP BY','HAVING'])('命名窗口不改变%s的原有输出别名规则',async clause=>{const tail=clause==='ORDER BY'?`WINDOW w AS(ORDER BY u.id) ${clause} out|suffix`:`${clause} out|suffix WINDOW w AS(ORDER BY u.id)`,a=analyze(`SELECT u.id AS output_alias,ROW_NUMBER() OVER w AS ranking FROM users u ${tail}`),r=await completionSuggestions(a,'db',directory());expect(r.items.some(item=>item.insertText==='`output_alias`')).toBe(true);});
  it('内层别名遮蔽外层，兄弟UNION分支不混入窗口来源',()=>{const a=analyze('SELECT 1 FROM users u WHERE EXISTS(SELECT ROW_NUMBER() OVER(ORDER BY u.|) FROM orders u)');expect(a.relations).toMatchObject([{name:'u',table:'orders'}]);const b=analyze('SELECT 1 FROM users u UNION ALL SELECT ROW_NUMBER() OVER(ORDER BY o.|) FROM orders o');expect(b.relations.map(item=>item.name)).toEqual(['o']);});
  it.each([
    'SELECT 1 FROM users u JOIN (SELECT ROW_NUMBER() OVER(ORDER BY |) FROM orders o)d',
    'WITH q AS(SELECT ROW_NUMBER() OVER w FROM orders o WINDOW w AS(ORDER BY |)) SELECT * FROM users u,q',
    'SELECT 1 FROM users u JOIN (SELECT ROW_NUMBER() OVER w FROM orders o WINDOW w AS(PARTITION BY |))d',
  ])('普通派生表与CTE窗口不捕获外层别名：%s',source=>{expect(analyze(source).relations.map(item=>item.name)).toEqual(['o']);});
  it.each([
    'SELECT ROW_NUMBER() OVER(base ORDER BY u.|) FROM users u',
    'SELECT ROW_NUMBER() OVER w FROM users u WINDOW base AS(ORDER BY u.id),w AS(base ORDER BY u.|)',
  ])('未知或覆盖排序的继承窗口不猜字段：%s',marked=>{expect(analyzeCompletion(marked.replace('|',''),marked.indexOf('|'),{},{windowFunctions:true})).toMatchObject({status:'blocked'});});
  it.each([
    'SELECT ROW_NUMBER() OVER(ORDER BY u.id ROWS | PRECEDING) FROM users u',
    'SELECT ROW_NUMBER() OVER(ORDER BY u.id RANGE BETWEEN | PRECEDING AND CURRENT ROW) FROM users u',
  ])('帧边界只提供完整UNBOUNDED关键字，不猜字段：%s',async marked=>{const a=analyze(marked),d=directory(),r=await completionSuggestions(a,'db',d);expect(a).toMatchObject({syntax:[],relations:[],keywords:['UNBOUNDED']});expect(r.items.map(item=>item.insertText)).toEqual(['UNBOUNDED']);expect(d.load).not.toHaveBeenCalled();});
  it('窗口子查询自己的ORDER仍能使用自己的输出别名',()=>{const a=analyze('SELECT u.id AS outer_alias FROM users u ORDER BY SUM(u.id) OVER(ORDER BY (SELECT 1 AS inner_alias ORDER BY inn|suffix))');expect(a.outputAliases?.aliases).toEqual(['inner_alias']);});
  it('已取消窗口补全不读取目录，不改变目录预算',async()=>{const d=directory(),controller=new AbortController();controller.abort();const r=await completionSuggestions(analyze('SELECT ROW_NUMBER() OVER(ORDER BY u.|) FROM users u'),'db',d,controller.signal);expect(r.items).toEqual([]);expect(d.load).not.toHaveBeenCalled();});
  it.each([
    'SELECT u.id FROM users u UNION ALL SELECT o.id FROM orders o ORDER BY SUM(id) OVER(ORDER BY out|suffix)',
    'SELECT u.id FROM users u UNION ALL SELECT o.id FROM orders o ORDER BY SUM(id) OVER(PARTITION BY o.ord|suffix)',
    '(SELECT u.id FROM users u) UNION ALL (SELECT o.id FROM orders o) ORDER BY SUM(id) OVER(ORDER BY out|suffix)',
    'SELECT u.id FROM users u UNION SELECT o.id FROM orders o ORDER BY SUM(id) OVER(ORDER BY |)',
  ])('集合全局ORDER内窗口保守停止，不借末分支字段或函数目录：%s',async marked=>{const a=analyzeCompletion(marked.replace('|',''),marked.indexOf('|'),{},{windowFunctions:true}),d=directory();if(a.status==='ready')await completionSuggestions(a,'db',d);expect(d.load).not.toHaveBeenCalled();expect(a.status).toBe('blocked');});
  it.each([
    ['SELECT ROW_NUMBER() OVER(ORDER BY u.use|suffix) FROM users u UNION ALL SELECT o.id FROM orders o','users','`user_value`'],
    ['SELECT u.id FROM users u UNION ALL SELECT ROW_NUMBER() OVER(ORDER BY o.ord|suffix) FROM orders o','orders','`order_value`'],
    ['SELECT u.id FROM users u UNION ALL (SELECT o.id FROM orders o ORDER BY SUM(o.id) OVER(ORDER BY o.ord|suffix) LIMIT 1)','orders','`order_value`'],
  ])('集合各分支自身窗口继续使用正确关系：%s',async(marked,table,insert)=>{const a=analyze(marked),d=directory(),r=await completionSuggestions(a,'db',d);expect(r.items.some(item=>item.insertText===insert)).toBe(true);expect(d.load.mock.calls.map(([query])=>query)).toEqual([{kind:'columns',database:'db',table,prefix:table==='users'?'use':'ord'}]);});
  it('帧之前的字段表达式继续补全，不把整个带帧窗口清空',async()=>{const d=directory(),r=await completionSuggestions(analyze('SELECT ROW_NUMBER() OVER(ORDER BY u.use|suffix ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM users u'),'db',d);expect(r.items.some(item=>item.insertText==='`user_value`')).toBe(true);expect(d.load.mock.calls.map(([query])=>query)).toEqual([{kind:'columns',database:'db',table:'users',prefix:'use'}]);});
  it('执行后未知会话来源先停止字段回退，显式确认该名称后窗口字段才恢复',async()=>{
    const catalog=new SessionObjects(0),a=analyze('SELECT s.id,ROW_NUMBER() OVER(ORDER BY amo|suffix) AS ranking FROM window_subject s ORDER BY s.id'),permanent={load:vi.fn(async(query:CompletionDirectoryRequest)=>({entries:query.kind==='columns'?[{name:'amount',kind:'column' as const}]:[],incomplete:false}))};
    const suggest=()=>completionSuggestions(a,'db',new SessionCompletionDirectory(permanent,async query=>catalog.completion(query),catalog.revision));
    expect((await suggest()).items.some(item=>item.insertText==='`s`.`amount`')).toBe(true);permanent.load.mockClear();
    catalog.observe('SELECT s.id,ROW_NUMBER() OVER(PARTITION BY s.`category` ORDER BY s.id) AS ranking FROM window_subject s ORDER BY s.id','db',{ansiQuotes:false,noBackslashEscapes:false},'mysql');
    const stopped=await suggest();expect(stopped.sessionUncertain).toBe(true);expect(stopped.items.some(item=>item.label==='amount')).toBe(false);expect(permanent.load.mock.calls.some(([query])=>query.kind==='columns')).toBe(false);
    // 对应真实“会话临时对象→读取会话结构”确认结果，不把未知目录自动标记可靠。
    catalog.confirm('db','window_subject',null);expect((await suggest()).items.some(item=>item.insertText==='`s`.`amount`')).toBe(true);
  });
  it.each([
    ['SELECT ROW_NUMBER() OVER(ORDER BY u.id ROWS BETWEEN UNBOUNDED PRECEDING AND CUR|RENT ROW) FROM users u','CURRENT'],
    ['SELECT ROW_NUMBER() OVER(ORDER BY u.id ROWS BETWEEN UNB|OUNDED PRECEDING AND CURRENT ROW) FROM users u','UNBOUNDED'],
    ['SELECT ROW_NUMBER() OVER(ORDER BY u.id ROWS BETWEEN 1 PRE|CEDING AND CURRENT ROW) FROM users u','PRECEDING'],
    ['SELECT ROW_NUMBER() OVER(ORDER BY u.id ROWS BETWEEN CEI|L(2) PRECEDING AND CURRENT ROW) FROM users u',undefined],
    ['SELECT ROW_NUMBER() OVER(ORDER BY u.id ROWS BETWEEN 1 PRECEDING AND u.use|suffix FOLLOWING) FROM users u',undefined],
    ['SELECT ROW_NUMBER() OVER(ORDER BY u.id ROW|S BETWEEN 1 PRECEDING AND CURRENT ROW) FROM users u','ROWS'],
    ['SELECT ROW_NUMBER() OVER w FROM users u WINDOW w AS(ORDER BY u.id RANGE BETWEEN UNBOUNDED PRECEDING AND CUR|RENT ROW)','CURRENT'],
    ['SELECT ROW_NUMBER() OVER(ORDER BY u.id ROWS BETWEEN (SELECT 1 AS inner_alias ORDER BY inn|suffix) PRECEDING AND CURRENT ROW) FROM users u',undefined],
  ] as const)('帧位置不请求字段或函数目录：%s',async(marked,keyword)=>{const a=analyzeCompletion(marked.replace('|',''),marked.indexOf('|'),{},{windowFunctions:true}),d=directory();if(a.status==='ready')await completionSuggestions(a,'db',d);expect(d.load).not.toHaveBeenCalled();if(keyword)expect(a).toMatchObject({status:'ready',syntax:[],relations:[],keywords:[keyword]});else expect(a.status).toBe('blocked');});
});
