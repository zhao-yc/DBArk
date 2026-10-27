import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionProfile, TableInfo, TaskEvent } from '../../src/shared/contracts';
import { fileImportConflictReportSchema, type FileImportConflictSelection } from '../../src/shared/fileImportConflict';
const io = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), metadata: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: io.connect, execute: io.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: io.metadata }));
import { Engine } from '../../src/engine';
import { ConnectionResourceOwner } from '../../src/engine/connectionResourceState';

const profile: ConnectionProfile = { id: 'conflict-offline', name: '离线', dialect: 'mysql', host: 'never.invalid', port: 1, user: 'none', group: '', color: '#123456' };
const target = { connectionId: profile.id, database: 'isolated', table: 'target' };
const info: TableInfo = { database: target.database, name: target.table, objectKind: 'table', engine: 'InnoDB', columns: [{ name: 'id', type: 'varchar(20)', nullable: false, generated: false, extra: '', defaultValue: null, comment: '', characterSet: 'utf8mb4' }, { name: 'value', type: 'varchar(20)', nullable: false, generated: false, extra: '', defaultValue: null, comment: '', characterSet: 'utf8mb4' }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], ddl: 'CREATE TABLE `target` (`id` varchar(20) NOT NULL, `value` varchar(20) NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' };
let engine: Engine, folder: string, events: TaskEvent[], matched: boolean;
let step: ((managed: any, sql: string, values: any[]) => unknown | Promise<unknown>) | undefined;
/** 网络与目录为边界替身；正式Engine、文件读取、事务及策略调度均真实运行。 */
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'dbark-conflict-')); events = []; matched = true; step = undefined;
  io.connect.mockReset().mockImplementation(async (_profile, _database, signal?: AbortSignal, capture?: (value: unknown) => void) => {
    const stream = Object.assign(new EventEmitter(), { closed: false, destroy(this: EventEmitter & { closed: boolean }) { this.closed = true; this.emit('close'); } });
    const connection = Object.assign(new EventEmitter(), { threadId: 42, stream, destroy: () => stream.destroy() });
    const owner = new ConnectionResourceOwner(() => stream, () => stream.destroy()); owner.captureTransport(true); owner.seal(); capture?.(owner.recovery);
    const managed: any = { profile, connection, signal, resources: owner.recovery, broken: false, sqlMode: '', serverStatus: 2, physicalStatus: 2, transactionStateKnown: true, status: { dialect: 'mysql', version: '8.4.11' }, close: vi.fn(async () => stream.destroy()) };
    Object.assign(connection, { query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) { void io.execute(managed, sql).then((result: { rows: unknown; fields: unknown[] }) => callback(null, result.rows, result.fields), (error: Error) => callback(error)); } });
    signal?.addEventListener('abort', () => stream.destroy(), { once: true }); if (signal?.aborted) stream.destroy();
    return managed;
  });
  io.metadata.mockReset().mockImplementation(async () => structuredClone(info));
  io.execute.mockReset().mockImplementation(async (managed, sql: string, values: any[] = []) => {
    if (sql === 'START TRANSACTION') managed.physicalStatus = 3;
    if (sql === 'COMMIT' || sql === 'ROLLBACK') managed.physicalStatus = 2;
    managed.serverStatus = managed.physicalStatus; managed.transactionStateKnown = true;
    managed.connection.emit('dbark:session-state', { sql, serverStatus: managed.serverStatus, warningStatus: 0 });
    const overridden = await step?.(managed, sql, values); if (overridden !== undefined) return overridden;
    if (sql.includes("TABLE_NAME = 'STATISTICS'")) return { rows: ['INDEX_NAME', 'COLUMN_NAME', 'SEQ_IN_INDEX', 'NON_UNIQUE', 'INDEX_TYPE', 'COLLATION', 'SUB_PART', 'INDEX_COMMENT', 'EXPRESSION', 'IS_VISIBLE'].map(COLUMN_NAME => ({ COLUMN_NAME })), fields: [] };
    if (sql.includes('FROM information_schema.STATISTICS')) return { rows: [{ INDEX_NAME: 'PRIMARY', COLUMN_NAME: 'id', SEQ_IN_INDEX: 1, NON_UNIQUE: 0, INDEX_TYPE: 'BTREE', COLLATION: 'A', SUB_PART: null, INDEX_COMMENT: '', EXPRESSION: null, IS_VISIBLE: 'YES' }], fields: [] };
    if (/^SELECT 1 FROM .* LIMIT 0$/.test(sql)) return { rows: [], fields: [] };
    if (/FOR UPDATE$/.test(sql)) return { rows: matched ? [{ present: 1 }] : [], fields: [] };
    return { rows: { affectedRows: /^(?:INSERT|UPDATE)/.test(sql) ? 1 : 0, warningStatus: 0, serverStatus: managed.serverStatus }, fields: [] };
  });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { await engine.closeAll(); await rm(folder, { recursive: true, force: true }); });
/** 使用真实候选目录的摘要和完整键，而非手工拼造可通过的选择配置。 */
async function run(mode: FileImportConflictSelection['mode'], options: Record<string, unknown> = {}, source = 'id,value\nabc,new\n') {
  const catalog = await engine.handle('files.importKeys', { ...target, taskId: 'keys' });
  const filePath = join(folder, 'source.csv'); await writeFile(filePath, source);
  const result = await engine.handle('files.import', { ...target, filePath, format: 'csv', encoding: 'utf8', taskId: 'import', mapping: { id: 'id', value: 'value' }, conflict: { mode, schemaHash: catalog.schemaHash, key: { name: 'PRIMARY', columns: ['id'] } }, ...options });
  fileImportConflictReportSchema.parse(result.conflicts); return result;
}

describe('CSV/JSON显式冲突策略正式入口旧缺项', () => {
  it('候选目录只返回可证明的完整主键和稳定摘要', async () => {
    const first = await engine.handle('files.importKeys', { ...target, taskId: 'first' });
    const second = await engine.handle('files.importKeys', { ...target, taskId: 'second' });
    expect(first).toMatchObject({ ...target, keys: [{ name: 'PRIMARY', columns: ['id'], reliable: true }] });
    expect(first.schemaHash).toMatch(/^[a-f0-9]{64}$/); expect(second.schemaHash).toBe(first.schemaHash);
  });
  it('跳过已存在只做真实锁定匹配，不能发送旧INSERT', async () => {
    const result = await run('skip-existing');
    expect(result.conflicts).toMatchObject({ termination: 'completed', readRecords: 1, committed: { inserted: 0, matchedUpdates: 0, skippedExisting: 1, skippedMissing: 0 } });
    expect(io.execute.mock.calls.some(([, sql]) => /^INSERT/.test(sql))).toBe(false);
    expect(io.execute.mock.calls.some(([, sql]) => /FOR UPDATE$/.test(sql))).toBe(true);
  });
  it('仅更新未匹配行应跳过，不能退化成新增', async () => {
    matched = false; const result = await run('update-existing');
    expect(result.conflicts).toMatchObject({ termination: 'completed', committed: { inserted: 0, matchedUpdates: 0, skippedExisting: 0, skippedMissing: 1 } });
    expect(io.execute.mock.calls.some(([, sql]) => /^(?:INSERT|UPDATE)/.test(sql))).toBe(false);
  });
});

describe('匹配键写入、事务与回执边界', () => {
  it.each(['[{"id":"abc","value":true}]', '[{"id":"abc"}]'])('跳过已有不读取不会写入的坏值或缺失payload：%s', async source => {
    const result = await run('skip-existing', { format: 'json' }, source);
    expect(result.conflicts).toMatchObject({ termination: 'completed', readRecords: 1, committed: { skippedExisting: 1 } });
    expect(io.execute.mock.calls.some(([, sql]) => /^(?:INSERT|UPDATE)/.test(sql))).toBe(false);
  });
  it.each(['[{"id":"abc","value":true}]', '[{"id":"abc"}]'])('仅更新未匹配不读取无用payload：%s', async source => {
    matched = false; const result = await run('update-existing', { format: 'json' }, source);
    expect(result.conflicts).toMatchObject({ termination: 'completed', readRecords: 1, committed: { skippedMissing: 1 } });
    expect(io.execute.mock.calls.some(([, sql]) => /^(?:INSERT|UPDATE)/.test(sql))).toBe(false);
  });
  it.each(['upsert', 'update-existing'] as const)('%s匹配需要UPDATE时坏payload仍在record阶段拒绝', async mode => {
    const result = await run(mode, { format: 'json' }, '[{"id":"abc","value":true}]');
    expect(result.conflicts).toMatchObject({ termination: 'failed', readRecords: 1, currentBatch: 'rolled-back', failure: { stage: 'record', record: 1 } });
    expect(result.conflicts?.acknowledged.matchedUpdates).toBe(0); expect(io.execute.mock.calls.some(([, sql]) => /^(?:INSERT|UPDATE)/.test(sql))).toBe(false);
  });
  it.each(['upsert', 'update-existing'] as const)('%s保留JSON数字原token文本，不误拒合法文本更新', async mode => {
    // JSON数字由共同读取器保留原token文本；布尔值才会触发文本列的类型拒绝。
    const result = await run(mode, { format: 'json' }, '[{"id":"abc","value":123}]');
    expect(result.conflicts).toMatchObject({ termination: 'completed', committed: { matchedUpdates: 1 } });
    const update = io.execute.mock.calls.find(([, sql]) => /^UPDATE/.test(sql));
    expect(update?.[2]?.[0]).toBe('123');
    expect(typeof update?.[2]?.[0]).toBe('string');
  });
  it.each(['upsert', 'skip-existing'] as const)('%s未匹配需要INSERT时缺失payload仍拒绝', async mode => {
    matched = false; const result = await run(mode, { format: 'json' }, '[{"id":"abc"}]');
    expect(result.conflicts).toMatchObject({ termination: 'failed', readRecords: 1, currentBatch: 'rolled-back', failure: { stage: 'record', record: 1 } });
    expect(result.conflicts?.acknowledged.inserted).toBe(0); expect(io.execute.mock.calls.some(([, sql]) => /^(?:INSERT|UPDATE)/.test(sql))).toBe(false);
  });
  it('建连期取消命中原编号，迟到连接不能读取文件或发送DML，严格关闭后才释放', async () => {
    const catalog = await engine.handle('files.importKeys', { ...target, taskId: 'keys' });
    const factory = io.connect.getMockImplementation()!; let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
    let signal: AbortSignal | undefined, late: any;
    io.connect.mockImplementationOnce(async (...args: any[]) => { signal = args[2]; entered(); await gate; late = await factory(...args); return late; });
    io.execute.mockClear();
    const input = { ...target, taskId: 'connecting', format: 'csv', filePath: join(folder, '尚不存在的文件.csv'), encoding: 'utf8', mapping: { id: 'id', value: 'value' }, conflict: { mode: 'upsert', schemaHash: catalog.schemaHash, key: { name: 'PRIMARY', columns: ['id'] } } };
    const pending = engine.handle('files.import', input); await ready;
    const cancelled = engine.handle('query.cancel', { taskId: 'connecting' }); expect(signal?.aborted).toBe(true);
    await expect(engine.handle('files.import', input)).rejects.toThrow('编号');
    release(); const result = await pending; await cancelled;
    fileImportConflictReportSchema.parse(result.conflicts);
    expect(result.conflicts).toMatchObject({ termination: 'cancelled', readRecords: 0, currentBatch: 'none', failure: { stage: 'prepare-batch' } });
    expect(io.execute).not.toHaveBeenCalled(); expect(late.close).toHaveBeenCalledWith({ strict: true });
    expect((engine as any).conflictImports.size).toBe(0); expect((engine as any).tasks.size).toBe(0);
  });
  it('closeAll在新策略建连期取消并等待原迟到连接严格收尾', async () => {
    const catalog = await engine.handle('files.importKeys', { ...target, taskId: 'keys' });
    const factory = io.connect.getMockImplementation()!; let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; }); let signal: AbortSignal | undefined;
    io.connect.mockImplementationOnce(async (...args: any[]) => { signal = args[2]; entered(); await gate; return factory(...args); });
    io.execute.mockClear();
    const pending = engine.handle('files.import', { ...target, taskId: 'connecting', format: 'csv', filePath: join(folder, '不存在.csv'), encoding: 'utf8', mapping: { id: 'id', value: 'value' }, conflict: { mode: 'upsert', schemaHash: catalog.schemaHash, key: { name: 'PRIMARY', columns: ['id'] } } });
    await ready; let closed = false; const closing = engine.closeAll().then(() => { closed = true; }); expect(signal?.aborted).toBe(true); expect(closed).toBe(false);
    release(); const result = await pending; await closing;
    expect(result.conflicts).toMatchObject({ termination: 'cancelled', readRecords: 0 }); expect(io.execute).not.toHaveBeenCalled(); expect((engine as any).conflictImports.size).toBe(0);
  });
  it('目录读取在建连前登记，取消迟到连接后不发布候选或发送目录SQL', async () => {
    const factory = io.connect.getMockImplementation()!; let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; }); let signal: AbortSignal | undefined;
    io.connect.mockImplementationOnce(async (...args: any[]) => { signal = args[2]; entered(); await gate; return factory(...args); });
    io.execute.mockClear();
    const pending = engine.handle('files.importKeys', { ...target, taskId: 'late-keys' }); const rejected = expect(pending).rejects.toThrow();
    await ready; const cancelled = engine.handle('query.cancel', { taskId: 'late-keys' }); expect(signal?.aborted).toBe(true);
    release(); await rejected; await cancelled;
    expect(io.execute).not.toHaveBeenCalled(); expect((engine as any).independentTasks.size).toBe(0);
    expect(await engine.handle('files.importKeys', { ...target, taskId: 'late-keys' })).toMatchObject({ ...target, keys: [{ reliable: true }] });
  });
  it('目录动作完成仍等原物理资源关闭，不能提前发布或复用目录任务编号', async () => {
    const factory = io.connect.getMockImplementation()!; let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), closing = new Promise<void>(resolve => { entered = resolve; });
    io.connect.mockImplementationOnce(async (...args: any[]) => {
      const managed = await factory(...args), close = managed.close.getMockImplementation();
      managed.close.mockImplementation(async (...values: any[]) => { entered(); await gate; return close(...values); }); return managed;
    });
    const pending = engine.handle('files.importKeys', { ...target, taskId: 'closing-keys' }); let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    try { await closing; expect(settled).toBe(false); await expect(engine.handle('files.importKeys', { ...target, taskId: 'closing-keys' })).rejects.toThrow('编号'); }
    finally { release(); await pending; }
    expect((engine as any).independentTasks.size).toBe(0);
  });
  it('UPDATE后取消仍保留ACK分类并回滚当前批，失败控制收尾不能泄漏任务', async () => {
    step = (_managed, sql) => {
      if (/^UPDATE/.test(sql)) { const task = (engine as any).tasks.get('import'); task.cancelled = true; task.cancelPending = Promise.reject(Error('控制连接收尾失败')); void task.cancelPending.catch(() => undefined); }
    };
    const result = await run('upsert');
    expect(result.conflicts).toMatchObject({ termination: 'cancelled', acknowledged: { matchedUpdates: 1 }, committed: { matchedUpdates: 0 }, currentBatch: 'rollback-unconfirmed' });
    expect(result.conflicts?.cleanupWarning).toBeTruthy(); expect((engine as any).tasks.size).toBe(0); expect((engine as any).conflictImports.size).toBe(0); expect(events.at(-1)?.status).toBe('cancelled');
  });
  it('COMMIT已发送但ACK未知不得再ROLLBACK或重新执行UPDATE', async () => {
    step = (_managed, sql) => { if (sql === 'COMMIT') throw Error('合成COMMIT ACK丢失'); };
    const result = await run('upsert'); expect(result.conflicts).toMatchObject({ termination: 'failed', currentBatch: 'commit-unknown', acknowledged: { matchedUpdates: 1 }, committed: { matchedUpdates: 0 }, failure: { stage: 'commit' } });
    expect(io.execute.mock.calls.filter(([, sql]) => /^UPDATE/.test(sql))).toHaveLength(1);
    expect(io.execute.mock.calls.filter(([, sql]) => sql === 'ROLLBACK')).toHaveLength(1); // 只读候选事务，数据COMMIT后没有补偿回滚。
  });
  it('最终COMMIT发送后取消不KILL，完整ACK仍保留完成事实', async () => {
    step = async (_managed, sql) => { if (sql === 'COMMIT') await engine.handle('query.cancel', { taskId: 'import' }); };
    const result = await run('upsert'); expect(result.conflicts).toMatchObject({ termination: 'completed', committed: { matchedUpdates: 1 } });
    expect(io.execute.mock.calls.some(([, sql]) => /^KILL/.test(sql))).toBe(false);
  });
  it('严格关闭晚失败保留完整提交计数与cleanupWarning', async () => {
    step = (managed, sql) => { if (/^UPDATE/.test(sql)) managed.close.mockRejectedValueOnce(Error('禁止回显的本机路径')); };
    const result = await run('upsert'); expect(result.conflicts).toMatchObject({ termination: 'completed', committed: { matchedUpdates: 1 }, cleanupWarning: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain('禁止回显');
  });
  it('BIT64匹配键和值参数不经过Number，定位及UPDATE保持原十进制精度', async () => {
    const bitInfo = structuredClone(info); bitInfo.columns[0].type = 'bit(64)'; delete bitInfo.columns[0].characterSet; bitInfo.ddl = bitInfo.ddl.replace('varchar(20)', 'bit(64)'); io.metadata.mockResolvedValue(bitInfo);
    const maximum = '18446744073709551615'; const result = await run('upsert', {}, `id,value\n${maximum},new\n`);
    expect(result.conflicts?.committed.matchedUpdates).toBe(1);
    const match = io.execute.mock.calls.find(([, sql]) => /FOR UPDATE$/.test(sql))!;
    expect(match[1]).toContain('CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)'); expect(match[2]).toEqual([maximum]);
    expect(io.execute.mock.calls.find(([, sql]) => /^UPDATE/.test(sql))?.[2]).toEqual(['new', maximum]);
  });
  it('匹配键NULL或源字段缺失保留失败记录数，不能执行模糊匹配', async () => {
    const result = await run('upsert', { format: 'json' }, '[{"id":null,"value":"new"}]');
    expect(result.conflicts).toMatchObject({ termination: 'failed', readRecords: 1, failure: { stage: 'record', record: 1 }, currentBatch: 'rolled-back' });
    expect(io.execute.mock.calls.some(([, sql]) => /FOR UPDATE$/.test(sql))).toBe(false);
  });
  it('新增或更新匹配时只SET已映射非键列，UPDATE0也计确认命令而非改变行数', async () => {
    step = (managed, sql) => /^UPDATE/.test(sql) ? { rows: { affectedRows: 0, warningStatus: 0, serverStatus: managed.serverStatus }, fields: [] } : undefined;
    const result = await run('upsert');
    expect(result.conflicts).toMatchObject({ committed: { inserted: 0, matchedUpdates: 1, skippedExisting: 0, skippedMissing: 0 } });
    const update = io.execute.mock.calls.find(([, sql]) => /^UPDATE/.test(sql))!;
    expect(update[1]).toBe('UPDATE `isolated`.`target` SET `value` = ? WHERE `id` = ?'); expect(update[2]).toEqual(['new', 'abc']);
    expect(io.execute.mock.calls.find(([, sql]) => /FOR UPDATE$/.test(sql))?.[1]).toContain('FORCE INDEX (`PRIMARY`)');
  });
  it('未匹配upsert只新增一次，任何其它唯一键冲突仍失败回滚，不冒称跳过', async () => {
    matched = false;
    step = (_managed, sql) => { if (/^INSERT/.test(sql)) throw Object.assign(Error('另一唯一键冲突'), { code: 'ER_DUP_ENTRY', errno: 1062 }); };
    const result = await run('upsert');
    expect(result.conflicts).toMatchObject({ termination: 'failed', currentBatch: 'rolled-back', acknowledged: { inserted: 0, skippedExisting: 0 }, failure: { stage: 'insert', record: 1 } });
    expect(io.execute.mock.calls.filter(([, sql]) => /^INSERT/.test(sql))).toHaveLength(1);
    expect(io.execute.mock.calls.filter(([, sql]) => sql === 'ROLLBACK')).toHaveLength(2); // 候选只读事务与本批各一次。
  });
  it.each([0, 500, 501])('%i条源记录的提交边界按处理数计，恰500条不准备空批', async count => {
    const result = await run('skip-existing', {}, 'id,value\n' + Array.from({ length: count }, (_, index) => `r${index},new\n`).join(''));
    expect(result.conflicts).toMatchObject({ termination: 'completed', readRecords: count, currentBatch: 'none', acknowledged: { skippedExisting: count }, committed: { skippedExisting: count } });
    expect(io.execute.mock.calls.filter(([, sql]) => sql === 'COMMIT')).toHaveLength(count > 500 ? 2 : 1);
    expect(io.metadata).toHaveBeenCalledTimes(count > 500 ? 3 : 2); // 另有一次候选目录。
  });
  it('500条完整提交后EOF即完成，之后结构变化不误报空批失败', async () => {
    step = (_managed, sql) => { if (sql === 'COMMIT') io.metadata.mockImplementation(async () => ({ ...structuredClone(info), comment: '外部DDL已变化' })); };
    const result = await run('skip-existing', {}, 'id,value\n' + 'abc,new\n'.repeat(500));
    expect(result.conflicts).toMatchObject({ termination: 'completed', readRecords: 500, committed: { skippedExisting: 500 } });
    expect(io.metadata).toHaveBeenCalledTimes(2);
  });
  it('批次间结构变化必须在第501条写前停止，保留前500处理提交', async () => {
    step = (_managed, sql) => { if (sql === 'COMMIT') io.metadata.mockImplementation(async () => ({ ...structuredClone(info), columns: info.columns.map(column => ({ ...column, comment: 'DDL变化' })) })); };
    const result = await run('skip-existing', {}, 'id,value\n' + 'abc,new\n'.repeat(501));
    expect(result.conflicts).toMatchObject({ termination: 'failed', readRecords: 501, acknowledged: { skippedExisting: 500 }, committed: { skippedExisting: 500 }, failure: { stage: 'prepare-batch' }, currentBatch: 'rolled-back' });
    expect(io.execute.mock.calls.filter(([, sql]) => /FOR UPDATE$/.test(sql))).toHaveLength(500);
  });
  it('整文件模式501条只提交一次', async () => {
    const result = await run('skip-existing', { transactionMode: 'atomic' }, 'id,value\n' + 'abc,new\n'.repeat(501));
    expect(result.conflicts?.committed.skippedExisting).toBe(501); expect(io.execute.mock.calls.filter(([, sql]) => sql === 'COMMIT')).toHaveLength(1);
  });
  it('匹配多行必须拒绝本批，不能LIMIT1更新掩盖歧义', async () => {
    step = (_managed, sql) => /FOR UPDATE$/.test(sql) ? { rows: [{ present: 1 }, { present: 1 }], fields: [] } : undefined;
    const result = await run('upsert'); expect(result.conflicts).toMatchObject({ termination: 'failed', currentBatch: 'rolled-back', failure: { stage: 'match' } });
    expect(io.execute.mock.calls.some(([, sql]) => /^(?:INSERT|UPDATE)/.test(sql))).toBe(false);
  });
  it.each([1, '1'])('匹配常量保留驱动规范值%j，不改变BIGINT精度配置', async present => {
    step = (_managed, sql) => /FOR UPDATE$/.test(sql) ? { rows: [{ present }], fields: [] } : undefined;
    const result = await run('skip-existing');
    expect(result.conflicts).toMatchObject({ termination: 'completed', committed: { skippedExisting: 1 } });
  });
  it.each([{ present: 0 }, { present: '01' }, { present: true }, { present: null }, { present: ['1'] }, { present: '1.0' }, { present: ' 1' }, { present: '1 ' }, { present: 2 }, { present: undefined }, { present: 1, unexpected: 1 }, {}, [1]].map((row, index) => ({ row, index })))('异常匹配行$index不能经类型转换冒充命中', async ({ row }) => {
    step = (_managed, sql) => /FOR UPDATE$/.test(sql) ? { rows: [row], fields: [] } : undefined;
    const result = await run('skip-existing');
    expect(result.conflicts).toMatchObject({ termination: 'failed', acknowledged: { skippedExisting: 0 }, currentBatch: 'rolled-back', failure: { stage: 'match' } });
    expect(io.execute.mock.calls.some(([, sql]) => /^(?:INSERT|UPDATE)/.test(sql))).toBe(false);
  });
  it('匹配回包不执行访问器或沿原型取得常量', async () => {
    const getter = vi.fn(() => 1);
    for (const row of [Object.create({ present: 1 }), Object.defineProperty({}, 'present', { enumerable: true, get: getter })]) {
      step = (_managed, sql) => /FOR UPDATE$/.test(sql) ? { rows: [row], fields: [] } : undefined;
      expect((await run('skip-existing')).conflicts).toMatchObject({ termination: 'failed', failure: { stage: 'match' } });
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('锁定SELECT返回警告不能算skip成功或发送后续DML', async () => {
    step = (managed, sql) => { if (/FOR UPDATE$/.test(sql)) managed.connection.emit('dbark:session-state', { sql, serverStatus: 3, warningStatus: 1 }); };
    const result = await run('skip-existing'); expect(result.conflicts).toMatchObject({ termination: 'failed', acknowledged: { skippedExisting: 0 }, failure: { stage: 'match' } });
  });
  it('DML警告、COMMIT未知和ROLLBACK失败都不冒称提交或跳过', async () => {
    step = (managed, sql) => /^UPDATE/.test(sql) ? { rows: { affectedRows: 1, warningStatus: 1, serverStatus: managed.serverStatus }, fields: [] } : sql === 'ROLLBACK' && events.some(event => event.taskId === 'import') ? Promise.reject(Error('回滚ACK丢失')) : undefined;
    const result = await run('upsert'); expect(result.conflicts).toMatchObject({ termination: 'failed', currentBatch: 'rollback-unconfirmed', acknowledged: { matchedUpdates: 0 }, committed: { matchedUpdates: 0 }, failure: { stage: 'update' } });
  });
  it('新策略参数非法及SQL/Excel显式策略在建连前reject', async () => {
    io.connect.mockClear(); const filePath = join(folder, 'never.sql'), conflict = { mode: 'upsert', schemaHash: 'a'.repeat(64), key: { name: 'PRIMARY', columns: ['id'] } };
    for (const format of ['sql', 'xlsx']) await expect(engine.handle(format === 'xlsx' ? 'excel.import' : 'files.import', { ...target, taskId: 'bad', format, encoding: 'utf8', filePath, conflict, mapping: {} })).rejects.toThrow();
    await expect(engine.handle('files.import', { ...target, taskId: 'bad', format: 'csv', filePath, encoding: 'utf8', conflict: undefined, mapping: {} })).rejects.toThrow();
    expect(io.connect).not.toHaveBeenCalled();
  });
  it('默认省略策略不发任何目录证明、锁定匹配或隔离级别新SQL', async () => {
    const filePath = join(folder, 'default.csv'); await writeFile(filePath, 'id,value\nabc,new\n');
    const result = await engine.handle('files.import', { ...target, taskId: 'default', format: 'csv', filePath, encoding: 'utf8', mapping: { id: 'id', value: 'value' } });
    expect(result.conflicts).toBeUndefined(); expect(result.rows).toBe(1);
    expect(io.execute.mock.calls.some(([, sql]) => /FOR UPDATE|STATISTICS|ISOLATION LEVEL/.test(sql))).toBe(false);
  });
});
