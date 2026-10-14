import {analyzeCompletion} from '../shared/completionAnalysis';
import {completionLimits} from '../shared/sqlCompletion';
import type {CompletionLexicalMode} from '../shared/completionLexical';

/** 仅同安装包的本地编辑器发送有界快照；不访问网络、IPC、凭据或用户查询会话。 */
self.onmessage=(event:MessageEvent<{id:number;source:string;offset:number;mode:CompletionLexicalMode}>)=>{
  const input=event.data;
  if(!input||!Number.isSafeInteger(input.id)||input.id<1||typeof input.source!=='string'||input.source.length>completionLimits.sourceUnits||!Number.isInteger(input.offset)||input.offset<0||input.offset>input.source.length){self.postMessage({id:input?.id,result:{status:'blocked',reason:'budget'}});return;}
  const mode=input.mode??{};
  if([mode.ansiQuotes,mode.noBackslashEscapes].some(value=>value!==undefined&&typeof value!=='boolean')){self.postMessage({id:input.id,result:{status:'blocked',reason:'mode'}});return;}
  self.postMessage({id:input.id,result:analyzeCompletion(input.source,input.offset,mode)});
};
