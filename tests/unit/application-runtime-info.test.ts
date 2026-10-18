import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';

const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** 只运行真实Main分支，不加载Electron或完整Main入口；系统端口均为可计数RAM对象。 */
function clause(command: string) {
  let found: ts.CaseClause | undefined;
  function visit(node: ts.Node) { if (ts.isCaseClause(node) && node.expression.getText(tree) === "'" + command + "'") found = node; ts.forEachChild(node, visit); }
  visit(tree); if (!found) throw Error('真实Main分支缺失'); return found;
}
function main(command: string, scope: object) {
  const code = 'exports.run=function(){' + clause(command).statements.map(node => node.getText(tree)).join('\n') + '};', exports: any = {};
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, ...scope });
  return exports.run as () => any;
}

it('元信息命令进入预加载白名单，严格只接空对象，不接受探测或秘密参数', () => {
  expect(publicCommands['app.runtimeInfo']).toBe(true); expect(publicCommands['app.info']).toBe(true);
  expect(validateCommand('app.runtimeInfo', {})).toEqual({});
  for (const input of [undefined, null, [], 0, true, '', { probe: true }, { encryptionAvailable: false }, { filePath: '外部路径' }, { sql: 'SELECT 1' }]) expect(() => validateCommand('app.runtimeInfo', input)).toThrow();
});

it('App接入真实hook和显式按钮，所有启动effect只请求元信息而不调用检测', () => {
  const app = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8');
  expect(app).toContain('useApplicationInfo(bundledVersion)'); expect(app).toContain('onCheck={checkEncryption}'); expect(app).not.toContain("invoke('app.info'");
  const hook = readFileSync(new URL('../../src/renderer/useApplicationInfo.ts', import.meta.url), 'utf8'), parsed = ts.createSourceFile('hook.ts',hook,ts.ScriptTarget.Latest,true);
  const effects: string[] = []; let checks = 0;
  function visit(node: ts.Node) {
    if(ts.isCallExpression(node)&&node.expression.getText(parsed)==='useEffect')effects.push(node.arguments[0].getText(parsed));
    if(ts.isCallExpression(node)&&node.expression.getText(parsed)==='checkEncryption')checks++;
    ts.forEachChild(node,visit);
  }
  visit(parsed); expect(effects).toHaveLength(1); expect(effects[0]).toContain("invoke('app.runtimeInfo'"); expect(effects[0]).not.toContain("invoke('app.info'"); expect(checks).toBe(0);
});

it.each(['darwin','win32','linux'])('%s重复元信息只取Main三属性，safeStorage和原marker零读取', platform => {
  const order: string[] = [], crypto = vi.fn(() => { throw Error('启动不得访问任何safeStorage属性'); }), mark = vi.fn();
  const run = main('app.runtimeInfo', { app: { getVersion: () => { order.push('version'); return '0.23.0'; }, getPath: (name: string) => { order.push(name); return 'RAM/本例'; } }, process: { get platform() { order.push('platform'); return platform; } }, safeStorage: new Proxy({}, { get: crypto }), nativeStartupInfoMarker: mark });
  for (let index = 0; index < 20; index++) expect(run()).toEqual({ version: '0.23.0', platform, dataPath: 'RAM/本例' });
  expect(order).toEqual(Array.from({ length: 20 }, () => ['version','platform','userData']).flat()); expect(crypto).not.toHaveBeenCalled(); expect(mark).not.toHaveBeenCalled();
});

it.each(['version','platform','path'])('元信息%s原错误原样传播，不能补假值或触加密', stage => {
  const failure = Error('原Main元信息错误'), crypto = vi.fn();
  const run = main('app.runtimeInfo', { app: { getVersion() { if (stage === 'version') throw failure; return '0.23.0'; }, getPath() { if (stage === 'path') throw failure; return 'RAM'; } }, process: { get platform() { if (stage === 'platform') throw failure; return 'darwin'; } }, safeStorage: new Proxy({}, { get: crypto }) });
  let caught: unknown; try { run(); } catch (reason) { caught = reason; } expect(caught).toBe(failure); expect(crypto).not.toHaveBeenCalled();
});

it('2f6e22a原app.info分支逐字保持，真实凭据E2E正文未弱化', () => {
  expect(hash(clause('app.info').getText(tree))).toBe('2eabce9226f4a6b8bb21e3aa06f439341deeda5a1703fc18209c4095fdab40aa');
  const desktop = readFileSync(new URL('../e2e/desktop.spec.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  expect(hash(desktop.slice(desktop.indexOf("test('系统加密可用时")))).toBe('4f7da6a5151a3fe0447fbaced575b0604d8992e2a6e24e2caccdf9a1f14e3235');
});

it.each([true,false])('原app.info显式检测保持真实boolean=%s及30..33顺序', available => {
  const order: unknown[] = [], native = vi.fn(() => { order.push('native'); return available; });
  const run = main('app.info', { app: { getVersion: () => '0.23.0', getPath: () => 'RAM' }, process: { platform: 'darwin' }, safeStorage: { isEncryptionAvailable: native }, nativeStartupInfoMarker: (code: number) => order.push(code) });
  expect(run()).toEqual({ version:'0.23.0',platform:'darwin',encryptionAvailable:available,dataPath:'RAM' }); expect(order).toEqual([30,31,'native',32,33]); expect(native).toHaveBeenCalledOnce();
});

it('原app.info native错误保持原对象，不能转换为false/unknown或吞掉', () => {
  const failure = Error('原系统保护错误'), marks: number[] = [];
  const run = main('app.info', { app: { getVersion: () => '0.23.0' }, process: { platform:'darwin' }, safeStorage: { isEncryptionAvailable() { throw failure; } }, nativeStartupInfoMarker: (code: number) => marks.push(code) });
  let caught: unknown; try { run(); } catch (reason) { caught = reason; } expect(caught).toBe(failure); expect(marks).toEqual([30,31]);
});

it('真实预加载只透传白名单元信息，原app.info错误消息不变', async () => {
  const source = readFileSync(new URL('../../src/main/preload.ts', import.meta.url), 'utf8'); let api: any;
  const request = vi.fn(async () => ({ ok:true,result:{version:'0.23.0',platform:'darwin',dataPath:'RAM'} } as any));
  runInNewContext(ts.transpileModule(source, { compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS} }).outputText, { exports:{}, require(name: string) {
    if(name==='electron')return{contextBridge:{exposeInMainWorld(_name: string,value: unknown){api=value;}},ipcRenderer:{invoke:request}};
    if(name==='../shared/commands')return{publicCommands}; throw Error('禁止真实预加载依赖：'+name);
  } });
  expect(await api.invoke('app.runtimeInfo',{})).toEqual({version:'0.23.0',platform:'darwin',dataPath:'RAM'}); expect(request.mock.calls[0]).toEqual(['dbark:request',{command:'app.runtimeInfo',input:{}}]);
  request.mockResolvedValueOnce({ok:false,error:'原系统保护错误'}); await expect(api.invoke('app.info',{})).rejects.toThrow('原系统保护错误');
});
