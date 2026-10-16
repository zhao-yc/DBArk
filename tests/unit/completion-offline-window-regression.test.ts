import {describe,it,expect,vi} from 'vitest';
import {analyzeCompletion} from '../../src/shared/completionAnalysis';
import {completionSuggestions} from '../../src/renderer/completionSuggestions';
import {completionContextCapabilities} from '../../src/renderer/completionContext';
import {completionCapabilitiesForServer} from '../../src/shared/completionCapabilities';
import type {CompletionScopeCapabilities} from '../../src/shared/completionCapabilities';

/** 复用原正式UI的SQL及完整替换期望；真实无会话上下文不伪造服务器支持。 */
const cases=[
  ['OVER分区字段','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(PARTITION BY q.val|suffix) FROM q','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(PARTITION BY q.`value_column`) FROM q','value_column'],
  ['OVER排序字段','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(ORDER BY val|suffix) FROM q','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(ORDER BY `q`.`value_column`) FROM q','value_column'],
  ['WINDOW分区字段','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER w FROM q WINDOW w AS(PARTITION BY q.val|suffix)','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER w FROM q WINDOW w AS(PARTITION BY q.`value_column`)','value_column'],
  ['WINDOW排序字段','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY val|suffix)','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY `q`.`value_column`)','value_column'],
  ['窗口内部隔离输出别名','WITH q AS(SELECT 1 AS value_column) SELECT q.value_column AS value_illegal FROM q ORDER BY SUM(q.value_column) OVER(ORDER BY val|suffix)','WITH q AS(SELECT 1 AS value_column) SELECT q.value_column AS value_illegal FROM q ORDER BY SUM(q.value_column) OVER(ORDER BY `q`.`value_column`)','value_column'],
  ['窗口结束后的输出别名','WITH q AS(SELECT 1 AS value_column) SELECT q.value_column AS value_output,ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY q.value_column) ORDER BY value_o|suffix','WITH q AS(SELECT 1 AS value_column) SELECT q.value_column AS value_output,ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY q.value_column) ORDER BY `value_output`','value_output'],
  ['UNION当前分支','WITH q AS(SELECT 1 AS value_column) SELECT 1 UNION ALL SELECT ROW_NUMBER() OVER(ORDER BY q.val|suffix) FROM q','WITH q AS(SELECT 1 AS value_column) SELECT 1 UNION ALL SELECT ROW_NUMBER() OVER(ORDER BY q.`value_column`) FROM q','value_column'],
  ['括号UNION分支','WITH q AS(SELECT 1 AS value_column) SELECT 1 UNION ALL (SELECT q.value_column FROM q ORDER BY SUM(q.value_column) OVER(ORDER BY q.val|suffix) LIMIT 1)','WITH q AS(SELECT 1 AS value_column) SELECT 1 UNION ALL (SELECT q.value_column FROM q ORDER BY SUM(q.value_column) OVER(ORDER BY q.`value_column`) LIMIT 1)','value_column'],
  ['帧之前的合法字段','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(ORDER BY q.val|suffix ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM q','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(ORDER BY q.`value_column` ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM q','value_column'],
]as const;

/** 只替换惰性IO端口；分析、投影、建议与范围计算均使用产品真实代码。 */
async function pipeline(marked:string,capabilities:CompletionScopeCapabilities=completionContextCapabilities()){
  const source=marked.replace('|',''),analysis=analyzeCompletion(source,marked.indexOf('|'),{},capabilities),directory={load:vi.fn(async()=>{throw Error('本地CTE不能请求目录');})};
  const result=analysis.status==='ready'?await completionSuggestions(analysis,undefined,directory):undefined;
  expect(directory.load).not.toHaveBeenCalled();return{source,analysis,result};
}

describe('无服务器事实的原窗口字段真实管道回归',()=>{
  it.each(cases)('%s：保留完整suffix替换且零目录',async(_,marked,expected,label)=>{
    const {source,analysis,result}=await pipeline(marked);expect(analysis.status).toBe('ready');if(analysis.status!=='ready')throw Error('本地字段分析未就绪');
    const item=result!.items.find(item=>item.label===label);expect(item).toBeDefined();expect(result!.items.some(item=>item.label==='value_illegal')).toBe(false);
    expect(source.slice(0,analysis.target.start)+item!.insertText+source.slice(analysis.target.end)).toBe(expected);
  });
  it.each([
    'WITH a AS(SELECT 1 AS first_value),b AS(SELECT 2 AS later_value) SELECT a.first_value FROM a UNION ALL SELECT b.later_value FROM b ORDER BY SUM(first_value) OVER(ORDER BY lat|suffix)',
    'WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(ORDER BY q.value_column ROWS BETWEEN UNBOUNDED PRECEDING AND CUR|RENT ROW) FROM q',
    'WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY q.value_column RANGE BETWEEN UNBOUNDED PRECEDING AND CUR|RENT ROW)',
  ])('原全局集合与帧负例仍停止：%s',async marked=>{expect((await pipeline(marked)).analysis.status).toBe('blocked');});
  it('字段编辑不把已知5.7改成支持窗口执行',async()=>{
    const capabilities=completionCapabilitiesForServer('mysql','5.7.44');
    const result=await pipeline(cases[0][1],capabilities);expect(result.analysis.status).toBe('ready');
    expect(result.result!.items.some(item=>item.label==='value_column')).toBe(true);
    expect(capabilities).toEqual(completionCapabilitiesForServer('mysql','5.7.44'));
  });
});
