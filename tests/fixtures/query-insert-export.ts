import { emptyTableFilteredUpdateOwners } from '../unit/table-filtered-update-owner-fixture';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {QueryInsertExports} from '../../src/main/queryInsertExports';
import {validateCommand} from '../../src/shared/validation';
import {queryDatabasePatch} from '../../src/shared/queryContext';
import {persistedTaskMessage,persistedQueryError} from '../../src/main/taskPrivacy';
import {resolveFileToken,type SelectedFile} from '../../src/main/fileTokens';

/** 运行正式Main选择、派发和任务事件函数；仅原生选择、存储、真实文档入口由RAM端口替代。 */
const source=readFileSync(new URL('../../src/main/index.ts',import.meta.url),'utf8');
const parsed=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const selected=parsed.statements.filter(node=>ts.isFunctionDeclaration(node)&&['chooseQueryInsertFile','dispatch','taskEvent','engineTaskEvent','persistAuxiliary'].includes(node.name?.text??'')).map(node=>node.getText(parsed)).join('\n');
const script=ts.transpileModule(selected+';globalThis.actual={dispatch,taskEvent:engineTaskEvent};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
export function queryInsertMain(path:string,sessionId:string,request:(command:string,input:any)=>Promise<any>){
  const state={current:true,revision:1,closing:false},owner={owner:{document:{}}},files=new Map<string,SelectedFile>(),tasks=new Map<string,any>(),events:any[]=[],stored:any[]=[],calls:any[]=[],listeners=new Set<(event:any)=>void>();
  const sessions=new Map([[sessionId,{connectionId:'p'}]]),preparingTasks=new Map<string,any>();
  const assert=(value:unknown)=>{if(value!==owner||!state.current)throw Error('RAM原主文档失效');};
  const insert=new QueryInsertExports(files,{assert,same:(left,right)=>{assert(left);assert(right);return true;},revision:()=>state.revision,session:id=>sessions.get(id),closing:()=>state.closing,stop:async taskId=>{const preparing=preparingTasks.get(taskId);if(preparing)preparing.cancelled=true;else await request('query.cancel',{taskId});}});
  const context=vm.createContext({ filteredUpdates: emptyTableFilteredUpdateOwners(),Date,Map,Error,randomUUID,queryInsertExports:insert,shuttingDown:false,files,tasks,sessions,preparingTasks,queryDatabasePatch,persistedTaskMessage,persistedQueryError,resolveFileToken,
    SavedQuerySearchCancelled:class extends Error{},resultSqlZh:{shuttingDown:'正在退出'},tableApplyReceipts:undefined,
    columnsMain:{assertCapturedOwner:assert},async chooseFile(input:any){const token=randomUUID();files.set(token,{path,purpose:input.purpose,format:input.format});return{token,name:'完整.sql'};},
    pendingQueryHistory:new Map(),completionTasks:new Set(),exportProgress:new Map(),structureProgress:new Map(),lastPersist:new Map(),lastStorageWarning:0,tablePresetReads:new Map(),structureTokens:new Map(),savedQueryPages:undefined,historyPages:undefined,savedQuerySearches:{has:()=>false},
    store:{saveTask(value:any){stored.push({...value});},addHistory(){},connectionRevision:()=>state.revision},connectionConfig:{assertAvailable(){}},exportReservations:{acquire:async()=>()=>{}},
    window:{isDestroyed:()=>false,webContents:{send:(_channel:string,event:any)=>{events.push(event);listeners.forEach(listener=>listener(event));}}},broker:{request:async(command:string,input:any)=>{calls.push({command,input});return request(command,input);}},
  });
  vm.runInContext(script,context);const actual=context.actual as{dispatch(command:string,input:any,owner:unknown):Promise<any>;taskEvent(event:any):void};
  return{state,files,tasks,events,stored,calls,sessions,insert,emit:actual.taskEvent,onTask(listener:(event:any)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},async invoke(command:string,input:any){return actual.dispatch(command,validateCommand(command,input),owner);}};
}
