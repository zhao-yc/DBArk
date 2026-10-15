import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it} from 'vitest';

type Payload=Blob|{title:string;url:string};
type Entry=Record<string,Payload>;
interface Options{
  platform?:'win32'|'darwin';emptyRead?:'none'|'one';surroundEmpty?:boolean;
  operationFails?:boolean;operationError?:unknown;writeError?:Error;clearError?:Error;
  transform?:(entries:Entry[])=>Entry[];restoredText?:string;
}
const marked='SELECT a| FROM q',source=marked.replace('|',''),prefix=source.slice(0,marked.indexOf('|'));
const helperSource=readFileSync(new URL('../e2e/monaco-caret.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(helperSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const blob=(value:string,type='text/plain')=>new Blob([value],{type});

/** 只替换剪贴板API与键盘/设置边界，整个正式帮助器及其evaluate回调在VM原样执行。 */
function replay(initial:Entry[],options:Options={}){
  let current=initial.map(entry=>({...entry})),restoring=false;
  const writes:Entry[][]=[],keys:string[]=[];
  class ClipboardItem{
    readonly types:string[];
    constructor(readonly entries:Entry){this.types=Object.keys(entries);}
    async getType(type:string){if(!Object.hasOwn(this.entries,type))throw Error('合成条目缺少原类型');return this.entries[type];}
  }
  const clipboard={
    async read(){
      let entries=current.length?current:options.emptyRead==='none'?[]:[{}];
      if(options.surroundEmpty)entries=[{},...entries,{}];
      return entries.map(entry=>new ClipboardItem({...entry}));
    },
    async readText(){
      if(restoring&&options.restoredText!==undefined)return options.restoredText;
      const value=current.find(entry=>Object.hasOwn(entry,'text/plain'))?.['text/plain'];
      return value instanceof Blob?value.text():'';
    },
    async write(items:ClipboardItem[]){
      restoring=true;if(options.writeError)throw options.writeError;
      const entries=await Promise.all(items.map(async item=>Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)])))));
      writes.push(entries);current=options.transform?options.transform(entries):entries;
    },
    async writeText(value:string){restoring=false;current=[{'text/plain':blob(value)}];},
    clear(){restoring=true;if(options.clearError)throw options.clearError;current=[];}
  };
  const desktop={evaluate:async(callback:(api:{clipboard:typeof clipboard;ClipboardItem:typeof ClipboardItem},argument:unknown)=>unknown,argument?:unknown)=>callback({clipboard,ClipboardItem},argument)};
  const page={
    locator:()=>({getByRole:()=>({focus:async()=>undefined})}),
    evaluate:async()=>source,
    keyboard:{press:async(key:string)=>{
      keys.push(key);if(key==='Escape'&&options.operationFails)throw options.operationError;
      // 复制边界仅提供本例公开前缀；不模拟Monaco算法，不派发系统按键或访问系统剪贴板。
      if(key.endsWith('+C'))await clipboard.writeText(prefix);
    }}
  };
  const platform=options.platform??'win32',context=createContext({Buffer,Error,AggregateError,process:{platform}});
  const module:{exports:{positionMonacoCaret?:(text:string)=>Promise<string>}}={exports:{}};
  const requireBoundary=(name:string)=>{
    if(name==='node:crypto')return{createHash};
    if(name==='./desktop-fixture')return{desktop,page,expect};
    if(name==='./live-helpers')return{modifier:platform==='darwin'?'Meta':'Control'};
    throw Error('纯回放禁止加载其它模块：'+name);
  };
  const execute=runInContext('(function(require,module,exports){'+compiled+'\n})',context) as (require:typeof requireBoundary,module:unknown,exports:unknown)=>void;
  execute(requireBoundary,module,module.exports);
  if(!module.exports.positionMonacoCaret)throw Error('未加载正式光标帮助器');
  return{run:()=>module.exports.positionMonacoCaret!(marked),writes,keys,clipboard,context};
}

/** 观察实际写回内容的每种类型和字节，不复制正式规范化或恢复判断算法。 */
async function bytes(entries:Entry[]){
  return Promise.all(entries.map(async entry=>Object.fromEntries(await Promise.all(Object.entries(entry).map(async([type,value])=>[type,value instanceof Blob?Buffer.from(await value.arrayBuffer()).toString('hex'):value])))));
}

describe('Monaco光标帮助器的纯剪贴板回放',()=>{
  it.each([
    {label:'真正空数组',items:[],emptyRead:'none' as const},
    {label:'空剪贴板单item',items:[{}],emptyRead:'one' as const},
    {label:'多个无类型空item',items:[{},{},{}],emptyRead:'one' as const},
    {label:'清空后API返回单空item',items:[],emptyRead:'one' as const}
  ])('$label按同一无可读格式语义恢复',async({items,emptyRead})=>{
    const h=replay(items,{emptyRead});await expect(h.run()).resolves.toBe(source);
    expect(h.writes).toEqual([]);expect(await h.clipboard.readText()).toBe('');
  });

  it.each(['win32','darwin'] as const)('%s有type的空文本仍写回并核对零字节',async platform=>{
    const h=replay([{'text/plain':blob('')}],{platform});await expect(h.run()).resolves.toBe(source);
    expect(h.writes).toHaveLength(1);expect(await bytes(h.writes[0])).toEqual([{'text/plain':''}]);
    expect(h.keys).toContain(platform==='darwin'?'Meta+ArrowUp':'Control+Home');
    expect(h.context.__dbarkMonacoCaretClipboard).toBeUndefined();
  });

  it('有type的零长度富文本与图片不会按空item丢弃',async()=>{
    const initial=[{'text/plain':blob(''),'text/html':blob('','text/html'),'image/png':new Blob([],{type:'image/png'})}];
    const h=replay(initial);await h.run();expect(await bytes(h.writes[0])).toEqual([{'text/plain':'','text/html':'','image/png':''}]);
  });

  it('非空文本、富文本、图片和书签保留全部原类型、字节及纯文本',async()=>{
    const initial=[{'text/plain':blob('中文🙂\0'),'text/html':blob('<b>中文🙂</b>','text/html'),'image/png':new Blob([new Uint8Array([0,1,128,255])],{type:'image/png'}),'electron application/bookmark':{title:'公开书签',url:'https://example.test/'}}];
    const expected=await bytes(initial),h=replay(initial);await h.run();expect(await bytes(h.writes[0])).toEqual(expected);expect(await h.clipboard.readText()).toBe('中文🙂\0');
  });

  it('多item只忽略无类型空壳，不遗漏任何非空条目的原始格式',async()=>{
    const text={'text/plain':blob('第一条')},html={'text/html':blob('<p>第二条</p>','text/html')},image={'image/png':new Blob([new Uint8Array([0,255])],{type:'image/png'})};
    const h=replay([{},text,{},html,image,{}],{surroundEmpty:true});await h.run();
    expect(h.writes[0]).toHaveLength(3);expect(await bytes(h.writes[0])).toEqual(await bytes([text,html,image]));expect(await h.clipboard.readText()).toBe('第一条');
  });

  it.each(['删除空文本类型','删除富文本类型','改变图片字节','改变原纯文本读取'])('恢复损坏不能通过：%s',async mode=>{
    const initial=[{'text/plain':blob(''),'text/html':blob('<b>原文</b>','text/html'),'image/png':new Blob([new Uint8Array([0,1,255])],{type:'image/png'})}];
    const h=replay(initial,{restoredText:mode==='改变原纯文本读取'?'额外文本':undefined,transform:entries=>entries.map(entry=>{
      const result={...entry};
      if(mode==='删除空文本类型')delete result['text/plain'];
      if(mode==='删除富文本类型')delete result['text/html'];
      if(mode==='改变图片字节')result['image/png']=new Blob([new Uint8Array([0,1,254])],{type:'image/png'});
      return result;
    })});
    await expect(h.run()).rejects.toThrow('原剪贴板全部可读格式与纯文本必须恢复');
  });

  it('仅定位操作失败时恢复仍执行，原异常对象不变',async()=>{
    const error=Error('合成原定位失败'),h=replay([{'text/plain':blob('原文本')}],{operationFails:true,operationError:error});
    await expect(h.run()).rejects.toBe(error);expect(await h.clipboard.readText()).toBe('原文本');
  });

  it('仅恢复API失败时保留其原异常对象',async()=>{
    const error=Error('合成写回失败'),h=replay([{'text/plain':blob('原文本')}],{writeError:error});
    await expect(h.run()).rejects.toBe(error);
  });

  it('原定位与恢复核对均失败时用AggregateError保留两份原因',async()=>{
    const error=Error('合成原操作失败'),h=replay([{'text/plain':blob('原文本')}],{operationFails:true,operationError:error,restoredText:'不同文本'});
    const result=await h.run().catch(reason=>reason);
    expect(result).toBeInstanceOf(AggregateError);expect(result.message).toBe('光标定位操作与剪贴板恢复均失败');
    expect(result.cause).toBe(error);expect(result.errors).toHaveLength(2);expect(result.errors[0]).toBe(error);expect(result.errors[1].message).toContain('原剪贴板全部可读格式与纯文本必须恢复');
  });

  it('原操作与恢复API同时失败时两份原异常对象都保留',async()=>{
    const operation=Error('合成操作失败'),restoration=Error('合成清理失败');
    const h=replay([{'text/plain':blob('原文本')}],{operationFails:true,operationError:operation,writeError:restoration});
    const result=await h.run().catch(reason=>reason);expect(result).toBeInstanceOf(AggregateError);expect(result.cause).toBe(operation);expect(result.errors).toEqual([operation,restoration]);
  });

  it('原操作抛出null也不会被误判为没有失败',async()=>{
    const restoration=Error('合成空剪贴板清理失败'),h=replay([],{operationFails:true,operationError:null,clearError:restoration});
    const result=await h.run().catch(reason=>reason);expect(result).toBeInstanceOf(AggregateError);expect(result.cause).toBeNull();expect(result.errors).toEqual([null,restoration]);
  });
});
