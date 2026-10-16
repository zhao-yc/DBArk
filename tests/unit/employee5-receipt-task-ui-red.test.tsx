import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';

// SSR仅替换订阅读取端口，状态写入和onTask仍使用真实store，避免SSR固定初始快照。
vi.mock('../../src/renderer/store',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../src/renderer/store')>();
 return{...actual,useWorkspace:Object.assign((selector:any)=>selector(actual.useWorkspace.getState()),actual.useWorkspace)};
});

/** COMMIT边界先于任务窗口挂载到达；只用真实store/TasksDialog和SSR，不启动GUI。 */
it('重开任务中心应保留已进入COMMIT的不可取消状态',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){},dbark:{onTask:()=>()=>{}}}});
 try{
  const {useWorkspace}=await import('../../src/renderer/store');
  useWorkspace.setState({tasks:[{id:'commit-task',kind:'table.apply',status:'running',progress:0,message:'正在提交',startedAt:'2026-10-16T00:00:00.000Z'}]});
  useWorkspace.getState().onTask({taskId:'commit-task',status:'running',progress:0,message:'正在确认提交，暂不能取消',tableApply:{operationId:'9b114a51-7550-44a5-ae0c-cbd48a938b26',sequence:3,phase:'committing',reason:'none',evidence:{dmlMayHaveBeenSent:true,dmlAcknowledged:1,serverReportedRows:1,commitMayHaveBeenSent:true,commitAcknowledged:false,rollbackAcknowledged:false,transactionProtected:true,transactionKnown:true,transactionOpen:true}}});
  const {TasksDialog}=await import('../../src/renderer/components/ActivityDialog');
  const html=renderToStaticMarkup(<TasksDialog onClose={()=>{}}/>);
  expect(html.includes('正在确认提交，暂不能取消')).toBe(true);
  expect(html.includes('>取消任务</button>')).toBe(false);
 }finally{if(prior)Object.defineProperty(globalThis,'window',prior);else Reflect.deleteProperty(globalThis,'window');}
});
