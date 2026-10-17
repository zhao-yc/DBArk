import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { tableCreateMysql80Target } from '../helpers/tableCreateMysql80Preparation';
const source = readFileSync(new URL('../e2e/table-create-mysql80.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const gates = [['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']] as const;
const credentials = () => ({ DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13380', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成账号', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: '11111111-2222-3333-4444-555555555555' });
/** 执行真实入口，只提供RAM注册端口；所有实际模块均禁止加载。 */
function collect(argv: string[], integration: string, create: string, changes: Record<string, string | undefined> = {}, fallback = false) {
  const loaded: string[] = [], reads: string[] = [], skip = vi.fn(), register = vi.fn();
  const values: Record<string, string | undefined> = { DBARK_INTEGRATION_ENABLED: integration, DBARK_TABLE_CREATE_MYSQL80_UI: create, ...credentials(), ...changes };
  for (const name of Object.keys(values)) if (values[name] === undefined) delete values[name];
  const context = createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...argv], env: new Proxy(values, { get(target, name: string) { reads.push(name); return target[name]; } }) }, require(name: string) {
    if (name === '@playwright/test') return { test: { skip } };
    loaded.push(name);
    if (argv.some(value => value === '--list' || value.startsWith('--list='))) throw Error('列表不得加载模块：' + name);
    if (name === '../helpers/tableCreateMysql80Preparation') return { tableCreateMysql80Target };
    if (name === 'node:fs') return { existsSync: (file: string) => { expect(file).toBe('.cache/dbark-test.env'); return fallback; } };
    if (name === './table-create-mysql80-live') return { registerTableCreateMysql80UiTests: register };
    throw Error('不得实际导入：' + name);
  } });
  return { loaded, reads, skip, register, run: () => runInContext(compiled, context) };
}
describe('8.0.46新建表准确组合未来正式入口', () => {
  for (const flag of ['--list', '--list=json']) it.each(gates)(`${flag}两门%s/%s不读env或加载认证/live`, (integration, create) => {
    const f = collect([flag], integration, create); f.run(); expect(f.reads).toEqual([]); expect(f.loaded).toEqual([]); expect(f.skip).toHaveBeenCalledTimes(1);
  });
  it.each(gates)('非list两门%s/%s仅双开及准确原始配置后注册', (integration, create) => {
    const f = collect([], integration, create); f.run(); const active = integration === '1' && create === '1';
    expect(f.register).toHaveBeenCalledTimes(active ? 1 : 0); expect(f.skip).toHaveBeenCalledTimes(active ? 0 : 1);
    expect(f.loaded).toEqual(active ? ['../helpers/tableCreateMysql80Preparation', 'node:fs', './table-create-mysql80-live'] : []);
  });
  it.each([{ DBARK_TEST_USER: undefined }, { DBARK_TEST_PASSWORD: undefined }, { DBARK_TEST_PORT: '13384' }, { DBARK_TEST_TLS: '1' }, { DBARK_TEST_EXPECTED_SERVER_UUID: 'unknown' }])('原始配置%s不完整时不加载真实定义', changes => {
    const f = collect([], '1', '1', changes); expect(f.run).toThrow(); expect(f.register).not.toHaveBeenCalled(); expect(f.loaded).not.toContain('./table-create-mysql80-live');
  });
  it('有回填文件时在加载任何helper或真实定义前拒绝，不读取文件内容', () => {
    const f = collect([], '1', '1', {}, true); expect(f.run).toThrow('回填文件'); expect(f.register).not.toHaveBeenCalled(); expect(f.loaded).not.toContain('./table-create-mysql80-live');
  });
});
