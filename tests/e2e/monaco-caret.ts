import {createHash} from 'node:crypto';
import {desktop,page,expect} from './desktop-fixture';
import {modifier} from './live-helpers';

type ClipboardRoot=typeof globalThis&{__dbarkMonacoCaretClipboard?:{items:Electron.ClipboardItem[];text:string}};
/** 失败只比较原文长度和摘要，不把SQL或用户原剪贴板写到诊断中。 */
const fingerprint=(value:string)=>({units:value.length,sha256:createHash('sha256').update(value).digest('hex')});

/** 用原生键盘到达文档标记，并通过选中/复制前缀核对真实位置；不设置Monaco模型或光标。 */
export async function positionMonacoCaret(marked:string):Promise<string>{
  const offset=marked.indexOf('|');if(offset<0)throw Error('缺少光标标记');const source=marked.replace('|',''),prefix=source.slice(0,offset).replaceAll('\r\n','\n');
  // 全部可读格式留在主进程内存，不能只保存纯文本而丢失用户原有图片或富文本。
  await desktop.evaluate(async({clipboard,ClipboardItem})=>{
    const root=globalThis as ClipboardRoot;if(root.__dbarkMonacoCaretClipboard)throw Error('不能交叉占用光标测试剪贴板');
    // Electron空剪贴板也可返回types为空的item；两端只规范化这种空壳，保留有类型的零字节值。
    const readable=(await clipboard.read()).filter(item=>item.types.length>0);
    const entries=await Promise.all(readable.map(async item=>Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)])))));
    root.__dbarkMonacoCaretClipboard={items:entries.map(entry=>new ClipboardItem(entry)),text:await clipboard.readText()};
  });
  let operationFailed=false,operationError:unknown;
  try{
    await page.keyboard.press('Escape');await desktop.evaluate(({clipboard},value)=>clipboard.writeText(value),source);
    await page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus();await page.keyboard.press(`${modifier}+A`);await page.keyboard.press(`${modifier}+V`);
    await expect.poll(()=>page.evaluate(async()=>{const settings=await window.dbark.invoke('settings.get',{});return settings.tabs.find(tab=>tab.id===settings.activeTabId)?.sql?.replaceAll('\r\n','\n');})).toBe(source.replaceAll('\r\n','\n'));
    // Monaco的Cmd+Left是视图行首；开启自动折行时必须用Cmd+Up到文档首。
    await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowUp':'Control+Home');for(const _ of prefix)await page.keyboard.press('ArrowRight');
    if(prefix.length){
      await page.keyboard.press(process.platform==='darwin'?'Meta+Shift+ArrowUp':'Control+Shift+Home');
      // 先清空临时文本，防止标记位于文末时把先前粘贴源误当成复制已发生。
      await desktop.evaluate(({clipboard})=>clipboard.writeText(''));await page.keyboard.press(`${modifier}+C`);
      await expect.poll(async()=>fingerprint((await desktop.evaluate(({clipboard})=>clipboard.readText())).replaceAll('\r\n','\n')),{message:'原生选中前缀必须精确到达标记，不能把错误光标当产品补全失败'}).toEqual(fingerprint(prefix));
      // 非空选区向右折叠回末端，恢复原标记处的实际插入点。
      await page.keyboard.press('ArrowRight');
    }
    return source;
  }catch(error){operationFailed=true;operationError=error;throw error;}finally{
    try{
      const restored=await desktop.evaluate(async({clipboard})=>{
        const root=globalThis as ClipboardRoot,saved=root.__dbarkMonacoCaretClipboard;if(!saved)throw Error('光标测试剪贴板快照丢失');
        if(saved.items.length)await clipboard.write(saved.items);else clipboard.clear();
        const actual=(await clipboard.read()).filter(item=>item.types.length>0);let same=actual.length===saved.items.length;
        for(let index=0;same&&index<saved.items.length;index++)for(const type of saved.items[index].types){
          if(!actual[index].types.includes(type)){same=false;break;}
          const before=await saved.items[index].getType(type),after=await actual[index].getType(type);
          same&&='arrayBuffer'in before&&'arrayBuffer'in after?Buffer.from(await before.arrayBuffer()).equals(Buffer.from(await after.arrayBuffer())):JSON.stringify(before)===JSON.stringify(after);
        }
        same&&=await clipboard.readText()===saved.text;delete root.__dbarkMonacoCaretClipboard;return same;
      });
      expect(restored,'原剪贴板全部可读格式与纯文本必须恢复').toBe(true);
    }catch(restoreError){
      // cause让Playwright保留原定位异常链，errors同时保留两条完整异常对象。
      if(operationFailed)throw new AggregateError([operationError,restoreError],'光标定位操作与剪贴板恢复均失败',{cause:operationError});
      throw restoreError;
    }
  }
}
