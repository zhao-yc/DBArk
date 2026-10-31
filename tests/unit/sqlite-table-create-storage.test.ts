import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { LocalStore } from '../../src/main/storage';
import type { TaskRecord } from '../../src/shared/contracts';
import type { SqliteTableCreateFact } from '../../src/shared/sqliteTableCreate';
import { commandSchemas } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'), directories: string[] = [], stores = new Set<LocalStore>();
afterEach(context => {
  for (const store of stores) store.close(); stores.clear();
  if (context.task.result?.state === 'fail') return;
  for (const directory of directories.splice(0)) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-create-storage-')).toBe(true); rmSync(directory, { recursive: true }); }
});
/** 本机独占配置库，不包含目标数据库、用户凭据或任何真实连接。 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-create-storage-')); directories.push(directory); const path = join(directory, 'local.sqlite');
  const open = async () => { const store = await LocalStore.open(path, wasm, { available: () => false, encrypt: () => '', decrypt: value => value }); stores.add(store); return store; };
  return { open, store: await open() };
}
function fact(phase: SqliteTableCreateFact['phase']): SqliteTableCreateFact {
  return { operationId: '73281cd2-fa41-409a-b40a-932d77f06128', target: { connectionId: 'synthetic-connection', database: 'main', table: 'subject' }, phase, requestedStatements: 2, completedStatements: phase === 'not-sent' ? 0 : 2, commitMayHaveBeenSent: ['commit-pending', 'committed', 'unknown'].includes(phase), commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back' };
}
function task(id: string, phase: SqliteTableCreateFact['phase']): TaskRecord {
  return { id, kind: 'sqlite.tableCreate.apply', status: 'running', progress: 40, message: '旧概要', startedAt: '2026-11-01T00:00:00.000Z', sqliteCreate: fact(phase) };
}
it('真实配置库重启优先恢复COMMIT ACK，在途均未知；回滚和not-sent不自动重试', async () => {
  const f = await fixture();
  const poison = { design: { name: 'PRIVATE_CREATE_STORAGE_921' }, sql: 'CREATE TABLE PRIVATE_CREATE_STORAGE_921', errors: ['PRIVATE_CREATE_STORAGE_921'], filePath: 'D:\\private\\source.sqlite' };
  for (const phase of ['committed', 'commit-pending', 'writing', 'rolled-back', 'not-sent'] as const) f.store.saveTask({ ...task(phase, phase), ...(['rolled-back', 'not-sent'].includes(phase) ? { status: 'cancelled' as const } : {}), ...poison });
  f.store.close(); stores.delete(f.store); const reopened = await f.open(), rows = new Map(reopened.tasks().map(value => [value.id, value]));
  expect(rows.size).toBe(5); expect(rows.get('committed')?.status).toBe('completed'); expect(rows.get('committed')?.progress).toBe(100); expect(rows.get('committed')?.sqliteCreate?.commitAcknowledged).toBe(true);
  for (const phase of ['writing', 'commit-pending']) { expect(rows.get(phase)?.status).toBe('failed'); expect(rows.get(phase)?.sqliteCreate?.phase).toBe('unknown'); expect(rows.get(phase)?.message).toContain('禁止重复'); }
  expect(rows.get('rolled-back')?.status).toBe('cancelled'); expect(rows.get('rolled-back')?.sqliteCreate?.rollbackAcknowledged).toBe(true); expect(rows.get('not-sent')?.status).toBe('cancelled');
  for (const row of rows.values()) { expect(row).not.toHaveProperty('design'); expect(row).not.toHaveProperty('sql'); expect(row).not.toHaveProperty('errors'); expect(row).not.toHaveProperty('filePath'); }
  expect(JSON.stringify([...rows.values()])).not.toContain('PRIVATE_CREATE_STORAGE_921');
  // 这里只证明可读记录脱敏，不冒称已有损坏数据在SQLite空闲页上已做安全擦除。
  const original = reopened.tasks(); reopened.close(); stores.delete(reopened); const again = await f.open(); expect(again.tasks()).toEqual(original); expect(again.settings().tabs).toEqual([]);
});
it('矛盾/缺失建表回执不会在重启伪造完成或继承额外字段', async () => {
  const f = await fixture();
  f.store.saveTask({ ...task('contradiction', 'not-sent'), sqliteCreate: { ...fact('not-sent'), commitAcknowledged: true } });
  f.store.saveTask({ ...task('missing', 'committed'), sqliteCreate: undefined, errors: ['PRIVATE_CREATE_STORAGE_921'] });
  f.store.close(); stores.delete(f.store); const reopened = await f.open();
  for (const row of reopened.tasks()) { expect(row.status).toBe('failed'); expect(row.sqliteCreate).toBeUndefined(); expect(row.message).toContain('无法核验'); expect(row.errors).toBeUndefined(); }
});
it('新公开命令无SQL/路径/回调/operationId权限，完整Main内部能力不能从preload输入伪造', () => {
  const input = { previewId: 'preview', taskId: 'task', confirmation: 'main.subject' };
  for (const command of ['sqlite.tableCreate.preview', 'sqlite.tableCreate.apply', 'sqlite.tableCreate.release'] as const) expect(publicCommands[command]).toBe(true);
  expect(commandSchemas['sqlite.tableCreate.apply'].parse(input)).toEqual(input);
  for (const key of ['operationId', 'recordCreateFact', 'assertCurrent', 'filePath', 'profile', 'sql', 'target']) expect(commandSchemas['sqlite.tableCreate.apply'].safeParse({ ...input, [key]: 'forged' }).success).toBe(false);
  expect(commandSchemas['sqlite.tableCreate.release'].safeParse({ previewId: 'preview', connectionId: 'forged' }).success).toBe(false);
});
it.each(['running', 'completed', 'failed', 'cancelled'] as const)('任务%s仅保存固定说明，不保存原驱动错误/SQL/默认值/文件路径', status => {
  for (const command of ['sqlite.tableCreate.preview', 'sqlite.tableCreate.apply']) {
    const message = persistedTaskMessage(command, { taskId: 'task', status, progress: 10, message: "PRIVATE_CREATE_STORAGE_921 D:\\private\\source.sqlite CREATE TABLE secret" });
    expect(message).toContain('SQLite'); for (const marker of ['PRIVATE_CREATE_STORAGE_921', 'source.sqlite', 'CREATE TABLE']) expect(message).not.toContain(marker);
  }
});
