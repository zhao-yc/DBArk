import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = ts.createSourceFile('join-order-native.ts', readFileSync(new URL('../e2e/table-foreign-key-join-order-native.spec.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
/** 提取实际原生专项的环境守卫，不加载Playwright、Electron或数据库，防止前后缀误判。 */
function denied(env: Record<string, string>): string[] {
  const declarations: ts.VariableDeclaration[] = [];
  function visit(node: ts.Node): void { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'forbidden') declarations.push(node); ts.forEachChild(node, visit); }
  visit(source); expect(declarations).toHaveLength(1);
  const code = ts.transpileModule('exports.value = ' + declarations[0].initializer!.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { process: { env }, exports: {} as { value?: string[] } }; runInNewContext(code, context); return Array.from(context.exports.value!);
}
describe('JOIN原生专项实际环境守卫', () => {
  it.each(['NODE_PATH','NODE_OPTIONS','ELECTRON_RUN_AS_NODE','DBARK_TEST_PASSWORD','MYSQL_PASSWORD','MARIADB_USER','node_path','dbark_test_host'])('准确认证或注入字段%s必须拒绝，值不输出', key => expect(denied({ [key]: '合成值' })).toEqual([key]));
  it.each(['CODEX_MCP_NODE_PATH','CODEX_NODE_OPTIONS','SOME_MYSQL_FIELD','PATH','DBARK_JOIN_ORDER_NATIVE','DBARK_INTEGRATION_ENABLED'])('工具字段及本例开关%s不能被后缀误判', key => expect(denied({ [key]: '合成值' })).toEqual([]));
});
