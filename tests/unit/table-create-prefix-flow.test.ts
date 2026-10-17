import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import { tableCreateAcknowledgements, type TableCreateDraft, type TableCreateGetOutput, type TableCreatePreviewOutput } from '../../src/shared/tableCreate';
const driver = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('../../src/engine/connection', async () => ({ ...await vi.importActual('../../src/engine/connection'), connect: driver.connect }));
import { closeMysqlConnection } from '../../src/engine/connection';
import { Engine } from '../../src/engine';
const profile: ConnectionProfile = { id: 'c', name: '新表前缀RAM', group: '', color: '', dialect: 'mysql', host: 'invalid', port: 3306, user: 'unit' };
const design = (): TableCreateDraft => ({ database: 'db', name: 't', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [{ name: 'id', type: 'bigint unsigned', nullable: false, autoIncrement: true, comment: '' }, { name: 'v', type: 'varchar(1000)', nullable: true, autoIncrement: false, comment: '' }, { name: 'b', type: 'varbinary(64)', nullable: true, autoIncrement: false, comment: '' }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'ix', unique: false, keyParts: [{ columnName: 'v', prefixLength: 10 }, { columnName: 'id' }] }, { name: 'uq_b', unique: true, keyParts: [{ columnName: 'b', prefixLength: 8 }] }], foreignKeys: [] });
const ddl = "CREATE TABLE `t` (`id` bigint unsigned NOT NULL AUTO_INCREMENT,`v` varchar(1000) DEFAULT NULL,`b` varbinary(64) DEFAULT NULL,PRIMARY KEY (`id`),KEY `ix` (`v`(10),`id`),UNIQUE KEY `uq_b` (`b`(8))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC";
let engine: Engine, commands: string[], events: TaskEvent[], created: boolean, sequence: number, showReads: number;
let binaryPrefix: number | null, omitBinaryIndex: boolean, binaryColumnPatch: Record<string,unknown>;
let page: number, maxBytes: number, rowFormat: string, actualDdl: string, changedShow: boolean, columnPatch: Record<string, unknown>, indexPatch: Record<string, unknown>, tablePatch: Record<string, unknown>;
let hold: RegExp | undefined, release: (() => void) | undefined;
/** 真实Engine、快照/令牌、SQL生成及后核；只将传输换成RAM驱动。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), stream = Object.assign(new EventEmitter(), { closed: false, end(callback: () => void) { queueMicrotask(() => { callback(); stream.closed = true; stream.emit('close'); }); } });
  Object.assign(connection, { stream, threadId: ++sequence, end: (callback: () => void) => queueMicrotask(callback), destroy() {}, query(sql: string, callback: (error: Error | null, rows?: unknown) => void) {
    commands.push(sql);
    const complete = () => queueMicrotask(() => {
      let rows: unknown;
      if (sql.startsWith('SELECT @@hostname')) rows = [{ hostname: 'unit', port: 3306, serverId: 1, currentUser: 'unit@host', sqlMode: '', lowerNames: 0, charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: 'unit-server' }];
      else if (sql.startsWith('SELECT SCHEMA_NAME')) rows = [{ name: 'db', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT @@innodb_page_size')) rows = [{ pageSize: page, defaultRowFormat: rowFormat }];
      else if (sql.startsWith('SELECT CHARACTER_SET_NAME AS name')) rows = [{ name: 'utf8mb4', maxBytes }];
      else if (sql.startsWith('SELECT TABLE_NAME FROM')) rows = created ? [{ TABLE_NAME: 't' }] : [];
      else if (sql.startsWith('CREATE TABLE')) { created = true; rows = { affectedRows: 0, warningStatus: 0 }; }
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ 'Create Table': ++showReads > 1 && changedShow ? actualDdl + ' COMMENT=\'外部改变\'' : actualDdl }];
      else if (sql.startsWith('SELECT t.TABLE_NAME')) rows = [{ name: 't', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' }];
      else if (sql.startsWith('SELECT TABLE_NAME AS name,ENGINE')) rows = [{ name: 't', engine: 'InnoDB', rowFormat: 'Dynamic', collation: 'utf8mb4_bin', ...tablePatch }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name')) rows = design().columns.map(column => ({ name: column.name, type: column.type, nullable: column.nullable ? 'YES' : 'NO', defaultValue: null, extra: column.autoIncrement ? 'auto_increment' : '', comment: '' }));
      else if (sql.startsWith('SELECT COLUMN_NAME,DATA_TYPE')) rows = design().columns.map(column => ({ COLUMN_NAME: column.name, DATA_TYPE: column.type.split(/[ (]/)[0], COLUMN_TYPE: column.type, IS_NULLABLE: column.nullable ? 'YES' : 'NO', CHARACTER_SET_NAME: column.name === 'v' ? 'utf8mb4' : null, COLLATION_NAME: column.name === 'v' ? 'utf8mb4_bin' : null, CHARACTER_MAXIMUM_LENGTH: column.name === 'v' ? 1000 : column.name === 'b' ? 64 : null, CHARACTER_OCTET_LENGTH: column.name === 'v' ? 4000 : column.name === 'b' ? 64 : null, EXTRA: column.autoIncrement ? 'auto_increment' : '', ...(column.name === 'v' ? columnPatch : column.name === 'b' ? binaryColumnPatch : {}) }));
      else if (sql.startsWith('SELECT INDEX_NAME,NON_UNIQUE')) rows = [['PRIMARY', 0, 'id', 1, null], ['ix', 1, 'v', 1, 10], ['ix', 1, 'id', 2, null], ['uq_b', 0, 'b', 1, binaryPrefix]].filter(([name]) => !omitBinaryIndex || name !== 'uq_b').map(([name, unique, column, order, prefix]) => ({ INDEX_NAME: name, NON_UNIQUE: unique, COLUMN_NAME: column, SEQ_IN_INDEX: order, SUB_PART: prefix, INDEX_TYPE: 'BTREE', COLLATION: 'A', INDEX_COMMENT: '', EXPRESSION: null, IS_VISIBLE: 'YES', ...(name === 'ix' && order === 1 ? indexPatch : {}) }));
      else { callback(Error('未授权RAM查询：' + sql)); return; }
      callback(null, rows);
    });
    if (hold?.test(sql)) { hold = undefined; release = complete; } else complete();
  } });
  return { connection, signal, profile, status: { version: '8.4.11', dialect: 'mysql' }, broken: false, close: () => closeMysqlConnection(connection as any, true, false, 500) } as unknown as ManagedConnection;
}
beforeEach(async () => { commands = []; events = []; created = changedShow = false; sequence = showReads = 0; binaryPrefix = 8; omitBinaryIndex = false; binaryColumnPatch = {}; page = 16384; maxBytes = 4; rowFormat = 'dynamic'; actualDdl = ddl; columnPatch = indexPatch = tablePatch = {}; hold = release = undefined; driver.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal)); engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: 'c', profile }); });
afterEach(async () => { release?.(); await engine.closeAll(); });
async function get(prefix = true): Promise<TableCreateGetOutput> { return engine.handle('schema.tableCreate.get', { connectionId: 'c', database: 'db', taskId: 'get-' + sequence, connectionRevision: 1, ...(prefix ? { includePrefixFacts: true } : {}) }); }
async function preview(value: TableCreateGetOutput, draft = design()): Promise<TableCreatePreviewOutput> { return engine.handle('schema.tableCreate.preview', { snapshotId: value.snapshotId, design: draft, taskId: 'preview-' + sequence, connectionRevision: 1 }); }
async function apply(value: TableCreatePreviewOutput, revision = 1) { return engine.handle('schema.tableCreate.apply', { previewToken: value.previewToken, confirmation: 'db.t', acknowledgements: [...tableCreateAcknowledgements], taskId: 'apply-' + sequence, connectionRevision: revision }); }

describe('新表前缀真实Engine链路（仅RAM驱动）', () => {
  it('准备与预览零DDL；准确结构化前缀、显式DYNAMIC和三套真实目录后核完成后才报完整', async () => {
    const snapshot = await get(), value = await preview(snapshot); expect(snapshot.prefixFacts?.pageSize).toBe(16384); expect(value.sql).toContain('KEY `ix` (`v`(10), `id`)'); expect(value.sql).toContain('ROW_FORMAT=DYNAMIC'); expect(created).toBe(false);
    const result = await apply(value); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); expect(commands.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1); expect(showReads).toBe(2); await expect(apply(value)).rejects.toThrow('失效');
  });
  it('真正前缀缺能力快照时拒绝，不能把旧get当作能力', async () => { const value = await get(false); await expect(preview(value)).rejects.toThrow('能力快照'); expect(created).toBe(false); });
  it.each(['page', 'row', 'maxlen'])('准备后%s改变，在预览前拒绝且无DDL', async mode => { const value = await get(); if (mode === 'page') page = 8192; if (mode === 'row') rowFormat = 'compact'; if (mode === 'maxlen') maxBytes = 3; await expect(preview(value)).rejects.toThrow(); expect(created).toBe(false); });
  it.each(['page', 'maxlen'])('预览后%s改变，消费令牌但发送前拒绝；不补DROP或重放', async mode => { const value = await preview(await get()); if (mode === 'page') page = 8192; else maxBytes = 3; await expect(apply(value)).rejects.toThrow(); await expect(apply(value)).rejects.toThrow('失效'); expect(created).toBe(false); expect(commands.some(sql => /^DROP|ALTER/.test(sql))).toBe(false); });
  it.each([{ SUB_PART: 9 }, { SUB_PART: null }, { SEQ_IN_INDEX: 2 }, { NON_UNIQUE: 0 }, { INDEX_TYPE: 'HASH' }, { COLLATION: 'D' }, { COLUMN_NAME: 'b' }, { IS_VISIBLE: 'NO' }, { EXPRESSION: 'v' }])('STATISTICS不符%j仅保留ACK', async patch => { const value = await preview(await get()); indexPatch = patch; const result = await apply(value); expect(result.ddlCompleted).toBe(true); expect(result.definitionVerified).toBe(false); expect(commands.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1); });
  it.each([{ CHARACTER_MAXIMUM_LENGTH: 999 }, { CHARACTER_OCTET_LENGTH: 3999 }, { CHARACTER_SET_NAME: 'latin1' }, { COLLATION_NAME: 'utf8mb4_0900_ai_ci' }, { COLUMN_TYPE: 'varchar(999)' }])('实际COLUMNS不符%j不能用计划列补证', async patch => { const value = await preview(await get()); columnPatch = patch; expect((await apply(value)).definitionVerified).toBe(false); });
  it.each(['SHOW前缀', 'SHOW未知表选项', 'SHOW排序规则', 'TABLES行格式', '后读SHOW变化'])('%s不符只保留CREATE事实', async mode => { const value = await preview(await get()); if (mode === 'SHOW前缀') actualDdl = ddl.replace('`v`(10)', '`v`(9)'); if (mode === 'SHOW未知表选项') actualDdl += ' KEY_BLOCK_SIZE=8'; if (mode === 'SHOW排序规则') actualDdl = ddl.replace('COLLATE=utf8mb4_bin', 'COLLATE=utf8mb4_0900_ai_ci'); if (mode === 'TABLES行格式') tablePatch = { rowFormat: 'Compact' }; if (mode === '后读SHOW变化') changedShow = true; const result = await apply(value); expect(result.ddlCompleted).toBe(true); expect(result.definitionVerified).toBe(false); });
  it('重核等待中撤销快照，迟到预览不得签发令牌或执行', async () => { const value = await get(); hold = /^SELECT @@innodb_page_size/; const pending = preview(value); await vi.waitFor(() => expect(release).toBeDefined()); engine.handle('schema.tableCreate.release', { snapshotId: value.snapshotId }); release!(); await expect(pending).rejects.toThrow('失效'); expect(created).toBe(false); });
  it('连接修订变化拒绝消费到新目标，恢复原修订也没有旧令牌', async () => { const value = await preview(await get()); await expect(apply(value, 2)).rejects.toThrow('失效'); await expect(apply(value, 1)).rejects.toThrow('失效'); expect(created).toBe(false); });
});

it('旧整字段正常预览不请求新能力或强制新行格式', async () => {
  const input = design(); input.indexes = [{name:'PRIMARY',unique:true,columns:['id']},{name:'ix',unique:false,columns:['v']},{name:'uq_b',unique:true,columns:['b']}]; const result = await preview(await get(false), input); expect(result.sql).toContain('KEY `ix` (`v`)'); expect(result.sql).not.toContain('ROW_FORMAT'); expect(commands.some(sql=>sql.startsWith('SELECT @@innodb_page_size'))).toBe(false); expect(created).toBe(false);
});
it('等于二进制字段全长时SQL省略前缀，SHOW省略与SUB_PART=NULL完整后核；较短前缀不得冒充', async () => {
  const input = design(); input.indexes[2] = {name:'uq_b',unique:true,keyParts:[{columnName:'b',prefixLength:64}]}; const value = await preview(await get(), input); expect(value.sql).toContain('KEY `uq_b` (`b`)'); actualDdl = ddl.replace('`b`(8)', '`b`'); binaryPrefix = null; expect((await apply(value)).definitionVerified).toBe(true);
});

it.each([{}, {CHARACTER_MAXIMUM_LENGTH:63}, {CHARACTER_OCTET_LENGTH:63}, {CHARACTER_SET_NAME:'utf8mb4'}, {EXTRA:'未知属性'}])('未建索引的实际COLUMNS也完整核对%j，不能只验证键列', async patch => {
  const input=design();input.indexes.pop();omitBinaryIndex=true;actualDdl=ddl.replace(',UNIQUE KEY `uq_b` (`b`(8))','');const value=await preview(await get(),input);binaryColumnPatch=patch;const result=await apply(value);expect(result.ddlCompleted).toBe(true);expect(result.definitionVerified).toBe(Object.keys(patch).length===0);
});
