import {desktop,page,expect} from './desktop-fixture';
import {modifier} from './live-helpers';

type SavedItem={types:string[];values:Record<string,Blob|Electron.ClipboardBookmark>};
type ClipboardRoot=typeof globalThis&{__dbarkMonacoCaretClipboard?:{items:SavedItem[];text:string}};
type ExpectedCaret={source:string;prefix:string;lineNumber:number;column:number};
type CaretProof={trustedKey:boolean;apiAvailable:boolean;focusedEditors:number;sourceMatches:boolean;positionMatches:boolean;offsetMatches:boolean;singleCaret:boolean;stable:boolean;readFailed:boolean};
type CaretState={generation:number;armed?:{generation:number;expected:ExpectedCaret};events:number;proof?:CaretProof&{generation:number}};
type CaretWindow=Window&{monaco?:typeof import('monaco-editor');__dbarkMonacoCaretObservation?:CaretState};
let completionDeadline=0;

/** 公开位置证明与原产品断言共用既有13秒预算，不为证明另开等待窗口。 */
export function remainingCompletionTimeout(limit=13000):number{return Math.max(1,Math.min(limit,completionDeadline-Date.now()));}

/** 仅在空白独立fixture启用官方全局API并reload一次；随后捕获真实按键，不拦截Worker。 */
export async function observeMonacoCaret():Promise<void>{
  if(await page.evaluate(()=>!!(window as CaretWindow).__dbarkMonacoCaretObservation))return;
  const empty=await page.evaluate(async()=>{
    const[connections,settings,tasks,records]=await Promise.all([window.dbark.invoke('connections.list',{}),window.dbark.invoke('settings.get',{}),window.dbark.invoke('tasks.list',{}),window.dbark.invoke('history.list',{})]);
    return{connections:connections.length,tabs:settings.tabs.length,tasks:tasks.length,history:records.length};
  });
  expect(empty,'公开API初始化只能在无连接、标签、任务和历史的空工作台进行').toEqual({connections:0,tabs:0,tasks:0,history:0});
  await page.addInitScript(()=>{self.MonacoEnvironment={...self.MonacoEnvironment,globalAPI:true};});
  await page.reload();
  await expect(page.locator('.app-statusbar')).toBeVisible({timeout:15000});
  expect(await page.evaluate(()=>typeof(window as CaretWindow).monaco?.editor?.getEditors==='function'),'安装资源必须提供官方Monaco公开只读API').toBe(true);
  await page.evaluate(()=>{
    const root=window as CaretWindow,state:CaretState={generation:0,events:0};root.__dbarkMonacoCaretObservation=state;
    document.addEventListener('keydown',event=>{
      const armed=state.armed;if(!armed||event.code!=='Space'||!event.ctrlKey)return;
      state.events++;
      const proof:CaretProof={trustedKey:event.isTrusted&&!event.repeat&&!event.metaKey&&!event.altKey&&!event.shiftKey,apiAvailable:false,focusedEditors:0,sourceMatches:false,positionMatches:false,offsetMatches:false,singleCaret:false,stable:false,readFailed:false};
      try{
        const api=root.monaco;proof.apiAvailable=typeof api?.editor?.getEditors==='function';
        if(proof.apiAvailable){
          /** 与Playwright可见性一致，隐藏或已脱离DOM的旧编辑器不能充当当前模型。 */
          const visible=(element:Element)=>{const style=getComputedStyle(element);return element.getClientRects().length>0&&style.visibility!=='hidden'&&style.visibility!=='collapse';};
          const editors=api!.editor.getEditors().filter(editor=>{
            const node=editor.getContainerDomNode(),query=node.closest('.query-tab'),wrap=query?.querySelector('.sql-editor-wrap');
            return node.isConnected&&!!query&&!!wrap?.contains(node)&&visible(node)&&visible(query)&&node.contains(event.target as Node|null)&&editor.hasTextFocus();
          });
          proof.focusedEditors=editors.length;
          if(editors.length===1){
            const editor=editors[0],model=editor.getModel(),position=editor.getPosition();
            if(model&&!model.isDisposed()&&position){
              // 所有getter均在同一次原生keydown捕获阶段同步执行，不让await或旧请求介入。
              const version=model.getVersionId(),eol=model.getEOL(),actual=model.getValue(),offset=model.getOffsetAt(position),selections=editor.getSelections(),expected=armed.expected;
              if(eol==='\n'||eol==='\r\n'){
                proof.sourceMatches=actual===expected.source.replaceAll('\n',eol);
                proof.positionMatches=position.lineNumber===expected.lineNumber&&position.column===expected.column;
                proof.offsetMatches=offset===expected.prefix.replaceAll('\n',eol).length;
              }
              proof.singleCaret=selections?.length===1&&selections[0].isEmpty()&&selections[0].positionLineNumber===position.lineNumber&&selections[0].positionColumn===position.column;
              const endPosition=editor.getPosition();
              proof.stable=editor.getModel()===model&&!model.isDisposed()&&model.getVersionId()===version&&endPosition?.lineNumber===position.lineNumber&&endPosition?.column===position.column;
            }
          }
        }
      }catch{proof.readFailed=true;}
      // 只留本次generation的布尔/计数；不preventDefault、不修改事件、模型或光标。
      state.proof={generation:armed.generation,...proof};
    },true);
  });
}

/** 原marked独立给出全文与位置期望；只用本次真实按键的同步快照证明当前状态。 */
export async function triggerMonacoCompletion(marked:string):Promise<void>{
  const marker=marked.indexOf('|');if(marker<0)throw Error('缺少光标标记');
  const source=marked.replace('|','').replaceAll('\r\n','\n'),prefix=marked.slice(0,marker).replaceAll('\r\n','\n'),lines=prefix.split('\n');
  const expected:ExpectedCaret={source,prefix,lineNumber:lines.length,column:lines.at(-1)!.length+1};completionDeadline=Date.now()+13000;
  await page.evaluate(expected=>{
    const state=(window as CaretWindow).__dbarkMonacoCaretObservation;if(!state)throw Error('未安装真实光标观察器');
    state.armed={generation:++state.generation,expected};state.events=0;delete state.proof;
  },expected);
  try{
    await page.keyboard.press('Control+Space');
    const actual=await page.evaluate(()=>{
      const state=(window as CaretWindow).__dbarkMonacoCaretObservation,proof=state?.proof;
      return{captured:state?.events===1&&proof?.generation===state?.armed?.generation,trustedKey:proof?.trustedKey===true,apiAvailable:proof?.apiAvailable===true,focusedEditors:proof?.focusedEditors??0,sourceMatches:proof?.sourceMatches===true,positionMatches:proof?.positionMatches===true,offsetMatches:proof?.offsetMatches===true,singleCaret:proof?.singleCaret===true,stable:proof?.stable===true,readFailed:proof?.readFailed!==false};
    });
    expect(actual,'真实Control+Space时唯一可见编辑器的全文、位置与UTF16 offset必须符合原marked').toEqual({captured:true,trustedKey:true,apiAvailable:true,focusedEditors:1,sourceMatches:true,positionMatches:true,offsetMatches:true,singleCaret:true,stable:true,readFailed:false});
  }finally{
    await page.evaluate(()=>{const state=(window as CaretWindow).__dbarkMonacoCaretObservation;if(state){delete state.armed;delete state.proof;state.events=0;}});
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
    // 实际位置在调用者下一次真实按键的捕获阶段由公开只读API独立核对，不再复制前缀。
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
