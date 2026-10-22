import { EventEmitter } from 'node:events';
import { Types } from 'mysql2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableStatisticsOutput } from '../../src/shared/tableStatistics';
import { tableStatisticsMessages } from '../../src/shared/tableStatistics';

const driver = vi.hoisted(() => ({ connect: vi.fn() }));
/** 仅替换网络连接；真实Engine、metadata、流消费器、SQL、统计解码与严格关闭保持。 */
vi.mock('../../src/engine/connection', async () => ({ ...await vi.importActual('../../src/engine/connection'), connect: driver.connect }));
import { closeMysqlConnection } from '../../src/engine/connection';
import { Engine } from '../../src/engine/index';

const profile: ConnectionProfile = { id: 'stats-ram', name: '表统计RAM', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 3306, user: '合成用户' };
const controls = ['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION READ ONLY', 'ROLLBACK AND NO CHAIN NO RELEASE'];
const names = ['big_value', 'amount', 'at_value', 'all_null', 'payload', 'label', 'approx_value', 'document', 'bit_value'];
/** 固定原目录与聚合原值分别手写，不调用产品planner产生期望响应。 */
const declarations = [
  { name: 'big_value', type: 'bigint unsigned', characterSet: null }, { name: 'amount', type: 'decimal(30,12)', characterSet: null },
  { name: 'at_value', type: 'datetime(6)', characterSet: null }, { name: 'all_null', type: 'int', characterSet: null },
  { name: 'payload', type: 'blob', characterSet: null }, { name: 'label', type: 'varchar(32)', characterSet: 'utf8mb4' },
  { name: 'approx_value', type: 'float', characterSet: null }, { name: 'document', type: 'json', characterSet: null }, { name: 'bit_value', type: 'bit(64)', characterSet: null },
];
const columns = () => [{ name: 'id', type: 'int', nullable: 'NO', defaultValue: null, extra: '', comment: '', characterSet: null }, ...declarations.map(item => ({ ...item, nullable: 'YES', defaultValue: null, extra: '', comment: '' }))];
const originalShow = 'CREATE TABLE `subject` (`id` int NOT NULL,`big_value` bigint unsigned DEFAULT NULL,`amount` decimal(30,12) DEFAULT NULL,`at_value` datetime(6) DEFAULT NULL,`all_null` int DEFAULT NULL,`payload` blob,`label` varchar(32) DEFAULT NULL,`approx_value` float DEFAULT NULL,`document` json,`bit_value` bit(64) DEFAULT NULL,PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
type Packet = { target: 'command' | 'connection'; event: string; args: unknown[] };
let engine: Engine, sent: string[], events: TaskEvent[], connections: ManagedConnection[], sequence: number, requested: string[], rows: unknown[][] | undefined;
let warnings: unknown, eofWarnings: number | undefined, fieldPatch: ((names: string[]) => string[]) | undefined, valuePatch: ((value: unknown[]) => unknown[]) | undefined, rowCount: string;
let mode: string, kind: 'BASE TABLE' | 'VIEW', source: string, sourceReads: number, lateSource: string | undefined, lateAt: number, metadataOverflow: boolean;
let denied: RegExp | undefined, holdAggregate: boolean, originalEnd: ((error?: Error) => void) | undefined, killReceived: boolean, closeFails: boolean, unknownClose: boolean, extraResult: boolean;
let requestedDistinct: boolean;
const aggregates: Record<string, { suffixes: string[]; values: () => unknown[] }> = {
  big_value: { suffixes: ['nonNull', 'nulls', 'min', 'minBytes', 'max', 'maxBytes', 'sum', 'avg'], values: () => ['122', '1', '0', '1', '18446744073709551615', '20', '36893488147419103229', '302405640552615600.2377'] },
  amount: { suffixes: ['nonNull', 'nulls', 'min', 'minBytes', 'max', 'maxBytes', 'sum', 'avg'], values: () => ['122', '1', '-9007199254740993.123456789011', '30', '9007199254740993.123456789012', '29', '0.000000000001', '0.0000000000000082'] },
  at_value: { suffixes: ['nonNull', 'nulls', 'min', 'minBytes', 'max', 'maxBytes'], values: () => ['122', '1', '2026-01-01 00:00:00.000001', '26', '2026-10-22 12:34:56.123457', '26'] },
  all_null: { suffixes: ['nonNull', 'nulls', 'min', 'minBytes', 'max', 'maxBytes', 'sum', 'avg'], values: () => ['0', '123', null, null, null, null, null, null] },
  payload: { suffixes: ['nonNull', 'nulls', 'min', 'minBytes', 'max', 'maxBytes'], values: () => ['122', '1', Buffer.alloc(0), '0', Buffer.from('00ff', 'hex'), '2'] },
  label: { suffixes: ['nonNull', 'nulls', 'min', 'minBytes', 'max', 'maxBytes'], values: () => ['122', '1', 'Alpha', '5', 'fill', '4'] },
  approx_value: { suffixes: ['nonNull', 'nulls', 'min', 'minBytes', 'max', 'maxBytes', 'sum', 'avg'], values: () => ['122', '1', 0, '1', Math.fround(0.2), '19', '0.30000000447034836', '0.0024590164300848227'] },
  document: { suffixes: ['nonNull', 'nulls'], values: () => ['122', '1'] },
  bit_value: { suffixes: ['nonNull', 'nulls', 'min', 'minBytes', 'max', 'maxBytes', 'sum', 'avg'], values: () => ['122', '1', '0', '1', '18446744073709551615', '20', '18446744073709551615', '151202820276307800.1230'] },
};
// 去重预期独立固定，不复用产品SQL或解码结果来生成计数；JSON保持仅计数。
const distinctCounts: Record<string, string> = { big_value: '3', amount: '4', at_value: '5', all_null: '0', payload: '2', label: '3', approx_value: '3', bit_value: '2' };
const rawNames = () => ['rowCount', ...requested.flatMap((name, index) => {
  const suffixes = [...aggregates[name].suffixes]; if (requestedDistinct && Object.hasOwn(distinctCounts, name)) suffixes.splice(2, 0, 'distinct'); return suffixes.map(suffix => `c${index}_${suffix}`);
})];
const rawValues = () => [rowCount, ...requested.flatMap(name => {
  const values = aggregates[name].values(); if (requestedDistinct && Object.hasOwn(distinctCounts, name)) values.splice(2, 0, distinctCounts[name]); return values;
})];
const hexValues = (sql: string) => [...sql.matchAll(/X'([a-f0-9]*)'/ig)].map(match => Buffer.from(match[1], 'hex').toString('utf8'));

/** 原事件泵支持pause/resume；统计只接收一行聚合，不把产品响应或字段结果mock为已成功。 */
function connect(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++sequence, stream = Object.assign(new EventEmitter(), { closed: false, end(callback: () => void) { queueMicrotask(() => { callback(); stream.closed = true; stream.emit('close'); }); } });
  let paused = false, pumping = false, active: { command: EventEmitter; packets: Packet[]; ended: boolean } | undefined;
  const pump = () => { if (pumping || !active) return; pumping = true; try { while (!paused && active.packets.length) { const packet = active.packets.shift()!; if (packet.target === 'command' && packet.event === 'end') active.ended = true; (packet.target === 'command' ? active.command : connection).emit(packet.event, ...packet.args); } } finally { pumping = false; } };
  const managed = { connection, signal, profile, sqlMode: '', status: { version: '8.4.11', dialect: 'mysql', connectionId: threadId }, broken: false, close: vi.fn(async () => { if (closeFails) { unknownClose = true; throw Error('合成统计原流关闭未知'); } await closeMysqlConnection(connection as any, true, false, 500); }) } as unknown as ManagedConnection;
  const query = (...args: unknown[]) => {
    const sql = typeof args[0] === 'string' ? args[0] : (args[0] as { sql: string }).sql, callback = typeof args.at(-1) === 'function' ? args.at(-1) as (error: Error | null, rows?: unknown, fields?: unknown[]) => void : undefined, command = new EventEmitter(); sent.push(sql);
    if (!callback) {
      const aliases = fieldPatch ? fieldPatch(rawNames()) : rawNames(), values = valuePatch ? valuePatch(rawValues()) : rawValues();
      const fields = aliases.map((name, index) => ({ name, columnType: typeof values[index] === 'number' ? Types.DOUBLE : Buffer.isBuffer(values[index]) ? Types.BLOB : Types.VAR_STRING }));
      const packets: Packet[] = [{ target: 'command', event: 'fields', args: [fields, 0] }, ...(rows ?? [values]).map(value => ({ target: 'command' as const, event: 'result', args: [value, 0] })), { target: 'connection', event: 'dbark:session-state', args: [{ sql, warningStatus: eofWarnings }] }, ...(extraResult ? [{ target: 'command' as const, event: 'fields', args: [fields, 1] }, { target: 'command' as const, event: 'result', args: [values, 1] }, { target: 'connection' as const, event: 'dbark:session-state', args: [{ sql, warningStatus: 0 }] }] : []), { target: 'command', event: 'end', args: [] }]; active = { command, packets, ended: false };
      originalEnd = (error?: Error) => { if (active?.command !== command || active.ended) return; active.ended = true; active.packets.splice(0); paused = false; queueMicrotask(() => { if (error) command.emit('error', error); command.emit('end'); }); };
      if (!holdAggregate) queueMicrotask(pump); return command;
    }
    queueMicrotask(() => {
      if (denied?.test(sql)) { callback(Object.assign(Error('合成统计目录拒读或控制失败'), { errno: 1142, code: 'ER_TABLEACCESS_DENIED_ERROR' }), undefined, []); command.emit('end'); return; }
      const values = hexValues(sql), database = values[0] ?? 'db', table = values[1] ?? 'subject'; let result: unknown;
      if (controls.includes(sql)) result = { affectedRows: 0, warningStatus: 0 };
      else if (sql === 'SELECT @@SESSION.sql_mode AS sqlMode') result = [{ sqlMode: mode }];
      else if (sql.startsWith('SELECT TABLE_SCHEMA AS databaseName,TABLE_NAME AS tableName,TABLE_TYPE AS kind')) result = [{ databaseName: database, tableName: table, kind }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type')) result = metadataOverflow ? Array.from({ length: 4097 }, () => columns()[0]) : columns();
      else if (sql.startsWith('SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique')) result = kind === 'VIEW' ? [] : [{ name: 'PRIMARY', nonUnique: 0, columnName: 'id', subPart: null, indexType: 'BTREE', sortDirection: 'A' }];
      else if (sql.startsWith('SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME')) result = [];
      else if (sql.startsWith('SELECT t.ENGINE AS engine, t.TABLE_TYPE AS tableType')) result = [{ engine: kind === 'VIEW' ? null : 'InnoDB', tableType: kind, collation: kind === 'VIEW' ? null : 'utf8mb4_general_ci', comment: '', charset: kind === 'VIEW' ? null : 'utf8mb4' }];
      else if (/^SHOW CREATE (?:TABLE|VIEW)/.test(sql)) result = [{ [kind === 'VIEW' ? 'Create View' : 'Create Table']: ++sourceReads >= lateAt ? lateSource ?? source : source }];
      else if (sql === 'SHOW WARNINGS LIMIT 21') result = warnings;
      else if (/^KILL (?:CONNECTION|QUERY) \d+$/.test(sql)) { killReceived = true; if (!holdAggregate) originalEnd?.(Error('合成原聚合已停止')); result = []; }
      else { callback(Error('统计RAM未登记原SQL'), undefined, []); command.emit('end'); return; }
      callback(null, result, []); command.emit('end');
    }); return command;
  };
  Object.assign(connection, { threadId, stream, pause() { paused = true; }, resume() { paused = false; if (!holdAggregate) pump(); }, query, execute: query, end: (callback: () => void) => queueMicrotask(callback), destroy: () => connection.emit('end') });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(managed); return managed;
}
const statistics = (changes: Record<string, unknown> = {}): Promise<TableStatisticsOutput> => { const input = { connectionId: profile.id, database: 'db', table: 'subject', taskId: 'stats-' + sequence, columns: [...names], filters: [], ...changes }; requested = input.columns; requestedDistinct = changes.distinct === true; return engine.handle('table.statistics', input); };
const aggregation = () => sent.filter(sql => /AS `dbark_statistics`$/.test(sql));
beforeEach(async () => { sequence = sourceReads = 0; sent = []; events = []; connections = []; requested = []; requestedDistinct = false; rows = undefined; warnings = []; eofWarnings = 0; fieldPatch = valuePatch = undefined; rowCount = '123'; mode = ''; kind = 'BASE TABLE'; source = originalShow; lateAt = Infinity; lateSource = denied = originalEnd = undefined; metadataOverflow = holdAggregate = killReceived = closeFails = unknownClose = extraResult = false; driver.connect.mockReset().mockImplementation(async (_profile, _database, signal) => connect(signal)); engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile }); });
afterEach(async () => { holdAggregate = false; originalEnd?.(Error('合成收尾')); closeFails = false; if (unknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll(); });

describe('服务器全部筛选行统计真实Engine/metadata/原生事件流（仅RAM）', () => {
  it('单行聚合保UINT64/DECIMAL/微秒/NULL/二进制，FLOAT明确近似，JSON仅计数', async () => {
    const result = await statistics(); expect(result.rowCount).toBe('123'); expect(result.columns.map(column => column.name)).toEqual(names); expect(result.columns[0]).toMatchObject({ kind: 'numeric', nonNull: '122', nulls: '1', min: '0', max: '18446744073709551615', sum: '36893488147419103229', avg: '302405640552615600.2377', approximate: false });
    expect(result.columns[1]).toMatchObject({ min: '-9007199254740993.123456789011', max: '9007199254740993.123456789012', sum: '0.000000000001' }); expect(result.columns[2]).toMatchObject({ kind: 'ordered', max: '2026-10-22 12:34:56.123457' }); expect(result.columns[3]).toMatchObject({ nonNull: '0', nulls: '123', min: null, max: null, sum: null, avg: null }); expect(result.columns[4]).toMatchObject({ kind: 'ordered', min: { type: 'binary', base64: '' }, max: { type: 'binary', base64: 'AP8=' } }); expect(result.columns[6]).toMatchObject({ kind: 'numeric', approximate: true, max: Math.fround(0.2) }); expect(result.columns[7]).toMatchObject({ kind: 'count-only', nonNull: '122', nulls: '1' });
    expect(result.columns[8]).toMatchObject({ kind: 'numeric', type: 'bit(64)', min: '0', max: '18446744073709551615', sum: '18446744073709551615', approximate: false }); for (const operation of ['MIN', 'MAX', 'SUM', 'AVG']) expect(aggregation()[0]).toContain(operation + '(CAST(`bit_value` AS UNSIGNED))');
    expect(aggregation()).toHaveLength(1); expect(aggregation()[0]).toContain('COUNT(*) AS `s_rows`'); expect(aggregation()[0]).not.toMatch(/SELECT \*|\bLIMIT\b|\bOFFSET\b|\bORDER BY\b/); expect(connections.slice(1).every(managed => vi.mocked(managed.close).mock.calls[0]?.[0]?.strict === true)).toBe(true);
  });
  it('独立只读事务控制先于任何元数据，诊断紧邻聚合，正常ROLLBACK是最终SQL', async () => { await statistics({ columns: [] }); expect(sent.slice(0, 2)).toEqual(controls.slice(0, 2)); const index = sent.findIndex(sql => /AS `dbark_statistics`$/.test(sql)); expect(sent[index + 1]).toBe('SHOW WARNINGS LIMIT 21'); expect(sent.at(-1)).toBe(controls[2]); expect(sent.every(sql => /^(?:SELECT|SHOW)\b/.test(sql) || controls.includes(sql))).toBe(true); expect(sent).not.toContain('COMMIT'); });
  it.each(controls)('固定控制%s失败不得发布或自动重试', async control => { denied = new RegExp('^' + control + '$'); await expect(statistics({ columns: [] })).rejects.toThrow('控制失败'); if (control !== controls[2]) expect(aggregation()).toEqual([]); else expect(aggregation()).toHaveLength(1); expect(sent.filter(sql => sql === control)).toHaveLength(1); expect(connections.at(-1)!.close).toHaveBeenCalledOnce(); });
  it('VIEW走真实身份/完整SHOW与同一只读事务，后核不误当BASE TABLE', async () => { kind = 'VIEW'; source = 'CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `subject` AS SELECT `id`,`big_value`,`amount`,`at_value`,`all_null`,`payload`,`label`,`approx_value`,`document`,`bit_value` FROM `db`.`source`'; const result = await statistics({ columns: [] }); expect(result.source.objectKind).toBe('view'); expect(sent.filter(sql => /^SHOW CREATE VIEW/.test(sql))).toHaveLength(2); });
  it('聚合后原VIEW定义或表字段变化不能发布混合定义', async () => { lateAt = 2; lateSource = source + " COMMENT='外部变化'"; await expect(statistics({ columns: [] })).rejects.toThrow('变化'); expect(aggregation()).toHaveLength(1); expect(sent).not.toContain(controls[2]); });
  it('OR/嵌套/停用与高精度参数保原服务器筛选语义，不借分页截断', async () => { const result = await statistics({ columns: [], filterMode: 'all', filters: [{ column: 'big_value', operator: '=', value: '18446744073709551615' }, { column: 'amount', operator: 'BETWEEN', values: ['-9007199254740993.123456789011', '9007199254740993.123456789012'] }, { column: 'label', operator: '=', value: '禁用值', enabled: false }], filterGroup: { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, 2] } }); expect(result.columns).toEqual([]); const sql = aggregation()[0]; expect(sql).toContain(' OR '); expect(sql).toContain('BETWEEN'); expect(sql).toContain('DECIMAL(65,12)'); expect(sql).not.toContain(Buffer.from('禁用值').toString('hex')); expect(sql).not.toContain('18446744073709552000'); });
  it.each([Array.from({ length: 13 }, () => 'big_value'), ['big_value', 'big_value'], ['不存在'], ['big_value` FROM subject;DELETE']].map(selected => ({ selected })))('超字段/重复/未知列%j零聚合', async ({ selected }) => { await expect(statistics({ columns: selected })).rejects.toThrow(); expect(aggregation()).toEqual([]); });
  it('未知停用筛选字段也不能绕过目录白名单', async () => { await expect(statistics({ columns: [], filters: [{ column: '不存在', operator: '=', value: '1', enabled: false }] })).rejects.toThrow('未知筛选字段'); expect(aggregation()).toEqual([]); });
  it.each([[{ Level: 'Warning', Code: 1265, Message: '合成截断' }], [{ Level: 'Note', Code: 1003, Message: '合成说明' }]].map(diagnostic => ({ diagnostic })))('SHOW WARNINGS存在任何原诊断%j拒绝全部输出', async ({ diagnostic }) => { warnings = diagnostic; await expect(statistics({ columns: [] })).rejects.toThrow('警告'); expect(aggregation()).toHaveLength(1); expect(sourceReads).toBe(1); });
  it.each([undefined, 1, 65535])('原聚合EOF警告计数%j不可当作可靠无警告', async warning => { eofWarnings = warning; await expect(statistics({ columns: [] })).rejects.toThrow('警告'); expect(sent).toContain('SHOW WARNINGS LIMIT 21'); });
  it('SHOW WARNINGS权限或读取失败不发布，原SELECT不会重放', async () => { denied = /^SHOW WARNINGS/; await expect(statistics({ columns: [] })).rejects.toThrow('目录拒读'); expect(aggregation()).toHaveLength(1); });
  it('多行/多结果/错误别名不能伪装单行聚合', async () => { rows = [['123'], ['123']]; await expect(statistics({ columns: [] })).rejects.toThrow(); rows = undefined; extraResult = true; await expect(statistics({ columns: [] })).rejects.toThrow(); extraResult = false; fieldPatch = () => ['rowCount伪造']; await expect(statistics({ columns: [] })).rejects.toThrow(); });
  it.each(['01', '-1', '1.0', 123])('非规范COUNT%j不隐式转成十进制字符串', async count => { valuePatch = () => [count]; await expect(statistics({ columns: [] })).rejects.toThrow('无效'); });
  it('计数与NULL总量矛盾、超长原字节事实都拒绝而不悄悄给NULL', async () => { valuePatch = value => { value[1] = '124'; return value; }; await expect(statistics({ columns: ['payload'] })).rejects.toThrow('无效'); valuePatch = value => { value[5] = null; value[6] = '262145'; return value; }; await expect(statistics({ columns: ['payload'] })).rejects.toThrow('预算'); });
  it('实际UTF8极值超过256KiB，即使目录字节事实伪小也不能发布', async () => { valuePatch = value => { value[3] = '中'.repeat(87382); value[4] = '1'; return value; }; await expect(statistics({ columns: ['label'] })).rejects.toThrow('预算'); });
  it('metadata超过4096行明确失败并关闭，不能载入整个表后客户端统计', async () => { metadataOverflow = true; await expect(statistics({ columns: [] })).rejects.toThrow('预算'); expect(aggregation()).toEqual([]); });
  it('取消ACK不代替原聚合终态，等待原error/end与strictclose再结算', async () => { holdAggregate = true; const taskId = 'stats-' + sequence; let settled = false; const pending = statistics({ columns: [] }).finally(() => { settled = true; }), failed = expect(pending).rejects.toThrow('取消'); await vi.waitFor(() => expect(originalEnd).toBeDefined()); const cancelled = engine.handle('query.cancel', { taskId }); await vi.waitFor(() => expect(killReceived).toBe(true)); expect(settled).toBe(false); originalEnd!(Error('原聚合已取消')); await cancelled; await failed; expect(events.at(-1)?.status).toBe('cancelled'); expect(sent).not.toContain(controls[2]); expect(connections.every(managed => (managed.connection as unknown as { stream: { closed: boolean } }).stream.closed)).toBe(true); });
  it('严格关闭失败保留未知资源，结果不能当作成功发布', async () => { closeFails = true; await expect(statistics({ columns: [] })).rejects.toThrow('关闭'); expect(unknownClose).toBe(true); expect(events.at(-1)?.status).toBe('failed'); });
});

describe('按需去重计数保持原真实Engine流和事务终态（仅RAM）', () => {
  it('数字/ci文字/binary/BIT同一原聚合去重，JSON不假造能力，警示只出现一次', async () => {
    const selected = ['big_value', 'label', 'payload', 'bit_value', 'document', 'all_null'];
    const result = await statistics({ columns: selected, distinct: true });
    expect(result.columns.map(column => column.name)).toEqual(selected);
    expect(result.columns[0]).toMatchObject({ kind: 'numeric', distinct: '3', max: '18446744073709551615', sum: '36893488147419103229' });
    expect(result.columns[1]).toMatchObject({ kind: 'ordered', distinct: '3', min: 'Alpha', max: 'fill' });
    expect(result.columns[2]).toMatchObject({ kind: 'ordered', distinct: '2', min: { type: 'binary', base64: '' }, max: { type: 'binary', base64: 'AP8=' } });
    expect(result.columns[3]).toMatchObject({ kind: 'numeric', distinct: '2', max: '18446744073709551615' });
    expect(result.columns[4]).toMatchObject({ kind: 'count-only' }); expect(result.columns[4]).not.toHaveProperty('distinct');
    expect(result.columns[5]).toMatchObject({ distinct: '0', nonNull: '0', min: null, max: null, sum: null, avg: null });
    const sql = aggregation()[0]; expect(aggregation()).toHaveLength(1);
    for (const name of ['big_value', 'label', 'payload', 'bit_value', 'all_null']) expect(sql).toContain(`COUNT(DISTINCT \`${name}\`)`);
    expect(sql).not.toContain('COUNT(DISTINCT `document`)'); expect(sql).not.toContain('COUNT(DISTINCT CAST('); expect(sql).not.toMatch(/\bCOLLATE\b|\bBINARY\b/);
    for (const operation of ['MIN', 'MAX', 'SUM', 'AVG']) expect(sql).toContain(operation + '(CAST(`bit_value` AS UNSIGNED))');
    expect(result.warnings.filter(warning => warning === tableStatisticsMessages.distinct)).toHaveLength(1);
    expect(sent.slice(0, 2)).toEqual(controls.slice(0, 2)); expect(sent[sent.indexOf(sql) + 1]).toBe('SHOW WARNINGS LIMIT 21'); expect(sent.at(-1)).toBe(controls[2]);
    expect(connections.slice(1).every(managed => vi.mocked(managed.close).mock.calls[0]?.[0]?.strict === true)).toBe(true);
  });
  it('默认与显式false沿完全相同SQL和旧结果形状，不添加性能警示', async () => {
    const omitted = await statistics({ columns: ['label'] }), disabled = await statistics({ columns: ['label'], distinct: false });
    expect(aggregation()).toHaveLength(2); expect(aggregation()[1]).toBe(aggregation()[0]); expect(aggregation()[0]).not.toContain('DISTINCT');
    expect(disabled).toEqual(omitted); expect(omitted.columns[0]).not.toHaveProperty('distinct'); expect(disabled.columns[0]).not.toHaveProperty('distinct');
    expect(disabled.warnings).not.toContain(tableStatisticsMessages.distinct);
  });
  it.each([[], ['document']].map(selected => ({ selected })))('true但无支持列%j不生成去重或警示', async ({ selected }) => {
    const result = await statistics({ columns: selected, distinct: true });
    expect(aggregation()).toHaveLength(1); expect(aggregation()[0]).not.toContain('DISTINCT'); expect(result.warnings).not.toContain(tableStatisticsMessages.distinct); expect(result.columns.every(column => !Object.hasOwn(column, 'distinct'))).toBe(true);
  });
  it('UINT64计数和超过Number安全整数的去重原文本不被舍入', async () => {
    rowCount = '18446744073709551615'; valuePatch = value => { value[1] = rowCount; value[2] = '0'; value[3] = '9007199254740993'; return value; };
    const result = await statistics({ columns: ['big_value'], distinct: true });
    expect(result.rowCount).toBe(rowCount); expect(result.columns[0]).toMatchObject({ nonNull: rowCount, distinct: '9007199254740993' });
  });
  it('空筛选结果去重为0，极值和数值合计仍全NULL', async () => {
    rowCount = '0'; valuePatch = () => ['0', '0', '0', '0', null, null, null, null, null, null];
    const result = await statistics({ columns: ['big_value'], distinct: true, filters: [{ column: 'label', operator: '=', value: '不存在的固定值' }] });
    expect(result.columns[0]).toMatchObject({ nonNull: '0', nulls: '0', distinct: '0', min: null, max: null, sum: null, avg: null });
    expect(aggregation()[0]).toContain(' WHERE '); expect(aggregation()).toHaveLength(1);
  });
  it.each(['01', '-1', '1.0', 'NaN', '0', '123', 1, null, undefined])('非规范/矛盾去重%j拒绝整包而不发布部分统计', async count => {
    valuePatch = value => { value[3] = count; return value; };
    // undefined不是合法线协议字段，原协议预算先拒绝；其它已序列化值由统计计数校验拒绝。
    await expect(statistics({ columns: ['label'], distinct: true })).rejects.toThrow(count === undefined ? '驱动返回了不能无损序列化的字段类型' : '无效');
    expect(aggregation()).toHaveLength(1); expect(sent).not.toContain(controls[2]); expect(events.at(-1)?.status).toBe('failed'); expect(connections.at(-1)!.close).toHaveBeenCalledOnce();
  });
  it.each(['wrong', 'missing', 'extra'])('原流去重别名%s不能错位、缺项或多项', async kind => {
    fieldPatch = fields => kind === 'wrong' ? fields.map(field => field === 'c0_distinct' ? 'c0_distinct伪造' : field) : kind === 'missing' ? fields.filter(field => field !== 'c0_distinct') : [...fields, 'c0_extra'];
    await expect(statistics({ columns: ['label'], distinct: true })).rejects.toThrow(); expect(aggregation()).toHaveLength(1); expect(sent).not.toContain(controls[2]); expect(connections.at(-1)!.close).toHaveBeenCalledOnce();
  });
  it('请求去重也不能绕过原聚合warning失败门', async () => {
    warnings = [{ Level: 'Warning', Code: 1265, Message: '合成统计去重警告' }];
    await expect(statistics({ columns: ['label'], distinct: true })).rejects.toThrow('警告'); expect(aggregation()).toHaveLength(1); expect(sourceReads).toBe(1); expect(sent).not.toContain(controls[2]);
  });
  it('去重聚合取消仍等待原终包和strictclose，不返回部分去重数', async () => {
    holdAggregate = true; const taskId = 'stats-' + sequence; let settled = false;
    const pending = statistics({ columns: ['label'], distinct: true }).finally(() => { settled = true; }), failed = expect(pending).rejects.toThrow('取消');
    await vi.waitFor(() => expect(originalEnd).toBeDefined()); const cancelled = engine.handle('query.cancel', { taskId }); await vi.waitFor(() => expect(killReceived).toBe(true));
    expect(settled).toBe(false); originalEnd!(Error('原去重聚合已取消')); await cancelled; await failed;
    expect(events.at(-1)?.status).toBe('cancelled'); expect(sent).not.toContain(controls[2]); expect(aggregation()).toHaveLength(1); expect(connections.every(managed => (managed.connection as unknown as { stream: { closed: boolean } }).stream.closed)).toBe(true);
  });
});
