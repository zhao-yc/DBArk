import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SavedQuerySearches, type SavedQuerySearchStore } from '../../src/main/savedQuerySearch';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { TableChecksMainCapabilities, tableChecksFailureProgress } from '../../src/main/tableChecksMainCapabilities';
import { savedQueryReadTextSchema, savedQuerySearchLimits } from '../../src/shared/savedQuerySearch';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import type { SavedQuery } from '../../src/shared/contracts';
import { extractMainProductionBinding } from './main-production-function';

const digest = (source: string) => createHash('sha256').update(source).digest('hex');
const record = (patch: Partial<SavedQuery> = {}): SavedQuery => ({ id: 'saved', name: '原保存查询', connectionId: 'deleted-profile', databaseContext: { state: 'known', database: null }, sql: "-- 完整😀原文\r\nSELECT '精度9007199254740993.123400', NULL;\n".repeat(40), updatedAt: '2026-10-28T00:00:00.000Z', ...patch });

/** 原记录端口仅本地字符串，不提供查询引擎、Worker或连接配置；正文读取必须保持同步且不触其它端口。 */
function local(initial = record()) {
  let raw: string | undefined = JSON.stringify(initial), onRead: (() => void) | undefined;
  const connection = vi.fn((_id: string): boolean => { throw Error('正文插入不得检查来源连接'); });
  const store: SavedQuerySearchStore = { querySearchRaw: vi.fn((id: string) => { if (id !== initial.id) return; onRead?.(); return raw; }), queryConnectionExists: connection, querySearchRevision: () => { throw Error('正文读取不启动搜索'); }, querySearchNext: () => { throw Error('正文读取不启动搜索'); } };
  const service = new SavedQuerySearches(store, '不应加载的Worker路径');
  return { service, store, connection, input: () => ({ id: initial.id, digest: digest(raw!) }), raw: () => raw, replace(value: string | undefined) { raw = value; }, reading(callback: () => void) { onRead = callback; } };
}

describe('保存查询完整正文的严格本地读取', () => {
  it('公开IPC只接受原id规则和小写SHA256，拒绝任何连接、路径、预览、绑定或执行参数', () => {
    const input = { id: '__proto__', digest: 'a'.repeat(64) }; expect(publicCommands['queries.readText']).toBe(true); expect(validateCommand('queries.readText', input)).toEqual(input);
    for (const patch of [{ id: '' }, { id: 'x'.repeat(201) }, { digest: 'A'.repeat(64) }, { digest: 'a'.repeat(63) }, { digest: 1 }, { connectionId: 'target' }, { sql: 'SELECT injected' }, { sourceBinding: {} }, { path: '本地秘密' }, { taskId: 'execute' }, { digest: undefined }]) {
      expect(() => savedQueryReadTextSchema.parse({ ...input, ...patch })).toThrow(); expect(() => validateCommand('queries.readText', { ...input, ...patch })).toThrow();
    }
    expect(validateCommand('queries.readText', { ...input, id: '库😀' })).toEqual({ ...input, id: '库😀' });
  });
  it.each([{ state: 'known', database: null }, { state: 'known', database: '原库' }, { state: 'unknown' }] as const)('完整Unicode/CRLF/SQL和原来源$state只作元数据返回，不检查已删除连接', context => {
    const value = record({ databaseContext: context }), f = local(value), result = f.service.readText(f.input());
    expect(result).toEqual({ query: value }); expect(result.query.sql.length).toBeGreaterThan(256); expect(Object.keys(result)).toEqual(['query']); expect(result).not.toHaveProperty('sourceBinding'); expect(result).not.toHaveProperty('connectionId'); expect(f.connection).not.toHaveBeenCalled();
  });
  it('无绑定/遗留库来源及原型同名id照原记录返回，不套任何目标连接或默认库', () => {
    const value = record({ id: '__proto__', connectionId: undefined, database: '遗留库', databaseContext: undefined }), f = local(value);
    expect(f.service.readText(f.input()).query).toEqual(JSON.parse(JSON.stringify(value))); expect(f.connection).not.toHaveBeenCalled();
  });
  it('删除、摘要变更和记录id错配均失败，不返回旧摘要或预览正文', () => {
    const f = local(), selected = f.input(); f.replace(JSON.stringify(record({ sql: 'SELECT changed' }))); expect(() => f.service.readText(selected)).toThrow('已修改');
    f.replace(undefined); expect(() => f.service.readText(selected)).toThrow('已删除');
    f.replace(JSON.stringify(record({ id: 'other' }))); expect(() => f.service.readText({ id: 'saved', digest: digest(f.raw()!) })).toThrow('标识与本地索引不一致'); expect(f.connection).not.toHaveBeenCalled();
  });
  it.each(['json', 'sql-type', 'extra', 'null-connection', 'sql-limit'])('损坏或超限%s记录仍沿真实完整parser拒绝', kind => {
    const f = local(); const value = record() as unknown as Record<string, unknown>;
    if (kind === 'sql-type') value.sql = 12; if (kind === 'extra') value.sourceBinding = {}; if (kind === 'null-connection') value.connectionId = null; if (kind === 'sql-limit') value.sql = 'x'.repeat(savedQuerySearchLimits.sqlUnits + 1);
    f.replace(kind === 'json' ? '{损坏' : JSON.stringify(value)); expect(() => f.service.readText(f.input())).toThrow(kind === 'json' ? 'JSON无效' : '记录结构无效'); expect(f.connection).not.toHaveBeenCalled();
  });
  it('SQLite字节上限拒读原错不降成删除或预览，关闭后不再读取正文', async () => {
    const f = local(); vi.mocked(f.store.querySearchRaw).mockImplementationOnce(() => { throw Error('保存查询记录超过128MiB'); }); expect(() => f.service.readText({ id: 'saved', digest: 'a'.repeat(64) })).toThrow('超过128MiB');
    await f.service.close(); expect(() => f.service.readText(f.input())).toThrow('正在退出'); expect(f.connection).not.toHaveBeenCalled();
  });
  it('旧打开新标签仍共享摘要与合法记录门，替代连接原语义不变', () => {
    const f = local(); f.connection.mockImplementation(id => id === 'chosen');
    expect(f.service.read({ ...f.input(), connectionId: 'chosen' })).toMatchObject({ query: record(), connectionId: 'chosen', contextChanged: true, databaseContext: { state: 'unknown' } });
    expect(() => f.service.read({ ...f.input(), connectionId: 'missing' })).toThrow('连接不存在');
    const old = f.input(); f.replace(JSON.stringify(record({ sql: '修改正文' }))); expect(() => f.service.read({ ...old, connectionId: 'chosen' })).toThrow('已修改'); expect(() => f.service.readText(old)).toThrow('已修改');
  });
});

/** 只抽取真实Main专属分支与原IPC wrapper，执行真实owner类；配置、来源绑定与broker是拒绝哨兵。 */
function mainFixture() {
  const f = local(), source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const dispatch = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'dispatch');
  const branches = dispatch?.body?.statements.filter((node): node is ts.IfStatement => ts.isIfStatement(node) && node.expression.getText(tree) === "command === 'queries.readText'") ?? [];
  let wrapper: ts.Expression | undefined;
  function visit(node: ts.Node): void { if (ts.isCallExpression(node) && node.expression.getText(tree) === 'ipcMain.handle' && node.arguments[0]?.getText(tree) === "'dbark:request'") wrapper = node.arguments[1]; ts.forEachChild(node, visit); } visit(tree);
  if (branches.length !== 1 || !wrapper) throw Error('未取得唯一正式正文读取分支和IPC入口');
  const frame = { url: 'ram://read-text', processId: 1, frameToken: '原文档', detached: false }, contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false }), window = { webContents: contents, isDestroyed: () => false }, structureTokens = new Map();
  const unexpected = vi.fn((): never => { throw Error('本地正文不得访问连接/Engine/来源绑定'); });
  const columnsMain = new ColumnsMainCapabilities(structureTokens, { currentWindow: () => window as never, rendererURL: frame.url, connectionRevision: () => 0, assertAvailable: unexpected, shuttingDown: () => false, release: unexpected }); columnsMain.trackWindow(window as never);
  const context = createContext({ Error, TableChecksMainCapabilities, tableChecksFailureProgress, structureTokens, columnsMain, savedQuerySearches: f.service, shuttingDown: false, window, rendererURL: frame.url, tasks: new Map(), queryInsertExports: { has: () => false }, validateMainCommand: validateCommand, localSearchOperations: new Set(), queryFileOperations: new Set(), connectionConfig: { assertAvailable: unexpected }, store: { bindQuerySource: unexpected, resolveConnection: unexpected, connectionRevision: () => 0 }, broker: { request: unexpected } });
  const code = extractMainProductionBinding(source, 'tableChecksMain') + '\nasync function dispatch(command:any,input:any,columns?:any){' + branches[0].getText(tree) + "throw Error('未授权其它分发');}\nglobalThis.request=" + wrapper.getText(tree) + ';';
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  const event = { sender: contents, senderFrame: frame };
  return { ...f, context, unexpected, event, contents, request: (input: unknown, sender = event): Promise<any> => context.request(sender, { command: 'queries.readText', input }) };
}

describe('queries.readText正式Main本地分支与最终文档归属', () => {
  it('正式IPC返回完整原记录且无来源授权/配置锁/数据库请求', async () => {
    const f = mainFixture(); expect(await f.request(f.input())).toEqual({ ok: true, result: { query: record() } }); expect(f.unexpected).not.toHaveBeenCalled(); expect(f.connection).not.toHaveBeenCalled();
  });
  it('另一sender/frame、额外连接输入和退出状态不发布正文', async () => {
    const f = mainFixture();
    expect(await f.request(f.input(), { ...f.event, sender: {} as never })).toMatchObject({ ok: false }); expect(await f.request(f.input(), { ...f.event, senderFrame: { ...f.event.senderFrame } })).toMatchObject({ ok: false });
    expect(await f.request({ ...f.input(), connectionId: 'target' })).toMatchObject({ ok: false }); f.context.shuttingDown = true; expect(await f.request(f.input())).toMatchObject({ ok: false }); expect(f.unexpected).not.toHaveBeenCalled();
  });
  it('真实Main文档在读取后、IPC await发布前换代，完整SQL不能迟到发布', async () => {
    const f = mainFixture(); f.reading(() => queueMicrotask(() => f.contents.emit('did-navigate')));
    const result = await f.request(f.input()); expect(result).toMatchObject({ ok: false }); expect(result).not.toHaveProperty('result'); expect(f.unexpected).not.toHaveBeenCalled();
  });
});
