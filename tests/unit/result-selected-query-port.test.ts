import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { ResultExportSelection } from '../../src/renderer/resultExport';
import { QueryRowDetails } from '../../src/renderer/queryRowDetails';
import { QueryResultSort } from '../../src/renderer/queryResultSort';
import { zh } from '../../src/renderer/locales/zh-CN';

const source=readFileSync(new URL('../../src/renderer/components/QueryTab.tsx',import.meta.url),'utf8'),tree=ts.createSourceFile('QueryTab.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions=new Map<string,ts.FunctionDeclaration>();
function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node);ts.forEachChild(node,visit);}visit(tree);
/** 执行真实QueryTab处理器，仅替换工作区和界面端口，不打开Electron或访问IPC。 */
function fixture(){
 const result={columns:[{key:'c0',name:'值',type:'TEXT'}],rows:[{c0:'甲'},{c0:'乙'}],elapsedMs:0,truncated:true,statement:'private SQL'},resultSelection=new ResultExportSelection(),binding=resultSelection.bind(result,['current',1])!;
 const tab={id:'q',connectionId:'c',kind:'query'},workspace={settings:{activeTabId:'q',tabs:[tab]},connectionVersions:{c:1},activeJobs:{} as Record<string,unknown>};
 // 真实详情初始无绑定；失效仍调用真实控制器及空值状态回执。
 const resultSorter=new QueryResultSort(),sortBinding=resultSorter.bind(result,['current',1]);
 const context=createContext({filterBinding:undefined,filterView:undefined,filterLeaseRef:{current:null},setFilterLease:vi.fn(),resultSorter,sortBinding,initialBinding:binding,resultSelection,rowDetails:new QueryRowDetails(),setRowDetail:vi.fn(),setActiveDetailRow:vi.fn(),zh,tab,workspace,useWorkspace:{getState:()=>workspace},connectionVersion:1,alive:{current:true},busyRef:{current:false},document:{querySelector:()=>null},setExportSelected:vi.fn(),setExportResult:vi.fn(),refreshResultSelection:vi.fn(),setError:vi.fn(),errorMessage:(reason:any)=>reason.message});
 const code=`(function(){const selectionBinding=initialBinding;${['resultViewCurrent','resultSelectionAllowed','selectResultRows','exportSelectedRows','invalidateResultSelection'].map(name=>functions.get(name)!.getText(tree)).join('\n')}return{selectResultRows,exportSelectedRows,invalidateResultSelection};})()`;
 const handlers=runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return{result,resultSelection,binding,workspace,context,handlers,select(){return handlers.selectResultRows({scope:binding,rows:result.rows,columns:result.columns,indices:new Set([1])});}};
}
describe('实际QueryTab勾选导出接线的同步门（RAM）',()=>{
 it('空选不打开；有效选择只打开固定副本，不投递查询或任意IPC',()=>{
  const f=fixture();f.handlers.exportSelectedRows();expect(f.context.setExportResult).not.toHaveBeenCalled();expect(f.select()).toBe(true);f.handlers.exportSelectedRows();
  expect(f.context.setExportSelected).toHaveBeenCalledWith(true);expect(f.context.setExportResult).toHaveBeenCalledWith(expect.objectContaining({rows:[{c0:'乙'}],truncated:true,statement:''}));
  expect(f.context.setRowDetail).toHaveBeenCalledWith(null);expect(f.context.setActiveDetailRow).toHaveBeenCalledWith(null);
 });
 it.each(['inactive','closed','connection','version','job','busy','unmounted','modal'])('%s在React更新前也不能接纳旧勾选或打开对话框',change=>{
  const f=fixture();f.select();
  if(change==='inactive')f.workspace.settings.activeTabId='other';else if(change==='closed')f.workspace.settings.tabs=[];else if(change==='connection')f.workspace.settings.tabs=[{...f.workspace.settings.tabs[0],connectionId:'other'}];else if(change==='version')f.workspace.connectionVersions.c++;else if(change==='job')f.workspace.activeJobs.q={};else if(change==='busy')f.context.busyRef.current=true;else if(change==='unmounted')f.context.alive.current=false;else f.context.document.querySelector=()=>({});
  expect(f.select()).toBe(false);f.handlers.exportSelectedRows();expect(f.context.setExportResult).not.toHaveBeenCalled();
 });
 it('切换结果或同步撤销后，旧QueryTab回调不能导出新对象或恢复旧选择',()=>{
  const f=fixture();f.select();f.resultSelection.bind({...f.result,rows:[{c0:'新行'}]},['other',2]);f.handlers.exportSelectedRows();expect(f.context.setExportResult).not.toHaveBeenCalled();f.select();expect(f.context.setExportResult).not.toHaveBeenCalled();
  f.handlers.invalidateResultSelection();f.handlers.exportSelectedRows();expect(f.context.setExportResult).not.toHaveBeenCalled();
 });
 it('真实执行路径首次await前撤销选择，结果与固定快照按钮也同步撤销',()=>{
  for(const name of ['runQuery','runStreamExport']){const fn=functions.get(name)!;let call=-1,firstAwait=Infinity;function find(n:ts.Node){if(ts.isAwaitExpression(n))firstAwait=Math.min(firstAwait,n.pos);if(ts.isCallExpression(n)&&n.expression.getText(tree)==='invalidateResultSelection')call=n.pos;ts.forEachChild(n,find);}find(fn);expect(call).toBeGreaterThan(0);expect(call).toBeLessThan(firstAwait);}
  expect(source).toContain('selectionScope={selectionBinding} onSelectionChange={selectResultRows}');expect(source).toContain('disabled={!selectedExportCount || busy}');
  expect(source).toContain('invalidateResultSelection(); setResultIndex(index)');expect(source).toContain('invalidateResultSelection(); setSelectedPin(item.id)');
 });
});
