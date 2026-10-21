import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';

const source=readFileSync(new URL('../e2e/sql-completion-insert-row-alias.spec.ts',import.meta.url),'utf8');

/** 执行真实入口声明；桌面模块只允许登记哨兵，不读取认证、连接数据库或启动原生进程。 */
function declare(env:NodeJS.ProcessEnv,args:string[]=[]){
  const skip=vi.fn(),register=vi.fn(),modules:string[]=[];
  const require=(name:string)=>{modules.push(name);if(name==='@playwright/test')return{test:{skip}};if(name==='./sql-completion-insert-row-alias-ui')return{registerInsertRowAliasUiTest:register};throw Error('禁止入口加载其它模块');};
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:{},require,process:{env,argv:args}});
  return{skip,register,modules};
}

describe('UPSERT VALUES／SET真实界面入口的显式双门',()=>{
  it('缺少任一门只登记跳过，不读取凭据或加载桌面模块',()=>{
    for(const env of [{},{DBARK_INTEGRATION_ENABLED:'1'},{DBARK_INSERT_ROW_ALIAS_UI:'1'},{DBARK_INTEGRATION_ENABLED:'1',DBARK_INSERT_ROW_ALIAS_UI:'0'}]){
      Object.defineProperty(env,'DBARK_TEST_PASSWORD',{get(){throw Error('关闭入口不能读取认证');}});
      const r=declare(env);expect(r.skip).toHaveBeenCalledOnce();expect(r.register).not.toHaveBeenCalled();expect(r.modules).toEqual(['@playwright/test']);
    }
  });
  it.each(['--list','--list=true'])('%s即使有开启意图也不访问环境或加载原生模块',arg=>{
    const env=new Proxy({DBARK_INTEGRATION_ENABLED:'1',DBARK_INSERT_ROW_ALIAS_UI:'1'},{get(){throw Error('列表不能读取环境');},ownKeys(){throw Error('列表不能枚举环境');}});
    const r=declare(env,[arg]);expect(r.skip).toHaveBeenCalledOnce();expect(r.register).not.toHaveBeenCalled();expect(r.modules).toEqual(['@playwright/test']);
  });
  it('双门只登记既有真实UI模块一次，不在声明层展开认证',()=>{
    const env={DBARK_INTEGRATION_ENABLED:'1',DBARK_INSERT_ROW_ALIAS_UI:'1'};Object.defineProperty(env,'DBARK_TEST_PASSWORD',{get(){throw Error('声明不展开认证');}});
    const r=declare(env);expect(r.skip).not.toHaveBeenCalled();expect(r.register).toHaveBeenCalledOnce();expect(r.modules).toEqual(['@playwright/test','./sql-completion-insert-row-alias-ui']);
  });
});
