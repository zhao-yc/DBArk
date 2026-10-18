import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import ts from 'typescript';
import {LocalStore,defaultSettings} from '../../src/main/storage';
import {commandSchemas,validateCommand} from '../../src/shared/validation';
import type {AppSettings} from '../../src/shared/contracts';
const base=()=>({...defaultSettings,tabs:[{id:'q',kind:'query' as const,title:'原查询',connectionId:'ram',sql:'仅合成正文'}]});
/** 运行原直接存储验证，仅把mutate/db写入替换为RAM记录，不创建SQLite或读取配置。 */
function directPort(){
 const writes:Array<{sql:string;args:unknown[]}>=[];let settingsData:string|undefined;
 const sources=new Map<string,{id:string;revision:number;data:string}>();
 /** 只实现原存储器实际读取的两张RAM表；未知SQL拒绝，不能凭夹具默认值授予文件来源。 */
 const db={
  run(sql:string,args:unknown[]){if(sql!=='INSERT INTO settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')throw Error('越界RAM写入');writes.push({sql,args});settingsData=String(args[0]);},
  prepare(sql:string){
   if(sql!=='SELECT data FROM settings WHERE id=1'&&sql!=='SELECT id,revision,data FROM query_file_sources WHERE tab_id=?')throw Error('越界RAM读取');
   let params:unknown[]=[],index=-1,freed=false;
   const rows=():unknown[][]=>{if(freed)throw Error('RAM语句已释放');if(sql==='SELECT data FROM settings WHERE id=1')return settingsData===undefined?[]:[[settingsData]];const source=sources.get(String(params[0]));return source?[[source.id,source.revision,source.data]]:[];};
   return {bind(value:unknown[]){params=value;index=-1;},step(){return ++index<rows().length;},get(){return [...rows()[index]];},getAsObject(){return {data:rows()[index].at(-1)};},free(){freed=true;}};
  }
 };
 // 沿真实prototype提供settings/records/canonical/source/document方法，只替换RAM数据库与事务端口。
 const receiver=Object.assign(Object.create(LocalStore.prototype),{db,queryFileDocuments:new Map<string,object>(),queryFileDocumentSnapshot:undefined,
  mutate(action:()=>void){const previous=settingsData;try{action();}catch(error){settingsData=previous;throw error;}}
 });
 return {writes,save:(input:unknown)=>LocalStore.prototype.saveSettings.call(receiver as LocalStore,input as AppSettings)};
}
/** 原Main参数验证及settings.save分支逐字提取；只注入上述真实存储方法的RAM边界。 */
function mainPort(save:(input:unknown)=>void){const source=readFileSync(new URL('../../src/main/index.ts',import.meta.url),'utf8'),tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);let validation='',clause='';
 function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==='validateMainCommand')validation=n.getText(tree);if(ts.isCaseClause(n)&&n.expression.getText(tree)==="'settings.save'")clause=n.getText(tree);ts.forEachChild(n,visit);}visit(tree);if(!validation||!clause)throw Error('未提取真实设置入口');
 const context=createContext({validateCommand,store:{saveSettings:save},stateFlushed:undefined,rendererSettingsCurrent:true,Error});runInContext(ts.transpileModule(validation+"\nasync function save(input){input=validateMainCommand('settings.save',input);switch('settings.save'){"+clause+"}}globalThis.save=save;",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return context;
}
it.each([undefined,130,8192])('缺省旧配置或合法自有高度%s经导出schema、Main和直接store保持可写',async height=>{
 const input=base();if(height!==undefined)Object.assign(input.tabs[0],{queryEditorHeight:height});const immutable=structuredClone(input),schema=commandSchemas['settings.save'];expect(schema.safeParse(input).success).toBe(true);expect(schema.parse(input)).toEqual(input);expect(validateCommand('settings.save',input)).toEqual(input);
 const direct=directPort();direct.save(input);const main=mainPort(direct.save);await main.save(input);expect(main.rendererSettingsCurrent).toBe(true);expect(direct.writes).toHaveLength(2);expect(direct.writes.map(write=>JSON.parse(String(write.args[0])))).toEqual([input,input]);expect(input).toEqual(immutable);
});
it('继承/显式undefined/非query字段由原始schema、Main及直接store一致拒绝且零写入',async()=>{
 const own=base().tabs[0];const bad=[Object.assign(Object.create({queryEditorHeight:500}),own),{...own,queryEditorHeight:undefined},{...own,queryEditorHeight:300.5},{...own,queryEditorHeight:8193},{...own,kind:'table',queryEditorHeight:300},{...own,kind:'table',queryEditorHeight:undefined}];
 const direct=directPort(),main=mainPort(direct.save);for(const tab of bad){const input={...base(),tabs:[tab]};expect(commandSchemas['settings.save'].safeParse(input).success).toBe(false);expect(()=>commandSchemas['settings.save'].parse(input)).toThrow();expect(()=>validateCommand('settings.save',input)).toThrow();await expect(main.save(input)).rejects.toThrow();expect(()=>direct.save(input)).toThrow();}expect(direct.writes).toEqual([]);
});
it('原始预检通过后仍由原strict schema拒绝未知顶层与tab字段',()=>{for(const input of [{...base(),extra:'禁止'},{...base(),tabs:[{...base().tabs[0],extra:'禁止'}]}]){expect(commandSchemas['settings.save'].safeParse(input).success).toBe(false);expect(()=>validateCommand('settings.save',input)).toThrow();}});
