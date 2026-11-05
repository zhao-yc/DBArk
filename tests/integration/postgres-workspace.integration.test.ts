import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import type { PostgresConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';

const enabled = process.env.DBARK_POSTGRES_WORKSPACE_TEST === '1';
const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
const user = process.env.DBARK_POSTGRES_TEST_USER ?? '';
const password = process.env.DBARK_POSTGRES_TEST_PASSWORD;
const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);

describe.skipIf(!enabled)('PostgreSQL真实连接、查询、事务及取消', () => {
  it('从统一引擎使用隔离角色和库，保留类型精度、错误终态及原事务', async () => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) ||
        user !== database || !password || !Number.isInteger(port) || port <= 1024 || port > 65535) {
      throw Error('PostgreSQL实库仅允许本轮隔离角色与SSH回环入口');
    }
    const id = randomUUID(), events: TaskEvent[] = [];
    const profile: PostgresConnectionProfile = { id, name: '隔离PG', group: '', color: '#123456', dialect: 'postgresql',
      host: '127.0.0.1', port, user, password, database, rememberPassword: false };
    const engine = new Engine(event => events.push(event));
    const call = (command: Parameters<Engine['handle']>[0], input: Record<string, unknown>) => engine.handle(command, input);
    expect(await call('connections.test', profile as unknown as Record<string, unknown>)).toMatchObject({ dialect: 'postgresql' });
    await call('connections.open', { id, profile });
    expect(await call('metadata.databases', { connectionId: id })).toContain(database);
    const { sessionId } = await call('sessions.open', { connectionId: id, database });
    const state = () => call('query.sessionState', { sessionId });
    const execute = (sql: string, taskId = randomUUID(), extra = {}): Promise<QueryOutcome> =>
      call('query.execute', { sessionId, taskId, sql, maxRows: 1000, ...extra });
    const setup = await execute(`
      CREATE SCHEMA IF NOT EXISTS "回归";
      CREATE TABLE IF NOT EXISTS "回归"."带""引号" (id bigint PRIMARY KEY, note text);
      INSERT INTO "回归"."带""引号" VALUES (1, '原值') ON CONFLICT (id) DO NOTHING;
      SELECT 9223372036854775807::bigint AS "同名", 1234567890123456789012.123456789012345678::numeric AS "同名",
        TIMESTAMP '2026-01-02 03:04:05.123456' AS "微秒", decode('00ff','hex') AS "字节",
        '{"n":9007199254740993, "n":1e999}'::json AS "原文", NULL AS "空值", '' AS "空串";
    `);
    expect(setup.failure).toBeUndefined();
    expect(setup.results).toHaveLength(4);
    expect(setup.results[3].columns.slice(0, 2)).toMatchObject([{ name: '同名', key: 'c0' }, { name: '同名', key: 'c1' }]);
    expect(setup.results[3].rows).toEqual([{ c0: '9223372036854775807', c1: '1234567890123456789012.123456789012345678',
      c2: '2026-01-02 03:04:05.123456', c3: { type: 'binary', base64: 'AP8=' },
      c4: '{"n":9007199254740993, "n":1e999}', c5: null, c6: '' }]);
    expect(await call('metadata.objects', { connectionId: id, database })).toContainEqual({ name: '"回归"."带""引号"', kind: 'table' });
    const sql = "SELECT $2::text AS value, $1::bytea AS raw, $1::bytea AS again, '$3' AS literal";
    expect(await call('query.parameterNames', { sessionId, sql })).toMatchObject({ names: ['p1', 'p2'] });
    const parameterized: QueryOutcome = await call('query.executeParameterized', { sessionId, taskId: randomUUID(), sql, maxRows: 10,
      parameters: [{ name: 'p1', type: 'binary', value: '00ff' }, { name: 'p2', type: 'text', value: "x'; DROP TABLE t; --" }] });
    expect(parameterized.failure).toBeUndefined();
    expect(parameterized.results[0].rows[0]).toEqual({ c0: "x'; DROP TABLE t; --", c1: { type: 'binary', base64: 'AP8=' },
      c2: { type: 'binary', base64: 'AP8=' }, c3: '$3' });
    const mode = await execute(String.raw`SET standard_conforming_strings=off; SELECT 'a\';b', $标签$含;号$标签$; RESET standard_conforming_strings;`);
    expect(mode.failure).toBeUndefined();
    expect(mode.results[1].rows[0]).toEqual({ c0: "a';b", c1: '含;号' });
    const script = 'SELECT 4; SELECT 5; SELECT 6;';
    expect((await execute(script, randomUUID(), { currentStatement: { offset: script.indexOf('5') } })).results[0].rows).toEqual([{ c0: '5' }]);
    const clipped = await execute('SELECT generate_series(1,4); SELECT 8;', randomUUID(), { maxRows: 2 });
    expect(clipped.results.map(result => [result.rows.length, result.truncated])).toEqual([[2, true], [0, true]]);
    const failure = await execute('BEGIN; UPDATE "回归"."带""引号" SET note = \'事务内\' WHERE id = 1; SELECT 1/0; SELECT 7;');
    expect(failure.failure).toMatchObject({ statementOrdinal: 3, statementsCompleted: 2 });
    expect(await state()).toMatchObject({ transactionKnown: true, transactionOpen: true, transactionFailed: true });
    await expect(call('query.transaction', { sessionId, action: 'commit' })).rejects.toThrow('请明确回滚');
    expect((await execute('COMMIT')).results[0].postgresCommand).toBe('ROLLBACK');
    expect(await state()).toMatchObject({ transactionKnown: true, transactionOpen: false, transactionFailed: false });
    const copy = await execute('COPY "回归"."带""引号" TO STDOUT; SELECT 9;');
    expect(copy.failure?.message).toContain('当前SQL执行未发送');
    expect(copy.results).toEqual([]);

    const taskId = randomUUID(), started = Date.now();
    const running = execute('SELECT pg_sleep(30); SELECT 99;', taskId);
    await expect.poll(() => events.some(event => event.taskId === taskId && event.executionSql?.includes('pg_sleep')), { timeout: 3000 }).toBe(true);
    expect(await state()).toMatchObject({ transactionKnown: false });
    await call('query.cancel', { taskId });
    const cancelled = await running;
    expect(Date.now() - started).toBeLessThan(20000);
    expect(cancelled.failure?.statementOrdinal).toBe(1);
    expect(cancelled.results).toEqual([]);
    expect(events.filter(event => event.taskId === taskId).at(-1)?.status).toBe('cancelled');
    expect((await execute('SELECT note FROM "回归"."带""引号" WHERE id = 1')).results[0].rows).toEqual([{ c0: '原值' }]);
    const { sessionId: controlSession } = await call('sessions.open', { connectionId: id, database });
    const backend = (await execute('SELECT pg_backend_pid()')).results[0].rows[0].c0;
    expect(typeof backend).toBe('string');
    const lostId = randomUUID(), lost = execute('BEGIN; SELECT pg_sleep(30); SELECT 99;', lostId);
    await expect.poll(() => events.some(event => event.taskId === lostId && event.executionSql?.includes('pg_sleep')), { timeout: 3000 }).toBe(true);
    const terminated: QueryOutcome = await call('query.executeParameterized', { sessionId: controlSession, taskId: randomUUID(),
      sql: 'SELECT pg_terminate_backend($1)', maxRows: 10, parameters: [{ name: 'p1', type: 'integer', value: backend }] });
    expect(terminated.results[0].rows[0].c0).toBe('t');
    expect((await lost).failure?.statementOrdinal).toBe(2);
    expect(await state()).toMatchObject({ transactionKnown: false, broken: true });
    await expect(execute('SELECT 99')).rejects.toThrow('会话已失效');
    await call('sessions.close', { sessionId });

    const closingId = randomUUID(), closingSql = 'SELECT pg_sleep(30); SELECT 99;';
    const active = call('query.execute', { sessionId: controlSession, taskId: closingId, sql: closingSql, maxRows: 10 });
    await expect.poll(() => events.some(event => event.taskId === closingId && event.executionSql?.includes('pg_sleep')), { timeout: 3000 }).toBe(true);
    const disconnect = call('connections.close', { id });
    await expect(call('query.execute', { sessionId: controlSession, taskId: randomUUID(), sql: 'SELECT 11', maxRows: 10 })).rejects.toThrow('正在关闭');
    expect((await active).results).toEqual([]);
    await disconnect;
    await engine.closeAll();
  }, 60000);
});
