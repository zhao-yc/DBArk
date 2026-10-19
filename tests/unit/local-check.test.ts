import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const localCheck = await import(new URL('../../scripts/check-local.mjs', import.meta.url).href);
const roots: string[] = [];

/** 构造仅含三个短命 Node 命令的临时工程，不调用真实编译器或客户端。 */
function fixture(failTypecheck = false) {
  const root = mkdtempSync(join(tmpdir(), 'dbark-local-check-'));
  roots.push(root);
  for (const file of ['tests/unit/one.test.ts', 'tests/unit/space name.test.tsx', 'tests/integration/real.test.ts']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  for (const [file, name, status] of [
    ['node_modules/typescript/bin/tsc', 'typecheck', failTypecheck ? 7 : 0],
    ['node_modules/vitest/vitest.mjs', 'unit', 0],
    ['scripts/build.mjs', 'build', 0]
  ] as const) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    const append = `require('node:fs').appendFileSync('calls.jsonl', JSON.stringify({name:${JSON.stringify(name)},args:process.argv.slice(2)})+'\\n');process.exit(${status});`;
    writeFileSync(join(root, file), file.endsWith('.mjs') ? `import { createRequire } from 'node:module';const require=createRequire(import.meta.url);${append}` : append);
  }
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('本地定向检查入口', () => {
  it('无文件、通配符和未知选项均拒绝，不会退回全量测试', () => {
    const root = fixture();
    for (const args of [[], ['--build'], ['tests/unit/*.test.ts'], ['--watch'], ['--build', '--build', 'tests/unit/one.test.ts']]) {
      expect(() => localCheck.parseLocalCheckArguments(args, root)).toThrow();
    }
  });

  it('拒绝集成测试、目录和不存在的文件', () => {
    const root = fixture();
    for (const file of ['tests/integration/real.test.ts', 'tests/unit', 'tests/unit/missing.test.ts']) {
      expect(() => localCheck.parseLocalCheckArguments([file], root)).toThrow();
    }
  });

  it('明确文件去重并保留含空格的组件测试参数', () => {
    const root = fixture();
    expect(localCheck.parseLocalCheckArguments(['--', '--build', 'tests/unit/one.test.ts', 'tests/unit/space name.test.tsx', 'tests/unit/one.test.ts'], root))
      .toEqual({ build: true, tests: ['tests/unit/one.test.ts', 'tests/unit/space name.test.tsx'] });
  });

  it('只执行一次类型检查、准确测试文件和可选普通构建', () => {
    const root = fixture();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(localCheck.runLocalCheck(['--build', 'tests/unit/space name.test.tsx'], root)).toBe(0);
    const calls = readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(calls).toEqual([
      { name: 'typecheck', args: ['--noEmit'] },
      { name: 'unit', args: ['run', 'tests/unit/space name.test.tsx'] },
      { name: 'build', args: [] }
    ]);
  });

  it('首阶段失败保留原退出码，测试和构建不再执行', () => {
    const root = fixture(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(localCheck.runLocalCheck(['--build', 'tests/unit/one.test.ts'], root)).toBe(7);
    const calls = readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(calls).toEqual([{ name: 'typecheck', args: ['--noEmit'] }]);
  });

  it('默认不构建；帮助在缺依赖工程中也不触发任何工具', () => {
    const root = fixture();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(localCheck.runLocalCheck(['tests/unit/one.test.ts'], root)).toBe(0);
    const calls = readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(calls.map(call => call.name)).toEqual(['typecheck', 'unit']);
    expect(localCheck.runLocalCheck(['--help'], join(root, 'missing'))).toBe(0);
  });
});
