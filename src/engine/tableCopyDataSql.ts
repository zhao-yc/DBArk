import { structureDocumentOf, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { readTableCopyStructure, assertTableCopyStructureUnchanged, planTableCopyStructure, type TableCopyStructureRead } from './tableCopyStructureSql';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { qualified, identifier } from './sql';
import type { TableCopyDataTarget } from '../shared/tableCopyData';
export interface TableCopyDataRead extends TableCopyStructureRead { dataCapability: string; }
/** 数据仍在服务器内传递；不取出源行，不经JS转换大整数、DECIMAL、NULL或二进制字节。 */
export function planTableCopyData(read: TableCopyDataRead, target: TableCopyDataTarget, newName: string): { newName: string; createSql: string; insertSql: string; sql: string } {
  const plan = planTableCopyStructure(target, newName), columns = structureDocumentOf(read).columns;
  if (!columns.length || read.generatedPlan?.columns.length || columns.some(column => !column.access.type.editable)) throw Error('数据复制仅支持已证明的普通可写列');
  const names = columns.map(column => identifier(column.name)).join(', ');
  const insertSql = `INSERT INTO ${qualified(target.database, plan.newName)} (${names}) SELECT ${names} FROM ${qualified(target.database, target.table)};`;
  return { newName: plan.newName, createSql: plan.sql, insertSql, sql: plan.sql + '\n' + insertSql };
}
/** 保留空表用途全部身份与依赖守卫，再收窄准确版本和数据用途权限；角色/部分撤销不推测。 */
export async function readTableCopyData(context: StructureTaskContext, target: TableCopyDataTarget): Promise<TableCopyDataRead> {
  const read = await readTableCopyStructure(context, target), reasons = [...read.reasons]; let dataCapability = '';
  if (context.managed.status.dialect !== 'mysql' || read.serverVersion !== '8.4.11') reasons.push('数据复制首片仅支持准确MySQL 8.4.11普通InnoDB表');
  if (read.generatedPlan?.columns.length) reasons.push('生成列的数据复制语义尚未验收，当前只读');
  try {
    const facts = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@SESSION.transaction_isolation AS isolation, @@SESSION.binlog_format AS binlogFormat, @@GLOBAL.log_bin AS logBin')).rows;
    const row = facts[0];
    if (facts.length !== 1 || !['READ-UNCOMMITTED', 'READ-COMMITTED', 'REPEATABLE-READ', 'SERIALIZABLE'].includes(String(row.isolation)) || !['ROW', 'MIXED', 'STATEMENT'].includes(String(row.binlogFormat)) || ![0, '0', 1, '1'].includes(row.logBin as number) || [1, '1'].includes(row.logBin as number) && row.binlogFormat !== 'ROW') throw Error('数据复制须关闭binlog或使用ROW格式，隔离级别必须可确认');
    const grants = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SHOW GRANTS')).rows;
    if (!Array.isArray(grants) || grants.length > 256 || Buffer.byteLength(JSON.stringify(grants)) > 512 * 1024 || !grants.some(grant => {
      const values = Object.values(grant); if (values.length !== 1 || typeof values[0] !== 'string') return false;
      const tokens = tableDefinitionTokens(values[0], read.context), word = (i: number) => tokens[i]?.kind === 'word' ? tokens[i].value.toUpperCase() : '';
      const on = tokens.findIndex((_, i) => word(i) === 'ON');
      return word(0) === 'GRANT' && on > 0 && !tokens.some(token => token.kind === 'executable') && tokens[on + 1]?.value === '*' && tokens[on + 2]?.value === '.' && tokens[on + 3]?.value === '*' && word(on + 4) === 'TO' && values[0].slice(tokens[1].start, tokens[on].start).toUpperCase().split(',').some(value => ['ALL', 'ALL PRIVILEGES', 'INSERT'].includes(value.trim()));
    })) throw Error('数据复制还须显式全局INSERT权限，未知授权只读，不自动扩权');
    dataCapability = JSON.stringify(row);
  } catch (reason) { context.checkCancelled(); reasons.push(reason instanceof Error ? reason.message : '数据复制会话能力未知'); }
  return { ...read, dataCapability, reasons: [...new Set(reasons)] };
}
/** 模式、UUID、原生表编号、完整定义、权限及数据会话事实共同约束一次预览。 */
export function assertTableCopyDataUnchanged(before: TableCopyDataRead, after: TableCopyDataRead): void {
  assertTableCopyStructureUnchanged(before, after);
  if (!before.dataCapability || before.dataCapability !== after.dataCapability) throw Error('数据复制会话能力已变化，未发送数据');
}
