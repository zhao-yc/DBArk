import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { createQueryResultSnapshot } from '../../src/shared/queryResultSnapshot';
import { queryResultSnapshotFileMessages as text } from '../../src/main/queryResultSnapshotFiles';

const tree = ts.createSourceFile('index.ts', readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);

/** 执行正式Main分支及原IPC发布门；仅以端口替换物理文件，未提供数据库broker。 */
function harness() {
  const dispatch = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'dispatch')!;
  const operation = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'queryFileOperation')!;
  const branch = dispatch.body!.statements.find(node => ts.isIfStatement(node) && node.expression.getText(tree).includes("command === 'resultSnapshotFiles.open'"))!;
  let wrapper: ts.Expression | undefined;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'ipcMain.handle' && node.arguments[0]?.getText(tree) === "'dbark:request'") wrapper = node.arguments[1];
    ts.forEachChild(node, visit);
  }
  visit(tree); expect(branch).toBeDefined(); expect(wrapper).toBeDefined();
  let current = true;
  const columns: { snapshotSaved?: true } = {}, webContents = { mainFrame: { url: 'RAM:result-snapshot' } };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  const columnsMain = {
    capture: vi.fn(() => columns), hasUnpublished: () => false,
    assertCapturedOwner(value: unknown) { if (value !== columns || !current) throw Error(text.stale); },
  };
  const queryResultSnapshotFiles = {
    open: vi.fn(async (_owner: unknown): Promise<unknown> => null),
    save: vi.fn(async (_snapshot: unknown, _owner: unknown): Promise<unknown> => null),
  };
  const context = createContext({ Error, columnsMain, queryResultSnapshotFiles, queryResultSnapshotFileMessages: text,
    shuttingDown: false, window: { webContents }, rendererURL: 'RAM:result-snapshot', tasks: new Map(),
    queryInsertExports: { has: () => false }, validateMainCommand: validateCommand,
    localSearchOperations: new Set(), queryFileOperations: new Set(),
  });
  const source = `${operation.getText(tree)}\nasync function dispatch(command:any,input:any,columns?:any){${branch.getText(tree)}throw Error('越界分派');}\nvar request=${wrapper!.getText(tree)};`;
  runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  return { context, event, files: queryResultSnapshotFiles, capture: columnsMain.capture,
    invalidate() { current = false; }, request: context.request as (event: unknown, payload: unknown) => Promise<any> };
}

/** 合成数据只验证本地文件契约，不能作为数据库执行或精度读取的验收。 */
function snapshot() {
  return createQueryResultSnapshot({ columns: [{ key: '__proto__', name: '重复名', type: 'BIGINT' }, { key: 'c1', name: '重复名', type: 'DOUBLE' }],
    rows: [Object.fromEntries([['__proto__', '9007199254740993'], ['c1', -0]])],
    truncated: true, elapsedMs: 1.25, statement: 'SELECT source_statement',
  }, '本地快照');
}

it('公共入口保留精确字段和源SQL，仅由原生选择器选文件路径', () => {
  const source = snapshot();
  expect(publicCommands['resultSnapshotFiles.open']).toBe(true); expect(publicCommands['resultSnapshotFiles.save']).toBe(true);
  const input = validateCommand('resultSnapshotFiles.save', { snapshot: source });
  expect(input).toEqual({ snapshot: source });
  for (const [command, value] of [
    ['resultSnapshotFiles.open', { path: 'C:/outside' }],
    ['resultSnapshotFiles.save', { snapshot: source, path: 'C:/outside' }],
    ['resultSnapshotFiles.save', { snapshot: { ...source, version: 2 } }],
    ['resultSnapshotFiles.save', { snapshot: { ...source, connectionId: 'other' } }],
    ['resultSnapshotFiles.save', { snapshot: { ...source, sessionId: 'other' } }],
  ] as const) expect(() => validateCommand(command, value)).toThrow();
});

it('实际Main入口只打开本地文件，拒绝其它sender及同URL的其它frame', async () => {
  const h = harness();
  expect(await h.request(h.event, { command: 'resultSnapshotFiles.open', input: {} })).toEqual({ ok: true, result: null });
  const owner = h.files.open.mock.calls[0][0] as { assertCurrent(): void }; owner.assertCurrent(); expect(h.capture).toHaveBeenCalledTimes(1);
  for (const event of [{ ...h.event, sender: {} }, { ...h.event, senderFrame: { url: 'RAM:result-snapshot' } }]) {
    expect(await h.request(event, { command: 'resultSnapshotFiles.open', input: {} })).toMatchObject({ ok: false });
  }
  expect(h.files.open).toHaveBeenCalledTimes(1); h.invalidate(); expect(() => owner.assertCurrent()).toThrow(text.stale);
});

it.each(['open', 'save'] as const)('原%s在途仍阻止退出，迟到旧文档回执不发布或诱导重试', async method => {
  const h = harness(); let finish!: (value: unknown) => void;
  h.files[method].mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.request(h.event, { command: `resultSnapshotFiles.${method}`, input: method === 'save' ? { snapshot: snapshot() } : {} });
  expect(h.context.queryFileOperations.size).toBe(1); h.invalidate(); expect(h.context.queryFileOperations.size).toBe(1);
  finish(method === 'save' ? { name: '结果.dbark-result.json' } : { name: '结果.dbark-result.json', snapshot: snapshot() });
  expect(await pending).toEqual({ ok: false, error: method === 'save' ? text.unknownWrite : text.stale });
  expect(h.context.queryFileOperations.size).toBe(0);
});

it('退出后拒绝新文件操作，原磁盘错误保持且等待集合最终释放', async () => {
  const h = harness(); h.context.shuttingDown = true;
  expect(await h.request(h.event, { command: 'resultSnapshotFiles.open', input: {} })).toMatchObject({ ok: false });
  expect(h.files.open).not.toHaveBeenCalled(); h.context.shuttingDown = false;
  h.files.save.mockRejectedValue(Error('磁盘写入失败'));
  expect(await h.request(h.event, { command: 'resultSnapshotFiles.save', input: { snapshot: snapshot() } })).toEqual({ ok: false, error: '磁盘写入失败' });
  expect(h.context.queryFileOperations.size).toBe(0);
});
