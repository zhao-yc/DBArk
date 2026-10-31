import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { UiCommandRegistry } from '../../src/renderer/uiCommandRegistry';

/** 执行App实际快捷键监听；不加载App或构造GUI，确保格式化没有抢占结构搜索。 */
it.each(['Control', 'Meta', 'Alt'])('%s+Shift+F仍分别归结构搜索和编辑器动作', modifier => {
  const text = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let listener = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'listener' && node.initializer && /uiCommands\.execute\(\{\s*id:\s*['"]structure-search/.test(node.initializer.getText(tree))) listener = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); expect(listener).not.toBe('');
  const search = vi.fn(), prevent = vi.fn(), registry = new UiCommandRegistry();
  registry.update('app', {}, { active: true, contextKey: '正式结构及离线保存查询入口', handlers: { 'structure-search': { enabled: true, run: search } } }); registry.setBlocked(false);
  const port = createContext({ document: { querySelector: () => null }, uiCommands: registry });
  runInContext(ts.transpileModule('globalThis.listener=' + listener, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, port);
  port.listener({ key: 'F', ctrlKey: modifier === 'Control', metaKey: modifier === 'Meta', altKey: modifier === 'Alt', shiftKey: true, isComposing: false, keyCode: 70, preventDefault: prevent });
  expect(search).toHaveBeenCalledTimes(modifier === 'Alt' ? 0 : 1); expect(prevent).toHaveBeenCalledTimes(modifier === 'Alt' ? 0 : 1);
});
