import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { TableColumnGetOutput, TableColumnPreviewOutput, TableColumnApplyOutput } from '../../src/shared/tableColumnPatches';
import type { ManagedConnection } from '../../src/engine/connection';
import { validateCommand } from '../../src/shared/validation';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'columns', name: '结构单元', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
const original = "CREATE TABLE `t` (\n  `id` int NOT NULL,\n  `v` varchar(20) DEFAULT NULL COMMENT '旧',\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB";
let engine: Engine, events: TaskEvent[], source: string, originalMode: string, identity: string, connections: ManagedConnection[], sent: { id: number; sql: string }[], ddlAfter: string, failSql: RegExp | undefined, failClose: boolean;
let injectedUnknownClose = false;
let holdSql: RegExp | undefined, held: { connection: ManagedConnection; complete(error?: Error): void } | undefined;
let hiddenAnsiDefinition: string | undefined, metadataAutoIncrement = false;
let warningCount = 0;
let onUpdateExtraOverride: string | undefined;
let columnEncodingOverride: { charset: string; collation: string } | undefined;
let tableEncodingOverride: { charset: string | null; collation: string } | undefined;
let catalogMatchesOverride: Record<string, unknown>[] | undefined;
let serverDialect: 'mysql' | 'mariadb' = 'mysql';
let nextId = 0;

/** 仅替换驱动边界，真实 Engine/短任务/快照/计划器/协议回调逻辑均由生产代码执行。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const emitter = new EventEmitter(), threadId = ++nextId; let mode = originalMode, quote = 0, charset = 'utf8mb4', collation = 'utf8mb4_general_ci';
  const result = { connection: emitter, profile, signal, broken: false, status: { version: serverDialect === 'mysql' ? '8.4.11' : '10.11.19', dialect: serverDialect, connectionId: threadId }, close: vi.fn(async () => { if (failClose) { injectedUnknownClose = true; throw new Error('关闭失败且含秘密注释'); } }) } as unknown as ManagedConnection;
  Object.assign(emitter, { threadId, destroy: () => emitter.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push({ id: threadId, sql });
    const complete = (error?: Error): void => queueMicrotask(() => {
      if (error || failSql?.test(sql)) { callback(error ?? new Error('服务器错误含秘密默认值')); return; }
      // 旧字段端口显式模拟没有PROCESS目录权限；只有这条新增查询拒绝，不能把所有未知SQL吞成权限错误。
      if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name FROM information_schema.INNODB_TABLES')) { callback(Object.assign(new Error('RAM物理目录权限不足'), { errno: 1227, fatal: false })); return; }
      let rows: unknown = [];
      if (sql === 'SELECT VERSION() AS version, @@version_compile_os AS os, @@lower_case_table_names AS lowerNames LIMIT 2') rows = [{ version: result.status.version, os: 'Linux', lowerNames: 0 }];
      else if (sql.startsWith('SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS tableName, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES')) rows = [{ databaseName: 'db', tableName: 't', kind: 'BASE TABLE', engine: 'InnoDB' }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode: mode, hostname: identity, port: 3306, serverId: 1, currentUser: 'test@host', connectionId: threadId, characterSetConnection: charset, collationConnection: collation, quoteShowCreate: quote }];
      else if (sql.startsWith('SET SESSION sql_mode')) mode = /'([^']*)'/.exec(sql)![1];
      else if (sql === 'SET SESSION sql_quote_show_create = 1') quote = 1;
      else if (sql.startsWith('SET NAMES')) { charset = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode: mode, quoteShowCreate: quote, charset, collation }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: identity }];
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ Table: 't', 'Create Table': mode.split(',').includes('ANSI') && hiddenAnsiDefinition ? hiddenAnsiDefinition : source }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME')) rows = [tableEncodingOverride ?? { charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema'")) rows = ['COLLATION_NAME', 'CHARACTER_SET_NAME', 'FULL_COLLATION_NAME', 'ID', 'IS_DEFAULT'].map(name => ({ name }));
      else if (sql.startsWith('SELECT a.CHARACTER_SET_NAME')) rows = catalogMatchesOverride ?? [{ charset: 'utf8mb4', collation: tableEncodingOverride!.collation }];
      else if (sql.startsWith('SELECT COLUMN_NAME')) rows = parseTableColumnDefinition(source, { dialect: 'mysql', mode: { noBackslashEscapes: mode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: mode.includes('ANSI_QUOTES') } }).columns.map(column => ({ name: column.name, nullable: column.nullable === false ? 'NO' : 'YES', charset: /^(?:varchar|char|text|enum|set)/i.test(column.type.raw) ? 'utf8mb4' : null, collation: /^(?:varchar|char|text|enum|set)/i.test(column.type.raw) ? (/COLLATE utf8mb4_general_ci/i.test(column.raw) ? 'utf8mb4_general_ci' : 'utf8mb4_bin') : null, extra: onUpdateExtraOverride ?? ((metadataAutoIncrement && column.name === 'id') || column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : column.attributes.find(attribute => attribute.kind === 'on-update')?.raw ?? '') }));
      else if (sql.startsWith('ALTER TABLE')) { source = ddlAfter; rows = { affectedRows: 0, warningStatus: warningCount }; }
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = Array.from({ length: Math.min(20, warningCount) }, () => ({ Level: 'Warning', Code: 1265, Message: '服务器转换警告：' + '汉'.repeat(3000) }));
      if (sql.startsWith('SELECT COLUMN_NAME') && columnEncodingOverride) rows = (rows as Array<Record<string, unknown>>).map(row => row.name === 'v' ? { ...row, ...columnEncodingOverride } : row);
      callback(null, rows, []);
    });
    if (holdSql?.test(sql)) { held = { connection: result, complete }; return; }
    complete();
  } });
  signal?.addEventListener('abort', () => emitter.emit('end'), { once: true });
  connections.push(result); return result;
}
/** 每个阶段有独立任务编号，主进程才注入的修订在这里作为可信测试边界明确提供。 */
async function get(revision = 1): Promise<TableColumnGetOutput> { return engine.handle('schema.columns.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: revision }); }
async function preview(snapshot: TableColumnGetOutput, changes = { comment: '新' } as Record<string, unknown>, revision = 1): Promise<TableColumnPreviewOutput> {
  return engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches: [{ kind: 'alter', columnRef: snapshot.columns[1].columnRef, changes }], taskId: 'preview-' + nextId, connectionRevision: revision });
}
async function apply(value: TableColumnPreviewOutput, taskId = 'apply') { return engine.handle('schema.columns.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId, connectionRevision: 1 }); }

beforeEach(async () => {
  injectedUnknownClose = false;
  source = original; originalMode = ''; identity = 'server-one'; events = []; connections = []; sent = []; failSql = undefined; failClose = false; holdSql = undefined; held = undefined;
  ddlAfter = original.replace("COMMENT '旧'", "COMMENT '新'");
  hiddenAnsiDefinition = undefined; metadataAutoIncrement = false; warningCount = 0; serverDialect = 'mysql'; columnEncodingOverride = undefined; tableEncodingOverride = undefined; catalogMatchesOverride = undefined; onUpdateExtraOverride = undefined;
  mocks.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal));
  mocks.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(new Error('已被取消')); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => {
  failClose = false; holdSql = undefined; held?.complete(new Error('测试收尾'));
  // 此旧RAM端口未提供资源facade；注入关闭未知后，恢复开关不能凭空补成物理终态。
  if (injectedUnknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll();
  vi.restoreAllMocks();
});

describe('字段结构短会话与一次性计划', () => {
  it('新增时间列受控ON UPDATE沿原Engine预览零DDL，单次ADD与新列目录后核验完整',async()=>{
    const snapshot=await get(),patch={kind:'add',clientKey:'new-time',name:'created_at',type:{kind:'temporal',type:'TIMESTAMP',precision:6},nullable:true,default:{kind:'null'},comment:'新时间',position:{kind:'last'},onUpdate:{kind:'expression',expression:'current-timestamp',precision:6}};
    const value=await engine.handle('schema.columns.preview',{snapshotId:snapshot.snapshotId,patches:[patch],taskId:'preview-add-time',connectionRevision:1});expect(value.sql).toContain('ADD COLUMN `created_at` TIMESTAMP(6) NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6)');expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(0);
    ddlAfter=source.replace(',\n  PRIMARY KEY',",\n  created_at TIMESTAMP(6) NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '新时间',\n  PRIMARY KEY");const output:TableColumnApplyOutput=await apply(value);expect(output).toMatchObject({ddlCompleted:true,definitionVerified:true});expect(output.after?.columns.find(column=>column.name==='created_at')?.onUpdate).toMatchObject({precision:6});await expect(apply(value)).rejects.toThrow('已使用');expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it.each(['遗漏自动时间','默认值被改','NULL被改','生成列','未知属性','目录不符'])('新增自动时间DDL得到OK但%s不伪核验、不重放',async kind=>{
    const snapshot=await get(),patch={kind:'add',clientKey:'new-time',name:'created_at',type:{kind:'temporal',type:'DATETIME',precision:6},nullable:true,default:{kind:'null'},comment:'新时间',position:{kind:'last'},onUpdate:{kind:'expression',expression:'current-timestamp',precision:6}};
    const value=await engine.handle('schema.columns.preview',{snapshotId:snapshot.snapshotId,patches:[patch],taskId:'preview-add-time',connectionRevision:1});let definition="created_at DATETIME(6) NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '新时间'";
    if(kind==='遗漏自动时间')definition=definition.replace(' ON UPDATE CURRENT_TIMESTAMP(6)','');if(kind==='默认值被改')definition=definition.replace('DEFAULT NULL','DEFAULT CURRENT_TIMESTAMP(6)');if(kind==='NULL被改')definition=definition.replace('NULL DEFAULT','NOT NULL DEFAULT');if(kind==='生成列')definition+=' GENERATED ALWAYS AS (now()) VIRTUAL';if(kind==='未知属性')definition+=' EXTRA_UNKNOWN';if(kind==='目录不符')onUpdateExtraOverride='on update CURRENT_TIMESTAMP(0)';ddlAfter=source.replace(',\n  PRIMARY KEY',',\n  '+definition+',\n  PRIMARY KEY');
    const output=await apply(value);expect(output).toMatchObject({ddlSubmitted:true,ddlCompleted:true,definitionVerified:false});await expect(apply(value)).rejects.toThrow('已使用');expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it.each(['源码多出属性','EXTRA暗含属性'])('新增时间列未勾自动更新却%s仍拒绝完整后核验',async kind=>{
    const snapshot=await get(),value=await engine.handle('schema.columns.preview',{snapshotId:snapshot.snapshotId,taskId:'preview-unrequested',connectionRevision:1,patches:[{kind:'add',clientKey:'new',name:'ts',type:{kind:'temporal',type:'DATETIME'},nullable:true,default:{kind:'null'},comment:'',position:{kind:'last'}}]});ddlAfter=source.replace(',\n  PRIMARY KEY',",\n  ts DATETIME NULL DEFAULT NULL"+(kind==='源码多出属性'?' ON UPDATE CURRENT_TIMESTAMP':'')+" COMMENT '',\n  PRIMARY KEY");if(kind==='EXTRA暗含属性')onUpdateExtraOverride='on update CURRENT_TIMESTAMP';expect(await apply(value)).toMatchObject({ddlCompleted:true,definitionVerified:false});
  });
  it('ON UPDATE真实Engine开启和移除各单次ALTER，原DEFAULT/NULL/注释/旁列后核验且令牌不重放',async()=>{
    source="CREATE TABLE t(id int NOT NULL,v DATETIME(6) NULL DEFAULT '2001-01-01 00:00:00.000001' COMMENT '保留',note varchar(10) DEFAULT 'NULL') ENGINE=InnoDB";
    const initial=source,snapshot=await get();expect(snapshot.columns[1].onUpdate).toBeNull();expect(snapshot.columns[1].access.onUpdate.editable).toBe(true);
    const value=await preview(snapshot,{onUpdate:{kind:'expression',expression:'current-timestamp',precision:6}});expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(0);
    ddlAfter=source.replace(" COMMENT '保留'"," ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '保留'");expect(await apply(value)).toMatchObject({ddlCompleted:true,definitionVerified:true});await expect(apply(value)).rejects.toThrow('已使用');expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(1);
    const second=await get();expect(second.columns[1].onUpdate).toMatchObject({precision:6});const remove=await preview(second,{onUpdate:null});ddlAfter=initial;expect(await apply(remove,'remove-on-update')).toMatchObject({ddlCompleted:true,definitionVerified:true});expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(2);
  });
  it('EXTRA与完整定义矛盾时get只读，伪造preview及预览后目录变化均在DDL前拒绝',async()=>{
    source="CREATE TABLE t(id int NOT NULL,v TIMESTAMP(6) NULL DEFAULT NULL) ENGINE=InnoDB";onUpdateExtraOverride='on update CURRENT_TIMESTAMP(6)';
    const locked=await get();expect(locked.columns[1].access.onUpdate.editable).toBe(false);await expect(preview(locked,{onUpdate:{kind:'expression',expression:'current-timestamp',precision:6}})).rejects.toThrow('目录');expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(0);
    onUpdateExtraOverride=undefined;const value=await preview(await get(),{onUpdate:{kind:'expression',expression:'current-timestamp',precision:6}});onUpdateExtraOverride='on update CURRENT_TIMESTAMP(0)';await expect(apply(value)).rejects.toThrow('目录');await expect(apply(value)).rejects.toThrow('已使用');expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(0);
  });
  it('自动时间变更沿原专用会话取消等待真实回调，终态unknown且令牌不重放',async()=>{
    source='CREATE TABLE t(id int NOT NULL,v DATETIME(6) NULL DEFAULT NULL) ENGINE=InnoDB';const value=await preview(await get(),{onUpdate:{kind:'expression',expression:'current-timestamp',precision:6}});holdSql=/^ALTER TABLE/;
    const running=apply(value),failure=expect(running).rejects.toThrow('取消');await vi.waitFor(()=>expect(held).toBeDefined());const active=held!.connection;await engine.handle('query.cancel',{taskId:'apply'});await failure;expect(active.close).toHaveBeenCalledOnce();expect(events.at(-1)?.columnPatch).toMatchObject({ddlSubmitted:true,ddlCompleted:false,outcome:'unknown'});await expect(apply(value)).rejects.toThrow('已使用');expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('自动时间EXTRA目录读取失败不冒充无属性，get失败并关闭专用连接',async()=>{
    source='CREATE TABLE t(id int NOT NULL,v DATETIME(6) NULL DEFAULT NULL) ENGINE=InnoDB';failSql=/^SELECT COLUMN_NAME AS name, EXTRA AS extra/;await expect(get()).rejects.toThrow();expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(0);for(const connection of connections)expect(connection.close).toHaveBeenCalledOnce();
  });
  it.each(['保留ONUPDATE','默认值被改变','可空性被改变','目录后核验失败'])('自动时间DDL成功但%s不伪报完整核验，也不重放',async mode=>{
    source="CREATE TABLE t(id int NOT NULL,v DATETIME(6) NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '旧') ENGINE=InnoDB";const value=await preview(await get(),{onUpdate:null});
    ddlAfter=mode==='保留ONUPDATE'?source:source.replace(' ON UPDATE CURRENT_TIMESTAMP(6)','');if(mode==='默认值被改变')ddlAfter=ddlAfter.replace('DEFAULT NULL','DEFAULT CURRENT_TIMESTAMP(6)');if(mode==='可空性被改变')ddlAfter=ddlAfter.replace('NULL DEFAULT','NOT NULL DEFAULT');if(mode==='目录后核验失败')onUpdateExtraOverride='on update CURRENT_TIMESTAMP(6)';
    const output=await apply(value);expect(output).toMatchObject({ddlSubmitted:true,ddlCompleted:true,definitionVerified:false});expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(1);await expect(apply(value)).rejects.toThrow();
  });
  it('读取与预览各自关闭连接，不发送 ALTER；只提供可信字段引用与受控当前类型', async () => {
    const snapshot = await get(), value = await preview(snapshot);
    expect(snapshot.columns[1].editableType).toEqual({ kind: 'string', type: 'VARCHAR', length: 20 });
    expect(snapshot.columns[1].nullable).toBe(true); expect(snapshot.columns[0].nullable).toBe(false);
    expect(snapshot.columns[1].columnRef).not.toBe('v'); expect(value.sql).toContain("COMMENT '新'");
    expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
    expect(connections).toHaveLength(3); for (const connection of connections) expect(connection.close).toHaveBeenCalledOnce();
    expect(events.at(-1)?.columnPatch).toMatchObject({ ddlSubmitted: false, outcome: 'not-sent' });
  });

  it('MySQL 5.7 和 Maria 隐藏选项只在专用会话去除，定义记录保留原模式', async () => {
    originalMode = 'NO_FIELD_OPTIONS,NO_KEY_OPTIONS,NO_TABLE_OPTIONS,ANSI_QUOTES,NO_BACKSLASH_ESCAPES,ANSI';
    const snapshot = await get();
    expect(sent.some(item => item.sql === "SET SESSION sql_mode = 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES'")).toBe(true);
    expect(snapshot.definitionContext).toMatchObject({ originalSqlMode: originalMode, sqlMode: 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES', sqlQuoteShowCreate: true });
  });

  it.each(['utf8mb4_uca1400_ai_ci', 'utf8mb4_uca1400_as_cs'])('真实 Maria 目录别名 %s 按 FULL 名确认，完整 apply 仍使用同一可取消会话', async collation => {
    serverDialect = 'mariadb'; tableEncodingOverride = { charset: null, collation }; columnEncodingOverride = { charset: 'utf8mb4', collation };
    const value = await preview(await get()); expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    const queries = sent.filter(item => item.sql.startsWith('SELECT a.CHARACTER_SET_NAME'));
    expect(queries).toHaveLength(4); expect(queries.every(item => item.sql.includes('a.FULL_COLLATION_NAME') && item.sql.includes('JOIN information_schema.CHARACTER_SETS'))).toBe(true);
    expect(new Set(queries.map(item => item.id)).size).toBe(3); expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true);
  });

  it.each([[], [{ charset: 'utf8mb4', collation: 'utf8mb4_uca1400_ai_ci' }, { charset: 'utf8mb4', collation: 'utf8mb4_uca1400_ai_ci' }]].map(matches => ({ matches })))('别名目录空或冲突时拒绝，不默认猜 utf8mb4 或发送 DDL', async ({ matches }) => {
    tableEncodingOverride = { charset: null, collation: 'utf8mb4_uca1400_ai_ci' }; catalogMatchesOverride = matches;
    await expect(get()).rejects.toThrow('无法唯一确认'); expect(sent.some(item => item.sql.startsWith('ALTER TABLE'))).toBe(false);
    expect(connections.every(connection => vi.mocked(connection.close).mock.calls.length === 1)).toBe(true);
  });

  it('真实 ANSI 形态省略的是索引注释和表尾，移除聚合标记后完整快照才能比较外部变更', async () => {
    // 来源 run02 Maria metadata_omission；仅将表名改为隔离测试 t。ANSI 样例仍保留 AUTO_INCREMENT。
    source = "CREATE TABLE `t` (`id` int(11) NOT NULL AUTO_INCREMENT,`v` varchar(80) DEFAULT 'x' COMMENT '字段注释',PRIMARY KEY (`id`),KEY `idx_v` (`v`(7)) COMMENT '索引注释') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC COMMENT='表注释'";
    hiddenAnsiDefinition = "CREATE TABLE \"t\" (\"id\" int(11) NOT NULL AUTO_INCREMENT,\"v\" varchar(80) DEFAULT 'x' COMMENT '字段注释',PRIMARY KEY (\"id\"),KEY \"idx_v\" (\"v\"(7)))";
    originalMode = 'REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ANSI';
    const snapshot = await get(); expect(snapshot.columns[0].rawDefinition).toContain('AUTO_INCREMENT');
    expect(snapshot.definitionContext?.sqlMode).toBe('REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE');
    source = source.replace("COMMENT '索引注释'", "COMMENT '外部修改'");
    await expect(preview(snapshot)).rejects.toThrow('定义已变化');
  });

  it('独立目录仍发现源码缺自增时明确拒绝，不能依赖模式黑名单猜定义完整', async () => {
    metadataAutoIncrement = true;
    await expect(get()).rejects.toThrow('隐藏了真实自增');
    expect(sent.some(item => item.sql.startsWith('ALTER TABLE'))).toBe(false);
  });

  it('Maria 整表风险警告包含具体列，旁列与原生改名均在投递 DDL 前阻止', async () => {
    serverDialect = 'mariadb'; source = "CREATE TABLE t(id int NOT NULL,v varchar(80) DEFAULT concat(_utf8mb4'xC3x80',_utf8mb4'xE6xB1x89'),note int,PRIMARY KEY(id)) ENGINE=InnoDB";
    const snapshot = await get(); expect(snapshot.warnings.join('')).toContain('任意字段 ALTER'); expect(snapshot.warnings.join('')).toContain('"v"');
    expect(snapshot.columns[1].access.name.editable).toBe(false);
    await expect(preview(snapshot, { name: 'renamed' })).rejects.toThrow('全部风险默认值');
    await expect(engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches: [{ kind: 'alter', columnRef: snapshot.columns[2].columnRef, changes: { comment: '旁列' } }], taskId: 'side-preview', connectionRevision: 1 })).rejects.toThrow('全部风险默认值');
    expect(sent.some(item => item.sql.startsWith('ALTER TABLE'))).toBe(false);
    expect(events.every(event => !event.columnPatch?.ddlSubmitted)).toBe(true);
  });

  it.each([false, true])('Maria 全部专用默认修复后仅不存在风险表达式才报告完整核验（残留=%s）', async remains => {
    serverDialect = 'mariadb'; source = "CREATE TABLE t(id int NOT NULL,v varchar(80) DEFAULT concat(_utf8mb4'xC3x80',_utf8mb4'xE6xB1x89'),PRIMARY KEY(id)) ENGINE=InnoDB";
    const value = await preview(await get(), { default: { kind: 'none' } });
    ddlAfter = remains ? source : source.replace("DEFAULT concat(_utf8mb4'xC3x80',_utf8mb4'xE6xB1x89')", 'DEFAULT NULL');
    expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: !remains });
  });

  it('同一短会话重核后只提交一次 ALTER，成功后新定义与原复杂属性得到核验', async () => {
    const snapshot = await get(), value = await preview(snapshot), result = await apply(value);
    expect(result).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true });
    const alterations = sent.filter(item => item.sql.startsWith('ALTER TABLE')); expect(alterations).toHaveLength(1);
    const applyQueries = sent.filter(item => item.id === alterations[0].id);
    expect(applyQueries.filter(item => item.sql.startsWith('SHOW CREATE TABLE'))).toHaveLength(2);
    await expect(apply(value, 'again')).rejects.toThrow('已失效或已使用');
    expect(events.at(-1)?.columnPatch).toMatchObject({ ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' });
  });

  it('ALTER OK 后立即读取其真实警告，数量和字节有界且任务事件不含警告原文', async () => {
    const value = await preview(await get()); warningCount = 25;
    const result = await apply(value), index = sent.findIndex(item => item.sql.startsWith('ALTER TABLE'));
    expect(sent[index + 1].sql).toBe('SHOW WARNINGS LIMIT 20');
    expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    expect(result.warnings.some((warning: string) => warning.includes('1265：服务器转换警告'))).toBe(true);
    expect(result.warnings.some((warning: string) => warning.includes('截断'))).toBe(true);
    expect(result.warnings.at(-1)).toContain('前 20 条');
    expect(Buffer.byteLength(result.warnings.join(''))).toBeLessThan(35 * 1024);
    expect(events.every(event => !event.message?.includes('服务器转换警告'))).toBe(true);
  });

  it('警告读取失败保留 DDL 已完成事实并继续独立定义核验', async () => {
    const value = await preview(await get()); warningCount = 1; failSql = /^SHOW WARNINGS/;
    const result = await apply(value);
    expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    expect(result.warnings.some((warning: string) => warning.includes('警告读取失败'))).toBe(true);
    expect(sent.filter(item => item.sql.startsWith('ALTER TABLE'))).toHaveLength(1);
  });

  it('新增字段的服务器结果带未请求复杂属性时保留已执行而拒绝完整核验', async () => {
    const snapshot = await get();
    const value = await engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches: [{ kind: 'add', clientKey: 'new', name: 'extra', type: { kind: 'integer', type: 'INT', unsigned: false }, nullable: true, default: { kind: 'null' }, comment: '', position: { kind: 'last' } }], taskId: 'new-preview', connectionRevision: 1 });
    ddlAfter = original.replace('  PRIMARY KEY', '  `extra` int DEFAULT NULL STORAGE DISK,\n  PRIMARY KEY');
    const result = await apply(value);
    expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });

  it.each([false, true])('新增字符串的继承 COLLATE 必须有目录语义一致证据（篡改=%s）', async changed => {
    const snapshot = await get();
    const value = await engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches: [{ kind: 'add', clientKey: 'new', name: 'extra', type: { kind: 'string', type: 'VARCHAR', length: 30 }, nullable: true, default: { kind: 'null' }, comment: '', position: { kind: 'last' } }], taskId: 'new-preview', connectionRevision: 1 });
    ddlAfter = original.replace('  PRIMARY KEY', `  \`extra\` varchar(30) COLLATE ${changed ? 'utf8mb4_general_ci' : 'utf8mb4_bin'} DEFAULT NULL,\n  PRIMARY KEY`);
    expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: !changed });
  });

  it('数值转字符串允许服务器按表默认补 COLLATE，不忽略真实目录变化', async () => {
    source = original.replace('`v` varchar(20) DEFAULT NULL', '`v` int DEFAULT 7');
    const value = await preview(await get(), { type: { kind: 'string', type: 'VARCHAR', length: 30 } });
    ddlAfter = original.replace('varchar(20) DEFAULT NULL', "varchar(30) COLLATE utf8mb4_bin DEFAULT '7'");
    expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: true });
  });

  it.each(['definition', 'identity', 'mode', 'revision'])('%s 变化使预览/应用拒绝且不发 DDL', async kind => {
    const snapshot = await get(), value = await preview(snapshot);
    if (kind === 'definition') source = original.replace('varchar(20)', 'varchar(21)');
    if (kind === 'identity') identity = 'server-two';
    if (kind === 'mode') originalMode = 'ANSI_QUOTES';
    const operation = kind === 'revision' ? engine.handle('schema.columns.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId: 'changed', connectionRevision: 2 }) : apply(value);
    await expect(operation).rejects.toThrow('变化'); expect(sent.some(item => item.sql.startsWith('ALTER TABLE'))).toBe(false);
    await expect(apply(value, 'again')).rejects.toThrow('已失效或已使用');
  });

  it('TTL 与显式释放失效快照及关联预览，不建立新网络连接', async () => {
    const snapshot = await get(), value = await preview(snapshot), count = connections.length;
    await engine.handle('schema.columns.release', { snapshotId: snapshot.snapshotId });
    await expect(preview(snapshot)).rejects.toThrow('失效'); await expect(apply(value)).rejects.toThrow('失效'); expect(connections).toHaveLength(count);
    const fresh = await get(); const time = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(time + 120001);
    await expect(preview(fresh)).rejects.toThrow('失效');
  });

  it('缺确认仍消费预览、无可信修订不能读取、客户端不能注入 SQL 或配置修订', async () => {
    await expect(engine.handle('schema.columns.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'untrusted' })).rejects.toThrow('可信');
    const value = await preview(await get());
    await expect(engine.handle('schema.columns.apply', { previewToken: value.previewToken, acknowledgements: [], taskId: 'no-ack', connectionRevision: 1 })).rejects.toThrow('后果');
    await expect(apply(value)).rejects.toThrow('失效');
    expect(() => validateCommand('schema.columns.apply', { previewToken: 'x', acknowledgements: [], taskId: 'x', sql: 'DROP TABLE t' })).toThrow();
    expect(() => validateCommand('schema.columns.get', { connectionId: 'c', database: 'd', table: 't', taskId: 'x', connectionRevision: 1 })).toThrow();
  });

  it('服务器 ERR 或连接关闭不会回退重放；DDL 发出后缺 OK 进度保持未知', async () => {
    const value = await preview(await get()); failSql = /^ALTER TABLE/;
    await expect(apply(value)).rejects.toThrow('服务器错误');
    expect(sent.filter(item => item.sql.startsWith('ALTER TABLE'))).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ status: 'failed', columnPatch: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } });
    expect(events.at(-1)?.message).not.toContain('秘密');
  });

  it('DDL OK 后核验失败保留已完成，不返回未执行也不自动重试', async () => {
    const value = await preview(await get());
    holdSql = /^ALTER TABLE/; const running = apply(value); await vi.waitFor(() => expect(held).toBeDefined());
    failSql = /^SHOW CREATE TABLE/; held!.complete();
    const result = await running;
    expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(result.verificationError).toContain('不要重复');
    expect(events.at(-1)?.columnPatch).toMatchObject({ ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' });
  });

  it('DDL OK 后清理失败仍发出真实成功效果，终态等关闭尝试后才出现', async () => {
    const value = await preview(await get()); failClose = true;
    await expect(apply(value)).rejects.toThrow('关闭失败');
    expect(events.at(-1)).toMatchObject({ status: 'failed', columnPatch: { phase: 'releasing', ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' } });
    expect(events.at(-1)?.message).not.toContain('秘密'); expect(connections.at(-1)?.close).toHaveBeenCalledOnce();
  });

  it('执行期间取消 KILL 固定专用连接并等待原命令终态，不误称已撤销', async () => {
    const value = await preview(await get()); holdSql = /^ALTER TABLE/;
    const running = apply(value), failure = expect(running).rejects.toThrow('取消');
    await vi.waitFor(() => expect(held).toBeDefined()); const active = held!.connection;
    await engine.handle('query.cancel', { taskId: 'apply' }); await failure;
    expect(mocks.execute.mock.calls.map(([, sql]) => sql)).toEqual([`KILL CONNECTION ${active.connection.threadId}`]);
    expect(active.close).toHaveBeenCalledOnce(); expect(events.at(-1)?.columnPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
  });

  it('KILL ACK 不等于原 DDL 结束，真实回调前不 abort、不 close、不发终态或释放编号', async () => {
    const value = await preview(await get()); holdSql = /^ALTER TABLE/;
    const running = apply(value), failure = expect(running).rejects.toThrow('服务器已终止');
    await vi.waitFor(() => expect(held).toBeDefined()); const active = held!.connection;
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    let cancelled = false; const cancelling = engine.handle('query.cancel', { taskId: 'apply' }).then(() => { cancelled = true; });
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(active.signal?.aborted).toBe(false); expect(active.close).not.toHaveBeenCalled(); expect(cancelled).toBe(false); expect(events.at(-1)?.status).toBe('running');
    await expect(engine.handle('files.exportResult', { taskId: 'apply', filePath: 'unused' })).rejects.toThrow('任务编号');
    held!.complete(new Error('服务器已终止')); await cancelling; await failure;
    expect(active.close).toHaveBeenCalledOnce(); expect(active.signal?.aborted).toBe(true); expect(events.at(-1)?.status).toBe('cancelled');
    expect(connections.at(-1)!.close).toHaveBeenCalledWith({ strict: true });
  });

  it('取消控制失败销毁本地资源但明确无法确认服务器结果，不伪装成功取消', async () => {
    const value = await preview(await get()); holdSql = /^ALTER TABLE/;
    const running = apply(value), failure = expect(running).rejects.toThrow('无法确认服务器');
    await vi.waitFor(() => expect(held).toBeDefined()); mocks.connect.mockRejectedValueOnce(new Error('控制连接不可达'));
    await expect(engine.handle('query.cancel', { taskId: 'apply' })).rejects.toThrow('无法确认服务器'); await failure;
    expect(events.at(-1)).toMatchObject({ status: 'failed', columnPatch: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } });
    expect(held!.connection.close).toHaveBeenCalledOnce();
  });

  it('服务器原连接 EOF 唤醒挂起 DDL，令牌仍消费且不会自动建连重放', async () => {
    const value = await preview(await get()); holdSql = /^ALTER TABLE/;
    const running = apply(value), failure = expect(running).rejects.toThrow('断开');
    await vi.waitFor(() => expect(held).toBeDefined()); const count = connections.length;
    held!.connection.connection.emit('end'); await failure;
    expect(connections).toHaveLength(count); expect(sent.filter(item => item.sql.startsWith('ALTER TABLE'))).toHaveLength(1);
    expect(events.at(-1)?.columnPatch?.outcome).toBe('unknown');
  });

  it('预览重核尚未结束时释放快照，不会迟到重新激活预览令牌', async () => {
    const snapshot = await get(); holdSql = /^SHOW CREATE TABLE/;
    const pending = preview(snapshot), rejected = expect(pending).rejects.toThrow('释放');
    await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('schema.columns.release', { snapshotId: snapshot.snapshotId });
    held!.complete(); await rejected; expect(sent.some(item => item.sql.startsWith('ALTER TABLE'))).toBe(false);
  });

  it('有效快照数量有界，释放一个后可继续读取而不静默驱逐旧快照', async () => {
    const snapshots: TableColumnGetOutput[] = [];
    for (let index = 0; index < 32; index++) snapshots.push(await get());
    await expect(get()).rejects.toThrow('缓存已达上限');
    await engine.handle('schema.columns.release', { snapshotId: snapshots[0].snapshotId });
    await expect(get()).resolves.toBeDefined();
    await expect(preview(snapshots[1])).resolves.toBeDefined();
  });

  it('建连阶段取消等待迟到连接释放，closeAll 阻止新任务并保留配置使用锁', async () => {
    let resolve!: (value: ManagedConnection) => void, signal!: AbortSignal;
    mocks.connect.mockImplementationOnce((_p, _db, value) => { signal = value; return new Promise<ManagedConnection>(done => { resolve = done; }); });
    const reading = get(), failed = expect(reading).rejects.toThrow('取消');
    await expect(engine.handle('__connections.prepareSave', { id: profile.id, profile: { ...profile, host: 'new' }, transportChanged: true })).rejects.toThrow('仍有');
    const closing = engine.closeAll(); expect(signal.aborted).toBe(true); resolve(managed(signal));
    await closing; await failed; await expect(get()).rejects.toThrow('正在关闭');
    expect(events.at(-1)?.columnPatch).toMatchObject({ ddlSubmitted: false, outcome: 'not-sent' });
  });

  it('只观察源定义而未应用目标修改时不能伪造 definitionVerified', async () => {
    const value = await preview(await get()); ddlAfter = original;
    const result = await apply(value); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });

  it('受控类型和数字默认值按真实元数据规范化验证，超安全整数不经 Number', async () => {
    source = "CREATE TABLE `t` (`id` int NOT NULL,`v` bigint NOT NULL DEFAULT '1',PRIMARY KEY (`id`)) ENGINE=InnoDB";
    ddlAfter = source.replace("DEFAULT '1'", "DEFAULT '9007199254740993'");
    const result = await apply(await preview(await get(), { default: { kind: 'literal', valueType: 'number', value: '9007199254740993' } }));
    expect(result.definitionVerified).toBe(true);
  });

  it.each([0, 6])('服务器规范时间默认值 NOW(%i) 后仍核验成功且保留 ON UPDATE', async precision => {
    source = `CREATE TABLE t(id int NOT NULL,v datetime(${precision}) DEFAULT '2000-01-01 00:00:00' ON UPDATE CURRENT_TIMESTAMP(${precision}),PRIMARY KEY(id)) ENGINE=InnoDB`;
    ddlAfter = source.replace("DEFAULT '2000-01-01 00:00:00'", `DEFAULT (now(${precision ? precision : ''}))`);
    const result = await apply(await preview(await get(), { default: { kind: 'expression', expression: 'current-timestamp', precision } }));
    expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    expect(sent.filter(item => item.sql.startsWith('ALTER TABLE'))).toHaveLength(1);
  });

  it.each(["(X'00ff')", "((0x00ff))", "(B'0000000011111111')"])('大对象单二进制文字量规范外括号 %s 不误报核验失败', async expression => {
    source = 'CREATE TABLE t(id int NOT NULL,v blob,PRIMARY KEY(id)) ENGINE=InnoDB';
    ddlAfter = source.replace('v blob', 'v blob DEFAULT ' + expression);
    expect(await apply(await preview(await get(), { default: { kind: 'literal', valueType: 'binary', value: '00ff' } }))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
  });

  it('MySQL TEXT 规范 utf8mb4 引导器由真实列字符集核对，保留 Unicode 与转义值', async () => {
    source = "CREATE TABLE t(id int NOT NULL,v text COMMENT '保留',PRIMARY KEY(id)) ENGINE=InnoDB";
    const value = "汉字'引号\\路径\n第二行";
    ddlAfter = source.replace('v text', "v text DEFAULT (_utf8mb4'汉字\\'引号\\\\路径\\n第二行')");
    expect(await apply(await preview(await get(), { default: { kind: 'literal', valueType: 'text', value } }))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
    const writes = sent.filter(item => item.sql.startsWith('ALTER TABLE'));
    expect(writes).toHaveLength(1); expect(writes[0].sql).toContain('MODIFY COLUMN'); expect(writes[0].sql).toContain("COMMENT '保留'");
  });

  it.each(['_binary', '_utf8', '_latin1', '_unknown'])('未知或非受控 TEXT 引导器 %s 不伪核验', async introducer => {
    source = 'CREATE TABLE t(id int NOT NULL,v text,PRIMARY KEY(id)) ENGINE=InnoDB';
    ddlAfter = source.replace('v text', `v text DEFAULT (${introducer}'abc')`);
    expect(await apply(await preview(await get(), { default: { kind: 'literal', valueType: 'text', value: 'abc' } }))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });

  it('直接文字量的字符集引导器也不能绕过规范括号的限制', async () => {
    source = 'CREATE TABLE t(id int NOT NULL,v text,PRIMARY KEY(id)) ENGINE=InnoDB';
    ddlAfter = source.replace('v text', "v text DEFAULT _binary'abc'");
    expect(await apply(await preview(await get(), { default: { kind: 'literal', valueType: 'text', value: 'abc' } }))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });

  it('TEXT 引导器与真实列字符集不一致即使文本相同也不能核验', async () => {
    columnEncodingOverride = { charset: 'latin1', collation: 'latin1_bin' };
    source = 'CREATE TABLE t(id int NOT NULL,v text,PRIMARY KEY(id)) ENGINE=InnoDB';
    ddlAfter = source.replace('v text', "v text DEFAULT (_utf8mb4'abc')");
    expect(await apply(await preview(await get(), { default: { kind: 'literal', valueType: 'text', value: 'abc' } }))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });

  it('引导器拼写出现在普通引号内仍是文本，不作为字符集指令解释', async () => {
    source = 'CREATE TABLE t(id int NOT NULL,v text,PRIMARY KEY(id)) ENGINE=InnoDB';
    ddlAfter = source.replace('v text', "v text DEFAULT ('_utf8mb4')");
    expect(await apply(await preview(await get(), { default: { kind: 'literal', valueType: 'text', value: '_utf8mb4' } }))).toMatchObject({ ddlCompleted: true, definitionVerified: true });
  });

  it.each(['mysql', 'mariadb'] as const)('%s 二进制文本默认旁列可执行，但不能仅凭文本相同报告完整核验', async dialect => {
    serverDialect = dialect;
    source = "CREATE TABLE t(id int NOT NULL,v int COMMENT '旧',bytes varbinary(20) DEFAULT '\\0?',PRIMARY KEY(id)) ENGINE=InnoDB";
    ddlAfter = source.replace("COMMENT '旧'", "COMMENT '新'");
    const snapshot = await get(); expect(snapshot.warnings.join('')).toContain('原始字节');
    const binary = snapshot.columns.find(column => column.name === 'bytes')!;
    expect(binary.default).toMatchObject({ kind: 'opaque' }); expect(binary.access.default.editable).toBe(true); expect(binary.access.comment.editable).toBe(false); expect(snapshot.warnings.join('')).toContain('"bytes"');
    expect(await apply(await preview(snapshot))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    expect(sent.filter(item => item.sql.startsWith('ALTER TABLE'))).toHaveLength(1);
  });

  it('二进制专用默认 setter 得到 OK 但 SHOW 为损失字节的文本形态时保留已执行与未核验事实', async () => {
    source = 'CREATE TABLE t(id int NOT NULL,v varbinary(20),PRIMARY KEY(id)) ENGINE=InnoDB';
    ddlAfter = source.replace('v varbinary(20)', "v varbinary(20) DEFAULT '\\0?'");
    const value = await preview(await get(), { default: { kind: 'literal', valueType: 'binary', value: '00ff' } });
    expect(value.sql).toContain("ALTER COLUMN `v` SET DEFAULT X'00ff'");
    expect(await apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });

  it.each(["(concat(X'00',X'ff'))", "(X'00ff' + 0)", "(X'00fe')", "(_binary'00ff')"])('大对象默认 %s 不是同一个受控字节文字量，不能伪核验', async expression => {
    source = 'CREATE TABLE t(id int NOT NULL,v blob,PRIMARY KEY(id)) ENGINE=InnoDB';
    ddlAfter = source.replace('v blob', 'v blob DEFAULT ' + expression);
    expect(await apply(await preview(await get(), { default: { kind: 'literal', valueType: 'binary', value: '00ff' } }))).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
});
