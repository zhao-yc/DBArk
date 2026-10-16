import { readFileSync } from 'node:fs';
import { createContext, runInContext, type Context } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const namedSource = readFileSync(new URL('../e2e/sql-completion-named-window.spec.ts', import.meta.url), 'utf8');
const caretSource = readFileSync(new URL('../e2e/monaco-caret.ts', import.meta.url), 'utf8');
/** 提取实际准备函数与触发入口的第一个page.evaluate，不复制理想化观察器安装逻辑。 */
function declaration(source: string, name: string) {
  const tree = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true); let found: ts.FunctionDeclaration | undefined;
  tree.forEachChild(node => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; });
  if (!found) throw Error('未找到实际测试函数'); return { tree, node: found, text: found.getText(tree) };
}
const observed = declaration(namedSource, 'observe'), caretObserved = declaration(caretSource, 'observeMonacoCaret'), trigger = declaration(caretSource, 'triggerMonacoCompletion');
let armText = '';
function findArm(node: ts.Node) { if (!armText && ts.isCallExpression(node) && node.expression.getText(trigger.tree) === 'page.evaluate') armText = node.arguments[0].getText(trigger.tree); ts.forEachChild(node, findArm); }
findArm(trigger.node); if (!armText) throw Error('未找到正式触发入口的文档观察器守卫');
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

/** reload使用全新VM文档，只重放addInitScript；page.evaluate安装的监听器不会跨文档存活。 */
function documentReplay() {
  let epoch = 0, realm: Context, listeners = 0;
  const initializers: string[] = [], installations: number[] = [], statuses: number[] = [];
  function fresh() {
    listeners = 0; realm = createContext({}); realm.window = realm; realm.self = realm;
    realm.document = { addEventListener: (name: string) => { expect(name).toBe('keydown'); listeners++; } };
    realm.Worker = runInContext('(class Worker { postMessage() {} addEventListener() {} })', realm);
    realm.monaco = { editor: { getEditors: () => [] } };
    realm.dbark = { invoke: async (command: string) => { if (command === 'settings.get') return { tabs: [] }; if (['connections.list', 'tasks.list', 'history.list'].includes(command)) return []; throw Error('禁止RAM反例执行其它IPC'); } };
  }
  fresh();
  const page = {
    addInitScript: async (callback: Function) => { initializers.push(callback.toString()); },
    reload: async () => { epoch++; fresh(); for (const code of initializers) runInContext('(' + code + ')()', realm); },
    locator: (selector: string) => { expect(selector).toBe('.app-statusbar'); return statusPort; },
    evaluate: async (callback: Function, argument?: unknown) => {
      const before = !!realm.__dbarkMonacoCaretObservation; realm.__input = argument;
      try { const result = await runInContext('(' + callback.toString() + ')(__input)', realm); if (!before && realm.__dbarkMonacoCaretObservation) installations.push(epoch); return result; }
      finally { delete realm.__input; }
    },
  };
  const statusPort = {}, scope = createContext({ page, expect: (value: unknown, message?: string) => value === statusPort ? { toBeVisible: async () => { statuses.push(epoch); } } : expect(value, message) });
  // export只属于模块包装；函数体原样执行，所有浏览器/IPC边界均为RAM端口。
  const caret = { observeMonacoCaret: runInContext(compile('(' + caretObserved.text.replace(/^export\s+/, '') + ')'), scope) };
  async function setup(legacy: boolean) {
    const line = 'await caret.observeMonacoCaret();'; expect(observed.text.split(line)).toHaveLength(2);
    const body = legacy ? observed.text.replace(line, '').replace('{', '{\n' + line) : observed.text;
    await runInContext(compile('(' + body + ')'), scope)(caret);
  }
  const arm = () => page.evaluate(runInContext(compile('(' + armText + ')'), scope), { source: 'SELECT 1', prefix: '', lineNumber: 1, column: 1 });
  return { setup, arm, state: () => ({ epoch, listeners, installations: [...installations], statuses: [...statuses], probe: !!realm.__q01NamedWindow, observer: !!realm.__dbarkMonacoCaretObservation, generation: realm.__dbarkMonacoCaretObservation?.generation }) };
}

describe('named-window准备的文档世代RAM反例（不是GUI验收）', () => {
  it('旧序先安装光标再reload：原两次reload后probe存在，但正式触发守卫仍报未安装', async () => {
    const fixture = documentReplay(); await fixture.setup(true);
    expect(fixture.state()).toMatchObject({ epoch: 2, probe: true, observer: false, installations: [1], statuses: [1, 2] });
    await expect(fixture.arm()).rejects.toThrow('未安装真实光标观察器');
  });
  it('新序先probe再共享helper：两次原reload后两个观察器在当前文档，原守卫可布防', async () => {
    const fixture = documentReplay(); await fixture.setup(false);
    expect(fixture.state()).toMatchObject({ epoch: 2, probe: true, observer: true, listeners: 2, installations: [2], statuses: [1, 2] });
    await fixture.arm(); expect(fixture.state().generation).toBe(1);
  });
});
