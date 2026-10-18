import {afterEach,describe,expect,it}from'vitest';
import {mkdtemp,readFile,writeFile,mkdir,rm,copyFile}from'node:fs/promises';
import {tmpdir}from'node:os';import {join,dirname}from'node:path';import{createRequire}from'node:module';import{createHash}from'node:crypto';
import{monacoWordHighlighterPatch as expected,verifyMonacoWordHighlighterPatch,monacoWordHighlighterGuard}from'../../scripts/monaco-word-highlighter-guard';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
/** 故障注入只写测试自己的假依赖目录，不改实际私有或共享node_modules。 */
async function fixture(){const root=await mkdtemp(join(tmpdir(),'dbark-monaco-guard-'));roots.push(root);const dependency=join(root,'node_modules/monaco-editor'),file=join(dependency,expected.file);await mkdir(dirname(file),{recursive:true});await mkdir(join(root,'patches'),{recursive:true});const actual=dirname(createRequire(import.meta.url).resolve('monaco-editor/package.json'));await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{'monaco-editor':'0.55.1'}}));await writeFile(join(dependency,'package.json'),JSON.stringify({name:'monaco-editor',version:'0.55.1',license:'MIT'}));await copyFile(join(actual,expected.file),file);await copyFile(join(process.cwd(),'patches/monaco-editor@0.55.1.patch'),join(root,'patches/monaco-editor@0.55.1.patch'));return{root,file,dependency};}
describe('正式Monaco补丁的版本和字节门',()=>{
  it('当前实际安装副本通过，项目锁定精确版本和补丁SHA，MIT归属及两处处理保持',async()=>{
    expect(verifyMonacoWordHighlighterPatch(process.cwd())).toEqual({version:'0.55.1',sha256:expected.patchedSha256});
    const manifest=JSON.parse(await readFile('package.json','utf8')),lock=await readFile('pnpm-lock.yaml','utf8'),patch=await readFile('patches/monaco-editor@0.55.1.patch');expect(manifest.dependencies['monaco-editor']).toBe('0.55.1');expect(createHash('sha256').update(patch).digest('hex')).toBe(expected.patchSha256);expect(lock).toContain('monaco-editor@0.55.1: '+expected.patchSha256);expect((patch.toString().match(/\+.*errorHandler\.onUnexpectedError/g)||[])).toHaveLength(3);expect((await readFile('.gitattributes','utf8'))).toContain('* text=auto eol=lf');
  });
  it.each(['serve','build'])('%s配置入口均执行同一个字节门，没有未修复降级路径',async command=>{
    const f=await fixture(),plugin=monacoWordHighlighterGuard();expect(typeof plugin.configResolved).toBe('function');const hook=plugin.configResolved as(config:any)=>void;expect(()=>hook({root:f.root,command})).not.toThrow();await writeFile(f.file,'未打补丁或被替换的源码');expect(()=>hook({root:f.root,command})).toThrow('不会回退');
  });
  it('升级版本、放宽版本及补丁正文变化均拒绝沿用旧验证结果',async()=>{
    const f=await fixture();await writeFile(join(f.dependency,'package.json'),JSON.stringify({name:'monaco-editor',version:'0.55.2',license:'MIT'}));expect(()=>verifyMonacoWordHighlighterPatch(f.root)).toThrow('版本');
    await writeFile(join(f.dependency,'package.json'),JSON.stringify({name:'monaco-editor',version:'0.55.1',license:'MIT'}));await writeFile(join(f.root,'package.json'),JSON.stringify({dependencies:{'monaco-editor':'^0.55.1'}}));expect(()=>verifyMonacoWordHighlighterPatch(f.root)).toThrow('版本');
    await writeFile(join(f.root,'package.json'),JSON.stringify({dependencies:{'monaco-editor':'0.55.1'}}));await writeFile(join(f.root,'patches/monaco-editor@0.55.1.patch'),'误改补丁');expect(()=>verifyMonacoWordHighlighterPatch(f.root)).toThrow('补丁字节');
  });
});
