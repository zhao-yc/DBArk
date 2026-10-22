import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../integration/table-create-generated.test.ts', import.meta.url), 'utf8');
/** 只运行真实定义中的纯门；不加载实库辅助模块、凭据、Engine或驱动。 */
function enabled(env: Record<string, string | undefined>, args: string[] = []) {
  const tree = ts.createSourceFile('integration.ts', source, ts.ScriptTarget.Latest, true), declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'tableCreateGeneratedEnabled');
  if (!declaration) throw Error('缺少新表生成列原双门');
  const javascript = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return runInNewContext(javascript + '\ntableCreateGeneratedEnabled(env,args);', { exports: {}, env, args });
}
describe('新表生成列实库定义的默认关闭与列表门（纯RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_TABLE_CREATE_GENERATED_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '0', DBARK_TABLE_CREATE_GENERATED_TEST: '1' }])('缺少准确双门不进入真实主体%j', env => { expect(enabled(env)).toBe(false); });
  it.each([['--list'], ['--list=true'], ['list']])('列表%j即使双门存在仍不进入目标绑定', (...args) => { expect(enabled({ DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_CREATE_GENERATED_TEST: '1' }, args)).toBe(false); });
  it('只有准确独立双门进入主体；不读取认证哨兵getter', () => { const env = { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_CREATE_GENERATED_TEST: '1' }; Object.defineProperty(env, 'DBARK_TEST_PASSWORD', { get: () => { throw Error('纯门不得读取认证'); } }); expect(enabled(env)).toBe(true); });
  it('实际主体在门后才加载既有身份/原流辅助与显式Engine，写入没有DROP失败补救或新用户', () => { expect(source.indexOf("await import('../helpers/databaseDefaultEncodingIntegration')")).toBeGreaterThan(source.indexOf('if (!tableCreateGeneratedEnabled(process.env, process.argv))')); expect(source).not.toMatch(/CREATE USER|GRANT |Docker|forceStop|process\.kill|setTimeout\(/); expect(source).toContain('loadDatabaseEncodingModules'); expect(source).toContain('fact.closed'); expect(source).toContain("databaseState !== 'confirmed'"); });
});
