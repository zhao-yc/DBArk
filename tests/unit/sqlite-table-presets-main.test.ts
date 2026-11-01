import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { ColumnsMainCapabilities, type ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import { SqliteTablePresetMain } from '../../src/main/sqliteTablePresetMain';
import type { SqliteTablePresetSnapshot, SqliteTablePresetStoredSnapshot, SqliteTablePresetSave, SqliteTablePresetSelect } from '../../src/shared/sqliteTablePresets';
import { validateCommand } from '../../src/shared/validation';

const target = { connectionId: 'sqlite', database: 'main' as const, table: 'subject' };
const query = { limit: 5, mode: 'and' as const, filters: [], sort: [] };
/** 原Main文档捕获真实执行；仅持久化端口用RAM，磁盘原子性另由storage套件验证。 */
function fixture() {
  let now = 0, busy = false, shutdown = false, snapshot: SqliteTablePresetStoredSnapshot = { version: 1, target, revision: 0, source: { connectionRevision: 1, connectionDigest: 'a'.repeat(64) }, entries: [] };
  const listeners = new Map<string, ((...args: any[]) => void)[]>(), frame = { url: 'ram://renderer', detached: false, processId: 1, frameToken: 'main' };
  const contents = { mainFrame: frame, isDestroyed: () => false, on: (name: string, callback: (...args: any[]) => void) => listeners.set(name, [...listeners.get(name) ?? [], callback]) }, window = { webContents: contents, isDestroyed: () => false };
  const owners = new ColumnsMainCapabilities(new Map(), { currentWindow: () => window as any, rendererURL: frame.url, connectionRevision: () => 1, assertAvailable() {}, shuttingDown: () => false, release: async () => {} }); owners.trackWindow(window as any);
  const capture = () => owners.capture({ sender: contents, senderFrame: frame } as any);
  const checked = (raw: SqliteTablePresetSave | SqliteTablePresetSelect) => { if (raw.expectedRevision !== snapshot.revision || JSON.stringify(raw.source) !== JSON.stringify(snapshot.source)) throw Error('CAS变化'); };
  const port = {
    sqliteTablePresets: vi.fn(() => structuredClone(snapshot)),
    saveSqliteTablePreset: vi.fn((raw: unknown, guard?: () => void) => { const input = raw as SqliteTablePresetSave; checked(input); guard!(); snapshot = { ...snapshot, revision: snapshot.revision + 1, entries: [{ id: randomUUID(), name: input.name, connectionDigest: snapshot.source.connectionDigest, query: input.query }] }; return structuredClone(snapshot); }),
    deleteSqliteTablePreset: vi.fn((raw: unknown, guard?: () => void) => { checked(raw as SqliteTablePresetSelect); guard!(); snapshot = { ...snapshot, revision: snapshot.revision + 1, entries: [] }; return structuredClone(snapshot); }),
    selectedSqliteTablePreset: vi.fn((raw: unknown) => { checked(raw as SqliteTablePresetSelect); return structuredClone(query); }),
  };
  const main = new SqliteTablePresetMain({ store: port, assert: value => owners.assertCapturedOwner(value), same: (a, b) => owners.sharesDocumentOwner(a, b), available: id => { if (busy || id !== target.connectionId) throw Error('连接过渡'); }, shuttingDown: () => shutdown }, () => now);
  const list = () => { const r = main.execute('list', target, capture()); r.publish(); return r.value as SqliteTablePresetSnapshot; };
  const packet = (s: SqliteTablePresetSnapshot) => ({ ...target, expectedRevision: s.revision, source: s.source, bindingToken: s.bindingToken });
  return { main, port, list, capture, packet, owners, navigate: () => listeners.get('did-start-navigation')!.forEach(fn => fn({ isMainFrame: true, isSameDocument: false })), time: (n: number) => { now = n; }, busy: (b: boolean) => { busy = b; }, shutdown: () => { shutdown = true; }, bump: () => { snapshot.revision++; } };
}
it('真实文档绑定拒绝伪造捕获、令牌、目标及来源；list只读本机端口', () => {
  const f = fixture(), s = f.list(), input = { ...f.packet(s), name: '方案', query };
  expect(f.port.saveSqliteTablePreset).not.toHaveBeenCalled(); expect(f.port.sqliteTablePresets).toHaveBeenCalledTimes(2);
  expect(() => f.main.execute('save', input, { owner: f.capture().owner } as ColumnsInvocation)).toThrow();
  for (const extra of [{ bindingToken: randomUUID() }, { table: 'other' }, { source: { ...s.source, connectionRevision: 2 } }]) expect(() => f.main.execute('save', { ...input, ...extra }, f.capture())).toThrow();
  const saved = f.main.execute('save', input, f.capture()); saved.publish(); expect((saved.value as SqliteTablePresetSnapshot).revision).toBe(1);
  expect(() => f.main.execute('save', input, f.capture())).toThrow('CAS');
});
it.each(['navigation', 'invalidation', 'expiry', 'rollback', 'busy', 'shutdown'] as const)('%s在执行前撤销能力，恢复原目标也不重用旧文档', mode => {
  const f = fixture(), s = f.list(), input = { ...f.packet(s), name: '方案', query };
  if (mode === 'navigation') f.navigate(); if (mode === 'invalidation') f.main.invalidate(); if (mode === 'expiry') f.time(600000);
  if (mode === 'rollback') { f.time(20); f.list(); f.time(19); }
  if (mode === 'busy') f.busy(true); if (mode === 'shutdown') f.shutdown();
  expect(() => f.main.execute('save', input, f.capture())).toThrow(); expect(f.port.saveSqliteTablePreset).not.toHaveBeenCalled();
});
it('超过256个来源淘汰最旧令牌，时间回退后重建令牌不复活旧令牌', () => {
  const f = fixture(), first = f.list(); for (let i = 0; i < 256; i++) f.list();
  expect(() => f.main.execute('save', { ...f.packet(first), name: '旧令牌', query }, f.capture())).toThrow('来源');
});
it.each(['save', 'delete'] as const)('%s落盘后发布失效明确报告已保存事实，不能伪装失败而自动重试', command => {
  const f = fixture(), first = f.list(), created = f.main.execute('save', { ...f.packet(first), name: '方案', query }, f.capture()); created.publish(); const s = created.value as SqliteTablePresetSnapshot;
  const result = f.main.execute(command, command === 'save' ? { ...f.packet(s), name: '另一项', query } : { ...f.packet(s), id: s.entries[0].id }, f.capture());
  f.navigate(); expect(() => result.publish()).toThrow('已保存');
});
it('只读发布晚回包被修订/文档变化拒绝，不能领取旧快照', () => {
  const f = fixture(), r = f.main.execute('list', target, f.capture()); f.bump(); expect(() => r.publish()).toThrow('变化');
  const later = fixture(), read = later.main.execute('list', target, later.capture()); later.navigate(); expect(() => read.publish()).toThrow();
});
it('落盘后签发阶段遇到单调时钟失效也明确报告已保存', () => {
  const f = fixture(), first = f.list(), save = f.port.saveSqliteTablePreset.getMockImplementation()!;
  f.port.saveSqliteTablePreset.mockImplementationOnce((input, guard) => { const result = save(input, guard); f.time(-1); return result; });
  expect(() => f.main.execute('save', { ...f.packet(first), name: '已保存', query }, f.capture())).toThrow('已保存'); expect(f.port.sqliteTablePresets().entries).toHaveLength(1);
});
it('原Main真实捕获及await后必须执行发布门，四条受限IPC与preload白名单完整接线', () => {
  for (const command of ['list', 'save', 'delete', 'read']) {
    const f = fixture(), s = f.list(), input = command === 'list' ? target : command === 'save' ? { ...f.packet(s), name: '方案', query } : { ...f.packet(s), id: randomUUID() };
    expect(() => validateCommand('sqlite.tablePresets.' + command, input)).not.toThrow();
  }
  const text = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true);
  const statements: string[] = []; function walk(n: ts.Node): void { if (ts.isIfStatement(n) && n.expression.getText(tree).includes("startsWith('sqlite.tablePresets.')")) statements.push(n.getText(tree)); ts.forEachChild(n, walk); } walk(tree);
  expect(statements.some(value => value.includes('columnsMain.capture(event)'))).toBe(true);
  expect(statements.some(value => value.includes('sqlitePresetPublication()') && value.includes('throw Error'))).toBe(true);
  expect(text).toContain('get store() { return store; }'); expect(readFileSync(new URL('../../src/shared/commands.ts', import.meta.url), 'utf8')).toContain("'sqlite.tablePresets.delete'");
});
