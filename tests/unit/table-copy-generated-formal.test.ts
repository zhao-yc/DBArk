import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { tableCopyStructureTarget } from '../helpers/tableCopyStructureTarget';

const gates = [['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']] as const;
const uuid = '11111111-2222-3333-4444-555555555555';
const environment = () => ({ DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成账号', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: uuid });
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
/** 真实spec仅转译执行；所有模块和配置均为RAM，list不得读取任何env或加载live。 */
function listing(argv: string[], integration: string, generated: string) {
  const reads: string[] = [], loaded: string[] = [], skip = vi.fn(), register = vi.fn(), values = { ...environment(), DBARK_INTEGRATION_ENABLED: integration, DBARK_TABLE_COPY_GENERATED_UI: generated };
  const context = createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...argv], env: new Proxy(values, { get(object, name: string) { reads.push(name); return (object as Record<string, string>)[name]; } }) }, require(name: string) {
    if (name === '@playwright/test') return { test: { skip } };
    loaded.push(name); if (argv.some(value => value.startsWith('--list'))) throw Error('list不得加载模块');
    if (name === '../helpers/tableCopyStructureTarget') return { tableCopyStructureTarget };
    if (name === 'node:fs') return { existsSync: () => false };
    if (name === './table-copy-generated-live') return { registerTableCopyGeneratedUiTests: register };
    throw Error('拒绝实际导入');
  } });
  runInContext(compile(readFileSync(new URL('../e2e/table-copy-generated.spec.ts', import.meta.url), 'utf8')), context); return { reads, loaded, skip, register };
}

describe('普通生成列复制正式入口默认关闭', () => {
  for (const flag of ['--list', '--list=json']) it.each(gates)(`${flag}两门%s/%s不读取env或加载桌面`, (integration, generated) => {
    const f = listing([flag], integration, generated); expect(f.reads).toEqual([]); expect(f.loaded).toEqual([]); expect(f.skip).toHaveBeenCalledTimes(1);
  });
  it.each(gates)('非list两门%s/%s仅准确双开注册RAM端口', (integration, generated) => {
    const f = listing([], integration, generated); expect(f.register).toHaveBeenCalledTimes(integration === '1' && generated === '1' ? 1 : 0);
  });
});

/** 运行真实register及原专用cleanup，仅用合成观察连接；不加载真实driver、fixture或认证helper。 */
function formal(factsChange: Record<string, unknown> = {}, queryUnknown = false) {
  const calls: string[] = [], cases: { name: string; body: Function }[] = [], info = {}, resource = { closed: false, application: {}, page: { evaluate: vi.fn(async () => []) } };
  let retained = false;
  const own = (value: unknown) => { expect(value).toBe(info); if (retained) throw Error('归属未知已保留'); return resource; };
  const retain = () => { calls.push('retain'); retained = true; };
  const observer = { query: async (sql: string) => { calls.push(sql); if (queryUnknown) throw Error('合成读取未知'); return [[{ version: '8.4.11', os: 'Linux', names: 0, uuid, ...factsChange }]]; }, end: async () => { calls.push('end'); } };
  const old = readFileSync(new URL('../e2e/table-copy-structure-live.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('old.ts', old, ts.ScriptTarget.Latest, true);
  const functions = tree.statements.filter(node => ts.isFunctionDeclaration(node) && ['assertTableCopyStructureTasksTerminal', 'cleanupTableCopyStructureCase'].includes(node.name?.text ?? '')).map(node => node.getText(tree)).join('\n');
  const cleanup = { exports: {} as Record<string, Function>, expect, ownedDesktopResources: own, retainOwnedDesktopResources: retain, confirmOwnedDesktopExit: async () => { calls.push('exit'); resource.closed = true; } };
  runInContext(compile(functions), createContext(cleanup));
  const test = Object.assign((name: string, body: Function) => { cases.push({ name, body }); }, { use: vi.fn(), setTimeout: vi.fn(), describe: { configure: vi.fn() } });
  const context = createContext({ exports: {} as Record<string, Function>, process: { env: environment() }, require(name: string) {
    if (name === './table-copy-structure-live') return cleanup.exports;
    if (name === './desktop-fixture') return { test, expect, ownedDesktopResources: own, retainOwnedDesktopResources: retain };
    if (name === 'node:crypto') return { randomUUID: () => uuid };
    if (name === 'mysql2/promise') return { __esModule: true, default: { createConnection: async () => { calls.push('open'); return observer; } } };
    if (name === './live-helpers') return { environment: environment(), connectAndCreate: async () => { calls.push('create-database'); throw Error('测试不允许隔离DDL'); } };
    if (name === '../helpers/tableCopyStructureTarget') return { tableCopyStructureTarget };
    if (name.endsWith('/tableCopyStructure.zh-CN')) return { tableCopyStructureZh: {} };
    throw Error('拒绝实际导入：' + name);
  } });
  runInContext(compile(readFileSync(new URL('../e2e/table-copy-generated-live.ts', import.meta.url), 'utf8')), context); context.exports.registerTableCopyGeneratedUiTests();
  return { calls, cases, run: (index = 0) => cases[index].body({}, info) };
}
describe('生成列正式定义实际前置（仅RAM观察端口）', () => {
  it('分别注册VIRTUAL和STORED；注册本身不连接、不建库', () => {
    const f = formal(); expect(f.cases.map(value => value.name)).toEqual([expect.stringContaining('VIRTUAL'), expect.stringContaining('STORED')]); expect(f.calls).toEqual([]);
  });
  it.each([{ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, { version: '8.0.46' }, { os: 'Win64' }, { names: 1 }])('实际身份%s不符时在任何隔离DDL前拒绝', async change => {
    const f = formal(change); await expect(f.run()).rejects.toThrow(); expect(f.calls).not.toContain('create-database'); expect(f.calls.some(value => value.startsWith('DROP'))).toBe(false); expect(f.calls).toContain('end');
  });
  it('观察未知保留，不借退出或DROP继续', async () => {
    const f = formal({}, true); await expect(f.run()).rejects.toThrow(); expect(f.calls).toContain('retain'); expect(f.calls).not.toContain('create-database'); expect(f.calls).not.toContain('exit'); expect(f.calls).not.toContain('end');
  });
});
