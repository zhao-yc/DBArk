import { createHash } from 'node:crypto';
import { qualified } from './sql';
import { readTableRename, assertTableRenameUnchanged, proveRenamePrivileges } from './tableRenameRead';
import { structureDocumentOf, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import type { TableCommentRead } from './tableCommentRead';
import { tableDropConfirmation, type TableDropTarget } from '../shared/tableDrop';

export interface TableDropRead extends TableCommentRead { serverUuid: string; }
const literal = (value: string) => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
/** 仅生成一张已绑定表的DROP；不接受IF EXISTS、TEMPORARY、CASCADE、多目标或任意SQL。 */
export function planTableDrop(target: TableDropTarget): string {
  if (['mysql', 'sys', 'information_schema', 'performance_schema'].includes(target.database.toLowerCase()) || !/^[A-Za-z0-9_]{1,64}$/.test(target.database) || !/^[A-Za-z0-9_]{1,64}$/.test(target.table)) throw new Error('删除首片只支持非系统库的ASCII普通表名称；其它目标只读');
  return `DROP TABLE ${qualified(target.database, target.table)};`;
}
/** 后核不再读取已删除表的SHOW CREATE，独立重新核对服务器UUID、账户与模式，防止空目录来自另一服务器。 */
async function serverIdentity(context: StructureTaskContext): Promise<{ identity: string; uuid: string; mode: string }> {
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode, @@hostname AS hostname, @@port AS port, @@server_id AS serverId, CURRENT_USER() AS currentUser, CONNECTION_ID() AS connectionId, @@character_set_connection AS characterSetConnection, @@collation_connection AS collationConnection, @@sql_quote_show_create AS quoteShowCreate')).rows;
  const uuids = (await structureTaskQuery<{ uuid: string }[]>(context, 'SELECT @@server_uuid AS uuid')).rows;
  const row = rows[0], uuid = uuids[0]?.uuid;
  if (rows.length !== 1 || uuids.length !== 1 || !row || Number(row.connectionId) !== context.managed.connection.threadId || typeof row.sqlMode !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(uuid ?? '') || typeof row.hostname !== 'string' || !row.hostname || typeof row.currentUser !== 'string' || !row.currentUser || !Number.isInteger(Number(row.port)) || Number(row.port) < 1 || Number(row.port) > 65535 || !Number.isSafeInteger(Number(row.serverId)) || Number(row.serverId) < 0 || row.characterSetConnection !== 'utf8mb4' || row.collationConnection !== 'utf8mb4_bin' || Number(row.quoteShowCreate) !== 1) throw new Error('删除操作无法完整证明服务器UUID、会话身份与模式');
  const identity = createHash('sha256').update(JSON.stringify({ hostname: row.hostname, port: row.port, serverId: row.serverId, currentUser: row.currentUser, uuid, dialect: context.managed.status.dialect, version: context.managed.status.version })).digest('hex');
  return { identity, uuid, mode: row.sqlMode };
}
/** 原目录读取保守复用已证明的ALTER/DROP及全局目录可见性；角色、撤销或其它未知权限不扩权。 */
export async function readTableDrop(context: StructureTaskContext, target: TableDropTarget): Promise<TableDropRead> {
  const read = await readTableRename(context, target), reasons = [...read.reasons];
  try { planTableDrop(target); } catch (error) { reasons.push((error as Error).message); }
  if (read.context.dialect !== 'mysql' || !/^8\.4\.11(?:[-+].*)?$/.test(read.serverVersion)) reasons.push('删除首片仅开放MySQL 8.4.11/Linux/lower_case_table_names=0；其他范围只读');
  const document = structureDocumentOf(read);
  if (read.engine !== 'InnoDB' || !read.tableId || /\bTEMPORARY\b/i.test(document.head.raw) || document.columns.some(column => column.access.type.editable !== true)) reasons.push('删除仅允许可证明物理身份的持久普通InnoDB表，生成或未知定义只读');
  let serverUuid = '';
  if (read.context.dialect === 'mysql') {
    try { const facts = await serverIdentity(context); serverUuid = facts.uuid; if (facts.identity !== read.identity || facts.mode !== read.normalizedMode) throw new Error('读取期间服务器身份或模式变化'); }
    catch (error) { context.checkCancelled(); reasons.push((error as Error).message); }
  }
  return { ...read, reasons, serverUuid };
}
/** 快照/预览/DDL前完整重核；同名重建、原生编号、UUID或定义变化都拒绝，不用摘要猜身份。 */
export function assertTableDropUnchanged(before: TableDropRead, after: TableDropRead): void {
  assertTableRenameUnchanged(before, after);
  if (!before.serverUuid || before.serverUuid !== after.serverUuid) throw new Error('服务器UUID变化或未知，未发送删除DDL');
}
/** 确认文字只作精确等值检查，绝不从用户输入反向构造DDL目标。 */
export function assertTableDropConfirmation(target: TableDropTarget, confirmation: string): void {
  if (confirmation !== tableDropConfirmation(target)) throw new Error('确认文字必须与预览的准确库名.表名完全一致');
}
/** DROP成功后仍须证明完整目录可见；权限丢失导致的空集合不能算表已删除。 */
async function visibleAfterDrop(context: StructureTaskContext, target: TableDropTarget, before: TableDropRead): Promise<boolean> {
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SHOW GRANTS')).rows;
  if (!Array.isArray(rows) || rows.length > 256) return false;
  const grants: string[] = []; let bytes = 0;
  for (const row of rows) {
    const values = Object.values(row); if (values.length !== 1 || typeof values[0] !== 'string') return false;
    bytes += Buffer.byteLength(values[0]); if (bytes > 512 * 1024) return false; grants.push(values[0]);
  }
  try { return proveRenamePrivileges(grants, target, before.context, undefined, 'verify'); } catch { return false; }
}
/** 名称和原TABLE_ID均消失才算已核验；同名新表或原表被并发改名都不能误报成功。 */
export async function verifyTableDrop(context: StructureTaskContext, target: TableDropTarget, before: TableDropRead): Promise<{ targetAbsent: boolean; physicalTableAbsent: boolean }> {
  const facts = await serverIdentity(context);
  if (facts.uuid !== before.serverUuid || facts.identity !== before.identity || facts.mode !== before.normalizedMode || !await visibleAfterDrop(context, target, before)) throw new Error('删除后服务器身份、模式或完整目录可见性未确认');
  if (!before.tableId || !/^[1-9][0-9]{0,19}$/.test(before.tableId)) throw new Error('缺少原物理表编号');
  const names = (await structureTaskQuery<unknown[]>(context, `SELECT TABLE_NAME FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY) LIMIT 2`)).rows;
  const physical = (await structureTaskQuery<unknown[]>(context, `SELECT CAST(TABLE_ID AS CHAR) AS id FROM information_schema.INNODB_TABLES WHERE TABLE_ID=${before.tableId} OR CAST(NAME AS BINARY)=CAST(${literal(target.database + '/' + target.table)} AS BINARY) LIMIT 2`)).rows;
  if (!Array.isArray(names) || !Array.isArray(physical)) throw new Error('删除后目录响应未知');
  const final = await serverIdentity(context);
  if (final.uuid !== facts.uuid || final.identity !== facts.identity || final.mode !== facts.mode) throw new Error('删除后目录观察期间服务器身份或模式变化');
  return { targetAbsent: names.length === 0, physicalTableAbsent: physical.length === 0 };
}
