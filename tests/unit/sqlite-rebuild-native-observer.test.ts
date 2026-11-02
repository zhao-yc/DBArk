import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { sqliteTableCheckEditsSchema } from '../../src/shared/sqliteTableChecks';

const source = readFileSync(new URL('../e2e/sqlite-table-rebuild-native.spec.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('sqlite-table-rebuild-native.spec.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
/** 只提取实际spec的原Main观察器；不加载Electron、文件、数据库或手写第二份授权逻辑。 */
async function fixture(mode: { nullability?: boolean; successful?: boolean } = {}) {
  const declarations: ts.VariableDeclaration[] = [];
  function visit(node: ts.Node): void { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'arm') declarations.push(node); ts.forEachChild(node, visit); }
  visit(ast); expect(declarations).toHaveLength(1);
  const original = vi.fn(async (_event: unknown, payload: unknown) => ({ ok: true, result: (payload as { command?: string }).command === 'sqlite.tableRebuild.inspect' ? { catalogueId: '本例目录' } : { preferences: undefined } }));
  const frame = {}, webContents = { mainFrame: frame, send: vi.fn() }, window = { webContents, isDestroyed: () => false };
  const forkSpy = vi.fn(() => { throw Error('布局读取不能启动数据库worker'); });
  const ipcMain = { _invokeHandlers: new Map([['dbark:request', original]]) }, dialog = { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }, utilityProcess = { fork: forkSpy };
  const ports = { ipcMain, BrowserWindow: { getAllWindows: () => [window] }, dialog, utilityProcess };
  const exports: { arm?: (profiles: Record<string, boolean>) => Promise<void> } = {};
  const scope: Record<string, unknown> = { exports, structuredClone, step: async (action: () => Promise<unknown>) => action(), application: { evaluate: async (callback: (channels: typeof ports, input: unknown) => unknown, input: unknown) => callback(ports, input) }, database: 'C:\\fixture-owned\\subject.sqlite', connectionName: '本例SQLite', tableName: 'subject', defaultText: '本例默认', mode: 'success', successful: mode.successful ?? true, foreign: false, foreignEdits: undefined, primary: false, primaryEdit: undefined, unique: false, uniqueEdits: undefined, checks: false, checkEdits: undefined, nullability: mode.nullability ?? false };
  const code = ts.transpileModule('exports.arm = ' + declarations[0].initializer!.getText(ast) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, scope); await exports.arm!({ owned: false });
  const send = (command: string, input: unknown, event = { sender: webContents, senderFrame: frame }) => (ipcMain._invokeHandlers.get('dbark:request')! as (event: unknown, payload: unknown) => Promise<unknown>)(event, { command, input });
  return { original, send, forkSpy, frame, webContents, state: scope.__sqliteTableRebuildNative as { pending: number; denied: string[]; operations: { command: string; request: unknown }[]; check(): void; restore(): void } };
}
const target = { connectionId: 'owned', database: 'main', table: 'subject' };

describe('SQLite字段重建原生观察器的本机列布局读取', () => {
  it.each([true, false])('实际NOT NULL窗口白名单只放行本例准确布尔补丁，成功=%s', async successful => {
    const f = await fixture({ nullability: true, successful }), changes = successful ? [{ column: 'exact_original', notNull: false }, { column: 'amount', notNull: true }] : [{ column: 'amount', notNull: true }];
    await f.send('sqlite.tableRebuild.inspect', { ...target, taskId: '本例读取' }); await f.send('sqlite.tableRebuild.preview', { catalogueId: '本例目录', taskId: '本例预览', changes }); expect(f.original).toHaveBeenCalledTimes(2); expect(f.state.denied).toEqual([]); expect(f.state.pending).toBe(0); expect(f.forkSpy).not.toHaveBeenCalled(); f.state.restore();
  });
  it.each([true, false])('NOT NULL白名单拒绝替代类型修改和不同布尔值，成功=%s', async successful => {
    const f = await fixture({ nullability: true, successful }); await expect(f.send('sqlite.tableRebuild.preview', { catalogueId: '本例目录', taskId: '本例预览', changes: [{ column: 'amount', notNull: false }] })).rejects.toThrow('非本例准确字段设计'); expect(f.original).not.toHaveBeenCalled(); expect(f.forkSpy).not.toHaveBeenCalled();
  });
  it('旧模式不能借NOT NULL新入口扩大自己的实际窗口授权', async () => {
    const f = await fixture(); await expect(f.send('sqlite.tableRebuild.preview', { catalogueId: '本例目录', taskId: '本例预览', changes: [{ column: 'note', declaredType: 'VARCHAR(64)', default: { kind: 'text', value: '本例默认' }, notNull: true }] })).rejects.toThrow('非本例准确字段设计'); expect(f.original).not.toHaveBeenCalled(); expect(f.forkSpy).not.toHaveBeenCalled();
  });
  it.each([true, false])('实际spec的CHECK白名单保持合同规范化后的准确JSON顺序，成功=%s', successful => {
    const declarations: ts.VariableDeclaration[] = [];
    function visit(node: ts.Node): void { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'checkEdits') declarations.push(node); ts.forEachChild(node, visit); }
    visit(ast); expect(declarations).toHaveLength(1);
    const scope = { exports: {} as { value?: unknown }, successful, tableName: '限定"表', quote: (name: string) => '"' + name.replaceAll('"', '""') + '"' };
    const code = ts.transpileModule('exports.value = ' + declarations[0].initializer!.getText(ast) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    runInNewContext(code, scope); const value = JSON.parse(JSON.stringify(scope.exports.value)); expect(JSON.stringify(sqliteTableCheckEditsSchema.parse(value))).toBe(JSON.stringify(value));
  });
  it('旧字段模式拒绝额外CHECK补丁，不能因新增模式而放宽原准确设计保护', async () => {
    const f = await fixture(); await expect(f.send('sqlite.tableRebuild.preview', { catalogueId: '本例目录', taskId: '本例预览', changes: [{ column: 'note', declaredType: 'VARCHAR(64)', default: { kind: 'text', value: '本例默认' } }], checkEdits: [{ kind: 'add', definition: { location: 'table', name: null, expression: '1' } }] })).rejects.toThrow('非本例准确字段设计'); expect(f.original).not.toHaveBeenCalled(); expect(f.forkSpy).not.toHaveBeenCalled();
  });
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
