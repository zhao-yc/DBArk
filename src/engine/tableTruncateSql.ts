import { qualified } from './sql';
import { tableTruncateConfirmation, type TableTruncateTarget } from '../shared/tableTruncate';
import { readTableRename, assertTableRenameUnchanged } from './tableRenameRead';
import { readTableAutoIncrementDefinition } from './tableAutoIncrementSql';
import { structureDocumentOf, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import type { TableCommentRead } from './tableCommentRead';

export interface TableTruncateRead extends TableCommentRead { hasAutoIncrement: boolean; }
/** 系统库与无法无歧义匹配物理目录的名称不进入本片。目标始终来自可信快照。 */
export function planTableTruncate(target: TableTruncateTarget): string {
  if (['mysql', 'sys', 'information_schema', 'performance_schema'].includes(target.database.toLowerCase()) || !/^[A-Za-z0-9_]{1,64}$/.test(target.database) || !/^[A-Za-z0-9_]{1,64}$/.test(target.table)) throw new Error('首片只支持非系统库的ASCII普通表名称');
  return `TRUNCATE TABLE ${qualified(target.database, target.table)};`;
}

/** 复用独立结构读取、原生TABLE_ID与完整依赖可见性；任何未知授权或依赖都只读。 */
export async function readTableTruncate(context: StructureTaskContext, target: TableTruncateTarget, verify = false): Promise<TableTruncateRead> {
  planTableTruncate(target);
  const additional: string[] = [];
  // 沿已有自增读取方式绕过MySQL8统计缓存；只改本次结构会话并读回，失败即只读。
  if (context.managed.status.dialect === 'mysql' && /^8\.4\.11(?:[-+].*)?$/.test(context.managed.status.version)) {
    try {
      await structureTaskQuery(context, 'SET SESSION information_schema_stats_expiry = 0');
      const rows = (await structureTaskQuery<{ expiry: string }[]>(context, 'SELECT CAST(@@SESSION.information_schema_stats_expiry AS CHAR) AS expiry')).rows;
      if (rows.length !== 1 || rows[0].expiry !== '0') throw new Error('统计缓存设置未确认');
    } catch { context.checkCancelled(); additional.push('无法证明自增目录绕过统计缓存，本次清空只读'); }
  }
  const read = await readTableRename(context, target, undefined, verify ? 'verify' : 'get'), reasons = [...read.reasons, ...additional], document = structureDocumentOf(read);
  if (read.context.dialect !== 'mysql' || !/^8\.4\.11(?:[-+].*)?$/.test(read.serverVersion)) reasons.push('首片清空仅开放MySQL 8.4.11，其它版本只读，未宣称六组合支持');
  if (read.engine !== 'InnoDB' || !read.tableId || /\bTEMPORARY\b/i.test(document.head.raw)) reasons.push('只允许可证明物理身份的持久普通InnoDB表');
  if (document.columns.some(column => column.access.type.editable !== true)) reasons.push('表含生成或未知字段定义，本片不执行清空');
  const auto = document.columns.filter(column => column.attributes.some(attribute => attribute.kind === 'auto-increment')), definition = readTableAutoIncrementDefinition(read.source, read.context);
  if (definition.reasons.length) reasons.push(...definition.reasons);
  if (auto.length > 1 || (auto.length === 0 ? read.autoIncrement !== null : read.autoIncrement === null)) reasons.push('自增列与真实目录计数不能一致证明');
  if (auto.length) {
    const rows = (await structureTaskQuery<{ incrementValue: number | string; offsetValue: number | string }[]>(context, 'SELECT @@SESSION.auto_increment_increment AS incrementValue, @@SESSION.auto_increment_offset AS offsetValue')).rows;
    if (rows.length !== 1 || ![1, '1'].includes(rows[0].incrementValue) || ![1, '1'].includes(rows[0].offsetValue)) reasons.push('自增步长或偏移不是已证明的1，本片只读');
  }
  return { ...read, reasons, hasAutoIncrement: auto.length === 1 };
}

/** 发送前仍严格比较物理编号/原定义/计数与身份，不把同名新表当作原目标。 */
export function assertTableTruncateUnchanged(before: TableTruncateRead, after: TableTruncateRead): void { assertTableRenameUnchanged(before, after); if (before.hasAutoIncrement !== after.hasAutoIncrement) throw new Error('自增能力变化，未发送清空'); }

/** TRUNCATE预期重建物理表及重置计数；只豁免这两项，不放宽定义、模式与空表证据。 */
export function verifyTableTruncate(before: TableTruncateRead, after: TableTruncateRead, emptyObserved: boolean): boolean {
  return emptyObserved && !after.reasons.length && !!after.tableId && before.tableId !== after.tableId && before.identity === after.identity && before.normalizedMode === after.originalMode && before.normalizedMode === after.normalizedMode && before.hasAutoIncrement === after.hasAutoIncrement && after.autoIncrement === (before.hasAutoIncrement ? '1' : null)
    && readTableAutoIncrementDefinition(before.source, before.context).preserved === readTableAutoIncrementDefinition(after.source, after.context).preserved
    && JSON.stringify([before.nullability, before.encodings, before.tableEncoding, before.engine, before.rowFormat, before.comment]) === JSON.stringify([after.nullability, after.encodings, after.tableEncoding, after.engine, after.rowFormat, after.comment]);
}

/** 输入确认只作等值核对，从不把输入拆分成库表或SQL。 */
export function assertTableTruncateConfirmation(target: TableTruncateTarget, confirmation: string): void { if (confirmation !== tableTruncateConfirmation(target)) throw new Error('确认文字必须与预览的准确库名.表名完全一致'); }
