import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const script = ts.transpileModule(readFileSync(new URL('../e2e/query-file-reload.spec.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const valid = { DBARK_QUERY_FILE_RELOAD_UI: '1', DBARK_QUERY_FILE_RELOAD_OWNER: '12345678-1234-4234-8234-123456789abc', DBARK_QUERY_FILE_RELOAD_SOURCE: 'a'.repeat(40) };
/** 执行真实声明入口；只替换测试登记与live模块，任何其它资源require立即拒绝。 */
function declare(env: Record<string, string | undefined>, argv: string[] = []) {
  const skipped: string[] = [], loaded: any[] = [];
  const run = () => runInNewContext(script, { exports: {}, process: { env, argv }, require(name: string) {
    if (name === '@playwright/test') return { test: { skip(title: string) { skipped.push(title); } } };
    if (name === './query-file-reload-live') return { registerQueryFileReloadUi(binding: any) { loaded.push(binding); } };
    throw Error('声明阶段访问了未知资源：' + name);
  } });
  return { run, skipped, loaded };
}
it.each([{}, { ...valid, DBARK_QUERY_FILE_RELOAD_UI: '0' }, { ...valid, DBARK_QUERY_FILE_RELOAD_UI: 'true' }])('未明确启用只登记skip，不加载live：%j', env => {
  const value = declare(env); value.run(); expect(value.skipped).toHaveLength(1); expect(value.loaded).toEqual([]);
});
it.each(['--list', '--list=true'])('list即使带错误授权也不读取资源：%s', arg => {
  const value = declare({ DBARK_QUERY_FILE_RELOAD_UI: '1' }, [arg]); value.run(); expect(value.skipped).toHaveLength(1); expect(value.loaded).toEqual([]);
});
it.each([{ ...valid, DBARK_QUERY_FILE_RELOAD_OWNER: undefined }, { ...valid, DBARK_QUERY_FILE_RELOAD_OWNER: 'foreign' }, { ...valid, DBARK_QUERY_FILE_RELOAD_SOURCE: 'main' }])('缺少准确owner/源码时加载live前拒绝：%j', env => {
  const value = declare(env); expect(value.run).toThrow('缺少准确源码或独立owner'); expect(value.loaded).toEqual([]);
});
it.each(['DBARK_QUERY_FILE_RELOAD_UI', 'DBARK_QUERY_FILE_RELOAD_OWNER', 'DBARK_QUERY_FILE_RELOAD_SOURCE'])('存活门不能在环境漂移后复活：%s', key => {
  const env: Record<string, string | undefined> = { ...valid }, value = declare(env); value.run(); expect(value.skipped).toEqual([]); expect(value.loaded).toHaveLength(1);
  const binding = value.loaded[0]; expect(binding.source).toBe(valid.DBARK_QUERY_FILE_RELOAD_SOURCE); binding.assertCurrent();
  env[key] = 'changed'; expect(binding.assertCurrent).toThrow('原环境已失效');
  env[key] = valid[key as keyof typeof valid]; expect(binding.assertCurrent).toThrow('原环境已失效');
});
it('原参数被替换再恢复也不能重领旧owner', () => {
  const args = ['test'], value = declare({ ...valid }, args); value.run(); const binding = value.loaded[0];
  args.push('--list'); expect(binding.assertCurrent).toThrow('原环境已失效'); args.pop(); expect(binding.assertCurrent).toThrow('原环境已失效');
});
