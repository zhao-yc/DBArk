import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { TableColumnGetOutput, TableColumnPreviewOutput } from '../../src/shared/tableColumnPatches';
import type { ManagedConnection } from '../../src/engine/connection';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { validateCommand } from '../../src/shared/validation';
import type { StructureTaskContext, StructureTaskOptions } from '../../src/engine/structureDefinition';
import type { IndexColumnMetadata } from '../../src/engine/tableIndexMetadata';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
vi.mock('../../src/engine/tableColumnCollationTaskRead', async () => ({ ...await vi.importActual<any>('../../src/engine/tableColumnCollationTaskRead'), readColumnCollationTaskFacts: async () => ({kind:'unavailable',reason:'本RAM不验证旧同字符集collation附加用途'}) }));
import { Engine } from '../../src/engine/index';
import { TableColumnPatchTasks } from '../../src/engine/tableColumnPatchTasks';
import { StructurePatchCache, structureCacheLimits } from '../../src/engine/structurePatchCache';
import { buildColumnEncodingPlan } from '../../src/engine/tableColumnEncodingSql';
import type { ColumnEncodingFacts } from '../../src/engine/tableColumnEncodingRead';

const profile: ConnectionProfile = { id: 'index-unit', name: '索引单元', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
const original = "CREATE TABLE `t` (`id` bigint NOT NULL,`v` varchar(24) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL DEFAULT 'é',`amount` decimal(30,6) NOT NULL DEFAULT 0,PRIMARY KEY (`id`),UNIQUE KEY `uq_v` (`v`,`amount`),KEY `prefix_v` (`v`(3),`id`)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin";
let engine: Engine, events: TaskEvent[], source: string, afterSql: string, version: string, failSql: RegExp | undefined, holdSql: RegExp | undefined, closeFails: boolean;
let injectedUnknownClose = false;
let connections: ManagedConnection[], sent: { id: number; sql: string }[], nextId: number, headers: Record<string, unknown>[], parts: Record<string, unknown>[];
let held: { connection: ManagedConnection; complete(error?: Error): void } | undefined, warnings: number, generatedPrimaryKeys: number, pageSize: number, expressionConflict: boolean;
let catalogSrid: number, sridHeadersAvailable: boolean;
let nativeTableId: string, nativeIndexId: string, optimizerStatsPatch: Record<string, unknown> | undefined, afterDdl: (() => void) | undefined;
let fixedColumnMetadata: Map<string, IndexColumnMetadata>;
/** 本用途只替数据库驱动及无关旧collation附加端口；Engine/IndexRead/编码reader/计划及后核均执行生产代码。 */
/** 目录行独立固定，只有本例明确声明的encoding状态变化；完整default矛盾另行注入。 */
function encodingCatalogRows() {
  const wide = /varchar\((\d+)\)/.exec(source), large = /\`v\` text/.test(source), charset = /CHARACTER SET (latin1|utf8mb3|utf8mb4) COLLATE/.exec(source)![1], length=large?65535:Number(wide?.[1]??24);
  return [
    {name:'id',ordinal:1,typeSql:'bigint',dataType:'bigint',nullable:'NO',defaultValue:null,extra:'',generationExpression:'',charset:null,collation:null,comment:''},
    {name:'v',ordinal:2,typeSql:large?'text':'varchar('+length+')',dataType:large?'text':'varchar',nullable:'NO',defaultValue:'é',extra:'',generationExpression:'',charset,collation:charset+'_bin',comment:''},
    {name:'amount',ordinal:3,typeSql:'decimal(30,6)',dataType:'decimal',nullable:'NO',defaultValue:'0',extra:'',generationExpression:'',charset:null,collation:null,comment:''},
    ...(timestampDefault?[{name:'created_at',ordinal:4,typeSql:'datetime(6)',dataType:'datetime',nullable:'NO',defaultValue:timestampDefault,extra:'DEFAULT_GENERATED',generationExpression:'',charset:null,collation:null,comment:''}]:[])
  ].map(row=>({...row,...(row.name==='v'&&fullPatch?fullPatch:{})}));
}
let lossy:string,defaultLossy:string,maxConvertedBytes:string,preflightWarnings:boolean|1287,fullPatch:Record<string,unknown>|undefined,dropStrict:boolean,maxlenRows:unknown,timestampDefault:string|undefined,legacyCharset:boolean;
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++nextId; let mode = '', quote = 0, charset = 'utf8mb4', collation = 'utf8mb4_general_ci', fk = 0, unique = 0, gipk = 0;
  const value = { connection, profile, signal, broken: false, status: { version, dialect: 'mysql', connectionId: threadId }, close: vi.fn(async () => { if (closeFails) { injectedUnknownClose = true; throw new Error('真实关闭失败含私有文本'); } }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push({ id: threadId, sql });
    const complete = (error?: Error): void => queueMicrotask(() => {
      if (error || failSql?.test(sql)) { callback(error ?? Object.assign(new Error('驱动拒绝含私有文本'), { errno: 1227, code: 'ER_SPECIFIC_ACCESS_DENIED_ERROR' })); return; }
      // 原生表/索引角色独立固定，绝不由产品计划或后核结果反推。
      if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name FROM information_schema.')) { callback(null, [{ id: nativeTableId, name: 'db/t' }], []); return; }
      let rows: unknown = [];
      const document = () => parseTableColumnDefinition(source, { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } });
      if (sql === 'SELECT VERSION() AS version, @@version_compile_os AS os, @@lower_case_table_names AS lowerNames LIMIT 2') rows = [{ version, os: 'Linux', lowerNames: 0 }];
      else if (sql.startsWith('SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS tableName, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES')) rows = [{ databaseName: 'db', tableName: 't', kind: 'BASE TABLE', engine: 'InnoDB' }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode: mode, hostname: 'unit', port: 3306, serverId: 7, currentUser: 'test@host', connectionId: threadId }];
      else if (sql.startsWith('SET SESSION sql_mode')) mode = dropStrict ? 'NO_AUTO_VALUE_ON_ZERO' : /'([^']*)'/.exec(sql)![1];
      else if (sql === 'SELECT @@SESSION.sql_mode AS sqlMode') rows = [{sqlMode:mode}];
      else if (sql === 'SET SESSION sql_quote_show_create = 1') quote = 1;
      else if (sql.startsWith('SET NAMES')) { charset = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode: mode, quoteShowCreate: quote, charset, collation }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: 'unit' }];
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ Table: 't', 'Create Table': source }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, t.TABLE_COLLATION')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if(sql.startsWith('SELECT COLUMN_NAME AS name, ORDINAL_POSITION')) rows=encodingCatalogRows();
      else if(sql.startsWith('SELECT COLUMN_NAME AS name,')) rows=encodingCatalogRows().map(({name,nullable,extra,charset,collation})=>({name,nullable,extra,charset,collation}));
      else if (sql.startsWith('SET SESSION foreign_key_checks')) { fk = 1; unique = 1; }
      else if (sql.startsWith('SELECT @@SESSION.foreign_key_checks')) rows = [{ fkChecks: fk, uniqueChecks: unique }];
      else if (sql.startsWith('SET SESSION show_gipk')) gipk = 1;
      else if (sql.startsWith('SELECT @@SESSION.show_gipk')) rows = [{ showGipk: gipk, generateGipk: generatedPrimaryKeys }];
      else if (sql.startsWith('SELECT @@restrict_fk')) rows = [{ restrictForeignKeys: 1 }];
      else if (sql.startsWith('SELECT @@lower_case_table_names')) rows = [{ lowerCaseTableNames: 0, compileOs: 'Linux', pageSize }];
      else if (sql.startsWith('SELECT @@innodb_large_prefix')) rows = [{ largePrefix: 1 }];
      else if (sql.startsWith('SELECT ENGINE, ROW_FORMAT')) rows = [{ ENGINE: 'InnoDB', ROW_FORMAT: 'Dynamic' }];
      else if(sql.startsWith('SELECT COLUMN_NAME, DATA_TYPE')) rows=encodingCatalogRows().map(row=>({COLUMN_NAME:row.name,DATA_TYPE:row.dataType,COLUMN_TYPE:row.typeSql,IS_NULLABLE:row.nullable,EXTRA:row.extra,CHARACTER_SET_NAME:row.charset,COLLATION_NAME:row.collation,CHARACTER_MAXIMUM_LENGTH:row.name==='v'?String(/text/.test(row.typeSql)?65535:Number(/\((\d+)\)/.exec(row.typeSql)![1])):null,CHARACTER_OCTET_LENGTH:row.name==='v'?String(/text/.test(row.typeSql)?65535:Number(/\((\d+)\)/.exec(row.typeSql)![1])*(row.charset==='latin1'?1:row.charset==='utf8mb3'?3:4)):null,...(sql.includes(', SRS_ID')?{SRS_ID:null}:{})}));
      else if(sql.startsWith('SELECT CHARACTER_SET_NAME, MAXLEN')) rows=[{CHARACTER_SET_NAME:'latin1',MAXLEN:1},...(legacyCharset?[{CHARACTER_SET_NAME:'utf8mb3',MAXLEN:3}]:[]),{CHARACTER_SET_NAME:'utf8mb4',MAXLEN:4}];
      else if(sql.startsWith('SELECT CHARACTER_SET_NAME AS charset, MAXLEN AS maxlen')) rows=maxlenRows??[{charset:'latin1',maxlen:1},...(legacyCharset?[{charset:'utf8mb3',maxlen:3}]:[]),{charset:'utf8mb4',maxlen:4}];
      else if(sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset,c.COLLATION_NAME AS collation')) rows=[{charset:'latin1',collation:'latin1_bin',compiled:'Yes'},...(legacyCharset?[{charset:'utf8mb3',collation:'utf8mb3_bin',compiled:'Yes'}]:[]),{charset:'utf8mb4',collation:'utf8mb4_bin',compiled:'Yes'},{charset:'utf8mb4',collation:'utf8mb4_general_ci',compiled:'Yes'}];
      else if(sql.startsWith('SELECT CAST(@@SESSION.auto_increment_increment AS CHAR)')) rows=[{sessionIncrement:'1',sessionOffset:'1',globalIncrement:'1',globalOffset:'1',lockMode:'1',readOnly:'0',superReadOnly:'0',innodbReadOnly:'0',forceRecovery:'0'}];
      else if (sql.includes("TABLE_NAME = 'COLUMNS' AND COLUMN_NAME = 'SRS_ID'")) rows = sridHeadersAvailable ? [{ COLUMN_NAME: 'SRS_ID' }] : [];
      else if (sql.startsWith("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema'")) rows = ['INDEX_NAME', 'COLUMN_NAME', 'SEQ_IN_INDEX', 'NON_UNIQUE', 'INDEX_TYPE', 'COLLATION', 'SUB_PART', 'INDEX_COMMENT', 'EXPRESSION', 'IS_VISIBLE'].map(COLUMN_NAME => ({ COLUMN_NAME }));
      else if (sql.startsWith('SELECT INDEX_NAME, COLUMN_NAME')) rows = readTableIndexDefinition(document()).indexes.flatMap(index => index.parts.map((part, position) => ({ INDEX_NAME: index.name, COLUMN_NAME: part.columnName, SEQ_IN_INDEX: position + 1, NON_UNIQUE: ['unique', 'primary'].includes(index.kind) ? 0 : 1, INDEX_TYPE: index.kind === 'spatial' ? 'SPATIAL' : index.kind === 'fulltext' ? 'FULLTEXT' : 'BTREE', COLLATION: index.kind === 'fulltext' ? null : part.direction === 'desc' ? 'D' : 'A', SUB_PART: index.kind === 'spatial' ? 32 : part.prefixLength ?? null, INDEX_COMMENT: index.comment, EXPRESSION: expressionConflict && index.name === 'ia' ? 'lower(a)' : null, IS_VISIBLE: index.rawSql.includes('/*!80000 INVISIBLE */') ? 'NO' : 'YES', ...(sql.includes('WHERE CAST(TABLE_SCHEMA AS BINARY)') && index.name === 'ia' ? optimizerStatsPatch : {}) })));
      else if (sql.startsWith('SELECT NAME AS name, CAST(INDEX_ID AS CHAR)')) rows = [{ name: 'PRIMARY', id: '1000', type: '3', fields: '1' }, { name: 'ia', id: nativeIndexId, type: '0', fields: '1' }];
      else if (sql === 'SHOW GRANTS') rows = [{ grant: 'GRANT ALL PRIVILEGES ON *.* TO `ram`@`host`' }];
      else if (sql.includes('FOREIGN_COLS')) rows = parts;
      else if (sql.includes('INNODB_')) rows = headers;
      else if (sql.includes('KEY_COLUMN_USAGE')) rows = [];
      else if (sql.includes('FROM information_schema.PARTITIONS')) rows = [{ PARTITION_NAME: null, PARTITION_METHOD: null, PARTITION_EXPRESSION: null, SUBPARTITION_METHOD: null, SUBPARTITION_EXPRESSION: null }];
      else if (sql.startsWith('SELECT CAST(COUNT(*) AS CHAR) AS rowCount,')) rows=[{rowCount:'2',lossy,defaultLossy,maxConvertedBytes}];
      else if (sql === 'SHOW WARNINGS LIMIT 21') rows=preflightWarnings?[{Code:preflightWarnings===1287?1287:1366,Level:'Warning',Message:preflightWarnings===1287?"'utf8mb3' is deprecated and will be removed in a future release. Please use utf8mb4 instead":'原字符集转换诊断'}]:[];
      else if (sql.startsWith('ALTER TABLE')) { nativeTableId='200'; source = afterSql; afterDdl?.(); rows = { affectedRows: 0, warningStatus: warnings }; }
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Code: 1071, Message: '服务器警告' }];
      else { callback(new Error('未定义的测试驱动 SQL：' + sql)); return; }
      callback(null, rows, []);
    });
    if (holdSql?.test(sql)) { held = { connection: value, complete }; return; } complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1, includeEncodingFacts = true): Promise<TableColumnGetOutput> { return engine.handle('schema.columns.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: revision, includeEncodingFacts }); }
async function preview(snapshot:TableColumnGetOutput,encoding={charset:'utf8mb4',collation:'utf8mb4_bin'}):Promise<TableColumnPreviewOutput>{return engine.handle('schema.columns.preview',{snapshotId:snapshot.snapshotId,patches:[{kind:'alter',columnRef:snapshot.columns.find(column=>column.name==='v')!.columnRef,changes:{encoding}}],taskId:'preview-'+nextId,connectionRevision:1});}
async function apply(value: TableColumnPreviewOutput, taskId = 'apply', acknowledgements = value.requiredAcknowledgements) { return engine.handle('schema.columns.apply', { previewToken: value.previewToken, acknowledgements, taskId, connectionRevision: 1 }); }
beforeEach(async () => {
  lossy='0';defaultLossy='0';maxConvertedBytes='2';preflightWarnings=false;fullPatch=undefined;dropStrict=false;maxlenRows=undefined;timestampDefault=undefined;legacyCharset=false;
  injectedUnknownClose = false; nativeTableId = '100'; nativeIndexId = '1001'; optimizerStatsPatch = undefined; afterDdl = undefined;
  source=original;afterSql=original.replace('CHARACTER SET latin1 COLLATE latin1_bin','CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); version = '8.4.11'; failSql = undefined; holdSql = undefined; closeFails = false;
  connections = []; sent = []; events = []; nextId = 0; headers = []; parts = []; held = undefined; warnings = 0; generatedPrimaryKeys = 0; pageSize = 16384; expressionConflict = false;
  catalogSrid = 0; sridHeadersAvailable = true; fixedColumnMetadata = new Map();
  mocks.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal));
  mocks.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Object.assign(new Error('命令取消终态'), { errno: 1317 })); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => {
  closeFails = false; holdSql = undefined; held?.complete(new Error('单元收尾'));
  // 无资源证明的旧RAM端口在注入关闭未知后，退出也必须承认仍未释放。
  if (injectedUnknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll();
  vi.restoreAllMocks();
});

describe('列跨字符集真实Engine与完整IndexRead/COLUMNS/预检（原连接协议RAM）',()=>{
  it('真实8.0目录utf8mb3 MAXLEN3升级执行两次UTF8字节预检，不发旧USING且完整后核成功',async()=>{
    version='8.0.46';legacyCharset=true;source=original.replace('CHARACTER SET latin1 COLLATE latin1_bin','CHARACTER SET utf8mb3 COLLATE utf8mb3_bin');afterSql=source.replace('CHARACTER SET utf8mb3 COLLATE utf8mb3_bin','CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
    const value=await preview(await get());expect(await apply(value)).toMatchObject({ddlCompleted:true,definitionVerified:true});
    const checks=sent.filter(item=>item.sql.startsWith('SELECT CAST(COUNT(*) AS CHAR) AS rowCount,'));expect(checks).toHaveLength(2);for(const check of checks){expect(check.sql).not.toContain('USING utf8mb3');expect(check.sql).toContain('CAST(`v` AS BINARY)<=>CAST(CONVERT(`v` USING utf8mb4) AS BINARY)');expect(check.sql).toContain("CAST(X'c3a9' AS BINARY)<=>CAST(CONVERT(X'c3a9' USING utf8mb4) AS BINARY)");}
    expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(1);expect(connections.every(connection=>vi.mocked(connection.close).mock.calls.length===1)).toBe(true);
  });
  it.each(['default','1287'] as const)('UTF8升级%s仍拒绝且不回退到旧转换或发送DDL',async reason=>{
    version='8.0.46';legacyCharset=true;source=original.replace('CHARACTER SET latin1 COLLATE latin1_bin','CHARACTER SET utf8mb3 COLLATE utf8mb3_bin');if(reason==='default')defaultLossy='1';else preflightWarnings=1287;
    await expect(preview(await get())).rejects.toThrow(reason==='default'?'原字节':'警告');const checks=sent.filter(item=>item.sql.startsWith('SELECT CAST(COUNT(*) AS CHAR) AS rowCount,'));expect(checks).toHaveLength(1);expect(checks[0].sql).not.toContain('USING utf8mb3');expect(sent.some(item=>item.sql.startsWith('ALTER'))).toBe(false);expect(connections.every(connection=>vi.mocked(connection.close).mock.calls.length===1)).toBe(true);
  });
  it('旁created_at受控CURRENT_TIMESTAMP保留默认定义和精度，不误拒常用字段',async()=>{
    timestampDefault='CURRENT_TIMESTAMP(6)';source=original.replace('PRIMARY KEY','`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),PRIMARY KEY');afterSql=source.replace('CHARACTER SET latin1 COLLATE latin1_bin','CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
    const value=await preview(await get());expect(await apply(value)).toMatchObject({ddlCompleted:true,definitionVerified:true});expect(source).toContain('`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)');
  });
  it('旁非受控时间默认表达式仍明确只读，即使COLUMNS和SHOW一致',async()=>{
    timestampDefault='(CURRENT_TIMESTAMP(6) + INTERVAL 1 SECOND)';source=original.replace('PRIMARY KEY','`created_at` datetime(6) NOT NULL DEFAULT '+timestampDefault+',PRIMARY KEY');
    const snapshot=await get();expect(snapshot.columns.find(column=>column.name==='v')?.encoding?.access.editable).toBe(false);await expect(preview(snapshot)).rejects.toThrow('表达式');expect(sent.some(item=>item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('MAXLEN访问器不执行，不能把未知对象转String或JSON后授予资格',async()=>{
    const getter=vi.fn(()=>4),row={charset:'utf8mb4'};Object.defineProperty(row,'maxlen',{enumerable:true,get:getter});maxlenRows=[{charset:'latin1',maxlen:1},row];
    const snapshot=await get();expect(snapshot.columns.find(column=>column.name==='v')?.encoding?.access.editable).toBe(false);expect(getter).not.toHaveBeenCalled();
  });
  it('预览完整fresh事实也占共享缓存；仅旧快照和SQL能放下时必须拒绝而非漏计',async()=>{
    const cache=new StructurePatchCache(),tasks=new TableColumnPatchTasks({run:async(_connection,_task,action)=>{const context={managed:managed(),checkCancelled(){},report(){},commandStarted:()=>()=>{}};try{return await action(context);}finally{await context.managed.close({strict:true});}}},undefined,cache);
    const snapshot=await tasks.get({connectionId:profile.id,database:'db',table:'t',taskId:'budget-get',includeEncodingFacts:true},1),ref=snapshot.columns.find(column=>column.name==='v')!.columnRef;
    const saved=cache.scope<{connectionId:string;bytes:number;expires:number;encoding:ColumnEncodingFacts}>('columns','snapshot',value=>value).get(snapshot.snapshotId)!;
    const plan=buildColumnEncodingPlan(saved.encoding,ref,{charset:'utf8mb4',collation:'utf8mb4_bin'}),patches=[{kind:'alter' as const,columnRef:ref,changes:{encoding:{charset:'utf8mb4',collation:'utf8mb4_bin'}}}];
    const oldMinimum=saved.bytes+Buffer.byteLength(JSON.stringify([plan,patches]))+2048,unused=structureCacheLimits.bytes-saved.bytes-oldMinimum-Math.floor(saved.encoding.bytes/2);
    expect(unused).toBeGreaterThan(0);cache.scope<{connectionId:string;bytes:number;expires:number}>('indexes','snapshot',value=>value).set('other-budget',{connectionId:'other',bytes:unused,expires:Date.now()+structureCacheLimits.ttlMs});
    await expect(tasks.preview({snapshotId:snapshot.snapshotId,patches,taskId:'budget-preview'},1)).rejects.toThrow('缓存');expect(sent.some(item=>item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('省略optin不读取新MAXLEN；转换严格单次COPY、完整索引及新实际编码后核',async()=>{
    const old=await get(1,false);expect(old.encodingCatalog).toBeUndefined();expect(sent.some(item=>item.sql.startsWith('SELECT CHARACTER_SET_NAME AS charset'))).toBe(false);
    const snapshot=await get();expect(snapshot.encodingCatalog).toContainEqual({charset:'utf8mb4',collation:'utf8mb4_bin'});expect(snapshot.columns.find(column=>column.name==='v')?.encoding?.access.editable).toBe(true);
    const value=await preview(snapshot);expect(value.requiredAcknowledgements).toEqual(['ddl-implicit-commit','external-ddl-window','column-encoding-copy']);expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(0);
    expect(await apply(value)).toMatchObject({ddlCompleted:true,definitionVerified:true});expect(sent.filter(item=>item.sql.startsWith('SELECT CAST(COUNT(*) AS CHAR) AS rowCount,'))).toHaveLength(2);expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(1);
    expect(connections.every(connection=>vi.mocked(connection.close).mock.calls.length===1)).toBe(true);
  });
  it.each(['lossy','default','warnings','max-text'])('完整聚合%s拒绝预览，不进入任何DDL',async reason=>{
    if(reason==='lossy')lossy='1';if(reason==='default')defaultLossy='1';if(reason==='warnings')preflightWarnings=true;
    if(reason==='max-text'){source=original.replace('varchar(24)','text').replace('UNIQUE KEY `uq_v` (`v`,`amount`),','');afterSql=source.replace('CHARACTER SET latin1 COLLATE latin1_bin','CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');maxConvertedBytes='80000';}
    await expect(preview(await get())).rejects.toThrow();expect(sent.some(item=>item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('预览后新不可表示值在apply重新全扫描拒发，旧预览被消费',async()=>{
    const value=await preview(await get());lossy='1';await expect(apply(value)).rejects.toThrow('原字节');await expect(apply(value,'again')).rejects.toThrow('已使用');expect(sent.filter(item=>item.sql.startsWith('SELECT CAST(COUNT(*) AS CHAR) AS rowCount,'))).toHaveLength(2);expect(sent.some(item=>item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('新MAXLEN使769字符普通键超限，预检和DDL前拒绝，不接受Maria缩前缀',async()=>{
    source=original.replace('varchar(24)','varchar(769)');await expect(preview(await get())).rejects.toThrow('MAXLEN');expect(sent.some(item=>item.sql.startsWith('SELECT CAST(COUNT(*) AS CHAR) AS rowCount,'))).toBe(false);expect(sent.some(item=>item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('唯一排序碰撞由原严格DDL错误终态拒绝，不能重放同快照其它预览',async()=>{
    const snapshot=await get(),first=await preview(snapshot),second=await preview(snapshot);holdSql=/^ALTER TABLE/;const operation=apply(first),rejected=expect(operation).rejects.toMatchObject({errno:1062});await vi.waitFor(()=>expect(held).toBeDefined());held!.complete(Object.assign(Error('原唯一冲突'),{errno:1062}));held=undefined;await rejected;
    expect(source).toBe(original);await expect(apply(second,'another')).rejects.toThrow('已使用');expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('模式读回丢严格位或实体变化时拒绝发送',async()=>{
    const value=await preview(await get());dropStrict=true;await expect(apply(value)).rejects.toThrow('STRICT_ALL_TABLES');expect(sent.some(item=>item.sql.startsWith('ALTER'))).toBe(false);
  });
  it('已发后取消沿原命令终态reject，不能发第二条COPY',async()=>{
    const value=await preview(await get());holdSql=/^ALTER TABLE/;const operation=apply(value),rejected=expect(operation).rejects.toThrow();await vi.waitFor(()=>expect(held).toBeDefined());await engine.handle('query.cancel',{taskId:'apply'});await rejected;expect(events.at(-1)?.columnPatch).toMatchObject({ddlSubmitted:true,ddlCompleted:false,outcome:'unknown'});expect(sent.filter(item=>item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('成功ACK后核失败仍completed+unverified，未知物理关闭不能回包',async()=>{
    const value=await preview(await get());afterDdl=()=>{fullPatch={defaultValue:'矛盾'};};expect(await apply(value)).toMatchObject({ddlCompleted:true,definitionVerified:false});
    afterDdl=undefined;fullPatch=undefined;source=original;nativeTableId='100';const next=await preview(await get());closeFails=true;await expect(apply(next,'close')).rejects.toThrow('关闭');
  });
});
