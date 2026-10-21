import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
/** 取正式JSX与入口函数，验证App只更新连接概要而不是重置工作区。 */
function nodes() {
  let entry: ts.FunctionDeclaration | undefined, applied: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'openConnectionOrganization') entry = node;
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'ConnectionOrganizationDialog') {
      const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === 'onApplied') as ts.JsxAttribute | undefined;
      if (attribute?.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression && ts.isArrowFunction(attribute.initializer.expression)) applied = attribute.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(file); if (!entry || !applied) throw Error('缺少正式连接整理入口'); return { entry, applied };
}
it.each([false, true])('已有模态=%s时入口只在无模态下撤销旧导航并打开', modal => {
  const value = nodes(), invalidate = vi.fn(), show = vi.fn();
  runInNewContext(ts.transpileModule(value.entry.getText(file) + '\nopenConnectionOrganization();', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { document: { querySelector: () => modal ? {} : null }, workbenchNavigation: { invalidate }, setConnectionOrganization: show });
  expect(show.mock.calls).toEqual(modal ? [] : [[true]]); expect(invalidate).toHaveBeenCalledTimes(modal ? 0 : 1);
});
it('整理成功回调只发布准确连接数组，不触碰版本、标签、任务或会话', () => {
  const value = nodes(), connections = [{ id: 'a', group: '新组' }], setConnections = vi.fn();
  const execute = runInNewContext(ts.transpileModule('const callback=' + value.applied.getText(file) + ';callback;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { state: new Proxy({ setConnections }, { get(target, key) { if (key !== 'setConnections') throw Error('不允许修改其它工作区状态'); return target.setConnections; } }) });
  execute({ revision: 1, connections }); expect(setConnections).toHaveBeenCalledExactlyOnceWith(connections);
});
