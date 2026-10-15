import {completionIdentifier} from '../shared/completionLexical';
import {completionLimits,type CompletionDirectoryRequest} from '../shared/sqlCompletion';
import {sessionObjectLimits,type SessionObjectColumn,type SessionObjectCompletion,type SessionObjectSnapshot} from '../shared/sessionObjects';
import type {SqlLexicalMode} from '../shared/queryParameters';
import {alterObjectColumns,sessionObjectAction} from './sessionObjectSyntax';
interface Entry{database:string;name:string;columns:SessionObjectColumn[];known:boolean;complete:boolean;absent:boolean}
/** 会话目录只保存有界字段摘要；淘汰定义保留遮蔽，目录不足时不能回退永久字段。 */
export class SessionObjects{
  private entries=new Map<string,Entry>();private uncertain=false;revision=0;
  constructor(readonly caseMode:0|1|2){}
  /** 表/库按服务器名称规则匹配，列名则由服务器按自己的规则执行。 */
  private key(database:string,table:string):string{return JSON.stringify([this.caseMode?database.toLowerCase():database,this.caseMode?table.toLowerCase():table]);}
  /** 实际成功的最终状态包才更新定义；LIKE/AS SELECT保持部分状态直到显式读回。 */
  observe(sql:string,database:string|undefined,mode:SqlLexicalMode,dialect:'mysql'|'mariadb',warnings=0):void{
    const action=sessionObjectAction(sql,database,mode,dialect);if(action.kind==='none')return;if(action.kind==='opaque'){this.invalidate();return;}if(action.kind==='dependencies'){if(action.targets.some(target=>{const entry=this.entries.get(this.key(target.database,target.table));return !entry?.known||entry.absent;}))this.invalidate();return;}
    if(action.kind==='create'){const old=this.entries.get(this.key(action.target.database,action.target.table));if(action.effects)this.invalidate();if(action.keep&&old&&!old.absent){if(!old.known)this.put({...old,known:true,columns:[],complete:false});return;}const uncertainExisting=action.keep&&(this.uncertain||warnings>0);this.put({database:action.target.database,name:action.target.table,columns:uncertainExisting?[]:action.columns,known:true,complete:action.complete&&!uncertainExisting,absent:false});}
    if(action.kind==='drop')for(const target of action.targets)this.put({...target,name:target.table,columns:[],known:true,complete:true,absent:true});
    if(action.kind==='alter'){const old=this.entries.get(this.key(action.target.database,action.target.table));if(old&&!old.absent){const next=alterObjectColumns(old.columns,action.parts,old.database),columns=next.complete?next.columns:[];if(next.rename){this.put({...old,columns:[],known:true,complete:true,absent:true});this.put({...old,database:next.rename.database,name:next.rename.table,columns,complete:old.known&&old.complete&&next.complete});}else this.put({...old,columns,complete:old.known&&old.complete&&next.complete});}}
    if(action.kind==='rename')for(const pair of action.pairs){const old=this.entries.get(this.key(pair.before.database,pair.before.table));if(old&&!old.absent){this.put({...old,columns:[],known:true,complete:true,absent:true});this.put({...old,database:pair.after.database,name:pair.after.table});}}
  }
  /** 非变更语句失败不凭空创建未知目录；可能部分执行的动作明确使现有定义待核对。 */
  error(sql:string|undefined,database:string|undefined,mode:SqlLexicalMode,dialect:'mysql'|'mariadb'):void{
    if(!sql){if(this.entries.size)this.invalidate();return;}const action=sessionObjectAction(sql,database,mode,dialect);if(action.kind==='none')return;if(action.kind==='opaque'){this.invalidate();return;}
    if(action.kind==='dependencies'){if(action.targets.some(target=>!this.entries.get(this.key(target.database,target.table))?.known))this.invalidate();return;}
    // 简单声明失败不会创建表，也不能把权限不足虚构成临时遮蔽；REPLACE/CTAS可能已改变对象。
    if(action.kind==='create'&&action.declaration&&!action.replace)return;
    const targets=action.kind==='drop'?action.targets:action.kind==='rename'?action.pairs.flatMap(pair=>[pair.before,pair.after]):[action.target];
    for(const target of targets)this.put({database:target.database,name:target.table,columns:[],known:false,complete:false,absent:false});
  }
  /** 例程或预算外语句可能改变未观测对象，保留已知名称用于遮蔽和显式刷新。 */
  invalidate():void{this.uncertain=true;for(const entry of this.entries.values()){entry.known=false;entry.complete=false;entry.absent=false;entry.columns=[];}this.revision++;}
  /** 显式读取在原会话确认结构；非临时表确认该名称没有临时遮蔽。 */
  confirm(database:string,table:string,columns:SessionObjectColumn[]|null):void{this.put({database,name:table,columns:columns??[],known:true,complete:true,absent:columns===null});}
  /** 返回独立摘要，忙碌时不将中间帧当作稳定对象目录。 */
  snapshot(busy=false,broken=false):SessionObjectSnapshot{return{revision:this.revision,uncertain:this.uncertain,caseMode:this.caseMode,objects:busy||broken?[]:[...this.entries.values()].filter(entry=>!entry.absent).map(({database,name,known,complete,columns})=>({database,name,known,complete,columnCount:columns.length})),busy,broken};}
  /** 每次补全即时读取内存；未确认的字段请求绝不落到独立永久目录。 */
  completion(query:CompletionDirectoryRequest):SessionObjectCompletion{
    const base={revision:this.revision,caseMode:this.caseMode,entries:[],incomplete:false,handled:false,shadowed:[],uncertain:this.uncertain}as SessionObjectCompletion;
    if(query.kind==='databases'||query.kind==='objects'&&query.objectKind!=='relation')return base;
    const prefix=query.prefix.toLowerCase(),matches=(value:string)=>value.toLowerCase().startsWith(prefix);
    if(query.kind==='columns'){const entry=this.entries.get(this.key(query.database,query.table));if(entry?.absent)return base;if(!entry)return this.uncertain?{...base,handled:true,incomplete:true}:base;
      const all=entry.known?entry.columns.filter(column=>matches(column.name)):[];return{...base,handled:true,entries:all.slice(0,completionLimits.entries).map(column=>({name:column.name,kind:'column',dataType:column.dataType,visible:column.visible,sessionObject:'temporary'})),incomplete:!entry.known||!entry.complete||all.length>completionLimits.entries};}
    const entries=[...this.entries.values()].filter(entry=>!entry.absent&&this.key(entry.database,'')===this.key(query.database,'')&&matches(entry.name));
    return{...base,entries:entries.slice(0,completionLimits.entries).map(entry=>({name:entry.name,kind:'table',sessionObject:entry.known?'temporary':'unconfirmed'})),shadowed:entries.map(entry=>entry.name),incomplete:this.uncertain||entries.some(entry=>!entry.known)||entries.length>completionLimits.entries};
  }
  /** 预算达到后保留名称而丢弃字段；名称本身超限才整体待确认，避免不知情的回退。 */
  private put(entry:Entry):void{
    if(!completionIdentifier(entry.database)||!completionIdentifier(entry.name)||entry.columns.some(column=>!completionIdentifier(column.name))){this.invalidate();return;}
    const key=this.key(entry.database,entry.name);if(entry.absent&&!this.uncertain){this.entries.delete(key);this.revision++;return;}
    if(!this.entries.has(key)&&this.entries.size>=sessionObjectLimits.objects){const oldest=this.entries.keys().next().value;if(oldest!==undefined)this.entries.delete(oldest);this.uncertain=true;}
    this.entries.set(key,{...entry,columns:entry.columns.map(column=>({...column}))});this.revision++;
    let bytes=0;for(const value of this.entries.values())bytes+=JSON.stringify(value).length*2+256;
    if(entry.columns.length>sessionObjectLimits.columns||bytes>sessionObjectLimits.bytes){const value=this.entries.get(key)!;value.columns=[];value.complete=false;}
  }
}
