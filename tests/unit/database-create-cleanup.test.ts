import { sidebarMenuRamPort, navigationMenuRamPort } from '../helpers/sidebarMenuRamPort';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
const compiled = ts.transpileModule(readFileSync(new URL('../e2e/database-create-live.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;

/** 执行真实正式用例函数，只用RAM替身制造首次UI失败及退出失败，不启动任何实际模块。 */
function harness(quitFails: boolean, taskState?: 'running' | 'unknown') {
  const calls: string[] = [], original = Error('原始UI失败'), quit = Error('退出失败');
  const uuid='00000000-0000-0000-0000-000000000001';
  const observer = { query: vi.fn(async (sql: string) => { if (sql.startsWith('SELECT @@version')) return [[{ version: '8.4.11',uuid }]]; if (sql.startsWith('SELECT SCHEMA_NAME')) return [[]]; if (sql.startsWith('DROP DATABASE')) { calls.push('DROP'); return []; } throw Error('未声明查询'); }), end: vi.fn(async () => { calls.push('end'); }) };
  let run!: () => Promise<void>;
  const test = Object.assign((_title: string, body: (input:Record<string,never>,info:{id:string}) => Promise<void>) => { run = () => body({},{id:'RAM本例'}); }, { use() {}, setTimeout() {}, describe: { configure() {} } });
  const exports: { registerDatabaseCreateUiTests?: () => void } = {};
  const environment = { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_USER: 'RAM测试账户' };
  const page={ locator: () => ({ getByRole: () => ({ click: async () => { throw original; } }) }),evaluate:async()=>{if(taskState==='unknown')throw Error('任务读取未知');return taskState?[{kind:'schema.databaseCreate.apply',status:taskState}]:[];} };
  const context = createContext({ exports, process: { env: { ...environment,DBARK_TEST_EXPECTED_SERVER_UUID:uuid } }, require(name: string) {
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRamPort;
    if (name === './navigation-menu') return navigationMenuRamPort;
    if (name === 'node:crypto') return { randomUUID: () => '00000000-0000-0000-0000-000000000001' };
    if (name === 'mysql2/promise') return { createConnection: async () => observer };
    if (name === './desktop-fixture') return { test, expect,ownedDesktopResources:()=>({page,closed:false}),retainOwnedDesktopResources:()=>calls.push('retain'),confirmOwnedDesktopExit:async()=>{calls.push('quit');if(quitFails)throw quit;} };
    if (name === './live-helpers') return { environment };
    if (name === '../../src/renderer/locales/databaseCreate.zh-CN') return { databaseCreateZh: {} };
    throw Error('禁止实际导入：' + name);
  } });
  runInContext(compiled, context); exports.registerDatabaseCreateUiTests!();
  return { run, calls, original, quit, observer };
}
describe('新建库正式用例退出失败时保留现场', () => {
  it('观察连接DROP未知时不继续end，原用例失败保持为cause和聚合首项', async () => {
    const value = harness(false), query = value.observer.query.getMockImplementation()!, unknown = Error('DROP观察请求未知');
    value.observer.query.mockImplementation(async sql => { if (sql.startsWith('DROP DATABASE')) throw unknown; return query(sql); });
    const failure = await value.run().catch(reason => reason);
    expect(failure.errors).toEqual([value.original, unknown]); expect(failure.cause).toBe(value.original); expect(value.observer.end).not.toHaveBeenCalled(); expect(value.calls).toContain('retain');
  });
  it('退出拒绝立即停链，保留库和observer；原失败是聚合首因', async () => {
    const value = harness(true), failure = await value.run().catch(reason => reason);
    expect(value.calls).toEqual(['quit', 'retain']); expect(value.observer.end).not.toHaveBeenCalled();
    expect(failure.errors).toEqual([value.original, value.quit]);
  });
  it('退出Promise完成后才清理本例名称，原UI失败仍原样抛出', async () => {
    const value = harness(false); await expect(value.run()).rejects.toBe(value.original);
    expect(value.calls).toEqual(['quit', 'DROP', 'end']);
  });
  it.each(['running','unknown'] as const)('创建任务%s先停链，不用退出请求取消或清理现场',async state=>{
    const value=harness(false,state),failure=await value.run().catch(reason=>reason);
    expect(value.calls).toEqual(['retain']);expect(value.observer.end).not.toHaveBeenCalled();expect(failure.errors[0]).toBe(value.original);
  });
});
