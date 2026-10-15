import {completionLimits} from './sqlCompletion';

/** 所有位置均为编辑器使用的UTF-16半开区间；引用名保留解码后的单个名称。 */
export interface CompletionToken{kind:'identifier'|'word'|'number'|'symbol'|'string';start:number;end:number;value:string;depth:number;closed:boolean}
export interface CompletionLexicalMode{ansiQuotes?:boolean;noBackslashEscapes?:boolean}
export interface CompletionLexicalContext{
  status:'ready';statement:{start:number;end:number};tokens:CompletionToken[];
  target:{start:number;end:number;prefix:string;qualifiers:string[];quoted:boolean};
}
export type CompletionLexicalResult=CompletionLexicalContext|{status:'blocked';reason:'budget'|'position'|'ambiguous'|'string'|'comment'|'directive'|'executable-comment'|'identifier'};
interface Region{start:number;end:number;kind:'comment'|'directive';open:boolean}
interface Statement{start:number;end:number;tokens:CompletionToken[];executable:boolean}
const space=(value:string|undefined)=>value!==undefined&&/[\x09-\x0d\x20]/.test(value);
const nameCharacter=(value:string|undefined)=>value!==undefined&&/[A-Za-z0-9_$\u0080-\uffff]/.test(value);
/** MySQL标识符使用BMP且不含NUL；不把表情或孤立代理项转成另一个名称。 */
export function completionIdentifier(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=64&&!/[\0\ud800-\udfff]/.test(value);}
/** 输出别名独立于库表列的64字限制；目录请求继续使用物理名称预算。 */
export function completionAliasIdentifier(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=completionLimits.aliasUnits&&!/[\0\ud800-\udfff]/.test(value);}
export function quoteCompletionAlias(value:string):string{if(!completionAliasIdentifier(value))throw Error('补全输出别名无效');return '`'+value.replaceAll('`','``')+'`';}
/** 引用名按每个限定段独立编码，名称内的点号保持普通字符。 */
export function quoteCompletionIdentifier(value:string):string{if(!completionIdentifier(value))throw Error('补全标识符无效');return '`'+value.replaceAll('`','``')+'`';}
const blocked=(reason:Extract<CompletionLexicalResult,{status:'blocked'}>['reason']):CompletionLexicalResult=>({status:'blocked',reason});

/** 单个确定模式的纯词法扫描，不执行SQL、不读取连接，也不记录用户文本。 */
function scan(source:string,offset:number,ansiQuotes:boolean,noBackslashEscapes:boolean,prefixUnits:number):CompletionLexicalResult{
  const statements:Statement[]=[],regions:Region[]=[];let current:Statement={start:0,end:source.length,tokens:[],executable:false};
  let index=0,depth=0,total=0,delimiter=';',lineStart=true,hasCode=false;
  /** 限制全文件token数与括号深度，避免大脚本在每次键盘输入时无限分配。 */
  function add(kind:CompletionToken['kind'],start:number,end:number,value:string,closed=true):boolean{
    if(++total>completionLimits.tokens)return false;
    current.tokens.push({kind,start,end,value,depth,closed});hasCode=true;return true;
  }
  while(index<source.length){
    // 客户端DELIMITER仅在独立行且当前语句无代码时生效，注释/字符串不能伪造指令。
    if(lineStart&&!hasCode){
      const end=source.indexOf('\n',index),lineEnd=end<0?source.length:end+1,line=source.slice(index,lineEnd);
      const directive=/^[\t\r ]*DELIMITER[\t ]+(\S+)[\t\r ]*(?:\n)?$/i.exec(line);
      if(directive){
        if(directive[1].length>16||/["'`\\]/.test(directive[1]))return blocked('directive');
        regions.push({start:index,end:lineEnd,kind:'directive',open:end<0});delimiter=directive[1];index=lineEnd;current.start=index;lineStart=true;continue;
      }
    }
    const char=source[index],next=source[index+1];
    if(source.startsWith(delimiter,index)){
      current.end=index;statements.push(current);index+=delimiter.length;current={start:index,end:source.length,tokens:[],executable:false};depth=0;hasCode=false;lineStart=false;continue;
    }
    if(space(char)){lineStart=char==='\n'||lineStart;index++;continue;}
    lineStart=false;
    if(char==='#'||char==='-'&&next==='-'&&/[\x00-\x20\x7f]/.test(source[index+2]??' ')){
      const start=index,end=source.indexOf('\n',index);index=end<0?source.length:end;
      regions.push({start,end:index,kind:'comment',open:true});continue;
    }
    if(char==='/'&&next==='*'){
      const start=index,end=source.indexOf('*/',index+2);index=end<0?source.length:end+2;
      if(source[start+2]==='!'||source.slice(start+2,start+4)==='M!'){current.executable=true;hasCode=true;}
      regions.push({start,end:index,kind:'comment',open:end<0});continue;
    }
    if(char==='`'||char==='"'||char==="'"){
      const start=index++,identifier=char==='`'||char==='"'&&ansiQuotes;let value='',closed=false;
      while(index<source.length){
        const item=source[index++];
        if(item===char){if(source[index]===char){value+=char;index++;}else{closed=true;break;}}
        else if(item==='\\'&&!identifier&&!noBackslashEscapes&&index<source.length){value+=item+source[index++];}
        else value+=item;
      }
      if(!add(identifier?'identifier':'string',start,index,identifier?value:'',closed))return blocked('budget');
      continue;
    }
    if(nameCharacter(char)){
      const start=index++;while(nameCharacter(source[index])&&!source.startsWith(delimiter,index))index++;
      const value=source.slice(start,index);
      // 1e10等是数值；带字母的普通名称保持整体，不能把数字前缀误当库名。
      if(!add(/^(?:\d+(?:e\d+)?|0x[\da-f]+|0b[01]+)$/i.test(value)?'number':'word',start,index,value))return blocked('budget');continue;
    }
    if(char===')')depth=Math.max(0,depth-1);
    if(!add('symbol',index,index+1,char))return blocked('budget');
    if(char==='('&&++depth>completionLimits.depth)return blocked('budget');index++;
  }
  statements.push(current);
  const region=regions.find(item=>offset>=item.start&&(offset<item.end||item.open&&offset===item.end));
  if(region)return blocked(region.kind);
  const statement=statements.find(item=>offset>=item.start&&offset<=item.end);
  if(!statement)return blocked('directive');
  if(statement.executable)return blocked('executable-comment');
  const token=statement.tokens.find(item=>offset>=item.start&&(offset<item.end||offset===item.end&&(item.kind==='word'||item.kind==='identifier'||!item.closed)));
  if(token?.kind==='string')return blocked('string');
  if(token&&(token.kind==='number'||token.kind==='symbol'&&offset>token.start))return blocked('identifier');
  let start=offset,end=offset,prefix='',quoted=false;
  if(token&&(token.kind==='word'||token.kind==='identifier')){
    start=token.start;end=token.end;quoted=token.kind==='identifier';
    if(quoted){
      // 未闭合名称只在文本末端提供补全，避免一次选择吞掉后方本应保留的SQL。
      if(!token.closed&&offset!==token.end)return blocked('identifier');
      const quote=source[start],bodyStart=start+1,bodyEnd=token.closed?end-1:end;
      // 光标在一对转义引号中间时没有合法的半个字符编辑。
      if(offset<bodyStart||offset<bodyEnd&&source[offset]===quote&&source[offset-1]===quote){
        let run=offset-1;while(run>=bodyStart&&source[run]===quote)run--;
        if(offset<bodyStart||(offset-run)%2===0)return blocked('identifier');
      }
      prefix=source.slice(bodyStart,Math.min(offset,bodyEnd)).replaceAll(quote+quote,quote);
    }else prefix=source.slice(start,offset);
    if(prefix.length>prefixUnits||prefix.includes('\0')||/[\ud800-\udfff]/.test(prefix))return blocked('identifier');
  }
  const before=statement.tokens.filter(item=>item.end<=start),qualifiers:string[]=[];
  for(let position=before.length-1;position>=0&&before[position].value==='.';position-=2){
    const previous=before[position-1];
    if(!previous||!['identifier','word'].includes(previous.kind)||!completionIdentifier(previous.value)||qualifiers.length>=2)return blocked('identifier');
    qualifiers.unshift(previous.value);
  }
  return{status:'ready',statement:{start:statement.start,end:statement.end},tokens:statement.tokens,target:{start,end,prefix,qualifiers,quoted}};
}

/** 未知会话模式分别扫描四种组合；仅当前语句及编辑范围完全一致时提供候选。 */
export function completionLexicalContext(source:string,offset:number,mode:CompletionLexicalMode={},prefixUnits:number=completionLimits.prefixUnits):CompletionLexicalResult{
  if(![completionLimits.prefixUnits,completionLimits.aliasUnits].includes(prefixUnits as 64|256))return blocked('budget');
  if(!Number.isInteger(offset)||offset<0||offset>source.length)return blocked('position');
  if(source.length>completionLimits.sourceUnits)return blocked('budget');
  if(source.includes('\0'))return blocked('identifier');
  const results:CompletionLexicalResult[]=[];
  for(const quotes of mode.ansiQuotes===undefined?[false,true]:[mode.ansiQuotes])for(const escapes of mode.noBackslashEscapes===undefined?[false,true]:[mode.noBackslashEscapes])results.push(scan(source,offset,quotes,escapes,prefixUnits));
  const first=JSON.stringify(results[0]);return results.every(value=>JSON.stringify(value)===first)?results[0]:blocked('ambiguous');
}
