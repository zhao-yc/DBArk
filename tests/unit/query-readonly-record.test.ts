import { expect, it, vi } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { QueryRowDetails } from '../../src/renderer/queryRowDetails';
import { QueryReadonlyRecord, queryReadonlyJsonBudget } from '../../src/renderer/queryReadonlyRecord';
import { queryReadonlyRecordZh as text } from '../../src/renderer/locales/queryReadonlyRecord.zh-CN';

/** 返回值与SQLite实际类型分别绑定，重复别名及原型同名键不作对象字段名合并。 */
function fixture(sqlite = false) {
  const columns = ['__proto__','d','body','payload','nil','empty','number','flag'].map((key, index) => ({key,name:index<2?'重复':key,type:sqlite?'SQLITE':index===0?'BIGINT':index===1?'DECIMAL':'原协议'}));
  const row = JSON.parse('{"__proto__":"9223372036854775807","d":"0.12345678901234567890","body":" {\\"n\\":9007199254740993,\\"n\\":1e999} \\r\\n","payload":{"type":"binary","base64":"AP8="},"nil":null,"empty":"","number":0,"flag":false}');row.number=-0;
  if(sqlite){row.d='9223372036854775807';row.number='Infinity';row.flag='1';}
  const result:QueryResult={columns,rows:[row,{...row,['__proto__']:'下一行',body:'{"x":2}',payload:{type:'binary',base64:''}}],truncated:true,elapsedMs:0,statement:'不能包含在投影里的SQL',...(sqlite?{sqliteStorage:{version:1,rows:['ittbntrt','tttbntrt']}}:{})};
  const controller=new QueryRowDetails(),view=controller.open(controller.bind(result,['查询']),0);let live=true;
  const record=new QueryReadonlyRecord(controller,view,()=>live);return{result,controller,view,record,scope:(value:boolean)=>{live=value;}};
}
it('协议数值字串原样保留，重复别名、隐藏字段、原型同名键、CRLF与NULL完整输出且无SQL',()=>{
 const f=fixture(),before=structuredClone(f.result),j=JSON.parse(f.record.json());expect(j).toMatchObject({format:'DBArk-query-record-view',version:1,complete:true,resultTruncated:true,sourceTypes:'returned-values'});expect(j.fields.map((v:any)=>v.key)).toEqual(f.result.columns.map(v=>v.key));expect(j.fields.slice(0,2).map((v:any)=>v.name)).toEqual(['重复','重复']);expect(j.fields[0].value).toEqual({kind:'text',value:'9223372036854775807'});expect(j.fields[1]).toMatchObject({protocolType:'DECIMAL',value:{kind:'text',value:'0.12345678901234567890'}});expect(j.fields[2].value.value).toBe(f.result.rows[0].body);expect(j.fields[4].value).toEqual({kind:'null'});expect(j.fields[5].value).toEqual({kind:'text',value:''});expect(j.fields[6].value).toEqual({kind:'number',representation:'javascript-number',value:'-0'});expect(j.fields[7].value).toEqual({kind:'boolean',value:false});expect(f.record.json()).not.toContain(f.result.statement);expect(f.result).toEqual(before);expect(Object.isFrozen(f.record.documentFields[0].value)).toBe(true);
});
it('SQLite按逐格事实区分整数与同文TEXT、非有限REAL，不允许解析数值类为JSON',()=>{
 const f=fixture(true),j=JSON.parse(f.record.json());expect(j.sourceTypes).toBe('sqlite-storage');expect(j.fields[0].value).toEqual({kind:'integer',value:'9223372036854775807'});expect(j.fields[1].value).toEqual({kind:'text',value:'9223372036854775807'});expect(j.fields[6].value).toEqual({kind:'real',value:'Infinity'});expect(f.record.fields[0].parse).toBe(false);expect(f.record.fields[1].parse).toBe(true);
});
it('大BLOB保持Base64原文和字节数，不解码，不转HEX；空BLOB保持独立类型',()=>{
 const decode=vi.spyOn(globalThis,'atob').mockImplementation(()=>{throw Error('不得解码');});try{const f=fixture(),blob='AAAA'.repeat(20000);f.result.rows[0].payload={type:'binary',base64:blob};const v=f.controller.open(f.view.binding,0),r=new QueryReadonlyRecord(f.controller,v,()=>true);expect(JSON.parse(r.json()).fields[3].value).toEqual({kind:'blob',encoding:'base64',value:blob,bytes:60000});const next=f.controller.move(v,1);expect(JSON.parse(new QueryReadonlyRecord(f.controller,next,()=>true).json()).fields[3].value).toEqual({kind:'blob',encoding:'base64',value:'',bytes:0});expect(decode).not.toHaveBeenCalled();}finally{decode.mockRestore();}
});
it.each(['scope','row','value','metadata','columns','resultRows','blob','types','storage-object','storage-rows','storage-version','type-added'] as const)('%s变化观察后永久失效，恢复旧来源不复活',kind=>{
 const f=fixture(kind!=='type-added'),original={row:f.result.rows[0],body:f.result.rows[0].body,name:f.result.columns[0].name,columns:f.result.columns,rows:f.result.rows,blob:(f.result.rows[0].payload as any).base64,storage:f.result.sqliteStorage,code:f.result.sqliteStorage?.rows[0],storageRows:f.result.sqliteStorage?.rows};
 if(kind==='scope')f.scope(false);if(kind==='row')f.result.rows[0]={...original.row};if(kind==='value')f.result.rows[0].body='不同';if(kind==='metadata')f.result.columns[0].name='不同';if(kind==='columns')f.result.columns=[...f.result.columns];if(kind==='resultRows')f.result.rows=[...f.result.rows];if(kind==='blob')(f.result.rows[0].payload as any).base64='AAAA';if(kind==='types')f.result.sqliteStorage!.rows[0]='tttbntrt';if(kind==='storage-object')f.result.sqliteStorage={...f.result.sqliteStorage!};if(kind==='storage-rows')f.result.sqliteStorage!.rows=[...f.result.sqliteStorage!.rows];if(kind==='storage-version')(f.result.sqliteStorage as any).version=2;if(kind==='type-added')f.result.sqliteStorage={version:1,rows:[]};
 expect(f.record.current()).toBe(false);f.scope(true);f.result.rows=original.rows;f.result.rows[0]=original.row;f.result.rows[0].body=original.body;f.result.columns=original.columns;f.result.columns[0].name=original.name;(f.result.rows[0].payload as any).base64=original.blob;if(original.storage){f.result.sqliteStorage=original.storage;original.storage.version=1;original.storage.rows=original.storageRows!;original.storage.rows[0]=original.code!;}else delete f.result.sqliteStorage;expect(f.record.current()).toBe(false);expect(()=>f.record.json()).toThrow(text.stale);
});
it('旧行不能借翻行或新绑定改读新结果',()=>{const f=fixture(),next=f.controller.move(f.view,1);expect(f.record.current()).toBe(false);const r=new QueryReadonlyRecord(f.controller,next,()=>true);expect(JSON.parse(r.json()).fields[2].value.value).toBe('{"x":2}');f.controller.bind({...f.result},['后来']);expect(r.current()).toBe(false);});
it.each(['malformed','wrong-code','integer-range','noncanonical','missing-row','invalid-blob'] as const)('%s事实不匹配时拒绝完整及部分新投影',kind=>{const f=fixture(true);if(kind==='malformed')(f.result.sqliteStorage as any).extra=true;if(kind==='wrong-code')f.result.sqliteStorage!.rows[0]='xttbntrt';if(kind==='integer-range')f.result.rows[0].__proto__='9223372036854775808';if(kind==='noncanonical')f.result.rows[0].number='1.0';if(kind==='missing-row')f.result.sqliteStorage!.rows.pop();if(kind==='invalid-blob')f.result.rows[0].payload={type:'binary',base64:'AB=='};const v=f.controller.open(f.view.binding,0);expect(()=>new QueryReadonlyRecord(f.controller,v,()=>true)).toThrow();});
it('旧SQLite结果缺类型事实时只报告返回值，不按列名或数值外观伪造INTEGER',()=>{const f=fixture(true);delete f.result.sqliteStorage;const v=f.controller.open(f.view.binding,0);const j=JSON.parse(new QueryReadonlyRecord(f.controller,v,()=>true).json());expect(j.sourceTypes).toBe('returned-values');expect(j.fields[0].value.kind).toBe('text');});
it('完整JSON包含转义的UTF8双预算，超限仍可看完整字段树',()=>{for(const value of ['a'.repeat(queryReadonlyJsonBudget.units+1),'中'.repeat(750000),'\u0000'.repeat(400000)]){const f=fixture();f.result.rows[0].body=value;const v=f.controller.open(f.view.binding,0),r=new QueryReadonlyRecord(f.controller,v,()=>true);expect(()=>r.json()).toThrow(text.limited);expect(r.current()).toBe(true);expect(r.fields[2].raw).toBe(value);}});

it('本地排序后的准确结果行使用同步投影的SQLite类型事实，不沿原页行号错配',async()=>{
 const {QueryResultSort}=await import('../../src/renderer/queryResultSort');const f=fixture(true),sorter=new QueryResultSort(),binding=sorter.bind(f.result,[])!;
 const sorted=sorter.apply(binding,sorter.view(binding)!,{column:'__proto__',direction:'DESC'});expect(sorted.sourceIndices).toEqual([1,0]);
 const controller=new QueryRowDetails(),view=controller.open(controller.bind(sorted.result,['已排序']),0),record=new QueryReadonlyRecord(controller,view,()=>sorter.view(binding)===sorted);
 expect(JSON.parse(record.json()).fields[0].value).toEqual({kind:'text',value:'下一行'});expect(JSON.parse(record.json()).fields[3].value.value).toBe('');
 sorter.apply(binding,sorted);expect(record.current()).toBe(false);expect(()=>record.json()).toThrow(text.stale);
});
