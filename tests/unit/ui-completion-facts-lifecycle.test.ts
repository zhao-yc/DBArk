import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {CompletionServerFacts} from '../../src/renderer/completionServerFacts';
import {beginSidebarConnectionEnd,SidebarNodeRequests} from '../../src/renderer/sidebarNodeRequests';

/** 提取并执行真实侧栏函数，避免另写一份理想清理分支遮蔽组件回归。 */
function action(name:string,context:Record<string,unknown>):()=>Promise<void>{
  const source=readFileSync('src/renderer/components/Sidebar.tsx','utf8'),file=ts.createSourceFile('Sidebar.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let body='';
  function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)body=node.getText(file);ts.forEachChild(node,visit);}visit(file);if(!body)throw Error('未找到真实侧栏动作');
  return runInNewContext(ts.transpileModule('('+body+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
}
/** 延迟的是调用边界，缓存、ticket和原动作都不替换。 */
function fixture(){
  const facts=new CompletionServerFacts(),seed=(id:string)=>{facts.complete(facts.begin(id,0),{dialect:'mysql',version:'8.4.11'});};seed('target');seed('other');
  const notify=vi.fn(),setConnected=vi.fn(),setOpened=vi.fn(),setConnections=vi.fn();let resolve!:(value?:unknown)=>void,reject!:(reason:Error)=>void;
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no;}),invoke=vi.fn((_:string,__:unknown)=>pending);
  const context={completionServerFacts:facts,profile:{id:'target',name:'隔离连接'},requests:new SidebarNodeRequests(()=>0),beginSidebarConnectionEnd,invoke,setConnected,expand:setOpened,setBusy:vi.fn(),setOpened,errorMessage:(error:Error)=>error.message,useWorkspace:{getState:()=>({notify,setConnections})},window:{confirm:()=>true},formatText:()=>'',zh:{sidebar:{text008:''}}};
  return{facts,notify,invoke,setConnected,setOpened,setConnections,resolve,reject,context};
}
describe('连接动作完成及异常都撤销补全事实',()=>{
  it.each([false,true])('真实断开动作，后端收尾拒绝=%s时期间ticket也不能复活',async failed=>{
    const f=fixture(),run=action('disconnect',f.context)();expect(f.invoke).toHaveBeenCalledWith('connections.close',{id:'target'});expect(f.facts.get('target',0)).toBeUndefined();
    const late=f.facts.begin('target',0);if(failed)f.reject(Error('取消收尾失败'));else f.resolve();await run;
    expect(f.facts.complete(late,{dialect:'mysql',version:'8.4.11'})).toBe(false);expect(f.facts.get('target',0)).toBeUndefined();expect(f.facts.get('other',0)?.version).toBe('8.4.11');
    expect(f.notify).toHaveBeenCalledTimes(failed?1:0);expect(f.setConnected).toHaveBeenCalledTimes(failed?0:1);expect(f.setOpened).toHaveBeenCalledTimes(failed?0:1);
  });
  it('删除已成功但列表读取失败也不保留旧事实，原错误通知继续保留',async()=>{
    const f=fixture();
    // 列表错误由第二次真实调用返回，不把删除失败或取消确认混成成功。
    f.invoke.mockImplementationOnce(()=>Promise.resolve()).mockImplementationOnce(()=>Promise.reject(Error('列表读取失败')));
    await action('remove',f.context)();expect(f.invoke.mock.calls.map(call=>call[0])).toEqual(['connections.delete','connections.list']);expect(f.facts.get('target',0)).toBeUndefined();expect(f.notify).toHaveBeenCalledWith('列表读取失败',true);expect(f.facts.get('other',0)).toBeDefined();
  });
  it('用户取消删除时不触碰事实或调用主进程',async()=>{
    const f=fixture(),before=f.facts.get('target',0);f.context.window.confirm=()=>false;await action('remove',f.context)();expect(f.invoke).not.toHaveBeenCalled();expect(f.facts.get('target',0)).toBe(before);
  });
});
