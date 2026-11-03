import { expect, it, vi } from 'vitest';
import { assertSqliteRowCount, assertSqliteStatistics, sqliteRowCountInputSchema, sqliteStatisticsInputSchema, type SqliteRowCountInput, type SqliteRowCountOutput, type SqliteStatisticsInput, type SqliteStatisticsOutput } from '../../src/shared/sqliteStatistics';
import { SqliteStatisticsController } from '../../src/renderer/sqliteStatistics';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';

const request: SqliteStatisticsInput = { connectionId: 'c', database: 'main', table: 'subject', column: 'v', schemaKey: 'a'.repeat(64), taskId: 'stats', mode: 'and', filters: [] };
it('行数请求拒绝列、SQL和分页，精确回包绑定原任务和条件', () => {
  const { column: _column, ...input } = request;
  for (const extra of [{ column: 'v' }, { sql: 'SELECT 1' }, { limit: 5 }, { filePath: '外部文件' }]) expect(sqliteRowCountInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  expect(assertSqliteRowCount({ request: input, rows: '9223372036854775807' }, input).rows).toBe('9223372036854775807');
  expect(() => assertSqliteRowCount({ request: input, rows: '9223372036854775808' }, input)).toThrow();
  expect(() => assertSqliteRowCount({ request: { ...input, mode: 'or' }, rows: '0' }, input)).toThrow('原请求');
});
const output = (): SqliteStatisticsOutput => ({ request: structuredClone(request), declaredType: '', rows: '4', nulls: '1', nonNull: '3', groups: [
  { kind: 'integer', count: '3', distinct: '2', min: { kind: 'integer', value: '-9223372036854775808' }, max: { kind: 'integer', value: '9223372036854775807' } },
  { kind: 'null', count: '1', distinct: '0', min: { kind: 'null' }, max: { kind: 'null' } },
] });
it.each(['running', 'completed', 'failed', 'cancelled'] as const)('%s任务概要不保存筛选、极值或错误原文', status => {
  const message = persistedTaskMessage('sqlite.statistics', { taskId: 'stats', status, progress: 0, message: '敏感筛选／极值／SQL错误' }); expect(message).not.toContain('敏感'); expect(message).toContain('SQLite');
});
it('64位原文、空集和NULL整份通过，字段/结构/任务均绑定', () => {
  expect(assertSqliteStatistics(output(), request).groups[0].max).toEqual({ kind: 'integer', value: '9223372036854775807' });
  expect(assertSqliteStatistics({ request, declaredType: '', rows: '0', nulls: '0', nonNull: '0', groups: [] }, request).groups).toEqual([]);
  for (const key of ['taskId', 'column', 'schemaKey', 'table'] as const) expect(() => assertSqliteStatistics(output(), { ...request, [key]: key === 'schemaKey' ? 'b'.repeat(64) : 'other' })).toThrow();
});
it('完整64KiB二进制可展示，不借用32KiB筛选选值预算；超限整份拒绝', () => {
  const raw = 'ab'.repeat(65536), value = { request, declaredType: 'BLOB', rows: '1', nonNull: '1', nulls: '0', groups: [{ kind: 'blob', count: '1', distinct: '1', min: { kind: 'blob', value: raw }, max: { kind: 'blob', value: raw } }] };
  expect(assertSqliteStatistics(value, request).groups[0].count).toBe('1'); value.groups[0].max.value += 'ff'; expect(() => assertSqliteStatistics(value, request)).toThrow('预算');
});
it.each(['sql', 'filePath', 'profile', 'sessionId', 'editing'])('输入拒绝额外%s', key => {
  expect(sqliteStatisticsInputSchema.safeParse({ ...request, [key]: '不可接纳' }).success).toBe(false);
});
it('条件仍受原分页预算和typed规则限制，不改整数身份', () => {
  const filter = { column: 'v', operator: 'eq' as const, value: { kind: 'integer' as const, value: '9223372036854775807' } };
  expect(sqliteStatisticsInputSchema.parse({ ...request, filters: [filter] }).filters).toEqual([filter]);
  expect(sqliteStatisticsInputSchema.safeParse({ ...request, filters: Array.from({ length: 33 }, () => filter) }).success).toBe(false);
});
it.each(['sum', 'kind', 'null-distinct', 'distinct', 'zero', 'duplicate', 'unsorted', 'bounds', 'oversize', 'count', 'extra'] as const)('整份拒绝%s，不留部分概况', mutation => {
  const result: any = output();
  if (mutation === 'sum') result.rows = '5';
  if (mutation === 'kind') result.groups[0].min = { kind: 'text', value: '1' };
  if (mutation === 'null-distinct') result.groups[1].distinct = '1';
  if (mutation === 'distinct') result.groups[0].distinct = '4';
  if (mutation === 'zero') result.groups[0].count = '0';
  if (mutation === 'duplicate') result.groups.push(result.groups[0]);
  if (mutation === 'unsorted') result.groups.reverse();
  if (mutation === 'bounds') [result.groups[0].min, result.groups[0].max] = [result.groups[0].max, result.groups[0].min];
  if (mutation === 'oversize') result.groups[0] = { kind: 'text', count: '3', distinct: '2', min: { kind: 'text', value: '中'.repeat(30000) }, max: { kind: 'text', value: '中'.repeat(30000) } };
  if (mutation === 'count') result.rows = '不是整数';
  if (mutation === 'extra') result.sql = '不可执行';
  expect(() => assertSqliteStatistics(result, request)).toThrow();
});
/** 可控端口只制造两个独立终态及代次，概况的数量验证仍走生产校验器。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const reading = deferred<SqliteStatisticsOutput>(), cancel = deferred<void>(), state = { current: true, owns: true }, release = vi.fn(), read = vi.fn(async (_request: SqliteStatisticsInput) => reading.promise), cancelPort = vi.fn(async () => cancel.promise), changed = vi.fn(), cleanup = vi.fn();
  const base = { connectionId: request.connectionId, database: request.database, table: request.table, schemaKey: request.schemaKey, mode: request.mode, filters: request.filters };
  const counting = deferred<SqliteRowCountOutput>(), countRows = vi.fn(async (_input: SqliteRowCountInput) => counting.promise);
  const controller = new SqliteStatisticsController({ base, current: () => state.current, acquire: () => ({ owns: () => state.owns, release }), read, countRows, cancel: cancelPort, id: () => 'stats', changed, cleanup });
  return { controller, base, state, reading, cancel, release, read, counting, countRows, cancelPort, changed, cleanup };
}
it('行数与字段统计互斥，完成后保留精确总数原文', async () => {
  const f = fixture(), work = f.controller.countRows(); await f.controller.read('v');
  const input = { ...f.base, taskId: 'stats' };
  expect(f.countRows).toHaveBeenCalledExactlyOnceWith(input); expect(f.read).not.toHaveBeenCalled();
  f.counting.resolve({ request: input, rows: '9007199254740993' }); await work;
  expect(f.controller.view.rowCount).toBe('9007199254740993'); expect(f.release).toHaveBeenCalledOnce();
});
it('打开及选择字段零读取，连点不重复投递，完成归还准确租约', async () => {
  const f = fixture(); f.controller.clear(); expect(f.read).not.toHaveBeenCalled(); const work = f.controller.read('v'); await f.controller.read('v'); await Promise.resolve(); expect(f.read).toHaveBeenCalledExactlyOnceWith(request);
  f.reading.resolve(output()); await work; expect(f.controller.view.output).toEqual(output()); expect(f.release).toHaveBeenCalledOnce();
});
it.each(['read-first', 'ack-first'] as const)('取消%s仍等原Promise与ACK两侧终态，未释放前不能再读', async order => {
  const f = fixture(), work = f.controller.read('v'); await Promise.resolve(); const stop = f.controller.stop(); await Promise.resolve();
  if (order === 'read-first') f.reading.resolve(output()); else f.cancel.resolve(); await Promise.resolve(); await Promise.resolve(); expect(f.release).not.toHaveBeenCalled();
  await f.controller.read('v'); expect(f.read).toHaveBeenCalledOnce();
  if (order === 'read-first') f.cancel.resolve(); else f.reading.resolve(output()); await stop; await work; expect(f.release).toHaveBeenCalledOnce(); expect(f.controller.view.output).toBeUndefined(); expect(f.cancelPort).toHaveBeenCalledExactlyOnceWith('stats');
});
it.each(['scope', 'lease', 'dispose', 'base', 'forged'] as const)('%s改变后迟到结果不能发布', async kind => {
  const f = fixture(), work = f.controller.read('v'); await Promise.resolve();
  if (kind === 'scope') { f.state.current = false; f.controller.observe(); f.state.current = true; }
  if (kind === 'lease') f.state.owns = false;
  if (kind === 'dispose') f.controller.dispose();
  if (kind === 'base') f.base.table = 'other';
  f.reading.resolve(kind === 'forged' ? { ...output(), rows: '9' } : output()); f.cancel.resolve(); await work;
  expect(f.controller.view.output).toBeUndefined(); expect(f.release).toHaveBeenCalledOnce();
});
it('取消错误只报准确清理问题，不重放或先释放原读取', async () => {
  const f = fixture(), work = f.controller.read('v'); await Promise.resolve(); const stop = f.controller.stop(); f.cancel.reject(Error('本例取消失败')); await Promise.resolve(); await Promise.resolve(); expect(f.release).not.toHaveBeenCalled();
  f.reading.resolve(output()); await work; await stop; expect(f.cleanup).toHaveBeenCalledOnce(); expect(f.controller.view.output).toBeUndefined(); expect(f.read).toHaveBeenCalledOnce();
});
