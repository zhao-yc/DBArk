import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SavedQuerySearches, type SavedQuerySearchStore } from '../../src/main/savedQuerySearch';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { decodeQueryFile } from '../../src/main/queryFiles';
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
  const branches = dispatch?.body?.statements.filter((node): node is ts.IfStatement => ts.isIfStatement(node) && ["command === 'queries.readText'", "command === 'queries.exportSql'", "command === 'queries.importSql'"].includes(node.expression.getText(tree))) ?? [];
  let wrapper: ts.Expression | undefined;
  function visit(node: ts.Node): void { if (ts.isCallExpression(node) && node.expression.getText(tree) === 'ipcMain.handle' && node.arguments[0]?.getText(tree) === "'dbark:request'") wrapper = node.arguments[1]; ts.forEachChild(node, visit); } visit(tree);
  if (branches.length !== 3 || !wrapper) throw Error('未取得正文读取、导入导出和IPC入口');
  const frame = { url: 'ram://read-text', processId: 1, frameToken: '原文档', detached: false }, contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false }), window = { webContents: contents, isDestroyed: () => false }, structureTokens = new Map();
  const unexpected = vi.fn((): never => { throw Error('本地正文不得访问连接/Engine/来源绑定'); });
  const columnsMain = new ColumnsMainCapabilities(structureTokens, { currentWindow: () => window as never, rendererURL: frame.url, connectionRevision: () => 0, assertAvailable: unexpected, shuttingDown: () => false, release: unexpected }); columnsMain.trackWindow(window as never);
  const choose = vi.fn(async (): Promise<{ canceled: boolean; filePath?: string }> => ({ canceled: true }));
  const chooseImport = vi.fn(async () => ({ canceled: true, filePaths: [] as string[] }));
  const snapshot = vi.fn(async (_path: string, assertCurrent: () => void) => { assertCurrent(); return { bytes: Buffer.from('SELECT 1;') }; });
  const create = vi.fn((content: { name: string }) => ({ name: content.name }));
  const release = vi.fn(), reserve = vi.fn(async (_path: string) => release), write = vi.fn(async () => {});
  const context = createContext({ Error, TableChecksMainCapabilities, tableChecksFailureProgress, structureTokens, columnsMain, savedQuerySearches: f.service, shuttingDown: false, window, rendererURL: frame.url, tasks: new Map(), queryInsertExports: { has: () => false }, validateMainCommand: validateCommand, localSearchOperations: new Set(), queryFileOperations: new Set(), connectionConfig: { assertAvailable: unexpected }, store: { bindQuerySource: unexpected, resolveConnection: unexpected, connectionRevision: () => 0, createBoundQuery: create }, broker: { request: unexpected }, basename, dialog: { showSaveDialog: choose, showOpenDialog: chooseImport }, queryFileOperation: (action: () => Promise<unknown>) => action(), exportReservations: { acquire: reserve }, writeQueryFile: write, readQueryFileSnapshot: snapshot, decodeQueryFile });
  const code = extractMainProductionBinding(source, 'tableChecksMain') + '\nasync function dispatch(command:any,input:any,columns?:any){' + branches.map(branch => branch.getText(tree)).join('\n') + "throw Error('未授权其它分发');}\nglobalThis.request=" + wrapper.getText(tree) + ';';
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  const event = { sender: contents, senderFrame: frame };
  return { ...f, context, unexpected, event, contents, choose, chooseImport, snapshot, create, reserve, release, write, request: (input: unknown, sender = event): Promise<any> => context.request(sender, { command: 'queries.readText', input }), exportSql: (input: unknown): Promise<any> => context.request(event, { command: 'queries.exportSql', input }), importSql: (input: unknown): Promise<any> => context.request(event, { command: 'queries.importSql', input }) };
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

describe('queries.exportSql 原生选址及原摘要写入', () => {
  it('取消不读正文，确认后以 UTF-8 写入原文且只返回文件名', async () => {
    const f = mainFixture(), target = 'C:/isolated/saved.sql';
    expect(publicCommands['queries.exportSql']).toBe(true);
    expect(await f.exportSql({ ...f.input(), path: target })).toMatchObject({ ok: false });
    expect(f.choose).not.toHaveBeenCalled();
    expect(await f.exportSql(f.input())).toEqual({ ok: true, result: { status: 'cancelled' } });
    expect(f.store.querySearchRaw).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    f.choose.mockResolvedValueOnce({ canceled: false, filePath: target });
    expect(await f.exportSql(f.input())).toEqual({ ok: true, result: { status: 'saved', name: 'saved.sql' } });
    expect(f.reserve).toHaveBeenCalledExactlyOnceWith(target);
    expect(f.write).toHaveBeenCalledExactlyOnceWith(target, record().sql, 'utf8');
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.connection).not.toHaveBeenCalled();
    expect(f.unexpected).not.toHaveBeenCalled();
  });

  it('选址期间原记录变化或文档失效均拒绝写入', async () => {
    const target = 'C:/isolated/saved.sql';
    const stale = mainFixture(), original = stale.input();
    stale.choose.mockImplementationOnce(async () => {
      stale.replace(JSON.stringify(record({ sql: 'SELECT 2' })));
      return { canceled: false, filePath: target };
    });
    expect(await stale.exportSql(original)).toMatchObject({ ok: false });
    expect(stale.write).not.toHaveBeenCalled();
    expect(stale.release).toHaveBeenCalledOnce();
    const obsolete = mainFixture();
    obsolete.choose.mockImplementationOnce(async () => {
      obsolete.contents.emit('did-navigate');
      return { canceled: false, filePath: target };
    });
    expect(await obsolete.exportSql(obsolete.input())).toMatchObject({ ok: false });
    expect(obsolete.reserve).not.toHaveBeenCalled();
    expect(obsolete.write).not.toHaveBeenCalled();
  });
});

describe('queries.importSql 真实 Main 分支', () => {
  it('只接受编码，取消不读取，带 BOM 的原文写成独立未绑定查询', async () => {
    const f = mainFixture(), input = { encoding: 'utf8' }, path = 'C:/isolated/中文😀.SQL';
    const sql = "-- 原文\r\nSELECT '😀';\n";
    expect(await f.importSql({ ...input, path })).toMatchObject({ ok: false });
    expect(f.chooseImport).not.toHaveBeenCalled();
    expect(await f.importSql(input)).toEqual({ ok: true, result: { status: 'cancelled' } });
    expect(f.snapshot).not.toHaveBeenCalled();
    f.chooseImport.mockResolvedValueOnce({ canceled: false, filePaths: [path] });
    f.snapshot.mockResolvedValueOnce({ bytes: Buffer.from('\uFEFF' + sql, 'utf16le') });
    expect(await f.importSql(input)).toEqual({ ok: true, result: { status: 'imported', name: '中文😀' } });
    expect(f.create).toHaveBeenCalledExactlyOnceWith({ name: '中文😀', context: { state: 'known', database: null }, sql });
    expect(f.unexpected).not.toHaveBeenCalled();
  });

  it('坏编码和文件读取时失效的文档都不能写入查询库', async () => {
    const f = mainFixture(), input = { encoding: 'utf8' };
    f.chooseImport.mockResolvedValue({ canceled: false, filePaths: ['C:/isolated/file.sql'] });
    f.snapshot.mockResolvedValueOnce({ bytes: Buffer.from([0xff]) });
    expect(await f.importSql(input)).toMatchObject({ ok: false });
    f.snapshot.mockImplementationOnce(async () => {
      f.contents.emit('did-navigate');
      return { bytes: Buffer.from('SELECT 2;') };
    });
    expect(await f.importSql(input)).toMatchObject({ ok: false });
    expect(f.create).not.toHaveBeenCalled();
  });
});
