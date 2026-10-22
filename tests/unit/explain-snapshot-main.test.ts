import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { explainSnapshotZh } from '../../src/shared/explainSnapshot.zh-CN';

const tree = ts.createSourceFile('index.ts', readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
/** 执行正式Main分支、文件退出等待函数和真实IPC回包门；只替换物理文件端口。 */
function harness() {
  const dispatch = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'dispatch')!;
  const fileOperation = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'queryFileOperation')!;
  const branch = dispatch.body!.statements.find(node => ts.isIfStatement(node) && node.expression.getText(tree).includes("command === 'explainFiles.open'"))!;
  let wrapper: ts.Expression | undefined;
  function visit(node: ts.Node): void { if (ts.isCallExpression(node) && node.expression.getText(tree) === 'ipcMain.handle' && node.arguments[0]?.getText(tree) === "'dbark:request'") wrapper = node.arguments[1]; ts.forEachChild(node, visit); } visit(tree);
  expect(wrapper).toBeDefined(); expect(branch).toBeDefined();
  let current = true;
  const columns: { snapshotSaved?: true } = {}, webContents = { mainFrame: { url: 'RAM:plan' } };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  const columnsMain = { capture: vi.fn(() => columns), assertCapturedOwner(value: unknown) { if (value !== columns || !current) throw Error(explainSnapshotZh.stale); }, hasUnpublished: () => false };
  const explainSnapshotFiles = { open: vi.fn(async (_owner: unknown): Promise<unknown> => null), save: vi.fn(async (_snapshot: unknown, _owner: unknown): Promise<unknown> => null) };
  const context = createContext({ Error, columnsMain, explainSnapshotFiles, explainSnapshotZh, shuttingDown: false, window: { webContents }, rendererURL: 'RAM:plan', tasks: new Map(), queryInsertExports: { has: () => false }, validateMainCommand: validateCommand, localSearchOperations: new Set(), queryFileOperations: new Set() });
  const source = `${fileOperation.getText(tree)}\nasync function dispatch(command:any,input:any,columns?:any){${branch.getText(tree)}throw Error('越界分派');}\nvar request=${wrapper!.getText(tree)};`;
  runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  return { context, columns, event, files: explainSnapshotFiles, capture: columnsMain.capture, invalidate() { current = false; }, request: context.request as (event: unknown, payload: unknown) => Promise<any> };
}
const snapshot = { kind: 'dbark.explain-snapshot', version: 1, dialect: 'mysql', serverVersion: '8.4', format: 'text', raw: '', rawTruncated: false, warnings: [], result: { columns: [], rows: [], truncated: false } };

it('两个命令在正式白名单和严格校验中拒绝任意路径、额外字段及未知版本', () => {
  expect(publicCommands['explainFiles.open']).toBe(true); expect(publicCommands['explainFiles.save']).toBe(true);
  expect(validateCommand('explainFiles.save', { snapshot })).toEqual({ snapshot });
  for (const [command, input] of [['explainFiles.open', { path: 'C:/arbitrary' }], ['explainFiles.save', { snapshot, path: 'C:/arbitrary' }], ['explainFiles.save', { snapshot: { ...snapshot, version: 2 } }]]) expect(() => validateCommand(command as string, input)).toThrow();
});
it('正式来源捕获文档，open不转发数据库；另一个sender/frame均被拒绝', async () => {
  const h = harness(); expect(await h.request(h.event, { command: 'explainFiles.open', input: {} })).toEqual({ ok: true, result: null });
  const owner = h.files.open.mock.calls[0][0] as { assertCurrent(): void }; owner.assertCurrent(); expect(h.capture).toHaveBeenCalledTimes(1);
  for (const event of [{ ...h.event, sender: {} }, { ...h.event, senderFrame: { url: 'RAM:plan' } }]) expect(await h.request(event, { command: 'explainFiles.open', input: {} })).toMatchObject({ ok: false });
  expect(h.files.open).toHaveBeenCalledTimes(1); h.invalidate(); expect(() => owner.assertCurrent()).toThrow(explainSnapshotZh.stale);
});
it.each(['open', 'save'] as const)('原%s未结算时保留退出等待集合，迟到旧文档不能发布', async method => {
  const h = harness(); let finish!: (value: any) => void;
  h.files[method].mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.request(h.event, { command: `explainFiles.${method}`, input: method === 'save' ? { snapshot } : {} });
  expect(h.context.queryFileOperations.size).toBe(1); h.invalidate(); expect(h.context.queryFileOperations.size).toBe(1);
  finish(method === 'save' ? { name: 'plan.json' } : { name: 'plan.json', snapshot });
  expect(await pending).toEqual({ ok: false, error: method === 'save' ? explainSnapshotZh.unknownWrite : explainSnapshotZh.stale });
  expect(h.context.queryFileOperations.size).toBe(0);
});
it('退出开始后拒绝新文件操作，原文件失败原样保留且解除等待', async () => {
  const h = harness(); h.context.shuttingDown = true;
  expect(await h.request(h.event, { command: 'explainFiles.open', input: {} })).toMatchObject({ ok: false }); expect(h.files.open).not.toHaveBeenCalled();
  h.context.shuttingDown = false; h.files.open.mockRejectedValue(Error('文件读取失败'));
  expect(await h.request(h.event, { command: 'explainFiles.open', input: {} })).toEqual({ ok: false, error: '文件读取失败' }); expect(h.context.queryFileOperations.size).toBe(0);
});
