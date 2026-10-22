import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../integration/table-create-column-encoding.test.ts', import.meta.url), 'utf8');
/** 提取实际实库定义中的纯函数；不导入目标绑定/驱动/Engine，不触及认证。 */
function invoke(name: 'tableCreateColumnEncodingEnabled' | 'tableCreateColumnEncodingInteger', args: unknown[]): boolean {
  const tree = ts.createSourceFile('integration.ts', source, ts.ScriptTarget.Latest, true), declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw Error('列级编码实际定义缺少独立纯门');
  const javascript = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return runInNewContext(javascript + '\n' + name + '(...args);', { exports: {}, args });
}
describe('列级编码六实例定义前置门（仅RAM，不加载实库）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_TABLE_CREATE_COLUMN_ENCODING_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '0', DBARK_TABLE_CREATE_COLUMN_ENCODING_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_CREATE_COLUMN_ENCODING_TEST: 'true' }])('双门不完整或不精确%j不进入实库主体', env => { expect(invoke('tableCreateColumnEncodingEnabled', [env, []])).toBe(false); });
  it.each(['--list', '--list=true', 'list'])('列表%s优先拒绝，即使双门齐全也不读取认证', flag => { expect(invoke('tableCreateColumnEncodingEnabled', [{ DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_CREATE_COLUMN_ENCODING_TEST: '1' }, [flag]])).toBe(false); });
  it('只有独立准确用途双门才进入，认证getter始终不读取', () => { const env = { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_CREATE_COLUMN_ENCODING_TEST: '1' }; Object.defineProperty(env, 'DBARK_TEST_PASSWORD', { get: () => { throw Error('纯前置门不可读取密码'); } }); expect(invoke('tableCreateColumnEncodingEnabled', [env, []])).toBe(true); });
  it('实际辅助模块导入在门后，原120秒零重试/六端口身份/原流审计仍存在', () => { expect(source.indexOf("await import('../helpers/databaseDefaultEncodingIntegration')")).toBeGreaterThan(source.indexOf('if (!tableCreateColumnEncodingEnabled(process.env, process.argv))')); expect(source).toContain('timeout: 120000, retry: 0, repeats: 0'); expect(source).toContain('assertDatabaseEncodingIdentity'); expect(source).toContain('loadDatabaseEncodingModules'); expect(source).toContain('fact.closed'); expect(source).toContain("databaseState !== 'confirmed'"); expect(source).toContain('DBARK_TABLE_CREATE_GENERATED_TEST'); expect(source).not.toMatch(/CREATE USER|GRANT |Docker|forceStop|process\.kill|setTimeout\(/); });
  it('前缀边界由独立3072/3073请求定义，实际索引按BINARY排序，非前缀保持NULL', () => { expect(source).toContain('prefixLength: 3072'); expect(source).toContain('prefixLength: 3073'); expect(source).toContain('ORDER BY BINARY INDEX_NAME,SEQ_IN_INDEX'); expect(source).toContain('else expect(row.SUB_PART).toBeNull()'); expect(source).toContain("u8bytes: '10', latinbytes: '5', memobytes: '12'"); expect(source).toContain("latinhex: '436166E9FF'"); });
});
describe('列级编码实际目录原协议小整数门（仅RAM）', () => {
  it.each([1, 2, 3, 4, 5, 6, 3072])('小整数%d只接受准确数或规范原串', expected => { for (const actual of [expected, String(expected)]) expect(invoke('tableCreateColumnEncodingInteger', [actual, expected])).toBe(true); for (const actual of ['0' + expected, expected + '.0', expected + ' ', ' ' + expected, String(expected + 1), expected + 1]) expect(invoke('tableCreateColumnEncodingInteger', [actual, expected])).toBe(false); });
  it.each([null, undefined, true, false, [], {}, NaN, Infinity, '', '+1', '1e0', '１'].map(actual => ({ actual })))('异形%j不可隐式转换', ({ actual }) => { expect(invoke('tableCreateColumnEncodingInteger', [actual, 1])).toBe(false); });
  it('不调用原观测对象的转换钩子', () => { const actual = { valueOf() { throw Error('不可调用valueOf'); }, toString() { throw Error('不可调用toString'); } }; expect(invoke('tableCreateColumnEncodingInteger', [actual, 1])).toBe(false); });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('期望值%j本身不合法也拒绝', expected => { expect(invoke('tableCreateColumnEncodingInteger', [String(expected), expected])).toBe(false); });
});
