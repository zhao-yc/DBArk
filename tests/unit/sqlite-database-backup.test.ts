import { fork } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSqliteWorker } from '../helpers/buildSqliteWorker';
import { sqliteBackupFileIdentity } from '../../src/engine/sqlite/backup';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import { closeSqliteDatabaseCopies, publishSqliteDatabaseCopy } from '../../src/main/sqliteDatabaseBackup';
import { validateCommand } from '../../src/shared/validation';

vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('本例必须使用真实 Node SQLite 子进程'); } } }));
let bundle: string, worker: string, directory: string, source: string, target: string, writer: DatabaseSync;

beforeAll(async () => {
  bundle = mkdtempSync(join(tmpdir(), 'dbark-sqlite-backup-worker-'));
  worker = join(bundle, 'worker.cjs');
  await buildSqliteWorker({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, platform: 'node', packages: 'external', format: 'cjs' });
});
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-backup-test-'));
  source = join(directory, '原库.sqlite'); target = join(directory, '副本.sqlite');
  writer = new DatabaseSync(source);
  writer.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA user_version=42;
    CREATE TABLE ledger(id INTEGER PRIMARY KEY, payload BLOB, note TEXT);
    CREATE INDEX ledger_note ON ledger(note);
    CREATE VIEW ledger_view AS SELECT * FROM ledger;
    CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, '保留记录'); END;
    INSERT INTO ledger VALUES(9223372036854775807, X'00FF80', NULL);`);
});
afterEach(async context => {
  await closeSqliteDatabaseCopies();
  writer.close();
  if (context.task.result?.state !== 'fail') rmSync(directory, { recursive: true, force: true });
});
afterAll(() => { rmSync(bundle, { recursive: true, force: true }); });

function createTransport(observe?: (message: SqliteWorkerResponse) => void): SqliteProcessTransport {
  const child = fork(worker, [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = new Promise<SqliteProcessExit>(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  return {
    send: message => { child.send(message, error => { if (error) child.kill(); }); },
    onMessage: listener => {
      const receive = (message: SqliteWorkerResponse) => { observe?.(message); listener(message); };
      child.on('message', receive); return () => child.off('message', receive);
    },
    terminate: () => child.kill(), exited,
  };
}
function copy(from = source, to = target, signal = new AbortController().signal, observe?: (message: SqliteWorkerResponse) => void) {
  return publishSqliteDatabaseCopy(sqliteBackupFileIdentity(from), to, { assertOwner() {}, signal, createTransport: () => createTransport(observe) });
}
function assertRestorable(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
    expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('delete');
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(42);
    expect(db.prepare('SELECT CAST(id AS TEXT) AS id, hex(payload) AS payload, note FROM ledger_view').all())
      .toEqual([{ id: '9223372036854775807', payload: '00FF80', note: null }]);
    expect(db.prepare('SELECT name FROM sqlite_schema WHERE type IN (\'index\', \'trigger\') ORDER BY name').all())
      .toEqual([{ name: 'ledger_no_delete' }, { name: 'ledger_note' }]);
  } finally { db.close(); }
}

describe('SQLite 整库备份与恢复', () => {
  it('经真实进程往返已提交 WAL、索引、视图和触发器，排除未提交行', async () => {
    const restored = join(directory, '恢复.sqlite');
    expect(existsSync(source + '-wal')).toBe(true);
    writer.exec('BEGIN IMMEDIATE; INSERT INTO ledger VALUES(1, NULL, \'未提交\')');
    expect(await copy()).toEqual({ name: '副本.sqlite', cleanupPending: false });
    assertRestorable(target);
    expect(await copy(target, restored)).toEqual({ name: '恢复.sqlite', cleanupPending: false });
    assertRestorable(restored);
    expect(writer.prepare('SELECT count(*) AS n FROM ledger').get()?.n).toBe(2);
    writer.exec('ROLLBACK');
    expect(readdirSync(directory).sort()).toEqual(['副本.sqlite', '原库.sqlite', '原库.sqlite-shm', '原库.sqlite-wal', '恢复.sqlite'].sort());
  });

  it('目标在完整性确认后被占用时保留竞争者，日志路径也不会覆盖', async () => {
    await expect(copy(source, target, undefined, message => {
      if (message.kind === 'backupFileFinished') writeFileSync(target, '其他进程的原件', { flag: 'wx' });
    })).rejects.toThrow('已存在');
    expect(readFileSync(target, 'utf8')).toBe('其他进程的原件');
    const unused = join(directory, '日志冲突.sqlite');
    writeFileSync(unused + '-wal', '外部日志');
    await expect(copy(source, unused)).rejects.toThrow('日志已存在');
    expect(existsSync(unused)).toBe(false);
    expect(readFileSync(unused + '-wal', 'utf8')).toBe('外部日志');
    expect(readdirSync(directory).some(name => name.startsWith('.dbark-sqlite-copy-'))).toBe(false);
  });

  it('收到真实成功回执但发布前取消时不创建目标，非法库也不发布', async () => {
    const abort = new AbortController();
    await expect(copy(source, target, abort.signal, message => {
      if (message.kind === 'backupFileFinished') abort.abort();
    })).rejects.toThrow('已取消');
    const invalid = join(directory, 'invalid.sqlite');
    writeFileSync(invalid, '不是 SQLite 数据库');
    await expect(copy(invalid)).rejects.toThrow('完整性检查失败');
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(directory).some(name => name.startsWith('.dbark-sqlite-copy-'))).toBe(false);
  });

  it('渲染 IPC 只接收已保存连接标识或恢复意图，拒绝任意来源和目标路径', () => {
    expect(validateCommand('sqlite.databaseCopy', { mode: 'backup', connectionId: 'saved-sqlite' })).toEqual({ mode: 'backup', connectionId: 'saved-sqlite' });
    expect(validateCommand('sqlite.databaseCopy', { mode: 'restore' })).toEqual({ mode: 'restore' });
    expect(() => validateCommand('sqlite.databaseCopy', { mode: 'restore', path: source })).toThrow();
    expect(() => validateCommand('sqlite.databaseCopy', { mode: 'backup', connectionId: 'saved-sqlite', destination: target })).toThrow();
  });
});
