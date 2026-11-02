import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { monacoWordHighlighterCore } from '../fixtures/monaco-word-highlighter';

let core: Awaited<ReturnType<typeof monacoWordHighlighterCore>>, setup: string;
beforeAll(async () => {
  core = await monacoWordHighlighterCore();
  const root = dirname(createRequire(import.meta.url).resolve('monaco-editor/package.json'));
  const source = readFileSync(join(root, 'esm/vs/base/browser/ui/tree/abstractTree.js'), 'utf8');
  const tree = ts.createSourceFile('abstractTree.js', source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AbstractTree') as ts.ClassDeclaration;
  const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === 'setupModel') as ts.MethodDeclaration;
  const statements = method.body!.statements;
  const start = statements.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(tree) === 'activeNodesEmitter'));
  if (start < 0) throw Error('缺少实际树活动节点事件实现');
  setup = statements.slice(start, start + 3).map(node => node.getText(tree)).join('\n');
});

/** 真实AST提取完整事件和Promise链；只用RAM节点替代DOM树，Delayer及取消类型保持上游实现。 */
function fixture() {
  const { common } = core, focus = new common.Emitter(), selection = new common.Emitter(), model = new common.Emitter(), store = new common.DisposableStore();
  const a = { id: 'a' }, b = { id: 'b' }, reported: unknown[] = [], notifications: unknown[] = [];
  common.errorHandler.unexpectedErrorHandler = (error: unknown) => reported.push(error);
  const listener = (error: unknown) => notifications.push(error); common.errorHandler.listeners.push(listener);
  const owner = { modelDisposables: store, focus: { onDidChange: focus.event, getNodes: () => [a] }, selection: { onDidChange: selection.event, getNodes: () => [a, b] } };
  const scope = { ...common, owner, onDidModelSplice: model.event };
  const actual = vm.runInNewContext(`(function(){${setup}\nreturn {delayer: activeNodesDebounce, event: activeNodesEmitter.event};}).call(owner)`, scope);
  return { actual, reported, notifications, common, fire: () => { focus.fire(); selection.fire(); }, fireOnce: () => focus.fire(), nodes: [a, b], dispose() { store.dispose(); focus.dispose(); selection.dispose(); model.dispose(); common.errorHandler.listeners.splice(common.errorHandler.listeners.indexOf(listener), 1); } };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
it('关闭树取消待执行活动事件，不产生未处理拒绝', async () => {
  const f = fixture(), unhandled: unknown[] = [], capture = (error: unknown) => unhandled.push(error); process.on('unhandledRejection', capture);
  try { f.fire(); expect(f.actual.delayer.isTriggered()).toBe(true); f.dispose(); await tick(); expect(unhandled).toEqual([]); expect(f.reported).toEqual([]); }
  finally { process.removeListener('unhandledRejection', capture); }
});
it('正常活动节点仍合并、去重并发出一次，不关闭树事件', async () => {
  const f = fixture(), events: unknown[] = []; f.actual.event((event: unknown) => events.push(event));
  try { f.fire(); await new Promise(resolve => setTimeout(resolve, 15)); expect(events).toEqual([f.nodes]); expect(f.reported).toEqual([]); }
  finally { f.dispose(); }
});
it.each(['ordinary', 'same-name', 'string', 'real-cancellation'] as const)('%s只有真实取消可被消费，其余仍进入正式报告及监听器', async kind => {
  const f = fixture();
  try {
    f.fireOnce(); const error = kind === 'real-cancellation' ? new f.common.CancellationError() : kind === 'same-name' ? Object.assign(Error('Canceled'), { name: 'Canceled' }) : kind === 'string' ? 'Canceled' : new TypeError('树组件故障');
    f.actual.delayer.doReject(error); await tick(); expect(f.reported).toEqual(kind === 'real-cancellation' ? [] : [error]); expect(f.notifications).toEqual(kind === 'real-cancellation' ? [] : [error]);
  } finally { f.dispose(); await tick(); }
});
