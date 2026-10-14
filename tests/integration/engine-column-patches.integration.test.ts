import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { ConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import { readControlledTimestampDefault, type ColumnPatch, type TableColumnGetOutput, type TableColumnPreviewOutput } from '../../src/shared/tableColumnPatches';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_colpatch_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const profile: ConnectionProfile = {
  id: randomUUID(), name: '字段差异隔离验收', group: '', color: '#123456', dialect: 'mysql',
  host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '',
  ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}),
  ...(process.env.DBARK_TEST_SSH === '1' ? { ssh: { enabled: true, host: process.env.DBARK_TEST_SSH_HOST ?? '', port: Number(process.env.DBARK_TEST_SSH_PORT ?? 22), user: process.env.DBARK_TEST_SSH_USER ?? '', privateKeyPath: process.env.DBARK_TEST_SSH_KEY, hostFingerprint: process.env.DBARK_TEST_SSH_FINGERPRINT } } : {}),
};
const events: TaskEvent[] = [], recordedIds = new Set<number>();
const engine = new Engine(event => events.push(event));
let admin: ManagedConnection | undefined, created = false, failed = false;
/** 只操作本轮随机库，永不修改全局模式、业务库或服务器用户。 */
async function sql(text: string) { return (await execute(admin!, text)).rows as Record<string, unknown>[]; }
/** 仅主进程有权提供的修订由本集成边界显式注入；SQL、网络和任务实现均为生产代码。 */
async function get(table: string): Promise<TableColumnGetOutput> { return engine.handle('schema.columns.get', { connectionId: profile.id, database, table, taskId: randomUUID(), connectionRevision: 1 }); }
/** 引用只取真实服务器快照，不由名字构造。 */
function ref(snapshot: TableColumnGetOutput, name: string): string { const value = snapshot.columns.find(column => column.name === name); if (!value) throw new Error('夹具字段不存在'); return value.columnRef; }
/** 每次预览申请新令牌，任何失败都不重放旧计划。 */
async function preview(snapshot: TableColumnGetOutput, patches: ColumnPatch[]): Promise<TableColumnPreviewOutput> { return engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches, taskId: randomUUID(), connectionRevision: 1 }); }
/** 应用只发送一次，确认项来自该真实预览。 */
async function apply(value: TableColumnPreviewOutput, taskId = randomUUID()) { return engine.handle('schema.columns.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId, connectionRevision: 1 }); }
/** 从真实 PROCESSLIST 记录当前本库请求；不把采样说成所有短连接的完整审计。 */
async function processes() {
  const rows = await sql('SHOW FULL PROCESSLIST');
  for (const row of rows) if (row.db === database || (typeof row.Info === 'string' && row.Info.includes(database))) recordedIds.add(Number(row.Id));
  return rows;
}
/** 只等待可观察条件，不以固定睡眠假定 ALTER 已投递。 */
async function waitingAlter(): Promise<number> {
  let id: number | undefined;
  await expect.poll(async () => {
    const rows = await processes(), found = rows.find(row => typeof row.Info === 'string' && row.Info.startsWith('ALTER TABLE') && row.Info.includes(database) && String(row.State).toLowerCase().includes('metadata lock'));
    id = found ? Number(found.Id) : undefined; return id;
  }, { timeout: 12000, interval: 50 }).toBeDefined();
  return id!;
}

describe.skipIf(!enabled)('真实字段差异短会话与单次 DDL', () => {
  beforeAll(async () => {
    try {
      const status = await engine.handle('connections.open', { id: profile.id, profile });
      admin = await connect(profile); recordedIds.add(admin.connection.threadId!);
      // 让服务器采用该版本的真实默认排序规则，不能强制 bin 掩盖 MariaDB UCA 别名目录问题。
      await sql(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`); created = true;
      await sql(`USE ${identifier(database)}`);
      console.info(JSON.stringify({ 验收库: database, 版本: status.version, SSH: Boolean(profile.ssh?.enabled), 严格TLS: Boolean(profile.tls?.enabled), 管理连接ID: admin.connection.threadId }));
    } catch (error) { failed = true; throw error; }
  });
  afterEach(context => { if (context.task.result?.state === 'fail') failed = true; });
  afterAll(async () => {
    // 失败定义写入本轮独立证据目录；确认线程结束后仍精确清库，不重放失败 DDL。
    try {
      await engine.closeAll();
      if (admin && created) {
        const remaining = (await processes()).filter(row => Number(row.Id) !== admin!.connection.threadId && (row.db === database || (typeof row.Info === 'string' && row.Info.includes(database))));
        if (remaining.length) failed = true;
        console.info(JSON.stringify({ 验收库: database, 记录失败证据: failed, 已记录连接ID: [...recordedIds], 收尾残留连接ID: remaining.map(row => Number(row.Id)) }));
        if (failed) {
          const directory = join(process.cwd(), '.cache', 'o01-integration-evidence', database); await mkdir(directory, { recursive: true });
          const objects = await sql('SHOW FULL TABLES'), definitions: Record<string, unknown>[] = [];
          for (const object of objects) { const name = Object.values(object)[0]; if (typeof name === 'string') definitions.push(...await sql(`SHOW CREATE TABLE ${identifier(name)}`)); }
          await writeFile(join(directory, 'failure-definitions.json'), JSON.stringify({ database, recordedIds: [...recordedIds], remainingIds: remaining.map(row => Number(row.Id)), definitions, events }, null, 2), { flag: 'wx' });
          console.info(JSON.stringify({ 失败证据目录: directory }));
        }
        if (!remaining.length) await sql(`DROP DATABASE ${identifier(database)}`);
        expect(remaining).toHaveLength(0);
      }
    } finally { await admin?.close({ strict: true }); }
  });

  it('只改无依赖字段注释，保留生成列、前缀索引注释、自增和表选项', async () => {
    await sql("CREATE TABLE preserved (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,v VARCHAR(80) DEFAULT 'x',note VARCHAR(50) DEFAULT NULL,generated_length INT GENERATED ALWAYS AS (LENGTH(v)) STORED,changed TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),KEY idx_v(v(7)) COMMENT '索引注释') ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='表尾注释'");
    const snapshot = await get('preserved'); expect(snapshot.columns.find(column => column.name === 'note')?.nullable).toBe(true);
    const plan = await preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'note'), changes: { comment: "中文,'反斜线\\末" } }]);
    expect(plan.sql).not.toContain('MODIFY COLUMN `id`');
    const result = await apply(plan); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    const ddl = String((await sql('SHOW CREATE TABLE preserved'))[0]['Create Table']);
    expect(ddl).toContain('AUTO_INCREMENT'); expect(ddl).toContain("COMMENT '索引注释'"); expect(ddl).toContain("COMMENT='表尾注释'"); expect(ddl).toMatch(/GENERATED ALWAYS/i);
    await sql("INSERT INTO preserved(v) VALUES ('12345')"); expect((await sql('SELECT generated_length FROM preserved'))[0].generated_length).toBe(5);
  });

  it('none、NULL、空串、文本 NULL 与精确 DECIMAL 默认值分别保留', async () => {
    await sql("CREATE TABLE defaults_case (id INT PRIMARY KEY,required_value VARCHAR(30) NOT NULL DEFAULT 'old',nullable_value VARCHAR(30) DEFAULT 'old',empty_value VARCHAR(30) DEFAULT 'old',text_null VARCHAR(30) DEFAULT 'old',exact_value DECIMAL(30,6) NOT NULL DEFAULT 0)");
    const snapshot = await get('defaults_case');
    const patches: ColumnPatch[] = [
      { kind: 'alter', columnRef: ref(snapshot, 'required_value'), changes: { default: { kind: 'none' } } },
      { kind: 'alter', columnRef: ref(snapshot, 'nullable_value'), changes: { default: { kind: 'null' } } },
      { kind: 'alter', columnRef: ref(snapshot, 'empty_value'), changes: { default: { kind: 'literal', valueType: 'text', value: '' } } },
      { kind: 'alter', columnRef: ref(snapshot, 'text_null'), changes: { default: { kind: 'literal', valueType: 'text', value: 'NULL' } } },
      { kind: 'alter', columnRef: ref(snapshot, 'exact_value'), changes: { default: { kind: 'literal', valueType: 'number', value: '12345678901234567890.123456' } } },
    ];
    expect(await apply(await preview(snapshot, patches))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    await sql("INSERT INTO defaults_case(id,required_value) VALUES (1,'explicit')");
    expect((await sql('SELECT nullable_value,empty_value,text_null,exact_value FROM defaults_case'))[0]).toMatchObject({ nullable_value: null, empty_value: '', text_null: 'NULL', exact_value: '12345678901234567890.123456' });
    expect((await get('defaults_case')).columns.find(column => column.name === 'required_value')?.default.kind).toBe('none');
  });

  it.each([0, 6])('CURRENT_TIMESTAMP(%i) 默认省略写入保留精度，原 ON UPDATE/注释不变', async precision => {
    const table = `timestamp_default_${precision}`;
    await sql(`CREATE TABLE ${identifier(table)} (id INT PRIMARY KEY,d DATETIME(${precision}) NOT NULL DEFAULT '2000-01-01 00:00:00' ON UPDATE CURRENT_TIMESTAMP(${precision}) COMMENT '原日期',t TIMESTAMP(${precision}) NULL DEFAULT '2000-01-01 00:00:00' ON UPDATE CURRENT_TIMESTAMP(${precision}) COMMENT '原时间',expected DATETIME(6))`);
    const snapshot = await get(table), patches: ColumnPatch[] = ['d', 't'].map(name => ({ kind: 'alter', columnRef: ref(snapshot, name), changes: { default: { kind: 'expression', expression: 'current-timestamp', precision } } }));
    const plan = await preview(snapshot, patches), result = await apply(plan);
    expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    const current = await get(table);
    for (const name of ['d', 't']) { const column = current.columns.find(value => value.name === name)!; expect(column.default.kind).toBe('expression'); if (column.default.kind === 'expression') expect(readControlledTimestampDefault(column.default.sql)).toEqual({ precision }); expect(column.rawDefinition).toMatch(/ON UPDATE current_timestamp/i); }
    // 同一 INSERT 的 NOW 与默认时间使用同一语句时钟；6 位微秒必须逐字符相同，避免 Date/Number 转换。
    await sql(`INSERT INTO ${identifier(table)}(id,expected) VALUES(1,NOW(6))`);
    const format = precision ? '%Y-%m-%d %H:%i:%s.%f' : '%Y-%m-%d %H:%i:%s';
    const actual = (await sql(`SELECT DATE_FORMAT(d,'${format}') AS d,DATE_FORMAT(t,'${format}') AS t,DATE_FORMAT(expected,'${format}') AS expected FROM ${identifier(table)} WHERE id=1`))[0];
    expect(actual.d).toBe(actual.expected); expect(actual.t).toBe(actual.expected);
    if (precision) expect(actual.d).toMatch(/\.\d{6}$/);
  });

  it('新增、改名、类型、可空、位次和删除只作用指定字段', async () => {
    await sql('CREATE TABLE operations_case (id INT PRIMARY KEY,v VARCHAR(20) NULL DEFAULT NULL)');
    let snapshot = await get('operations_case');
    expect(await apply(await preview(snapshot, [{ kind: 'add', clientKey: 'added', name: '__proto__', type: { kind: 'integer', type: 'INT', unsigned: false }, nullable: true, default: { kind: 'null' }, comment: '新增', position: { kind: 'last' } }]))).toMatchObject({ definitionVerified: true });
    snapshot = await get('operations_case');
    expect(await apply(await preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'v'), changes: { name: '中文`字段', type: { kind: 'string', type: 'VARCHAR', length: 40 }, nullable: false, default: { kind: 'literal', valueType: 'text', value: '' }, position: { kind: 'last' } } }]))).toMatchObject({ definitionVerified: true });
    snapshot = await get('operations_case'); expect(snapshot.columns.map(column => column.name)).toEqual(['id', '__proto__', '中文`字段']);
    expect(await apply(await preview(snapshot, [{ kind: 'drop', columnRef: ref(snapshot, '__proto__') }]))).toMatchObject({ definitionVerified: true });
    expect((await get('operations_case')).columns.map(column => column.name)).toEqual(['id', '中文`字段']);
  });

  it('受支持版本 TEXT 文本与 BLOB HEX 默认省略写入保真，5.7 在预览拒绝非 NULL 大对象默认', async () => {
    await sql('CREATE TABLE large_defaults (id INT PRIMARY KEY,text_value TEXT,binary_value BLOB)');
    const snapshot = await get('large_defaults'), patches: ColumnPatch[] = [
      { kind: 'alter', columnRef: ref(snapshot, 'text_value'), changes: { default: { kind: 'literal', valueType: 'text', value: "汉字'\\换行\n" } } },
      { kind: 'alter', columnRef: ref(snapshot, 'binary_value'), changes: { default: { kind: 'literal', valueType: 'binary', value: '00ff0127' } } },
    ];
    if (snapshot.capabilities.dialect === 'mysql' && snapshot.capabilities.serverVersion.startsWith('5.7.')) {
      const start = events.length; await expect(preview(snapshot, patches)).rejects.toThrow('不支持该大对象');
      expect(events.slice(start).every(event => !event.columnPatch?.ddlSubmitted)).toBe(true); return;
    }
    expect(await apply(await preview(snapshot, patches))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    await sql('INSERT INTO large_defaults(id) VALUES(1)');
    const row = (await sql('SELECT HEX(text_value) AS text_hex,HEX(binary_value) AS binary_hex FROM large_defaults'))[0];
    expect(row.text_hex).toBe(Buffer.from("汉字'\\换行\n").toString('hex').toUpperCase()); expect(row.binary_hex).toBe('00FF0127');
  });

  it('新增字符串和数值转字符串按真实继承字符集核验', async () => {
    await sql('CREATE TABLE string_inheritance (id INT PRIMARY KEY,v INT DEFAULT 7) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin');
    let snapshot = await get('string_inheritance');
    expect(await apply(await preview(snapshot, [{ kind: 'add', clientKey: 'text', name: 'text_value', type: { kind: 'string', type: 'VARCHAR', length: 50 }, nullable: true, default: { kind: 'null' }, comment: '继承排序规则', position: { kind: 'last' } }]))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    snapshot = await get('string_inheritance');
    expect(await apply(await preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'v'), changes: { type: { kind: 'string', type: 'VARCHAR', length: 30 } } }]))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    const columns = await sql("SELECT COLUMN_NAME AS name,CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='string_inheritance' AND COLUMN_NAME IN ('v','text_value')");
    expect(columns).toHaveLength(2); for (const column of columns) expect(column).toMatchObject({ charset: 'utf8mb4', collation: 'utf8mb4_bin' });
  });

  it('库和表未指定 COLLATE 时读取真实默认目录，注释/新增/跨族类型修改仍完整核验', async () => {
    await sql("CREATE TABLE default_collation_case(id INT PRIMARY KEY,v INT DEFAULT 7,note VARCHAR(20) COMMENT '旧')");
    const expected = (await sql(`SELECT DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${database}'`))[0];
    expect(expected.charset).toBe('utf8mb4'); expect(typeof expected.collation).toBe('string');
    const info = await engine.handle('metadata.table', { connectionId: profile.id, database, table: 'default_collation_case' }); expect(info).toMatchObject({ charset: expected.charset, collation: expected.collation });
    let snapshot = await get('default_collation_case');
    expect(await apply(await preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'note'), changes: { comment: '新' } }]))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    snapshot = await get('default_collation_case');
    expect(await apply(await preview(snapshot, [
      { kind: 'alter', columnRef: ref(snapshot, 'v'), changes: { type: { kind: 'string', type: 'VARCHAR', length: 20 } } },
      { kind: 'add', clientKey: 'inherited', name: 'added', type: { kind: 'string', type: 'VARCHAR', length: 20 }, nullable: true, default: { kind: 'null' }, comment: '', position: { kind: 'last' } },
    ]))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    const columns = await sql(`SELECT CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='default_collation_case' AND COLUMN_NAME IN ('v','note','added')`);
    expect(columns).toHaveLength(3); for (const column of columns) expect(column).toEqual(expected);
    await sql('INSERT INTO default_collation_case(id) VALUES(1)'); expect((await sql('SELECT v FROM default_collation_case'))[0].v).toBe('7');
  });

  it('两 Maria 显式 UCA 完整别名从真实目录解析，不依赖数据库默认值', async context => {
    if (admin!.status.dialect !== 'mariadb') { context.skip(); return; }
    await sql("CREATE TABLE explicit_uca_case(id INT PRIMARY KEY,v VARCHAR(20) COMMENT '旧') DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_as_cs");
    const info = await engine.handle('metadata.table', { connectionId: profile.id, database, table: 'explicit_uca_case' }); expect(info).toMatchObject({ charset: 'utf8mb4', collation: 'utf8mb4_uca1400_as_cs' });
    const snapshot = await get('explicit_uca_case');
    expect(await apply(await preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'v'), changes: { comment: '新' } }]))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    expect((await sql(`SELECT CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation,COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='explicit_uca_case' AND COLUMN_NAME='v'`))[0]).toEqual({ charset: 'utf8mb4', collation: 'utf8mb4_uca1400_as_cs', comment: '新' });
  });

  it('外部结构变化使旧令牌拒绝，已消费令牌不再次提交', async () => {
    await sql('CREATE TABLE stale_case (id INT PRIMARY KEY,v VARCHAR(20))');
    const snapshot = await get('stale_case'), plan = await preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'v'), changes: { comment: '不能发送' } }]);
    await sql("ALTER TABLE stale_case COMMENT='外部结构修改'");
    await expect(apply(plan)).rejects.toThrow('定义已变化'); await expect(apply(plan)).rejects.toThrow('已失效或已使用');
    expect(String((await sql('SHOW CREATE TABLE stale_case'))[0]['Create Table'])).not.toContain('不能发送');
  });

  it('结构短会话不提交查询标签事务，也不污染该标签 ROW_COUNT', async () => {
    await sql('CREATE TABLE transaction_data (id INT PRIMARY KEY)'); await sql('CREATE TABLE isolated_ddl (id INT PRIMARY KEY,v INT)');
    const { sessionId } = await engine.handle('sessions.open', { connectionId: profile.id, database });
    try {
      await engine.handle('query.execute', { sessionId, sql: 'START TRANSACTION; INSERT INTO transaction_data VALUES (1)', taskId: randomUUID(), maxRows: 20 });
      const snapshot = await get('isolated_ddl'); await apply(await preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'v'), changes: { comment: '短连接' } }]));
      expect(await engine.handle('query.sessionState', { sessionId })).toMatchObject({ transactionOpen: true, transactionKnown: true });
      const count: QueryOutcome = await engine.handle('query.execute', { sessionId, sql: 'SELECT ROW_COUNT() AS affected', taskId: randomUUID(), maxRows: 20 });
      // 查询结果以稳定 key 存行，alias 只在列元数据中；首轮真实证据为 affected -> c0 -> '1'。
      const result = count.results[0], affected = result.columns.find(column => column.name === 'affected');
      expect(affected).toBeDefined(); expect(Object.hasOwn(result.rows[0], affected!.key)).toBe(true);
      // ROW_COUNT / COUNT 返回 LONGLONG，生产驱动保留精确字符串；不能用 Number 类型期望误判。
      expect(result.rows[0][affected!.key]).toBe('1'); expect((await sql('SELECT COUNT(*) AS n FROM transaction_data'))[0].n).toBe('0');
      await engine.handle('query.transaction', { sessionId, action: 'rollback' });
    } finally { await engine.handle('sessions.close', { sessionId }); }
  });

  it('Maria 风险默认值使原生改名和旁列预览均拒绝且不改变实际默认值', async context => {
    if (admin!.status.dialect !== 'mariadb') { context.skip(); return; }
    await sql("CREATE TABLE maria_expression (id INT PRIMARY KEY,v VARCHAR(40) DEFAULT (concat(_utf8mb4'À',_utf8mb4'汉') COLLATE utf8mb4_bin),note INT)");
    await sql('INSERT INTO maria_expression(id) VALUES(1)'); const original = (await sql('SELECT HEX(v) AS value FROM maria_expression WHERE id=1'))[0].value;
    const snapshot = await get('maria_expression'), column = snapshot.columns.find(value => value.name === 'v')!;
    expect(column.access.comment.editable).toBe(false); expect(column.access.name.editable).toBe(false);
    expect(snapshot.warnings.some(warning => warning.includes('任意字段 ALTER') && warning.includes('"v"'))).toBe(true);
    const eventStart = events.length;
    await expect(preview(snapshot, [{ kind: 'alter', columnRef: column.columnRef, changes: { comment: '拒绝重述' } }])).rejects.toThrow('不能证明');
    await expect(preview(snapshot, [{ kind: 'alter', columnRef: column.columnRef, changes: { name: 'renamed' } }])).rejects.toThrow('全部风险默认值');
    await expect(preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'note'), changes: { comment: '旁列也拒绝' } }])).rejects.toThrow('全部风险默认值');
    expect(events.slice(eventStart).every(event => !event.columnPatch?.ddlSubmitted)).toBe(true);
    await sql('INSERT INTO maria_expression(id) VALUES(2)'); expect((await sql('SELECT HEX(v) AS value FROM maria_expression WHERE id=2'))[0].value).toBe(original);
    expect(await apply(await preview(snapshot, [{ kind: 'alter', columnRef: column.columnRef, changes: { default: { kind: 'none' } } }]))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    await sql('INSERT INTO maria_expression(id) VALUES(3)'); expect((await sql('SELECT v FROM maria_expression WHERE id=3'))[0].v).toBeNull();
  });

  it('Maria 多风险默认值必须同条全部修复，部分覆盖拒绝并保留原值', async context => {
    if (admin!.status.dialect !== 'mariadb') { context.skip(); return; }
    await sql("CREATE TABLE maria_two_risks (id INT PRIMARY KEY,v VARCHAR(40) DEFAULT (concat(_utf8mb4'À',_utf8mb4'汉') COLLATE utf8mb4_bin),w VARCHAR(40) DEFAULT (concat(_utf8mb4'À',_utf8mb4'汉') COLLATE utf8mb4_bin))");
    const snapshot = await get('maria_two_risks');
    const clear: ColumnPatch = { kind: 'alter', columnRef: ref(snapshot, 'v'), changes: { default: { kind: 'none' } } };
    await expect(preview(snapshot, [clear])).rejects.toThrow('全部风险默认值');
    await sql('INSERT INTO maria_two_risks(id) VALUES(1)'); expect((await sql('SELECT HEX(v) AS v,HEX(w) AS w FROM maria_two_risks WHERE id=1'))[0]).toMatchObject({ v: 'C380E6B189', w: 'C380E6B189' });
    const result = await apply(await preview(snapshot, [clear, { kind: 'alter', columnRef: ref(snapshot, 'w'), changes: { default: { kind: 'literal', valueType: 'text', value: '明确新值' } } }]));
    expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    await sql('INSERT INTO maria_two_risks(id) VALUES(2)'); expect((await sql('SELECT v,w FROM maria_two_risks WHERE id=2'))[0]).toMatchObject({ v: null, w: '明确新值' });
    expect((await sql('SELECT HEX(v) AS v,HEX(w) AS w FROM maria_two_risks WHERE id=1'))[0]).toMatchObject({ v: 'C380E6B189', w: 'C380E6B189' });
  });

  it('Maria 含风险默认的结构导出保护原文件，数据导出不改变旧行及后续默认值', async context => {
    if (admin!.status.dialect !== 'mariadb') { context.skip(); return; }
    await sql("CREATE TABLE export_risk (id INT PRIMARY KEY,v VARCHAR(40) DEFAULT (concat(_utf8mb4'À',_utf8mb4'汉') COLLATE utf8mb4_bin))");
    await sql('INSERT INTO export_risk(id) VALUES(1)');
    const directory = join(process.cwd(), '.cache', 'o01-integration-evidence', database, 'export-files'); await mkdir(directory, { recursive: true });
    const target = join(directory, 'structure.sql'); await writeFile(target, '原有目标文件', { flag: 'wx' });
    const start = events.length;
    await expect(engine.handle('files.export', { connectionId: profile.id, database, table: 'export_risk', filePath: target, taskId: randomUUID(), format: 'sql', encoding: 'utf8', includeStructure: true, includeData: true })).rejects.toThrow('已拒绝含结构 SQL 导出');
    expect(await readFile(target, 'utf8')).toBe('原有目标文件'); expect(await readdir(directory)).toEqual(['structure.sql']); expect(events.slice(start).at(-1)?.status).toBe('failed');
    for (const format of ['sql', 'csv', 'json'] as const) {
      const filePath = join(directory, `data.${format}`);
      expect(await engine.handle('files.export', { connectionId: profile.id, database, table: 'export_risk', filePath, taskId: randomUUID(), format, encoding: 'utf8', includeStructure: false, includeData: true })).toEqual({ rows: 1 });
      const content = await readFile(filePath, 'utf8'); expect(content).not.toContain('CREATE TABLE'); expect(content).toContain(format === 'sql' ? 'c380e6b189' : 'À汉');
    }
    expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
    await sql('INSERT INTO export_risk(id) VALUES(2)');
    const rows = await sql('SELECT id,HEX(v) AS value FROM export_risk ORDER BY id'); expect(rows.map(row => row.value)).toEqual(['C380E6B189', 'C380E6B189']);
    expect(await readFile(target, 'utf8')).toBe('原有目标文件');
  });

  it('可信 VIEW 含结构导出仍保留完整定义与对应数据', async () => {
    await sql('CREATE TABLE export_view_source (id INT PRIMARY KEY,v VARCHAR(40))'); await sql("INSERT INTO export_view_source VALUES(1,'视图数据')");
    await sql('CREATE VIEW export_view AS SELECT id,v FROM export_view_source');
    const info = await engine.handle('metadata.table', { connectionId: profile.id, database, table: 'export_view' }); expect(info.objectKind).toBe('view');
    const original = String((await sql('SHOW CREATE VIEW export_view'))[0]['Create View']);
    const directory = join(process.cwd(), '.cache', 'o01-integration-evidence', database, 'export-view'); await mkdir(directory, { recursive: true });
    const filePath = join(directory, 'view.sql');
    expect(await engine.handle('files.export', { connectionId: profile.id, database, table: 'export_view', filePath, taskId: randomUUID(), format: 'sql', encoding: 'utf8', includeStructure: true, includeData: true })).toEqual({ rows: 1 });
    const output = await readFile(filePath, 'utf8'); expect(output).toContain(original + ';'); expect(output).toContain('INSERT INTO `export_view` (`id`, `v`) VALUES (1,'); expect(output).toContain(Buffer.from('视图数据').toString('hex'));
    expect(await readdir(directory)).toEqual(['view.sql']); expect((await sql('SELECT id,v FROM export_view'))[0]).toMatchObject({ id: 1, v: '视图数据' });
  });

  it('5.7/Maria 失真二进制默认拒绝原列重述与结构导出，旁列和专用 setter 保留真实完成边界', async context => {
    if (admin!.status.dialect !== 'mariadb' && !admin!.status.version.startsWith('5.7.')) { context.skip(); return; }
    await sql("CREATE TABLE binary_default_guard(id INT PRIMARY KEY,bytes VARBINARY(10) DEFAULT X'00ff',note INT COMMENT '旧')");
    await sql('INSERT INTO binary_default_guard(id) VALUES(1)');
    let snapshot = await get('binary_default_guard');
    const binary = snapshot.columns.find(column => column.name === 'bytes')!;
    expect(binary.default.kind).toBe('opaque'); expect(binary.access.default.editable).toBe(true); expect(binary.access.comment.editable).toBe(false);
    const eventStart = events.length;
    await expect(preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'bytes'), changes: { comment: '禁止重述' } }])).rejects.toThrow('原始字节');
    expect(events.slice(eventStart).every(event => !event.columnPatch?.ddlSubmitted)).toBe(true);
    const directory = join(process.cwd(), '.cache', 'o01-integration-evidence', database, 'binary-default-export'); await mkdir(directory, { recursive: true });
    const filePath = join(directory, 'structure.sql'); await writeFile(filePath, '原件保留', { flag: 'wx' });
    await expect(engine.handle('files.export', { connectionId: profile.id, database, table: 'binary_default_guard', filePath, taskId: randomUUID(), format: 'sql', encoding: 'utf8', includeStructure: true, includeData: true })).rejects.toThrow('原始字节');
    expect(await readFile(filePath, 'utf8')).toBe('原件保留'); expect(await readdir(directory)).toEqual(['structure.sql']);
    expect(await engine.handle('files.export', { connectionId: profile.id, database, table: 'binary_default_guard', filePath: join(directory, 'data.sql'), taskId: randomUUID(), format: 'sql', encoding: 'utf8', includeStructure: false, includeData: true })).toEqual({ rows: 1 });
    expect(await readFile(join(directory, 'data.sql'), 'utf8')).toContain("X'00ff'");
    expect(await apply(await preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'note'), changes: { comment: '旁列修改' } }]))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    await sql('INSERT INTO binary_default_guard(id) VALUES(2)');
    expect((await sql('SELECT HEX(bytes) AS value FROM binary_default_guard ORDER BY id')).map(row => row.value)).toEqual(['00FF', '00FF']);
    snapshot = await get('binary_default_guard');
    expect(await apply(await preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'bytes'), changes: { default: { kind: 'literal', valueType: 'binary', value: '00fe' } } }]))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    await sql('INSERT INTO binary_default_guard(id) VALUES(3)');
    expect((await sql('SELECT HEX(bytes) AS value FROM binary_default_guard ORDER BY id')).map(row => row.value)).toEqual(['00FF', '00FF', '00FE']);
    expect(await readFile(filePath, 'utf8')).toBe('原件保留'); expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
  });

  it.each(['cancel', 'disconnect'] as const)('真实元数据锁等待中 %s，终态后原连接消失且不自动重放', async action => {
    const table = `locked_${action}`; await sql(`CREATE TABLE ${identifier(table)} (id INT PRIMARY KEY,v INT)`);
    const snapshot = await get(table), plan = await preview(snapshot, [{ kind: 'alter', columnRef: ref(snapshot, 'v'), changes: { comment: '不可迟到' } }]), taskId = randomUUID();
    await sql('START TRANSACTION'); await sql(`SELECT * FROM ${identifier(table)}`);
    const running = apply(plan, taskId).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    try {
      const id = await waitingAlter(); recordedIds.add(id);
      if (action === 'cancel') await engine.handle('query.cancel', { taskId }); else await sql(`KILL CONNECTION ${id}`);
      const settled = await running; expect(settled.error).toBeDefined();
      expect((await processes()).some(row => Number(row.Id) === id)).toBe(false);
      const terminal = [...events].reverse().find(event => event.taskId === taskId && ['failed', 'cancelled', 'completed'].includes(event.status));
      expect(terminal?.columnPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
      await expect(apply(plan)).rejects.toThrow('已失效或已使用');
    } finally { await sql('ROLLBACK'); await running; }
    expect(String((await sql(`SHOW CREATE TABLE ${identifier(table)}`))[0]['Create Table'])).not.toContain('不可迟到');
  });
});
