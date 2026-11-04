import { expect, it, vi } from 'vitest';
import { QueryRowDetails } from '../../src/renderer/queryRowDetails';
import { SqliteReadonlyRecord, sqliteReadonlyRecordAvailable, sqliteReadonlyJsonBudget } from '../../src/renderer/sqliteReadonlyRecord';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { sqliteReadonlyRecordZh as text } from '../../src/renderer/locales/sqliteReadonlyRecord.zh-CN';

/** 完整原页绑定包含同文INTEGER/TEXT、非有限REAL、NULL、原型同名列和大于编辑预算的BLOB。 */
function fixture(blob = 'AP8=') {
 const names=['__proto__','same','body','real','payload','nothing','empty'];
 const page:SqliteTablePage={target:{connectionId:'本例',database:'main',table:'只读视图',kind:'view'},schemaKey:'a'.repeat(64),columns:names.map(name=>({name,declaredType:name==='real'?'REAL':'',generated:name==='body'})),storageTypes:['ittrbnt','tttrbnt'],offset:0,limit:2,hasMore:false,result:{columns:names.map((name,i)=>({key:'c'+i,name,type:'SQLITE'})),rows:[{c0:'9223372036854775807',c1:'9223372036854775807',c2:' {"n":9007199254740993,"n":1e999}\r\n尾🚢\u0000',c3:'Infinity',c4:{type:'binary',base64:blob},c5:null,c6:''},{c0:'第二行',c1:'1',c2:'{"x":2}',c3:'-0',c4:{type:'binary',base64:''},c5:null,c6:''}],elapsedMs:0,statement:'不能进入输出的SQL',truncated:false}};
 const controller=new QueryRowDetails(),binding=controller.bind(page.result,[page,page.storageTypes]),view=controller.open(binding,0);let live=true;
 const record=new SqliteReadonlyRecord(page,controller,view,()=>live);
 return {page,controller,view,record,scope:(value:boolean)=>{live=value;}};
}
it('完整JSON准确保留原类型、整数／TEXT同文、REAL原字串、BLOB及NULL，不夹带连接、SQL或定位信息',()=>{
 const f=fixture(),json=JSON.parse(f.record.json());expect(json).toMatchObject({format:'DBArk-SQLite-record-view',version:1,complete:true});expect(json.fields).toHaveLength(7);
 expect(json.fields[0]).toMatchObject({name:'__proto__',value:{kind:'integer',value:'9223372036854775807'}});expect(json.fields[1].value).toEqual({kind:'text',value:'9223372036854775807'});expect(json.fields[2].value.value).toBe(f.page.result.rows[0].c2);expect(json.fields[3].value).toEqual({kind:'real',value:'Infinity'});expect(json.fields[4].value).toEqual({kind:'blob',encoding:'base64',value:'AP8=',bytes:2});expect(json.fields[5].value).toEqual({kind:'null'});expect(json.fields[6].value).toEqual({kind:'text',value:''});
 expect(f.record.json()).not.toContain('不能进入输出的SQL');expect(f.record.json()).not.toContain('本例');expect(Object.isFrozen(f.record.fields[0].value)).toBe(true);
});
it('只读大BLOB保原Base64，不受32KiB写入预算影响，也不调用解码函数',()=>{
 const decode=vi.spyOn(globalThis,'atob').mockImplementation(()=>{throw Error('不允许为只读展示解码大BLOB');});try{const encoded='AAAA'.repeat(20000),f=fixture(encoded);expect(f.record.fields[4].value).toEqual({kind:'blob',encoding:'base64',value:encoded,bytes:60000});expect(JSON.parse(f.record.json()).fields[4].value.value).toBe(encoded);expect(decode).not.toHaveBeenCalled();}finally{decode.mockRestore();}
});
it.each(['scope','schema','metadata','types','target','row','columns','result'] as const)('%s变化观察后永久撤权，恢复旧值不能复活',kind=>{
 const f=fixture(),old={schema:f.page.schemaKey,name:f.page.columns[0].name,code:f.page.storageTypes![0],table:f.page.target.table,row:f.page.result.rows[0],columns:f.page.columns,result:f.page.result};
 if(kind==='scope')f.scope(false);if(kind==='schema')f.page.schemaKey='b'.repeat(64);if(kind==='metadata')f.page.columns[0].name='改变';if(kind==='types')f.page.storageTypes![0]='tttrbnt';if(kind==='target')f.page.target.table='另一表';if(kind==='row')f.page.result.rows[0]={...old.row};if(kind==='columns')f.page.columns=[...old.columns];if(kind==='result')f.page.result={...old.result};
 expect(f.record.current()).toBe(false);f.scope(true);f.page.schemaKey=old.schema;f.page.columns=old.columns;f.page.columns[0].name=old.name;f.page.storageTypes![0]=old.code;f.page.target.table=old.table;f.page.result=old.result;f.page.result.rows[0]=old.row;expect(f.record.current()).toBe(false);expect(()=>f.record.json()).toThrow(text.stale);
});
it('BLOB同对象内改值、旧详情翻行和同结果假页均不能接管原来源',()=>{
 const f=fixture();(f.page.result.rows[0].c4 as {type:'binary';base64:string}).base64='AAAA';expect(f.record.current()).toBe(false);
 const g=fixture();g.controller.move(g.view,1);expect(g.record.current()).toBe(false);expect(sqliteReadonlyRecordAvailable({...g.page},g.view)).toBe(false);
 const h=fixture();expect(()=>new SqliteReadonlyRecord({...h.page},h.controller,h.view,()=>true)).toThrow(text.stale);
});
it.each(['wrong-type','bad-code','sparse','wrong-name','bad-base64','integer-range','number-instead-of-string'] as const)('%s不生成猜测类型或部分记录',kind=>{
 const f=fixture();if(kind==='wrong-type')f.page.storageTypes![0]='tttrbbt';if(kind==='bad-code')f.page.storageTypes![0]='xttrbnt';if(kind==='sparse')f.page.storageTypes!.pop();if(kind==='wrong-name')f.page.columns[0].name='别的';if(kind==='bad-base64')f.page.result.rows[0].c4={type:'binary',base64:'AB=='};if(kind==='integer-range')f.page.result.rows[0].c0='9223372036854775808';if(kind==='number-instead-of-string')f.page.result.rows[0].c0=1;
 const c=new QueryRowDetails(),v=c.open(c.bind(f.page.result,[f.page,f.page.storageTypes]),0);expect(()=>new SqliteReadonlyRecord(f.page,c,v,()=>true)).toThrow();
});
it('JSON双预算拒绝完整超限文档，不使原树失效或截取字段',()=>{
 for(const value of ['a'.repeat(sqliteReadonlyJsonBudget.units+1),'中'.repeat(750000)]){const f=fixture();f.page.result.rows[0].c2=value;const c=new QueryRowDetails(),v=c.open(c.bind(f.page.result,[f.page,f.page.storageTypes]),0),r=new SqliteReadonlyRecord(f.page,c,v,()=>true);expect(()=>r.json()).toThrow(text.limited);expect(r.current()).toBe(true);expect(r.fields[2].value).toEqual({kind:'text',value});}
});
it('翻行重新捕获真实类型，REAL负零、空BLOB和TEXT保持，不复用前行JSON缓存',()=>{
 const f=fixture(),v=f.controller.move(f.view,1),r=new SqliteReadonlyRecord(f.page,f.controller,v,()=>true),json=JSON.parse(r.json());expect(json.fields[0].value).toEqual({kind:'text',value:'第二行'});expect(json.fields[3].value).toEqual({kind:'real',value:'-0'});expect(json.fields[4].value).toEqual({kind:'blob',encoding:'base64',value:'',bytes:0});expect(f.record.current()).toBe(false);
});
