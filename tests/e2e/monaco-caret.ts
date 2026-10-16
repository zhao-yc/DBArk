import {desktop,page,expect} from './desktop-fixture';
import {modifier} from './live-helpers';

type SavedItem={types:string[];values:Record<string,Blob|Electron.ClipboardBookmark>};
type ClipboardRoot=typeof globalThis&{__dbarkMonacoCaretClipboard?:{items:SavedItem[];text:string}};
type CaretObservation={serial:number;after:number;request?:{serial:number;id:number};expected?:{source:string;offset:number};sourceMatches:boolean;offsetMatches:boolean};
type CaretWindow=Window&{__dbarkMonacoCaretObservation?:CaretObservation};
let completionDeadline=0;

/** 位置证明与原产品断言共用既有13秒预算，不能串联成两个13秒等待。 */
export function remainingCompletionTimeout(limit=13000):number{return Math.max(1,Math.min(limit,completionDeadline-Date.now()));}

/** 仅旁观真实Worker成功发送的快照；必须在创建编辑器及其它Worker观察器之前安装。 */
export async function observeMonacoCaret():Promise<void>{
  await page.evaluate(()=>{
    const root=window as CaretWindow;if(root.__dbarkMonacoCaretObservation)return;
    const state:CaretObservation={serial:0,after:0,sourceMatches:true,offsetMatches:true};root.__dbarkMonacoCaretObservation=state;
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(this:Worker,...args:[message:unknown,options?:Transferable[]|StructuredSerializeOptions]){
      // 保留同一接收者、参数和原异常；不改请求、回复、能力、取消或产品期限。
      const result=Reflect.apply(post,this,args),value=args[0] as {id?:unknown;source?:unknown;offset?:unknown}|null,expected=state.expected;
      if(Number.isInteger(value?.id)&&typeof value?.source==='string'&&Number.isInteger(value?.offset)){
        state.serial++;
        if(expected){state.request={serial:state.serial,id:value!.id as number};state.sourceMatches&&=value.source===expected.source;state.offsetMatches&&=value.offset===expected.offset;}
      }
      return result;
    };
  });
}

/** 由调用者原始marked独立推导期望，不使用定位帮助器返回值或观察到的位置反推答案。 */
export async function triggerMonacoCompletion(marked:string):Promise<void>{
  const marker=marked.indexOf('|');if(marker<0)throw Error('缺少光标标记');
  const expected={source:marked.replace('|','').replaceAll('\r\n','\n'),offset:marked.slice(0,marker).replaceAll('\r\n','\n').length};
  completionDeadline=Date.now()+13000;
  await page.evaluate(expected=>{
    const state=(window as CaretWindow).__dbarkMonacoCaretObservation;if(!state)throw Error('未安装真实光标观察器');
    state.expected=expected;state.after=state.serial;delete state.request;state.sourceMatches=true;state.offsetMatches=true;
  },expected);
  try{
    await page.keyboard.press('Control+Space');
    await expect.poll(()=>page.evaluate(()=>{
      const state=(window as CaretWindow).__dbarkMonacoCaretObservation;
      // 只返回布尔诊断，不把正文、原剪贴板、格式名或内容摘要带出内存。
      return{seen:!!state?.request&&state.request.serial>state.after,sourceMatches:state?.sourceMatches===true,offsetMatches:state?.offsetMatches===true};
    }),{timeout:remainingCompletionTimeout(),message:'真实provider必须发送原marked全文与UTF16光标位置，不能把错误光标当产品补全失败'}).toEqual({seen:true,sourceMatches:true,offsetMatches:true});
  }finally{
    await page.evaluate(()=>{const state=(window as CaretWindow).__dbarkMonacoCaretObservation;if(state)delete state.expected;});
  }
}

/** 只读物化全部可读格式与独立纯文本；两端仅忽略无类型空壳，绝不写回覆盖外部变化。 */
async function checkClipboard(phase:'before'|'after'):Promise<boolean>{
  return desktop.evaluate(async({clipboard},phase)=>{
    const root=globalThis as ClipboardRoot;
    /** 立即物化载荷，不能将读取侧按需getType的条目当作冻结快照。 */
    async function capture(){
      try{
        const items:SavedItem[]=[];
        for(const item of await clipboard.read()){
          const types=[...item.types];if(!types.length)continue;
          if(new Set(types).size!==types.length)throw Error('剪贴板类型枚举不唯一');
          const values:SavedItem['values']={};
          for(const type of types){const value=await item.getType(type);values[type]='arrayBuffer'in value?new Blob([await value.arrayBuffer()],{type:value.type}):{...value};}
          items.push({types,values});
        }
        return{items,text:await clipboard.readText()};
      }catch{
        // 原生API异常可能含格式名或内容路径；只发安全阶段错误，不附带原消息或cause。
        throw Error(phase==='before'?'光标定位前的剪贴板只读完整采集失败':'光标定位后的剪贴板只读完整采集失败');
      }
    }
    if(phase==='before'){
      if(root.__dbarkMonacoCaretClipboard)throw Error('不能交叉占用光标测试剪贴板');
      root.__dbarkMonacoCaretClipboard=await capture();return true;
    }
    const saved=root.__dbarkMonacoCaretClipboard;if(!saved)throw Error('光标测试剪贴板快照丢失');
    try{
      const actual=await capture();let same=actual.items.length===saved.items.length&&actual.text===saved.text;
      for(let index=0;index<saved.items.length;index++){
        const before=saved.items[index],after=actual.items[index];
        if(!after||before.types.length!==after.types.length){same=false;continue;}
        for(const type of before.types){
          if(!after.types.includes(type)){same=false;continue;}
          const a=before.values[type],b=after.values[type];
          const equal='arrayBuffer'in a&&'arrayBuffer'in b?Buffer.from(await a.arrayBuffer()).equals(Buffer.from(await b.arrayBuffer())):JSON.stringify(a)===JSON.stringify(b);
          same=equal&&same;
        }
      }
      return same;
    }finally{
      // 本帮助器零写入；外部变化只报失败，不覆盖其新内容，退出也不承担恢复旧内容的责任。
      delete root.__dbarkMonacoCaretClipboard;
    }
  },phase);
}

/** 用与writeSql相同的原生输入设置正文，仅以文档首和ArrowRight移动，不调用模型或设置光标。 */
export async function positionMonacoCaret(marked:string):Promise<string>{
  const marker=marked.indexOf('|');if(marker<0)throw Error('缺少光标标记');
  const source=marked.replace('|','').replaceAll('\r\n','\n'),prefix=marked.slice(0,marker).replaceAll('\r\n','\n');
  await checkClipboard('before');let operationFailed=false,operationError:unknown;
  try{
    await page.keyboard.press('Escape');
    await page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus();
    await page.keyboard.press(`${modifier}+A`);await page.keyboard.insertText(source);
    await expect.poll(()=>page.evaluate(async()=>{
      const settings=await window.dbark.invoke('settings.get',{});return settings.tabs.find(tab=>tab.id===settings.activeTabId)?.sql?.replaceAll('\r\n','\n');
    })).toBe(source);
    // Cmd+Left会到折行的视图行首，macOS继续使用Cmd+Up到文档首；每个码点只按一次ArrowRight。
    await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowUp':'Control+Home');
    for(const _ of prefix)await page.keyboard.press('ArrowRight');
    // 实际位置在调用者下一次真实触发后由triggerMonacoCompletion独立核对，不再复制前缀。
    return source;
  }catch(error){operationFailed=true;operationError=error;throw error;}finally{
    try{
      // 保留既有严格失败断言；零写入条件下，以完整内容始终未变满足这一合同。
      expect(await checkClipboard('after'),'原剪贴板全部可读格式与纯文本必须恢复').toBe(true);
    }catch(clipboardError){
      if(operationFailed)throw new AggregateError([operationError,clipboardError],'光标定位操作与剪贴板只读核对均失败',{cause:operationError});
      throw clipboardError;
    }
  }
}
