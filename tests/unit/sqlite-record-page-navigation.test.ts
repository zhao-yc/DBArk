import { expect, it } from 'vitest';
import { sqliteAdjacentRecord, sqliteRecordPageOffset, SqliteRecordPageNavigation } from '../../src/renderer/sqliteRecordPageNavigation';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteDraftRow } from '../../src/renderer/sqliteTableEditor';
import { sqliteTableEditZh as text } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';

/** 合成typed页只在RAM；模型没有IPC、写库、复制原值或释放快照端口。 */
function page(offset = 0, hasMore = true): SqliteTablePage {
  return { target:{connectionId:'c',database:'main',table:'跨页🚢',kind:'table'},offset,limit:2,hasMore,schemaKey:'a'.repeat(64),columns:[{name:'id',declaredType:'INTEGER'}],result:{columns:[{key:'c0',name:'id',type:'SQLITE'}],rows:[{c0:'9223372036854775807'},{c0:'2'}],elapsedMs:1,statement:'',truncated:false},edit:{kind:'editable',snapshotId:'s-'+offset,expiresAt:new Date(Date.now()+60000).toISOString(),columns:[{name:'id',declaredType:'INTEGER',generated:false,nullable:false,hasDefault:false}],rows:[[{kind:'integer',value:'9223372036854775807'}],[{kind:'text',value:'2'}]],locator:{kind:'rowid',columns:[]}} };
}
const rows = ():SqliteDraftRow[]=>[{id:'first',index:0,deleted:false,values:[{kind:'integer',value:'9223372036854775807'}]},{id:'last',index:1,deleted:false,values:[{kind:'text',value:'2'}]}];
const view = (p?:SqliteTablePage,busy=false,error='')=>({page:p,busy,stopping:false,error,columns:p?.columns??[]});
it('页内跳过新增及待删除行；未到边界不发跨页意图，首页末页与非法方向封闭',()=>{
 const r=rows(), inserted:SqliteDraftRow={id:'new',deleted:false,values:[]},deleted:SqliteDraftRow={id:'deleted',index:2,deleted:true,values:[]},all=[r[0],inserted,deleted,r[1]],p=page();
 expect(sqliteAdjacentRecord(all,r[0],1)).toBe(r[1]);expect(sqliteAdjacentRecord(all,r[1],-1)).toBe(r[0]);expect(sqliteRecordPageOffset(p,all,r[0],1)).toBeUndefined();expect(sqliteRecordPageOffset(p,all,r[1],1)).toBe(2);expect(sqliteRecordPageOffset(p,all,r[0],-1)).toBeUndefined();
 for(const row of [inserted,deleted,{...r[1]}])expect(sqliteRecordPageOffset(p,all,row,1)).toBeUndefined();
 expect(sqliteRecordPageOffset(page(2,false),r,r[1],1)).toBeUndefined();expect(sqliteRecordPageOffset(page(2),r,r[0],-1)).toBe(0);expect(sqliteRecordPageOffset(p,r,r[1],NaN as 1)).toBeUndefined();
});
it.each([1,-1] as const)('方向%s只在准确新页接管后一次消费真实首末UUID，保持typed原值',direction=>{
 const original=page(2),r=rows(),intent=new SqliteRecordPageNavigation(original,r,direction===1?r[1]:r[0],direction,()=>true),next=page(direction===1?4:0),nextRows=rows().map(row=>({...row,id:'new-'+row.id}));
 intent.observe(view(undefined,true));expect(intent.consume(next,nextRows)).toBeUndefined();intent.observe(view(next,true));expect(intent.consume(next,nextRows)).toBeUndefined();intent.observe(view(next));
 expect(intent.consume(next,nextRows)).toBe(direction===1?nextRows[0]:nextRows[1]);expect(intent.consume(next,nextRows)).toBeUndefined();expect(nextRows[0].values[0]).toEqual({kind:'integer',value:'9223372036854775807'});
});
it.each(['offset','limit','schema','target','readonly','missing','error','stopping','empty'] as const)('%s回包不允许自动打开表单，不循环扫描别的页',mode=>{
 const original=page(),r=rows(),intent=new SqliteRecordPageNavigation(original,r,r[1],1,()=>true),next=page(2),received=view(next);
 if(mode==='offset')next.offset=4;if(mode==='limit')next.limit=3;if(mode==='schema')next.schemaKey='b'.repeat(64);if(mode==='target')next.target={...next.target,table:'另一表'};if(mode==='readonly')next.edit={kind:'readonly',reason:'只读'};if(mode==='missing')received.page=undefined;if(mode==='error')received.error='实际读取失败';if(mode==='stopping')received.stopping=true;if(mode==='empty'&&next.edit?.kind==='editable')next.edit.rows=[];
 intent.observe(received);expect(intent.current()).toBe(false);expect(intent.consume(next,rows())).toBeUndefined();if(mode==='empty')expect(intent.message).toBe(text.recordPageEmpty);
});
it('环境或源元数据ABA永久撤权，旧意图不能偷用后来的准确同名页',()=>{
 let current=true;const original=page(),r=rows(),intent=new SqliteRecordPageNavigation(original,r,r[1],1,()=>current);current=false;expect(intent.current()).toBe(false);current=true;intent.observe(view(page(2)));expect(intent.current()).toBe(false);
 const another=new SqliteRecordPageNavigation(original,r,r[1],1,()=>true);original.limit=3;expect(another.current()).toBe(false);original.limit=2;expect(another.current()).toBe(false);
});
it('目标对象属性顺序无关；错页对象即使值相同仍不能消费当前行身份',()=>{
 const source=page(),r=rows(),intent=new SqliteRecordPageNavigation(source,r,r[1],1,()=>true),next=page(2);next.target={table:source.target.table,kind:'table',database:'main',connectionId:'c'};intent.observe(view(next));
 expect(intent.consume({...next},rows())).toBeUndefined();expect(intent.consume(next,rows())?.id).toBe('first');
});
