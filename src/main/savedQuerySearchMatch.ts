import{createHash}from'node:crypto';
import{savedQueryRecordSchema,savedQuerySearchInputSchema,savedQuerySearchLimits as limits,type SavedQuerySearchInput,type SavedQuerySearchHit,type SavedQueryMatch,type SavedQuerySqlOccurrences}from'../shared/savedQuerySearch';
import{savedQueryPageLimits,type SavedQueryPageEntry}from'../shared/savedQueryPages';

/** 本地匹配采用JavaScript Unicode正则语义，与数据库服务器正则明确分开；普通文字先完整转义。 */
export function compileSavedQueryPattern(raw:SavedQuerySearchInput){const input=savedQuerySearchInputSchema.parse(raw),pattern=input.pattern;const source=pattern.mode==='regexp'?pattern.text:pattern.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');try{return{input,expression:new RegExp(source,pattern.caseSensitive?'u':'iu')};}catch{throw Error('本地Unicode正则无效，请检查括号、转义及表达式语法');}}
/** 记录错误只显示有界字段路径，不回显JSON原文或由运行时生成的英文片段。 */
export function parseSavedQueryRecord(id:string,raw:string){if(Buffer.byteLength(raw)>limits.recordBytes)throw Error('保存查询记录超过128MiB，未把截断内容当作无命中');let value:unknown;try{value=JSON.parse(raw);}catch{throw Error('保存查询记录JSON无效，未检索或打开原文');}const parsed=savedQueryRecordSchema.safeParse(value);if(!parsed.success)throw Error('保存查询记录结构无效：'+parsed.error.issues.slice(0,4).map(issue=>issue.path.join('.')||'记录').join('、'));if(parsed.data.id!==id)throw Error('保存查询标识与本地索引不一致');return parsed.data;}
/** 按UTF16位置计算Monaco的1起始行列，CRLF计一行，预览不复制完整SQL。 */
function location(source:string,offset:number,length:number,field:'name'|'sql'):SavedQueryMatch{let line=1,column=1;for(let index=0;index<offset;index++){if(source[index]==='\r'){if(source[index+1]==='\n'&&index+1<offset)index++;line++;column=1;}else if(source[index]==='\n'){line++;column=1;}else column++;}let start=Math.max(0,offset-64),end=Math.min(source.length,start+limits.previewUnits);if(start>0&&/[\udc00-\udfff]/.test(source[start])&&/[\ud800-\udbff]/.test(source[start-1]))start++;if(end<source.length&&/[\ud800-\udbff]/.test(source[end-1])&&/[\udc00-\udfff]/.test(source[end]))end--;return{field,line,column,offset,length,preview:source.slice(start,end),previewTruncated:start>0||end<source.length};}
/** 仅匹配Worker调用：不重扫首处，零宽命中按Unicode码点前进，额外探一处以明确上限。 */
function sqlOccurrences(source:string,first:RegExpExecArray,compiled:ReturnType<typeof compileSavedQueryPattern>):SavedQuerySqlOccurrences{
 const ranges:SavedQuerySqlOccurrences['ranges']=[],expression=new RegExp(compiled.expression.source,compiled.expression.flags+'g');let match:RegExpExecArray|null=first;
 while(match){if(ranges.length===limits.sqlMatches)return{ranges,limitReached:true};ranges.push({offset:match.index,length:match[0].length});if(compiled.input.pattern.mode==='whole'||compiled.input.pattern.mode==='prefix')break;
  let next=match.index+match[0].length;if(!match[0].length){if(next===source.length)break;next+=(source.codePointAt(next)??0)>0xffff?2:1;}expression.lastIndex=next;match=expression.exec(source);
 }
 return{ranges,limitReached:false};
}
/** 一次只处理一条本地JSON记录；文本从不作为SQL或JavaScript代码执行。 */
export function matchSavedQueryRecord(id:string,raw:string,compiled:ReturnType<typeof compileSavedQueryPattern>):SavedQuerySearchHit|undefined{
 const query=parseSavedQueryRecord(id,raw),input=compiled.input;
 if(input.scope.kind==='connection'&&query.connectionId!==input.scope.connectionId||input.scope.kind==='unbound'&&query.connectionId!==undefined)return;
 const filter=input.database,context=query.databaseContext;if(filter.kind==='known'&&(context?.state!=='known'||context.database!==filter.database)||filter.kind==='unknown'&&context?.state!=='unknown'||filter.kind==='legacy'&&context!==undefined)return;
 const matches:SavedQueryMatch[]=[];let occurrences:SavedQuerySqlOccurrences|undefined;for(const field of input.fields){const source=query[field],match=compiled.expression.exec(source);if(!match)continue;if(input.pattern.mode==='whole'&&(match.index!==0||match[0].length!==source.length)||input.pattern.mode==='prefix'&&match.index!==0)continue;matches.push(location(source,match.index,match[0].length,field));if(field==='sql')occurrences=sqlOccurrences(source,match,compiled);}
 if(!matches.length)return;const{sql,...summary}=query;return{query:summary,digest:createHash('sha256').update(raw).digest('hex'),matches,...(occurrences?{sqlOccurrences:occurrences}:{})};
}

/** 列表只做普通文字筛选，完整正文在线程内比较，预览不拆开Unicode代理对。 */
export function summarizeSavedQueryRecord(id:string,raw:string,search:string):SavedQueryPageEntry|undefined{
 const query=parseSavedQueryRecord(id,raw),needle=search.toLowerCase();if(needle&&!query.name.toLowerCase().includes(needle)&&!query.sql.toLowerCase().includes(needle))return;
 let end=Math.min(query.sql.length,savedQueryPageLimits.previewUnits);if(end<query.sql.length&&/[\ud800-\udbff]/.test(query.sql[end-1])&&/[\udc00-\udfff]/.test(query.sql[end]))end--;
 const{sql,...summary}=query;return{query:summary,digest:createHash('sha256').update(raw).digest('hex'),sqlPreview:sql.slice(0,end),sqlUnits:sql.length,previewTruncated:end<sql.length};
}
