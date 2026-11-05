import { SqliteEditWorkspace } from '../../src/renderer/sqliteEditWorkspace';
import { sqliteEditWorkspaceZh as workspaceText } from '../../src/renderer/locales/sqliteEditWorkspace.zh-CN';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { SqliteTableBrowser } from '../../src/renderer/sqliteTableBrowser';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';
import { SqliteRecordPageNavigation, sqliteAdjacentRecord, sqliteRecordPageOffset } from '../../src/renderer/sqliteRecordPageNavigation';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { sqliteTableEditZh as editText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';

/** 整个正式parent切换链、真实Browser与Editor；React发布、DOM、store及IPC为RAM端口。 */
async function fixture() {
 const source=ts.createSourceFile('parent.tsx',readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const names=['makeEditor','syncDraftDirty','dropEditor','openInput','inputCurrent','closeInput','adjacentRecord','moveRecordInput','moveRecordPage'],methods:string[]=[];let adoption='',changed='';
 const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&names.includes(node.name?.text??''))methods.push(node.getText(source));if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'&&ts.isArrowFunction(node.arguments[0])&&node.arguments[0].getText(source).includes('const received = view.page;'))adoption=node.arguments[0].getText(source);if(ts.isNewExpression(node)&&node.expression.getText(source)==='SqliteTableBrowser'){const props=(node.arguments![0]as ts.ObjectLiteralExpression).properties;const prop=props.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='changed')as ts.PropertyAssignment;changed=prop.initializer.getText(source);}ts.forEachChild(node,visit);};visit(source);expect(methods).toHaveLength(names.length);expect(adoption).not.toBe('');expect(changed).not.toBe('');
 const tab={id:'t',kind:'table',connectionId:'c',database:'main',table:'items'},profile={id:'c',dialect:'sqlite',sqlite:{readOnly:false}},listeners=new Set<()=>void>();
 const state={settings:{tabs:[tab],activeTabId:'t'},connections:[profile],connectionVersions:{c:0},activeJobs:{}as Record<string,boolean>,dirtyTabs:{}as Record<string,boolean>,notify:vi.fn(),setDirty:(id:string,value:boolean)=>{state.dirtyTabs[id]=value;publish();}};
 function publish(){for(const fn of [...listeners])fn();}
 let sequence=0,owners:string[]=[],resolve!:(page:SqliteTablePage)=>void;const requests:any[]=[];
 const query={limit:2,mode:'and' as const,filters:[{column:'id',operator:'gt' as const,value:{kind:'integer' as const,value:'0'}}],sort:[{column:'id',direction:'desc' as const}]};
 const refs=Object.fromEntries(['editorRef','inputRef','previewRef','pasteRef','rangeRef','fillRef','importRef','fullExportRef','findRef','filteredSelectRef','checkedRef','checkedReadRef','cellFilterRef','rangeCellRef','templateRef','detailPageIntentRef'].map(name=>[name,{current:null}]));
 const invoke=vi.fn(async(_command:string,..._input:unknown[])=>undefined),context:any=createContext({ related: undefined, pendingRestored:{current:undefined}, restoredDraftRef:{current:false}, setRestoredDraftView:vi.fn(),...refs,workspaceText,updateDrafts:vi.fn(),SqliteTableEditor,SqliteRecordPageNavigation,sqliteAdjacentRecord,sqliteRecordPageOffset,editText,tab,profile,version:0,refreshVersion:0,latest:{current:{tab,active:true,refreshVersion:0}},layoutDirtyRef:{current:false},recordPageRef:{current:undefined},browserViewRef:{current:{busy:false}},applied:{current:query},useWorkspace:{getState:()=>state},uid:()=> 'id-'+ ++sequence,invoke,acquireWorkspaceBusy:()=>{throw Error('本例不允许写事务');},setValidation:vi.fn(),setRecordPageNotice:vi.fn(),setDetailPageNotice:vi.fn(),errorMessage:(reason:Error)=>reason.message,
 document:{querySelectorAll:()=>owners.map(owner=>({querySelector:()=>({getAttribute:()=>owner})}))},
 });
 context.drafts=new SqliteEditWorkspace({now:Date.now,changed:vi.fn(),forgotten:page=>context.controller?.forget(page)});
 for(const name of ['setCheckedReadRows','setCellFilterOwner','setFilteredSelectOpen','setFillOpen','setCheckedRows','setRangeOpen','setRangeCell','setPasteOpen','setPreviewOpen','setSelectedRow'])context[name]=vi.fn();
 context.setCellInput=vi.fn((ticket:any)=>{context.cellInput=ticket;owners=ticket?[ticket.id]:[];});context.setEditView=vi.fn((value:any)=>{context.editView=value;});context.setView=vi.fn((value:any)=>{context.view=value;});context.closeFilteredSelect=vi.fn();context.closeFill=vi.fn();context.closeFind=vi.fn();
 runInContext(ts.transpileModule(methods.join('\n')+'\nglobalThis.adoptEffect=('+adoption+');globalThis.changed=('+changed+');globalThis.api={'+names.join(',')+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const read=vi.fn((input:any)=>{requests.push(input);return new Promise<SqliteTablePage>(yes=>{resolve=yes;});}),release=vi.fn(async()=>{}),cancel=vi.fn(async()=>{});
 const browser=new SqliteTableBrowser({scope:()=>({tab,profile,connectionId:'c',database:'main',table:'items',version:state.connectionVersions.c,schemaRevision:0,present:state.settings.tabs.includes(tab),active:state.settings.activeTabId==='t',sqlite:true,editing:true}),acquire:()=>{state.activeJobs.t=true;publish();return{owns:()=>!!state.activeJobs.t,release:()=>{state.activeJobs.t=false;publish();return true;}};},read,release,cancel,id:()=> 'read-'+ ++sequence,changed:value=>context.changed(value),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}});
 context.controller=browser;listeners.add(()=>context.recordPageRef.current?.current());browser.activate();
 function page(offset:number):SqliteTablePage{return{target:{connectionId:'c',database:'main',table:'items',kind:'table'},schemaKey:'a'.repeat(64),offset,limit:2,hasMore:offset<4,columns:[{name:'id',declaredType:'INTEGER'}],result:{columns:[{key:'c0',name:'id',type:'SQLITE'}],rows:[{c0:'2'},{c0:'1'}],elapsedMs:1,statement:'',truncated:false},edit:{kind:'editable',snapshotId:'s-'+offset,expiresAt:new Date(Date.now()+60000).toISOString(),columns:[{name:'id',declaredType:'INTEGER',generated:false,nullable:false,hasDefault:false}],rows:[[{kind:'integer',value:String(6-offset)}],[{kind:'integer',value:String(5-offset)}]],locator:{kind:'rowid',columns:[]}}};}
 async function settle(offset:number){resolve(page(offset));for(let n=0;n<20;n++)await Promise.resolve();context.adoptEffect();for(let n=0;n<8;n++)await Promise.resolve();}
 const initial=browser.load(query,0);await settle(0);await initial;
 function open(index=1){const editor=context.editorRef.current;context.api.openInput(editor,editor.view.rows[index]);return context.inputRef.current;}
 return{context,state,requests,read,release,cancel,invoke,page,settle,open,publish,browser,foreign:()=>{owners=['foreign'];},dispose:()=>{context.drafts.clear();browser.dispose();}};
}
it('真实parent一次读取原条件并由新编辑器接管首条，往返自动选择前页末条，零SQL预览或提交',async()=>{
 const f=await fixture(),first=f.open();expect(f.context.api.moveRecordInput(first,1)).toBe(true);expect(f.requests).toHaveLength(2);expect(f.requests[1]).toMatchObject({...f.context.applied.current,offset:2});expect(f.context.inputRef.current).toBeNull();await f.settle(2);
 const second=f.context.inputRef.current;expect(second.page.offset).toBe(2);expect(second.row.values[0]).toEqual({kind:'integer',value:'4'});expect(f.context.api.moveRecordInput(first,1)).toBe(false);
 expect(f.context.api.moveRecordInput(second,-1)).toBe(true);await f.settle(0);expect(f.context.inputRef.current.row.values[0]).toEqual({kind:'integer',value:'5'});expect(f.invoke.mock.calls.some(call=>['sqlite.tableEdit.preview','sqlite.tableEdit.apply'].includes(String(call[0])))).toBe(false);f.dispose();
});
it.each(['input','other-update','insert','delete'] as const)('%s草稿跨页保留原Editor，返回缓存不重读或提交',async kind=>{
 const f=await fixture(),editor=f.context.editorRef.current;if(kind==='other-update')editor.save(editor.view.rows[0].id,[{kind:'integer',value:'99'}]);if(kind==='insert')editor.add();if(kind==='delete')editor.remove(editor.view.rows[0].id);
 const input=f.open(1),before=editor.view.rows;expect(f.context.api.moveRecordInput(input,1,kind==='input'?[{kind:'integer',value:'10'}]:undefined)).toBe(true);expect(editor.changes).toHaveLength(1);if(kind!=='input')expect(editor.view.rows).toBe(before);expect(f.requests).toHaveLength(2);await f.settle(2);const next=f.context.inputRef.current;expect(next.page.offset).toBe(2);expect(f.context.drafts.pages).toContain(editor);expect(f.context.api.moveRecordInput(next,-1)).toBe(true);expect(f.requests).toHaveLength(2);await f.settle(0);expect(f.context.editorRef.current).toBe(editor);expect(f.context.inputRef.current.row.values[0]).toEqual({kind:'integer',value:kind==='input'?'10':'5'});expect(editor.changes).toHaveLength(1);expect(f.invoke.mock.calls.some(call=>['sqlite.tableEdit.preview','sqlite.tableEdit.apply'].includes(String(call[0])))).toBe(false);f.dispose();
});
it('在途连接版本与活动标签ABA撤销旧自动打开，真实新页的快照仍由原Browser释放',async()=>{
 const f=await fixture(),input=f.open();expect(f.context.api.moveRecordInput(input,1)).toBe(true);f.state.settings.activeTabId='other';f.publish();f.state.settings.activeTabId='t';f.publish();await f.settle(2);expect(f.context.inputRef.current).toBeNull();expect(f.release).toHaveBeenCalledWith('s-2');f.dispose();
});
it('外来模态先出现使续读失效，恢复后结果只显示新页，不抢占打开表单',async()=>{
 const f=await fixture(),input=f.open();expect(f.context.api.moveRecordInput(input,1)).toBe(true);f.foreign();expect(f.context.recordPageRef.current.current()).toBe(false);f.context.setCellInput(null);await f.settle(2);expect(f.context.inputRef.current).toBeNull();expect(f.context.setRecordPageNotice).toHaveBeenLastCalledWith(editText.recordPageStale);f.dispose();
});

it('关联来源失效撤销正式编辑器权限，但保留原行与草稿', async () => {
 const f=await fixture(), editor=f.context.editorRef.current; editor.save(editor.view.rows[0].id,[{kind:'integer',value:'99'}]); const rows=editor.view.rows;
 f.context.related={current:()=>false}; expect(editor.canEdit()).toBe(false); expect(editor.view.rows).toBe(rows); expect(editor.dirty).toBe(true); expect(f.requests).toHaveLength(1); expect(f.invoke).not.toHaveBeenCalledWith('sqlite.tableEdit.apply',expect.anything()); f.dispose();
});
