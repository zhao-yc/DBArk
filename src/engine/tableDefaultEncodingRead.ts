import { createHash } from 'node:crypto';
import { readStructureDefinition, assertStructureDefinitionUnchanged, structureTaskQuery, structureDocumentOf, type StructureDefinitionRead, type StructureTaskContext } from './structureDefinition';
import { readTableDefaultEncodingDefinition, tableDefaultEncodingColumnReasons, onlyAddedColumnEncodingAttributes } from './tableDefaultEncodingSql';
import { readTableDefaultEncodingCatalog } from './tableDefaultEncodingCatalog';
import { readTableDefaultEncodingAlter } from './tableDefaultEncodingPrivileges';
import { tableColumnDefaultRisks, tableColumnDefaultRiskMessage, hasUnprovenBinaryDefault } from '../shared/tableColumnPatches';
import { tableCommentHasEngineOptions } from '../shared/tableComment';
import { sameTableEncodingPair, type TableEncodingPair, type TableDefaultEncodingTarget } from '../shared/tableDefaultEncoding';

export interface TableDefaultEncodingRead extends StructureDefinitionRead {
  engine: string; rowFormat: string; autoIncrement: string | null; comment: string; tableId?: string;
  reasons: string[]; warnings: string[]; candidates: TableEncodingPair[]; catalogDigest?: string; preserved: string; bytes: number;
}
const literal = (value: string) => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
/** 专用会话主动开启检查与完整GIPK显示，不改查询标签或全局。 */
async function prepare(context: StructureTaskContext): Promise<void> {
  await structureTaskQuery(context, 'SET SESSION foreign_key_checks = 1, unique_checks = 1');
  const rows = (await structureTaskQuery<{ fk: number | string; uq: number | string }[]>(context, 'SELECT @@SESSION.foreign_key_checks AS fk, @@SESSION.unique_checks AS uq')).rows;
  if (rows.length !== 1 || ![1, '1'].includes(rows[0].fk) || ![1, '1'].includes(rows[0].uq)) throw new Error('无法确认结构会话检查状态');
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(context.managed.status.version);
  if (context.managed.status.dialect === 'mysql' && version && (Number(version[1]) > 8 || Number(version[1]) === 8 && (Number(version[2]) > 0 || Number(version[3]) >= 30))) {
    await structureTaskQuery(context, 'SET SESSION show_gipk_in_create_table_and_information_schema = ON');
    const rows = (await structureTaskQuery<{ show: number | string }[]>(context, 'SELECT @@SESSION.show_gipk_in_create_table_and_information_schema AS `show`')).rows;
    if (rows.length !== 1 || ![1, '1'].includes(rows[0].show)) throw new Error('无法确认完整生成主键显示');
  }
}
/** 原定义与有效列编码一起读取；原生TABLE_ID门槛保持既有范围，不用哈希伪装物理身份。 */
export async function readTableDefaultEncoding(context: StructureTaskContext, target: TableDefaultEncodingTarget): Promise<TableDefaultEncodingRead> {
  await prepare(context); const read = await readStructureDefinition(context, target, true), parsed = readTableDefaultEncodingDefinition(read.source, read.context);
  const db = literal(target.database), table = literal(target.table), where = `CAST(TABLE_SCHEMA AS BINARY)=CAST(${db} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${table} AS BINARY)`;
  const rows = (await structureTaskQuery<{ kind: string; engine: string; rowFormat: string; comment: string; autoIncrement: string | null }[]>(context, `SELECT TABLE_TYPE AS kind, ENGINE AS engine, ROW_FORMAT AS rowFormat, TABLE_COMMENT AS comment, CAST(AUTO_INCREMENT AS CHAR) AS autoIncrement FROM information_schema.TABLES WHERE ${where} LIMIT 2`)).rows;
  const row = rows[0];
  if (rows.length !== 1 || row.kind !== 'BASE TABLE' || typeof row.engine !== 'string' || typeof row.rowFormat !== 'string' || typeof row.comment !== 'string' || !(row.autoIncrement === null || typeof row.autoIncrement === 'string' && /^[0-9]+$/.test(row.autoIncrement))) throw new Error('无法唯一读取基本表属性及精确自增计数，不能修改默认编码');
  const reasons = [...parsed.reasons, ...tableDefaultEncodingColumnReasons(read)], warnings: string[] = [], document = structureDocumentOf(read);
  if (!parsed.charset || parsed.charset !== read.tableEncoding.charset || parsed.collation !== undefined && parsed.collation !== read.tableEncoding.collation) reasons.push('表默认编码原文与真实目录不一致，当前只读');
  const risks = tableColumnDefaultRisks(document); if (risks.length) reasons.push(tableColumnDefaultRiskMessage(risks));
  if (document.columns.some(hasUnprovenBinaryDefault)) reasons.push('二进制默认值的原始字节无法完整核验，当前只读');
  if (tableCommentHasEngineOptions(row.comment)) reasons.push('表注释含引擎物理参数，本批不能证明默认编码修改时物理选项保真，当前只读');
  const version = read.serverVersion.replace(/^5\.5\.5-/, ''), mysql = read.context.dialect === 'mysql';
  const catalogue = mysql && /^8\.(0|4)\./.test(version) ? 'INNODB_TABLES' : mysql && /^5\.7\./.test(version) || !mysql && /^(10\.11|11\.4)\./.test(version) ? 'INNODB_SYS_TABLES' : undefined;
  let tableId: string | undefined, candidates: TableEncodingPair[] = [], catalogDigest: string | undefined, catalogBytes = 0;
  if (!catalogue || row.engine !== 'InnoDB' || !/^[A-Za-z0-9_]+$/.test(target.database) || !/^[A-Za-z0-9_]+$/.test(target.table)) reasons.push('首批仅支持已证明版本的ASCII命名InnoDB表，其他目标只读');
  else {
    try {
      const facts = (await structureTaskQuery<{ os: string; lowerNames: number | string }[]>(context, 'SELECT @@version_compile_os AS os, @@lower_case_table_names AS lowerNames')).rows;
      if (facts.length !== 1 || !['linux', 'debian-linux-gnu'].includes(String(facts[0].os).toLowerCase()) || ![0, '0'].includes(facts[0].lowerNames)) throw new Error('服务器名称映射不能证明物理表身份');
      const partitions = (await structureTaskQuery<{ name: string | null }[]>(context, `SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS WHERE ${where} LIMIT 2`)).rows;
      if (partitions.length !== 1 || partitions[0].name !== null) throw new Error('分区表默认编码首批只读');
      const identities = (await structureTaskQuery<{ id: string; name: string }[]>(context, `SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name FROM information_schema.${catalogue} WHERE CAST(NAME AS BINARY)=CAST(${literal(target.database + '/' + target.table)} AS BINARY) LIMIT 2`)).rows;
      if (identities.length !== 1 || typeof identities[0].id !== 'string' || !/^[1-9]\d{0,19}$/.test(identities[0].id) || identities[0].name !== target.database + '/' + target.table) throw new Error('无法唯一证明InnoDB物理表身份');
      tableId = identities[0].id;
    } catch (error) { context.checkCancelled(); reasons.push(error instanceof Error ? error.message : '物理身份目录不可用'); }
  }
  try {
    const catalog = await readTableDefaultEncodingCatalog(context); candidates = catalog.candidates; catalogDigest = catalog.digest; catalogBytes = catalog.bytes; warnings.push(...catalog.warnings);
    if (!candidates.some(candidate => sameTableEncodingPair(candidate, read.tableEncoding))) reasons.push('原默认编码不能由候选目录唯一证明，当前只读，不自动猜别名');
  } catch (error) { context.checkCancelled(); reasons.push(error instanceof Error ? error.message : '实际编码候选目录不可用'); }
  try {
    if (!await readTableDefaultEncodingAlter(context, target, read.context)) reasons.push('当前账户的直接ALTER权限未能证明；纯角色授权、部分撤销或未知授权语法首批只读');
  } catch { context.checkCancelled(); reasons.push('无法读取直接ALTER授权，当前只读'); }
  return { ...read, ...parsed, engine: row.engine, rowFormat: row.rowFormat, comment: row.comment, autoIncrement: row.autoIncrement, tableId, reasons, warnings, candidates, catalogDigest, bytes: Buffer.byteLength(read.source) * 3 + catalogBytes * 2 + 32768 };
}
/** 发送前仍严格比较独立新会话原模式、完整DDL、有效列编码、物理身份及真实候选。 */
export function assertTableDefaultEncodingUnchanged(before: TableDefaultEncodingRead, after: TableDefaultEncodingRead): void {
  assertStructureDefinitionUnchanged(before, after);
  if (!before.tableId || before.tableId !== after.tableId || after.reasons.length || !before.catalogDigest || before.catalogDigest !== after.catalogDigest || JSON.stringify([before.engine, before.rowFormat, before.comment, before.autoIncrement]) !== JSON.stringify([after.engine, after.rowFormat, after.comment, after.autoIncrement])) throw new Error('表身份、属性或实际编码候选已变化，请重新读取；未发送DDL');
}
/** 后验使用已经规范化的执行模式；只豁免默认编码和等价的列编码显式显示。 */
export function verifyTableDefaultEncoding(before: TableDefaultEncodingRead, after: TableDefaultEncodingRead, expected: TableEncodingPair): boolean {
  return !after.reasons.length && before.identity === after.identity && before.tableId === after.tableId && after.originalMode === before.normalizedMode && after.normalizedMode === before.normalizedMode && sameTableEncodingPair(after.tableEncoding, expected) && before.catalogDigest === after.catalogDigest && before.preserved === after.preserved && onlyAddedColumnEncodingAttributes(before, after) && JSON.stringify([before.nullability, before.encodings, before.engine, before.rowFormat, before.comment, before.autoIncrement]) === JSON.stringify([after.nullability, after.encodings, after.engine, after.rowFormat, after.comment, after.autoIncrement]);
}
/** 对外摘要不替代完整原文和原生表身份复核。 */
export const tableDefaultEncodingHash = (source: string): string => createHash('sha256').update(source).digest('hex');
