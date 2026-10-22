import { createHash } from 'node:crypto';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { definitionOmittingSqlModes, type TableDefinitionContext } from '../shared/tableColumnPatches';
import { databaseDropIdentifier, isProtectedDatabaseDropName, validateDatabaseDropName, type DatabaseDropTarget, type DatabaseDropCounts } from '../shared/databaseDrop';

export const databaseDropReadLimits = { objects: 4096, bytes: 8 * 1024 * 1024, definitionBytes: 2 * 1024 * 1024 } as const;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const literal = (value: string): string => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
const exact = (column: string, value: string): string => `CAST(${column} AS BINARY)=CAST(${literal(value)} AS BINARY)`;
const emptyCounts = (): DatabaseDropCounts => ({ tables: 0, views: 0, procedures: 0, functions: 0, triggers: 0, events: 0 });
type Row = Record<string, unknown>;
interface Session { identity: string; originalMode: string; normalizedMode: string; mode: TableDefinitionContext; serverVersion: string; lowerNames: number; }
interface Catalog { tables: Row[]; routines: Row[]; triggers: Row[]; events: Row[]; incoming: Row[]; physical: Row[]; }
export interface DatabaseDropRead {
  catalogDigest: string; counts: DatabaseDropCounts; charset: string; collation: string;
  serverVersion: string; identity: string; originalMode: string; normalizedMode: string;
  reasons: string[]; warnings: string[]; bytes: number;
}

/** 名称模式只接受确实等于目标的授权；未展开的通配、角色及部分撤销不能证明可见性。 */
export function proveDatabaseDropPrivileges(grants: readonly string[], database: string, mode: TableDefinitionContext, requireDrop = true): boolean {
  const global = new Set<string>(), own = new Set<string>();
  const scopeName = (text: string): string | undefined => {
    let value = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\\') { if (!['_', '%', '\\'].includes(text[i + 1])) return undefined; value += text[++i]; }
      else { if (text[i] === '_' || text[i] === '%') return undefined; value += text[i]; }
    }
    return value;
  };
  for (const source of grants) {
    const tokens = tableDefinitionTokens(source, mode), word = (i: number) => tokens[i]?.kind === 'word' ? tokens[i].value.toUpperCase() : '';
    if (word(0) !== 'GRANT' || tokens.some(token => token.kind === 'executable')) return false;
    const on = tokens.findIndex((_, i) => word(i) === 'ON'), to = tokens.findIndex((_, i) => i > on && word(i) === 'TO');
    if (on < 0 || to < 0) return false;
    const scope = tokens.slice(on + 1, to);
    // PROCEDURE/FUNCTION级授权不证明整个库目录；合法但与本证明无关。
    if (scope.length !== 3 || scope[1].value !== '.') continue;
    const star = (i: number) => scope[i].kind === 'symbol' && scope[i].value === '*';
    const all = star(0) && star(2), ownDatabase = ['identifier', 'word'].includes(scope[0].kind) && scopeName(scope[0].value) === database && star(2);
    const destination = all ? global : ownDatabase ? own : undefined;
    const privileges: string[][] = [[]];
    for (const token of tokens.slice(1, on)) {
      if (token.kind === 'symbol' && token.value === ',') privileges.push([]);
      else privileges.at(-1)!.push(token.kind === 'word' ? token.value.toUpperCase() : token.value);
    }
    if (!destination) continue;
    for (const parts of privileges) {
      const privilege = parts.join(' ');
      if (['ALL', 'ALL PRIVILEGES'].includes(privilege)) for (const name of ['SELECT', 'SHOW VIEW', 'TRIGGER', 'EVENT', 'PROCESS', 'DROP']) destination.add(name);
      else if (['SELECT', 'SHOW VIEW', 'TRIGGER', 'EVENT', 'PROCESS', 'DROP'].includes(privilege)) destination.add(privilege);
    }
  }
  return ['SELECT', 'SHOW VIEW', 'TRIGGER', 'EVENT', 'PROCESS'].every(value => global.has(value)) && (!requireDrop || global.has('DROP') || own.has('DROP'));
}

/** SHOW GRANTS可能携带认证细节，仅在短会话内解析，不缓存、记录或返回原文。 */
async function privileges(context: StructureTaskContext, database: string, mode: TableDefinitionContext, requireDrop = true): Promise<boolean> {
  const rows = (await structureTaskQuery<Row[]>(context, 'SHOW GRANTS')).rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > 256) return false;
  let bytes = 0; const sources: string[] = [];
  for (const row of rows) {
    const values = Object.values(row);
    if (values.length !== 1 || typeof values[0] !== 'string') return false;
    bytes += Buffer.byteLength(values[0]); if (bytes > 512 * 1024) return false; sources.push(values[0]);
  }
  try { return proveDatabaseDropPrivileges(sources, database, mode, requireDrop); } catch { return false; }
}

/** 已证明的六实例系列以实际版本、账户、服务器和名称映射绑定，绝不用数据库名称虚构物理OID。 */
async function session(context: StructureTaskContext, normalize: boolean): Promise<Session> {
  const rows = (await structureTaskQuery<Row[]>(context, 'SELECT VERSION() AS version, @@SESSION.sql_mode AS sqlMode, @@hostname AS hostname, @@port AS port, @@server_id AS serverId, CURRENT_USER() AS currentUser, CONNECTION_ID() AS connectionId, @@lower_case_table_names AS lowerNames, @@version_compile_os AS os')).rows;
  const row = rows[0];
  if (rows.length !== 1 || !row || typeof row.version !== 'string' || row.version !== context.managed.status.version || typeof row.sqlMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(row.sqlMode) || typeof row.hostname !== 'string' || !row.hostname || typeof row.currentUser !== 'string' || !row.currentUser || Number(row.connectionId) !== context.managed.connection.threadId || !/^[0-9]+$/.test(String(row.serverId)) || !Number.isSafeInteger(Number(row.serverId)) || Number(row.serverId) > 4294967295 || !/^[0-9]+$/.test(String(row.port)) || !Number.isSafeInteger(Number(row.port)) || Number(row.port) < 1 || Number(row.port) > 65535 || ![0, 1, 2, '0', '1', '2'].includes(row.lowerNames as number | string) || typeof row.os !== 'string' || !row.os) throw Error('无法确认删除数据库短会话身份和名称映射');
  const dialect = context.managed.status.dialect, version = row.version.replace(/^5\.5\.5-/, '');
  const supported = dialect === 'mysql' ? /^(5\.7\.44|8\.0\.46|8\.4\.11)(?:-|$)/.test(version) : /^(10\.11\.19|11\.4\.13)-MariaDB(?:-|$)/.test(version);
  if (!supported) throw Error('当前删除数据库版本尚未证明；支持MySQL 5.7.44、8.0.46、8.4.11和MariaDB 10.11.19、11.4.13');
  let uuid: string | undefined;
  if (dialect === 'mysql') {
    const ids = (await structureTaskQuery<Row[]>(context, 'SELECT @@server_uuid AS uuid')).rows;
    if (ids.length !== 1 || typeof ids[0].uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(ids[0].uuid)) throw Error('无法确认MySQL服务器UUID'); uuid = ids[0].uuid;
  }
  const originalMode = row.sqlMode, omitted = new Set<string>(definitionOmittingSqlModes);
  const normalizedMode = originalMode.split(',').filter(value => !omitted.has(value.toUpperCase())).join(',');
  if (normalize) {
    if (normalizedMode !== originalMode) await structureTaskQuery(context, `SET SESSION sql_mode = '${normalizedMode}'`);
    await structureTaskQuery(context, 'SET SESSION sql_quote_show_create = 1');
    await structureTaskQuery(context, 'SET NAMES utf8mb4 COLLATE utf8mb4_bin');
    await structureTaskQuery(context, 'SET SESSION foreign_key_checks = 1');
    if (dialect === 'mysql' && /^8\./.test(version)) await structureTaskQuery(context, 'SET SESSION show_gipk_in_create_table_and_information_schema = ON');
  }
  const modes = (await structureTaskQuery<Row[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote_show_create AS quoteShowCreate, @@character_set_connection AS charset, @@collation_connection AS collation, @@SESSION.foreign_key_checks AS foreignChecks')).rows;
  if (modes.length !== 1 || modes[0].sqlMode !== normalizedMode || Number(modes[0].quoteShowCreate) !== 1 || modes[0].charset !== 'utf8mb4' || modes[0].collation !== 'utf8mb4_bin' || Number(modes[0].foreignChecks) !== 1) throw Error('删除数据库会话未能提供完整规范定义和外键检查');
  if (dialect === 'mysql' && /^8\./.test(version)) {
    const gipk = (await structureTaskQuery<Row[]>(context, 'SELECT @@SESSION.show_gipk_in_create_table_and_information_schema AS showGipk')).rows;
    if (gipk.length !== 1 || Number(gipk[0].showGipk) !== 1) throw Error('无法确认完整生成主键目录可见性');
  }
  return { identity: hash(JSON.stringify([row.hostname, row.port, row.serverId, row.currentUser, row.lowerNames, row.os, uuid, dialect, row.version])), originalMode, normalizedMode, serverVersion: row.version, lowerNames: Number(row.lowerNames), mode: { dialect, mode: { noBackslashEscapes: normalizedMode.split(',').includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: normalizedMode.split(',').includes('ANSI_QUOTES') } } };
}

/** 单个目录响应与定义都设有上限；计数只来自元数据，不扫描业务行。 */
async function bounded(context: StructureTaskContext, sql: string): Promise<Row[]> {
  const rows = (await structureTaskQuery<Row[]>(context, sql)).rows;
  if (!Array.isArray(rows) || rows.length > databaseDropReadLimits.objects || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error('删除数据库目录超过4096对象预算或返回格式无效');
  if (Buffer.byteLength(JSON.stringify(rows)) > databaseDropReadLimits.bytes) throw Error('删除数据库目录超过8 MiB预算');
  return rows;
}

/** BINARY精确名称选择避免连接排序规则把其它同形库当成目标。 */
async function schema(context: StructureTaskContext, database: string): Promise<Row[]> {
  return bounded(context, `SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE ${exact('SCHEMA_NAME', database)} ORDER BY CAST(SCHEMA_NAME AS BINARY) LIMIT 2`);
}

/** 全局可见性先行证明，再读取本库对象及跨库入向外键；内部引用交由唯一原生DROP处理。 */
async function catalog(context: StructureTaskContext, database: string, version: string): Promise<Catalog> {
  const db = (column: string) => exact(column, database), limit = ' LIMIT 4097';
  const tables = await bounded(context, `SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, ENGINE AS engine, TABLE_COLLATION AS collation, CREATE_OPTIONS AS options FROM information_schema.TABLES WHERE ${db('TABLE_SCHEMA')} ORDER BY CAST(TABLE_NAME AS BINARY)` + limit);
  const routines = await bounded(context, `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS kind, SECURITY_TYPE AS securityType, DEFINER AS definer, SQL_MODE AS sqlMode, CHARACTER_SET_CLIENT AS charset, COLLATION_CONNECTION AS collation, DATABASE_COLLATION AS databaseCollation FROM information_schema.ROUTINES WHERE ${db('ROUTINE_SCHEMA')} ORDER BY ROUTINE_TYPE, CAST(ROUTINE_NAME AS BINARY)` + limit);
  const triggers = await bounded(context, `SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS tableName, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event, ACTION_ORDER AS actionOrder, DEFINER AS definer, SQL_MODE AS sqlMode, CHARACTER_SET_CLIENT AS charset, COLLATION_CONNECTION AS collation, DATABASE_COLLATION AS databaseCollation FROM information_schema.TRIGGERS WHERE ${db('TRIGGER_SCHEMA')} ORDER BY CAST(TRIGGER_NAME AS BINARY)` + limit);
  const events = await bounded(context, `SELECT EVENT_NAME AS name, DEFINER AS definer, TIME_ZONE AS timeZone, EVENT_TYPE AS kind, EXECUTE_AT AS executeAt, INTERVAL_VALUE AS intervalValue, INTERVAL_FIELD AS intervalField, STARTS AS starts, ENDS AS ends, STATUS AS status, ON_COMPLETION AS completion, SQL_MODE AS sqlMode, CHARACTER_SET_CLIENT AS charset, COLLATION_CONNECTION AS collation, DATABASE_COLLATION AS databaseCollation FROM information_schema.EVENTS WHERE ${db('EVENT_SCHEMA')} ORDER BY CAST(EVENT_NAME AS BINARY)` + limit);
  const incoming = await bounded(context, `SELECT CONSTRAINT_SCHEMA AS databaseName, TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, REFERENCED_TABLE_NAME AS referencedTable, ORDINAL_POSITION AS ordinal FROM information_schema.KEY_COLUMN_USAGE WHERE ${db('REFERENCED_TABLE_SCHEMA')} AND NOT (${db('TABLE_SCHEMA')}) ORDER BY CAST(CONSTRAINT_SCHEMA AS BINARY), CAST(TABLE_NAME AS BINARY), CAST(CONSTRAINT_NAME AS BINARY), ORDINAL_POSITION` + limit);
  const native = context.managed.status.dialect === 'mysql' && /^8\./.test(version) ? 'INNODB_TABLES' : 'INNODB_SYS_TABLES';
  // 原生NAME有些字符会采用内部文件编码；仅收录真正可映射的记录，不制造Unicode或非InnoDB表的物理编号。
  const physical = await bounded(context, `SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name FROM information_schema.${native} WHERE ${exact("SUBSTRING_INDEX(NAME,'/',1)", database)} ORDER BY CAST(NAME AS BINARY)` + limit);
  if (tables.length + routines.length + triggers.length + events.length > databaseDropReadLimits.objects) throw Error('删除数据库对象合计超过4096预算');
  const names = new Set<string>();
  for (const [kind, rows] of [['table', tables], ['routine', routines], ['trigger', triggers], ['event', events]] as const) for (const row of rows) {
    if (typeof row.name !== 'string' || !row.name.length || row.name.length > 64 || row.name.includes('\0')) throw Error('删除数据库对象名称目录不完整');
    const key = JSON.stringify([kind, kind === 'routine' ? row.kind : '', row.name]); if (names.has(key)) throw Error('删除数据库对象目录存在重复身份'); names.add(key);
  }
  if (tables.some(row => !['BASE TABLE', 'VIEW', 'SYSTEM VERSIONED'].includes(String(row.kind))) || routines.some(row => !['PROCEDURE', 'FUNCTION'].includes(String(row.kind)))) throw Error('存在未识别对象类型，不能证明完整数据库目录');
  const nonempty = (row: Row, keys: string[]) => keys.every(key => typeof row[key] === 'string' && !!row[key]);
  const nullableText = (row: Row, keys: string[]) => keys.every(key => row[key] === null || typeof row[key] === 'string');
  if (tables.some(row => !nullableText(row, ['engine', 'collation']) || !(typeof row.options === 'string' || row.kind === 'VIEW' && row.options === null)) || routines.some(row => !nonempty(row, ['securityType', 'definer', 'charset', 'collation', 'databaseCollation']) || typeof row.sqlMode !== 'string') || triggers.some(row => !nonempty(row, ['tableName', 'timing', 'event', 'definer', 'charset', 'collation', 'databaseCollation']) || typeof row.sqlMode !== 'string' || !Number.isSafeInteger(Number(row.actionOrder)) || Number(row.actionOrder) < 1) || events.some(row => !nonempty(row, ['definer', 'timeZone', 'kind', 'status', 'completion', 'charset', 'collation', 'databaseCollation']) || typeof row.sqlMode !== 'string' || !nullableText(row, ['executeAt', 'intervalValue', 'intervalField', 'starts', 'ends'])) || incoming.some(row => !nonempty(row, ['databaseName', 'tableName', 'name', 'referencedTable']) || !Number.isSafeInteger(Number(row.ordinal)) || Number(row.ordinal) < 1)) throw Error('对象属性或入向外键目录不完整，不能把未知目录当作空库');
  if (physical.some(row => typeof row.id !== 'string' || !/^[1-9]\d{0,19}$/.test(row.id) || typeof row.name !== 'string' || !row.name.startsWith(database + '/')) || new Set(physical.map(row => row.name)).size !== physical.length) throw Error('InnoDB原生物理目录返回无效');
  return { tables, routines, triggers, events, incoming, physical };
}

/** 每个对象都读完整SHOW CREATE并核对返回名称；原始定义只用于本地摘要，不通过IPC返回。 */
async function definitions(context: StructureTaskContext, database: string, value: Catalog): Promise<Row[]> {
  const output: Row[] = []; let bytes = Buffer.byteLength(JSON.stringify(value));
  const read = async (kind: string, name: string, field: string, nameField: string): Promise<void> => {
    const q = '`' + name.replaceAll('`', '``') + '`';
    const rows = await bounded(context, `SHOW CREATE ${kind} ${databaseDropIdentifier(database)}.${q}`);
    if (rows.length !== 1 || rows[0][nameField] !== name || typeof rows[0][field] !== 'string' || !rows[0][field]) throw Error('无法唯一读取完整' + kind + '定义；不可见不等于不存在');
    const size = Buffer.byteLength(JSON.stringify(rows[0]));
    if (size > databaseDropReadLimits.definitionBytes) throw Error('对象完整定义超过2 MiB预算');
    bytes += size; if (bytes > databaseDropReadLimits.bytes) throw Error('完整数据库定义合计超过8 MiB预算');
    output.push({ kind, name, create: rows[0] });
  };
  for (const row of value.tables) await read(row.kind === 'VIEW' ? 'VIEW' : 'TABLE', String(row.name), row.kind === 'VIEW' ? 'Create View' : 'Create Table', row.kind === 'VIEW' ? 'View' : 'Table');
  for (const row of value.routines) await read(String(row.kind), String(row.name), row.kind === 'PROCEDURE' ? 'Create Procedure' : 'Create Function', row.kind === 'PROCEDURE' ? 'Procedure' : 'Function');
  for (const row of value.triggers) await read('TRIGGER', String(row.name), 'SQL Original Statement', 'Trigger');
  for (const row of value.events) await read('EVENT', String(row.name), 'Create Event', 'Event');
  return output;
}

/** 两轮目录、完整定义与库属性交叉一致才可写，未知权限、外部外键、漂移和预算失败均保留为只读。 */
export async function readDatabaseDrop(context: StructureTaskContext, target: DatabaseDropTarget): Promise<DatabaseDropRead> {
  validateDatabaseDropName(target.database);
  const reasons: string[] = [], warnings = ['数据库没有可公开证明的独立物理OID；空库、非InnoDB及无法映射内部名称的对象无法提供物理替换检测。维护窗口仍需暂停外部DDL。'];
  const counts = emptyCounts(); let charset = '', collation = '', identity = '', originalMode = '', normalizedMode = '', serverVersion = context.managed.status.version, proof: unknown = null;
  try {
    const state = await session(context, true); ({ identity, originalMode, normalizedMode, serverVersion } = state);
    const before = await schema(context, target.database);
    if (before.length !== 1 || before[0].name !== target.database || typeof before[0].charset !== 'string' || !before[0].charset || typeof before[0].collation !== 'string' || !before[0].collation) throw Error('数据库不存在、不可见或精确名称不能唯一映射；未读取对象计数');
    charset = before[0].charset; collation = before[0].collation;
    if (isProtectedDatabaseDropName(target.database)) throw Error('系统数据库永远禁止删除；对象计数未读取');
    if (!await privileges(context, target.database, state.mode)) throw Error('无法证明全局SELECT、SHOW VIEW、TRIGGER、EVENT、PROCESS目录可见性及目标库DROP权限；角色、部分撤销或未知授权仅可查看，对象计数未读取');
    const createBefore = await bounded(context, `SHOW CREATE DATABASE ${databaseDropIdentifier(target.database)}`);
    if (createBefore.length !== 1 || createBefore[0].Database !== target.database || typeof createBefore[0]['Create Database'] !== 'string' || !createBefore[0]['Create Database']) throw Error('无法唯一读取完整数据库定义');
    if (Buffer.byteLength(JSON.stringify(createBefore)) > databaseDropReadLimits.definitionBytes) throw Error('数据库定义超过2 MiB预算');
    const first = await catalog(context, target.database, serverVersion), firstDefinitions = await definitions(context, target.database, first);
    const second = await catalog(context, target.database, serverVersion), secondDefinitions = await definitions(context, target.database, second);
    const after = await schema(context, target.database), createAfter = await bounded(context, `SHOW CREATE DATABASE ${databaseDropIdentifier(target.database)}`);
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(createBefore) !== JSON.stringify(createAfter) || JSON.stringify(first) !== JSON.stringify(second) || JSON.stringify(firstDefinitions) !== JSON.stringify(secondDefinitions)) throw Error('数据库属性、目录、完整定义或可获取物理表身份读取期间变化，请重新读取');
    if (!await privileges(context, target.database, state.mode)) throw Error('读取期间目录可见性或DROP权限已变化；不能证明完整计数');
    Object.assign(counts, { tables: second.tables.filter(row => row.kind !== 'VIEW').length, views: second.tables.filter(row => row.kind === 'VIEW').length, procedures: second.routines.filter(row => row.kind === 'PROCEDURE').length, functions: second.routines.filter(row => row.kind === 'FUNCTION').length, triggers: second.triggers.length, events: second.events.length });
    if (second.incoming.length) reasons.push('存在其它数据库指向目标库的外键；请先人工处理入向外键，不会关闭检查或级联修改外库');
    const mapped = new Set(second.physical.map(row => row.name));
    if (second.tables.some(row => row.engine === 'InnoDB' && !mapped.has(target.database + '/' + row.name))) warnings.push('部分InnoDB对象没有可直接映射的原生TABLE_ID；内部编码或分区名称的物理替换无法完整检测，请在维护窗口人工核对。');
    proof = { schema: after, create: createAfter, catalog: second, definitions: secondDefinitions };
  } catch (error) { context.checkCancelled(); reasons.push(error instanceof Error ? error.message : '数据库目录无法完整证明，仅可查看'); }
  const document = JSON.stringify({ target: target.database, identity, originalMode, normalizedMode, proof, reasons });
  const bytes = Buffer.byteLength(document) + 4096;
  if (bytes > databaseDropReadLimits.bytes + 4096) { reasons.push('数据库快照总计超过8 MiB预算，仅可查看'); proof = null; }
  return { catalogDigest: hash(proof === null ? JSON.stringify([target.database, identity, charset, collation, reasons]) : document), counts, charset, collation, serverVersion, identity, originalMode, normalizedMode, reasons, warnings, bytes: Math.min(bytes, databaseDropReadLimits.bytes + 8192) };
}

/** 重读使用同样的完整性门槛；摘要含物理表ID但不会承诺数据库本身有OID。 */
export function assertDatabaseDropUnchanged(before: DatabaseDropRead, after: DatabaseDropRead): void {
  if (after.reasons.length) throw Error(after.reasons.join('；') + '；未发送DDL');
  if (before.identity !== after.identity || before.originalMode !== after.originalMode || before.normalizedMode !== after.normalizedMode || before.catalogDigest !== after.catalogDigest) throw Error('数据库身份、模式、属性或完整对象目录已变化，请重新读取和预览；未发送DDL');
}

/** 成功ACK之后只作精确名称不存在核验；先重新证明完整可见性，防止权限撤回被误当成库消失。 */
export async function verifyDatabaseDropAbsent(context: StructureTaskContext, target: DatabaseDropTarget, before: DatabaseDropRead): Promise<boolean> {
  const state = await session(context, false);
  if (state.identity !== before.identity || state.normalizedMode !== before.normalizedMode || !await privileges(context, target.database, state.mode, false)) throw Error('DDL已完成，但服务器身份或目录可见性未能保持，不能证明数据库已消失');
  return (await schema(context, target.database)).length === 0;
}
