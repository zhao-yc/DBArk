import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { LocalStore } from '../../src/main/storage';
import type { TaskRecord } from '../../src/shared/contracts';
import type { SqliteWriteFact } from '../../src/shared/sqliteTableEdit';
const require = createRequire(import.meta.url), directories: string[] = [];
afterEach(context => { if (context.task.result?.state === 'fail') return; for (const dir of directories.splice(0)) { expect(dirname(resolve(dir))).toBe(resolve(tmpdir())); expect(basename(dir).startsWith('dbark-sqlite-write-store-')).toBe(true); rmSync(dir, { recursive: true, force: true }); } });
/** 只打开本例新SQLite配置文件，凭据端口任何调用即失败，不读取开发者资料。 */
const open = (path: string) => LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), { available: () => false, encrypt: () => { throw Error('不涉及凭据'); }, decrypt: () => { throw Error('不涉及凭据'); } });
describe('SQLite修改任务真实持久化恢复', () => {
  it('真实重开保留commit/rollback事实，COMMIT在途为unknown，清理旧错误原文且不重放', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbark-sqlite-write-store-')); directories.push(dir); const path = join(dir, 'dbark.sqlite'), store = await open(path);
    const base: SqliteWriteFact = { operationId: '00000000-0000-4000-8000-000000000001', target: { connectionId: '本例连接', database: 'main', table: 'subject' }, phase: 'not-sent', requestedRows: 2, appliedRows: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false };
    for (const phase of ['committed', 'rolled-back', 'commit-pending', 'writing'] as const) {
      const fact: SqliteWriteFact = { ...base, phase, appliedRows: phase === 'committed' ? 2 : 1, commitMayHaveBeenSent: phase === 'committed' || phase === 'commit-pending', commitAcknowledged: phase === 'committed', rollbackAcknowledged: phase === 'rolled-back' };
      const task: TaskRecord = { id: phase, kind: 'sqlite.tableEdit.apply', status: 'running', progress: 0, startedAt: new Date().toISOString(), message: '不可保留原SQL及秘密', errors: ['不可保留原SQL及秘密'], sqliteWrite: fact }; store.saveTask(task);
    }
    store.close(); const reopened = await open(path);
    try {
      const tasks = reopened.tasks(); expect(tasks).toHaveLength(4); expect(tasks.find(task => task.id === 'committed')).toMatchObject({ status: 'completed', sqliteWrite: { phase: 'committed', commitAcknowledged: true } }); expect(tasks.find(task => task.id === 'rolled-back')).toMatchObject({ status: 'failed', sqliteWrite: { phase: 'rolled-back', rollbackAcknowledged: true } });
      for (const phase of ['commit-pending', 'writing']) expect(tasks.find(task => task.id === phase)).toMatchObject({ status: 'failed', sqliteWrite: { phase: 'unknown', commitAcknowledged: false } });
      expect(JSON.stringify(tasks)).not.toContain('不可保留'); expect(tasks.every(task => !Object.hasOwn(task, 'errors'))).toBe(true);
    } finally { reopened.close(); }
  });
});
