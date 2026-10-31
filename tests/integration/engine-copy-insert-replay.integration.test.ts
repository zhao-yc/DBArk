import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine as EngineType } from '../../src/engine';
import type { ManagedConnection } from '../../src/engine/connection';
import type { NetworkConnectionProfile as ConnectionProfile, QueryOutcome, TableInfo, TablePage } from '../../src/shared/contracts';
import { copyInsertReplayDatabase, copyInsertReplayEnabled, copyInsertReplayModes, copyInsertReplayProfile, assertCopyInsertReplayTables } from '../helpers/copyInsertReplayPolicy';
import { cleanupD02Copy, type D02Ownership } from './helpers/d02-copy-source-policy';

const observed = vi.hoisted(() => ({ connections: new Set<ManagedConnection>(), retain: false }));
/** 仅旁观真实生产connect，并把已有close提升为strict；不替换驱动、执行、解码或回包。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    const managed = await actual.connect(...args); observed.connections.add(managed);
    const native = managed.connection as typeof managed.connection & { stream?: { closed?: boolean } }, stream = native.stream, close = managed.close.bind(managed);
    managed.close = async () => {
      try {
        if (!stream || native.stream !== stream) throw Error('INSERT回放原生流归属未知，保留现场');
        await close({ strict: true });
        if (native.stream !== stream || stream.closed !== true) throw Error('INSERT回放原生流close未确认，保留现场');
      } catch (reason) { observed.retain = true; throw reason; }
    };
    return managed;
  } };
});

const enabled = copyInsertReplayEnabled(process.env, process.argv);
const replayThreadIds = new Set<number>();
let engine: EngineType | undefined, observer: ManagedConnection | undefined, profile: ConnectionProfile;
let execute: typeof import('../../src/engine/connection')['execute'];
let qualified: typeof import('../../src/engine/sql')['qualified'], identifier: typeof import('../../src/engine/sql')['identifier'];
let buildCopyInsertSql: typeof import('../../src/main/copyInsertSql')['buildCopyInsertSql'];
let randomUUID: typeof import('node:crypto')['randomUUID'];
let database = '', owner = '', databaseState: D02Ownership = 'absent', pending = 0, failure: unknown;
let halted = false, caseActive = false, cleanupComplete = true;
const definitions = new Map<string, string>();

/** 活动命令和失败不可恢复；全局测试超时也不能在未终态时补DROP。 */
async function observe<T>(action: () => Promise<T>): Promise<T> {
  if (observed.retain) throw Error('INSERT回放已停链，保留现场');
  pending++;
  try { const result = await action(); if (observed.retain) throw Error('INSERT回放等待期间已停链'); return result; }
  catch (reason) { observed.retain = true; failure ??= reason; throw reason; }
  finally { pending--; }
}
/** 仅通过生产execute访问本轮管理员连接，不设置全局模式或创建用户。 */
async function sql<T = Record<string, unknown>[]>(text: string, values: (string | number | boolean | null | Buffer)[] = []): Promise<T> {
  return observe(async () => (await execute<T>(observer!, text, values)).rows);
}
/** 生产表页解码不由测试重造；每次仅取本轮三条固定行。 */
async function page(table: 'source' | 'target'): Promise<TablePage> {
  return observe(() => engine!.handle('table.page', { connectionId: profile.id, database, table, page: 1, pageSize: 50, filters: [], sort: [{ column: 'id', direction: 'ASC' }] }));
}
/** 独立观察投影明确区分NULL/空串与字节，数值和日期均不经过JS Number/Date。 */
async function facts(table: 'source' | 'target') {
  return sql(`SELECT CAST(id AS CHAR) AS id,CAST(signed_value AS CHAR) AS signed_value,CAST(amount AS CHAR) AS amount,HEX(CAST(doc AS CHAR CHARACTER SET utf8mb4)) AS doc_hex,note IS NULL AS note_null,HEX(note) AS note_hex,payload IS NULL AS payload_null,HEX(payload) AS payload_hex,CAST(flags AS UNSIGNED) AS flags_value,HEX(flags) AS flags_hex,DATE_FORMAT(happened,'%Y-%m-%d %H:%i:%s.%f') AS happened,CAST(clock_value AS CHAR) AS clock_value,CAST(day_value AS CHAR) AS day_value FROM ${qualified(database, table)} ORDER BY id`);
}
/** 每次DROP前复核本轮注释、完整定义及无额外对象；不能凭随机前缀直接清库。 */
async function assertOwned() {
  if (databaseState !== 'confirmed' || observed.retain || pending || !/^dbark_colperm_[a-f0-9]{12}$/.test(database)) throw Error('INSERT回放创建或命令状态未知，拒绝清理');
  const rows = await sql<{ name: unknown; kind: unknown; comment: unknown }[]>('SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ?', [database]);
  assertCopyInsertReplayTables(rows, owner);
  for (const table of ['source', 'target']) {
    const current = await sql('SHOW CREATE TABLE ' + qualified(database, table));
    if (current.length !== 1 || current[0]['Create Table'] !== definitions.get(table)) throw Error('INSERT回放完整定义已变化，拒绝清理');
  }
  for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) if ((await sql(`SELECT 1 FROM information_schema.${view} WHERE BINARY ${column}=BINARY ? LIMIT 1`, [database])).length) throw Error('INSERT回放库内存在未知对象，拒绝清理');
}

describe.skipIf(!enabled)('复制INSERT真实解码和独立会话回放（默认关闭，Root统一实跑）', () => {
  beforeEach(async () => {
    // 收尾未完成也要永久停链；不得先重置旧owner或读取下一模式配置。
    if (halted || !cleanupComplete) { observed.retain = true; halted = true; throw Error('INSERT回放前例已失败或收尾未可信完成，后续模式不自动继续'); }
    cleanupComplete = false;
    caseActive = true;
    engine = undefined; observer = undefined; databaseState = 'absent'; pending = 0; failure = undefined; observed.retain = false; observed.connections.clear(); definitions.clear();
    try {
      // 双门通过后才读目标和认证；目标门通过后才加载引擎、驱动及真实生成器。
      profile = copyInsertReplayProfile(process.env, 'copy-insert-replay');
      const modules = await Promise.all([import('../../src/engine'), import('../../src/engine/connection'), import('../../src/engine/sql'), import('../../src/main/copyInsertSql'), import('node:crypto')]);
      execute = modules[1].execute; qualified = modules[2].qualified; identifier = modules[2].identifier; buildCopyInsertSql = modules[3].buildCopyInsertSql; randomUUID = modules[4].randomUUID;
      database = copyInsertReplayDatabase(randomUUID().replaceAll('-', '').slice(0, 12)); owner = randomUUID().replaceAll('-', '');
      observer = await observe(() => modules[1].connect(profile)); engine = new modules[0].Engine();
      const self = await sql<{ id: number; os: string; names: number }[]>('SELECT CONNECTION_ID() AS id,@@version_compile_os AS os,@@lower_case_table_names AS names');
      expect(self).toHaveLength(1); expect(Number(self[0].id)).toBe(observer.connection.threadId); expect(Number.isSafeInteger(Number(self[0].id)) && Number(self[0].id) > 0).toBe(true);
      expect(['linux', 'debian-linux-gnu']).toContain(String(self[0].os).toLowerCase()); expect(Number(self[0].names)).toBe(0);
      // 版本取真实connect状态；不在MariaDB读取其没有的@@server_uuid，也不输出认证或UUID值。
      const versions: Record<number, RegExp> = { 13357: /^5\.7\.44(?:[-+]|$)/, 13380: /^8\.0\.46(?:[-+]|$)/, 13384: /^8\.4\.11(?:[-+]|$)/, 13484: /^8\.4\.11(?:[-+]|$)/, 13310: /^10\.11\.19-MariaDB(?:[-+]|$)/, 13311: /^11\.4\.13-MariaDB(?:[-+]|$)/ };
      expect(observer.status.version).toMatch(versions[profile.port]);
      expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [self[0].id])).toHaveLength(1);
      expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).toHaveLength(0);
      await sql("SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION',time_zone='+00:00'");
      databaseState = 'unknown'; await sql('CREATE DATABASE ' + identifier(database) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); databaseState = 'confirmed';
      for (const table of ['source', 'target']) {
        await sql(`CREATE TABLE ${qualified(database, table)} (id BIGINT UNSIGNED NOT NULL PRIMARY KEY,signed_value BIGINT,amount DECIMAL(65,30),doc JSON,note TEXT,payload BLOB,flags BIT(64),happened DATETIME(6),clock_value TIME(6),day_value DATE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='dbark-copy-insert-owner:${owner}'`);
        definitions.set(table, String((await sql('SHOW CREATE TABLE ' + qualified(database, table)))[0]['Create Table']));
      }
      // 夹具通过真实预处理参数和独立数字文字量造数，不调用被测生成器来制造预期值。
      const seed = await sql<{ warningStatus: number; affectedRows: number }>(`INSERT INTO ${qualified(database, 'source')} VALUES (18446744073709551615,-9223372036854775808,-12345678901234567890123456789012345.123456789012345678901234567890,?,?,?,18446744073709551615,?,?,?),(9007199254740993,9007199254740993,0.000000000000000000000000000001,?,?,?,0,?,?,?),(2,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`, ['{"id":18446744073709551615,"x":1.00000000000000000001,"note":"中文😀"}', "中文😀'\"\\\0\r\n;--", Buffer.from('00ff805c27', 'hex'), '2026-10-17 01:02:03.123456', '-12:34:56.123456', '2026-10-17', 'null', '', Buffer.alloc(0), '2026-10-17 12:34:56.654321', '12:34:56.654321', '2000-02-29']);
      expect(seed.warningStatus).toBe(0); expect(seed.affectedRows).toBe(3);
      await observe(() => engine!.handle('connections.open', { id: profile.id, profile }));
      await assertOwned();
    } catch (reason) { observed.retain = true; failure ??= reason; throw reason; }
  }, 60000);

  for (const mode of copyInsertReplayModes) it(mode.name + '：真实表页生成INSERT，精确回放无warning且源表不变', async () => {
    try {
      const before = await facts('source'), source = await page('source');
      expect(source.rows).toHaveLength(3); expect(source.hasMore).toBe(false);
      expect(source.rows.map(row => row.id)).toEqual(['2', '9007199254740993', '18446744073709551615']);
      expect(source.rows[2].amount).toBe('-12345678901234567890123456789012345.123456789012345678901234567890');
      expect(source.rows[2].flags).toEqual({ type: 'binary', base64: '//////////8=' });
      expect(source.rows[2].happened).toBe('2026-10-17 01:02:03.123456'); expect(source.rows[2].note).toBe("中文😀'\"\\\0\r\n;--");
      expect(source.rows[0].payload).toBeNull(); expect(source.rows[1].payload).toEqual({ type: 'binary', base64: '' });
      expect(typeof source.rows[2].doc).toBe('string'); expect(source.rows[0].doc).toBeNull(); expect(source.rows[1].doc).toBe('null');
      const metadata: TableInfo = await observe(() => engine!.handle('metadata.table', { connectionId: profile.id, database, table: 'source' }));
      const script = buildCopyInsertSql({ database, table: 'target', columns: metadata.columns.map(({ name, type, nullable, generated, extra }) => ({ name, type, nullable, generated, extra })), rows: source.rows });
      const session = await observe(() => engine!.handle('sessions.open', { connectionId: profile.id, database }));
      const query = (text: string): Promise<QueryOutcome> => observe(() => engine!.handle('query.execute', { sessionId: session.sessionId, sql: text, taskId: randomUUID(), maxRows: 50 }));
      await query(`SET SESSION sql_mode='${mode.sqlMode}',time_zone='+00:00'`);
      const identity = await query('SELECT CONNECTION_ID(),@@SESSION.sql_mode');
      const [thread, currentMode] = Object.values(identity.results[0].rows[0]);
      expect(Number.isSafeInteger(Number(thread)) && Number(thread) > 0).toBe(true); expect(replayThreadIds.has(Number(thread))).toBe(false); replayThreadIds.add(Number(thread));
      expect(Number(thread)).not.toBe(observer!.connection.threadId); expect(new Set(String(currentMode).split(','))).toEqual(new Set(mode.sqlMode.split(',')));
      const result = await query(script);
      expect(result.transactionOpen).toBe(false); expect(result.results).toHaveLength(3);
      for (const statement of result.results) { expect(statement.warningCount).toBe(0); expect(statement.affectedRows).toBe(1); expect(statement.truncated).toBe(false); }
      expect((await query('SHOW WARNINGS')).results[0].rows).toEqual([]);
      expect((await page('target')).rows).toEqual(source.rows);
      expect(await facts('target')).toEqual(before); expect(await facts('source')).toEqual(before);
      await observe(() => engine!.handle('sessions.close', { sessionId: session.sessionId }));
      await assertOwned();
    } catch (reason) { observed.retain = true; failure ??= reason; throw reason; }
  }, { timeout: 60000, retry: 0 });

  afterEach(async context => {
    if (!caseActive) return;
    // 首次await前锁定后续模式；只有同一例在原30秒内完整成功才允许放行。
    caseActive = false;
    halted = true; cleanupComplete = false;
    const started = Date.now(), cleanupEngine = engine, cleanupObserver = observer, cleanupConnections = [...observed.connections], cleanupDatabase = database, cleanupOwner = owner;
    /** 不增加时限或计时器；框架超时、迟到回包及共享身份改变都不能恢复删除或下一例。 */
    function assertCleanupCurrent() {
      if (observed.retain || context.task.result?.state === 'fail' || Date.now() - started >= 30000 || engine !== cleanupEngine || observer !== cleanupObserver || database !== cleanupDatabase || owner !== cleanupOwner) {
        observed.retain = true; halted = true; throw Error('INSERT回放收尾未在原时限内可信完成，保留现场且不放行后续模式');
      }
    }
    if (context.task.result?.state === 'fail') observed.retain = true;
    if (pending) { observed.retain = true; halted = true; throw new Error('INSERT回放存在未终态命令，保留连接及隔离库，禁止补DROP', { cause: failure }); }
    try { await cleanupD02Copy({ user: 'absent', database: databaseState,
      closeConnections: async () => {
        const errors: unknown[] = [];
        try { await cleanupEngine?.closeAll(); } catch (reason) { errors.push(reason); }
        const results = await Promise.allSettled(cleanupConnections.filter(value => value !== cleanupObserver).map(value => value.close({ strict: true })));
        const rejected = results.filter((value): value is PromiseRejectedResult => value.status === 'rejected');
        errors.push(...rejected.map(value => value.reason));
        if (errors.length) throw new AggregateError(errors, 'INSERT回放连接strict关闭失败', { cause: errors[0] });
      },
      verifyThreadsGone: async () => {
        if (!cleanupObserver) { if (cleanupConnections.length) throw Error('INSERT回放无观察连接，不能证明线程释放'); return; }
        const ids = cleanupConnections.filter(value => value !== cleanupObserver).map(value => value.connection.threadId);
        if (ids.some(id => !Number.isSafeInteger(id) || !id || id === cleanupObserver.connection.threadId)) throw Error('INSERT回放真实线程编号未知');
        await vi.waitFor(async () => {
          expect((await execute<Record<string, unknown>[]>(cleanupObserver, 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [cleanupObserver.connection.threadId!])).rows).toHaveLength(1);
          if (ids.length) expect((await execute<Record<string, unknown>[]>(cleanupObserver, `SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${ids.map(() => '?').join(',')})`, ids as number[])).rows).toEqual([]);
        }, { timeout: 5000, interval: 50 });
      },
      dropUser: async () => { throw Error('INSERT回放不创建或删除用户'); },
      dropDatabase: async () => {
        assertCleanupCurrent(); await assertOwned(); assertCleanupCurrent(); await sql('DROP DATABASE ' + identifier(cleanupDatabase));
        expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).toHaveLength(0); databaseState = 'absent';
      },
      closeAdmin: async () => { await cleanupObserver?.close({ strict: true }); }, removeTemporaryFiles: async () => undefined
    }, observed.retain, failure);
      assertCleanupCurrent(); cleanupComplete = true; halted = false;
    }
    catch (reason) { observed.retain = true; halted = true; throw reason; }
  }, 30000);
});
