import { captureTableDraft } from '../../src/renderer/tableDraft';
import { tableDraftFilesZh as savedDraftText } from '../../src/renderer/locales/tableDraftFiles.zh-CN';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { TableEditWorkspace } from '../../src/renderer/tableEditWorkspace';
import { collectChanges } from '../../src/renderer/dataChanges';
import type { TableInfo, TablePage } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
const source=readFileSync(new URL('../../src/renderer/components/TableTab.tsx',import.meta.url),'utf8'),tree=ts.createSourceFile('TableTab.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions:string[]=[];
/** 执行生产父处理器原文，真实工作区保留脏后台页；不替换dirty的业务计算。 */
function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name&&['closeRecordBatch','recordBatchDirty','openSavedDraft'].includes(node.name.text))functions.push(node.getText(tree));node.forEachChild(visit);}visit(tree);
if(functions.length!==3)throw Error('缺少真实多页草稿父处理器');
const code=ts.transpileModule(functions.join('\n')+';globalThis.actions={closeRecordBatch,recordBatchDirty,openSavedDraft};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
it.each(['初始无输入通知','取消关闭窗口'])('%s不能清除后台页未提交草稿的退出保护',mode=>{
 const info:TableInfo={database:'db',name:'t',objectKind:'table',engine:'InnoDB',ddl:'',primaryKey:['id'],editableKey:['id'],foreignKeys:[],indexes:[],columns:[{name:'id',type:'int',nullable:false,defaultValue:null,extra:'',generated:false,comment:''},{name:'note',type:'text',nullable:true,defaultValue:null,extra:'',generated:false,comment:''}]};
 const edits=new TableEditWorkspace(),profile={},scope='准确原查询';
 const read=(index:number)=>{const data={id:index,note:'原值'},rows=[{id:'页'+index,data:{...data},original:{...data},inserted:false,deleted:false}],page:TablePage={page:index,pageSize:1,hasMore:true,columns:[],rows:[data],copyMetadataKey:tableCopyMetadataKey(info)};return{rows,page};};
 const first=read(1),entry=edits.adopt(scope,profile,info,first.page,first.rows),changed=entry.rows.map(row=>({...row,data:{...row.data,note:'后台未提交'}}));edits.update(entry.rows,changed);edits.history.record(first.rows,changed);
 const second=read(2);edits.adopt(scope,profile,info,second.page,second.rows,edits.navigate(2,scope));expect(collectChanges(second.rows)).toHaveLength(0);expect(edits.dirty).toBe(true);
 const intent={invalidate:vi.fn()},setDirty=vi.fn(),port=createContext({tableEdits:edits,collectChanges,record:{hasInput:()=>false},rowsRef:{current:second.rows},recordBatchIntent:{current:intent},recordBatchAttachment:{current:{intent}},setRecordBatchDialog:vi.fn(),useWorkspace:{getState:()=>({setDirty})},tab:{id:'原表页'}});runInContext(code,port);
 if(mode==='初始无输入通知')port.actions.recordBatchDirty(intent,false);else port.actions.closeRecordBatch(intent);
 expect(setDirty).toHaveBeenCalledExactlyOnceWith('原表页',true);expect(edits.changeCount).toBe(1);expect(edits.pages).toHaveLength(2);
});

it('保存草稿从干净当前页捕获所有后台修改，保持完整原值且不提交数据库',()=>{
 const info:TableInfo={database:'db',name:'t',objectKind:'table',engine:'InnoDB',ddl:'',primaryKey:['id'],editableKey:['id'],foreignKeys:[],indexes:[],columns:[{name:'id',type:'bigint',nullable:false,defaultValue:null,extra:'',generated:false,comment:''},{name:'note',type:'text',nullable:true,defaultValue:null,extra:'',generated:false,comment:''}]};
 const edits=new TableEditWorkspace(),profile={},scope='原查询';
 for(let index=1;index<=3;index++){const data={id:String(index),note:'原值'+index},rows=[{id:'页'+index,data:{...data},original:{...data},inserted:false,deleted:false}],page:TablePage={page:index,pageSize:1,hasMore:index<3,columns:[],rows:[data],copyMetadataKey:tableCopyMetadataKey(info)},ticket=edits.selected?edits.navigate(index,scope):undefined;edits.adopt(scope,profile,info,page,rows,ticket);if(index<3){const changed=rows.map(row=>({...row,data:{...row.data,note:'修改'+index}}));edits.update(rows,changed);edits.history.record(rows,changed);}}
 const entry=edits.selected!,tab={id:'原表页'},frame={},setDraftDialog=vi.fn(),invoke=vi.fn(),port=createContext({tableEdits:edits,tableReadAction:{current:frame},tableReadRender:frame,draftLease:{current:null},editable:true,info,page:entry.page,connection:profile,blockedRef:{current:false},gridEditing:false,record:{hasInput:()=>false,pending:false},showPreferences:false,referenceDialog:null,document:{querySelector:()=>null},useWorkspace:{getState:()=>({settings:{activeTabId:tab.id},setBusy:vi.fn()})},tab,collectChanges,rowsRef:{current:entry.rows},captureTableDraft,base:{connectionId:'conn',database:'db',table:'t'},loadGeneration:{current:7},savedDraftValues:[],referenceCount:{current:0},setReferenceBusy:vi.fn(),setDraftDialog,setError:vi.fn(),savedDraftText,invoke});
 runInContext(code,port);port.actions.openSavedDraft('save');expect(setDraftDialog).toHaveBeenCalledOnce();const payload=setDraftDialog.mock.calls[0][0].payload;expect(payload.changes).toEqual([{kind:'update',before:{id:'1',note:'原值1'},values:{note:'修改1'}},{kind:'update',before:{id:'2',note:'原值2'},values:{note:'修改2'}}]);expect(invoke).not.toHaveBeenCalled();expect(edits.changeCount).toBe(2);expect(edits.pages).toHaveLength(3);
});
