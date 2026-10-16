import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const tracer = vi.hoisted(() => ({ ids: new Set<number>() }));
/** 只记录真实连接编号，不替换驱动、认证、SQL或事务响应。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => { const managed = await actual.connect(...args); if (managed.connection.threadId) tracer.ids.add(managed.connection.threadId); return managed; } };
});
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier, stringLiteral } from '../../src/engine/sql';
import type { ConnectionProfile, DataRow, RowChange, TablePage, TaskEvent } from '../../src/shared/contracts';
import { assertDefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';

// 默认关闭；仅ROOT显式注入本轮环境，不读凭据文件、不创建账号或证书、不探测目标。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_ROW_CHANGE_KEY_GUARD_TEST === '1';
const database = 'dbark_key_guard_' + randomUUID().replaceAll('-', '').slice(0, 12), owner = randomUUID();
const maximum = '18446744073709551615', adjacent = '18446744073709551614', moved = '18446744073709551613';
const profile: ConnectionProfile = { id: randomUUID(), name: '可靠键原值隔离验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? '', password: process.env.DBARK_TEST_PASSWORD ?? '', ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
const events: TaskEvent[] = [], engine = new Engine(event => events.push(event));
let observer: ManagedConnection | undefined, created = false, failed = false, version = '';
const target = (table: string) => `${identifier(database)}.${identifier(table)}`;
/** 观察连接只操作本轮夹具；产品page/apply仍独立执行真实读取与事务。 */
async function sql(query: string) { return (await execute(observer!, query)).rows as Record<string, unknown>[]; }
async function page(table = 'subject'): Promise<DataRow[]> { return ((await engine.handle('table.page', { connectionId: profile.id, database, table, page: 1, pageSize: 100, filters: [], sort: [] })) as TablePage).rows; }
async function apply(changes: RowChange[], table = 'subject') { return engine.handle('table.apply', { connectionId: profile.id, database, table, changes, taskId: randomUUID() }); }
/** 用原生精确整数字面量布置/改动夹具键，避免CAST或重复参数影响诊断前置条件。 */
async function seed() {
  await sql('TRUNCATE TABLE ' + target('subject'));
  await sql(`INSERT INTO ${target('subject')} VALUES(${maximum},'😀old前old后old',12345678901234567890.123456,X'00FF',NULL),(${adjacent},'😀old前old后old',12345678901234567890.123456,X'00FF',NULL)`);
  await sql('TRUNCATE TABLE ' + target('text_key'));
  await sql(`INSERT INTO ${target('text_key')} VALUES(1,'A','😀old',12345678901234567890.123456,X'00FF',NULL)`);
}
/** 原值和副作用按精确十进制文本/二进制HEX独立观察，不转成JS浮点。 */
async function observed(table = 'subject') {
  return table === 'subject'
    ? sql(`SELECT CAST(id AS CHAR) AS id,note,CAST(amount AS CHAR) AS amount,HEX(payload) AS payload,${identifier('optional')} FROM ${target(table)} ORDER BY id`)
    : sql(`SELECT bucket,HEX(code) AS code,HEX(note) AS note,CAST(amount AS CHAR) AS amount,HEX(payload) AS payload,${identifier('optional')} FROM ${target(table)} ORDER BY bucket,code`);
}

describe.skipIf(!enabled)('完整原行保护与可靠键去重复六组合核心（显式单实例）', () => {
  beforeAll(async () => {
    assertDefaultEncodingLiveTarget({ host: profile.host, port: profile.port, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA }, profile);
    if (!profile.user) throw new Error('必须显式提供隔离实例测试账户');
    observer = await connect(profile);
    const status = await engine.handle('connections.open', { id: profile.id, profile }); version = status.version;
    console.info(JSON.stringify({ 可靠键验收库: database, 版本: version, 方言: status.dialect, 严格TLS: !!profile.tls?.enabled }));
    await sql(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`); created = true;
    await sql(`CREATE TABLE ${target('subject')}(id BIGINT UNSIGNED NOT NULL,note TEXT,amount DECIMAL(30,6),payload BLOB,${identifier('optional')} INT NULL,PRIMARY KEY(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT=${stringLiteral(owner)}`);
    await sql(`CREATE TABLE ${target('text_key')}(bucket INT NOT NULL,code VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,note TEXT,amount DECIMAL(30,6),payload BLOB,${identifier('optional')} INT NULL,PRIMARY KEY(bucket,code)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT=${stringLiteral(owner)}`);
  });
  beforeEach(seed);
  afterEach(context => { if (context.task.result?.state === 'fail') failed = true; });
  afterAll(async () => {
    const errors: unknown[] = [];
    try { await engine.closeAll(); } catch (error) { errors.push(error); }
    try {
      if (observer && created) {
        const remaining = (await sql('SHOW FULL PROCESSLIST')).filter(row => Number(row.Id) !== observer!.connection.threadId && (tracer.ids.has(Number(row.Id)) || row.db === database || typeof row.Info === 'string' && row.Info.includes(database)));
        if (failed || remaining.length) { const path = `.cache/row-change-key-guard-evidence/${database}`; await mkdir(path, { recursive: true }); await writeFile(path + '/failure.json', JSON.stringify({ version, events, ids: [...tracer.ids], remaining }, null, 2), { flag: 'wx' }); }
        expect(remaining, '实际编号及隔离库相关连接必须全部结束').toHaveLength(0);
        if (!/^dbark_key_guard_[a-f0-9]{12}$/.test(database)) throw new Error('拒绝清理非本轮数据库');
        const tables = await sql(`SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA=${stringLiteral(database)}`);
        if (tables.some(row => !['subject', 'text_key'].includes(String(row.name)) || row.kind !== 'BASE TABLE' || row.comment !== owner)) throw new Error('隔离库出现非本轮对象，保留现场拒绝DROP');
        for (const [catalog, column] of [['ROUTINES', 'ROUTINE_SCHEMA'], ['TRIGGERS', 'TRIGGER_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) if ((await sql(`SELECT 1 FROM information_schema.${catalog} WHERE ${column}=${stringLiteral(database)} LIMIT 1`)).length) throw new Error('隔离库出现非本轮程序对象，保留现场');
        await sql('DROP DATABASE ' + identifier(database));
        expect(await sql(`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=${stringLiteral(database)}`)).toHaveLength(0);
        console.info(JSON.stringify({ 已清理库: database, 实际连接编号: [...tracer.ids], 残留连接: 0 }));
      }
    } catch (error) { errors.push(error); }
    try { await observer?.close({ strict: true }); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, '可靠键核心验收收尾失败；保留原始错误及现场');
  });

  it('相邻UINT64主键只更新正确原行，完整DECIMAL/Unicode/BLOB/NULL均保持', async () => {
    const rows = await page(), before = rows.find(row => row.id === maximum)!;
    expect(rows.map(row => row.id)).toEqual([adjacent, maximum]); expect(before.amount).toBe('12345678901234567890.123456');
    expect(before.payload).toEqual({ type: 'binary', base64: 'AP8=' }); expect(before.optional).toBeNull();
    expect(await apply([{ kind: 'update', before, values: { note: '😀单处$1结果' } }])).toMatchObject({ affectedRows: 1 });
    expect(await observed()).toEqual([{ id: adjacent, note: '😀old前old后old', amount: '12345678901234567890.123456', payload: '00FF', optional: null }, { id: maximum, note: '😀单处$1结果', amount: '12345678901234567890.123456', payload: '00FF', optional: null }]);
  });
  it('非键DECIMAL末位、文本大小写/尾空格、BLOB及NULL变化仍冲突，外部原值不被覆盖', async () => {
    for (const assignment of ["amount=12345678901234567890.123457", "note='😀OLD前old后old '", "payload=X'00FE'", '`optional`=0']) {
      await seed(); const before = (await page()).find(row => row.id === maximum)!;
      await sql(`UPDATE ${target('subject')} SET ${assignment} WHERE id=${maximum}`); const external = await observed();
      await expect(apply([{ kind: 'update', before, values: { note: '不应写入' } }])).rejects.toThrow('整批修改已回滚');
      expect(await observed()).toEqual(external);
    }
  });
  it('第二行精确原值冲突时回滚第一行已命中的修改，不提交部分结果', async () => {
    const rows = await page(), first = rows.find(row => row.id === maximum)!, second = rows.find(row => row.id === adjacent)!;
    await sql(`UPDATE ${target('subject')} SET amount=12345678901234567890.123457 WHERE id=${adjacent}`); const external = await observed();
    await expect(apply([{ kind: 'update', before: first, values: { note: '第一行不得留下' } }, { kind: 'update', before: second, values: { note: '第二行冲突' } }])).rejects.toThrow('整批修改已回滚');
    expect(await observed()).toEqual(external);
  });
  it('原主键被外部移走后UPDATE和DELETE均不能误命中相邻主键', async () => {
    const before = (await page()).find(row => row.id === maximum)!;
    await sql(`UPDATE ${target('subject')} SET id=${moved} WHERE id=${maximum}`); const external = await observed();
    await expect(apply([{ kind: 'update', before, values: { note: '旧键不得写入' } }])).rejects.toThrow('整批修改已回滚');
    await expect(apply([{ kind: 'delete', before }])).rejects.toThrow('整批修改已回滚'); expect(await observed()).toEqual(external);
  });
  it('更新主键仍从旧键定位，重新读取后DELETE仅删除正确原行', async () => {
    const before = (await page()).find(row => row.id === maximum)!;
    expect(await apply([{ kind: 'update', before, values: { id: moved, note: '已移动' } }])).toMatchObject({ affectedRows: 1 });
    const rows = await page(), next = rows.find(row => row.id === moved)!; expect(next.note).toBe('已移动'); expect(rows.some(row => row.id === maximum)).toBe(false);
    expect(await apply([{ kind: 'delete', before: next }])).toMatchObject({ affectedRows: 1 });
    expect(await observed()).toEqual([{ id: adjacent, note: '😀old前old后old', amount: '12345678901234567890.123456', payload: '00FF', optional: null }]);
  });
  it('复合文本键的CI/PAD相等不能绕过字节旧值保护，更新键和删除仍可正常执行', async () => {
    for (const changed of ['a', 'A ']) {
      await seed(); const before = (await page('text_key'))[0];
      await sql(`UPDATE ${target('text_key')} SET code=${stringLiteral(changed)} WHERE bucket=1 AND code='A'`); const external = await observed('text_key');
      const comparisons = (await execute<Record<string, unknown>[]>(observer!, `SELECT code <=> ? AS loose,BINARY CONVERT(code USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4) AS exact FROM ${target('text_key')}`, ['A', 'A'])).rows[0];
      expect(Number(comparisons.loose)).toBe(1); expect(Number(comparisons.exact)).toBe(0);
      await expect(apply([{ kind: 'update', before, values: { note: '不得覆盖文本键变化' } }], 'text_key')).rejects.toThrow('整批修改已回滚'); expect(await observed('text_key')).toEqual(external);
    }
    await seed(); const before = (await page('text_key'))[0];
    expect(await apply([{ kind: 'update', before, values: { code: 'B', note: '正常修改' } }], 'text_key')).toMatchObject({ affectedRows: 1 });
    const next = (await page('text_key'))[0]; expect(next.code).toBe('B'); expect(await apply([{ kind: 'delete', before: next }], 'text_key')).toMatchObject({ affectedRows: 1 }); expect(await observed('text_key')).toEqual([]);
  });
});
