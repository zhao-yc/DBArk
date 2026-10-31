import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier, qualified } from '../../src/engine/sql';
import type { NetworkConnectionProfile as ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { TableColumnGetOutput, TableColumnPreviewOutput } from '../../src/shared/tableColumnPatches';
import type { TableIndexGetOutput, TableIndexPreviewOutput } from '../../src/shared/tableIndexTasks';
import type { IndexPatch } from '../../src/shared/tableIndexPatches';
import type { TableForeignKeyGetOutput, TableForeignKeyPreviewOutput } from '../../src/shared/tableForeignKeyTasks';
import type { ForeignKeyPatch } from '../../src/shared/tableForeignKeyPatches';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const profile: ConnectionProfile = {
  id: randomUUID(), name: '字段权限隔离验收', group: '', color: '#123456', dialect: 'mysql',
  host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306),
  user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '',
  ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}),
  ...(process.env.DBARK_TEST_SSH === '1' ? { ssh: { enabled: true, host: process.env.DBARK_TEST_SSH_HOST ?? '', port: Number(process.env.DBARK_TEST_SSH_PORT ?? 22), user: process.env.DBARK_TEST_SSH_USER ?? '', privateKeyPath: process.env.DBARK_TEST_SSH_KEY, hostFingerprint: process.env.DBARK_TEST_SSH_FINGERPRINT } } : {}),
};
type Privilege = 'SELECT' | 'ALTER' | 'CREATE' | 'INSERT';
type Row = Record<string, unknown>;
interface PermissionCase {
  engine: Engine; events: TaskEvent[]; database: string; table: string; limited: ManagedConnection;
  get(): Promise<TableColumnGetOutput>;
  preview(snapshot: TableColumnGetOutput): Promise<TableColumnPreviewOutput>;
  apply(plan: TableColumnPreviewOutput, taskId: string): Promise<unknown>;
  sql(text: string, params?: (string | number)[]): Promise<Row[]>;
  assertPrivileges(): Promise<void>;
  getIndexes(): Promise<TableIndexGetOutput>;
  previewIndexes(snapshot: TableIndexGetOutput, patches: IndexPatch[]): Promise<TableIndexPreviewOutput>;
  applyIndexes(plan: TableIndexPreviewOutput, taskId: string): Promise<unknown>;
  getForeignKeys(): Promise<TableForeignKeyGetOutput>;
  previewForeignKeys(snapshot: TableForeignKeyGetOutput, patches: ForeignKeyPatch[], taskId: string): Promise<TableForeignKeyPreviewOutput>;
}

/** 只允许已约定的服务器与基线端口；启用开关不是访问其他数据库的授权。 */
function assertTestTarget(): void {
  const ports = [13357, 13380, 13384, 13310, 13311];
  if (profile.tls?.enabled) ports.push(13484);
  if (profile.host !== '192.168.31.200' || !ports.includes(profile.port)) throw new Error('字段权限验收仅允许 200 服务器既有隔离基线');
}

/** 只提取无密码的错误编号，避免 CREATE USER 失败时驱动的 sql 字段进入日志。 */
function errorNumber(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'errno' in error && typeof error.errno === 'number' ? error.errno : undefined;
}

/** 每项独立建库和用户；失败也先结束引擎，再精确回收本轮资源并观察归零。 */
async function withPermissionCase(grants: Privilege[], action: (context: PermissionCase) => Promise<void>): Promise<void> {
  assertTestTarget();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const database = `dbark_colperm_${suffix}`, user = `cp_${suffix}`, table = qualified(database, 'subject');
  if (!/^dbark_colperm_[a-f0-9]{12}$/.test(database) || !/^cp_[a-f0-9]{12}$/.test(user)) throw new Error('隔离目标名称无效');
  const account = `'${user}'@'%'`, password = `Cp!9${randomBytes(24).toString('hex')}`;
  const limitedProfile: ConnectionProfile = { ...profile, id: randomUUID(), name: '临时字段权限连接', database, user, password };
  const events: TaskEvent[] = [], engine = new Engine(event => events.push(event));
  const recordedIds = new Set<number>(), cleanupErrors: unknown[] = [];
  let admin: ManagedConnection | undefined, limited: ManagedConnection | undefined, failure: unknown;
  let createdDatabase = false, attemptedUser = false;
  const cleanupCounts: { schemas?: number; users?: number; userThreads?: number; recordedThreads?: number } = {};
  /** 管理 SQL 仅处理本轮库或精确用户目录，不扫描业务表和完整查询文本。 */
  const sql = async (text: string, params: (string | number)[] = []): Promise<Row[]> => (await execute<Row[]>(admin!, text, params)).rows;
  /** 权限目录避免 SHOW GRANTS 在部分版本携带认证哈希；同时检查未出现扩大授权。 */
  const assertPrivileges = async (): Promise<void> => {
    const tableGrants = await sql('SELECT TABLE_SCHEMA AS db,TABLE_NAME AS name,PRIVILEGE_TYPE AS privilege,IS_GRANTABLE AS grantable FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=? ORDER BY PRIVILEGE_TYPE', [account]);
    expect(tableGrants.map(row => row.privilege)).toEqual([...grants].sort());
    for (const row of tableGrants) expect(row).toMatchObject({ db: database, name: 'subject', grantable: 'NO' });
    expect(await sql('SELECT PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=?', [account])).toHaveLength(0);
    expect(await sql("SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=? AND PRIVILEGE_TYPE<>'USAGE'", [account])).toHaveLength(0);
    expect(await sql('SELECT PRIVILEGE_TYPE FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE=?', [account])).toHaveLength(0);
  };
  /** 只记本临时用户的线程 ID；采样不冒充所有短会话的完整协议审计。 */
  const userThreads = async (): Promise<number[]> => {
    const rows = await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE USER=?', [user]);
    const ids = rows.map(row => Number(row.ID));
    for (const id of ids) { if (!Number.isSafeInteger(id) || id <= 0) throw new Error('服务器线程编号无效'); recordedIds.add(id); }
    return ids;
  };
  try {
    admin = await connect(profile); recordedIds.add(admin.connection.threadId!);
    // 使用服务器默认排序规则，连同最小权限一起验证别名目录能力，不能靠固定 binary 规则绕过。
    await sql(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`); createdDatabase = true;
    await sql(`CREATE TABLE ${table} (id INT NOT NULL PRIMARY KEY,v VARCHAR(40) NOT NULL DEFAULT '原值' COMMENT '原注释',UNIQUE KEY uq_value(v)) ENGINE=InnoDB COMMENT='权限验收表'`);
    await sql(`INSERT INTO ${table}(id,v) VALUES (1,'保留数据')`);
    // 随机名也先核对不存在；创建响应丢失时可清理本轮尝试，不误删碰撞的旧账户。
    expect(await sql('SELECT User FROM mysql.user WHERE User=? AND Host=?', [user, '%'])).toHaveLength(0);
    attemptedUser = true;
    try { await sql(`CREATE USER ${account} IDENTIFIED BY '${password}'`); }
    catch (error) { throw new Error(`创建本轮临时用户失败，数据库错误编号 ${errorNumber(error) ?? '未知'}；含认证信息的原始错误未输出`); }
    // 表级目标是精确标识符，不用含下划线库名的 db.* 授权模式。
    await sql(`GRANT ${grants.join(',')} ON ${table} TO ${account}`);
    await assertPrivileges();
    limited = await connect(limitedProfile); recordedIds.add(limited.connection.threadId!);
    const status = await engine.handle('connections.open', { id: limitedProfile.id, profile: limitedProfile });
    if (status.connectionId !== undefined) recordedIds.add(status.connectionId);
    await userThreads();
    console.info(JSON.stringify({ 权限验收库: database, 临时用户: user, 版本: status.version, 表级授权: grants, SSH: Boolean(profile.ssh?.enabled), 严格TLS: Boolean(profile.tls?.enabled) }));
    await action({ engine, events, database, table, limited, sql, assertPrivileges,
      get: () => engine.handle('schema.columns.get', { connectionId: limitedProfile.id, database, table: 'subject', taskId: randomUUID(), connectionRevision: 1 }),
      preview: snapshot => {
        const column = snapshot.columns.find(value => value.name === 'v');
        if (!column) throw new Error('真实快照缺少夹具字段');
        return engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches: [{ kind: 'alter', columnRef: column.columnRef, changes: { comment: '标准权限修改' } }], taskId: randomUUID(), connectionRevision: 1 });
      },
      apply: (plan, taskId) => engine.handle('schema.columns.apply', { previewToken: plan.previewToken, acknowledgements: plan.requiredAcknowledgements, taskId, connectionRevision: 1 }),
      getIndexes: () => engine.handle('schema.indexes.get', { connectionId: limitedProfile.id, database, table: 'subject', taskId: randomUUID(), connectionRevision: 1 }),
      previewIndexes: (snapshot, patches) => engine.handle('schema.indexes.preview', { snapshotId: snapshot.snapshotId, patches, taskId: randomUUID(), connectionRevision: 1 }),
      applyIndexes: (plan, taskId) => engine.handle('schema.indexes.apply', { previewToken: plan.previewToken, acknowledgements: plan.requiredAcknowledgements, taskId, connectionRevision: 1 }),
      getForeignKeys: () => engine.handle('schema.foreignKeys.get', { connectionId: limitedProfile.id, database, table: 'subject', taskId: randomUUID(), connectionRevision: 1 }),
      previewForeignKeys: (snapshot, patches, taskId) => engine.handle('schema.foreignKeys.preview', { snapshotId: snapshot.snapshotId, patches, taskId, connectionRevision: 1 }),
    });
    await assertPrivileges();
  } catch (error) { failure = error; }
  finally {
    // 一个关闭失败不能阻止其余连接和本轮服务器资源继续收尾。
    for (const close of [() => engine.closeAll(), () => limited?.close({ strict: true })]) {
      try { await close(); } catch (error) { cleanupErrors.push(error); }
    }
    if (admin) {
      /** 每项收尾独立尝试，目录断言失败不能阻止精确 DROP。 */
      const cleanup = async (action: () => Promise<unknown>): Promise<void> => {
        try { await action(); } catch (error) { cleanupErrors.push(error); }
      };
      if (admin.broken) {
        await cleanup(() => admin!.close({ strict: true }));
        await cleanup(async () => { admin = await connect(profile); recordedIds.add(admin.connection.threadId!); });
      }
      if (attemptedUser) await cleanup(async () => {
        const remaining = await userThreads();
        if (remaining.length) cleanupErrors.push(new Error(`引擎关闭后临时用户仍有线程：${remaining.join(',')}`));
        // 仅回收精确临时账户的实际线程；记录泄漏为失败，不用清理成功掩盖它。
        for (const id of remaining) await cleanup(() => sql(`KILL CONNECTION ${id}`));
        await expect.poll(userThreads, { timeout: 5000, interval: 50 }).toHaveLength(0);
      });
      if (attemptedUser) await cleanup(() => sql(`DROP USER IF EXISTS ${account}`));
      if (createdDatabase) await cleanup(() => sql(`DROP DATABASE ${identifier(database)}`));
      await cleanup(async () => {
        if (createdDatabase) {
          cleanupCounts.schemas = (await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])).length;
          expect(cleanupCounts.schemas).toBe(0);
        }
        if (attemptedUser) {
          cleanupCounts.users = (await sql('SELECT User FROM mysql.user WHERE User=? AND Host=?', [user, '%'])).length;
          cleanupCounts.userThreads = (await userThreads()).length;
          expect(cleanupCounts).toMatchObject({ users: 0, userThreads: 0 });
        }
      });
      await cleanup(() => admin!.close({ strict: true }));
      // 关闭管理连接后再用独立观察连接核对所有采样 ID，避免只检查客户端对象。
      let observer: ManagedConnection | undefined;
      try {
        observer = await connect(profile);
        if (recordedIds.size) {
          const ids = [...recordedIds];
          await expect.poll(async () => {
            cleanupCounts.recordedThreads = (await execute<Row[]>(observer!, `SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${ids.map(() => '?').join(',')})`, ids)).rows.length;
            return cleanupCounts.recordedThreads;
          }, { timeout: 5000, interval: 50 }).toBe(0);
        }
      } catch (error) { cleanupErrors.push(error); }
      finally { try { await observer?.close({ strict: true }); } catch (error) { cleanupErrors.push(error); } }
      console.info(JSON.stringify({ 权限验收库: database, 临时用户: user, 已记录连接ID: [...recordedIds], 残留: cleanupCounts, 清理检查通过: cleanupErrors.length === 0, 清理错误数: cleanupErrors.length, 任务终态: events.filter(event => ['completed', 'failed', 'cancelled'].includes(event.status)).map(event => ({ taskId: event.taskId, status: event.status, columnPatch: event.columnPatch, indexPatch: event.indexPatch, foreignKeyPatch: event.foreignKeyPatch })) }));
    }
  }
  if (failure && cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], '字段权限验收及资源清理均失败');
  if (failure) throw failure;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, '字段权限验收资源清理失败');
}

describe.skipIf(!enabled)('真实字段差异最小权限边界', () => {
  it('只有 SELECT 可读取和预览，无 ALTER 实际拒绝且消费令牌，定义和值不变', async () => {
    await withPermissionCase(['SELECT'], async context => {
      const { table, sql, get, preview, apply, events } = context;
      const before = (await sql(`SHOW CREATE TABLE ${table}`))[0]['Create Table'];
      const snapshot = await get();
      expect(snapshot.columns.find(column => column.name === 'v')).toMatchObject({ nullable: false, comment: '原注释' });
      const plan = await preview(snapshot), taskId = randomUUID();
      expect(plan.sql).toContain('标准权限修改');
      await expect(apply(plan, taskId)).rejects.toMatchObject({ errno: 1142 });
      const terminal = events.filter(event => event.taskId === taskId && ['completed', 'failed', 'cancelled'].includes(event.status));
      expect(terminal).toHaveLength(1);
      expect(terminal[0]).toMatchObject({ status: 'failed', columnPatch: { ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' } });
      const reusedTaskId = randomUUID();
      await expect(apply(plan, reusedTaskId)).rejects.toThrow('已失效或已使用');
      expect(events.filter(event => event.taskId === reusedTaskId)).toHaveLength(0);
      expect((await sql(`SHOW CREATE TABLE ${table}`))[0]['Create Table']).toBe(before);
      expect(await sql(`SELECT id,v FROM ${table}`)).toEqual([{ id: 1, v: '保留数据' }]);
    });
  }, 45000);

  it('只有 SELECT ALTER CREATE INSERT 且无 LOCK TABLES，标准单次修改成功并保留唯一约束', async () => {
    await withPermissionCase(['SELECT', 'ALTER', 'CREATE', 'INSERT'], async context => {
      const { table, sql, get, preview, apply, events, limited } = context;
      let lockError: unknown;
      try { await execute(limited, `LOCK TABLES ${table} READ`); }
      catch (error) { lockError = error; }
      finally { if (!lockError) await execute(limited, 'UNLOCK TABLES'); }
      expect([1044, 1142, 1227]).toContain(errorNumber(lockError));
      expect(String((lockError as Error).message)).toMatch(/denied/i);
      const plan = await preview(await get()), taskId = randomUUID();
      expect(plan.sql).toMatch(/^ALTER TABLE /);
      expect(plan.sql).not.toMatch(/LOCK\s+TABLES|FOREIGN_KEY_CHECKS|DISABLE\s+KEYS|GRANT\s/i);
      expect(await apply(plan, taskId)).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true });
      const terminal = events.filter(event => event.taskId === taskId && ['completed', 'failed', 'cancelled'].includes(event.status));
      expect(terminal).toHaveLength(1);
      expect(terminal[0]).toMatchObject({ status: 'completed', columnPatch: { ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' } });
      const definition = String((await sql(`SHOW CREATE TABLE ${table}`))[0]['Create Table']);
      expect(definition).toContain("COMMENT '标准权限修改'");
      expect(definition).toContain('UNIQUE KEY `uq_value` (`v`)');
      expect(definition).toContain("COMMENT='权限验收表'");
      expect(await sql(`SELECT id,v FROM ${table}`)).toEqual([{ id: 1, v: '保留数据' }]);
      await expect(execute(limited, `INSERT INTO ${table}(id,v) VALUES (2,'保留数据')`)).rejects.toMatchObject({ errno: 1062 });
      expect(await sql(`SELECT id,v FROM ${table}`)).toEqual([{ id: 1, v: '保留数据' }]);
      expect((await get()).columns.find(column => column.name === 'v')).toMatchObject({ comment: '标准权限修改', nullable: false });
    });
  }, 45000);
});

describe.skipIf(!enabled)('真实索引差异最小权限边界', () => {
  it('仅 SELECT 时目录降级不伪造无依赖，原生改名实际无 ALTER 权限而拒绝', async () => {
    await withPermissionCase(['SELECT'], async context => {
      const snapshot = await context.getIndexes(); expect(snapshot.incomingCoverage).toEqual({ kind: 'partial', reason: 'permission' });
      const value = snapshot.indexes.find(index => index.name === 'uq_value')!; expect(value.access.drop.allowed).toBe(false); expect(value.access.rename.allowed).toBe(true);
      const before = (await context.sql(`SHOW CREATE TABLE ${context.table}`))[0]['Create Table'];
      const plan = await context.previewIndexes(snapshot, [{ op: 'alter', indexRef: value.indexRef, changes: { name: 'renamed_unique' } }]), taskId = randomUUID();
      await expect(context.applyIndexes(plan, taskId)).rejects.toMatchObject({ errno: 1142 });
      expect(context.events.filter(event => event.taskId === taskId).at(-1)).toMatchObject({ status: 'failed', indexPatch: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } });
      await expect(context.applyIndexes(plan, randomUUID())).rejects.toThrow('已失效或已使用');
      expect((await context.sql(`SHOW CREATE TABLE ${context.table}`))[0]['Create Table']).toBe(before); expect(await context.sql(`SELECT id,v FROM ${context.table}`)).toEqual([{ id: 1, v: '保留数据' }]);
    });
  }, 45000);
  it('限定四种表级权限且无 LOCK TABLES，可单次改名和新增普通键，不扩大授权', async () => {
    await withPermissionCase(['SELECT', 'ALTER', 'CREATE', 'INSERT'], async context => {
      let lockError: unknown; try { await execute(context.limited, `LOCK TABLES ${context.table} READ`); } catch (error) { lockError = error; }
      finally { if (!lockError) await execute(context.limited, 'UNLOCK TABLES'); }
      expect([1044, 1142, 1227]).toContain(errorNumber(lockError));
      let snapshot = await context.getIndexes(), value = snapshot.indexes.find(index => index.name === 'uq_value')!;
      let plan = await context.previewIndexes(snapshot, [{ op: 'alter', indexRef: value.indexRef, changes: { name: 'renamed_unique' } }]);
      expect(await context.applyIndexes(plan, randomUUID())).toMatchObject({ ddlCompleted: true, definitionVerified: true });
      snapshot = await context.getIndexes(); const column = snapshot.columns.find(column => column.name === 'id')!;
      plan = await context.previewIndexes(snapshot, [{ op: 'add', clientKey: randomUUID(), definition: { kind: 'ordinary', name: 'ordinary_id', method: 'BTREE', comment: '', keyParts: [{ columnRef: column.columnRef, direction: 'asc' }] } }]);
      expect(await context.applyIndexes(plan, randomUUID())).toMatchObject({ ddlCompleted: true, definitionVerified: true }); await context.assertPrivileges();
      await expect(execute(context.limited, `INSERT INTO ${context.table}(id,v) VALUES(2,'保留数据')`)).rejects.toMatchObject({ errno: 1062 });
      expect(await context.sql(`SELECT id,v FROM ${context.table}`)).toEqual([{ id: 1, v: '保留数据' }]);
    });
  }, 45000);
});

describe.skipIf(!enabled)('真实外键差异最小权限边界', () => {
  for (const grants of [['SELECT'], ['SELECT', 'ALTER', 'CREATE', 'INSERT']] satisfies Privilege[][]) {
    it(`仅 ${grants.join(' ')}：自引用快照可读，名称与入向目录不完整时新增预览拒绝且不投递 DDL`, async () => {
      await withPermissionCase(grants, async context => {
        const before = (await context.sql(`SHOW CREATE TABLE ${context.table}`))[0]['Create Table'];
        const originalRows = await context.sql(`SELECT id,v FROM ${context.table} ORDER BY id`);
        const snapshot = await context.getForeignKeys();
        expect(snapshot.target).toMatchObject({ database: context.database, table: 'subject' });
        expect(snapshot.foreignKeys).toHaveLength(0);
        expect(snapshot.namespaceCoverage).toBe('partial');
        expect(snapshot.incomingCoverage).toEqual({ kind: 'partial', reason: 'permission' });
        // 可查看或可靠删除的能力不等于可新增；不能把整个表误断言为 writable=false。
        expect(snapshot.warnings.join('；')).toMatch(/权限|目录|未知|不完整/);
        const self = snapshot.parents.find(parent => parent.target.database === context.database && parent.target.table === 'subject');
        if (!self) throw new Error('真实外键快照缺少自身父表候选');
        const childId = snapshot.columns.find(column => column.name === 'id');
        const parentId = self.columns.find(column => column.name === 'id');
        if (!childId || !parentId) throw new Error('真实自引用快照缺少 id 字段');
        expect(parentId.columnRef).toBe(childId.columnRef);
        expect(self.keys.some(key => key.kind === 'primary' && key.columnRefs.length === 1 && key.columnRefs[0] === parentId.columnRef)).toBe(true);
        const taskId = randomUUID();
        // 使用服务返回的 opaque refs；主键已有完整父子支持，不靠无效字段掩盖名称权限边界。
        await expect(context.previewForeignKeys(snapshot, [{ op: 'add', clientKey: randomUUID(), definition: {
          name: 'fk_permission_self', parentRef: self.parentRef,
          pairs: [{ childColumnRef: childId.columnRef, parentColumnRef: parentId.columnRef }],
          onUpdate: 'RESTRICT', onDelete: 'RESTRICT',
        } }], taskId)).rejects.toThrow(/外键名称.*命名空间/);
        const terminal = context.events.filter(event => event.taskId === taskId && ['completed', 'failed', 'cancelled'].includes(event.status));
        expect(terminal).toHaveLength(1);
        expect(terminal[0]).toMatchObject({ status: 'failed', foreignKeyPatch: { ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' } });
        expect(context.events.some(event => event.foreignKeyPatch?.ddlSubmitted)).toBe(false);
        expect((await context.sql(`SHOW CREATE TABLE ${context.table}`))[0]['Create Table']).toBe(before);
        expect(await context.sql(`SELECT id,v FROM ${context.table} ORDER BY id`)).toEqual(originalRows);
        expect(originalRows).toEqual([{ id: 1, v: '保留数据' }]);
        await context.assertPrivileges();
      });
    }, 45000);
  }
});
