import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../integration/incoming-references.test.ts', import.meta.url), 'utf8');
/** 只执行正式实库定义的独立纯门，不导入驱动、认证或Engine模块。 */
function enabled(env: Record<string, string | undefined>, args: readonly string[]): boolean {
  const tree = ts.createSourceFile('integration.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'incomingReferencesEnabled');
  if (!declaration) throw Error('入向关联实库定义缺少独立纯门');
  const javascript = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return runInNewContext(javascript + '\nincomingReferencesEnabled(env, args);', { exports: {}, env, args });
}

describe('入向关联默认/list独立前置门（仅RAM，不加载实库）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_INCOMING_REFERENCE_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '0', DBARK_INCOMING_REFERENCE_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_INCOMING_REFERENCE_TEST: 'true' }, { DBARK_INTEGRATION_ENABLED: 'true', DBARK_INCOMING_REFERENCE_TEST: '1' }])('双门缺失或不准确%j不进入实库主体', env => {
    expect(enabled(env, [])).toBe(false);
  });
  it.each(['--list', '--list=true', '--list=json', 'list'])('列表%s优先拒绝，不读取任何环境属性', flag => {
    const env = new Proxy({}, { get() { throw Error('列表不可读取环境或认证'); } });
    expect(enabled(env, [flag])).toBe(false);
  });
  it('只有两个准确独立用途门才进入，认证getter仍不可读取', () => {
    const env = { DBARK_INTEGRATION_ENABLED: '1', DBARK_INCOMING_REFERENCE_TEST: '1' };
    Object.defineProperty(env, 'DBARK_TEST_PASSWORD', { get() { throw Error('纯门不可读取密码'); } });
    expect(enabled(env, [])).toBe(true);
  });
  it('实际runtime导入在门之后，固定120秒零重试与原资源释放审计保留', () => {
    const gate = source.indexOf('if (!incomingReferencesEnabled(process.env, process.argv))');
    for (const entry of ["await import('../helpers/databaseDefaultEncodingIntegration')", "import('../helpers/incomingReferencesIntegration')", 'helpers.loadDatabaseEncodingModules']) expect(source.indexOf(entry)).toBeGreaterThan(gate);
    expect(source).toContain('timeout: 120000, retry: 0, repeats: 0');
    expect(source).toContain('assertDatabaseEncodingIdentity');
    expect(source).toContain('fact.closed');
    expect(source).toContain('watch.assertIncomingReferenceReleased');
    expect(source).toContain("databaseState !== 'confirmed'");
    expect(source).not.toMatch(/CREATE USER|GRANT |Docker|forceStop|process\.kill|setTimeout\(/);
  });
  it('一库三表与13384真实51关系计划独立，DROP前核完整对象归属及父原值', () => {
    expect(source).toContain("'dbark_childref_' + crypto.randomUUID()");
    expect(source).toContain("表: ['parent', 'child', 'child_no_pk']");
    expect(source).toContain('binding.profile.port === 13384 ? Array.from({ length: 49 }');
    expect(source).toContain('expectedCount === 51 ? [50, 1] : [2]');
    const drop = source.indexOf("const drop = 'DROP DATABASE '");
    for (const entry of ['expect(await sql(parentRead)).toEqual(expectedParents)', 'information_schema.TRIGGERS', 'information_schema.ROUTINES', 'information_schema.EVENTS']) { expect(source.indexOf(entry)).toBeGreaterThan(0); expect(source.indexOf(entry)).toBeLessThan(drop); }
    expect(source).toContain('原任务线程: threadIds');
    expect(source).toContain('原任务线程数量: threadIds.length');
  });
});
