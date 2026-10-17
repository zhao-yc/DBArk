import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as targetHelper from '../helpers/tableCreateForeignKeysTarget';
import * as lifecycle from '../helpers/tableCreateForeignKeysLifecycle';

const source = readFileSync(new URL('../e2e/table-create-foreign-keys-live.ts', import.meta.url), 'utf8');
const uuid = '11111111-2222-3333-4444-555555555555';
/** 整个正式模块在VM注册并运行真实预检；只给RAM驱动、TestInfo及隔离DDL边界。 */
function harness(changes: { facts?: Record<string, unknown>; queryUnknown?: boolean; closeUnknown?: boolean; pendingQuery?: boolean; missing?: string } = {}) {
  const raw: Record<string, string | undefined> = { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: uuid }, helper = { ...raw };
  if (changes.missing) delete raw[changes.missing];
  const calls: string[] = [], info = {}, page = { evaluate: vi.fn(async () => []) }, application = {}; let retained = false, body!: Function, after!: Function, finish!: () => void;
  const facts = [{ version: '8.4.11', os: 'Linux', names: 0, uuid, ...changes.facts }];
  const mysql = { createConnection: async (options: Record<string, unknown>) => { calls.push('connect'); expect(options).not.toHaveProperty('database'); return { query: async () => { calls.push('facts'); if (changes.queryUnknown) throw Error('合成读取未知'); if (changes.pendingQuery) await new Promise<void>(resolve => { finish = resolve; }); return [facts]; }, end: async () => { calls.push('close'); if (changes.closeUnknown) throw Error('合成收尾未知'); } }; } };
  const test = Object.assign((_title: string, callback: Function) => { body = callback; }, { use: vi.fn(), describe: { configure: vi.fn() }, afterEach: (callback: Function) => { after = callback; } });
  const context = createContext({ exports: {}, process: { env: raw }, require(name: string) {
    if (name === 'mysql2/promise') return { __esModule: true, default: mysql };
    if (name === './desktop-fixture') return { test, expect, ownedDesktopResources(value: unknown) { expect(value).toBe(info); if (retained) throw Error('合成所属资源已保留'); return { page, application, closed: false }; }, retainOwnedDesktopResources(value: unknown) { expect(value).toBe(info); retained = true; calls.push('retain'); } };
    if (name === './live-helpers') return { environment: helper, isolatedDatabase: async () => { calls.push('database-boundary'); throw Error('合成隔离边界'); } };
    if (name.endsWith('/tableCreateForeignKeysTarget')) return targetHelper;
    if (name.endsWith('/tableCreateForeignKeysLifecycle')) return lifecycle;
    if (name.endsWith('/zh-CN')) return { zh: {}, formatText: () => '' };
    if (name.endsWith('/tableCreate.zh-CN')) return { tableCreateZh: {} };
    throw Error('禁止导入真实外界模块：' + name);
  } });
  runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context);
  return { calls, register: () => context.exports.registerTableCreateForeignKeysUiTests(), run: () => body({}, info) as Promise<void>, after: () => after({}, info), finish: () => finish(), retained: () => retained };
}
describe('FK正式入口的真实预检和DDL前顺序（仅RAM）', () => {
  it.each([{ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, { version: '8.4.12' }, { os: 'Win64' }, { names: 1 }])('已知身份%s不符，确认close后仍不得进入建库', async facts => { const f = harness({ facts }); f.register(); await expect(f.run()).rejects.toThrow(); expect(f.calls).toEqual(['connect', 'facts', 'close']); });
  it.each(['DBARK_TEST_USER', 'DBARK_TEST_PASSWORD'])('helper不能补原始%s，注册时拒绝且无连接', name => { const f = harness({ missing: name }); expect(f.register).toThrow('显式配置'); expect(f.calls).toEqual([]); });
  it.each([{ queryUnknown: true }, { closeUnknown: true }])('预检观察或收尾未知%s保留，不建库或自动退出', async changes => { const f = harness(changes); f.register(); await expect(f.run()).rejects.toThrow(); expect(f.retained()).toBe(true); expect(f.calls).not.toContain('database-boundary'); await expect(f.after()).rejects.toThrow(); });
  it('正确事实且预检真实关闭后，才允许触及原隔离建库边界', async () => { const f = harness(); f.register(); await expect(f.run()).rejects.toThrow('合成隔离边界'); expect(f.calls).toEqual(['connect', 'facts', 'close', 'database-boundary']); });
  it('预检在途时afterEach保留，迟到读取不能继续建库', async () => { const f = harness({ pendingQuery: true }); f.register(); const running = f.run().catch(reason => reason); await vi.waitFor(() => expect(f.calls).toContain('facts')); await expect(f.after()).rejects.toThrow('尚未终态'); f.finish(); const late = await running; expect(late.name).toBe('AggregateError'); expect(late.errors[0]).toBe(late.cause); expect(f.calls).not.toContain('database-boundary'); });
  it('实际SHOW观察表达式保留复合顺序和动作，不依赖产品比较器', () => {
    const tree = ts.createSourceFile('live.ts', source, ts.ScriptTarget.Latest, true); let expression = '';
    function visit(node: ts.Node) { if (ts.isNewExpression(node) && node.expression.getText(tree) === 'RegExp' && node.arguments?.[0].getText(tree).includes('CONSTRAINT `fk_child_parent`')) expression = node.getText(tree); ts.forEachChild(node, visit); } visit(tree); expect(expression).not.toBe('');
    const context = createContext({ context: { database: 'dbark_e2e_unit' } }); runInContext('globalThis.pattern=' + expression, context); const pattern = context.pattern as RegExp;
    const ddl = '  CONSTRAINT `fk_child_parent` FOREIGN KEY (`child_a`, `child_b`) REFERENCES `fk_parent` (`parent_a`, `parent_b`) ON DELETE CASCADE ON UPDATE CASCADE';
    expect(pattern.test(ddl)).toBe(true); expect(pattern.test(ddl.replace('REFERENCES `fk_parent`', 'REFERENCES `dbark_e2e_unit`.`fk_parent`'))).toBe(true);
    for (const changed of [ddl.replace('`child_a`, `child_b`', '`child_b`, `child_a`'), ddl.replace('`parent_a`, `parent_b`', '`parent_b`, `parent_a`'), ddl.replace('ON UPDATE CASCADE', 'ON UPDATE RESTRICT')]) expect(pattern.test(changed)).toBe(false);
  });
});
