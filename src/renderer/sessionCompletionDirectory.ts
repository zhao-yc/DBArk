import {completionIdentifier} from '../shared/completionLexical';
import {completionLimits,type CompletionDirectoryRequest,type CompletionMetadataOutput} from '../shared/sqlCompletion';
import type {SessionObjectCompletion} from '../shared/sessionObjects';
interface Directory{load(query:CompletionDirectoryRequest,signal?:AbortSignal):Promise<CompletionMetadataOutput>}
/** 会话覆盖层不缓存查询结果，先确认遮蔽再决定是否读取独立永久目录。 */
export class SessionCompletionDirectory{
  constructor(private readonly permanent:Directory,private readonly lookup:(query:CompletionDirectoryRequest)=>Promise<SessionObjectCompletion>,private readonly revision:number){}
  async load(query:CompletionDirectoryRequest,signal?:AbortSignal):Promise<CompletionMetadataOutput>{
    if(query.kind==='databases'||query.kind==='objects'&&query.objectKind!=='relation')return this.permanent.load(query,signal);
    const local=await this.lookup(query);if(signal?.aborted)throw Object.assign(new Error('补全请求已取消'),{name:'AbortError'});
    if(local.revision!==this.revision)throw new Error('会话对象已变化，请重新触发补全');
    if(![0,1,2].includes(local.caseMode)||local.entries.length>completionLimits.entries||local.entries.some(entry=>!completionIdentifier(entry.name))||local.shadowed.some(name=>!completionIdentifier(name)))throw new Error('会话对象目录格式无效');
    if(query.kind==='columns'&&local.handled)return{entries:local.entries.map(entry=>({...entry})),incomplete:local.incomplete,...(local.incomplete?{sessionUncertain:true}:{})};
    const raw=await this.permanent.load(query,signal);if(query.kind==='columns')return raw;
    const fold=(name:string)=>local.caseMode?name.toLowerCase():name,shadowed=new Set(local.shadowed.map(fold)),entries=[...local.entries,...raw.entries.filter(entry=>!shadowed.has(fold(entry.name)))];
    return{entries:entries.slice(0,completionLimits.entries),incomplete:local.incomplete||raw.incomplete||entries.length>completionLimits.entries};
  }
}
