import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier, qualified } from '../../src/engine/sql';
import type { ConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import type { ForeignKeyDefinition, ForeignKeyPatch } from '../../src/shared/tableForeignKeyPatches';
import type { TableForeignKeyGetOutput, TableForeignKeyPreviewOutput, TableForeignKeyApplyOutput, ForeignKeyTableTarget } from '../../src/shared/tableForeignKeyTasks';
import type { TableIndexGetOutput, TableIndexPreviewOutput } from '../../src/shared/tableIndexTasks';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_fkpatch_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const otherDatabase = `dbark_fkpatch_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const ownDatabases = [database, otherDatabase];
const profile: ConnectionProfile = {
  id: randomUUID(), name: '外键差异隔离验收', group: '', color: '#123456', dialect: 'mysql',
  host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '',
  ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}),
  ...(process.env.DBARK_TEST_SSH === '1' ? { ssh: { enabled: true, host: process.env.DBARK_TEST_SSH_HOST ?? '', port: Number(process.env.DBARK_TEST_SSH_PORT ?? 22), user: process.env.DBARK_TEST_SSH_USER ?? '', privateKeyPath: process.env.DBARK_TEST_SSH_KEY, hostFingerprint: process.env.DBARK_TEST_SSH_FINGERPRINT } } : {}),
};
const events: TaskEvent[] = [], sampledIds = new Set<number>(), snapshots = new Set<string>(), previews = new Set<string>(), created = new Set<string>();
const engine = new Engine(event => events.push(event));
let admin: ManagedConnection | undefined, version = '', failed = false;
type Row = Record<string, unknown>;

/** 管理连接只操作本轮两座随机库；密码、连接概要和业务对象均不写入日志。 */
async function sql(statement: string, values: (string | number)[] = []): Promise<Row[]> {
  if (!admin) throw new Error('隔离验收管理连接尚未建立');
  return (await execute<Row[]>(admin, statement, values)).rows;
}
/** 新增父表只传精确目标，不将任意 SQL、能力标志或 renderer 名称判断传回产品。 */
async function get(table: string, parentTargets: ForeignKeyTableTarget[] = []): Promise<TableForeignKeyGetOutput> {
  const result = await engine.handle('schema.foreignKeys.get', { connectionId: profile.id, database, table, parentTargets, taskId: randomUUID(), connectionRevision: 1 }) as TableForeignKeyGetOutput;
  snapshots.add(result.snapshotId); return result;
}
/** 预览与应用都使用真实 Engine，每个申请只发送一次，不重试失败的 DDL。 */
async function preview(snapshot: TableForeignKeyGetOutput, patches: ForeignKeyPatch[]): Promise<TableForeignKeyPreviewOutput> {
  const result = await engine.handle('schema.foreignKeys.preview', { snapshotId: snapshot.snapshotId, patches, taskId: randomUUID(), connectionRevision: 1 }) as TableForeignKeyPreviewOutput;
  previews.add(result.previewToken); return result;
}
async function apply(value: TableForeignKeyPreviewOutput, taskId = randomUUID(), acknowledgements = value.requiredAcknowledgements, connectionRevision = 1): Promise<TableForeignKeyApplyOutput> {
  return engine.handle('schema.foreignKeys.apply', { previewToken: value.previewToken, acknowledgements, taskId, connectionRevision });
}
/** 只按展示名称查找真实快照返回的 opaque 引用，不按列名拼造授权引用。 */
function foreignKey(snapshot: TableForeignKeyGetOutput, name: string) {
  const value = snapshot.foreignKeys.find(key => key.name === name); if (!value) throw new Error(`自主夹具外键缺失：${name}`); return value;
}
function definition(snapshot: TableForeignKeyGetOutput, name: string, parent: ForeignKeyTableTarget, childNames = ['pid', 'p2'], parentNames = ['a', 'b'], actions: Partial<Pick<ForeignKeyDefinition, 'onUpdate' | 'onDelete'>> = {}): ForeignKeyDefinition {
  const value = snapshot.parents.find(item => item.target.database === parent.database && item.target.table === parent.table);
  if (!value || childNames.length !== parentNames.length) throw new Error('自主夹具父表或元组长度不符');
  return { name, parentRef: value.parentRef, onUpdate: 'RESTRICT', onDelete: 'RESTRICT', ...actions, pairs: childNames.map((column, index) => {
    const child = snapshot.columns.find(item => item.name === column), parentColumn = value.columns.find(item => item.name === parentNames[index]);
    if (!child || !parentColumn) throw new Error('自主夹具有序字段不存在');
    return { childColumnRef: child.columnRef, parentColumnRef: parentColumn.columnRef };
  }) };
}
function addition(value: ForeignKeyDefinition): ForeignKeyPatch { return { op: 'add', clientKey: randomUUID(), definition: value }; }
function finalEvent(taskId: string): TaskEvent | undefined { return events.filter(event => event.taskId === taskId && event.status !== 'running').at(-1); }

/** 每个行为使用独立自主表和约束名，显式支持键避免自动建索引掩盖后核验。 */
async function pair(prefix: string, existing = false) {
  const parent = `${prefix}_parent`, child = `${prefix}_child`, name = `${prefix}_old`;
  await sql(`CREATE TABLE ${identifier(parent)} (id INT NOT NULL,a INT,b INT,note INT,PRIMARY KEY(id),UNIQUE KEY parent_pair(a,b),KEY own_note(note)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
  await sql(`CREATE TABLE ${identifier(child)} (id INT NOT NULL,pid INT,p2 INT,qid INT,q2 INT,PRIMARY KEY(id),KEY child_pair(pid,p2),KEY new_pair(qid,q2)${existing ? `,CONSTRAINT ${identifier(name)} FOREIGN KEY(pid,p2) REFERENCES ${identifier(parent)}(a,b)` : ''}) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
  return { parent: { database, table: parent }, child, name };
}

/** 排除统计基数等易变字段，独立比较真实列定义、支持键和自主数据行。 */
async function preserved(table: string) {
  const columns = await sql('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [database, table]);
  const indexes = await sql('SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,COLLATION,SUB_PART,INDEX_TYPE,INDEX_COMMENT FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX', [database, table]);
  const rows = await sql(`SELECT * FROM ${identifier(table)} ORDER BY id`);
  return { columns, indexes, rows };
}
/** 用服务器 KCU 顺序与 RC 动作核对真实约束，而非仅检查生成 SQL。 */
async function relationship(table: string, name: string) {
  const columns = await sql('SELECT COLUMN_NAME,REFERENCED_TABLE_SCHEMA,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME=? ORDER BY ORDINAL_POSITION', [database, table, name]);
  const rules = await sql('SELECT UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME=?', [database, table, name]);
  return { columns, rules };
}
/** PROCESSLIST 采样只证明当前可见线程，不冒充所有短连接的完整历史审计。 */
async function processes(connection = admin!): Promise<Row[]> {
  const rows = (await execute<Row[]>(connection, 'SHOW FULL PROCESSLIST')).rows;
  for (const row of rows) if (ownDatabases.some(db => row.db === db || (typeof row.Info === 'string' && row.Info.includes(db)))) sampledIds.add(Number(row.Id));
  return rows;
}
/** 钩子不能使用 expect.poll；每次读真实行，单调时钟限时等待归零，不依赖 Vitest 当前测试上下文。 */
async function waitForNoRows(readRows: () => Promise<Row[]>, timeoutMs = 10000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const rows = await readRows();
    if (rows.length === 0) return;
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error(`等待本轮服务器线程归零超时，残留 ID：${JSON.stringify(rows.map(row => row.Id))}`);
    await delay(Math.min(50, remaining));
  }
}
/** 由可见锁等待状态决定取消时机，允许服务器在重读阶段或 ALTER 阶段被阻塞。 */
async function waitingStructure(table: string): Promise<{ id: number; sql: string }> {
  let found: { id: number; sql: string } | undefined;
  await expect.poll(async () => {
    const row = (await processes()).find(value => Number(value.Id) !== admin!.connection.threadId && typeof value.Info === 'string' && value.Info.includes(database) && value.Info.includes(table) && /metadata lock/i.test(String(value.State)));
    if (row) found = { id: Number(row.Id), sql: String(row.Info) }; return found !== undefined;
  }, { timeout: 15000, interval: 50 }).toBe(true);
  return found!;
}
/** 只保存自主结构和任务状态摘要，不保存连接凭据、业务数据或全部服务器 PROCESSLIST。 */
async function saveFailure() {
  const definitions: { database: string; table: string; ddl: string }[] = [];
  for (const db of created) {
    const tables = await sql('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME', [db]);
    for (const row of tables) {
      const name = String(row.TABLE_NAME), ddl = (await sql(`SHOW CREATE TABLE ${qualified(db, name)}`))[0]['Create Table'];
      definitions.push({ database: db, table: name, ddl: String(ddl) });
    }
  }
  const directory = join('.cache/o10-foreign-key-product-evidence', database); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'failure.json'), JSON.stringify({ databases: [...created], version, definitions, events: events.filter(event => event.foreignKeyPatch || event.indexPatch).map(event => ({ taskId: event.taskId, status: event.status, foreignKeyPatch: event.foreignKeyPatch, indexPatch: event.indexPatch })), sampledIds: [...sampledIds] }, null, 2), { flag: 'wx' });
  console.info(JSON.stringify({ 外键失败证据目录: directory }));
}

describe.skipIf(!enabled)('真实外键差异任务、命名空间与单次 DDL', () => {
  beforeAll(async () => {
    try {
      const status = await engine.handle('connections.open', { id: profile.id, profile }); version = status.version;
      admin = await connect(profile); sampledIds.add(admin.connection.threadId!);
      for (const db of ownDatabases) { await sql(`CREATE DATABASE ${identifier(db)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`); created.add(db); }
      await sql(`USE ${identifier(database)}`);
      const checks = (await sql('SELECT @@SESSION.foreign_key_checks AS fkChecks,@@SESSION.unique_checks AS uniqueChecks'))[0];
      expect(String(checks.fkChecks)).toBe('1'); expect(String(checks.uniqueChecks)).toBe('1');
      console.info(JSON.stringify({ 外键验收库: ownDatabases, 版本: version, SSH: !!profile.ssh?.enabled, 严格TLS: !!profile.tls?.enabled, 两类检查均开启: true }));
    } catch (error) { failed = true; throw error; }
  }, 120000);

  afterEach(async context => {
    if (context.task.result?.state === 'fail') failed = true;
    // 每项显式释放尚未消费的引用，避免测试数量本身触发 32 个快照的生产额度。
    for (const previewToken of previews) await engine.handle('schema.foreignKeys.release', { previewToken });
    for (const snapshotId of snapshots) await engine.handle('schema.foreignKeys.release', { snapshotId });
    previews.clear(); snapshots.clear();
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    let failureSaved = false;
    try { await engine.closeAll(); } catch (error) { failed = true; errors.push(error); }
    if (admin) {
      try {
        if (failed) { await saveFailure(); failureSaved = true; }
      } catch (error) { errors.push(error); }
      try {
        // COM_QUIT 无服务器 ACK；等待实际目录中的本轮线程及已知 ID 归零，不把本地 close 回调当成服务器即时消失。
        // 仍严格要求零残留；超时则保留证据并拒绝通过 DROP 掩盖尚未结束的操作。
        await waitForNoRows(async () => (await processes()).filter(row => Number(row.Id) !== admin!.connection.threadId && (sampledIds.has(Number(row.Id)) || ownDatabases.some(db => row.db === db || (typeof row.Info === 'string' && row.Info.includes(db))))));
        for (const db of ownDatabases) if (created.has(db)) { if (!/^dbark_fkpatch_[a-f0-9]{12}$/.test(db)) throw new Error('拒绝清理非本轮隔离库'); await sql(`DROP DATABASE ${identifier(db)}`); }
      } catch (error) { failed = true; errors.push(error); if (!failureSaved) try { await saveFailure(); failureSaved = true; } catch (saveError) { errors.push(saveError); } }
      finally { try { await admin.close({ strict: true }); } catch (error) { errors.push(error); } }
    }
    // 独立观察连接在原连接关闭之后再次核库和已采样连接 ID；不会删除任何全局其他对象。
    let observer: ManagedConnection | undefined;
    try {
      if (created.size) {
        observer = await connect(profile);
        const schemas = (await execute<Row[]>(observer, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?,?)', ownDatabases)).rows;
        let remaining: Row[] = [];
        await waitForNoRows(async () => { remaining = (await processes(observer)).filter(row => Number(row.Id) !== observer!.connection.threadId && (sampledIds.has(Number(row.Id)) || ownDatabases.some(db => row.db === db || (typeof row.Info === 'string' && row.Info.includes(db))))); return remaining; });
        console.info(JSON.stringify({ 外键清理库: ownDatabases, 隔离库残留: schemas.length, 库线程或已记录ID残留: remaining.map(row => Number(row.Id)), 已记录连接ID: [...sampledIds] }));
        expect(schemas).toEqual([]); expect(remaining).toEqual([]);
      }
    } catch (error) { errors.push(error); }
    finally { try { await observer?.close({ strict: true }); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, '外键验收清理或证据保存未全部完成，请核对本轮随机库');
  }, 120000);

  it('真实非空命名空间闭合，已有外键与默认 self 父候选均来自实际目录', async () => {
    const setup = await pair('baseline', true), value = await get(setup.child);
    expect(value.writable).toBe(true); expect(value.namespaceCoverage).toBe('complete'); expect(value.incomingCoverage).toEqual({ kind: 'complete', source: 'innodb-dictionary' });
    expect(value.parents.some(parent => parent.target.database === database && parent.target.table === setup.child)).toBe(true);
    expect(value.parents.some(parent => parent.target.table === setup.parent.table)).toBe(true);
    const old = foreignKey(value, setup.name), defaultAction = /^8\./.test(version) ? 'NO ACTION' : 'RESTRICT';
    expect(old).toMatchObject({ childColumnNames: ['pid', 'p2'], parentColumnNames: ['a', 'b'], onUpdate: defaultAction, onDelete: defaultAction });
    expect(old.editableDefinition?.pairs).toHaveLength(2);
    expect(await relationship(setup.child, setup.name)).toMatchObject({ rules: [{ UPDATE_RULE: defaultAction, DELETE_RULE: defaultAction }] });
  }, 120000);

  it('新增复合有序 FK 真正生效，预览不改数据且原列与显式支持键完整保留', async () => {
    const setup = await pair('ordered');
    await sql(`INSERT INTO ${identifier(setup.parent.table)} VALUES(1,10,20,1)`); await sql(`INSERT INTO ${identifier(setup.child)} VALUES(1,10,20,NULL,NULL)`);
    const before = await preserved(setup.child), snapshot = await get(setup.child, [setup.parent]), name = 'ordered_added';
    const plan = await preview(snapshot, [addition(definition(snapshot, name, setup.parent))]);
    expect(await preserved(setup.child)).toEqual(before); expect((await relationship(setup.child, name)).columns).toEqual([]);
    expect(await apply(plan)).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true }); expect(await preserved(setup.child)).toEqual(before);
    expect((await relationship(setup.child, name)).columns).toEqual(['pid', 'p2'].map((column, index) => ({ COLUMN_NAME: column, REFERENCED_TABLE_SCHEMA: database, REFERENCED_TABLE_NAME: setup.parent.table, REFERENCED_COLUMN_NAME: ['a', 'b'][index] })));
    await expect(sql(`INSERT INTO ${identifier(setup.child)} VALUES(2,20,10,NULL,NULL)`)).rejects.toMatchObject({ errno: 1452 });
    expect(String((await sql(`SELECT COUNT(*) AS n FROM ${identifier(setup.child)}`))[0].n)).toBe('1');
  }, 120000);

  it('跨库父表显式加载并真实新增 FK，引用目标不误落到同名当前库表', async () => {
    await sql(`CREATE TABLE ${qualified(otherDatabase, 'cross_parent')}(id INT NOT NULL,a INT,b INT,PRIMARY KEY(id),UNIQUE KEY tuple_key(a,b)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
    await sql('CREATE TABLE cross_parent(id INT NOT NULL,a INT,b INT,PRIMARY KEY(id),UNIQUE KEY tuple_key(a,b)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    await sql(`INSERT INTO ${qualified(otherDatabase, 'cross_parent')} VALUES(1,11,22)`); await sql('INSERT INTO cross_parent VALUES(1,99,88)');
    await sql('CREATE TABLE cross_child(id INT PRIMARY KEY,pid INT,p2 INT,KEY support_pair(pid,p2)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const parent = { database: otherDatabase, table: 'cross_parent' }, value = await get('cross_child', [parent]);
    expect(await apply(await preview(value, [addition(definition(value, 'cross_added', parent))]))).toMatchObject({ definitionVerified: true });
    await sql('INSERT INTO cross_child VALUES(1,11,22)'); await expect(sql('INSERT INTO cross_child VALUES(2,99,88)')).rejects.toMatchObject({ errno: 1452 });
    expect((await relationship('cross_child', 'cross_added')).columns.every(row => row.REFERENCED_TABLE_SCHEMA === otherDatabase)).toBe(true);
  }, 120000);

  it('self 父候选无需重复加载，新增、实际约束和删除均保留原行与支持键', async () => {
    await sql('CREATE TABLE self_child(id INT NOT NULL,pid INT,p2 INT,a INT,b INT,PRIMARY KEY(id),UNIQUE KEY own_tuple(a,b),KEY support_pair(pid,p2)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    await sql('INSERT INTO self_child VALUES(1,NULL,NULL,10,20),(2,10,20,30,40)');
    const before = await preserved('self_child'), value = await get('self_child'), parent = { database, table: 'self_child' };
    expect(await apply(await preview(value, [addition(definition(value, 'self_added', parent))]))).toMatchObject({ definitionVerified: true });
    await expect(sql('INSERT INTO self_child VALUES(3,99,99,50,60)')).rejects.toMatchObject({ errno: 1452 });
    const next = await get('self_child');
    expect(await apply(await preview(next, [{ op: 'drop', foreignKeyRef: foreignKey(next, 'self_added').foreignKeyRef }]))).toMatchObject({ definitionVerified: true });
    expect(await preserved('self_child')).toEqual(before); expect((await relationship('self_child', 'self_added')).columns).toEqual([]);
  }, 120000);

  it('同名动作修改预览拒绝，显式异名替换后 UPDATE/DELETE CASCADE 真正作用于自主行', async () => {
    const setup = await pair('actions', true); await sql(`INSERT INTO ${identifier(setup.parent.table)} VALUES(1,10,20,0)`); await sql(`INSERT INTO ${identifier(setup.child)} VALUES(1,10,20,NULL,NULL)`);
    const snapshot = await get(setup.child), ref = foreignKey(snapshot, setup.name).foreignKeyRef, before = await preserved(setup.child);
    await expect(preview(snapshot, [{ op: 'alter', foreignKeyRef: ref, changes: { onDelete: 'CASCADE' } }])).rejects.toThrow('同名'); expect(await preserved(setup.child)).toEqual(before);
    const plan = await preview(snapshot, [{ op: 'alter', foreignKeyRef: ref, changes: { name: 'actions_new', onUpdate: 'CASCADE', onDelete: 'CASCADE' } }]);
    expect(plan.requiredAcknowledgements).toEqual(['ddl-implicit-commit', 'external-ddl-window', 'drop-foreign-key', 'referential-action-change']);
    expect(await apply(plan)).toMatchObject({ definitionVerified: true }); expect(await preserved(setup.child)).toEqual(before);
    expect((await relationship(setup.child, 'actions_new')).rules).toEqual([{ UPDATE_RULE: 'CASCADE', DELETE_RULE: 'CASCADE' }]);
    await sql(`UPDATE ${identifier(setup.parent.table)} SET a=11 WHERE id=1`); expect((await sql(`SELECT pid,p2 FROM ${identifier(setup.child)}`))[0]).toEqual({ pid: 11, p2: 20 });
    await sql(`DELETE FROM ${identifier(setup.parent.table)} WHERE id=1`); expect(await sql(`SELECT * FROM ${identifier(setup.child)}`)).toEqual([]);
  }, 120000);

  it('异名替换确实切换子列有序元组，旧映射不再支配而新映射拒绝孤儿', async () => {
    const setup = await pair('mapping', true); await sql(`INSERT INTO ${identifier(setup.parent.table)} VALUES(1,10,20,0),(2,30,40,0)`); await sql(`INSERT INTO ${identifier(setup.child)} VALUES(1,10,20,30,40)`);
    const snapshot = await get(setup.child), next = definition(snapshot, 'mapping_new', setup.parent, ['qid', 'q2']), before = await preserved(setup.child);
    expect(await apply(await preview(snapshot, [{ op: 'alter', foreignKeyRef: foreignKey(snapshot, setup.name).foreignKeyRef, changes: next }]))).toMatchObject({ definitionVerified: true });
    expect(await preserved(setup.child)).toEqual(before); expect((await relationship(setup.child, 'mapping_new')).columns.map(row => row.COLUMN_NAME)).toEqual(['qid', 'q2']);
    await sql(`INSERT INTO ${identifier(setup.child)} VALUES(2,999,999,30,40)`);
    await expect(sql(`INSERT INTO ${identifier(setup.child)} VALUES(3,10,20,999,999)`)).rejects.toMatchObject({ errno: 1452 });
    expect((await sql(`SELECT id FROM ${identifier(setup.child)} ORDER BY id`)).map(row => row.id)).toEqual([1, 2]);
  }, 120000);

  it('孤儿使异名替换返回 1452，旧约束、索引、列和行保持且旧 token 不重放', async () => {
    const setup = await pair('orphan', true); await sql(`INSERT INTO ${identifier(setup.parent.table)} VALUES(1,10,20,0)`); await sql(`INSERT INTO ${identifier(setup.child)} VALUES(1,10,20,999,999)`);
    const value = await get(setup.child), before = await preserved(setup.child), oldRules = await relationship(setup.child, setup.name), taskId = randomUUID();
    const plan = await preview(value, [{ op: 'alter', foreignKeyRef: foreignKey(value, setup.name).foreignKeyRef, changes: definition(value, 'orphan_new', setup.parent, ['qid', 'q2']) }]);
    await expect(apply(plan, taskId)).rejects.toMatchObject({ errno: 1452 });
    expect(finalEvent(taskId)).toMatchObject({ status: 'failed', foreignKeyPatch: { ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' } });
    await expect(apply(plan)).rejects.toThrow('已失效或已使用');
    expect(await preserved(setup.child)).toEqual(before); expect(await relationship(setup.child, setup.name)).toEqual(oldRules); expect((await relationship(setup.child, 'orphan_new')).columns).toEqual([]);
    expect((await get(setup.child)).ddlHash).toBe(value.ddlHash);
    await expect(sql(`INSERT INTO ${identifier(setup.child)} VALUES(2,777,777,10,20)`)).rejects.toMatchObject({ errno: 1452 });
  }, 120000);

  it('独立删除 FK 不删支持索引、列和原行，删除后旧约束确实不再验证新行', async () => {
    const setup = await pair('drop_case', true); await sql(`INSERT INTO ${identifier(setup.parent.table)} VALUES(1,10,20,0)`); await sql(`INSERT INTO ${identifier(setup.child)} VALUES(1,10,20,NULL,NULL)`);
    const before = await preserved(setup.child), value = await get(setup.child), plan = await preview(value, [{ op: 'drop', foreignKeyRef: foreignKey(value, setup.name).foreignKeyRef }]);
    expect(plan.sql).toBe(`ALTER TABLE ${qualified(database, setup.child)} DROP FOREIGN KEY ${identifier(setup.name)};`);
    expect(await apply(plan)).toMatchObject({ definitionVerified: true }); expect(await preserved(setup.child)).toEqual(before);
    expect((await relationship(setup.child, setup.name)).columns).toEqual([]); await sql(`INSERT INTO ${identifier(setup.child)} VALUES(2,999,999,NULL,NULL)`);
  }, 120000);

  it.each([
    ['type', 'BIGINT', 'INT'], ['signed', 'INT UNSIGNED', 'INT'],
    ['charset', 'VARCHAR(20) CHARACTER SET latin1 COLLATE latin1_bin', 'VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'],
    ['collation', 'VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci', 'VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'],
  ])('不兼容 %s 在 preview 拒绝且实际目录无 FK', async (kind, childType, parentType) => {
    const child = `mismatch_${kind}_child`, parent = `mismatch_${kind}_parent`;
    await sql(`CREATE TABLE ${identifier(parent)}(id INT PRIMARY KEY,a ${parentType},UNIQUE KEY parent_value(a)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
    await sql(`CREATE TABLE ${identifier(child)}(id INT PRIMARY KEY,pid ${childType},KEY support_value(pid)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
    const parentTarget = { database, table: parent }, value = await get(child, [parentTarget]), before = await preserved(child);
    await expect(preview(value, [addition(definition(value, `mismatch_${kind}_fk`, parentTarget, ['pid'], ['a']))])).rejects.toThrow(/类型|精度|字符集|排序规则/);
    expect(await preserved(child)).toEqual(before); expect((await relationship(child, `mismatch_${kind}_fk`)).columns).toEqual([]);
  }, 120000);

  it.each(['child_absent', 'child_reversed', 'parent_nonunique', 'parent_extra_part', 'parent_prefix', 'notnull_setnull'])('支持键或可空性边界 %s 不让服务器隐式补键或改列', async kind => {
    const child = `${kind}_child`, parent = `${kind}_parent`, text = kind === 'parent_prefix', type = text ? 'VARCHAR(20)' : 'INT';
    const parentKey = kind === 'parent_nonunique' ? 'KEY parent_tuple(a,b)' : kind === 'parent_extra_part' ? 'UNIQUE KEY parent_tuple(a,b,id)' : text ? 'UNIQUE KEY parent_tuple(a(3),b)' : 'UNIQUE KEY parent_tuple(a,b)';
    const childKey = kind === 'child_absent' ? '' : kind === 'child_reversed' ? ',KEY support_tuple(p2,pid)' : ',KEY support_tuple(pid,p2)';
    await sql(`CREATE TABLE ${identifier(parent)}(id INT PRIMARY KEY,a ${type},b INT,${parentKey}) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
    await sql(`CREATE TABLE ${identifier(child)}(id INT PRIMARY KEY,pid ${type}${kind === 'notnull_setnull' ? ' NOT NULL' : ''},p2 INT${childKey}) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
    const parentTarget = { database, table: parent }, value = await get(child, [parentTarget]), before = await preserved(child);
    const expected = kind.startsWith('child_') ? /子表支持索引/ : kind === 'notnull_setnull' ? /SET NULL/ : /PRIMARY\/UNIQUE/;
    await expect(preview(value, [addition(definition(value, `${kind}_fk`, parentTarget, ['pid', 'p2'], ['a', 'b'], kind === 'notnull_setnull' ? { onDelete: 'SET NULL' } : {}))])).rejects.toThrow(expected);
    expect(await preserved(child)).toEqual(before); expect((await relationship(child, `${kind}_fk`)).columns).toEqual([]);
  }, 120000);

  it('SET NULL 在真实全部可空的复合子列上成功，父删除后整组 NULL 而其他列保留', async () => {
    const setup = await pair('set_null'); await sql(`INSERT INTO ${identifier(setup.parent.table)} VALUES(1,10,20,0)`); await sql(`INSERT INTO ${identifier(setup.child)} VALUES(1,10,20,30,40)`);
    const value = await get(setup.child, [setup.parent]);
    expect(await apply(await preview(value, [addition(definition(value, 'set_null_added', setup.parent, ['pid', 'p2'], ['a', 'b'], { onDelete: 'SET NULL' }))]))).toMatchObject({ definitionVerified: true });
    await sql(`DELETE FROM ${identifier(setup.parent.table)} WHERE id=1`);
    expect(await sql(`SELECT * FROM ${identifier(setup.child)}`)).toEqual([{ id: 1, pid: null, p2: null, qid: 30, q2: 40 }]);
  }, 120000);

  it.each(['ack', 'revision', 'release'])('实际旧预览经 %s 边界拒绝且不会投递 ALTER', async kind => {
    const setup = await pair(`guard_${kind}`), value = await get(setup.child, [setup.parent]), before = await preserved(setup.child);
    const plan = await preview(value, [addition(definition(value, `guard_${kind}_new`, setup.parent))]), taskId = randomUUID();
    if (kind === 'release') await engine.handle('schema.foreignKeys.release', { snapshotId: value.snapshotId });
    await expect(apply(plan, taskId, kind === 'ack' ? [] : plan.requiredAcknowledgements, kind === 'revision' ? 2 : 1)).rejects.toThrow(kind === 'ack' ? /确认项/ : kind === 'revision' ? /连接配置/ : /失效/);
    expect(events.some(event => event.taskId === taskId)).toBe(false); await expect(apply(plan)).rejects.toThrow('已失效或已使用');
    expect(await preserved(setup.child)).toEqual(before); expect((await relationship(setup.child, `guard_${kind}_new`)).columns).toEqual([]);
  }, 120000);

  it('父表外部 DDL 不改子表定义也使旧预览拒绝，事件明确尚未发送 DDL', async () => {
    const setup = await pair('parent_drift'), value = await get(setup.child, [setup.parent]);
    const plan = await preview(value, [addition(definition(value, 'parent_drift_added', setup.parent))]), taskId = randomUUID();
    await sql(`ALTER TABLE ${identifier(setup.parent.table)} COMMENT='external_change'`);
    await expect(apply(plan, taskId)).rejects.toThrow(/定义已变化|目录.*变化/);
    expect(finalEvent(taskId)).toMatchObject({ status: 'failed', foreignKeyPatch: { ddlSubmitted: false, ddlCompleted: false, outcome: 'not-sent' } });
    expect((await get(setup.child, [setup.parent])).ddlHash).toBe(value.ddlHash); expect((await relationship(setup.child, 'parent_drift_added')).columns).toEqual([]);
  }, 120000);

  it('无关表占用全局 FK 名导致旧预览失效，重读后服务器比较拒绝大小写碰撞', async () => {
    const setup = await pair('name_drift'), value = await get(setup.child, [setup.parent]), name = 'name_drift_added';
    const plan = await preview(value, [addition(definition(value, name, setup.parent))]), taskId = randomUUID();
    await sql('CREATE TABLE namespace_owner_parent(id INT PRIMARY KEY) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    await sql(`CREATE TABLE namespace_owner_child(id INT PRIMARY KEY,pid INT,KEY support_pid(pid),CONSTRAINT ${identifier(name.toUpperCase())} FOREIGN KEY(pid) REFERENCES namespace_owner_parent(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
    await expect(apply(plan, taskId)).rejects.toThrow(/命名空间.*变化/);
    expect(finalEvent(taskId)?.foreignKeyPatch).toMatchObject({ ddlSubmitted: false, ddlCompleted: false });
    const current = await get(setup.child, [setup.parent]);
    await expect(preview(current, [addition(definition(current, name, setup.parent))])).rejects.toThrow(/名称.*可用/);
    expect((await relationship(setup.child, name)).columns).toEqual([]);
  }, 120000);

  it('元数据锁取消等待真实终态并释放父子租约，其他查询会话事务和临时表完整保留', async () => {
    const setup = await pair('cancel_fk'); await sql('CREATE TABLE session_guard(id INT PRIMARY KEY,v INT) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const { sessionId } = await engine.handle('sessions.open', { connectionId: profile.id, database });
    let locked = false, operation: Promise<{ error?: unknown; result?: TableForeignKeyApplyOutput }> | undefined;
    const taskId = randomUUID();
    try {
      const executeSession = (statement: string): Promise<QueryOutcome> => engine.handle('query.execute', { sessionId, sql: statement, maxRows: 10, taskId: randomUUID() });
      const initial = await executeSession('CREATE TEMPORARY TABLE own_temp(v INT);INSERT INTO own_temp VALUES(7);SELECT CONNECTION_ID() AS session_id');
      const initialResult = initial.results.at(-1)!, originalId = initialResult.rows[0][initialResult.columns[0].key]; sampledIds.add(Number(originalId));
      await engine.handle('query.transaction', { sessionId, action: 'begin' }); await executeSession('INSERT INTO session_guard VALUES(1,42)');
      const value = await get(setup.child, [setup.parent]), plan = await preview(value, [addition(definition(value, 'cancel_fk_added', setup.parent))]);
      const indexSnapshot = await engine.handle('schema.indexes.get', { connectionId: profile.id, ...setup.parent, taskId: randomUUID(), connectionRevision: 1 }) as TableIndexGetOutput;
      const indexRef = indexSnapshot.indexes.find(index => index.name === 'own_note')!.indexRef;
      const parentPlan = await engine.handle('schema.indexes.preview', { snapshotId: indexSnapshot.snapshotId, patches: [{ op: 'alter', indexRef, changes: { name: 'own_note_renamed' } }], taskId: randomUUID(), connectionRevision: 1 }) as TableIndexPreviewOutput;
      await sql(`LOCK TABLES ${identifier(setup.child)} READ`); locked = true;
      operation = apply(plan, taskId).then(result => ({ result }), error => ({ error }));
      const waiting = await waitingStructure(setup.child);
      await expect(engine.handle('schema.indexes.apply', { previewToken: parentPlan.previewToken, acknowledgements: parentPlan.requiredAcknowledgements, taskId: randomUUID(), connectionRevision: 1 })).rejects.toThrow('结构变更正在执行');
      await engine.handle('query.cancel', { taskId }); expect((await operation).error).toBeInstanceOf(Error);
      expect(finalEvent(taskId)).toMatchObject({ status: 'cancelled', foreignKeyPatch: { ddlCompleted: false, definitionVerified: false } });
      expect(finalEvent(taskId)?.foreignKeyPatch?.ddlSubmitted).toBe(/^ALTER TABLE\b/i.test(waiting.sql));
      await expect.poll(async () => (await processes()).filter(row => Number(row.Id) === waiting.id).length, { timeout: 10000, interval: 50 }).toBe(0);
      await sql('UNLOCK TABLES'); locked = false;
      expect((await relationship(setup.child, 'cancel_fk_added')).columns).toEqual([]);
      // 使用新的明确计划验证租约已释放，不重放被占用拒绝或已取消的旧令牌。
      const after = await engine.handle('schema.indexes.get', { connectionId: profile.id, ...setup.parent, taskId: randomUUID(), connectionRevision: 1 }) as TableIndexGetOutput;
      const newPlan = await engine.handle('schema.indexes.preview', { snapshotId: after.snapshotId, patches: [{ op: 'alter', indexRef: after.indexes.find(index => index.name === 'own_note')!.indexRef, changes: { name: 'own_note_renamed' } }], taskId: randomUUID(), connectionRevision: 1 }) as TableIndexPreviewOutput;
      expect(await engine.handle('schema.indexes.apply', { previewToken: newPlan.previewToken, acknowledgements: newPlan.requiredAcknowledgements, taskId: randomUUID(), connectionRevision: 1 })).toMatchObject({ definitionVerified: true });
      expect(await engine.handle('query.sessionState', { sessionId })).toMatchObject({ transactionOpen: true, transactionKnown: true, broken: false });
      expect(String((await sql('SELECT COUNT(*) AS n FROM session_guard'))[0].n)).toBe('0');
      const current = await executeSession('SELECT CONNECTION_ID() AS session_id,v FROM own_temp;SELECT v FROM session_guard');
      expect(current.results[0].rows[0][current.results[0].columns[0].key]).toBe(originalId);
      expect(current.results[0].rows[0][current.results[0].columns[1].key]).toBe(7); expect(current.results[1].rows[0][current.results[1].columns[0].key]).toBe(42);
      await engine.handle('query.transaction', { sessionId, action: 'rollback' }); expect(await sql('SELECT * FROM session_guard')).toEqual([]);
    } finally {
      try { if (operation) await engine.handle('query.cancel', { taskId }); }
      finally {
        try { if (locked) await sql('UNLOCK TABLES'); }
        finally { if (operation) await operation; try { await engine.handle('query.transaction', { sessionId, action: 'rollback' }); } finally { await engine.handle('sessions.close', { sessionId }); } }
      }
    }
  }, 120000);
});
