import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { TableCreateTasks } from '../../src/engine/tableCreateTasks';
import type { ManagedConnection } from '../../src/engine/connection';
import type { StructureTaskContext, StructureTaskHost, StructureTaskOptions } from '../../src/engine/structureDefinition';
import { tableCreateRequiredAcknowledgements, type TableCreateDraft, type TableCreateGetOutput, type TableCreatePreviewOutput } from '../../src/shared/tableCreate';

/** 本地端口只提供固定服务器回调与严格关闭门，不伪造Tasks计划、后核或令牌结果。 */
function fixture(dialect: 'mysql' | 'mariadb' = 'mysql') {
  let version = dialect === 'mysql' ? '8.4.11' : '11.4.13-MariaDB', mode = '', created = false, submitted = 0, task = 0, shows = 0, lateShow = false, closeFails = false, cancelled = false, denied = false;
  let wrongCheck = false, checkEnabled = true, rowChanged = false, holdClose: Promise<void> | undefined;
  const commands: string[] = [], progress: unknown[] = [];
  let source = 'CREATE TABLE `subject` (`qty` int DEFAULT NULL,KEY `ix_qty` (`qty`),CONSTRAINT `ck_qty` CHECK (`qty` >= 0)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
  let columns: Record<string, string | number | null>[] = [{ name: 'qty', ordinal: 1, typeSql: 'int', dataType: 'int', nullable: 'YES', defaultValue: dialect === 'mariadb' ? 'NULL' : null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' }];
  const design: TableCreateDraft = { database: 'db', name: 'subject', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [{ name: 'qty', type: 'INT', nullable: true, autoIncrement: false, comment: '' }], indexes: [{ name: 'ix_qty', unique: false, columns: ['qty'] }], foreignKeys: [], checks: [{ name: 'ck_qty', expression: '`qty` >= 0', enforced: true }] };
  let json = false, generated = false;
  const connection = Object.assign(new EventEmitter(), { query(sql: string, callback: (error: Error | null, value?: unknown) => void) {
    commands.push(sql); let result: unknown;
    if (sql.startsWith('SELECT @@hostname')) result = [{ hostname: 'ram', port: 3306, serverId: 7, currentUser: 'ram@host', sqlMode: mode, lowerNames: 0, charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
    else if (sql === 'SELECT VERSION() AS version,@@SESSION.sql_mode AS sqlMode') result = [{ version, sqlMode: mode }];
    else if (sql.startsWith('SELECT VERSION() AS version,')) result = [{ version, os: 'Linux', lowerNames: 0, sqlMode: mode, quoteShowCreate: 1, hostname: 'ram', port: 3306, serverId: 7, currentUser: 'ram@host', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
    else if (sql.startsWith('SELECT @@server_uuid')) result = [{ uuid: '11111111-2222-3333-4444-555555555555' }];
    else if (sql.startsWith('SELECT @@version AS version,@@explicit_defaults_for_timestamp')) result = [{ version, explicitTimestamp: 1, innodbStrict: 1 }];
    else if (sql.startsWith('SELECT ENGINE AS engine')) result = [{ engine: 'InnoDB', support: 'DEFAULT' }];
    else if (sql.startsWith('SELECT CHARACTER_SET_NAME AS charset')) result = [{ charset: 'utf8mb4' }];
    else if (sql.startsWith('SELECT SCHEMA_NAME')) result = [{ name: 'db', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
    else if (sql.startsWith('SELECT TABLE_NAME FROM')) result = created ? [{ TABLE_NAME: 'subject' }] : [];
    else if (sql.startsWith('SET SESSION ')) result = { affectedRows: 0 };
    else if (sql.startsWith('SELECT @@SESSION.foreign_key_checks AS fk')) result = [{ fk: 1, uq: 1, checks: checkEnabled ? 1 : 0, sqlMode: mode }];
    else if (sql.startsWith('CREATE TABLE')) { submitted++; created = true; result = { affectedRows: 0, warningStatus: 0 }; }
    else if (sql.startsWith('SHOW CREATE TABLE')) { shows++; result = [{ 'Create Table': lateShow && shows >= 2 ? source.replace('qty` >= 0', 'qty` > 99') : source }]; }
    else if (sql.includes('FROM information_schema.TABLE_CONSTRAINTS')) result = [{ schemaName: 'db', databaseName: 'db', tableName: 'subject', name: 'ck_qty', type: 'CHECK', enforced: dialect === 'mysql' ? 'YES' : null }, ...(json ? [{ schemaName: 'db', databaseName: 'db', tableName: 'subject', name: 'doc', type: 'CHECK', enforced: null }] : [])];
    else if (sql.includes('FROM information_schema.CHECK_CONSTRAINTS')) { if (denied) { queueMicrotask(() => callback(Error('合成目录拒读'))); return; } result = [{ schemaName: 'db', tableName: 'subject', name: 'ck_qty', expression: wrongCheck ? '`qty` < 0' : '`qty` >= 0' }, ...(json ? [{ schemaName: 'db', tableName: 'subject', name: 'doc', expression: 'json_valid(`doc`)' }] : [])]; }
    else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset')) result = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin', compiled: 'Yes' }];
    else if (sql.startsWith('SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS')) result = [];
    else if (sql.startsWith('SELECT t.TABLE_SCHEMA AS databaseName')) result = [{ databaseName: 'db', tableName: 'subject', kind: 'BASE TABLE', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
    else if (sql.startsWith('SELECT PARTITION_NAME AS name')) result = [{ name: null }];
    else if (sql.startsWith('SELECT t.TABLE_NAME')) result = [{ name: 'subject', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' }];
    else if (sql.startsWith('SELECT COLUMN_NAME AS name,ORDINAL_POSITION')) { result = structuredClone(columns); if (rowChanged && shows > 0) (result as Record<string, unknown>[])[1].collation = 'utf8mb4_general_ci'; }
    else if (sql.startsWith('SELECT COLUMN_NAME AS name,COLUMN_TYPE')) result = columns.map(row => ({ name: row.name, type: row.typeSql, nullable: row.nullable, defaultValue: row.defaultValue, extra: row.extra, comment: row.comment }));
    else if (sql.startsWith('SELECT INDEX_NAME AS name')) result = [{ name: 'ix_qty', nonUnique: 1, column: 'qty', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' }];
    else { queueMicrotask(() => callback(Error('CHECK新表任务未登记SQL：' + sql.slice(0, 80)))); return; }
    queueMicrotask(() => callback(null, structuredClone(result)));
  } });
  const host: StructureTaskHost = { async run<T>(_connectionId: string, _taskId: string, action: (context: StructureTaskContext) => Promise<T>, options: StructureTaskOptions): Promise<T> {
    task++; const managed = { connection, broken: false, status: { dialect, version } } as unknown as ManagedConnection;
    try { return await action({ managed, checkCancelled() { if (cancelled) throw Error('合成任务已取消'); }, report() { progress.push({ ...options.progress }); }, commandStarted: () => () => {} }); }
    finally { if (holdClose) await holdClose; if (closeFails) throw Error('合成严格关闭未知'); options.onResourcesReleased?.(); }
  } };
  const tasks = new TableCreateTasks(host), get = (include = true, extras: { includeGeneratedFacts?: boolean; includeEncodings?: boolean } = {}): Promise<TableCreateGetOutput> => tasks.get({ connectionId: 'c', database: 'db', taskId: 'get-' + task, ...(include ? { includeCheckFacts: true } : {}), ...extras }, 1);
  const preview = (snapshot: TableCreateGetOutput, input = design): Promise<TableCreatePreviewOutput> => tasks.preview({ snapshotId: snapshot.snapshotId, design: input, taskId: 'preview-' + task }, 1);
  const apply = (value: TableCreatePreviewOutput, ack = value.requiredAcknowledgements) => tasks.apply({ previewToken: value.previewToken, confirmation: 'db.subject', acknowledgements: ack, taskId: 'apply-' + task }, 1);
  return { tasks, design, commands, progress, get, preview, apply, get submitted() { return submitted; }, get created() { return created; }, mode(value: string) { mode = value; }, version(value: string) { version = value; }, deny() { denied = true; }, wrong() { wrongCheck = true; }, late() { lateShow = true; }, failClose() { closeFails = true; }, cancel() { cancelled = true; }, disable() { checkEnabled = false; }, closing(value: Promise<void>) { holdClose = value; },
    /** 增量组合仍使用独立手写SHOW/COLUMNS，不从生成SQL导出后核期望。 */
    combine(kind: 'encoding' | 'generated') {
      json = dialect === 'mariadb'; generated = kind === 'generated';
      if (json) { design.columns.push({ name: 'doc', type: 'JSON', nullable: true, autoIncrement: false, comment: '' }); columns.push({ name: 'doc', ordinal: 2, typeSql: 'longtext', dataType: 'longtext', nullable: 'YES', defaultValue: 'NULL', extra: '', generationExpression: '', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' }); }
      design.columns.push({ name: 'note', type: 'VARCHAR(40)', nullable: true, autoIncrement: false, comment: '', ...(kind === 'encoding' ? { collation: { charset: 'utf8mb4', collation: 'utf8mb4_bin' } } : {}) });
      columns.push({ name: 'note', ordinal: columns.length + 1, typeSql: 'varchar(40)', dataType: 'varchar', nullable: 'YES', defaultValue: dialect === 'mariadb' ? 'NULL' : null, extra: '', generationExpression: '', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' });
      if (generated) { design.columns.push({ name: 'total', type: 'INT', nullable: true, autoIncrement: false, comment: '', generated: { storage: 'VIRTUAL', expression: 'qty + 1' } }); columns.push({ name: 'total', ordinal: columns.length + 1, typeSql: 'int', dataType: 'int', nullable: 'YES', defaultValue: dialect === 'mariadb' ? 'NULL' : null, extra: 'VIRTUAL GENERATED', generationExpression: '`qty` + 1', charset: null, collation: null, comment: '' }); }
      source = 'CREATE TABLE `subject` (`qty` int DEFAULT NULL,' + (json ? '`doc` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`doc`)),' : '') + '`note` varchar(40)' + (kind === 'encoding' ? ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : '') + ' DEFAULT NULL,' + (generated ? '`total` int GENERATED ALWAYS AS ((`qty` + 1)) VIRTUAL,' : '') + 'KEY `ix_qty` (`qty`),CONSTRAINT `ck_qty` CHECK (`qty` >= 0)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
    }, changedJson() { rowChanged = true; }
  };
}

describe('命名表级CHECK新建表真实Tasks生命周期', () => {
  it('完整get→preview→apply只发送一次CREATE，约束ACK及最终SHOW均存在', async () => {
    const f = fixture(), snapshot = await f.get(); expect(snapshot.checksAccess).toEqual({ editable: true, allowsNotEnforced: true });
    const plan = await f.preview(snapshot); expect(f.submitted).toBe(0); expect(plan.requiredAcknowledgements).toEqual(tableCreateRequiredAcknowledgements(f.design)); expect(plan.requiredAcknowledgements).toContain('create-check-enforcement');
    const result = await f.apply(plan); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); expect(f.commands.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([plan.sql]); expect(f.commands.filter(sql => sql.startsWith('SHOW CREATE'))).toHaveLength(2);
    await expect(f.apply(plan)).rejects.toThrow('失效'); expect(f.submitted).toBe(1); expect(f.commands.some(sql => /^DROP |^ALTER /.test(sql))).toBe(false);
  });
  it('未请求CHECK事实旧get不加查询/开关；带checks设计不能借旧快照退回legacy', async () => {
    const f = fixture(), snapshot = await f.get(false); expect(snapshot.checksAccess).toBeUndefined(); expect(f.commands.some(sql => sql.includes('check_constraint_checks') || sql.includes('@@SESSION.foreign_key_checks'))).toBe(false);
    await expect(f.preview(snapshot)).rejects.toThrow('CHECK'); expect(f.submitted).toBe(0);
    const { checks: _checks, ...normal } = f.design; expect((await f.preview(snapshot, normal)).sql).not.toContain('CHECK');
  });
  it('5.7显式事实只读且不能忽略CHECK；Maria逐约束停用不降级', async () => {
    const f = fixture(); f.version('5.7.44'); const snapshot = await f.get(); expect(snapshot.checksAccess?.editable).toBe(false); await expect(f.preview(snapshot)).rejects.toThrow(); expect(f.submitted).toBe(0);
    const maria = fixture('mariadb'), m = await maria.get(); maria.design.checks![0].enforced = false; await expect(maria.preview(m)).rejects.toThrow(); expect(maria.submitted).toBe(0);
  });
  it('缺CHECK风险确认同步消费preview，错误后不发送或重放CREATE', async () => {
    const f = fixture(), plan = await f.preview(await f.get()); await expect(f.apply(plan, plan.requiredAcknowledgements.filter(value => value !== 'create-check-enforcement'))).rejects.toThrow('确认'); await expect(f.apply(plan)).rejects.toThrow('失效'); expect(f.submitted).toBe(0);
  });
  it.each(['mode', 'checks-off', 'cancel'])('执行前%s变化拒绝且旧preview不可再次使用', async kind => {
    const f = fixture('mariadb'), plan = await f.preview(await f.get()); if (kind === 'mode') f.mode('NO_BACKSLASH_ESCAPES'); if (kind === 'checks-off') f.disable(); if (kind === 'cancel') f.cancel(); await expect(f.apply(plan)).rejects.toThrow(); await expect(f.apply(plan)).rejects.toThrow('失效'); expect(f.submitted).toBe(0);
  });
  it.each(['missing-catalog', 'wrong-expression', 'late-show'])('CREATE成功后%s只保ACK事实，不谎称完整定义', async kind => {
    const f = fixture(), plan = await f.preview(await f.get()); if (kind === 'missing-catalog') f.deny(); if (kind === 'wrong-expression') f.wrong(); if (kind === 'late-show') f.late();
    expect(await f.apply(plan)).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true }); expect(f.submitted).toBe(1); await expect(f.apply(plan)).rejects.toThrow('失效');
  });
  it.each(['encoding', 'generated'] as const)('Maria JSON隐式CHECK与%s完整交叉共存，保真实编码和生成语义', async kind => {
    const f = fixture('mariadb'); f.combine(kind); const plan = await f.preview(await f.get(true, { includeEncodings: kind === 'encoding', includeGeneratedFacts: kind === 'generated' }));
    expect(plan.sql).toContain('CONSTRAINT `ck_qty` CHECK'); expect(plan.sql).toContain('`doc` JSON');
    expect(await f.apply(plan)).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); expect(f.submitted).toBe(1);
  });
  it.each(['encoding', 'generated'] as const)('Maria JSON与%s组合目录编码改变不能借adapter放行', async kind => {
    const f = fixture('mariadb'); f.combine(kind); const plan = await f.preview(await f.get(true, { includeEncodings: kind === 'encoding', includeGeneratedFacts: kind === 'generated' })); f.changedJson();
    expect(await f.apply(plan)).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(f.submitted).toBe(1);
  });
  it('原strict host关闭未结算不能提前返回resourcesReleased，关闭失败保ACK且不重放', async () => {
    const f = fixture(), plan = await f.preview(await f.get()); let release!: () => void; f.closing(new Promise<void>(resolve => { release = resolve; })); let settled = false;
    const pending = f.apply(plan).finally(() => { settled = true; }); for (let i = 0; i < 150; i++) await Promise.resolve(); expect(settled).toBe(false); release(); expect(await pending).toMatchObject({ resourcesReleased: true });
    const bad = fixture(), second = await bad.preview(await bad.get()); bad.failClose(); expect(await bad.apply(second)).toMatchObject({ ddlCompleted: true, resourcesReleased: false }); await expect(bad.apply(second)).rejects.toThrow(); expect(bad.submitted).toBe(1);
  });
});
