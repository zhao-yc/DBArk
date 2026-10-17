import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const file = new URL('../e2e/query-close-others-native.spec.ts', import.meta.url);
const source = readFileSync(file, 'utf8');

/** 仅执行spec声明与环境门，桌面require是会立即失败的哨兵；绝不运行注册的E2E回调。 */
function declareSpec(env: Record<string, string | undefined>, args: string[]) {
  const registrations: string[] = [], skips: unknown[][] = [], uses: unknown[] = [], configs: unknown[] = [];
  const test = Object.assign((title: string, _callback: unknown) => { registrations.push(title); }, {
    skip: (...values: unknown[]) => skips.push(values), use: (value: unknown) => uses.push(value),
    describe: { configure: (value: unknown) => configs.push(value) }, afterAll: vi.fn(),
  });
  const requireMock = vi.fn((name: string) => {
    if (name === '@playwright/test') return { test, expect: () => { throw Error('声明阶段不应执行断言'); } };
    if (name === 'node:fs/promises') return { stat: () => { throw Error('声明阶段不应读目录'); } };
    if (name.includes('/locales/')) return {};
    throw Error('禁止加载桌面或实库模块：' + name);
  });
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(javascript, { require: requireMock, exports: {}, process: { env, argv: args, platform: 'win32' } });
  return { registrations, skips, uses, configs, loaded: requireMock.mock.calls.map(call => call[0]) };
}

/** 抽取准确生产spec中的环境门函数，不复制其拒绝逻辑。 */
function guard(env: Record<string, string | undefined>, args: string[] = []) {
  const tree = ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'assertOfflineCloseOthersEnvironment');
  if (!declaration) throw Error('缺少离线环境门');
  const javascript = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(javascript + '\nassertOfflineCloseOthersEnvironment(env,args);', { env, args });
}

describe('关闭其他查询原生spec的默认关闭与离线准备门（不启动桌面）', () => {
  it('默认关闭及list即使继承实库参数也只登记两例，不加载desktop-fixture', () => {
    for (const [env, args] of [
      [{ DBARK_TEST_PASSWORD: '禁止使用的哨兵' }, []],
      [{ DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST: '1', DBARK_INTEGRATION_ENABLED: '1', DBARK_TEST_HOST: '禁止连接.invalid' }, ['--list']],
      [{ DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST: '1' }, ['--list=true']],
    ] as [Record<string, string>, string[]][]) {
      const result = declareSpec(env, args);
      expect(result.registrations).toHaveLength(2); expect(result.skips[0][0]).toBe(true);
      expect(result.loaded.some(name => /desktop-fixture|live-helper|clipboard/i.test(name))).toBe(false);
      expect(result.uses).toEqual([{ trace: 'off', screenshot: 'off', video: 'off' }]);
      expect(result.configs).toEqual([{ mode: 'serial', timeout: 120000, retries: 0 }]);
    }
  });
  it('启用时必须integration精确为0，错误配置在desktop加载前拒绝', () => {
    for (const value of [undefined, '', '1', 'false']) {
      expect(() => declareSpec({ DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST: '1', DBARK_INTEGRATION_ENABLED: value }, [])).toThrow('integration=0');
    }
    expect(() => guard({ DBARK_INTEGRATION_ENABLED: '0' })).not.toThrow();
  });
  it('仅允许正式runner准确同值EXE别名，其余实库SSH及认证参数即使空值也拒绝', () => {
    const env = { DBARK_INTEGRATION_ENABLED: '0', DBARK_EXECUTABLE_PATH: 'C:/固定候选/DBArk.exe', DBARK_C02_EXECUTABLE_PATH: 'C:/固定候选/DBArk.exe' };
    expect(() => guard(env)).not.toThrow();
    for (const path of ['', 'C:/另一个候选/DBArk.exe']) expect(() => guard({ ...env, DBARK_C02_EXECUTABLE_PATH: path })).toThrow('实库或认证');
    expect(() => guard({ DBARK_INTEGRATION_ENABLED: '0', DBARK_C02_EXECUTABLE_PATH: env.DBARK_C02_EXECUTABLE_PATH })).toThrow();
    for (const key of ['DBARK_TEST_HOST', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_CA', 'DBARK_C02_HOST', 'DBARK_SSH_KEY', 'DBARK_MTLS_CERT', 'DBARK_TLS_CA', 'DBARK_MYSQL_PASSWORD', 'DBARK_MARIADB_PORT', 'DBARK_AUTH_TOKEN', 'DBARK_PASSWORD', 'DBARK_PRIVATE_KEY']) {
      expect(() => guard({ ...env, [key]: '' })).toThrow('实库或认证');
    }
  });
  it('拒绝CLI开启trace及缺值，仅接受准确off', () => {
    const env = { DBARK_INTEGRATION_ENABLED: '0' };
    for (const args of [['--trace', 'on'], ['--trace=retain-on-failure'], ['--trace'], ['--trace=off', '--trace', 'on']]) expect(() => guard(env, args)).toThrow('trace');
    expect(() => guard(env, ['--trace', 'off'])).not.toThrow(); expect(() => guard(env, ['--trace=off'])).not.toThrow();
  });
  it('spec仅使用许可IPC，不导入live-helper、不写store或Monaco、不调queue', () => {
    const tree = ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true), commands: string[] = [], imports: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'invoke') {
        const command = node.arguments[0]; expect(ts.isStringLiteral(command)).toBe(true); commands.push((command as ts.StringLiteral).text);
      }
      node.forEachChild(visit);
    }
    visit(tree);
    expect(commands.sort()).toEqual(['history.list', 'queries.list', 'queries.updateSource', 'settings.get']);
    expect(imports.some(name => /live-helper|clipboard|store|queryCloseQueue/i.test(name))).toBe(false);
    expect(source).not.toMatch(/\.setValue\(|setState\(|settings\.save|queries\.create|query\.execute|advance\(|waitForTimeout|launchDesktop|taskkill|SIGKILL/);
    expect(source).toContain('preserveOnUnconfirmedExit: true'); expect(source).toContain('retainOwnedDesktopResources(info)');
  });
});
