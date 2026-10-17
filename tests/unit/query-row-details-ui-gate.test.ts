import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { splitSql } from '../../src/engine/sql';
import { bindQueryRowDetailsUiTarget, queryRowDetailsUiSql, queryRowDetailsUiValues } from '../helpers/queryRowDetailsUi';

const entry = readFileSync(new URL('../e2e/query-row-details.spec.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../e2e/query-row-details-ui.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(entry, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const gates = [['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']] as const;
/** 只执行真实入口的转译结果，所有模块端口为RAM，禁止加载桌面、实库或凭据文件。 */
function collect(argv: string[], integration: string, details: string) {
  const loaded: string[] = [], reads: string[] = [], skip = vi.fn(), bind = vi.fn(() => ({})), register = vi.fn();
  const values = { DBARK_INTEGRATION_ENABLED: integration, DBARK_QUERY_ROW_DETAILS_UI: details };
  const env = new Proxy(values, { get(values, key: string) { reads.push(key); if (!Object.hasOwn(values, key)) throw Error('收集不应读取凭据或额外配置'); return values[key as keyof typeof values]; } });
  const context = createContext({ exports: {}, process: { argv: ['node', 'playwright', ...argv], env }, require(name: string) {
    if (name === '@playwright/test') return { test: { skip } };
    loaded.push(name);
    if (argv.some(value => value === '--list' || value.startsWith('--list='))) throw Error('列表不应加载实际模块');
    if (name === '../helpers/queryRowDetailsUi') return { bindQueryRowDetailsUiTarget: bind };
    if (name === './query-row-details-ui') return { registerQueryRowDetailsUi: register };
    throw Error('不允许实际require：' + name);
  } });
  runInContext(compiled, context); return { loaded, reads, skip, bind, register };
}
/** 此处全部是假凭据和RAM环境；不读取process.env，也不连接目标。 */
function environment(): Record<string, string | undefined> {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_QUERY_ROW_DETAILS_UI: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'RAM只读账号', DBARK_TEST_PASSWORD: 'RAM非真实密码', DBARK_TEST_EXPECTED_SERVER_UUID: '01234567-89ab-cdef-0123-456789abcdef', DBARK_TEST_DATABASE: 'dbark_row_details_' + 'a'.repeat(32), DBARK_QUERY_ROW_DETAILS_MARKER: 'a'.repeat(32), DBARK_EXECUTABLE_PATH: 'D:\\RAM\\DBArk.exe' };
}

describe('整行详情实库UI默认关闭与列表纯收集', () => {
  for (const flag of ['--list', '--list=json']) it.each(gates)(`${flag} 两门%s/%s不读环境或加载实际模块`, (integration, details) => {
    const result = collect([flag], integration, details);
    expect(result.reads).toEqual([]); expect(result.loaded).toEqual([]); expect(result.bind).not.toHaveBeenCalled(); expect(result.register).not.toHaveBeenCalled();
    expect(result.skip).toHaveBeenCalledWith('查询结果整行详情实库UI默认关闭（未执行）', expect.any(Function));
  });
  it.each(gates)('非列表两门%s/%s只有双开才按顺序绑定RAM配置及注册', (integration, details) => {
    const result = collect([], integration, details), active = integration === '1' && details === '1';
    expect(result.loaded).toEqual(active ? ['../helpers/queryRowDetailsUi', './query-row-details-ui'] : []);
    expect(result.bind).toHaveBeenCalledTimes(active ? 1 : 0); expect(result.register).toHaveBeenCalledTimes(active ? 1 : 0); expect(result.skip).toHaveBeenCalledTimes(active ? 0 : 1);
    expect(result.reads.every(key => ['DBARK_INTEGRATION_ENABLED', 'DBARK_QUERY_ROW_DETAILS_UI'].includes(key))).toBe(true);
    if (active) expect(result.bind.mock.invocationCallOrder[0]).toBeLessThan(result.register.mock.invocationCallOrder[0]);
  });
});

describe('准确Root目标与单向配置失效（纯RAM）', () => {
  it('仅准确目标、随机库及同值C02安装别名通过；不加载驱动或创建文件', () => {
    const raw = environment(); raw.DBARK_C02_EXECUTABLE_PATH = raw.DBARK_EXECUTABLE_PATH;
    const binding = bindQueryRowDetailsUiTarget(() => raw, ['node', '--trace=off']); binding.assertCurrent();
    expect(binding.target).toMatchObject({ host: '192.168.31.200', port: 13384, marker: 'a'.repeat(32) }); expect(Object.isFrozen(binding.target)).toBe(true);
  });
  it.each([
    ['DBARK_TEST_HOST', '127.0.0.1'], ['DBARK_TEST_PORT', '13484'], ['DBARK_TEST_TLS', '1'], ['DBARK_TEST_USER', ''], ['DBARK_TEST_PASSWORD', undefined],
    ['DBARK_TEST_EXPECTED_SERVER_UUID', 'unknown'], ['DBARK_TEST_DATABASE', 'production'], ['DBARK_QUERY_ROW_DETAILS_MARKER', '../unknown'], ['DBARK_EXECUTABLE_PATH', 'relative.exe'],
    ['DBARK_TEST_SSH', '1'], ['DBARK_TEST_CA', 'D:\\never-read.pem'], ['DBARK_SSH_HOST', 'unknown'], ['DBARK_MTLS_KEY', 'never-read.key'], ['DBARK_C02_EXECUTABLE_PATH', 'D:\\other.exe'], ['DBARK_TEST_URL', 'mysql://other'], ['DBARK_DEV_URL', 'http://other'], ['ELECTRON_RUN_AS_NODE', '1'],
  ])('%s错误配置在桌面加载前拒绝', (key, value) => {
    const raw = environment(); raw[key!] = value; expect(() => bindQueryRowDetailsUiTarget(() => raw, [])).toThrow();
  });
  it.each([['--trace', 'on'], ['--trace=retain-on-failure'], ['--trace']])('命令行%s不能开启trace', (...args) => {
    expect(() => bindQueryRowDetailsUiTarget(environment, args)).toThrow('trace');
  });
  it('配置漂移观察后恢复原值也永久拒绝', () => {
    const raw = environment(), binding = bindQueryRowDetailsUiTarget(() => raw, []), original = raw.DBARK_TEST_HOST;
    raw.DBARK_TEST_HOST = 'other'; expect(() => binding.assertCurrent()).toThrow(); raw.DBARK_TEST_HOST = original; expect(() => binding.assertCurrent()).toThrow();
  });
});

describe('可审的真实UI接线与只读SQL预算', () => {
  it('两个完整输入各只有一个只读SELECT，零行subject只被读取，原值不规范化', () => {
    const target = bindQueryRowDetailsUiTarget(environment, []).target, sql = queryRowDetailsUiSql(target);
    for (const value of Object.values(sql)) {
      expect(splitSql(value)).toHaveLength(1); expect(value).toMatch(/^SELECT\b/u);
      expect(value).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|INTO\s+OUTFILE|LOAD_FILE|SLEEP|BENCHMARK)\b/iu);
      expect(value).toContain('SELECT COUNT(*) FROM `' + target.database + '`.`subject`');
    }
    expect(sql.first).toContain('AS `重复`'); expect(sql.first.match(/AS `重复`/gu)).toHaveLength(2);
    expect(sql.first).toContain('_binary X\'00FF\''); expect(sql.first).toContain('_binary X\'\''); expect(sql.first).toContain(queryRowDetailsUiValues.json);
    expect(queryRowDetailsUiValues.long.length).toBeGreaterThan(240); expect(queryRowDetailsUiValues.long).toContain('\r\n');
    // CHAR默认返回binary；显式字符集才能使长文本fixture保持文本，而不是把正确字节返回误判为失败。
    expect(sql.first).toContain('CHAR(13 USING utf8mb4),CHAR(10 USING utf8mb4)');
  });
  it('真实入口不调用模型、store、内部handler、系统剪贴板或实库清理；只保留两个明确执行点', () => {
    const file = ts.createSourceFile('query-row-details-ui.ts', ui, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), executeCalls: string[] = [], invokes: string[] = [], runtimeImports: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) runtimeImports.push((node.moduleSpecifier as ts.StringLiteral).text);
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(file);
        if (name === 'execute') executeCalls.push(node.arguments.map(value => value.getText(file)).join(','));
        if (name === 'window.dbark.invoke') invokes.push((node.arguments[0] as ts.StringLiteral).text);
        expect(name).not.toMatch(/(?:setValue|dispatchEvent|setState|clipboard|isolatedDatabase|\.query|\.execute|\.kill|forceStop|launchDesktop|rm)$/iu);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    expect(executeCalls).toEqual(['sql.first,1', 'sql.second,2']); expect(invokes).toEqual(['settings.get', 'history.list', 'connections.list', 'tasks.list']);
    expect(runtimeImports.some(value => /live-helpers|mysql2|native-clipboard|integrationConfig/u.test(value))).toBe(false);
    expect(ui).toContain('preserveOnUnconfirmedExit: true'); expect(ui).toContain("trace: 'off', screenshot: 'off', video: 'off'");
    expect(ui).toContain('runtime.confirmOwnedDesktopExit(info)'); expect(ui).toContain('current.application !== captured.application'); expect(ui).toContain('runtime.retainOwnedDesktopResources(info)'); expect(ui).toContain('stat(completed.directory)');
    expect(ui).toContain("create.getByRole('combobox', { name: prefix(zh.app.text049) })"); expect(ui).toContain('expect(select).toHaveCount(1)'); expect(ui).toContain('expect(select).toHaveValue(profile.id)');
    expect(ui).toContain("create.getByRole('combobox', { name: prefix(zh.app.text050) })");
    expect(ui).toContain('expect(final).toHaveLength(2)'); expect(ui).toContain('expect(final.map(record => record.sql).sort()).toEqual([first.raw, second.raw].sort())');
    expect(ui).not.toMatch(/\bfinally\s*\{/u); expect(ui).toContain('page.keyboard.insertText(sql)'); expect(ui).toContain('expect(read[8]).toBe(values.html)');
  });
});

describe('真实spec所属门的静态VM回归（纯RAM）', () => {
  /** 提取真实check函数，只把桌面资源观察端口换成RAM，不复制所属判断。 */
  function fixture() {
    const file = ts.createSourceFile('query-row-details-ui.ts', ui, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); let check = '';
    function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'check') check = node.getText(file); ts.forEachChild(node, visit); } visit(file); expect(check).not.toBe('');
    const page = {}, captured = { application: {}, page, closed: false }, info = { status: 'passed', timeout: 120000 }, binding = { assertCurrent: vi.fn() }, retain = vi.fn(); let current = { ...captured };
    const context = createContext({ page, captured, info, binding, runtime: { ownedDesktopResources: () => current, retainOwnedDesktopResources: retain } });
    runInContext(ts.transpileModule('let stopped=false;\n' + check + '\nglobalThis.check=check;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    return { info, binding, retain, captured, check: context.check as (allowClosed?: boolean) => void, replace: (value: typeof current) => { current = value; } };
  }
  it.each(['application', 'page', 'closed', 'configuration', 'status', 'timeout'] as const)('%s变化后即使恢复原值也永久停链保留', change => {
    const f = fixture(); f.check();
    if (change === 'application') f.replace({ ...f.captured, application: {} });
    if (change === 'page') f.replace({ ...f.captured, page: {} });
    if (change === 'closed') f.replace({ ...f.captured, closed: true });
    if (change === 'configuration') f.binding.assertCurrent.mockImplementation(() => { throw Error('配置漂移'); });
    if (change === 'status') f.info.status = 'timedOut'; if (change === 'timeout') f.info.timeout++;
    expect(() => f.check()).toThrow(); expect(f.retain).toHaveBeenCalled();
    f.replace(f.captured); f.binding.assertCurrent.mockReset(); f.info.status = 'passed'; f.info.timeout = 120000;
    expect(() => f.check()).toThrow();
  });
  it('只有正常收尾显式允许准确owner关闭，普通UI动作不能借closed继续', () => {
    const f = fixture(); f.replace({ ...f.captured, closed: true }); expect(() => f.check(true)).not.toThrow(); expect(f.retain).not.toHaveBeenCalled();
    expect(() => f.check()).toThrow(); expect(f.retain).toHaveBeenCalled();
  });
});
