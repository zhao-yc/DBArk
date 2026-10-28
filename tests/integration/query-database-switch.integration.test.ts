import { randomBytes, randomUUID } from 'node:crypto';
import mysql from 'mysql2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier, qualified, stringLiteral } from '../../src/engine/sql';
import type { ConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import type { CompletionSessionState } from '../../src/shared/sqlCompletion';
import { queryDatabaseFromSession } from '../../src/shared/queryContext';

// 本套件须另行授权两个dbark_dbswitch_*库、subject表及一个仅能SELECT A.subject的随机隔离账户。
// 通用实库开关不足以启用；六实例各自显式开启专项开关后串行执行，不自动重试失败轮次。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_DATABASE_SWITCH_INTEGRATION_ENABLED === '1';
const suffix = randomUUID().replaceAll('-', '').slice(0, 12), a = `dbark_dbswitch_${suffix}_a`, b = `dbark_dbswitch_${suffix}_b`, missing = `dbark_dbswitch_${suffix}_missing`;
const restrictedUser = `dbark_dbswitch_u_${suffix}`, restrictedHost = '%', restrictedPassword = 'Aa1!' + randomBytes(36).toString('base64url');
const restrictedAccount = stringLiteral(restrictedUser) + '@' + stringLiteral(restrictedHost);
const profile: ConnectionProfile = { id: randomUUID(), name: '显式切库专项验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 13384), user: process.env.DBARK_TEST_USER ?? '', password: process.env.DBARK_TEST_PASSWORD, ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
const events: TaskEvent[] = [], engine = new Engine(event => events.push(event)), drivers = new Set<ReturnType<typeof mysql.createConnection>>(), sent: { driver: ReturnType<typeof mysql.createConnection>; sql: string }[] = [];
const schemas: { driver: ReturnType<typeof mysql.createConnection>; sql?: string; schema: string }[] = [];
let observer: ManagedConnection | undefined, restore: (() => void) | undefined, failed = false, restrictedUserCreated = false;

/** 只保存资源名、端口和原线程号，日志不携带连接口令。 */
function lifecycle(phase: string, extra: Record<string, unknown> = {}) { console.log(JSON.stringify({ 专项: '显式切换默认库', 阶段: phase, 端口: profile.port, 隔离库: [a, b], 隔离账户: { user: restrictedUser, host: restrictedHost }, 账户创建已确认: restrictedUserCreated, ...extra })); }
/** 只读缓存不附加诊断，实际命令统一走生产Engine入口。 */
const state = (sessionId: string): Promise<CompletionSessionState> => engine.handle('query.completionState', { sessionId });
const run = (sessionId: string, sql: string): Promise<QueryOutcome> => engine.handle('query.execute', { sessionId, sql, taskId: randomUUID(), maxRows: 20 });
/** 结果显示列名不等于稳定行键，大整数原值不能转成Number。 */
function cell(outcome: QueryOutcome, name: string) { const result = outcome.results[0], columns = result.columns.filter(column => column.name === name); expect(columns).toHaveLength(1); return result.rows[0][columns[0].key]; }
/** 每例关闭原session；失败标记保留库现场，afterAll不自动DROP或重跑。 */
async function session(body: (id: string) => Promise<void>, connectionId = profile.id) {
  let sessionId: string | undefined;
  try { const opened: { sessionId: string } = await engine.handle('sessions.open', { connectionId, database: a }); sessionId = opened.sessionId; await body(sessionId); }
  catch (error) { failed = true; lifecycle('失败保留现场', { 会话: sessionId }); throw error; }
  finally { if (sessionId) try { await engine.handle('sessions.close', { sessionId }); } catch (error) { failed = true; throw error; } }
}
/** 统计原物理线程上的真实投递，不把新建连诊断或观察者SQL混入USE次数。 */
function commands(id: unknown, start: number) { return sent.slice(start).filter(item => String(item.driver.threadId) === String(id)).map(item => item.sql); }

describe.skipIf(!enabled)('200六指定隔离实例：显式切库专项', () => {
  beforeAll(async () => {
    if (profile.host !== '192.168.31.200' || ![13357, 13380, 13384, 13310, 13311, 13484].includes(profile.port)) throw Error('只允许已核对的200六指定隔离实例');
    const create = mysql.createConnection;
    const recording = vi.spyOn(mysql, 'createConnection').mockImplementation(config => {
      const driver = create(config), query = driver.query; drivers.add(driver);
      driver.on('dbark:session-state', (packet: { sql?: string; stateChanges?: { schema?: string | null } }) => { if (typeof packet.stateChanges?.schema === 'string') schemas.push({ driver, sql: packet.sql, schema: packet.stateChanges.schema }); });
      // 包装原query只记录投递，既不替换协议处理，也不复制其他会话结果。
      driver.query = ((...args: unknown[]) => { const value = args[0], sql = typeof value === 'string' ? value : value && typeof value === 'object' && 'sql' in value && typeof value.sql === 'string' ? value.sql : ''; sent.push({ driver, sql: /^CREATE USER /u.test(sql) ? 'CREATE USER [口令已隐藏]' : sql }); return Reflect.apply(query, driver, args); }) as typeof driver.query;
      return driver;
    });
    restore = () => recording.mockRestore();
    try {
      await engine.handle('connections.open', { id: profile.id, profile }); observer = await connect(profile);
      lifecycle('创建前资源清单', { 观察者线程: observer.connection.threadId });
      for (const database of [a, b]) await execute(observer, `CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`);
      await execute(observer, `CREATE TABLE ${qualified(a, 'subject')}(id INT PRIMARY KEY,a_column TEXT) ENGINE=InnoDB`);
      await execute(observer, `CREATE TABLE ${qualified(b, 'subject')}(id INT PRIMARY KEY,b_column TEXT) ENGINE=InnoDB`);
      await execute(observer, `INSERT INTO ${qualified(a, 'subject')} VALUES(1,'A库内容')`);
      await execute(observer, `INSERT INTO ${qualified(b, 'subject')} VALUES(2,'B库内容')`);
      lifecycle('创建隔离账户前登记');
      try {
        await execute(observer, `CREATE USER ${restrictedAccount} IDENTIFIED BY ${stringLiteral(restrictedPassword)}`);
        restrictedUserCreated = true;
      } catch (error) {
        // 驱动错误可能附带完整SQL；只保留脱敏消息，避免测试报告输出随机口令。
        const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        const code = typeof rawCode === 'string' && /^[A-Z0-9_]{1,80}$/u.test(rawCode) ? rawCode : 'UNKNOWN';
        throw Error('隔离账户创建未确认；错误码=' + code + '；包含口令的原始SQL及驱动错误明细未输出');
      }
      await execute(observer, `GRANT SELECT ON ${qualified(a, 'subject')} TO ${restrictedAccount}`);
      lifecycle('隔离资源准备完成', { 账户授权: `${a}.subject SELECT` });
    } catch (error) { failed = true; lifecycle('准备失败保留现场'); throw error; }
  }, 60000);
  afterAll(async () => {
    try {
      await engine.closeAll();
      if (!observer) return;
      const ids = [...drivers].filter(driver => driver !== observer!.connection).map(driver => driver.threadId).filter((id): id is number => Number.isSafeInteger(id) && (id ?? 0) > 0);
      if (ids.length) {
        const residual = (await execute<Record<string, unknown>[]>(observer, 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.map(() => '?').join(',') + ')', ids)).rows;
        expect(residual).toHaveLength(0); lifecycle('原线程已释放', { 原线程: ids, 残留线程数: residual.length });
      }
      if (failed) { lifecycle('失败未自动清库或删账户', { 保留资源: [a, b, `${restrictedUser}@${restrictedHost}`] }); return; }
      if (!/^dbark_dbswitch_u_[a-f0-9]{12}$/u.test(restrictedUser) || restrictedHost !== '%') throw Error('清理账户不符合专项资源清单');
      await execute(observer, `DROP USER ${restrictedAccount}`);
      for (const database of [a, b]) { if (!/^dbark_dbswitch_[a-f0-9]{12}_[ab]$/.test(database)) throw Error('清理资源名不符合专项清单'); await execute(observer, `DROP DATABASE ${identifier(database)}`); }
      expect((await execute<Record<string, unknown>[]>(observer, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?,?)', [a, b])).rows).toHaveLength(0);
      expect((await execute<Record<string, unknown>[]>(observer, 'SELECT User,Host FROM mysql.user WHERE User=? AND Host=?', [restrictedUser, restrictedHost])).rows).toHaveLength(0);
      lifecycle('精确清理完成', { 残留库数: 0, 残留账户数: 0 });
    } catch (error) { failed = true; lifecycle('收尾失败保留现场'); throw error; }
    finally { try { await observer?.close({ strict: true }); } finally { restore?.(); } }
  }, 60000);
  it.each([false, true])('原连接、未提交事务、A库临时表和B库非限定读取保持正确；关闭schema跟踪=%s', async trackingOff => session(async id => {
    const rowId = trackingOff ? 42 : 41;
    if (trackingOff) await run(id, "SET SESSION session_track_system_variables='';SET SESSION session_track_schema=OFF");
    await run(id, `CREATE TEMPORARY TABLE marker(v BIGINT);INSERT INTO marker VALUES(9007199254740993);BEGIN;INSERT INTO subject(id,a_column) VALUES(${rowId},'显式切库未提交')`);
    const original = await run(id, 'SELECT CONNECTION_ID() AS physical_id,v FROM marker'), physicalId = cell(original, 'physical_id'), value = cell(original, 'v');
    const objectsBefore = await engine.handle('query.temporaryState', { sessionId: id }), taskId = randomUUID(), before = sent.length, schemaStart = schemas.length;
    const switched = await engine.handle('query.databaseSwitch', { sessionId: id, taskId, database: b, expectedContext: queryDatabaseFromSession(await state(id)) });
    expect(switched).toMatchObject({ sessionId: id, taskId, database: b, unchanged: false, transactionKnown: true, transactionOpen: true, completion: { database: b, databaseKnown: true, busy: false, broken: false } });
    const switchedCommands = commands(physicalId, before); expect(switchedCommands.filter(sql => sql.startsWith('USE '))).toEqual(['USE ' + identifier(b)]);
    const hasSchema = schemas.slice(schemaStart).some(packet => String(packet.driver.threadId) === String(physicalId) && packet.sql === 'USE ' + identifier(b) && packet.schema === b);
    expect(switchedCommands.filter(sql => sql === 'SELECT DATABASE() AS `database`').length).toBe(hasSchema ? 0 : 1);
    if (trackingOff) expect(hasSchema).toBe(false);
    expect((await engine.handle('query.temporaryState', { sessionId: id })).objects).toEqual(objectsBefore.objects);
    const actual = await run(id, `SELECT CONNECTION_ID() AS physical_id,DATABASE() AS actual_database,v FROM ${qualified(a, 'marker')}`);
    expect(cell(actual, 'physical_id')).toBe(physicalId); expect(cell(actual, 'actual_database')).toBe(b); expect(cell(actual, 'v')).toBe(value);
    const subject = await run(id, 'SELECT * FROM subject'); expect(subject.results[0].columns.map(column => column.name)).toEqual(['id', 'b_column']); expect(cell(subject, 'b_column')).toBe('B库内容');
    expect((await execute<Record<string, unknown>[]>(observer!, `SELECT COUNT(*) AS n FROM ${qualified(a, 'subject')} WHERE id=${rowId}`)).rows[0].n).toBe('0');
    expect((await engine.handle('query.sessionState', { sessionId: id })).transactionOpen).toBe(true);
    await engine.handle('query.transaction', { sessionId: id, action: 'rollback' });
    expect(cell(await run(id, `SELECT COUNT(*) AS n FROM ${qualified(a, 'subject')} WHERE id=${rowId}`), 'n')).toBe('0');
    expect((await execute<Record<string, unknown>[]>(observer!, `SELECT COUNT(*) AS n FROM ${qualified(a, 'subject')} WHERE id=${rowId}`)).rows[0].n).toBe('0');
    expect(events.filter(event => event.taskId === taskId).every(event => event.executionSql === undefined && event.batch === undefined && event.columns === undefined)).toBe(true);
  }));
  it('同库no-op和过期expectedContext都零USE；不存在目标失败后可显式恢复', async () => session(async id => {
    const physicalId = cell(await run(id, 'SELECT CONNECTION_ID() AS physical_id'), 'physical_id'), before = sent.length;
    expect(await engine.handle('query.databaseSwitch', { sessionId: id, taskId: randomUUID(), database: a, expectedContext: queryDatabaseFromSession(await state(id)) })).toMatchObject({ database: a, unchanged: true });
    await expect(engine.handle('query.databaseSwitch', { sessionId: id, taskId: randomUUID(), database: b, expectedContext: { state: 'known', database: b } })).rejects.toThrow('已变化');
    expect(commands(physicalId, before)).toHaveLength(0);
    await expect(engine.handle('query.databaseSwitch', { sessionId: id, taskId: randomUUID(), database: missing, expectedContext: queryDatabaseFromSession(await state(id)) })).rejects.toThrow('切换可能已发生');
    expect(commands(physicalId, before)).toEqual(['USE ' + identifier(missing)]); expect(await state(id)).toMatchObject({ databaseKnown: false, broken: false });
    expect(await engine.handle('query.databaseSwitch', { sessionId: id, taskId: randomUUID(), database: b, expectedContext: { state: 'unknown' } })).toMatchObject({ database: b, unchanged: false });
  }));
  it('本轮隔离账户实际USE A成功、USE B权限拒绝；单次投递且不诊断兜底或重连', async () => {
    const restricted = { ...profile, id: randomUUID(), name: '切库拒权专用账户', user: restrictedUser, password: restrictedPassword };
    try {
      await engine.handle('connections.open', { id: restricted.id, profile: restricted });
      await session(async id => {
        const allowed = await run(id, 'USE ' + identifier(a)); expect(allowed.failure).toBeUndefined();
        expect(cell(await run(id, 'SELECT a_column FROM subject WHERE id=1'), 'a_column')).toBe('A库内容');
        const physicalId = cell(await run(id, 'SELECT CONNECTION_ID() AS physical_id'), 'physical_id'), before = sent.length, driverCount = drivers.size;
        let denial: unknown;
        try { await engine.handle('query.databaseSwitch', { sessionId: id, taskId: randomUUID(), database: b, expectedContext: queryDatabaseFromSession(await state(id)) }); }
        catch (error) { denial = error; }
        expect(denial).toBeInstanceOf(Error); expect((denial as Error).message).toContain('切换可能已发生');
        expect((denial as Error).cause).toMatchObject({ code: 'ER_DBACCESS_DENIED_ERROR', errno: 1044 });
        expect(commands(physicalId, before)).toEqual(['USE ' + identifier(b)]); expect(drivers.size).toBe(driverCount); expect(await state(id)).toMatchObject({ databaseKnown: false, broken: false });
      }, restricted.id);
    } catch (error) { failed = true; throw error; }
  });
});
