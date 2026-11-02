import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { relationshipLiveEnvironment } from '../e2e/relationship-diagram-live-gate';

const source = readFileSync(new URL('../e2e/relationship-diagram-live.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 执行真实注册代码但不运行测试体；任何驱动／桌面／文件require均在RAM端口拒绝。 */
function collect(args: string[], values: Record<string, string | undefined>) {
  const reads: string[] = [], modules: string[] = [], skip = vi.fn(), register = vi.fn(), fake = Object.assign(register, { skip, use: vi.fn(), describe: { configure: vi.fn() }, afterEach: vi.fn() });
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); return target[key]; } });
  const execute = () => runInContext(compiled, createContext({ exports: {}, process: { argv: ['node', 'playwright', ...args], env, platform: 'win32' }, require(name: string) {
    modules.push(name); if (name === '@playwright/test') return { test: fake, expect: vi.fn() };
    if (name.includes('/locales/')) return {}; if (name === './relationship-diagram-live-gate') return { relationshipLiveEnvironment };
    throw Error('默认/无效门不得加载驱动或桌面：' + name);
  } }));
  return { execute, reads, modules, skip, register };
}
describe('ER实库入口默认安全注册', () => {
  it.each(['--list', '--list=json'])('%s不读取环境、不加载桌面或认证，仍登记原用例', argument => {
    const f = collect([argument], { DBARK_ER_LIVE_NATIVE: '1' }); f.execute(); expect(f.reads).toEqual([]); expect(f.modules.some(name => /desktop|mysql2|engine|live-gate/.test(name))).toBe(false); expect(f.register).toHaveBeenCalledOnce(); expect(f.skip).toHaveBeenCalledWith(true, expect.any(String));
  });
  it('默认只读专项开关，不读取数据库认证或用户文件', () => {
    const f = collect([], {}); f.execute(); expect(f.reads).toEqual(['DBARK_ER_LIVE_NATIVE']); expect(f.modules.some(name => /desktop|mysql2|engine|live-gate/.test(name))).toBe(false); expect(f.skip).toHaveBeenCalledWith(true, expect.any(String));
  });
  it('显式开关但环境不完整，在加载桌面前拒绝，不静默计为通过', () => {
    const f = collect([], { DBARK_ER_LIVE_NATIVE: '1', DBARK_INTEGRATION_ENABLED: '0' }); expect(f.execute).toThrow('实库门'); expect(f.modules).toContain('./relationship-diagram-live-gate'); expect(f.modules.some(name => /desktop|mysql2|engine/.test(name))).toBe(false); expect(f.register).not.toHaveBeenCalled();
  });
});
