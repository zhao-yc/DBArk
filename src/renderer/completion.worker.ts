import {analyzeCompletion} from '../shared/completionAnalysis';
import {completionLimits} from '../shared/sqlCompletion';
import type {CompletionLexicalMode} from '../shared/completionLexical';
import{warmupCompletionAnalysis}from'../shared/completionWarmup';
import type{CompletionScopeCapabilities}from'../shared/completionCapabilities';

/** 仅同安装包的本地编辑器发送有界快照；不访问网络、IPC、凭据或用户查询会话。 */
self.onmessage=(event:MessageEvent<{id:number;source:string;offset:number;mode:CompletionLexicalMode;capabilities?:CompletionScopeCapabilities}>)=>{
  const input=event.data;
  if(!input||!Number.isSafeInteger(input.id)||input.id<1||typeof input.source!=='string'||input.source.length>completionLimits.sourceUnits||!Number.isInteger(input.offset)||input.offset<0||input.offset>input.source.length){self.postMessage({id:input?.id,result:{status:'blocked',reason:'budget'}});return;}
  const mode=input.mode??{};
  if([mode.ansiQuotes,mode.noBackslashEscapes].some(value=>value!==undefined&&typeof value!=='boolean')){self.postMessage({id:input.id,result:{status:'blocked',reason:'mode'}});return;}
  // 本地能力缺省关闭；未知字段和非布尔值不能让未核验服务器获得LATERAL作用域。
  const capabilities=input.capabilities;if(capabilities!==undefined&&(!capabilities||typeof capabilities!=='object'||Array.isArray(capabilities)||Object.keys(capabilities).some(key=>!['lateralDerivedTables','windowFunctions'].includes(key))||[capabilities.lateralDerivedTables,capabilities.windowFunctions].some(value=>value!==undefined&&typeof value!=='boolean'))){self.postMessage({id:input.id,result:{status:'blocked',reason:'capability'}});return;}
  self.postMessage({id:input.id,result:analyzeCompletion(input.source,input.offset,mode,capabilities)});
};

// 首次语法预测也属于启动；仅模块加载完成不足以证明解析器就绪，用户文本仍由独立期限保护。
try{warmupCompletionAnalysis();self.postMessage({type:'dbark-completion-ready',version:1});}
catch{self.postMessage({type:'dbark-completion-unavailable',version:1});}
