import{createHash}from'node:crypto';
import{savedQueryRecordSchema,savedQuerySearchInputSchema,savedQuerySearchLimits as limits,type SavedQuerySearchInput,type SavedQuerySearchHit,type SavedQueryMatch}from'../shared/savedQuerySearch';

/** 本地匹配采用JavaScript Unicode正则语义，与数据库服务器正则明确分开；普通文字先完整转义。 */
export function compileSavedQueryPattern(raw:SavedQuerySearchInput){const input=savedQuerySearchInputSchema.parse(raw),pattern=input.pattern;const source=pattern.mode==='regexp'?pattern.text:pattern.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');try{return{input,expression:new RegExp(source,pattern.caseSensitive?'u':'iu')};}catch{throw Error('本地Unicode正则无效，请检查括号、转义及表达式语法');}}
/** 记录错误只显示有界字段路径，不回显JSON原文或由运行时生成的英文片段。 */
export function parseSavedQueryRecord(id:string,raw:string){if(Buffer.byteLength(raw)>limits.recordBytes)throw Error('保存查询记录超过128MiB，未把截断内容当作无命中');let value:unknown;try{value=JSON.parse(raw);}catch{throw Error('保存查询记录JSON无效，未检索或打开原文');}const parsed=savedQueryRecordSchema.safeParse(value);if(!parsed.success)throw Error('保存查询记录结构无效：'+parsed.error.issues.slice(0,4).map(issue=>issue.path.join('.')||'记录').join('、'));if(parsed.data.id!==id)throw Error('保存查询标识与本地索引不一致');return parsed.data;}
/** 按UTF16位置计算Monaco的1起始行列，CRLF计一行，预览不复制完整SQL。 */
function location(source:string,offset:number,length:number,field:'name'|'sql'):SavedQueryMatch{let line=1,column=1;for(let index=0;index<offset;index++){if(source[index]==='\r'){if(source[index+1]==='\n'&&index+1<offset)index++;line++;column=1;}else if(source[index]==='\n'){line++;column=1;}else column++;}let start=Math.max(0,offset-64),end=Math.min(source.length,start+limits.previewUnits);if(start>0&&/[\udc00-\udfff]/.test(source[start])&&/[\ud800-\udbff]/.test(source[start-1]))start++;if(end<source.length&&/[\ud800-\udbff]/.test(source[end-1])&&/[\udc00-\udfff]/.test(source[end]))end--;return{field,line,column,offset,length,preview:source.slice(start,end),previewTruncated:start>0||end<source.length};}
/** 一次只处理一条本地JSON记录；文本从不作为SQL或JavaScript代码执行。 */
export function matchSavedQueryRecord(id:string,raw:string,compiled:ReturnType<typeof compileSavedQueryPattern>):SavedQuerySearchHit|undefined{
 const query=parseSavedQueryRecord(id,raw),input=compiled.input;
 if(input.scope.kind==='connection'&&query.connectionId!==input.scope.connectionId||input.scope.kind==='unbound'&&query.connectionId!==undefined)return;
 const filter=input.database,context=query.databaseContext;if(filter.kind==='known'&&(context?.state!=='known'||context.database!==filter.database)||filter.kind==='unknown'&&context?.state!=='unknown'||filter.kind==='legacy'&&context!==undefined)return;
 const matches:SavedQueryMatch[]=[];for(const field of input.fields){const source=query[field],match=compiled.expression.exec(source);if(!match)continue;if(input.pattern.mode==='whole'&&(match.index!==0||match[0].length!==source.length)||input.pattern.mode==='prefix'&&match.index!==0)continue;matches.push(location(source,match.index,match[0].length,field));}
 if(!matches.length)return;const{sql,...summary}=query;return{query:summary,digest:createHash('sha256').update(raw).digest('hex'),matches};
}
