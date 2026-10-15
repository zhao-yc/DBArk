import { createHash } from 'node:crypto';
import { readStructureDefinition, assertStructureDefinitionUnchanged, structureTaskQuery, structureDocumentOf, type StructureDefinitionRead, type StructureTaskContext } from './structureDefinition';
import { readTableCommentDefinition } from './tableCommentSql';
import { tableColumnDefaultRisks, tableColumnDefaultRiskMessage, hasUnprovenBinaryDefault } from '../shared/tableColumnPatches';
import { tableCommentLimits, type TableCommentBudget, type TableCommentTarget } from '../shared/tableComment';

export interface TableCommentRead extends StructureDefinitionRead {
  comment: string; engine: string; rowFormat: string; autoIncrement: string | null; tableId?: string;
  reasons: string[]; budget?: TableCommentBudget; preserved: string; bytes: number;
}
const literal = (value: string) => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
/** 独立结构会话显示完整GIPK，并保持FK/唯一检查打开，不修改查询标签或全局。 */
async function prepare(context: StructureTaskContext): Promise<void> {
  await structureTaskQuery(context, 'SET SESSION foreign_key_checks = 1, unique_checks = 1');
  const rows = (await structureTaskQuery<{ fk: number | string; uq: number | string }[]>(context, 'SELECT @@SESSION.foreign_key_checks AS fk, @@SESSION.unique_checks AS uq')).rows;
  if (rows.length !== 1 || ![1, '1'].includes(rows[0].fk) || ![1, '1'].includes(rows[0].uq)) throw new Error('无法确认结构会话检查状态');
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(context.managed.status.version);
  if (context.managed.status.dialect === 'mysql' && version && (Number(version[1]) > 8 || Number(version[1]) === 8 && (Number(version[2]) > 0 || Number(version[3]) >= 30))) {
    await structureTaskQuery(context, 'SET SESSION show_gipk_in_create_table_and_information_schema = ON');
    const show = (await structureTaskQuery<{ show: number | string }[]>(context, 'SELECT @@SESSION.show_gipk_in_create_table_and_information_schema AS `show`')).rows;
    if (show.length !== 1 || ![1, '1'].includes(show[0].show)) throw new Error('无法确认完整生成主键显示');
  }
}
/** 原生TABLE_ID门槛沿用记录定位的已证明范围；原定义摘要绝不充当物理表身份。 */
export async function readTableComment(context: StructureTaskContext, target: TableCommentTarget): Promise<TableCommentRead> {
  await prepare(context); const read = await readStructureDefinition(context, target, true), parsed = readTableCommentDefinition(read.source, read.context);
  const db = literal(target.database), table = literal(target.table), where = `CAST(TABLE_SCHEMA AS BINARY)=CAST(${db} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${table} AS BINARY)`;
  const rows = (await structureTaskQuery<{ kind: string; engine: string; rowFormat: string; comment: string; autoIncrement: string | null }[]>(context, `SELECT TABLE_TYPE AS kind, ENGINE AS engine, ROW_FORMAT AS rowFormat, TABLE_COMMENT AS comment, CAST(AUTO_INCREMENT AS CHAR) AS autoIncrement FROM information_schema.TABLES WHERE ${where} LIMIT 2`)).rows;
  const row = rows[0];
  if (rows.length !== 1 || row.kind !== 'BASE TABLE' || typeof row.engine !== 'string' || typeof row.rowFormat !== 'string' || typeof row.comment !== 'string' || !(row.autoIncrement === null || typeof row.autoIncrement === 'string' && /^[0-9]+$/.test(row.autoIncrement))) throw new Error('无法唯一读取基本表属性及精确自增计数');
  const reasons = [...parsed.reasons];
  if (parsed.comment !== row.comment) reasons.push('SHOW CREATE表注释与目录不一致，不能证明文字往返保真');
  const document = structureDocumentOf(read), risks = tableColumnDefaultRisks(document);
  if (risks.length) reasons.push(tableColumnDefaultRiskMessage(risks));
  if (document.columns.some(hasUnprovenBinaryDefault)) reasons.push('二进制文字默认值的原始字节无法完整核验，当前只读');
  const version = read.serverVersion.replace(/^5\.5\.5-/, ''), mysql = read.context.dialect === 'mysql';
  const catalogue = mysql && /^8\.(0|4)\./.test(version) ? 'INNODB_TABLES' : mysql && /^5\.7\./.test(version) || !mysql && /^(10\.11|11\.4)\./.test(version) ? 'INNODB_SYS_TABLES' : undefined;
  let tableId: string | undefined, budget: TableCommentBudget | undefined;
  if (!catalogue || row.engine !== 'InnoDB' || !/^[A-Za-z0-9_]+$/.test(target.database) || !/^[A-Za-z0-9_]+$/.test(target.table)) reasons.push('首批仅支持已证明版本的ASCII命名InnoDB表，其他目标只读');
  else {
    try {
      const facts = (await structureTaskQuery<{ os: string; lowerNames: number | string }[]>(context, 'SELECT @@version_compile_os AS os, @@lower_case_table_names AS lowerNames')).rows;
      if (facts.length !== 1 || !['linux', 'debian-linux-gnu'].includes(String(facts[0].os).toLowerCase()) || ![0, '0'].includes(facts[0].lowerNames)) throw new Error('服务器名称映射不能证明物理表身份');
      const partitions = (await structureTaskQuery<{ name: string | null }[]>(context, `SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS WHERE ${where} LIMIT 2`)).rows;
      if (partitions.length !== 1 || partitions[0].name !== null) throw new Error('分区表暂不开放普通注释修改');
      const identities = (await structureTaskQuery<{ id: string; name: string }[]>(context, `SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name FROM information_schema.${catalogue} WHERE CAST(NAME AS BINARY)=CAST(${literal(target.database + '/' + target.table)} AS BINARY) LIMIT 2`)).rows;
      if (identities.length !== 1 || typeof identities[0].id !== 'string' || !/^[1-9]\d{0,19}$/.test(identities[0].id) || identities[0].name !== target.database + '/' + target.table) throw new Error('无法唯一证明InnoDB物理表身份');
      tableId = identities[0].id;
    } catch (error) { context.checkCancelled(); reasons.push(error instanceof Error ? error.message : '物理表身份目录不可用'); }
  }
  try {
    const columns = (await structureTaskQuery<{ charset: string; characters: string | number; bytes: string | number; maxlen: string | number }[]>(context, "SELECT c.CHARACTER_SET_NAME AS charset, c.CHARACTER_MAXIMUM_LENGTH AS characters, c.CHARACTER_OCTET_LENGTH AS bytes, s.MAXLEN AS maxlen FROM information_schema.COLUMNS c JOIN information_schema.CHARACTER_SETS s ON s.CHARACTER_SET_NAME=c.CHARACTER_SET_NAME WHERE c.TABLE_SCHEMA='information_schema' AND c.TABLE_NAME='TABLES' AND c.COLUMN_NAME='TABLE_COMMENT' LIMIT 2")).rows;
    const column = columns[0];
    if (columns.length !== 1 || !['utf8', 'utf8mb3', 'utf8mb4'].includes(column.charset) || ![3, 4, '3', '4'].includes(column.maxlen) || !/^\d+$/.test(String(column.characters)) || !/^\d+$/.test(String(column.bytes)) || Number(column.characters) < 1 || Number(column.bytes) < 1) throw new Error('注释目录字符编码或长度能力未知');
    budget = { characters: Math.min(tableCommentLimits.characters, Number(column.characters)), utf8Bytes: Math.min(tableCommentLimits.utf8Bytes, Number(column.bytes)), supplementary: column.charset === 'utf8mb4' && Number(column.maxlen) === 4, metadataCharset: column.charset };
  } catch (error) { context.checkCancelled(); reasons.push(error instanceof Error ? error.message : '注释编码目录不可用'); }
  return { ...read, ...parsed, comment: row.comment, engine: row.engine, rowFormat: row.rowFormat, autoIncrement: row.autoIncrement, tableId, reasons, budget, bytes: Buffer.byteLength(read.source) * 3 + 32768 };
}
/** 服务器、模式、完整原定义、目录属性和原生表编号共同绑定预览。 */
export function assertTableCommentUnchanged(before: TableCommentRead, after: TableCommentRead): void {
  assertStructureDefinitionUnchanged(before, after);
  if (!before.tableId || before.tableId !== after.tableId || after.reasons.length || JSON.stringify([before.comment, before.engine, before.rowFormat, before.autoIncrement, before.budget]) !== JSON.stringify([after.comment, after.engine, after.rowFormat, after.autoIncrement, after.budget])) throw new Error('表身份、属性或可写能力已变化，请重新读取；未发送DDL');
}
/** 后核验只豁免顶层COMMENT；物理编号变化也保守标记为未完整核验。 */
export function verifyTableComment(before: TableCommentRead, after: TableCommentRead, expected: string): boolean {
  return !after.reasons.length && before.identity === after.identity && before.tableId === after.tableId && before.originalMode === after.originalMode && before.normalizedMode === after.normalizedMode && after.comment === expected && before.preserved === after.preserved && JSON.stringify([before.nullability, before.encodings, before.tableEncoding, before.engine, before.rowFormat, before.autoIncrement, before.budget]) === JSON.stringify([after.nullability, after.encodings, after.tableEncoding, after.engine, after.rowFormat, after.autoIncrement, after.budget]);
}
/** 哈希只对外标识定义，不替代原生表身份或完整原文复核。 */
export const tableCommentHash = (source: string): string => createHash('sha256').update(source).digest('hex');
