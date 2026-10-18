import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {mainColumnsHarness} from './main-columns-owner-harness';

/** 只登记RAM路径，不执行文件IO；能力来自原窗口capture，依赖保留真实owner/会话/修订检查。 */
function insertEntry(h:ReturnType<typeof mainColumnsHarness>){
  const taskId=randomUUID(),fileToken=randomUUID(),sessionId=randomUUID(),owner=h.capabilities.capture(h.event());
  const target={database:'明确库',table:'明确表',columns:['值']};
  h.context.sessions.set(sessionId,{});h.context.files.set(fileToken,{path:'仅RAM.sql',purpose:'export',format:'sql'});
  h.context.queryInsertExports.bind(fileToken,owner);
  expect(h.context.queryInsertExports.begin({taskId,fileToken,sessionId,insertTarget:target,encoding:'utf8'},owner)).toBe('仅RAM.sql');
  const pending={previewToken:randomUUID(),target,encoding:'utf8',sql:'仅RAM样例',totalRows:1,shownRows:1,bytes:1,expiresAt:new Date(Date.now()+120000).toISOString()};
  expect(h.context.queryInsertExports.receive(taskId,pending)).toBe(true);
  return{taskId,owner,pending};
}

it('补齐真实依赖后默认仍无INSERT能力，未知确认在broker前拒绝',async()=>{
  const h=mainColumnsHarness();
  const result=await h.invoke('query.confirmInsertExport',{taskId:randomUUID(),previewToken:randomUUID(),confirmation:'明确库.明确表',acknowledged:true});
  expect(result.ok).toBe(false);expect(h.request).not.toHaveBeenCalled();
});
it.each([false,true])('真实导航撤销INSERT：准备中=%s只触达本任务停止端口，旧owner不能再确认',async preparing=>{
  const h=mainColumnsHarness(),entry=insertEntry(h),state={cancelled:false};
  if(preparing)h.context.preparingTasks.set(entry.taskId,state);
  h.context.window.webContents.emit('did-navigate');
  expect(()=>h.context.queryInsertExports.assert(entry.taskId)).toThrow();
  if(preparing){expect(state.cancelled).toBe(true);expect(h.request).not.toHaveBeenCalled();}
  else expect(h.request.mock.calls).toEqual([['query.cancel',{taskId:entry.taskId}]]);
  const count=h.request.mock.calls.length;
  expect((await h.invoke('query.confirmInsertExport',{taskId:entry.taskId,previewToken:entry.pending.previewToken,confirmation:'明确库.明确表',acknowledged:true})).ok).toBe(false);
  expect(h.request).toHaveBeenCalledTimes(count);
});
it('真实依赖不接受伪owner、会话替换或修订漂移，不以空has或invalidate绕过',()=>{
  for(const kind of ['owner','session','revision']){
    const h=mainColumnsHarness(),entry=insertEntry(h);
    if(kind==='session')h.context.sessions.clear();
    if(kind==='revision')h.setRevision(8);
    expect(()=>h.context.queryInsertExports.grant({taskId:entry.taskId,previewToken:entry.pending.previewToken,confirmation:'明确库.明确表'},kind==='owner'?{}:entry.owner)).toThrow();
    expect(h.request).not.toHaveBeenCalled();
  }
});
