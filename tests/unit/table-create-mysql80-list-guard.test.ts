import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { tableCreatePreparationProfile } from '../../src/shared/tableCreateProfiles';

const source = readFileSync(new URL('../e2e/table-create-mysql80.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const gates = [['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']] as const;
/** 转译实际入口并限制require和env读取；不加载任何桌面、驱动、live或私有配置模块。 */
function collect(argv: string[], integration: string, create: string, profileOverride?: Record<string, unknown>) {
  const loaded: string[] = [], reads: string[] = [], skipped = vi.fn();
  const values: Record<string, string> = { DBARK_INTEGRATION_ENABLED: integration, DBARK_TABLE_CREATE_MYSQL80_UI: create };
  const context = createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...argv], env: new Proxy(values, { get(target, name: string) { reads.push(name); if (!Object.hasOwn(target, name)) throw Error('准备入口不能读取认证或其它环境：' + name); return target[name]; } }) }, require(name: string) {
    if (name === '@playwright/test') return { test: { skip: skipped } };
    loaded.push(name);
    if (argv.some(value => value === '--list' || value.startsWith('--list='))) throw Error('list不得加载准备合同以外的模块：' + name);
    if (name === '../../src/shared/tableCreateProfiles') return { tableCreatePreparationProfile: profileOverride ? () => profileOverride : tableCreatePreparationProfile };
    throw Error('准备入口不得加载实际模块：' + name);
  } });
  return { loaded, reads, skipped, run: () => runInContext(compiled, context) };
}

describe('8.0.46新建表正式入口仅准备且列表先短路', () => {
  for (const flag of ['--list', '--list=json']) it.each(gates)(`${flag} 两门%s/%s不读env、不加载合同/live/认证模块`, (integration, create) => {
    const f = collect([flag], integration, create); f.run(); expect(f.reads).toEqual([]); expect(f.loaded).toEqual([]);
    expect(f.skipped).toHaveBeenCalledExactlyOnceWith('MySQL8.0.46新建表正式UI准备入口默认关闭（实际0）', expect.any(Function));
  });
  it.each(gates)('非list两门%s/%s至多读取纯准备合同，双开仍只skip', (integration, create) => {
    const f = collect([], integration, create); f.run(); const active = integration === '1' && create === '1';
    expect(f.loaded).toEqual(active ? ['../../src/shared/tableCreateProfiles'] : []);
    expect(f.skipped).toHaveBeenCalledTimes(1); expect(f.skipped.mock.calls[0][0]).toContain(active ? '等待Root另行激活' : '默认关闭');
    expect(f.reads.every(name => Object.hasOwn({ DBARK_INTEGRATION_ENABLED: true, DBARK_TABLE_CREATE_MYSQL80_UI: true }, name))).toBe(true);
  });
  it.each([{ state: 'prepared', canWrite: true }, { state: 'verified', canWrite: true }, { state: 'unsupported', canWrite: false }, { state: 'prepared' }])('假设合同被另改为%s，仍不能借旧8.4回调写入', override => {
    const f = collect([], '1', '1', override); expect(f.run).toThrow('尚未激活'); expect(f.loaded).toEqual(['../../src/shared/tableCreateProfiles']); expect(f.skipped).not.toHaveBeenCalled();
  });
});
