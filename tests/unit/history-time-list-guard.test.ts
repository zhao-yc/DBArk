import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
const source=readFileSync(new URL('../e2e/history-time-filter.spec.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
/** 执行真实入口的转译代码，所有require均是RAM端口；禁止导入实际live/桌面/配置。 */
function collect(argv:string[],gate:string){
 const reads:string[]=[],loaded:string[]=[],register=vi.fn(),skip=vi.fn();
 const env=new Proxy({DBARK_HISTORY_TIME_FILTER_TEST:gate},{get(values,key:string){reads.push(key);if(!Object.hasOwn(values,key))throw Error('收集不可读取额外配置');return values[key as keyof typeof values];}});
 runInContext(compiled,createContext({exports:{},process:{argv,env},require(name:string){if(name==='@playwright/test')return{test:{skip}};loaded.push(name);if(name!=='./history-time-filter-live'||argv.some(arg=>arg==='--list'||arg.startsWith('--list=')))throw Error('收集不得加载实际模块');return{registerHistoryTimeFilterTests:register};}}));return{reads,loaded,register,skip};
}
describe('历史时间原生定义默认关闭且list先短路',()=>{
 for(const flag of['--list','--list=json'])it.each(['0','1'])(flag+' 门%s不读环境、不加载live',gate=>{const result=collect([flag],gate);expect(result.reads).toEqual([]);expect(result.loaded).toEqual([]);expect(result.register).not.toHaveBeenCalled();expect(result.skip).toHaveBeenCalledOnce();});
 it.each(['0','1'])('非收集模式门%s只在明确开启时调用RAM注册',gate=>{const result=collect([],gate);expect(result.loaded).toEqual(gate==='1'?['./history-time-filter-live']:[]);expect(result.register).toHaveBeenCalledTimes(gate==='1'?1:0);expect(result.reads).toEqual(['DBARK_HISTORY_TIME_FILTER_TEST']);});
});
