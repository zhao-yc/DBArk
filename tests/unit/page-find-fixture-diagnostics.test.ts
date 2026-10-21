import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const source=readFileSync(new URL('../fixtures/page-find-replace/electron.cjs',import.meta.url),'utf8');
/** 执行准确离线夹具，仅替代Electron窗口端口；不启动进程、网络或文件写入。 */
async function fixture(){
  const contents=new EventEmitter(),logs:string[]=[],loadURL=vi.fn(async()=>undefined);
  const app={setPath:vi.fn(),whenReady:()=>Promise.resolve(),on:vi.fn(),quit:vi.fn()};
  class BrowserWindow {webContents=contents;loadURL=loadURL;}
  runInNewContext(source,{require:(name:string)=>{if(name!=='electron')throw Error('禁止未声明端口');return{app,BrowserWindow};},process:{env:{DBARK_FIND_FIXTURE_DATA:'RAM独立目录',DBARK_FIND_FIXTURE_URL:'http://127.0.0.1/离线夹具'},stderr:{write:(value:string)=>logs.push(value)}}});
  await Promise.resolve();await Promise.resolve();
  return{contents,logs,loadURL,app,records:()=>logs.map(line=>JSON.parse(line))};
}
it.each(['warning','error'])('真实夹具保留Electron结构化%s，不丢弃首参数消息',async level=>{
  const f=await fixture();f.contents.emit('console-message',{level,message:'真实离线诊断'},level==='warning'?2:3,'弃用参数');
  expect(f.records()).toEqual([{fixture:'page-find-replace',event:'renderer-console',level,message:'真实离线诊断'}]);
});
it('监听器仅声明结构化参数，原生Electron不再为它生成弃用参数',async()=>{
  const f=await fixture();expect(f.contents.listeners('console-message')[0].length).toBe(1);
  f.contents.emit('console-message',{level:'error',message:'只用新参数'});expect(f.records()[0].message).toBe('只用新参数');
});
it('普通信息不写诊断，错误原文仅保留既定2048字符上限',async()=>{
  const f=await fixture();for(const level of ['debug','info'])f.contents.emit('console-message',{level,message:'无需诊断'},0);
  expect(f.records()).toEqual([]);f.contents.emit('console-message',{level:'error',message:'错'.repeat(3000)},3);
  expect(f.records()).toEqual([{fixture:'page-find-replace',event:'renderer-console',level:'error',message:'错'.repeat(2048)}]);
});
it('加载和渲染器退出诊断沿用原事件，启动位置及退出策略不变',async()=>{
  const f=await fixture();f.contents.emit('did-fail-load',{},-105,'说明','http://offline.invalid',true);f.contents.emit('render-process-gone',{},{reason:'crashed',exitCode:5});f.contents.emit('did-finish-load');
  expect(f.records()).toEqual([{fixture:'page-find-replace',event:'load-failed',code:-105,mainFrame:true},{fixture:'page-find-replace',event:'renderer-gone',reason:'crashed',exitCode:5},{fixture:'page-find-replace',event:'load-finished'}]);
  expect(f.loadURL).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1/离线夹具');expect(f.app.setPath).toHaveBeenCalledExactlyOnceWith('userData','RAM独立目录');
  expect(f.app.quit).not.toHaveBeenCalled();expect(f.app.on).toHaveBeenCalledWith('window-all-closed',expect.any(Function));
});
