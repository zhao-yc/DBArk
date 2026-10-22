import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../integration/table-statistics.test.ts', import.meta.url), 'utf8');
/** 只提取正式定义的纯门/独立数学界，不加载认证、网络、Engine或产品统计器。 */
function invoke(name: 'tableStatisticsEnabled' | 'tableStatisticsMeanWithinNativeScale', args: unknown[]): boolean {
  const tree = ts.createSourceFile('integration.ts', source, ts.ScriptTarget.Latest, true), declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw Error('表统计定义缺少独立纯函数');
  const javascript = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return runInNewContext(javascript + '\n' + name + '(...args);', { exports: {}, args });
}
describe('表统计实库独立双门/default/list（仅RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_TABLE_STATISTICS_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_STATISTICS_TEST: 'true' }, { DBARK_INTEGRATION_ENABLED: '0', DBARK_TABLE_STATISTICS_TEST: '1' }])('双门未准确齐全%j不载入实库', env => { expect(invoke('tableStatisticsEnabled', [env, []])).toBe(false); });
  it.each(['--list', '--list=true', 'list'])('列表%s优先拒绝且不读取环境getter', flag => { expect(invoke('tableStatisticsEnabled', [new Proxy({}, { get() { throw Error('列表不可读取认证'); } }), [flag]])).toBe(false); });
  it('只有准确独立双门才进入，密码getter始终不可读取', () => { const env = { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_STATISTICS_TEST: '1' }; Object.defineProperty(env, 'DBARK_TEST_PASSWORD', { get() { throw Error('纯门不可读取密码'); } }); expect(invoke('tableStatisticsEnabled', [env, []])).toBe(true); });
  it('正式导入/身份/原流/120秒零重试均在显式门内，不新用户或控制进程', () => {
    const gate = source.indexOf('if (!tableStatisticsEnabled(process.env, process.argv))'); expect(gate).toBeGreaterThan(0);
    for (const entry of ["await import('../helpers/databaseDefaultEncodingIntegration')", "import('../helpers/tableStatisticsIntegration')", 'helpers.loadDatabaseEncodingModules']) expect(source.indexOf(entry)).toBeGreaterThan(gate);
    expect(source).toContain('timeout: 120000, retry: 0, repeats: 0'); expect(source).toContain('assertDatabaseEncodingIdentity'); expect(source).toContain('fact.closed'); expect(source).toContain('watch.assertTableStatisticsReleased');
    expect(source).not.toMatch(/CREATE USER|GRANT |Docker|forceStop|process\.kill|setTimeout\(/);
    expect(source).not.toContain("invoke('table.page'");
  });
  it('123行/一表一视图与独立手算SUM固定，DROP之前完整归属及只读原件复核', () => {
    expect(source).toContain("'dbark_tabstats_' + crypto.randomUUID()"); expect(source).toContain('Array.from({ length: 120 }'); expect(source).toContain("expect(native.row_count).toBe('123')"); expect(source).toContain("expect(native.big_sum).toBe('36893488147419103229')"); expect(source).toContain("expect(native.amount_sum).toBe('0.000000000001')");
    const drop = source.indexOf("const drop = 'DROP DATABASE '");
    for (const entry of ['expect(await sql(exactRead)).toEqual([native])', 'expect(await sql(viewRead', 'information_schema.TRIGGERS', 'information_schema.ROUTINES', 'information_schema.EVENTS']) { expect(source.indexOf(entry)).toBeGreaterThan(0); expect(source.indexOf(entry)).toBeLessThan(drop); }
    expect(source).toContain("databaseState !== 'confirmed'"); expect(source).toContain('原任务线程: threadIds');
  });
});
describe('原生AVG尺度独立整数有理数边界（仅RAM）', () => {
  it('不同native小数尺度都可验证，UINT64以上总和绝不经Number', () => {
    expect(invoke('tableStatisticsMeanWithinNativeScale', ['18446744073709551614.5', '36893488147419103229', 2])).toBe(true);
    expect(invoke('tableStatisticsMeanWithinNativeScale', ['18446744073709551614.5000', '36893488147419103229', 2])).toBe(true);
    expect(invoke('tableStatisticsMeanWithinNativeScale', ['18446744073709551616.5', '36893488147419103229', 2])).toBe(false);
  });
  it('原样本末位DECIMAL商不丢失，反例不因截断或浮点转换伪通过', () => {
    expect(invoke('tableStatisticsMeanWithinNativeScale', ['0.0000000000000082', '0.000000000001', 122])).toBe(true);
    expect(invoke('tableStatisticsMeanWithinNativeScale', ['0.0000000000010000', '0.000000000001', 122])).toBe(false);
    expect(invoke('tableStatisticsMeanWithinNativeScale', ['-0.0000000000000082', '-0.000000000001', 122])).toBe(true);
  });
  it.each([undefined, null, 1, NaN, Infinity, '1e4', ' 1', '1 ', '', '1'.repeat(101)])('异形native值%j拒绝', value => { expect(invoke('tableStatisticsMeanWithinNativeScale', [value, '1', 1])).toBe(false); });
  it.each([0, -1, 1.5, NaN, Infinity])('原分母%j无效不可转换', count => { expect(invoke('tableStatisticsMeanWithinNativeScale', ['1', '1', count])).toBe(false); });
});
