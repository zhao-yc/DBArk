import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import type { CellValue, ConnectionProfile, CommandMap, TaskEvent } from '../../src/shared/contracts';
import { exportLiteral, identifier } from '../../src/engine/sql';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_test_refs_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const profile: ConnectionProfile = {
  id: 'references-fixture', name: '独立外键验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '',
  ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}),
  ...(process.env.DBARK_TEST_SSH === '1' ? { ssh: { enabled: true, host: process.env.DBARK_TEST_SSH_HOST ?? '', port: Number(process.env.DBARK_TEST_SSH_PORT ?? 22), user: process.env.DBARK_TEST_SSH_USER ?? '', privateKeyPath: process.env.DBARK_TEST_SSH_KEY, hostFingerprint: process.env.DBARK_TEST_SSH_FINGERPRINT } } : {}),
};
const events: TaskEvent[] = [];
const engine = new Engine(event => events.push(event));
let admin: ManagedConnection, created = false;
const special = "中文'\\\0'); OR 1=1 -- 🤖";
/** 只在本文件随机库里创建和删除对象，不依赖共享业务库或全局模式。 */
async function sql(text: string, managed = admin) { return (await execute(managed, text)).rows; }
/** 实际关联查询始终经过引擎公开入口及它自己的短连接。 */
async function page(table: string, foreignKeyName: string, matchValues?: CellValue[], extra: Record<string, unknown> = {}): Promise<CommandMap['table.referencePage']['output']> {
  return engine.handle('table.referencePage', { connectionId: profile.id, database, table, foreignKeyName, matchValues, page: 1, pageSize: 100, filters: [], sort: [], taskId: randomUUID(), ...extra });
}

describe.skipIf(!enabled)('真实数据库外键值选择与关联导航', () => {
  beforeAll(async () => {
    const status = await engine.handle('connections.open', { id: profile.id, profile }); console.info(`关联验收版本：${status.version}；SSH：${Boolean(profile.ssh?.enabled)}；严格TLS：${Boolean(profile.tls?.enabled)}`);
    admin = await connect(profile); await sql(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`); created = true;
    await sql(`USE ${identifier(database)}`);
    await sql('CREATE TABLE parent (Id BIGINT UNSIGNED NOT NULL, Amount DECIMAL(40,18) NOT NULL, Tag VARCHAR(100) NOT NULL, Payload LONGBLOB, PRIMARY KEY(Id), UNIQUE KEY tuple_key(Amount,Tag)) ENGINE=InnoDB');
    await sql('CREATE TABLE child (local_id INT PRIMARY KEY, ref_id BIGINT UNSIGNED, amount DECIMAL(40,18), tag VARCHAR(100), CONSTRAINT fk_id FOREIGN KEY(ref_id) REFERENCES parent(id), CONSTRAINT fk_tuple FOREIGN KEY(amount,tag) REFERENCES parent(amount,tag) ON UPDATE CASCADE ON DELETE SET NULL) ENGINE=InnoDB');
    await sql(`INSERT INTO parent VALUES (9007199254740992,1.123456789012345678,'Alpha',NULL),(9007199254740993,1.123456789012345679,'Beta',NULL),(18446744073709551615,2,${exportLiteral(special)},NULL)`);
    await sql('INSERT INTO child VALUES (1,9007199254740993,1.123456789012345678,\'ALPHA\')');
    await sql('CREATE TABLE binary_parent (Id BINARY(8) PRIMARY KEY, `__proto__` VARCHAR(20)) ENGINE=InnoDB');
    await sql('CREATE TABLE binary_child (Id INT PRIMARY KEY, Ref BINARY(8), CONSTRAINT fk_binary FOREIGN KEY(Ref) REFERENCES binary_parent(Id)) ENGINE=InnoDB');
    await sql("INSERT INTO binary_parent VALUES (X'000127ff00805c00','原型字段')");
    await sql('CREATE TABLE bit_parent (Id BIT(64) PRIMARY KEY) ENGINE=InnoDB');
    await sql('CREATE TABLE bit_child (Id INT PRIMARY KEY, Ref BIT(64), CONSTRAINT fk_bit FOREIGN KEY(Ref) REFERENCES bit_parent(Id)) ENGINE=InnoDB');
    await sql('INSERT INTO bit_parent VALUES (18446744073709551615),(9007199254740993)');
    await sql('CREATE TABLE float_parent (Id INT PRIMARY KEY, F FLOAT NOT NULL, D DOUBLE NOT NULL, UNIQUE KEY f_key(F), UNIQUE KEY d_key(D)) ENGINE=InnoDB');
    await sql('CREATE TABLE float_child (Id INT PRIMARY KEY, F FLOAT, D DOUBLE, CONSTRAINT fk_float FOREIGN KEY(F) REFERENCES float_parent(F), CONSTRAINT fk_double FOREIGN KEY(D) REFERENCES float_parent(D)) ENGINE=InnoDB');
    await sql('INSERT INTO float_parent VALUES (1,0.1,0.1),(2,0.10000001,0.10000000000000002),(3,1e-20,1e-200)');
  });
  afterAll(async () => { try { if (created) await sql(`DROP DATABASE ${identifier(database)}`); } finally { await admin?.close(); await engine.closeAll(); } });

  it('来源外键由服务器解析，规范列大小写，BIGINT相邻值不合并', async () => {
    const result = await page('child', 'FK_ID', ['9007199254740993']); expect(result.foreignKey.referencedColumns).toEqual(['Id']); expect(result.target.name).toBe('parent'); expect(result.page.rows.map(row => row.Id)).toEqual(['9007199254740993']);
    expect((await page('child', 'fk_id', ['18446744073709551615'])).page.rows.map(row => row.Id)).toEqual(['18446744073709551615']);
  });
  it('复合DECIMAL保真且文本按父列collation匹配', async () => {
    expect((await page('child', 'fk_tuple', ['1.123456789012345678', 'ALPHA'])).page.rows.map(row => row.Id)).toEqual(['9007199254740992']);
    expect((await page('child', 'fk_tuple', ['1.123456789012345679', 'ALPHA'])).page.rows).toEqual([]);
  });
  it('Unicode引号NUL与注释只能作为关联值', async () => { expect((await page('child', 'fk_tuple', ['2', special])).page.rows).toHaveLength(1); expect((await page('child', 'fk_tuple', ['2', "x') OR 1=1 --"])).page.rows).toEqual([]); });
  it('ANY筛选不能扩大关联元组范围，NULL元组不扫父记录', async () => {
    expect((await page('child', 'fk_id', ['9007199254740993'], { filterMode: 'any', filters: [{ column: 'Id', operator: '=', value: '9007199254740992' }, { column: 'Id', operator: '=', value: '18446744073709551615' }] })).page.rows).toEqual([]);
    const empty = await page('child', 'fk_tuple', [null, 'Alpha']); expect(empty.source.name).toBe('child'); expect(empty.page.rows).toEqual([]); expect(empty.page.hasMore).toBe(false);
  });
  it('父候选分页补唯一键稳定顺序且只返回本页', async () => {
    const first = await page('child', 'fk_id', undefined, { pageSize: 1, sort: [{ column: 'Payload', direction: 'ASC' }] });
    const second = await page('child', 'fk_id', undefined, { page: 2, pageSize: 1, sort: [{ column: 'Payload', direction: 'ASC' }] });
    expect(first.page.rows[0].Id).toBe('9007199254740992'); expect(second.page.rows[0].Id).toBe('9007199254740993'); expect(first.page.hasMore).toBe(true);
  });
  it('BINARY与BIT从实际父页原值确认，prototype字段保留', async () => {
    const binary = await page('binary_child', 'fk_binary'); expect(binary.page.rows[0].Id).toEqual({ type: 'binary', base64: 'AAEn/wCAXAA=' }); expect(Object.hasOwn(binary.page.rows[0], '__proto__')).toBe(true);
    expect((await page('binary_child', 'fk_binary', [binary.page.rows[0].Id])).page.rows).toEqual(binary.page.rows);
    const bits = await page('bit_child', 'fk_bit'); expect(bits.page.rows).toHaveLength(2);
    for (const row of bits.page.rows) expect((await page('bit_child', 'fk_bit', [row.Id])).page.rows).toEqual([row]);
    await expect(page('bit_child', 'fk_bit', [{ type: 'binary', base64: Buffer.alloc(9, 255).toString('base64') }])).rejects.toThrow('位范围');
  });
  it('FLOAT/DOUBLE相邻值和科学计数法原样确认，每个候选只命中自己', async () => {
    const candidates = await page('float_child', 'fk_float');
    for (const row of candidates.page.rows) {
      expect((await page('float_child', 'fk_float', [row.F])).page.rows.map(value => value.Id)).toEqual([row.Id]);
      expect((await page('float_child', 'fk_double', [row.D])).page.rows.map(value => value.Id)).toEqual([row.Id]);
    }
    expect((await page('float_child', 'fk_float', ['1e-20'])).page.rows[0].Id).toBe(3);
    expect((await page('float_child', 'fk_double', ['1e-200'])).page.rows[0].Id).toBe(3);
  });
  it('BIT64父候选实际提交成功，陈旧原值冲突不覆盖并可清空NULL', async () => {
    await sql('INSERT INTO bit_child VALUES (1,18446744073709551615)');
    const read = async () => (await engine.handle('table.page', { connectionId: profile.id, database, table: 'bit_child', page: 1, pageSize: 10, filters: [], sort: [] })).rows;
    const original = (await read())[0], selected = (await page('bit_child', 'fk_bit', ['9007199254740993'])).page.rows[0].Id;
    const apply = (changes: unknown[]) => engine.handle('table.apply', { connectionId: profile.id, database, table: 'bit_child', changes, taskId: randomUUID() });
    await apply([{ kind: 'update', before: original, values: { Ref: selected } }]);
    expect((await sql('SELECT CAST(Ref AS UNSIGNED) AS value FROM bit_child') as Array<{ value: string }>)[0].value).toBe('9007199254740993');
    await expect(apply([{ kind: 'update', before: original, values: { Ref: null } }])).rejects.toThrow('整批修改已回滚');
    const current = (await read())[0]; expect(current.Ref).toEqual(selected);
    await apply([{ kind: 'update', before: current, values: { Ref: null } }]); expect((await read())[0].Ref).toBeNull();
  });
  it.each([1, 7, 8, 9, 63, 64])('BIT(%i)主键insert/update/delete及零填充按真实位值定位', async width => {
      const table = `bits_apply_${width}`; await sql(`CREATE TABLE ${identifier(table)} (bits BIT(${width}) PRIMARY KEY,note VARCHAR(20)) ENGINE=InnoDB`);
      const wrap = (value: bigint) => ({ type: 'binary', base64: Buffer.from(value.toString(16).padStart(Math.ceil(width / 8) * 2, '0'), 'hex').toString('base64') });
      const maximum = (1n << BigInt(width)) - 1n;
      const apply = (changes: unknown[]) => engine.handle('table.apply', { connectionId: profile.id, database, table, changes, taskId: randomUUID() });
      const read = async () => (await engine.handle('table.page', { connectionId: profile.id, database, table, page: 1, pageSize: 10, filters: [], sort: [] })).rows;
      await apply([{ kind: 'insert', values: { bits: wrap(maximum), note: '原值' } }]);
      const original = (await read())[0];
      await apply([{ kind: 'update', before: original, values: { bits: wrap(0n), note: '零值' } }]);
      const current = (await read())[0]; expect(current.bits).toEqual(wrap(0n));
      await expect(apply([{ kind: 'update', before: original, values: { note: '陈旧修改' } }])).rejects.toThrow('整批修改已回滚');
      await apply([{ kind: 'delete', before: current }]); expect(await read()).toEqual([]);
  });
  it('FLOAT主键相邻值与DOUBLE旧值实际apply不误定位或丢精度', async () => {
    await sql('CREATE TABLE float_apply (F FLOAT PRIMARY KEY,D DOUBLE,note VARCHAR(20)) ENGINE=InnoDB');
    const apply = (changes: unknown[]) => engine.handle('table.apply', { connectionId: profile.id, database, table: 'float_apply', changes, taskId: randomUUID() });
    const read = async () => (await engine.handle('table.page', { connectionId: profile.id, database, table: 'float_apply', page: 1, pageSize: 10, filters: [], sort: [] })).rows;
    await apply([{ kind: 'insert', values: { F: Math.fround(0.1), D: 0.1, note: '第一行' } }, { kind: 'insert', values: { F: Math.fround(0.10000001), D: 0.10000000000000002, note: '第二行' } }]);
    const originals = await read(); expect(originals[0].F).not.toBe(originals[1].F);
    await apply([{ kind: 'update', before: originals[1], values: { note: '第二行修改' } }]);
    expect((await read()).map((row: { note: string }) => row.note)).toEqual(['第一行','第二行修改']);
    await expect(apply([{ kind: 'update', before: originals[0], values: { note: '不应保存' } }, { kind: 'delete', before: originals[1] }])).rejects.toThrow('整批修改已回滚');
    expect((await read()).map((row: { note: string }) => row.note)).toEqual(['第一行','第二行修改']);
    const current = (await read())[1]; await apply([{ kind: 'delete', before: current }]); expect((await read())[0]).toEqual(originals[0]);
  });
  it.each(['csv', 'json', 'sql'])('浮点父键通过%s独立导出再导入仍保持三个不同键', async format => {
    const folder = await mkdtemp(join(tmpdir(), 'dbark-refs-'));
    try {
      const table = `float_copy_${format}`, filePath = join(folder, `float.${format}`);
      await sql(`CREATE TABLE ${identifier(table)} LIKE float_parent`);
      await sql(`INSERT INTO ${identifier(table)} SELECT * FROM float_parent`);
      const options = { connectionId: profile.id, database, table, filePath, format, encoding: 'utf8', taskId: randomUUID() };
      expect((await engine.handle('files.export', { ...options, includeData: true, includeStructure: false })).rows).toBe(3);
      await sql(`DELETE FROM ${identifier(table)}`);
      const imported = await engine.handle('files.import', { ...options, taskId: randomUUID(), mapping: { Id: 'Id', F: 'F', D: 'D' } }); expect(imported.errors).toEqual([]); expect(imported.rows).toBe(3);
      const compared = await sql(`SELECT COUNT(*) AS n FROM ${identifier(table)} copy JOIN float_parent p ON copy.Id=p.Id AND copy.F=p.F AND copy.D=p.D`) as Array<{ n: number }>;
      expect(Number(compared[0].n)).toBe(3);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  it('确认时重新读取元数据和父行，不存在或被删约束明确报告', async () => {
    await sql('CREATE TABLE verify_parent (Id INT PRIMARY KEY) ENGINE=InnoDB'); await sql('CREATE TABLE verify_child (Ref INT, CONSTRAINT fk_verify FOREIGN KEY(Ref) REFERENCES verify_parent(Id)) ENGINE=InnoDB');
    await sql('INSERT INTO verify_parent VALUES (1)'); expect((await page('verify_child', 'fk_verify', [1])).page.rows).toHaveLength(1);
    await sql('DELETE FROM verify_parent'); expect((await page('verify_child', 'fk_verify', [1])).page.rows).toEqual([]);
    await sql('ALTER TABLE verify_child DROP FOREIGN KEY fk_verify'); await expect(page('verify_child', 'fk_verify', [1])).rejects.toThrow('外键已不存在');
  });
  it('readonly来源无唯一键仍可查看，父表无可靠非空唯一键明确拒绝', async () => {
    await sql('CREATE TABLE readonly_child (Ref BIGINT UNSIGNED, CONSTRAINT fk_readonly FOREIGN KEY(Ref) REFERENCES parent(Id)) ENGINE=InnoDB'); expect((await page('readonly_child', 'fk_readonly')).page.rows).toHaveLength(3);
    await sql('CREATE TABLE nullable_parent (Id INT NULL UNIQUE) ENGINE=InnoDB'); await sql('CREATE TABLE nullable_child (Ref INT, CONSTRAINT fk_nullable FOREIGN KEY(Ref) REFERENCES nullable_parent(Id)) ENGINE=InnoDB'); await expect(page('nullable_child', 'fk_nullable')).rejects.toThrow('非空唯一键');
  });
  it('行预算失败不返回部分候选', async () => { await sql("UPDATE parent SET Payload=REPEAT('x',270000) WHERE Id=18446744073709551615"); try { await expect(page('child', 'fk_id', ['18446744073709551615'])).rejects.toThrow('256 KiB'); } finally { await sql('UPDATE parent SET Payload=NULL WHERE Id=18446744073709551615'); } });
  it('来源清空关联不要求父表SELECT权限，可取消元数据入口只读来源', async () => {
    const username = `ref_${randomUUID().replaceAll('-', '').slice(0, 12)}`, password = randomUUID();
    const limited = new Engine(); let userCreated = false; let low: ManagedConnection | undefined;
    try {
      await sql(`CREATE USER '${username}'@'%' IDENTIFIED BY '${password}'`); userCreated = true;
      await sql(`GRANT SELECT, UPDATE ON ${identifier(database)}.child TO '${username}'@'%'`);
      const lowProfile = { ...profile, id: username, user: username, password };
      await limited.handle('connections.open', { id: username, profile: lowProfile });
      const source = await limited.handle('metadata.table', { connectionId: username, database, table: 'child', taskId: randomUUID() });
      expect(source.foreignKeys).toHaveLength(2);
      const full = await engine.handle('metadata.table', { connectionId: profile.id, database, table: 'child' }); expect(source.foreignKeys).toEqual(full.foreignKeys);
      await expect(limited.handle('table.referencePage', { connectionId: username, database, table: 'child', foreignKeyName: 'fk_id', taskId: randomUUID(), page: 1, pageSize: 10, filters: [], sort: [] })).rejects.toThrow();
      low = await connect(lowProfile, database); await sql('UPDATE child SET ref_id=NULL WHERE local_id=1', low);
      expect((await sql('SELECT ref_id FROM child WHERE local_id=1', low) as Array<{ ref_id: unknown }>)[0].ref_id).toBeNull();
    } finally { await low?.close(); await limited.closeAll(); if (userCreated) await sql(`DROP USER '${username}'@'%'`); }
  });
  it('真实元数据或页锁等待可取消，查询连接消失且query标签事务不受影响', async () => {
    const locker = await connect(profile, database), observer = await connect(profile);
    const taskId = randomUUID(); let running: Promise<unknown> | undefined; let threadId: number | undefined;
    const { sessionId } = await engine.handle('sessions.open', { connectionId: profile.id, database });
    try {
      await engine.handle('query.transaction', { sessionId, action: 'begin' });
      await sql('LOCK TABLES parent WRITE', locker);
      running = page('child', 'fk_id', undefined, { taskId }).catch(error => error);
      await expect.poll(async () => {
        const rows = await sql('SHOW FULL PROCESSLIST', observer) as Array<{ Id: number; Info: string | null; State: string }>;
        const waiting = rows.find(row => row.Info?.includes(database) && /waiting/i.test(row.State)); threadId = waiting?.Id; return Boolean(waiting);
      }, { timeout: 15000, interval: 100 }).toBe(true);
      await engine.handle('query.cancel', { taskId }); expect(await running).toBeInstanceOf(Error); expect(events.filter(event => event.taskId === taskId).at(-1)?.status).toBe('cancelled');
      await expect.poll(async () => ((await sql('SHOW FULL PROCESSLIST', observer)) as Array<{ Id: number }>).some(row => row.Id === threadId), { timeout: 5000, interval: 100 }).toBe(false);
      expect(await engine.handle('query.sessionState', { sessionId })).toMatchObject({ transactionOpen: true, transactionKnown: true, broken: false });
    } finally { await sql('UNLOCK TABLES', locker); await running; await locker.close(); await observer.close(); await engine.handle('query.transaction', { sessionId, action: 'rollback' }); await engine.handle('sessions.close', { sessionId }); }
  });
});
