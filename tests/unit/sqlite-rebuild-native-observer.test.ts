import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/sqlite-table-rebuild-native.spec.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('sqlite-table-rebuild-native.spec.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
/** 只提取实际spec的原Main观察器；不加载Electron、文件、数据库或手写第二份授权逻辑。 */
async function fixture() {
  const declarations: ts.VariableDeclaration[] = [];
  function visit(node: ts.Node): void { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'arm') declarations.push(node); ts.forEachChild(node, visit); }
  visit(ast); expect(declarations).toHaveLength(1);
  const original = vi.fn(async (_event: unknown, _payload: unknown) => ({ ok: true, result: { preferences: undefined } }));
  const frame = {}, webContents = { mainFrame: frame, send: vi.fn() }, window = { webContents, isDestroyed: () => false };
  const forkSpy = vi.fn(() => { throw Error('布局读取不能启动数据库worker'); });
  const ipcMain = { _invokeHandlers: new Map([['dbark:request', original]]) }, dialog = { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }, utilityProcess = { fork: forkSpy };
  const ports = { ipcMain, BrowserWindow: { getAllWindows: () => [window] }, dialog, utilityProcess };
  const exports: { arm?: (profiles: Record<string, boolean>) => Promise<void> } = {};
  const scope: Record<string, unknown> = { exports, structuredClone, step: async (action: () => Promise<unknown>) => action(), application: { evaluate: async (callback: (channels: typeof ports, input: unknown) => unknown, input: unknown) => callback(ports, input) }, database: 'C:\\fixture-owned\\subject.sqlite', connectionName: '本例SQLite', tableName: 'subject', defaultText: '本例默认', mode: 'success' };
  const code = ts.transpileModule('exports.arm = ' + declarations[0].initializer!.getText(ast) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, scope); await exports.arm!({ owned: false });
  const send = (command: string, input: unknown, event = { sender: webContents, senderFrame: frame }) => (ipcMain._invokeHandlers.get('dbark:request')! as (event: unknown, payload: unknown) => Promise<unknown>)(event, { command, input });
  return { original, send, forkSpy, frame, webContents, state: scope.__sqliteTableRebuildNative as { pending: number; denied: string[]; operations: { command: string; request: unknown }[]; check(): void; restore(): void } };
}
const target = { connectionId: 'owned', database: 'main', table: 'subject' };

describe('SQLite字段重建原生观察器的本机列布局读取', () => {
  it('准确本例三字段读取透传原Main，原请求与回包保留，不启动worker或签发其它能力', async () => {
    const f = await fixture(); await expect(f.send('sqlite.tableLayout.get', target)).resolves.toEqual({ ok: true, result: { preferences: undefined } });
    expect(f.original).toHaveBeenCalledTimes(1); expect(f.original.mock.calls[0][1]).toEqual({ command: 'sqlite.tableLayout.get', input: target });
    expect(f.state.denied).toEqual([]); expect(f.state.pending).toBe(0); expect(f.state.operations).toHaveLength(1); expect(f.state.operations[0]).toMatchObject({ command: 'sqlite.tableLayout.get', request: target }); expect(f.forkSpy).not.toHaveBeenCalled();
    expect(() => f.state.check()).not.toThrow(); f.state.restore();
  });
  it.each([
    { ...target, connectionId: 'other' }, { ...target, database: 'temp' }, { ...target, table: 'other' },
    { database: 'main', table: 'subject' }, { ...target, connectionId: '__proto__' },
    { ...target, sql: '界外SQL' }, { ...target, filters: [] }, { ...target, extra: undefined }
  ])('非本例或多余布局字段整次拒绝：%j', async input => {
    const f = await fixture(); await expect(f.send('sqlite.tableLayout.get', input)).rejects.toThrow(/其它SQLite本机列布局|其它表目标/);
    expect(f.original).not.toHaveBeenCalled(); expect(f.state.operations).toEqual([]); expect(f.state.pending).toBe(0); expect(() => f.state.check()).toThrow('SQLite重建原观察器失效');
    await expect(f.send('sqlite.tableLayout.get', target)).rejects.toThrow('SQLite重建原观察器失效'); expect(f.forkSpy).not.toHaveBeenCalled();
  });
  it.each(['sqlite.tableLayout.save', 'sqlite.tableLayout.delete', 'sqlite.tableLayout.reset', 'sqlite.tableLayout.any', 'table.page', 'query.execute', 'schema.columns.inspect'])('仅放行读取，不放行写入或其它命令：%s', async command => {
    const f = await fixture(); await expect(f.send(command, target)).rejects.toThrow('非白名单命令'); expect(f.original).not.toHaveBeenCalled(); expect(f.state.operations).toEqual([]); expect(f.forkSpy).not.toHaveBeenCalled();
  });
  it('其它主文档仍被原观察器拒绝，当前检查失效后不能继续读取', async () => {
    const f = await fixture(); await expect(f.send('sqlite.tableLayout.get', target, { sender: f.webContents, senderFrame: {} })).rejects.toThrow('其它文档');
    expect(f.original).not.toHaveBeenCalled(); expect(() => f.state.check()).toThrow('SQLite重建原观察器失效'); expect(f.forkSpy).not.toHaveBeenCalled();
  });
});
