import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import { TableApplyReceipts } from '../../src/main/tableApplyReceipts';
import { emptyTableApplyEvidence, type TableApplyReceipt } from '../../src/shared/tableApplyReceipt';
const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const protector = { available: () => false, encrypt: () => '', decrypt: () => '' }, dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function open() { const dir = mkdtempSync(join(tmpdir(), 'dbark-receipt-')); dirs.push(dir); const file = join(dir, 'receipt.sqlite'); return { file, store: await LocalStore.open(file, wasm, protector) }; }
function receipt(patch: Partial<TableApplyReceipt> = {}): TableApplyReceipt {
  return { version: 1, operationId: randomUUID(), taskId: randomUUID(), previewId: randomUUID(), target: { connectionId: 'connection', connectionRevision: 1, database: 'db', table: 'subject' }, intent: { insert: 1, update: 0, delete: 0, statementCount: 1 }, phase: 'dispatching', outcome: null, reason: 'none', startedAt: new Date().toISOString(), sequence: 0, committedReportedRows: null, scope: 'target-transaction-only', evidence: emptyTableApplyEvidence(), ...patch };
}
describe('独立SQLite提交回执的恢复、容量与原子故障', () => {
  it('重启恢复全部页面的执行中记录为unknown，prepared为not-sent，不执行或补造旧历史', async () => {
    const { file, store } = await open();
    for (let i = 0; i < 27; i++) store.saveTableApplyReceipt(receipt());
    const prepared = receipt({ phase: 'prepared' }); store.saveTableApplyReceipt(prepared);
    store.saveTask({ id: 'old', kind: 'table.apply', status: 'completed', progress: 100, message: '合成旧敏感字面量', errors: ['合成旧敏感字面量'], startedAt: new Date().toISOString() });
    store.close(); const next = await LocalStore.open(file, wasm, protector);
    expect(next.tableApplyReceipts({ outcome: 'unknown' }).total).toBe(27); expect(next.tableApplyReceipt(prepared.operationId).outcome).toBe('not-sent');
    expect(next.history()).toEqual([]); expect(next.tasks()).toHaveLength(1); expect(JSON.stringify(next.tasks())).not.toContain('合成旧敏感字面量'); expect(next.tableApplyReceipts({ page: 1 }).items).toHaveLength(3); next.close();
  });
  it('200个unknown/运行中不能淘汰，新意图保存失败且既有记录保持', async () => {
    const { store } = await open();
    for (let i = 0; i < 200; i++) store.saveTableApplyReceipt(receipt());
    expect(() => store.saveTableApplyReceipt(receipt())).toThrow('记录已满'); expect(store.tableApplyReceipts({}).total).toBe(200); store.close();
  });
  it('只淘汰已知终态，普通200任务不会挤掉提交；排序及筛选稳定', async () => {
    const { store } = await open(), old = receipt({ phase: 'terminal', outcome: 'not-sent', committedReportedRows: 0, finishedAt: new Date().toISOString(), startedAt: '2026-01-01T00:00:00.000Z' }); store.saveTableApplyReceipt(old);
    for (let i = 0; i < 199; i++) store.saveTableApplyReceipt(receipt()); store.saveTableApplyReceipt(receipt());
    expect(() => store.tableApplyReceipt(old.operationId)).toThrow('不存在'); expect(store.tableApplyReceipts({}).total).toBe(200);
    for (let i = 0; i < 205; i++) store.saveTask({ id: String(i), kind: 'metadata', status: 'completed', progress: 100, message: '概要', startedAt: new Date().toISOString() });
    expect(store.tasks()).toHaveLength(200); expect(store.tableApplyReceipts({ connectionId: 'connection' }).total).toBe(200); expect(store.tableApplyReceipts({ connectionId: 'other' }).total).toBe(0); store.close();
  });
  it('本地写盘失败恢复内存及磁盘；最终提交结果不因记录失败变成DB失败', async () => {
    const { store, file } = await open(), service = new TableApplyReceipts(store), target = { connectionId: 'c', connectionRevision: 1, database: 'db', table: 'subject' }, changes = [{ kind: 'insert' as const, values: { x: '合成私密值' } }];
    const p = service.preview(target, changes, { sql: '合成私密SQL', statements: [{ sql: '合成私密SQL', params: ['合成私密值'] }], warnings: [] });
    const b = service.prepare('task', p.previewId, target, changes), before = readFileSync(file); mkdirSync(file + '.tmp');
    service.receive('task', { operationId: b.operationId, sequence: 1, phase: 'terminal', reason: 'none', evidence: { ...emptyTableApplyEvidence(), dmlMayHaveBeenSent: true, dmlAcknowledged: 1, serverReportedRows: 1, commitMayHaveBeenSent: true, commitAcknowledged: true, transactionProtected: true, transactionKnown: true } });
    expect(service.finish('task')).toMatchObject({ receiptSaved: false }); expect(readFileSync(file)).toEqual(before); expect(store.tableApplyReceipt(b.operationId).phase).toBe('dispatching');
    rmdirSync(file + '.tmp'); store.close(); const next = await LocalStore.open(file, wasm, protector); expect(next.tableApplyReceipt(b.operationId).outcome).toBe('unknown'); expect(JSON.stringify(next.tableApplyReceipts({}))).not.toContain('合成私密'); next.close();
  });
  it('初始持久化被阻断不能取得绑定，磁盘不夹带失败意图', async () => {
    const { store, file } = await open(), service = new TableApplyReceipts(store), target = { connectionId: 'c', connectionRevision: 1, database: 'db', table: 't' }, changes = [{ kind: 'insert' as const, values: { x: 1 } }], p = service.preview(target, changes, { sql: '仅RAM', statements: [{ sql: '仅RAM', params: [] }], warnings: [] });
    const before = readFileSync(file); mkdirSync(file + '.tmp'); expect(() => service.prepare('task', p.previewId, target, changes)).toThrow('保存失败'); expect(store.tableApplyReceipts({}).total).toBe(0); expect(readFileSync(file)).toEqual(before); rmdirSync(file + '.tmp'); store.close();
  });
  it('schema5无损迁移至8；未来版本拒绝且原文件不改写', async () => {
    const { store, file } = await open(); store.addHistory({ id: 'history', connectionId: 'old', sql: 'SELECT 1', success: true, elapsedMs: 1, startedAt: new Date().toISOString() }); store.close();
    const SQL = await initSqlJs({ locateFile: () => wasm }), old = new SQL.Database(readFileSync(file)); const history = old.exec('SELECT * FROM history'); old.run('DROP TABLE table_apply_receipts; PRAGMA user_version=5'); writeFileSync(file, old.export()); old.close();
    const upgraded = await LocalStore.open(file, wasm, protector); expect(upgraded.history()[0].sql).toBe('SELECT 1'); upgraded.close();
    const future = new SQL.Database(readFileSync(file)); expect(future.exec('PRAGMA user_version')[0].values[0][0]).toBe(9); expect(future.exec('SELECT * FROM history')).toEqual(history); future.run('PRAGMA user_version=10'); writeFileSync(file, future.export()); future.close();
    const before = readFileSync(file); await expect(LocalStore.open(file, wasm, protector)).rejects.toThrow('更新版本'); expect(readFileSync(file)).toEqual(before);
  });
  it('持久ACK恢复时通用任务也保持完成，仅按main回执编号关联而不按可复用taskId猜测', async () => {
    const { store, file } = await open(), r = receipt({ phase: 'committing', evidence: { ...emptyTableApplyEvidence(), dmlMayHaveBeenSent: true, dmlAcknowledged: 1, serverReportedRows: 1, commitMayHaveBeenSent: true, commitAcknowledged: true, transactionProtected: true, transactionKnown: true } });
    store.saveTableApplyReceipt(r); store.saveTask({ id: r.taskId, tableApplyReceiptId: r.operationId, kind: 'table.apply', status: 'running', progress: 90, message: '合成敏感旧错误', startedAt: r.startedAt });
    const old = receipt({ taskId: 'reused', phase: 'terminal', outcome: 'committed', committedReportedRows: 1, evidence: { ...r.evidence } }); store.saveTableApplyReceipt(old); store.saveTask({ id: 'reused', kind: 'table.apply', status: 'running', progress: 0, message: '旧概要', startedAt: new Date().toISOString() });
    store.close(); const next = await LocalStore.open(file, wasm, protector);
    expect(next.tableApplyReceipt(r.operationId).outcome).toBe('committed'); expect(next.tasks().find(t => t.id === r.taskId)?.status).toBe('completed'); expect(next.tasks().find(t => t.id === 'reused')?.status).toBe('failed'); expect(JSON.stringify(next.tasks())).not.toContain('合成敏感'); next.close();
  });
});
