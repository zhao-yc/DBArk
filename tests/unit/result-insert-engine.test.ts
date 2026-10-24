import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnInfo, ResultExportData, TableInfo } from '../../src/shared/contracts';
import { assertResultInsertData, resultInsertApplyInputSchema, resultInsertLimits, resultInsertPreviewInputSchema, resultInsertTimeZoneSchema, type ResultInsertApplyInput, type ResultInsertPreviewInput, type ResultInsertProgress, type ResultInsertTarget } from '../../src/shared/resultInsert';
import { ResultInsertTasks, resultInsertTriggerVisibility, validateResultInsertRows, type ResultInsertHost } from '../../src/engine/resultInsert';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';

const metadata = vi.hoisted(() => ({ read: vi.fn() }));
const owners = new Set<ResultInsertTasks>();
vi.mock('../../src/engine/incomingReferences', async original => ({ ...await original<typeof import('../../src/engine/incomingReferences')>(), readIncomingReferenceTable: metadata.read }));
const target: ResultInsertTarget = { connectionId: 'offline', database: 'db', table: 'target' };
const column = (name: string, type: string, nullable = false, extra = '', generated = false): ColumnInfo => ({ name, type, nullable, defaultValue: null, extra, comment: '', generated });
/** 真实定义解析器参与所有RAM路径；仅驱动物理边界和目录传输被替换。 */
function table(): TableInfo {
  return { database: 'db', name: 'target', objectKind: 'table', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], columns: [column('id', 'BIGINT UNSIGNED', false, 'auto_increment'), column('amount', 'DECIMAL(30,12)'), column('payload', 'VARBINARY(8)'), column('note', 'VARCHAR(100)', true), column('at', 'DATETIME(6)'), column('omitted', 'INT'), column('computed', 'DECIMAL(34,12)', true, 'STORED GENERATED', true)], ddl: 'CREATE TABLE `target` (`id` bigint unsigned NOT NULL AUTO_INCREMENT, `amount` decimal(30,12) NOT NULL, `payload` varbinary(8) NOT NULL, `note` varchar(100) DEFAULT NULL, `at` datetime(6) NOT NULL, `omitted` int NOT NULL DEFAULT 7, `computed` decimal(34,12) GENERATED ALWAYS AS (`amount` + 1) STORED, PRIMARY KEY (`id`)) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin' };
}
function data(): ResultExportData {
  return { columns: [{ key: 's0', name: '重复标题' }, { key: 's1', name: '重复标题' }, { key: 's2', name: '' }, { key: 's3', name: '备注' }, { key: 's4', name: '时间' }], rows: [
    { s0: '0', s1: '9007199254740993.123456789012', s2: { type: 'binary', base64: 'AP8=' }, s3: null, s4: '2026-10-24 12:34:56.123456' },
    { s0: '18446744073709551615', s1: '-9007199254740993.123456789012', s2: { type: 'binary', base64: '' }, s3: " O'Reilly\\\0🚢 ", s4: '2026-10-24 12:34:56.000001' },
  ], truncated: true };
}
function request(patch: Partial<ResultInsertPreviewInput> = {}): ResultInsertPreviewInput {
  return { ...target, taskId: randomUUID(), data: data(), mapping: ['id', 'amount', 'payload', 'note', 'at'].map((name, index) => ({ source: 's' + index, target: name })), timeZone: '+00:00', ...patch };
}
function apply(token: string, patch: Partial<ResultInsertApplyInput> = {}): ResultInsertApplyInput { return { connectionId: target.connectionId, taskId: randomUUID(), previewToken: token, confirmation: 'db.target', acknowledged: true, ...patch }; }
const definitionContext = { dialect: 'mysql' as const, mode: { ansiQuotes: false, noBackslashEscapes: false } };

/** 手工驱动按原callback/end两个不同事件交付，不调用生产mock结果替换业务判断。 */
function fixture() {
  const f = {
    source: table(), now: 1000, cancelled: false, triggers: false, grants: ['GRANT ALL PRIVILEGES ON *.* TO `offline`@`%`'],
    failInsert: 0, warnInsert: 0, loseTransaction: 0, breakInsert: 0, failCommit: false, warnCommit: false, failRollback: false, lateCloseFailure: false,
    inserted: 0, activeCommands: 0, activeRuns: 0, runs: [] as { execution: boolean; progress: ResultInsertProgress }[], commands: [] as { sql: string; values?: unknown[] }[],
    snapshots: [] as ResultInsertProgress[], heldEnds: [] as (() => void)[], heldCallbacks: [] as (() => void)[], holdEnd: '' as string, holdCallback: '' as string,
    afterInsert: undefined as (() => void) | undefined, beforeRun: undefined as (() => Promise<void>) | undefined,
  };
  const host: ResultInsertHost = { async run<T>(_target: ResultInsertTarget, _task: string, action: (context: StructureTaskContext) => Promise<T>, progress: ResultInsertProgress, execution: boolean): Promise<T> {
    f.runs.push({ execution, progress }); f.activeRuns++; let mode = 'NO_ENGINE_SUBSTITUTION', timeZone = 'SYSTEM', inTransaction = false;
    const connection = new EventEmitter() as EventEmitter & { threadId: number; query: Function; execute: Function }; connection.threadId = 32;
    const managed = { connection, status: { dialect: 'mysql', version: '8.4.11' }, broken: false, serverStatus: 2, transactionStateKnown: true, sqlMode: mode };
    const schedule = (sql: string, values: unknown[] | undefined, callback: (error: Error | null, result?: unknown, fields?: unknown[]) => void) => {
      const operation = new EventEmitter(); f.commands.push({ sql, ...(values ? { values } : {}) });
      queueMicrotask(() => {
        let error: Error | null = null, result: unknown;
        if (sql.startsWith('SELECT @@version AS version,')) result = [{ version: '8.4.11', hostname: 'offline-host', port: '3306', serverId: '1', currentUser: 'offline@%', connectionId: '32', quoteShowCreate: '1', charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci', uuid: '00000000-0000-4000-8000-000000000001' }];
        else if (sql === 'SELECT @@SESSION.sql_mode AS sqlMode') result = [{ sqlMode: mode }];
        else if (sql === 'SELECT @@SESSION.sql_mode AS sqlMode,@@SESSION.time_zone AS timeZone') result = [{ sqlMode: mode, timeZone }];
        else if (sql === 'SHOW GRANTS') result = f.grants.map(value => ({ grant: value }));
        else if (sql.startsWith('SELECT TRIGGER_NAME')) result = f.triggers ? [{ TRIGGER_NAME: 'unsafe' }] : [];
        else if (sql.startsWith('SELECT 1 FROM')) result = [];
        else {
          if (sql.startsWith('SET SESSION sql_mode')) { mode = sql.slice(sql.indexOf("'") + 1, -1); managed.sqlMode = mode; }
          else if (sql.startsWith('SET SESSION time_zone')) timeZone = sql.slice(sql.indexOf("'") + 1, -1);
          else if (sql === 'START TRANSACTION') inTransaction = true;
          else if (sql === 'COMMIT') { if (f.failCommit) error = Error('提交ACK丢失'); else inTransaction = false; }
          else if (sql === 'ROLLBACK') { if (f.failRollback) error = Error('回滚ACK丢失'); else inTransaction = false; }
          else if (sql.startsWith('INSERT INTO')) {
            f.inserted++; if (f.failInsert === f.inserted) error = Error('本例唯一冲突');
            if (f.breakInsert === f.inserted) managed.broken = true;
            if (f.loseTransaction === f.inserted) inTransaction = false;
            f.afterInsert?.();
          } else throw Error('RAM拒绝未声明命令');
          managed.serverStatus = 2 | (inTransaction ? 1 : 0);
          result = { affectedRows: sql.startsWith('INSERT INTO') ? 1 : 0, serverStatus: managed.serverStatus, warningStatus: sql.startsWith('INSERT INTO') && f.warnInsert === f.inserted || sql === 'COMMIT' && f.warnCommit ? 1 : 0 };
        }
        const deliver = () => callback(error, result, []), end = () => operation.emit('end');
        if (sql === f.holdCallback) { end(); f.heldCallbacks.push(deliver); }
        else { deliver(); if (sql === f.holdEnd) f.heldEnds.push(end); else queueMicrotask(end); }
      });
      return operation;
    };
    connection.query = (sql: string, callback: Function) => schedule(sql, undefined, callback as never);
    connection.execute = (sql: string, values: unknown[], callback: Function) => schedule(sql, values, callback as never);
    const context = { managed, checkCancelled() { if (f.cancelled) throw Error('本例取消'); }, report() { f.snapshots.push({ ...progress }); }, commandStarted() { f.activeCommands++; let closed = false; return () => { if (!closed) { closed = true; f.activeCommands--; } }; } } as unknown as StructureTaskContext;
    try { await f.beforeRun?.(); const result = await action(context); if (execution && f.lateCloseFailure) throw Error('真实收尾失败替身'); return result; } finally { f.activeRuns--; }
  } };
  metadata.read.mockImplementation(async () => structuredClone(f.source));
  const tasks = new ResultInsertTasks(host, () => f.now); owners.add(tasks); return { f, tasks };
}
beforeEach(() => metadata.read.mockReset());
afterEach(() => { for (const tasks of owners) tasks.close(); owners.clear(); vi.useRealTimers(); });

describe('结果插入的共享边界及完整预检', () => {
  it('沿原结果预算支持重复显示标题、typed二进制和原精确文本，拒绝SQL/空行/坏形状', () => {
    expect(resultInsertPreviewInputSchema.parse(request()).data).toEqual(data());
    for (const patch of [{ data: { ...data(), rows: [] } }, { sql: 'SELECT 禁止源SQL' }, { mapping: [{ source: 's0', target: 'id' }, { source: 's1', target: 'id' }] }, { timeZone: 'SYSTEM' }]) expect(() => resultInsertPreviewInputSchema.parse({ ...request(), ...patch })).toThrow();
    expect(() => resultInsertApplyInputSchema.parse({ ...apply(randomUUID()), acknowledged: false })).toThrow();
    const getter = vi.fn(() => '秘密'), bad = data(); Object.defineProperty(bad.rows[0], 's3', { enumerable: true, get: getter }); expect(() => assertResultInsertData(bad)).toThrow(); expect(getter).not.toHaveBeenCalled();
    for (const timeZone of ['+00:00', '-13:59', '+14:00']) expect(resultInsertTimeZoneSchema.parse(timeZone)).toBe(timeZone);
    for (const timeZone of ['+14:01', '-14:00', '+99:00', '+00:60', ' +00:00']) expect(() => resultInsertTimeZoneSchema.parse(timeZone)).toThrow();
    expect(resultInsertLimits).toMatchObject({ rows: 100000, columns: 1024, cells: 2000000, bytes: 32 * 1024 * 1024, previews: 8, retainedBytes: 64 * 1024 * 1024, lifetimeMs: 120000 });
  });
  it('全行先验拒绝精度损失、生成列、漏必填、未知空间类型，不能只看20行样本', async () => {
    const { f, tasks } = fixture(), input = request(); input.data.rows = Array.from({ length: 21 }, () => ({ ...data().rows[0] })); input.data.rows[20].s1 = '0.0000000000001';
    await expect(tasks.preview(input, 0)).rejects.toThrow('无损'); expect(f.commands.some(item => item.sql.startsWith('INSERT'))).toBe(false);
    expect(() => validateResultInsertRows(table(), data(), [{ source: 's0', target: 'computed' }], 'mysql', definitionContext)).toThrow('映射');
    expect(() => validateResultInsertRows(table(), data(), [{ source: 's0', target: 'id' }], 'mysql', definitionContext)).toThrow('默认值');
    const spatial = table(); spatial.columns[2].type = 'GEOMETRY'; expect(() => validateResultInsertRows(spatial, data(), request().mapping, 'mysql', definitionContext)).toThrow('InnoDB');
  });
  it('目录不可证明或真实触发器存在均拒绝，不以空可见子集保证事务', async () => {
    expect(resultInsertTriggerVisibility(['GRANT SELECT, INSERT ON `db`.`target` TO `u`@`%`'], target, definitionContext)).toBe(false);
    expect(resultInsertTriggerVisibility(['GRANT TRIGGER ON `db`.`target` TO `u`@`%`'], target, definitionContext)).toBe(true);
    expect(resultInsertTriggerVisibility(['GRANT ALL PRIVILEGES ON *.* TO `u`@`%`', 'REVOKE TRIGGER ON `db`.* FROM `u`@`%`'], target, definitionContext)).toBe(false);
    for (const kind of ['visible', 'hidden']) { const { f, tasks } = fixture(); if (kind === 'visible') f.triggers = true; else f.grants = ['GRANT INSERT ON *.* TO `u`@`%`']; await expect(tasks.preview(request(), 0)).rejects.toThrow('触发器'); expect(f.inserted).toBe(0); }
  });
});

describe('独立预览和整批INSERT事务生命周期', () => {
  it('预览不写入、调用者后改不污染，全部行逐个prepared、一次COMMIT、默认与生成列不写', async () => {
    const { f, tasks } = fixture(), input = request(), original = structuredClone(input.data.rows), preview = await tasks.preview(input, 4);
    expect(preview).toMatchObject({ target, rows: 2, shownRows: 2, sourceTruncated: true, timeZone: '+00:00' }); expect(f.inserted).toBe(0); expect(f.activeCommands).toBe(0);
    input.data.rows[0].s0 = '999'; input.mapping[0].target = 'computed';
    expect(await tasks.apply(apply(preview.previewToken), 4)).toEqual({ target, rows: 2, outcome: 'committed', commitAcknowledged: true });
    const inserts = f.commands.filter(item => item.sql.startsWith('INSERT INTO'));
    expect(inserts.map(item => item.sql)).toEqual(Array(2).fill('INSERT INTO `db`.`target` (`id`, `amount`, `payload`, `note`, `at`) VALUES (?, ?, ?, ?, ?)'));
    expect(inserts[0].values).toEqual([original[0].s0, original[0].s1, Buffer.from([0, 255]), null, original[0].s4]); expect(inserts[1].values?.[0]).toBe('18446744073709551615');
    expect(f.commands.filter(item => item.sql === 'COMMIT')).toHaveLength(1); expect(f.commands.some(item => item.sql === 'ROLLBACK')).toBe(false); expect(f.activeCommands).toBe(0); expect(f.activeRuns).toBe(0);
    expect(f.runs.at(-1)?.progress).toMatchObject({ rows: 2, totalRows: 2, commitAcknowledged: true, transactionProtected: true, outcome: 'committed' });
    await expect(tasks.apply(apply(preview.previewToken), 4)).rejects.toThrow('失效');
  });
  it.each(['conflict', 'warning', 'cancel'] as const)('%s在中途失败只发一次ROLLBACK且整体不COMMIT，原保护证据保留', async kind => {
    const { f, tasks } = fixture(), preview = await tasks.preview(request(), 0);
    if (kind === 'conflict') f.failInsert = 2; if (kind === 'warning') f.warnInsert = 2; if (kind === 'cancel') f.afterInsert = () => { f.cancelled = true; };
    await expect(tasks.apply(apply(preview.previewToken), 0)).rejects.toThrow();
    expect(f.commands.filter(item => item.sql === 'ROLLBACK')).toHaveLength(1); expect(f.commands.some(item => item.sql === 'COMMIT')).toBe(false);
    expect(f.runs.at(-1)?.progress).toMatchObject({ dmlMayHaveBeenSent: true, commitMayHaveBeenSent: false, rollbackAcknowledged: true, transactionProtected: true, outcome: 'rolled-back' }); expect(f.activeCommands).toBe(0);
  });
  it.each(['disconnect', 'rollback-lost', 'commit-lost'] as const)('%s只报告unknown，不伪称回滚或重放', async kind => {
    const { f, tasks } = fixture(), preview = await tasks.preview(request(), 0);
    if (kind === 'disconnect') f.breakInsert = 1; if (kind === 'rollback-lost') { f.failInsert = 2; f.failRollback = true; } if (kind === 'commit-lost') f.failCommit = true;
    await expect(tasks.apply(apply(preview.previewToken), 0)).rejects.toThrow(); expect(f.runs.at(-1)?.progress).toMatchObject({ commitAcknowledged: false, rollbackAcknowledged: false, outcome: 'unknown' });
    if (kind === 'commit-lost') expect(f.commands.some(item => item.sql === 'ROLLBACK')).toBe(false);
    const count = f.commands.length; await expect(tasks.apply(apply(preview.previewToken), 0)).rejects.toThrow(); expect(f.commands).toHaveLength(count);
  });
  it('COMMIT ACK先记事实，必须等原end；ACK与end之间取消/晚收尾异常不改已提交', async () => {
    const { f, tasks } = fixture(), preview = await tasks.preview(request(), 0); f.holdEnd = 'COMMIT'; f.lateCloseFailure = true;
    let done = false; const operation = tasks.apply(apply(preview.previewToken), 0).then(result => { done = true; return result; });
    await vi.waitFor(() => expect(f.heldEnds).toHaveLength(1)); expect(done).toBe(false); expect(f.activeCommands).toBe(1); expect(f.runs.at(-1)?.progress).toMatchObject({ commitAcknowledged: true, rows: 2, outcome: 'committed' });
    tasks.close(); f.cancelled = true; expect(done).toBe(false); f.heldEnds.shift()!();
    expect(await operation).toMatchObject({ rows: 2, commitAcknowledged: true, outcome: 'committed' }); expect(f.activeCommands).toBe(0); expect(f.activeRuns).toBe(0);
  });
  it('INSERT callback与end之间不能发下一行，取消仍等原end后才回滚', async () => {
    const { f, tasks } = fixture(), preview = await tasks.preview(request(), 0); f.holdEnd = 'INSERT INTO `db`.`target` (`id`, `amount`, `payload`, `note`, `at`) VALUES (?, ?, ?, ?, ?)';
    const operation = tasks.apply(apply(preview.previewToken), 0); const failure = expect(operation).rejects.toThrow(); await vi.waitFor(() => expect(f.heldEnds).toHaveLength(1));
    expect(f.inserted).toBe(1); expect(f.activeCommands).toBe(1); f.cancelled = true; expect(f.commands.some(item => item.sql === 'ROLLBACK')).toBe(false);
    f.heldEnds.shift()!(); await failure; expect(f.inserted).toBe(1); expect(f.activeCommands).toBe(0); expect(f.runs.at(-1)?.progress).toMatchObject({ rollbackAcknowledged: true, outcome: 'rolled-back' });
  });
  it('驱动end先到也必须等原COMMIT callback，不能提前完成或伪造ACK', async () => {
    const { f, tasks } = fixture(), preview = await tasks.preview(request(), 0); f.holdCallback = 'COMMIT';
    let done = false; const operation = tasks.apply(apply(preview.previewToken), 0).then(result => { done = true; return result; });
    await vi.waitFor(() => expect(f.heldCallbacks).toHaveLength(1)); expect(done).toBe(false); expect(f.activeCommands).toBe(1); expect(f.runs.at(-1)?.progress.commitAcknowledged).toBe(false);
    f.heldCallbacks.shift()!(); expect(await operation).toMatchObject({ commitAcknowledged: true, outcome: 'committed' }); expect(f.activeCommands).toBe(0);
  });
  it('明确COMMIT OK即使伴随晚warning也保留提交事实，不补ROLLBACK', async () => {
    const { f, tasks } = fixture(), preview = await tasks.preview(request(), 0); f.warnCommit = true;
    expect(await tasks.apply(apply(preview.previewToken), 0)).toMatchObject({ commitAcknowledged: true, outcome: 'committed' }); expect(f.commands.some(item => item.sql === 'ROLLBACK')).toBe(false);
  });
  it('定义漂移、连接修订、错误准确名、release及过期拒绝，close后新用途可恢复', async () => {
    for (const reason of ['definition', 'revision', 'confirmation', 'release', 'expiry', 'disconnect'] as const) {
      const { f, tasks } = fixture(), preview = await tasks.preview(request(), 0);
      if (reason === 'definition') f.source.ddl = f.source.ddl.replace('DEFAULT 7', 'DEFAULT 8');
      if (reason === 'release') tasks.release({ connectionId: target.connectionId, previewToken: preview.previewToken });
      if (reason === 'expiry') f.now += 120001; if (reason === 'disconnect') tasks.releaseConnection(target.connectionId);
      await expect(tasks.apply(apply(preview.previewToken, reason === 'confirmation' ? { confirmation: ' db.target' } : {}), reason === 'revision' ? 1 : 0)).rejects.toThrow(); expect(f.inserted).toBe(0);
    }
    const { tasks } = fixture(), old = await tasks.preview(request(), 0); tasks.close(); await expect(tasks.apply(apply(old.previewToken), 0)).rejects.toThrow(); expect(await tasks.preview(request(), 0)).toMatchObject({ rows: 2 });
  });
  it('八个小预览可保留，计入在途预留且close/TTL不能提前腾出未终结任务容量', async () => {
    const { tasks } = fixture(); for (let index = 0; index < 8; index++) await tasks.preview(request(), 0); await expect(tasks.preview(request(), 0)).rejects.toThrow('预算'); tasks.close();
    const second = fixture(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); second.f.beforeRun = () => gate;
    const pending = Array.from({ length: 7 }, () => second.tasks.preview(request(), 0)); const results = Promise.allSettled(pending);
    second.tasks.close(); second.f.now += 120001; await expect(second.tasks.preview(request(), 0)).rejects.toThrow('预算');
    release(); expect((await results).every(result => result.status === 'rejected')).toBe(true); expect(second.f.activeRuns).toBe(0); expect(await second.tasks.preview(request(), 0)).toMatchObject({ rows: 2 });
  });
  it('闲置预览到期计时器立即释放敏感缓存，release/close精确清定时器而不封死新预览', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { f, tasks } = fixture();
    try {
      const preview = await tasks.preview(request(), 0); expect(vi.getTimerCount()).toBe(1); f.now += 120000; await vi.advanceTimersByTimeAsync(120000);
      expect((tasks as unknown as { entries: Map<string, unknown> }).entries.size).toBe(0); expect(vi.getTimerCount()).toBe(0); await expect(tasks.apply(apply(preview.previewToken), 0)).rejects.toThrow();
      const next = await tasks.preview(request(), 0); expect(vi.getTimerCount()).toBe(1); tasks.release({ connectionId: target.connectionId, previewToken: next.previewToken }); expect(vi.getTimerCount()).toBe(0);
      await tasks.preview(request(), 0); tasks.close(); expect(vi.getTimerCount()).toBe(0); expect((tasks as unknown as { entries: Map<string, unknown> }).entries.size).toBe(0);
      const recovered = await tasks.preview(request(), 0); expect(recovered.rows).toBe(2);
    } finally { tasks.close(); vi.useRealTimers(); }
  });
});
