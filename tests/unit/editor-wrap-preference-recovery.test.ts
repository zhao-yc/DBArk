// 派生自员工5原反例d1b3994a67249181a749a7940811f672b41123bd46e37fe15ad550089a9d51ce；原字节及原红保留在本片.cache。
import {it,expect,vi} from 'vitest';
import {LocalStore,defaultSettings} from '../../src/main/storage';
import {validateCommand} from '../../src/shared/validation';
// 原LocalStore/renderer store生产逻辑；仅settings表及原子文件端口在RAM。
const io=vi.hoisted(()=>({writes:0,files:new Map<string,Uint8Array>()}));
vi.mock('node:fs',()=>({existsSync:()=>false,mkdirSync(){},readFileSync(){throw Error('禁止实际配置读取');},writeFileSync(p:string,b:Uint8Array){io.writes++;io.files.set(p,Uint8Array.from(b));},renameSync(a:string,b:string){io.files.set(b,io.files.get(a)!);io.files.delete(a);}}));
class Rows{constructor(public row:string){}export(){return Buffer.from(this.row);}close(){}run(sql:string,v?:string[]){if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return;if(!sql.startsWith('INSERT INTO settings VALUES'))throw Error('越界SQL');this.row=v![0];}prepare(sql:string){if(sql!=='SELECT data FROM settings WHERE id=1')throw Error('越界表');let used=false;return{bind(){},step:()=>{if(used)return false;used=true;return true;},getAsObject:()=>({data:this.row}),free(){}};}}
it('员工5异常恢复组合：严格拒绝非法写入，但损坏换行记录不得丢既有SQL并被后续偏好保存覆盖',async()=>{
 const original={...defaultSettings,editorFontSize:23,sidebarWidth:333,activeTabId:'saved-q',tabs:[{id:'saved-q',kind:'query',connectionId:'c',title:'已存草稿',sql:'select 员工5已有SQL'}]};
 const rows=new Rows(JSON.stringify({...original,editorWordWrap:'false'})),local=Reflect.construct(LocalStore,[rows,'ram-only',{available:()=>false},(b:Uint8Array)=>new Rows(Buffer.from(b).toString())]) as LocalStore;
 for(const value of ['false',0,null,{},[]]){expect(()=>validateCommand('settings.save',{...original,editorWordWrap:value})).toThrow();expect(()=>local.saveSettings({...original,editorWordWrap:value} as any)).toThrow();}expect(io.writes).toBe(0);
 const before=rows.row;const saves:any[]=[];const old=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){},dbark:{invoke:async(cmd:string,input:any)=>{if(cmd==='settings.get')return local.settings();if(['connections.list','tasks.list'].includes(cmd))return[];if(cmd==='settings.save'){const good=validateCommand(cmd,input);saves.push(structuredClone(good));local.saveSettings(good as any);return;}throw Error('越界命令');}}}});
 try{const {useWorkspace,flushSettings}=await import('../../src/renderer/store');await useWorkspace.getState().initialize();const loaded=useWorkspace.getState();expect(loaded.ready).toBe(true);expect(loaded.notice?.error).not.toBe(true);expect(loaded.settings).toEqual({...original,editorWordWrap:true});expect(rows.row).toBe(before);
 // 仅修正成功恢复不应报加载失败的旧故障态期望；继续经原store保存并逐字段核原工作区。
 loaded.updateSettings({editorWordWrap:false});await flushSettings();const persisted=local.settings();expect(persisted).toEqual({...original,editorWordWrap:false});
 console.log(JSON.stringify({场景:'异常持久记录恢复后保存',初始化标签数:loaded.settings.tabs.length,保存后标签数:persisted.tabs.length,写入次数:io.writes,原始标签数:original.tabs.length}));
 expect.soft(loaded.settings.tabs).toEqual(original.tabs);expect.soft(persisted.tabs).toEqual(original.tabs);expect.soft(persisted.editorFontSize).toBe(original.editorFontSize);expect.soft(persisted.sidebarWidth).toBe(original.sidebarWidth);
 }finally{if(old)Object.defineProperty(globalThis,'window',old);else Reflect.deleteProperty(globalThis,'window');local.close();}
});
