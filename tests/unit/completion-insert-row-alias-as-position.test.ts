import {expect,it} from 'vitest';
import {analyzeCompletion} from '../../src/shared/completionAnalysis';
import {completionSuggestions} from '../../src/renderer/completionSuggestions';
import type {CompletionDirectoryRequest} from '../../src/shared/sqlCompletion';

/** 使用真实分析和建议器，只将目录传输替换为 RAM；检查实际读取目标而非仅检查 ready。 */
async function complete(marked:string){
  const offset=marked.indexOf('§'),source=marked.replace('§',''),analysis=analyzeCompletion(source,offset,{ansiQuotes:false,noBackslashEscapes:true},{insertRowAliases:true}),requests:CompletionDirectoryRequest[]=[];
  if(analysis.status!=='ready')return{analysis,requests,items:[]};
  const result=await completionSuggestions(analysis,'active',{async load(query){requests.push(query);return{entries:query.kind==='columns'?[{name:'amount',kind:'column' as const}]:[{name:'calculate',kind:'function' as const}],incomplete:false};}},undefined,'mysql');
  return{analysis,requests,items:result.items};
}

it.each([
  'INSERT INTO sales(amount) SELECT 1 AS reporting ON DUPLICATE KEY UPDATE amount=reporting.ca§()',
  'INSERT INTO sales(amount) VALUES(CAST(1 AS DECIMAL(10,2))) ON DUPLICATE KEY UPDATE amount=`DECIMAL`.ca§()',
  'INSERT INTO sales(amount) SELECT CAST(1 AS DECIMAL) AS reporting ON DUPLICATE KEY UPDATE amount=reporting.ca§()',
])('SELECT投影和CAST类型不抢占同名schema函数：%s',async text=>{
  const result=await complete(text);expect(result.analysis.status).toBe('ready');expect(result.requests).toEqual([{kind:'objects',database:text.includes('`DECIMAL`.ca')?'DECIMAL':'reporting',objectKind:'function',prefix:'ca'}]);expect(result.items).toContainEqual(expect.objectContaining({kind:'function',insertText:'`calculate`'}));
});

it.each([
  'INSERT INTO sales(amount) VALUES(CAST(1 AS DECIMAL(10,2))),(CAST(2 AS DECIMAL)) AS `DECIMAL` ON DUPLICATE KEY UPDATE amount=`DECIMAL`.am§',
  'INSERT INTO sales(amount) VALUES(1) AS `DECIMAL` ON DUPLICATE KEY UPDATE amount=CAST(`DECIMAL`.am§ AS DECIMAL)',
  "INSERT INTO sales(amount) VALUES(CONCAT('AS DECIMAL',1)) /* AS DECIMAL */ AS `DECIMAL` ON DUPLICATE KEY UPDATE amount=`DECIMAL`.am§",
  'INSERT INTO sales SET amount=CAST(1 AS DECIMAL) AS incoming ON DUPLICATE KEY UPDATE amount=incoming.am§',
])('仅VALUES／SET尾部AS声明真实行别名，表达式内同名AS不干扰：%s',async text=>{
  const result=await complete(text);expect(result.analysis.status).toBe('ready');expect(result.requests).toEqual([{kind:'columns',database:'active',table:'sales',prefix:'am'}]);expect(result.items).toContainEqual(expect.objectContaining({kind:'column',insertText:'`amount`'}));
});

it.each([
  'INSERT INTO sales(amount) VALUES(CAST(1 AS DECIMAL)) AS incoming(x) ON DUPLICATE KEY UPDATE amount=incoming.am§',
  'INSERT INTO sales SET amount=CAST(1 AS DECIMAL) AS incoming(x) ON DUPLICATE KEY UPDATE amount=incoming.am§',
  'INSERT INTO sales(amount) VALUES(1) AS incoming ON DUPLICATE KEY UPDATE amount=(SELECT incoming.am§)',
  'INSERT INTO sales(amount VALUES(1) AS incoming ON DUPLICATE KEY UPDATE amount=incoming.am§',
  'INSERT INTO sales(amount) VALUES(incoming.am§) AS incoming ON DUPLICATE KEY UPDATE amount=1',
])('真实声明的不支持形状与非法范围仍不回退schema目录：%s',async text=>{
  const result=await complete(text);expect(result.analysis.status).toBe('blocked');expect(result.requests).toEqual([]);
});
