import {readFileSync,writeFileSync,mkdtempSync,rmSync,realpathSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {describe,it,expect} from 'vitest';

const req=createRequire(import.meta.url),playwright=createRequire(req.resolve('@playwright/test/package.json'));
const {babelTransform}=req(join(dirname(playwright.resolve('playwright/package.json')),'lib/transform/babelBundle.js'));
const source=readFileSync(new URL('../e2e/sql-completion-call-routines.spec.ts',import.meta.url),'utf8'),tree=ts.createSourceFile('call.ts',source,ts.ScriptTarget.Latest,true);
const verify=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='verifyCall') as ts.FunctionDeclaration;
const statement=verify.body!.statements.find(node=>ts.isVariableStatement(node)) as ts.VariableStatement;
const current=statement.declarationList.declarations.find(node=>node.name.getText(tree)==='desktop')!.initializer!.getText(tree);
// 使用正式Playwright编译器及真实Node子进程；仅fixture可变导出是RAM端口，没有浏览器或实库。
const fixture='export let page:any,desktop:any,pageErrors:any[]=[];export function replace(generation:number){if(page)page.closed=true;const value={generation,closed:false,evaluate:async()=>{if(value.closed)throw Error("CLOSED");return generation;}};page=value;desktop={generation};pageErrors=[];}';
const program=`import {createRequire} from 'node:module';import {join} from 'node:path';
const require=createRequire(import.meta.url),dir=process.argv[1],sync=require(join(dir,'desktop-fixture')),loader=require(join(dir,'loader.cjs'));
sync.replace(1);const first=await loader.getFixture(),oldPage=first.page;const firstPassed=await first.page.evaluate()===1;
sync.replace(2);const second=await loader.getFixture();let secondPassed=false,closedError=false;try{secondPassed=await second.page.evaluate()===2;}catch(error){closedError=error.message==='CLOSED';}
process.stdout.write(JSON.stringify({firstPassed,oldPageClosed:oldPage.closed,secondPassed,closedError,pageFresh:second.page===sync.page,desktopFresh:second.desktop===sync.desktop,errorsFresh:second.pageErrors===sync.pageErrors,requirePassed:await sync.page.evaluate()===2}));`;

describe('CALL两例之间使用当前fixture活导出',()=>{
  it.each([{label:'旧动态命名空间反例',expression:"await import('./desktop-fixture')",fresh:false},{label:'正式测试当前入口',expression:current,fresh:true}])('$label保留真实编译与两代page行为',({expression,fresh})=>{
    const parent=realpathSync(tmpdir()),directory=mkdtempSync(join(parent,'dbark-call-export-'));
    try{
      // 无后缀临时CommonJS文件使原specifier保持原字节，无需注册Playwright加载器或执行真实fixture。
      for(const[name,text]of [['desktop-fixture',fixture],['loader.cjs','export async function getFixture(){return '+expression+';}']]){
        const result=babelTransform(text,join(directory,name+'.ts'),false,[],undefined);if(!result?.code)throw Error('原Playwright编译器未返回代码');writeFileSync(join(directory,name),result.code,{flag:'wx'});
      }
      const env:NodeJS.ProcessEnv={};for(const key of ['SystemRoot','WINDIR','SystemDrive'])if(process.env[key])env[key]=process.env[key];
      const report=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',program,directory],{env,encoding:'utf8',windowsHide:true,timeout:10000}));
      expect(report).toEqual({firstPassed:true,oldPageClosed:true,secondPassed:fresh,closedError:!fresh,pageFresh:fresh,desktopFresh:fresh,errorsFresh:fresh,requirePassed:true});
    }finally{
      // 递归清理前再次核对真实绝对路径，只移除本用例mkdtemp所得普通目录。
      const owned=realpathSync(directory);expect(dirname(owned)).toBe(resolve(parent));expect(basename(owned).startsWith('dbark-call-export-')).toBe(true);expect(lstatSync(directory).isSymbolicLink()).toBe(false);rmSync(owned,{recursive:true,force:true});
    }
  });
});
