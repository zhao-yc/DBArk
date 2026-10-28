import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createTableFilteredExportSqlAudit, collectTableFilteredExportRows, tableFilteredExportSqlTokens, watchTableFilteredExportConnection } from '../helpers/tableFilteredExportSqlAudit';
import { planTableFilteredExportFixture } from '../helpers/tableFilteredExportIntegration';
import { planTableFilteredExport } from '../../src/engine/tableFilteredExport';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import type { TableInfo } from '../../src/shared/contracts';
import type { TableFilteredExportInput } from '../../src/shared/tableFilteredExport';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableValueOptionsLifetime } from '../helpers/tableValueOptionsIntegration';

const database = 'dbark_filteredexport_' + 'a'.repeat(32), marker = 'dbark-filtered-export:' + 'b'.repeat(32);
function policy() { const plan = planTableFilteredExportFixture(database, marker), fixtureWrites = new Set<string>(); return { plan, fixtureWrites, audit: createTableFilteredExportSqlAudit({ database, fixtureStatements: [...plan.creates, ...plan.seeds, plan.drop], fixtureWrites, isOwnedThread: id => id === 123 }) }; }
const info = (view = false): TableInfo => ({ database, name: view ? 'subject_view' : 'subject', objectKind: view ? 'view' : 'table', engine: view ? '' : 'InnoDB', ddl: 'CREATE TABLE subject(id INT)', indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], columns: ['id', 'label', 'big_value', 'amount', 'at_value', 'payload', 'bit_value', 'approx_value', 'json_value', 'computed'].map(name => ({ name, type: name === 'id' ? 'INT' : 'TEXT', generated: name === 'computed', nullable: false, defaultValue: null, extra: '', comment: '' })) });
const request = (source: TableInfo): TableFilteredExportInput => ({ connectionId: 'c', database, table: source.name, fileToken: 'file', taskId: 'task', metadataKey: tableCopyMetadataKey(source), format: 'csv', encoding: 'utf8', filters: [{ column: 'id', operator: '>=', value: '1' }, { column: 'id', operator: '<', value: '0', enabled: false }, { column: 'id', operator: '<=', value: '1105' }], filterMode: 'all', filterGroup: { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, 2] }, sort: [{ column: 'label', direction: 'ASC' }, { column: 'id', direction: 'DESC' }] });

describe('完整筛选导出本专项窄SQL白名单', () => {
  it('新增两列只准准确amount/id顺序及原范围排序，不能外推任意字段或目标', () => {
    const { audit } = policy();
    // 模板独立手写，不用正式planner生成本轮审计正例。
    const statement = 'SELECT `amount`, `id` FROM `' + database + '`.`subject` WHERE (((`id` >= CAST(_utf8mb4 X\'31\' AS DECIMAL(65,0)))) AND (`id` <= CAST(_utf8mb4 X\'31313035\' AS DECIMAL(65,0)))) ORDER BY `label` ASC, `id` DESC';
    expect(() => audit.assert(statement, [], 'table.exportFiltered:nonce')).not.toThrow();
    for (const changed of [statement.replace('`amount`, `id`', '`id`, `amount`'), statement.replace('`amount`, `id`', '`amount`'), statement.replace('`amount`, `id`', '`amount`, `id`, `label`'), statement.replace('31313035', '31313036'), statement.replace('`subject`', '`subject_view`'), statement.replace('`label` ASC', '`label` DESC'), statement.replace(database, 'business'), statement + ' LIMIT 1000']) expect(() => audit.assert(changed, [], 'table.exportFiltered:nonce')).toThrow();
    expect(() => audit.assert(statement, [], 'metadata.table:nonce')).toThrow(); expect(() => audit.assert(statement, [], 'observer')).toThrow();
  });
  it('四格式实际受控投影都须符合独立列举的谓词、目标和ORDER模板', () => {
    const { audit } = policy(), source = info();
    for (const format of ['csv', 'json', 'sql', 'xlsx'] as const) expect(() => audit.assert(planTableFilteredExport(source, { ...request(source), format }).sql, [], 'table.exportFiltered:nonce')).not.toThrow();
    const view = info(true); expect(() => audit.assert(planTableFilteredExport(view, { ...request(view), format: 'json', filters: [{ column: 'label', operator: 'IN', values: ['ALPHA'] }], filterGroup: undefined }).sql, [], 'table.exportFiltered:nonce')).not.toThrow();
    expect(() => audit.assert(planTableFilteredExport(source, { ...request(source), filters: [{ column: 'id', operator: '<', value: '0' }], filterGroup: undefined }).sql, [], 'table.exportFiltered:nonce')).not.toThrow();
  });
  it('相似SELECT不能更改列、WHERE、ORDER、库、LIMIT或追加UNION', () => { const { audit } = policy(), source = info(), sql = planTableFilteredExport(source, request(source)).sql; for (const changed of [sql.replace('`payload`, ', ''), sql.replace('31313035', '31313036'), sql.replace('`id` DESC', '`id` ASC'), sql.replace(database, 'business'), sql + ' LIMIT 1000', sql + ' UNION SELECT 1']) expect(() => audit.assert(changed, [], 'table.exportFiltered:nonce')).toThrow(); });
  it('元数据只接受实际四模板绑定原库/subject或view，不能泛化全SELECT', () => {
    const { audit } = policy(), statement = 'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment, CHARACTER_SET_NAME AS characterSet FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION';
    expect(() => audit.assert(statement, [database, 'subject'], 'metadata.table:nonce')).not.toThrow(); expect(() => audit.assert(statement, ['business', 'subject'], 'metadata.table:nonce')).toThrow(); expect(() => audit.assert(statement, [database, '__owner'], 'metadata.table:nonce')).toThrow(); expect(() => audit.assert('SELECT * FROM information_schema.COLUMNS', [], 'metadata.table:nonce')).toThrow();
  });
  it('observer仅原资源精确fixture写，登记前拒绝，产品scope不能借fixture权限', () => {
    const { audit, plan, fixtureWrites } = policy(), seed = plan.seeds[1]; expect(() => audit.assert(seed, [], 'observer')).toThrow(); fixtureWrites.add(seed); expect(() => audit.assert(seed, [], 'observer')).not.toThrow(); expect(() => audit.assert(seed, [], 'table.exportFiltered:nonce')).toThrow(); expect(() => audit.assert(seed + ' ', [], 'observer')).toThrow();
  });
  it('PROCESSLIST仅准确库或已登记原线程，不能访问任意线程或其它schema', () => { const { audit } = policy(); expect(() => audit.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [123], 'observer')).not.toThrow(); expect(() => audit.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [124], 'observer')).toThrow(); expect(() => audit.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', ['business'], 'observer')).toThrow(); });
  it('只读事务仅属于实际导出scope，元数据不能借用控制语句', () => { const { audit } = policy(); for (const statement of ['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION READ ONLY', 'ROLLBACK AND NO CHAIN NO RELEASE']) { expect(() => audit.assert(statement, [], 'table.exportFiltered:nonce')).not.toThrow(); expect(() => audit.assert(statement, [], 'metadata.table:nonce')).toThrow(); } expect(() => audit.assert('START TRANSACTION', [], 'table.exportFiltered:nonce')).toThrow(); });
  it.each(['SELECT 1 INTO OUTFILE \'target\'', 'SELECT 1 INTO DUMPFILE \'target\'', 'SELECT 1 INTO @a', 'SELECT GET_LOCK(\'x\',1)', 'SELECT RELEASE_LOCK(\'x\')', 'SELECT SLEEP(1)', 'SELECT BENCHMARK(1,1)', 'SHOW WARNINGS LIMIT 21; SELECT 1', 'SELECT 1/*comment*/'])('拒绝副作用、多语句或隐藏SQL %s', statement => { expect(() => policy().audit.assert(statement, [], 'table.exportFiltered:nonce')).toThrow(); });
  it('JSON和字段原值中的关键字、分号、注释符不触发错误词法判定', () => { for (const sql of ["SELECT '{\"text\":\"INTO OUTFILE; GET_LOCK(1) -- # /* */\"}'", "SELECT 'it\\\'s ; SLEEP(1)'", 'SELECT `INTO`,`GET_LOCK`', "SELECT 'a''; BENCHMARK(1,1)'", 'SELECT "DUMPFILE; RELEASE_LOCK"']) expect(() => tableFilteredExportSqlTokens(sql)).not.toThrow(); });
  it('NO_BACKSLASH_ESCAPES/ANSI_QUOTES按实际模式识别，未闭合和真正双语句拒绝', () => { expect(() => tableFilteredExportSqlTokens("SELECT 'a\\'; SELECT SLEEP(1)'", 'NO_BACKSLASH_ESCAPES')).toThrow(); expect(() => tableFilteredExportSqlTokens('SELECT "SLEEP"', 'ANSI_QUOTES')).not.toThrow(); expect(() => tableFilteredExportSqlTokens("SELECT 'unfinished")).toThrow(); });
  it('参数访问器不执行，空洞和多余值不能冒充无参数模板', () => { const { audit } = policy(), getter = vi.fn(() => database), values = ['']; Object.defineProperty(values, '0', { get: getter }); expect(() => audit.assert('SELECT @@server_uuid AS uuid', values, 'observer')).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(() => audit.assert('SELECT @@server_uuid AS uuid', Array(1), 'observer')).toThrow(); });
});

describe('窄watch保留原命令与文件迭代owner门（纯RAM）', () => {
  it('原返回Command/回调/end和严格close/stream各自真实记录，不用SQL结果模拟释放', async () => {
    const { audit } = policy(), stream = Object.assign(new EventEmitter(), { closed: false }), command = new EventEmitter(), check = vi.fn(), stop = vi.fn(), rows = [{ uuid: 'native' }];
    const native = { threadId: 123, stream, query: vi.fn((...args: any[]) => { queueMicrotask(() => { args.at(-1)(null, rows, []); command.emit('end'); }); return command; }), execute: vi.fn() };
    const managed = { connection: native, sqlMode: '', close: vi.fn(async () => { stream.closed = true; stream.emit('close'); }) } as unknown as ManagedConnection;
    const fact = watchTableFilteredExportConnection(managed, 'observer', { check, stop } as unknown as TableValueOptionsLifetime, audit), callback = vi.fn(); expect(native.query('SELECT @@server_uuid AS uuid', callback)).toBe(command); await Promise.resolve(); expect(callback).toHaveBeenCalledWith(null, rows, []); expect(fact.pending).toBe(0); expect(fact.commands[0]).toMatchObject({ terminal: true, callbackReturned: true, streamed: false }); await managed.close({ strict: true }); await fact.closed; expect(fact).toMatchObject({ closeCalls: 1, strict: true, closeReturned: true, sawClose: true }); expect(stop).not.toHaveBeenCalled();
  });
  it('未知SQL在底层发送前停止owner，不能借旧helper SELECT前缀绕过', () => { const { audit } = policy(), native = { threadId: 123, stream: Object.assign(new EventEmitter(), { closed: false }), query: vi.fn((..._args: unknown[]) => undefined), execute: vi.fn() }, send = native.query, stop = vi.fn(); watchTableFilteredExportConnection({ connection: native, sqlMode: '', close: vi.fn() } as unknown as ManagedConnection, 'observer', { check: vi.fn(), stop } as unknown as TableValueOptionsLifetime, audit); expect(() => native.query('SELECT GET_LOCK(\'x\',1)', () => {})).toThrow(); expect(stop).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled(); });
  it('每次next独立经过owner.step，失效后不再next或自动return/删除现场', async () => {
    let stopped = false, calls = 0; const check = vi.fn(() => { if (stopped) throw Error('原owner已停链'); }), next = vi.fn(async (): Promise<IteratorResult<number>> => { calls++; if (calls === 2) stopped = true; return { done: false, value: calls }; }), returned = vi.fn(), source = { [Symbol.asyncIterator]: () => ({ next, return: returned }) };
    const step = vi.fn(async <T>(action: () => Promise<T>) => { check(); const value = await action(); check(); return value; });
    await expect(collectTableFilteredExportRows(source, { check, step: step as TableValueOptionsLifetime['step'] })).rejects.toThrow('停链'); expect(next).toHaveBeenCalledTimes(2); expect(step).toHaveBeenCalledTimes(2); expect(returned).not.toHaveBeenCalled();
  });
});
