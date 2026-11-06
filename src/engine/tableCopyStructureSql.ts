import { readTableCopyStructureCounter, tableCopyStructureCounterDefinition } from './tableCopyStructureCounter';
import type { TableCopyStructureCounterPlan } from '../shared/tableCopyStructureCounter';
import type { TableAutoIncrementPolicy } from '../shared/tableAutoIncrement';
import { tableCopyStructureServerProfile, tableCopyStructureProfileText } from '../shared/tableCopyStructureProfiles';
import { createHash } from 'node:crypto';
import { qualified, stringLiteral } from './sql';
import { readTableRename, assertTableRenameUnchanged, proveRenamePrivileges, assertRenameDestinationAbsent } from './tableRenameRead';
import { renameDefinitionBody } from './tableRenameSql';
import { structureDocumentOf, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { readTableIndexDefinition } from './tableIndexDefinition';
import type { TableCommentRead } from './tableCommentRead';
import { readTableCopyGenerated, type TableCopyGeneratedPlan } from './tableCopyStructureGenerated';
import { tableCopyGeneratedText } from '../shared/tableCopyStructureGenerated';
import { validateTableCopyDatabase, validateTableCopyStructureName, type TableCopyStructureTarget } from '../shared/tableCopyStructure';
export interface TableCopyStructureRead extends TableCommentRead { serverInstance: string; capability: string; serverProfileId: string; autoIncrementPlan?: TableCopyStructureCounterPlan; autoIncrementPolicy?: TableAutoIncrementPolicy; generatedPlan?: TableCopyGeneratedPlan; }

/** 同一连接内分别引用来源和目标，只有同库时要求换名。 */
export function planTableCopyStructure(target: TableCopyStructureTarget, value: unknown, database = target.database): { sql: string; newName: string } {
  validateTableCopyDatabase(target.database); validateTableCopyDatabase(database);
  if (!/^[A-Za-z0-9_]{1,64}$/.test(target.table)) throw Error('复制结构只支持ASCII普通表名称');
  if (database !== target.database && database.toLowerCase() === target.database.toLowerCase()) throw Error('来源和目标库不能仅大小写不同');
  const newName = validateTableCopyStructureName(value);
  if (database === target.database && newName.toLowerCase() === target.table.toLowerCase()) throw Error('新名称不能与源表相同或仅大小写不同');
  return { sql: `CREATE TABLE ${qualified(database, newName)} LIKE ${qualified(target.database, target.table)};`, newName };
}

/** 跨库时要求目标真实存在，并将目录选项绑定预览。表名占用仍由元数据和 CREATE 双重检查。 */
export async function readTableCopyDestination(context: StructureTaskContext, source: TableCopyStructureTarget, destination: TableCopyStructureTarget): Promise<string | undefined> {
  let stamp: string | undefined;
  if (source.database !== destination.database) {
    const name = stringLiteral(validateTableCopyDatabase(destination.database));
    const mysql = context.managed.status.dialect === 'mysql';
    const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, `SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation${mysql ? ', DEFAULT_ENCRYPTION AS encryption' : ''} FROM information_schema.SCHEMATA WHERE CAST(SCHEMA_NAME AS BINARY)=CAST(${name} AS BINARY) LIMIT 2`)).rows;
    if (rows.length !== 1 || rows[0].name !== destination.database || typeof rows[0].charset !== 'string' || typeof rows[0].collation !== 'string' || mysql && !['YES', 'NO'].includes(String(rows[0].encryption))) throw Error('目标数据库不存在或目录选项无法核对，未发送DDL');
    stamp = JSON.stringify(rows[0]);
  }
  await assertRenameDestinationAbsent(context, destination, destination.table);
  return stamp;
}
/** MariaDB 不提供 MySQL 的 GIPK 或部分撤销变量，核对本方言自己的写入保护和复制策略。 */
async function readCopyCapability(context: StructureTaskContext, maria: boolean): Promise<string> {
  if (maria) {
    const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, `SELECT
      CAST(@@SESSION.autocommit AS CHAR) AS autocommit, CAST(@@SESSION.innodb_strict_mode AS CHAR) AS strictMode,
      CAST(@@GLOBAL.read_only AS CHAR) AS readOnly, CAST(@@GLOBAL.innodb_read_only AS CHAR) AS innodbReadOnly,
      CAST(@@GLOBAL.innodb_force_recovery AS CHAR) AS recovery, CAST(@@GLOBAL.wsrep_on AS CHAR) AS globalWsrep,
      CAST(@@SESSION.wsrep_on AS CHAR) AS sessionWsrep`)).rows;
    const row = rows[0], off = (value: unknown) => value === '0' || value === 'OFF', on = (value: unknown) => value === '1' || value === 'ON';
    if (rows.length !== 1 || !on(row.autocommit) || !on(row.strictMode) || ![row.readOnly, row.innodbReadOnly, row.recovery, row.globalWsrep, row.sessionWsrep].every(off))
      throw Error('MariaDB 自动提交、严格模式、只读、恢复或 Galera 状态不在已核范围');
    return JSON.stringify(row);
  }
  const facts = (await structureTaskQuery<{ gipk: number | string; autocommit: number | string; partialRevokes: number | string }[]>(context, 'SELECT @@SESSION.sql_generate_invisible_primary_key AS gipk, @@SESSION.autocommit AS autocommit, @@GLOBAL.partial_revokes AS partialRevokes')).rows;
  if (facts.length !== 1 || ![0, '0'].includes(facts[0].gipk) || ![1, '1'].includes(facts[0].autocommit) || ![0, '0'].includes(facts[0].partialRevokes)) throw Error('GIPK、自动提交或部分撤销能力不在已证明范围');
  return JSON.stringify(facts[0]);
}
/** 显式全局读取可见性与CREATE；首片不展开角色、部分撤销、通配库授权，也不会请求扩权。 */
function copyPrivileges(grants: string[], target: TableCopyStructureTarget, read: TableCommentRead): boolean {
  if (!proveRenamePrivileges(grants, target, read.context, undefined, 'verify')) return false;
  return grants.some(grant => {
    const tokens = tableDefinitionTokens(grant, read.context), word = (i: number) => tokens[i]?.kind === 'word' ? tokens[i].value.toUpperCase() : '';
    const on = tokens.findIndex((_, i) => word(i) === 'ON');
    if (word(0) !== 'GRANT' || on < 0 || tokens[on + 1]?.value !== '*' || tokens[on + 2]?.value !== '.' || tokens[on + 3]?.value !== '*' || word(on + 4) !== 'TO') return false;
    const parts = grant.slice(tokens[1].start, tokens[on].start).toUpperCase().split(',').map(value => value.trim());
    return parts.some(value => ['ALL', 'ALL PRIVILEGES', 'CREATE'].includes(value));
  });
}
/** 复用已证明的物理表和完整依赖读取，独立核UUID/能力；不借重命名的ALTER/DROP权限。 */
export async function readTableCopyStructure(context: StructureTaskContext, target: TableCopyStructureTarget): Promise<TableCopyStructureRead> {
  const profile = tableCopyStructureServerProfile(context.managed.status.dialect, context.managed.status.version);
  let read = await readTableRename(context, target, undefined, 'verify');
  const additional: string[] = []; let autoIncrementPlan: TableCopyStructureCounterPlan | undefined, autoIncrementPolicy: TableAutoIncrementPolicy | undefined;
  if (profile.canWrite && profile.expectedNewCounter !== null && (read.autoIncrement !== null || structureDocumentOf(read).columns.some(column => column.attributes.some(attribute => attribute.kind === 'auto-increment')))) {
    try { const fresh = await readTableCopyStructureCounter(context, target, read); read = fresh.read; autoIncrementPlan = fresh.plan; autoIncrementPolicy = fresh.policy; }
    catch (reason) { context.checkCancelled(); additional.push(reason instanceof Error ? reason.message : '准确自增计数能力未知，当前只读'); }
  }
  const reasons = [...read.reasons, ...additional], document = structureDocumentOf(read);
  let generatedPlan: TableCopyGeneratedPlan | undefined;
  try { generatedPlan = await readTableCopyGenerated(context, target, read); } catch (reason) { context.checkCancelled(); reasons.push(reason instanceof Error ? reason.message : tableCopyGeneratedText.catalog); }
  if (!profile.canWrite) reasons.push(profile.readonlyReason);
  try { planTableCopyStructure(target, target.table === 'dbark_copy_probe' ? 'dbark_copy_probe_2' : 'dbark_copy_probe'); } catch (reason) { reasons.push((reason as Error).message); }
  if (read.engine !== 'InnoDB' || !read.tableId || /\bTEMPORARY\b/i.test(document.head.raw) || document.columns.some(column => !column.access.type.editable && !generatedPlan?.columns.some(generated => generated.name === column.name))) reasons.push(tableCopyGeneratedText.unproven);
  if (read.originalMode !== read.normalizedMode) reasons.push('原SQL模式隐藏定义属性，复制结构首片只读');
  if (!autoIncrementPlan && (read.autoIncrement !== null || document.columns.some(column => column.attributes.some(attribute => attribute.kind === 'auto-increment')))) reasons.push('唯一自增列或准确计数能力未证明，当前只读');
  const indexes = readTableIndexDefinition(document);
  if (indexes.otherConstraintRanges.length || indexes.indexes.some(index => !['primary', 'ordinary', 'unique'].includes(index.kind) || index.method !== undefined && index.method !== 'BTREE' || index.opaqueReasons.length || index.parts.some(part => part.opaqueReasons.length))) reasons.push('CHECK、外键、特殊/表达式或不透明索引不在首片范围');
  const forbidden = new Set(['INVISIBLE', 'TABLESPACE', 'DATA', 'DIRECTORY', 'INDEX', 'KEY_BLOCK_SIZE', 'STATS_PERSISTENT', 'STATS_AUTO_RECALC', 'STATS_SAMPLE_PAGES', 'PACK_KEYS', 'CHECKSUM', 'DELAY_KEY_WRITE', 'COMPRESSION', 'ENCRYPTION', 'AUTOEXTEND_SIZE']);
  if (tableDefinitionTokens(document.tail.raw, read.context).some(token => token.kind === 'executable' || token.kind === 'word' && forbidden.has(token.value.toUpperCase())) || document.columns.some(column => tableDefinitionTokens(column.raw, read.context).some(token => token.kind === 'word' && token.value.toUpperCase() === 'INVISIBLE'))) reasons.push('隐藏字段或尚未证明的物理表选项不能复制');
  let serverInstance = '', capability = '';
  // 版本合同之外仍逐次核对目录、方言实例标识和会话能力。
  if (profile.canReadFacts) try {
    const maria = profile.id === 'mariadb-11.4.13-like-v1';
    const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode, @@hostname AS hostname, @@port AS port, @@server_id AS serverId, CURRENT_USER() AS currentUser, CONNECTION_ID() AS connectionId, @@character_set_connection AS characterSetConnection, @@collation_connection AS collationConnection, @@sql_quote_show_create AS quoteShowCreate')).rows;
    const ids = (await structureTaskQuery<{ uuid: string }[]>(context, maria ? 'SELECT @@server_uid AS uuid' : 'SELECT @@server_uuid AS uuid')).rows, row = rows[0];
    serverInstance = ids[0]?.uuid ?? '';
    const idPattern = maria ? /^[A-Za-z0-9+/]{27}=$/ : /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    if (rows.length !== 1 || ids.length !== 1 || typeof serverInstance !== 'string' || !idPattern.test(serverInstance) || Number(row.connectionId) !== context.managed.connection.threadId || row.sqlMode !== read.normalizedMode || row.characterSetConnection !== 'utf8mb4' || row.collationConnection !== 'utf8mb4_bin' || ![1, '1'].includes(row.quoteShowCreate as number)) throw Error('复制结构的服务器实例标识或完整会话能力未知');
    const identity = createHash('sha256').update(JSON.stringify({ hostname: row.hostname, port: row.port, serverId: row.serverId, currentUser: row.currentUser, uuid: maria ? undefined : serverInstance, dialect: context.managed.status.dialect, version: context.managed.status.version })).digest('hex');
    if (identity !== read.identity) throw Error('复制结构读取期间服务器身份变化');
    const rowsGrants = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SHOW GRANTS')).rows;
    if (!Array.isArray(rowsGrants) || rowsGrants.length > 256 || rowsGrants.some(value => Object.values(value).length !== 1 || typeof Object.values(value)[0] !== 'string')) throw Error('复制结构的目录权限未知');
    const grants = rowsGrants.map(value => Object.values(value)[0] as string);
    if (Buffer.byteLength(JSON.stringify(grants)) > 512 * 1024 || !copyPrivileges(grants, target, read)) throw Error('首片须显式全局SELECT/SHOW VIEW/TRIGGER/CREATE；未知角色或授权只读，不自动扩权');
    capability = await readCopyCapability(context, maria);
  } catch (reason) { context.checkCancelled(); reasons.push(reason instanceof Error ? reason.message : '复制能力未知'); }
  return { ...read, bytes: read.bytes + (generatedPlan?.bytes ?? 0), reasons: [...new Set(reasons)], serverInstance, capability, serverProfileId: profile.id, ...(autoIncrementPlan ? { autoIncrementPlan, autoIncrementPolicy } : {}), ...(generatedPlan ? { generatedPlan } : {}) };
}
/** 同名重建、UUID、完整定义、依赖或能力变化均拒绝；摘要不替代原生表编号。 */
export function assertTableCopyStructureUnchanged(before: TableCopyStructureRead, after: TableCopyStructureRead): void {
  if (before.serverProfileId !== after.serverProfileId) throw Error(tableCopyStructureProfileText.changed);
  assertTableRenameUnchanged(before, after);
  if (JSON.stringify([before.autoIncrementPlan, before.autoIncrementPolicy]) !== JSON.stringify([after.autoIncrementPlan, after.autoIncrementPolicy])) throw Error('自增列、源计数或运行策略变化，未发送DDL');
  if (JSON.stringify(before.generatedPlan ?? null) !== JSON.stringify(after.generatedPlan ?? null)) throw Error(tableCopyGeneratedText.changed);
  if (!before.serverInstance || before.serverInstance !== after.serverInstance || !before.capability || before.capability !== after.capability) throw Error('复制结构服务器实例标识或能力变化，未发送DDL');
}
/** 来源含计数均不变；新表只分离已证明的顶层计数，列及其它定义逐字保留，准确新计数由调用方另核。 */
export function verifyTableCopyStructureStructure(before: TableCopyStructureRead, source: TableCopyStructureRead, after: TableCopyStructureRead, empty: boolean): boolean {
  try { assertTableCopyStructureUnchanged(before, source); } catch { return false; }
  const definitionMatches = before.autoIncrementPlan ? !!after.autoIncrementPlan && tableCopyStructureCounterDefinition(before.source, before.context).comparison === tableCopyStructureCounterDefinition(after.source, after.context).comparison && JSON.stringify(before.autoIncrementPlan.column) === JSON.stringify(after.autoIncrementPlan.column) && JSON.stringify(before.autoIncrementPolicy) === JSON.stringify(after.autoIncrementPolicy) : renameDefinitionBody(before) === renameDefinitionBody(after) && before.autoIncrement === after.autoIncrement;
  return empty && !after.reasons.length && !!after.tableId && before.tableId !== after.tableId && before.serverInstance === after.serverInstance && before.identity === after.identity && before.capability === after.capability && before.normalizedMode === after.originalMode && before.normalizedMode === after.normalizedMode
    && definitionMatches && JSON.stringify(before.generatedPlan ?? null) === JSON.stringify(after.generatedPlan ?? null) && JSON.stringify([before.nullability, before.encodings, before.tableEncoding, before.engine, before.rowFormat, before.comment]) === JSON.stringify([after.nullability, after.encodings, after.tableEncoding, after.engine, after.rowFormat, after.comment]);
}
