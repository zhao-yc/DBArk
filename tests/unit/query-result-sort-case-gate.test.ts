import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source=readFileSync(new URL('../e2e/query-result-sort-case.spec.ts',import.meta.url),'utf8');
const enabled=()=>({DBARK_INTEGRATION_ENABLED:'1',DBARK_QUERY_RESULT_COLUMNS_UI:'1',DBARK_QUERY_RESULT_SORT_CASE_UI:'1',DBARK_TEST_HOST:'offline.invalid'});

/** 执行真实spec声明；实库和桌面模块只允许登记哨兵，不能打开进程、网络或凭据。 */
function declare(env:NodeJS.ProcessEnv,args:string[]=[]){
  const skip=vi.fn(),register=vi.fn(),base=vi.fn(),target=Object.freeze({marker:'RAM目标'}),bind=vi.fn((_read:()=>NodeJS.ProcessEnv,_snapshot:Record<string,string|undefined>)=>({target,assertCurrent:base})),modules:string[]=[];
  const require=(name:string)=>{
    modules.push(name);
    if(name==='@playwright/test')return{test:{skip}};
    if(name==='../helpers/queryResultColumnsUi')return{queryResultColumnsUiKeys:['DBARK_QUERY_RESULT_COLUMNS_UI','DBARK_TEST_HOST'],bindQueryResultColumnsUiTarget:bind};
    if(name==='./query-result-sort-case-live')return{registerQueryResultSortCaseUi:register};
    throw Error('不允许加载模块：'+name);
  };
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:{},require,process:{env,argv:args}});
  return{skip,register,base,target,bind,modules};
}

describe('大小写排序窗口的默认关闭与永久撤销门',()=>{
  it('三个门缺少任意一个都只登记跳过，不读取认证哨兵或加载实库模块',()=>{
    for(const env of [{},{...enabled(),DBARK_INTEGRATION_ENABLED:'0'},{...enabled(),DBARK_QUERY_RESULT_COLUMNS_UI:'0'},{...enabled(),DBARK_QUERY_RESULT_SORT_CASE_UI:'0'}]){
      Object.defineProperty(env,'DBARK_TEST_PASSWORD',{get(){throw Error('默认关闭不能读取认证');}});
      const value=declare(env);expect(value.skip).toHaveBeenCalledOnce();expect(value.register).not.toHaveBeenCalled();expect(value.bind).not.toHaveBeenCalled();expect(value.modules).toEqual(['@playwright/test']);
    }
  });
  it.each(['--list','--list=true'])('%s即使三个门已启用也不读取环境或加载原生模块',argument=>{
    const env=new Proxy(enabled(),{get(){throw Error('列表不能读取环境');},ownKeys(){throw Error('列表不能枚举环境');}});
    const value=declare(env,[argument]);expect(value.skip).toHaveBeenCalledOnce();expect(value.modules).toEqual(['@playwright/test']);expect(value.bind).not.toHaveBeenCalled();
  });
  it('显式三门才按原helper合同登记同一目标，不提前执行桌面行为',()=>{
    const env=enabled(),value=declare(env);expect(value.skip).not.toHaveBeenCalled();expect(value.register).toHaveBeenCalledOnce();
    expect(value.bind.mock.calls[0][1]).toEqual({DBARK_QUERY_RESULT_COLUMNS_UI:'1',DBARK_TEST_HOST:'offline.invalid'});
    const binding=value.register.mock.calls[0][0];expect(binding.target).toBe(value.target);expect(value.base).not.toHaveBeenCalled();binding.assertCurrent();expect(value.base).toHaveBeenCalledOnce();
    expect(value.modules).toEqual(['@playwright/test','../helpers/queryResultColumnsUi','./query-result-sort-case-live']);
  });
  it('观察到专项开关漂移后即使恢复也不能复活旧目标',()=>{
    const env=enabled(),value=declare(env),binding=value.register.mock.calls[0][0];binding.assertCurrent();env.DBARK_QUERY_RESULT_SORT_CASE_UI='0';expect(()=>binding.assertCurrent()).toThrow('永久停链');env.DBARK_QUERY_RESULT_SORT_CASE_UI='1';expect(()=>binding.assertCurrent()).toThrow('永久停链');
    expect(value.register).toHaveBeenCalledOnce();expect(value.base).toHaveBeenCalledTimes(3);
  });
});
