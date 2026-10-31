import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { LocalStore } from '../../src/main/storage';
import type { TaskRecord } from '../../src/shared/contracts';
import type { SqliteWriteFact } from '../../src/shared/sqliteTableEdit';
import { commandSchemas } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'), directories: string[] = [], stores = new Set<LocalStore>();
afterEach(context => {
  for (const store of stores) store.close(); stores.clear();
  if (context.task.result?.state === 'fail') return;
  for (const directory of directories.splice(0)) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-import-storage-')).toBe(true); rmSync(directory, { recursive: true }); }
});
/** 独立本地配置库只保存合成最小任务事实，不借用安装版用户数据。 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-import-storage-')); directories.push(directory); const path = join(directory, 'settings.sqlite');
  const open = async () => { const store = await LocalStore.open(path, wasm, { available: () => false, encrypt: () => '', decrypt: value => value }); stores.add(store); return store; };
  return { open, store: await open() };
}
function fact(phase: SqliteWriteFact['phase']): SqliteWriteFact {
  return { operationId: 'a2f5024f-0f5c-43f5-b519-21f110d41204', target: { connectionId: 'synthetic', database: 'main', table: 'subject' }, phase, requestedRows: 1001, appliedRows: phase === 'not-sent' ? 0 : 1001, commitMayHaveBeenSent: ['commit-pending', 'committed', 'unknown'].includes(phase), commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back' };
}
function task(id: string, phase: SqliteWriteFact['phase']): TaskRecord { return { id, kind: 'sqlite.tableImport.apply', status: 'running', progress: 20, startedAt: '2026-11-01T00:00:00Z', message: '旧概要', sqliteWrite: fact(phase) }; }
it('真实配置重启恢复1001行导入ACK/未知/回滚，不保留源路径、映射、行值或SQL', async () => {
  const f = await fixture(), poison = { filePath: 'D:/private/PRIVATE_IMPORT_STORAGE_783.csv', mapping: { note: 'PRIVATE_IMPORT_STORAGE_783' }, source: { sha256: 'b'.repeat(64), bytes: 40 }, errors: ['PRIVATE_IMPORT_STORAGE_783'], sql: 'INSERT PRIVATE_IMPORT_STORAGE_783' };
  for (const phase of ['committed', 'commit-pending', 'writing', 'rolled-back', 'not-sent'] as const) f.store.saveTask({ ...task(phase, phase), ...poison, ...(['rolled-back', 'not-sent'].includes(phase) ? { status: 'cancelled' as const } : {}) });
  f.store.close(); stores.delete(f.store); const reopened = await f.open(), rows = new Map(reopened.tasks().map(value => [value.id, value]));
  expect(rows.size).toBe(5); expect(rows.get('committed')).toMatchObject({ status: 'completed', progress: 100, sqliteWrite: fact('committed') });
  for (const phase of ['writing', 'commit-pending'] as const) expect(rows.get(phase)).toMatchObject({ status: 'failed', sqliteWrite: { ...fact(phase), phase: 'unknown' } });
  expect(rows.get('rolled-back')).toMatchObject({ status: 'cancelled', sqliteWrite: { rollbackAcknowledged: true } }); expect(rows.get('not-sent')).toMatchObject({ status: 'cancelled', sqliteWrite: fact('not-sent') });
  expect(JSON.stringify([...rows.values()])).not.toContain('PRIVATE_IMPORT_STORAGE'); for (const row of rows.values()) for (const key of Object.keys(poison)) expect(row).not.toHaveProperty(key);
  const original = reopened.tasks(); reopened.close(); stores.delete(reopened); const again = await f.open(); expect(again.tasks()).toEqual(original); expect(again.settings().tabs).toEqual([]);
});
it('矛盾/缺失导入回执不能被恢复成已完成，也不借其它kind的事实', async () => {
  const f = await fixture(); f.store.saveTask({ ...task('contradiction', 'not-sent'), sqliteWrite: { ...fact('not-sent'), commitAcknowledged: true }, errors: ['PRIVATE_IMPORT_STORAGE'] });
  f.store.saveTask({ ...task('missing', 'committed'), sqliteWrite: undefined }); f.store.close(); stores.delete(f.store); const reopened = await f.open();
  for (const row of reopened.tasks()) { expect(row.status).toBe('failed'); expect(row.sqliteWrite).toBeUndefined(); expect(row.errors).toBeUndefined(); expect(row.message).toContain('无法核验'); }
});
it('公开四命令严格拒SQL/路径/内部回调/operationId/客户自报源摘要', () => {
  const inspect = { connectionId: 'sqlite-c', database: 'main', table: 'subject', fileToken: 'selected', format: 'csv', encoding: 'utf8', taskId: 'inspect' };
  const apply = { previewId: 'preview', taskId: 'apply', confirmation: 'main.subject' };
  for (const command of ['sqlite.tableImport.inspect', 'sqlite.tableImport.preview', 'sqlite.tableImport.apply', 'sqlite.tableImport.release'] as const) expect(publicCommands[command]).toBe(true);
  expect(commandSchemas['sqlite.tableImport.inspect'].parse(inspect)).toEqual(inspect); expect(commandSchemas['sqlite.tableImport.apply'].parse(apply)).toEqual(apply);
  for (const key of ['filePath', 'operationId', 'recordWriteFact', 'assertCurrent', 'profile', 'sql', 'expectedSource']) { expect(commandSchemas['sqlite.tableImport.inspect'].safeParse({ ...inspect, [key]: 'forged' }).success).toBe(false); expect(commandSchemas['sqlite.tableImport.apply'].safeParse({ ...apply, [key]: 'forged' }).success).toBe(false); }
});
it.each(['running', 'completed', 'failed', 'cancelled'] as const)('导入三阶段任务%s概要固定脱敏，不保存原生失败信息及源内容', status => {
  for (const command of ['sqlite.tableImport.inspect', 'sqlite.tableImport.preview', 'sqlite.tableImport.apply'] as const) {
    const message = persistedTaskMessage(command, { taskId: 'task', status, progress: 20, message: 'PRIVATE_IMPORT_STORAGE D:/private/source.csv INSERT secret' });
    expect(message).toContain('SQLite'); for (const marker of ['PRIVATE_IMPORT_STORAGE', 'source.csv', 'INSERT secret']) expect(message).not.toContain(marker);
  }
});
