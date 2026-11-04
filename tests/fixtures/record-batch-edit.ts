import type { TableInfo, TablePage } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { newDraftRow, type DraftRow } from '../../src/renderer/dataChanges';
import { recordTargetKey, type RecordContext } from '../../src/renderer/recordViews';
import { RecordBatchEditIntent } from '../../src/renderer/recordBatchEdit';
/** 当前页真实合同形状，纯RAM无数据库、剪贴板或文件路径。 */
export function recordBatchFixture(inserted = false) {
 const info:TableInfo={database:'库',name:'表',objectKind:'table',engine:'InnoDB',primaryKey:['id'],editableKey:['id'],indexes:[],foreignKeys:[],ddl:'',columns:['id','note','num','doc','bin','nullable','g'].map(name=>({name,type:name==='num'?'decimal(65,30)':name==='id'?'bigint':name==='doc'?'json':name==='bin'?'blob':'text',nullable:!['id','num'].includes(name),generated:name==='g',extra:name==='g'?'VIRTUAL GENERATED':'',defaultValue:null,comment:''}))};
 const data=[1,2,3].map(id=>({id:String(id),note:'原'+id,num:'0.000000000000000000000000000001',doc:'{"n":900719925474099312345,"n":-0}',bin:{type:'binary' as const,base64:'AP8='},nullable:null,g:'生成'+id}));
 const page:TablePage={page:1,pageSize:50,hasMore:false,rows:data,columns:info.columns.map(c=>({key:c.name,name:c.name,type:c.type})),copyMetadataKey:tableCopyMetadataKey(info)},context:RecordContext={target:{connectionId:'连接',database:info.database,table:info.name},connectionVersion:1,generation:2,info,loaded:true,stale:false,busy:false},binding={page,target:recordTargetKey(context.target),connectionVersion:1,generation:2};
 const rows:DraftRow[]=data.map((data,index)=>({id:'UUID'+index,data:structuredClone(data),original:structuredClone(data),inserted:false,deleted:false}));if(inserted)rows.push(newDraftRow('NEW',{note:'新增'}));
 const ids=new Set(inserted?[rows[0].id,'NEW']:[rows[0].id,rows[2].id]);return{info,page,context,binding,rows,ids,create:()=>new RecordBatchEditIntent(rows,ids,context,binding,page,'本批-owner')};
}
