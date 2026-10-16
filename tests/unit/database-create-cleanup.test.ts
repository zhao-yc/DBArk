import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
const compiled = ts.transpileModule(readFileSync(new URL('../e2e/database-create-live.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;

/** 执行真实正式用例函数，只用RAM替身制造首次UI失败及退出失败，不启动任何实际模块。 */
function harness(quitFails: boolean) {
  const calls: string[] = [], original = Error('原始UI失败'), quit = Error('退出失败');
  const observer = { query: vi.fn(async (sql: string) => { if (sql.startsWith('SELECT @@version')) return [[{ version: '8.4.11' }]]; if (sql.startsWith('SELECT SCHEMA_NAME')) return [[]]; if (sql.startsWith('DROP DATABASE')) { calls.push('DROP'); return []; } throw Error('未声明查询'); }), end: vi.fn(async () => { calls.push('end'); }) };
  let run!: () => Promise<void>;
  const test = Object.assign((_title: string, body: () => Promise<void>) => { run = body; }, { use() {}, setTimeout() {}, describe: { configure() {} } });
  const exports: { registerDatabaseCreateUiTests?: () => void } = {};
  const environment = { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_USER: 'RAM测试账户' };
  const context = createContext({ exports, process: { env: { ...environment } }, require(name: string) {
    if (name === 'node:crypto') return { randomUUID: () => '00000000-0000-0000-0000-000000000001' };
    if (name === 'mysql2/promise') return { createConnection: async () => observer };
    if (name === './desktop-fixture') return { test, expect, closed: false, page: { locator: () => ({ getByRole: () => ({ click: async () => { throw original; } }) }) }, answerDialogs: async () => { calls.push('answer'); }, quitDesktop: async () => { calls.push('quit'); if (quitFails) throw quit; } };
    if (name === './live-helpers') return { environment };
    if (name === '../../src/renderer/locales/databaseCreate.zh-CN') return { databaseCreateZh: {} };
    throw Error('禁止实际导入：' + name);
  } });
  runInContext(compiled, context); exports.registerDatabaseCreateUiTests!();
  return { run, calls, original, quit, observer };
}
describe('新建库正式用例退出失败时保留现场', () => {
  it('退出拒绝立即停链，保留库和observer；原失败是聚合首因', async () => {
    const value = harness(true), failure = await value.run().catch(reason => reason);
    expect(value.calls).toEqual(['answer', 'quit']); expect(value.observer.end).not.toHaveBeenCalled();
    expect(failure.errors).toEqual([value.original, value.quit]);
  });
  it('退出Promise完成后才清理本例名称，原UI失败仍原样抛出', async () => {
    const value = harness(false); await expect(value.run()).rejects.toBe(value.original);
    expect(value.calls).toEqual(['answer', 'quit', 'DROP', 'end']);
  });
});
