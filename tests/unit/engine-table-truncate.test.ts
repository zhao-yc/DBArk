import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableTruncateGetOutput, TableTruncatePreviewOutput } from '../../src/shared/tableTruncate';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableCommentDefinition } from '../../src/engine/tableCommentSql';
const mock = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mock.connect, execute: mock.execute }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'comment-unit', name: '注释单元', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
const original = "CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT,`s` varchar(80) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,PRIMARY KEY (`id`),KEY `prefix` (`s`(8))) ENGINE=InnoDB AUTO_INCREMENT=9007199254740993 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='原说明'";
let engine: Engine, source: string, physicalId: string, version: string, dialect: 'mysql' | 'mariadb', mode: string, charset: string, catalogMismatch: boolean, warningCount: number;
let nextId: number, sent: { id: number; sql: string }[], connections: ManagedConnection[], events: TaskEvent[], fail: RegExp | undefined, hold: RegExp | undefined, closeFails: boolean;
let afterAlterMode: string | undefined;
let currentName: string, occupied: boolean, dependency: string, grants: string[], afterPhysicalId: string | undefined;
let counter: string | null, empty: boolean, postEffect: (() => void) | undefined, kind: string, increment: number;
let held: { complete(error?: Error): void } | undefined;
/** 仅替换驱动；真实Engine、目录校验、预览、执行、取消和关闭路径均运行产品代码。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++nextId; let sqlMode = mode, quote = 0, encoding = '', collation = '';
  const value = { connection, profile, signal, broken: false, status: { version, dialect, connectionId: threadId }, close: vi.fn(async () => { if (closeFails) throw new Error('关闭失败'); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push({ id: threadId, sql });
    const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Object.assign(new Error('驱动拒绝'), { errno: 1227 })); return; }
      let rows: unknown = [];
      const context = { dialect, mode: { noBackslashEscapes: sqlMode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: sqlMode.includes('ANSI_QUOTES') } };
      if (sql.startsWith('SET SESSION information_schema_stats_expiry')) rows = {};
      else if (sql.startsWith('SELECT CAST(@@SESSION.information_schema_stats_expiry')) rows = [{ expiry: '0' }];
      else if (sql.startsWith('SET SESSION foreign_key_checks')) rows = {};
      else if (sql.startsWith('SELECT @@SESSION.foreign_key_checks')) rows = [{ fk: 1, uq: 1 }];
      else if (sql.startsWith('SET SESSION show_gipk')) rows = {};
      else if (sql.startsWith('SELECT @@SESSION.show_gipk')) rows = [{ show: 1 }];
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode, hostname: 'unit', port: 3306, serverId: 7, currentUser: 'test@host', connectionId: threadId }];
      else if (sql.startsWith('SET SESSION sql_mode')) sqlMode = /'([^']*)'/.exec(sql)![1];
      else if (sql.startsWith('SET SESSION sql_quote')) quote = 1;
      else if (sql.startsWith('SET NAMES')) { encoding = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode, quoteShowCreate: quote, charset: encoding, collation }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: 'unit-server' }];
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ Table: currentName, 'Create Table': source }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, t.TABLE_COLLATION')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name')) rows = parseTableColumnDefinition(source, context).columns.map(column => ({ name: column.name, nullable: column.nullable === false ? 'NO' : 'YES', extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '', charset: column.name === 's' ? 'latin1' : null, collation: column.name === 's' ? 'latin1_bin' : null }));
      else if (sql.startsWith('SELECT TABLE_TYPE AS kind')) rows = [{ kind, engine: 'InnoDB', rowFormat: 'Dynamic', comment: catalogMismatch ? '目录不符' : readTableCommentDefinition(source, context).comment, autoIncrement: counter }];
      else if (sql.startsWith('SELECT @@version_compile_os AS os')) rows = [{ os: 'Linux', lowerNames: 0 }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR)')) rows = [{ id: physicalId, name: 'db/' + currentName }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, c.CHARACTER_MAXIMUM')) rows = [{ charset, characters: '2048', bytes: charset === 'utf8mb4' ? '8192' : '6144', maxlen: charset === 'utf8mb4' ? 4 : 3 }];
      else if (sql.startsWith('SELECT @@SESSION.auto_increment_increment')) rows = [{ incrementValue: increment, offsetValue: 1 }];
      else if (sql.startsWith('SELECT 1 AS present FROM')) rows = empty ? [] : [{ present: 1 }];
      else if (sql === 'SHOW GRANTS') rows = grants.map(value => ({ Grants: value }));
      else if (sql.includes('FROM information_schema.INNODB_FOREIGN')) rows = dependency === 'foreign' ? [{ ID: 'db/foreign' }] : [];
      else if (sql.includes('FROM information_schema.TRIGGERS')) rows = dependency === 'trigger' ? [{ TRIGGER_NAME: 'tr' }] : [];
      else if (sql.includes('FROM information_schema.VIEW_TABLE_USAGE')) rows = dependency === 'view' ? [{ VIEW_NAME: 'v' }] : [];
      else if (sql.startsWith('SELECT TABLE_NAME FROM information_schema.TABLES')) {
        const literals = [...sql.matchAll(/X'([0-9a-f]*)'/g)].map(item => Buffer.from(item[1], 'hex').toString());
        rows = literals[1] === currentName || occupied ? [{ TABLE_NAME: literals[1] }] : [];
      }
      else if (sql.startsWith('TRUNCATE TABLE')) {
        source = source.replace(/ AUTO_INCREMENT=[0-9]+/, ''); counter = '1'; empty = true; physicalId = afterPhysicalId ?? '9007199254740996';
        if (afterAlterMode !== undefined) sqlMode = afterAlterMode;
        postEffect?.(); rows = { affectedRows: 0, warningStatus: warningCount };
      }
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Code: 1234, Message: '服务器警告' }];
      else { callback(new Error('未定义测试驱动语句：' + sql)); return; }
      callback(null, rows, []);
    });
    if (hold?.test(sql)) { held = { complete }; return; } complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1): Promise<TableTruncateGetOutput> { return engine.handle('schema.tableTruncate.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: revision }); }
async function preview(snapshot: TableTruncateGetOutput): Promise<TableTruncatePreviewOutput> { return engine.handle('schema.tableTruncate.preview', { snapshotId: snapshot.snapshotId, taskId: 'preview-' + nextId, connectionRevision: 1 }); }
async function apply(value: TableTruncatePreviewOutput, taskId = 'apply', revision = 1, acknowledgements = value.requiredAcknowledgements) { return engine.handle('schema.tableTruncate.apply', { previewToken: value.previewToken, taskId, connectionRevision: revision, acknowledgements, confirmation: 'db.t' }); }
beforeEach(async () => {
  counter = '9007199254740993'; empty = false; postEffect = undefined; kind = 'BASE TABLE'; increment = 1; currentName = 't'; occupied = false; dependency = ''; grants = ["GRANT ALL PRIVILEGES ON *.* TO 'test'@'host'"]; afterPhysicalId = undefined;
  source = original; physicalId = '9007199254740995'; version = '8.4.11'; dialect = 'mysql'; mode = ''; charset = 'utf8mb3'; catalogMismatch = false; warningCount = 0;
  nextId = 0; sent = []; connections = []; events = []; fail = undefined; hold = undefined; held = undefined; closeFails = false; afterAlterMode = undefined;
  mock.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal));
  mock.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Object.assign(new Error('取消终态'), { errno: 1317 })); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { closeFails = false; hold = undefined; held?.complete(new Error('单元收尾')); await engine.closeAll(); vi.useRealTimers(); });


const truncates = () => sent.filter(item => item.sql.startsWith('TRUNCATE TABLE'));
describe('真实Engine清空生命周期（仅替换驱动，无数据库）', () => {
  it('get和预览零破坏语句，执行精确一条TRUNCATE，独立会话FK保持开启，后核验空表/计数/新物理身份', async () => {
    const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true);
    const next = await preview(snapshot); expect(next.sql).toBe('TRUNCATE TABLE \x60db\x60.\x60t\x60;'); expect(truncates()).toHaveLength(0);
    const result = await apply(next); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true, after: { emptyObserved: true, autoIncrement: '1' } });
    expect(truncates()).toHaveLength(1); expect(truncates()[0].id).not.toBe(1); expect(sent.some(item => /foreign_key_checks\s*=\s*0/.test(item.sql))).toBe(false);
    expect(events.at(-1)?.tableTruncate).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' });
    await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用'); await expect(preview(snapshot)).rejects.toThrow('失效');
    expect(connections.every(item => vi.mocked(item.close).mock.calls.length === 1)).toBe(true);
    expect(sent.some(item => /COUNT\(|DELETE FROM|MAX\(/.test(item.sql))).toBe(false);
  });
  it.each(['foreign','trigger','view','unreadable','privilege','generated','unknown','version','kind','increment','stats-cache'])('依赖或未知能力 %s 只读且零TRUNCATE', async reason => {
    if (['foreign','trigger','view'].includes(reason)) dependency = reason;
    if (reason === 'unreadable') fail = /information_schema.INNODB_FOREIGN/;
    if (reason === 'privilege') grants = ["GRANT SELECT, SHOW VIEW ON *.* TO 'test'@'host'"];
    if (reason === 'generated') source = source.replace(',PRIMARY KEY', ',\x60g\x60 int GENERATED ALWAYS AS (length(\x60s\x60)) STORED,PRIMARY KEY');
    if (reason === 'unknown') source = source.replace('DEFAULT CHARSET=', 'UNKNOWN_OPTION=1 DEFAULT CHARSET=');
    if (reason === 'version') version = '8.0.44'; if (reason === 'kind') kind = 'VIEW'; if (reason === 'increment') increment = 2; if (reason === 'stats-cache') fail = /SET SESSION information_schema_stats_expiry/;
    if (reason === 'kind') await expect(get()).rejects.toThrow('基本表'); else { const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow(); } expect(truncates()).toHaveLength(0);
  });
  it.each(['preview','apply'])('%s严格重核同定义物理替换、旧计数和完整定义，零DDL', async stage => {
    for (const mutate of [() => { physicalId = 'new'; }, () => { counter = '100'; }, () => { source = source.replace('原说明','变化'); }]) {
      const snapshot = await get(), next = stage === 'apply' ? await preview(snapshot) : undefined; mutate();
      await expect(next ? apply(next, 'change-'+nextId) : preview(snapshot)).rejects.toThrow(); expect(truncates()).toHaveLength(0);
      source = original; physicalId = '9007199254740995'; counter = '9007199254740993';
    }
  });
  it('精确确认拒绝错表或空格，消费本批全部预览，不能从旧快照重新预览', async () => {
    const snapshot = await get(), next = await preview(snapshot), other = await preview(snapshot);
    await expect(engine.handle('schema.tableTruncate.apply', { previewToken: next.previewToken, confirmation: 'db.t ', acknowledgements: next.requiredAcknowledgements, taskId: 'wrong', connectionRevision: 1 })).rejects.toThrow('完全一致');
    await expect(apply(other, 'other')).rejects.toThrow('已失效或已使用'); await expect(preview(snapshot)).rejects.toThrow('失效'); expect(truncates()).toHaveLength(0);
  });
  it.each(['revision','ack','definition','dependency'])('执行前 %s 失败不发送且单次令牌不可重放', async reason => {
    const next = await preview(await get()); if (reason === 'definition') source = source.replace('原说明','变化'); if (reason === 'dependency') dependency='foreign';
    await expect(apply(next,'rejected',reason === 'revision' ? 2 : 1,reason === 'ack' ? [] : next.requiredAcknowledgements)).rejects.toThrow();
    await expect(apply(next,'replay')).rejects.toThrow('已失效或已使用'); expect(truncates()).toHaveLength(0);
  });
  it('跨用途快照和预览不能套用或释放，统一预算不建立第二生命周期', async () => {
    const snapshot = await get(), next = await preview(snapshot);
    await expect(engine.handle('schema.tableComment.preview',{snapshotId:snapshot.snapshotId,comment:'x',taskId:'wrong',connectionRevision:1})).rejects.toThrow();
    await engine.handle('schema.tableComment.release',{snapshotId:snapshot.snapshotId,previewToken:next.previewToken});
    expect((await apply(next)).definitionVerified).toBe(true);
  });
  it.each(['same-id','nonempty','counter','definition','warning','read-failed','mode'])('DDL成功而后核验 %s 失败，保留完成事实不报告完整成功', async reason => {
    const next = await preview(await get());
    if(reason==='same-id')afterPhysicalId=physicalId;
    if(reason==='warning')warningCount=1;
    if(reason==='mode')afterAlterMode='ANSI_QUOTES';
    postEffect=()=>{if(reason==='nonempty')empty=false;if(reason==='counter')counter='2';if(reason==='definition')source=source.replace('原说明','变化');if(reason==='read-failed')fail=/SHOW CREATE TABLE/;};
    expect(await apply(next)).toMatchObject({ddlCompleted:true,definitionVerified:false}); expect(events.at(-1)?.tableTruncate).toMatchObject({ddlCompleted:true,outcome:'succeeded',definitionVerified:false});
    await expect(apply(next,'replay')).rejects.toThrow('已失效或已使用');expect(truncates()).toHaveLength(1);
  });
  it('取消等待DDL不会先释放锁或重放；终态保留可能已发送事实',async()=>{
    const next=await preview(await get());hold=/^TRUNCATE TABLE/;const pending=apply(next,'cancel').catch(error=>error);await vi.waitFor(()=>expect(held).toBeDefined());
    await engine.handle('query.cancel',{taskId:'cancel'});await pending;
    expect(events.at(-1)?.tableTruncate).toMatchObject({ddlSubmitted:true,ddlCompleted:false,outcome:'unknown'});await expect(apply(next,'replay')).rejects.toThrow('已失效或已使用');expect(truncates()).toHaveLength(1);
  });
  it('预览取消后的迟到读不产生可用令牌；原会话均实际关闭',async()=>{
    const snapshot=await get();hold=/SHOW CREATE TABLE/;const pending=preview(snapshot).catch(error=>error);await vi.waitFor(()=>expect(held).toBeDefined());const task=events.at(-1)!.taskId;
    await engine.handle('query.cancel',{taskId:task});expect(await pending).toBeInstanceOf(Error);expect(truncates()).toHaveLength(0);expect(connections.every(item=>vi.mocked(item.close).mock.calls.length===1)).toBe(true);
  });
  it('快照/预览120秒统一过期，执行前拒绝且零DDL',async()=>{
    const next=await preview(await get()),now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now+120001);
    try{await expect(apply(next,'expired')).rejects.toThrow('失效');expect(truncates()).toHaveLength(0);}finally{clock.mockRestore();}
  });
  it('无自增列也只清空原表，不新增自增属性，目录必须保持null',async()=>{
    source=source.replace(' AUTO_INCREMENT','').replace(/ AUTO_INCREMENT=[0-9]+/,'');counter=null;postEffect=()=>{counter=null;};
    const snapshot=await get();expect(snapshot.writable,snapshot.reasons.join('；')).toBe(true);expect(snapshot.autoIncrement).toBeNull();
    expect(await apply(await preview(snapshot))).toMatchObject({definitionVerified:true,after:{autoIncrement:null,emptyObserved:true}});
  });
  it('同连接结构写锁在清空等待时阻止另一写入，不借查询会话执行',async()=>{
    const first=await preview(await get()),second=await preview(await get());hold=/^TRUNCATE TABLE/;const pending=apply(first,'locked');await vi.waitFor(()=>expect(held).toBeDefined());
    await expect(apply(second,'conflict')).rejects.toThrow();held!.complete();await pending;expect(truncates()).toHaveLength(1);
  });

  it('没有主键和唯一键仍可专用清空，不依赖网格可靠行键能力',async()=>{
    source=source.replace(' NOT NULL AUTO_INCREMENT',' DEFAULT NULL').replace(',PRIMARY KEY (\x60id\x60)','').replace(/ AUTO_INCREMENT=[0-9]+/,'');counter=null;postEffect=()=>{counter=null;};
    const snapshot=await get();expect(snapshot.writable,snapshot.reasons.join('；')).toBe(true);expect(await apply(await preview(snapshot))).toMatchObject({definitionVerified:true});expect(truncates()).toHaveLength(1);
  });

});
