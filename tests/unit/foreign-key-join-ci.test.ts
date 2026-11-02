import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';

// 同仓库固定运行器不依赖Electron；只在显式入口才启动原生子进程。
const runner = await import(new URL('../../scripts/foreign-key-join-ci.mjs', import.meta.url).href);
afterEach(() => vi.restoreAllMocks());

/** 直接执行原spec守卫表达式，确保清洗结果满足实际保护，而非另一份复制规则。 */
function forbidden(env: Record<string, string>) {
  const source = ts.createSourceFile('join-native.ts', readFileSync('tests/e2e/table-foreign-key-join-order-native.spec.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const values: ts.VariableDeclaration[] = []; const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'forbidden') values.push(node); ts.forEachChild(node, visit); }; visit(source); expect(values).toHaveLength(1);
  const context = { process: { env }, exports: {} as { value?: string[] } };
  runInNewContext(ts.transpileModule('exports.value=' + values[0].initializer!.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return Array.from(context.exports.value!);
}
it('清除CI继承的NODE_PATH及认证/路径/注入，保留必要系统环境，不改父对象或输出值', () => {
  const parent = Object.freeze({ PATH: '合成系统路径', HOME: '合成主目录', NODE_PATH: '合成模块路径', NODE_OPTIONS: '合成模块选项', node_path: '小写模块路径', ELECTRON_RUN_AS_NODE: '1', DBARK_TEST_PASSWORD: '合成秘密', DBARK_USER_DATA: '不可复用profile', MYSQL_PASSWORD: '合成数据库秘密', SSH_AUTH_SOCK: '合成代理', PGHOST: '合成PG主机', PLAYWRIGHT_JSON_OUTPUT_NAME: '不能重定向', CODEX_MCP_NODE_PATH: '工具字段', optional: undefined });
  const value = runner.foreignKeyJoinOfflineEnvironment(parent);
  expect(forbidden(value.env)).toEqual([]); expect(value.env).toMatchObject({ PATH: parent.PATH, HOME: parent.HOME, CODEX_MCP_NODE_PATH: parent.CODEX_MCP_NODE_PATH, DBARK_JOIN_ORDER_NATIVE: '1', DBARK_INTEGRATION_ENABLED: '0' });
  for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'node_path', 'ELECTRON_RUN_AS_NODE', 'DBARK_TEST_PASSWORD', 'DBARK_USER_DATA', 'MYSQL_PASSWORD', 'SSH_AUTH_SOCK', 'PGHOST', 'optional']) expect(value.env).not.toHaveProperty(key);
  expect(value.env.PLAYWRIGHT_JSON_OUTPUT_NAME.replaceAll('\\', '/')).toMatch(/\/test-results\/foreign-key-join\/report\.json$/);
  expect(parent.NODE_PATH).toBe('合成模块路径'); expect(JSON.stringify(value)).not.toContain('合成秘密');
});
it('原十二例固定文件、单worker、零重试和trace关闭，不接受调用者覆盖', () => {
  const args = runner.foreignKeyJoinOfflineCommand(); expect(args.slice(1)).toEqual(['test', 'tests/e2e/table-foreign-key-join-order-native.spec.ts', '--workers=1', '--retries=0', '--trace=off', '--reporter=list,json', '--output=test-results/foreign-key-join']);
  const execute = vi.fn(); expect(() => runner.runForeignKeyJoinOffline(['--timeout=999999'], execute, {})).toThrow('不接受参数'); expect(execute).not.toHaveBeenCalled();
});
it.each([0, 1, 2])('准确原终态%s透传，仅启动一次且不泄露环境值', status => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {}), execute = vi.fn<(_executable: string, _args: string[], _options: Record<string, unknown>) => { status: number; signal: null }>(() => ({ status, signal: null }));
  expect(runner.runForeignKeyJoinOffline([], execute, { NODE_PATH: '不可输出的模块路径', DBARK_TEST_PASSWORD: '不可输出的秘密' })).toBe(status);
  expect(execute).toHaveBeenCalledOnce(); expect(execute.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true, stdio: 'inherit' });
  expect(JSON.stringify(log.mock.calls)).not.toContain('不可输出');
});
it.each([{ status: null, signal: 'SIGTERM' }, { status: null, signal: null }, { status: undefined, signal: null }, { error: Error('合成启动失败'), status: null }])('未知退出及启动失败不能报告通过或自动重试：%j', result => {
  vi.spyOn(console, 'log').mockImplementation(() => {}); const execute = vi.fn(() => result);
  expect(() => runner.runForeignKeyJoinOffline([], execute, {})).toThrow(); expect(execute).toHaveBeenCalledOnce();
});
