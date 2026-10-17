import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/table-create-foreign-keys.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const gates = [['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']] as const;
/** 转译生产入口，认证环境及任何实际模块读取均由RAM边界拒绝。 */
function collect(argv: string[], integration: string, create: string) {
  const reads: string[] = [], skipped = vi.fn(), loaded: string[] = [], register = vi.fn();
  const values: Record<string, string> = { DBARK_INTEGRATION_ENABLED: integration, DBARK_TABLE_CREATE_FOREIGN_KEYS_UI: create };
  const context = createContext({ exports: {}, process: { argv: ['node', 'playwright', 'test', ...argv], env: new Proxy(values, { get(target, key: string) { reads.push(key); if (!Object.hasOwn(target, key)) throw Error('不能读取认证环境：' + key); return target[key]; } }) }, require(name: string) {
    if (name === '@playwright/test') return { test: { skip: skipped } };
    loaded.push(name); if (name === './table-create-foreign-keys-live' && !argv.some(value => value === '--list' || value.startsWith('--list='))) return { registerTableCreateForeignKeysUiTests: register }; throw Error('收集期间不得导入实际模块：' + name);
  } });
  runInContext(compiled, context); return { reads, skipped, loaded, register };
}

describe('新建表外键正式隔离入口默认关闭', () => {
  for (const flag of ['--list', '--list=json']) it.each(gates)(`${flag} 两门%s/%s在env前短路`, (integration, create) => {
    const result = collect([flag], integration, create); expect(result.reads).toEqual([]); expect(result.loaded).toEqual([]); expect(result.skipped).toHaveBeenCalledTimes(1);
  });
  it.each(gates)('非list两门%s/%s只有双开才调用RAM注册端口', (integration, create) => {
    const result = collect([], integration, create), active = integration === '1' && create === '1'; expect(result.loaded).toEqual(active ? ['./table-create-foreign-keys-live'] : []); expect(result.skipped).toHaveBeenCalledTimes(active ? 0 : 1); expect(result.register).toHaveBeenCalledTimes(active ? 1 : 0);
    if (!active) expect(result.skipped.mock.calls[0][0]).toContain('默认关闭');
  });
});
