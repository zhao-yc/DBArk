import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { SqliteConnectionFiles } from '../../src/main/sqliteConnectionFiles';
import { ConnectionConfigManager } from '../../src/main/connectionConfig';
import { commandSchemas } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import type { SqliteConnectionProfile } from '../../src/shared/contracts';

const directories: string[] = [];
afterEach(context => {
  if (context.task.result?.state === 'fail') return;
  for (const directory of directories.splice(0)) {
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    expect(basename(directory).startsWith('dbark-main-sqlite-create-')).toBe(true);
    rmSync(directory, { recursive: true });
  }
});

/** 抽取生产处理器而非重写路由；文件生成端口另由真实utility及磁盘专项验证。 */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-main-sqlite-create-')); directories.push(directory);
  const destination = join(directory, '新建数据库.sqlite');
  const text = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true);
  const functions = tree.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && ['createSqliteFile', 'queryFileOperation', 'dispatch'].includes(node.name?.text ?? ''));
  expect(functions).toHaveLength(3);
  let current = {};
  const original = current;
  const owner = { owner: { window: {}, document: original } };
  const assertOwner = (value: typeof owner | undefined) => { if (!value || value.owner.document !== current) throw Error('原文档已失效'); };
  const grants = new SqliteConnectionFiles<typeof owner>({ assert: assertOwner, same: (left, right) => left.owner.document === right.owner.document });
  const choose = vi.fn(async () => ({ canceled: false, filePath: destination }));
  const create = vi.fn(async (path: string, options: { assertOwner(): void }) => {
    options.assertOwner(); writeFileSync(path, '仅文件能力夹具，非SQLite内容验证', { flag: 'wx' });
    const identity = statSync(path, { bigint: true });
    return { path: realpathSync(path), device: identity.dev, inode: identity.ino };
  });
  const port = createContext({ Error, Promise, structureTokens: new Map(), connectionConfig: new ConnectionConfigManager({} as never, {} as never), shuttingDown: false, columnsMain: { assertCapturedOwner: assertOwner }, queryFileOperations: new Set(), dialog: { showSaveDialog: choose }, createSqliteDatabaseFile: create, sqliteFiles: grants });
  runInContext(ts.transpileModule(functions.map(node => node.getText(tree)).join('\n') + '\nglobalThis.run = dispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, port);
  const profile: SqliteConnectionProfile = { id: 'new-sqlite', name: '本例', group: '', color: '#123456', dialect: 'sqlite', sqlite: { readOnly: false, busyTimeoutMs: 1000 } };
  return { directory, destination, owner, grants, choose, create, port, profile, rotate() { current = {}; }, invoke: () => port.run('files.createSqlite', { connectionId: profile.id }, owner) };
}

it('新命令只接受准确连接编号，preload显式开放，不接受路径/SQL/方言/覆盖标志', () => {
  expect(publicCommands['files.createSqlite']).toBe(true);
  expect(commandSchemas['files.createSqlite'].parse({ connectionId: 'id' })).toEqual({ connectionId: 'id' });
  for (const input of [{}, { connectionId: '' }, { connectionId: 'x'.repeat(201) }, ...['path', 'filePath', 'sql', 'dialect', 'overwrite', 'token', 'purpose'].map(key => ({ connectionId: 'id', [key]: '任意' }))]) expect(commandSchemas['files.createSqlite'].safeParse(input).success).toBe(false);
});
it('取消不调用生成器，不签令牌，不登记残留文件操作', async () => {
  const f = fixture(); f.choose.mockResolvedValue({ canceled: true, filePath: '' });
  expect(await f.invoke()).toBeNull(); expect(f.create).not.toHaveBeenCalled(); expect(f.port.queryFileOperations.size).toBe(0);
  expect(f.choose).toHaveBeenCalledWith(f.owner.owner.window, expect.objectContaining({ title: '新建SQLite数据库文件', defaultPath: '新数据库.sqlite' }));
});
it('创建只签准确文件能力，不返回路径，令牌仍限定原文档与原连接', async () => {
  const f = fixture(), choice = await f.invoke();
  expect(Object.keys(choice).sort()).toEqual(['name', 'token']); expect(choice.name).toBe(basename(f.destination));
  const selected = { ...f.profile, sqlite: { ...f.profile.sqlite, fileToken: choice.token } };
  expect(f.grants.confirm(selected, undefined, f.owner).sqlite.filePath).toBe(realpathSync(f.destination));
  expect(() => f.grants.confirm({ ...selected, id: 'other' }, undefined, f.owner)).toThrow();
  expect(f.create).toHaveBeenCalledOnce(); expect(f.port.queryFileOperations.size).toBe(0);
});
it('对话框迟到及退出屏障在生成前拒绝，不产生文件或令牌', async () => {
  const f = fixture(); f.choose.mockImplementation(async () => { f.rotate(); return { canceled: false, filePath: f.destination }; });
  await expect(f.invoke()).rejects.toThrow('原文档'); expect(f.create).not.toHaveBeenCalled(); expect(f.port.queryFileOperations.size).toBe(0);
  const g = fixture(); g.port.shuttingDown = true;
  await expect(g.invoke()).rejects.toThrow('退出'); expect(g.choose).not.toHaveBeenCalled(); expect(g.create).not.toHaveBeenCalled();
});
it('生成完成后文档失效保留文件且清楚告知，不向新文档签发令牌', async () => {
  const f = fixture(), original = f.create.getMockImplementation()!;
  f.create.mockImplementation(async (path, options) => { const created = await original(path, options); f.rotate(); return created; });
  await expect(f.invoke()).rejects.toThrow('文件已创建');
  expect(readFileSync(f.destination, 'utf8')).toContain('文件能力夹具'); expect(f.port.queryFileOperations.size).toBe(0);
});
it('生成后同路径被替换时不误授权，也不删除替换文件', async () => {
  const f = fixture(), original = f.create.getMockImplementation()!;
  f.create.mockImplementation(async (path, options) => {
    const created = await original(path, options); renameSync(path, join(f.directory, '本例原文件.sqlite')); writeFileSync(path, '替换文件保留'); return created;
  });
  await expect(f.invoke()).rejects.toThrow('文件已创建'); expect(readFileSync(f.destination, 'utf8')).toBe('替换文件保留');
});
it('原生成失败原样返回，不错误签发成功，退出等待集合准确解除', async () => {
  const f = fixture(); f.create.mockRejectedValue(Error('已有文件不能覆盖'));
  await expect(f.invoke()).rejects.toThrow('已有文件不能覆盖'); expect(f.port.queryFileOperations.size).toBe(0);
});
