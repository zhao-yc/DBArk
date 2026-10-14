import type { ParsedForeignKey, TableForeignKeyDefinitionRead } from './tableForeignKeyDefinition';
import type { ForeignKeyAction } from '../shared/tableForeignKeyPatches';

type Row = Record<string, unknown>;
export interface ForeignKeyCatalogEntry {
  name: string; parsed: ParsedForeignKey; parentTarget: { database: string; table: string };
  childColumnNames: string[]; parentColumnNames: string[]; onUpdate: ForeignKeyAction; onDelete: ForeignKeyAction;
  parentIndexName: string;
}
/** 目录标量来自服务器，仍需显式验证，不能用 String(undefined) 补造可信名称。 */
function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('外键目录名称或规则缺失：' + key);
  return value;
}
/** mysql2 的 BIGINT 字符串保持十进制语义，仅对有界序号转安全整数。 */
function ordinal(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) throw new Error('外键目录序号无效');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 32) throw new Error('外键目录序号超出受控范围');
  return number;
}
/** 任何目录都必须精确属于同一子表；大小写和标识符编码能力由上层可信读取器确认。 */
function assertChild(row: Row, target: { database: string; table: string }, kcu: boolean): void {
  if (text(row, 'CONSTRAINT_SCHEMA') !== target.database || text(row, 'TABLE_NAME') !== target.table || kcu && text(row, 'TABLE_SCHEMA') !== target.database) throw new Error('外键目录包含其他子表或数据库，不能合并为当前快照');
}

/** 将完整源定义与两套独立目录逐约束、逐有序字段交叉核对，不把权限空集当成无外键。 */
export function crossCheckForeignKeyCatalog(source: TableForeignKeyDefinitionRead, target: { database: string; table: string }, rcRows: readonly Row[], kcuRows: readonly Row[]): ForeignKeyCatalogEntry[] {
  if (!source.complete || source.unclassifiedConstraintRanges.length) throw new Error('源定义外键尚未完整识别');
  if (source.foreignKeys.length > 256 || rcRows.length > 256 || kcuRows.length > 8192 || Buffer.byteLength(JSON.stringify([rcRows, kcuRows])) > 4 * 1024 * 1024) throw new Error('外键逻辑目录超过条目或字节预算');
  const rules = new Map<string, Row>(), parts = new Map<string, Row[]>();
  for (const row of rcRows) {
    assertChild(row, target, false);
    const name = text(row, 'CONSTRAINT_NAME');
    if (rules.has(name)) throw new Error('外键规则目录名称重复');
    rules.set(name, row);
  }
  for (const row of kcuRows) {
    assertChild(row, target, true);
    const name = text(row, 'CONSTRAINT_NAME');
    if (!rules.has(name)) throw new Error('外键字段目录没有对应规则，不能忽略多出约束');
    const values = parts.get(name) ?? []; values.push(row); parts.set(name, values);
  }
  if (rules.size !== source.foreignKeys.length || parts.size !== source.foreignKeys.length) throw new Error('源定义与外键目录数量不一致');
  const seen = new Set<string>(), result: ForeignKeyCatalogEntry[] = [];
  for (const key of source.foreignKeys) {
    if (!key.name || !key.parentTarget || !key.onUpdate || !key.onDelete || key.opaqueReasons.length || seen.has(key.name)) throw new Error('源外键身份、动作或原属性尚未证明');
    seen.add(key.name);
    const rule = rules.get(key.name), values = parts.get(key.name);
    if (!rule || !values || !values.length || values.length !== key.childColumnNames.length || key.parentColumnNames.length !== values.length) throw new Error('源外键与字段目录数量不一致');
    if (text(rule, 'MATCH_OPTION') !== 'NONE' || text(rule, 'UPDATE_RULE') !== key.onUpdate || text(rule, 'DELETE_RULE') !== key.onDelete) throw new Error('外键动作或 MATCH 目录与完整定义矛盾');
    if (text(rule, 'UNIQUE_CONSTRAINT_SCHEMA') !== key.parentTarget.database || text(rule, 'REFERENCED_TABLE_NAME') !== key.parentTarget.table) throw new Error('外键规则的父表身份与原定义矛盾');
    const ordered = [...values].sort((a, b) => ordinal(a.ORDINAL_POSITION) - ordinal(b.ORDINAL_POSITION));
    for (const [position, part] of ordered.entries()) {
      if (ordinal(part.ORDINAL_POSITION) !== position + 1 || ordinal(part.POSITION_IN_UNIQUE_CONSTRAINT) !== position + 1) throw new Error('外键有序元组目录重复、缺项或支持键位置尚未证明');
      if (text(part, 'COLUMN_NAME') !== key.childColumnNames[position] || text(part, 'REFERENCED_COLUMN_NAME') !== key.parentColumnNames[position] || text(part, 'REFERENCED_TABLE_SCHEMA') !== key.parentTarget.database || text(part, 'REFERENCED_TABLE_NAME') !== key.parentTarget.table) throw new Error('外键目录的父子身份或有序映射与原定义矛盾');
    }
    result.push({ name: key.name, parsed: key, parentTarget: key.parentTarget, childColumnNames: [...key.childColumnNames], parentColumnNames: [...key.parentColumnNames], onUpdate: key.onUpdate, onDelete: key.onDelete, parentIndexName: text(rule, 'UNIQUE_CONSTRAINT_NAME') });
  }
  return result.sort((a, b) => a.name < b.name ? -1 : a.name === b.name ? 0 : 1);
}
