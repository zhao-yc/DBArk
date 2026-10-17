import { readTableCopyStructureCounter, tableCopyStructureCounterDefinition } from './tableCopyStructureCounter';
import type { TableCopyStructureCounterPlan } from '../shared/tableCopyStructureCounter';
import type { TableAutoIncrementPolicy } from '../shared/tableAutoIncrement';
import { createHash } from 'node:crypto';
import { qualified } from './sql';
import { readTableRename, assertTableRenameUnchanged, proveRenamePrivileges } from './tableRenameRead';
import { renameDefinitionBody } from './tableRenameSql';
import { structureDocumentOf, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { readTableIndexDefinition } from './tableIndexDefinition';
import type { TableCommentRead } from './tableCommentRead';
import { validateTableCopyStructureName, type TableCopyStructureTarget } from '../shared/tableCopyStructure';
export interface TableCopyStructureRead extends TableCommentRead { serverUuid: string; capability: string; autoIncrementPlan?: TableCopyStructureCounterPlan; autoIncrementPolicy?: TableAutoIncrementPolicy; }

/** 只生成一条同库CREATE LIKE；不含IF NOT EXISTS、替换、复制数据或客户端SQL。 */
export function planTableCopyStructure(target: TableCopyStructureTarget, value: unknown): { sql: string; newName: string } {
  if (['mysql', 'sys', 'information_schema', 'performance_schema'].includes(target.database.toLowerCase()) || !/^[A-Za-z0-9_]{1,64}$/.test(target.database) || !/^[A-Za-z0-9_]{1,64}$/.test(target.table)) throw Error('复制结构首片只支持非系统库的ASCII普通表名称');
  const newName = validateTableCopyStructureName(value); if (newName.toLowerCase() === target.table.toLowerCase()) throw Error('新名称不能与源表相同或仅大小写不同');
  return { sql: `CREATE TABLE ${qualified(target.database, newName)} LIKE ${qualified(target.database, target.table)};`, newName };
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
  let read = await readTableRename(context, target, undefined, 'verify');
  const additional: string[] = []; let autoIncrementPlan: TableCopyStructureCounterPlan | undefined, autoIncrementPolicy: TableAutoIncrementPolicy | undefined;
  if (read.context.dialect === 'mysql' && /^8\.4\.11(?:[-+].*)?$/.test(read.serverVersion) && (read.autoIncrement !== null || structureDocumentOf(read).columns.some(column => column.attributes.some(attribute => attribute.kind === 'auto-increment')))) {
    try { const fresh = await readTableCopyStructureCounter(context, target, read); read = fresh.read; autoIncrementPlan = fresh.plan; autoIncrementPolicy = fresh.policy; }
    catch (reason) { context.checkCancelled(); additional.push(reason instanceof Error ? reason.message : '准确自增计数能力未知，当前只读'); }
  }
  const reasons = [...read.reasons, ...additional], document = structureDocumentOf(read);
  const supported = read.context.dialect === 'mysql' && /^8\.4\.11(?:[-+].*)?$/.test(read.serverVersion);
  if (!supported) reasons.push('复制结构首片仅支持MySQL8.4.11/Linux/ASCII非分区InnoDB表，其它范围只读');
  try { planTableCopyStructure(target, target.table === 'dbark_copy_probe' ? 'dbark_copy_probe_2' : 'dbark_copy_probe'); } catch (reason) { reasons.push((reason as Error).message); }
  if (read.engine !== 'InnoDB' || !read.tableId || /\bTEMPORARY\b/i.test(document.head.raw) || document.columns.some(column => !column.access.type.editable)) reasons.push('生成、临时或未知字段/物理身份不在复制结构首片范围');
  if (read.originalMode !== read.normalizedMode) reasons.push('原SQL模式隐藏定义属性，复制结构首片只读');
  if (!autoIncrementPlan && (read.autoIncrement !== null || document.columns.some(column => column.attributes.some(attribute => attribute.kind === 'auto-increment')))) reasons.push('唯一自增列或准确计数能力未证明，当前只读');
  const indexes = readTableIndexDefinition(document);
  if (indexes.otherConstraintRanges.length || indexes.indexes.some(index => !['primary', 'ordinary', 'unique'].includes(index.kind) || index.method !== undefined && index.method !== 'BTREE' || index.opaqueReasons.length || index.parts.some(part => part.opaqueReasons.length))) reasons.push('CHECK、外键、特殊/表达式或不透明索引不在首片范围');
  const forbidden = new Set(['INVISIBLE', 'TABLESPACE', 'DATA', 'DIRECTORY', 'INDEX', 'KEY_BLOCK_SIZE', 'STATS_PERSISTENT', 'STATS_AUTO_RECALC', 'STATS_SAMPLE_PAGES', 'PACK_KEYS', 'CHECKSUM', 'DELAY_KEY_WRITE', 'COMPRESSION', 'ENCRYPTION', 'AUTOEXTEND_SIZE']);
  if (tableDefinitionTokens(document.tail.raw, read.context).some(token => token.kind === 'executable' || token.kind === 'word' && forbidden.has(token.value.toUpperCase())) || document.columns.some(column => tableDefinitionTokens(column.raw, read.context).some(token => token.kind === 'word' && token.value.toUpperCase() === 'INVISIBLE'))) reasons.push('隐藏字段或尚未证明的物理表选项不能复制');
  let serverUuid = '', capability = '';
  if (supported) try {
    const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode, @@hostname AS hostname, @@port AS port, @@server_id AS serverId, CURRENT_USER() AS currentUser, CONNECTION_ID() AS connectionId, @@character_set_connection AS characterSetConnection, @@collation_connection AS collationConnection, @@sql_quote_show_create AS quoteShowCreate')).rows;
    const ids = (await structureTaskQuery<{ uuid: string }[]>(context, 'SELECT @@server_uuid AS uuid')).rows, row = rows[0];
    serverUuid = ids[0]?.uuid;
    if (rows.length !== 1 || ids.length !== 1 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(serverUuid ?? '') || Number(row.connectionId) !== context.managed.connection.threadId || row.sqlMode !== read.normalizedMode || row.characterSetConnection !== 'utf8mb4' || row.collationConnection !== 'utf8mb4_bin' || ![1, '1'].includes(row.quoteShowCreate as number)) throw Error('复制结构的服务器UUID或完整会话能力未知');
    const identity = createHash('sha256').update(JSON.stringify({ hostname: row.hostname, port: row.port, serverId: row.serverId, currentUser: row.currentUser, uuid: serverUuid, dialect: context.managed.status.dialect, version: context.managed.status.version })).digest('hex');
    if (identity !== read.identity) throw Error('复制结构读取期间服务器身份变化');
    const facts = (await structureTaskQuery<{ gipk: number | string; autocommit: number | string; partialRevokes: number | string }[]>(context, 'SELECT @@SESSION.sql_generate_invisible_primary_key AS gipk, @@SESSION.autocommit AS autocommit, @@GLOBAL.partial_revokes AS partialRevokes')).rows;
    if (facts.length !== 1 || ![0, '0'].includes(facts[0].gipk) || ![1, '1'].includes(facts[0].autocommit) || ![0, '0'].includes(facts[0].partialRevokes)) throw Error('GIPK、自动提交或部分撤销能力不在已证明范围');
    const rowsGrants = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SHOW GRANTS')).rows;
    if (!Array.isArray(rowsGrants) || rowsGrants.length > 256 || rowsGrants.some(value => Object.values(value).length !== 1 || typeof Object.values(value)[0] !== 'string')) throw Error('复制结构的目录权限未知');
    const grants = rowsGrants.map(value => Object.values(value)[0] as string);
    if (Buffer.byteLength(JSON.stringify(grants)) > 512 * 1024 || !copyPrivileges(grants, target, read)) throw Error('首片须显式全局SELECT/SHOW VIEW/TRIGGER/CREATE；未知角色或授权只读，不自动扩权');
    capability = JSON.stringify(facts[0]);
  } catch (reason) { context.checkCancelled(); reasons.push(reason instanceof Error ? reason.message : '复制能力未知'); }
  return { ...read, reasons: [...new Set(reasons)], serverUuid: serverUuid ?? '', capability, ...(autoIncrementPlan ? { autoIncrementPlan, autoIncrementPolicy } : {}) };
}
/** 同名重建、UUID、完整定义、依赖或能力变化均拒绝；摘要不替代原生表编号。 */
export function assertTableCopyStructureUnchanged(before: TableCopyStructureRead, after: TableCopyStructureRead): void {
  assertTableRenameUnchanged(before, after);
  if (JSON.stringify([before.autoIncrementPlan, before.autoIncrementPolicy]) !== JSON.stringify([after.autoIncrementPlan, after.autoIncrementPolicy])) throw Error('自增列、源计数或运行策略变化，未发送DDL');
  if (!before.serverUuid || before.serverUuid !== after.serverUuid || !before.capability || before.capability !== after.capability) throw Error('复制结构UUID或服务器能力变化，未发送DDL');
}
/** 来源含计数均不变；新表只分离已证明的顶层计数，列及其它定义逐字保留，准确新计数由调用方另核。 */
export function verifyTableCopyStructureStructure(before: TableCopyStructureRead, source: TableCopyStructureRead, after: TableCopyStructureRead, empty: boolean): boolean {
  try { assertTableCopyStructureUnchanged(before, source); } catch { return false; }
  const definitionMatches = before.autoIncrementPlan ? !!after.autoIncrementPlan && tableCopyStructureCounterDefinition(before.source, before.context).comparison === tableCopyStructureCounterDefinition(after.source, after.context).comparison && JSON.stringify(before.autoIncrementPlan.column) === JSON.stringify(after.autoIncrementPlan.column) && JSON.stringify(before.autoIncrementPolicy) === JSON.stringify(after.autoIncrementPolicy) : renameDefinitionBody(before) === renameDefinitionBody(after) && before.autoIncrement === after.autoIncrement;
  return empty && !after.reasons.length && !!after.tableId && before.tableId !== after.tableId && before.serverUuid === after.serverUuid && before.identity === after.identity && before.capability === after.capability && before.normalizedMode === after.originalMode && before.normalizedMode === after.normalizedMode
    && definitionMatches && JSON.stringify([before.nullability, before.encodings, before.tableEncoding, before.engine, before.rowFormat, before.comment]) === JSON.stringify([after.nullability, after.encodings, after.tableEncoding, after.engine, after.rowFormat, after.comment]);
}
