import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { tableGridZh } from '../../src/renderer/locales/tableGrid.zh-CN';

const source = readFileSync(new URL('../../src/renderer/components/TableTab.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('TableTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
/** 提取混合源码的实际方法和JSX属性，运行真实选择令牌检查，避免冲突合并悄悄丢掉既有契约。 */
function selectionFixture() {
  let apply: ts.FunctionDeclaration | undefined, token: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'applyPagePlan') apply = node;
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'PageFindPanel') {
      const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(tree) === 'getSelectionToken');
      if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) token = attribute.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }; visit(tree); if (!apply || !token) throw Error('缺少实际单处替换方法或选择令牌接线');
  const selection = { rowId: 'r', key: 'text' }, rows = [{ id: 'r', data: { text: 'old' } }], next = [{ id: 'r', data: { text: 'new' } }], applyReplacement = vi.fn(() => next), setRows = vi.fn();
  const context = createContext({ tableGridZh, selectionRef: { current: selection }, assertGridWritable: vi.fn(), getRecordContext: () => ({ info: {} }), blockedRef: { current: false }, record: { dirty: false }, rootElement: { current: null }, rowsRef: { current: rows }, visibleKeys: ['text'], recordReadonlyReason: () => undefined, pageFindGeneration: () => 1, applyPageReplacement: applyReplacement, setRows, setError: vi.fn() });
  runInContext(ts.transpileModule(apply.getText(tree) + '\nglobalThis.apply=applyPagePlan;globalThis.token=' + token.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, selection, next, applyReplacement, setRows, plan: { patches: [{ rowId: 'r', key: 'text' }] }, only: { rowId: 'r', key: 'text' } };
}

describe('重命名集成保留TableTab已有工具行为', () => {
  it('当前实际令牌仍可提交一次本地单处替换', () => {
    const f = selectionFixture(); expect(f.context.token()).toBe(f.selection); expect(f.context.apply(f.plan, f.only, f.context.token())).toBe(f.next); expect(f.applyReplacement).toHaveBeenCalledOnce(); expect(f.setRows).toHaveBeenCalledWith(f.next);
  });
  it.each(['same-cell-new-token', 'different-cell'] as const)('Worker返回前选择改变：%s不能沿用旧令牌写草稿', change => {
    const f = selectionFixture(), token = f.context.token(); f.context.selectionRef.current = change === 'same-cell-new-token' ? { ...f.selection } : { rowId: 'other', key: 'text' };
    expect(() => f.context.apply(f.plan, f.only, token)).toThrow(tableGridZh.changed); expect(f.applyReplacement).not.toHaveBeenCalled(); expect(f.setRows).not.toHaveBeenCalled();
  });
  it('新重命名按钮与备注、默认编码均保留实际表类型和busy保护及独立回调', () => {
    const buttons: ts.JsxOpeningElement[] = []; const visit = (node: ts.Node) => { if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'button') buttons.push(node); ts.forEachChild(node, visit); }; visit(tree);
    for (const name of ['TableRename', 'TableComment', 'TableDefaultEncoding']) {
      const callback = 'on' + name, button = buttons.find(node => node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'onClick' && attribute.initializer?.getText(tree) === '{' + callback + '}'));
      if (!button) throw Error('缺少实际表属性按钮：' + name);
      const disabled = button.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'disabled') as ts.JsxAttribute;
      const expression = (disabled.initializer as ts.JsxExpression).expression!;
      for (const [objectKind, blocked, expected] of [['table', false, false], ['table', true, true], ['view', false, true], [undefined, false, true]] as const) {
        const context = createContext({ info: { objectKind }, blocked }); expect(runInContext(expression.getText(tree), context)).toBe(expected);
      }
    }
  });
});
