import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationZh } from '../../src/renderer/locales/navigation.zh-CN';

const source = readFileSync(new URL('../e2e/navigation-workbench.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

/** 真实spec仅执行到注册边界；任何桌面加载都立即停止，不启动窗口或读取实库。 */
function collect(args: string[], values: Record<string, string | undefined>) {
  const reads: string[] = [], imports: string[] = [], skip = vi.fn(); let enumerations = 0;
  const env = new Proxy(values, {
    get(target, key: string) { reads.push(key); return target[key]; },
    ownKeys(target) { enumerations++; return Reflect.ownKeys(target); }
  });
  const run = () => runInNewContext(compiled, {
    exports: {}, process: { argv: ['node', 'playwright', 'test', ...args], env },
    require(name: string) {
      imports.push(name);
      if (name === 'node:crypto') return { randomUUID: () => { throw Error('关闭门不得生成资源'); } };
      if (name === '@playwright/test') return { test: { skip } };
      if (name === '../../src/renderer/locales/zh-CN') return { zh };
      if (name === '../../src/renderer/locales/navigation.zh-CN') return { navigationZh };
      throw Error('RAM已到明确桌面注册边界');
    }
  });
  return { run, reads, imports, skip, enumerations: () => enumerations };
}

describe('新导航专项默认及列表封闭门（纯RAM）', () => {
  it.each(['--list', '--list=json'])('%s即使专项已开启也不读取环境或加载桌面', flag => {
    const f = collect([flag], { DBARK_NAVIGATION_WORKBENCH_TEST: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_TEST_PASSWORD: '不得读取的凭据' });
    f.run(); expect(f.reads).toEqual([]); expect(f.enumerations()).toBe(0); expect(f.imports).not.toContain('./desktop-fixture'); expect(f.skip).toHaveBeenCalledOnce();
  });
  it.each([undefined, '0', 'false'])('默认/关闭门%s只检查专项标志，不读取凭据或分配资源', flag => {
    const f = collect([], { DBARK_NAVIGATION_WORKBENCH_TEST: flag, DBARK_INTEGRATION_ENABLED: '1', DBARK_TEST_PASSWORD: '不得读取的凭据' });
    f.run(); expect(f.reads).toEqual(['DBARK_NAVIGATION_WORKBENCH_TEST']); expect(f.enumerations()).toBe(0); expect(f.imports).not.toContain('./desktop-fixture'); expect(f.skip).toHaveBeenCalledOnce();
  });
  it.each([undefined, '1'])('显式专项但非明确离线%s在桌面导入前拒绝', integration => {
    const f = collect([], { DBARK_NAVIGATION_WORKBENCH_TEST: '1', DBARK_INTEGRATION_ENABLED: integration });
    expect(f.run).toThrow('必须显式离线'); expect(f.imports).not.toContain('./desktop-fixture'); expect(f.enumerations()).toBe(0);
  });
  it.each([{ DBARK_TEST_PASSWORD: '存在的凭据' }, { DBARK_TEST_HOST: '存在的主机' }, { DBARK_DEV_URL: 'http://不应访问的开发页/' }])('已离线但继承私网/开发环境时拒绝注册', extra => {
    const f = collect([], { DBARK_NAVIGATION_WORKBENCH_TEST: '1', DBARK_INTEGRATION_ENABLED: '0', ...extra });
    expect(f.run).toThrow('不能继承'); expect(f.imports).not.toContain('./desktop-fixture'); expect(f.skip).not.toHaveBeenCalled();
  });
  it('仅准确专项1/实库0且无继承入口可到注册边界，仍不运行桌面', () => {
    const f = collect([], { DBARK_NAVIGATION_WORKBENCH_TEST: '1', DBARK_INTEGRATION_ENABLED: '0' });
    expect(f.run).toThrow('RAM已到明确桌面注册边界');
    expect(f.imports.at(-1)).toBe('./desktop-fixture'); expect(f.skip).not.toHaveBeenCalled();
    expect(f.reads).toEqual(['DBARK_NAVIGATION_WORKBENCH_TEST', 'DBARK_INTEGRATION_ENABLED', 'DBARK_DEV_URL']);
  });
});
