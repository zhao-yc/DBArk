import type { CellValue, DataRow, ForeignKeyInfo, TableInfo } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { referenceZh as text } from './locales/references.zh-CN';
import { referenceColumn } from '../shared/references';

export interface ReferenceSnapshot { rowId: string; data: DataRow; foreignKey: ForeignKeyInfo; source: TableInfo; generation: number; }
/** 约束映射按序比较，不把复合键当无序集合。 */
export function referenceSignature(key: ForeignKeyInfo): string { return JSON.stringify([key.name, key.columns.map(name => name.toLowerCase()), key.referencedDatabase, key.referencedTable, key.referencedColumns.map(name => name.toLowerCase()), key.onUpdate, key.onDelete]); }
/** 源列采用真实元数据拼写，库、表和约束名不做大小写折叠。 */
export function sourceReference(info: TableInfo, key: ForeignKeyInfo): ForeignKeyInfo { return { ...key, columns: key.columns.map(name => referenceColumn(info, name).name) }; }
/** 入口识别列名大小写等价；失效或不明确的字段显示错误，不让渲染过程抛异常。 */
export function referencesForColumn(info: TableInfo, column: string): { keys: ForeignKeyInfo[]; error: string } {
  const keys: ForeignKeyInfo[] = []; let error = '';
  for (const key of info.foreignKeys.filter(item => item.columns.some(name => name.toLowerCase() === column.toLowerCase()))) {
    try { keys.push(sourceReference(info, key)); } catch (reason) { error = reason instanceof Error ? reason.message : text.mappingChanged; }
  }
  return { keys, error };
}
/** 缺省值与 NULL 都表示尚无完整关联，不能转换成文本或无条件查询。 */
export function referenceTuple(row: DataRow, columns: string[]): CellValue[] | null {
  if (!columns.length || columns.some(name => !Object.hasOwn(row, name) || row[name] === null || row[name] === undefined)) return null;
  return columns.map(name => structuredClone(row[name]));
}
/** 同时具备事务表、可靠行键及可写外键列时才开放选择。 */
export function referenceWritable(info: TableInfo, key: ForeignKeyInfo): boolean {
  try { return info.engine.toUpperCase() === 'INNODB' && info.editableKey.length > 0 && info.editableKey.every(name => !!referenceColumn(info, name)) && key.columns.length > 0 && key.columns.length === key.referencedColumns.length && key.columns.every(name => !referenceColumn(info, name).generated); }
  catch { return false; }
}
/** 清空必须整组可空，不悄然清除复合键中不可空的成员。 */
export function referenceClearable(info: TableInfo, key: ForeignKeyInfo): boolean { try { return referenceWritable(info, key) && key.columns.every(name => referenceColumn(info, name).nullable); } catch { return false; } }
/** 校验最新源元数据及原行快照后，一次构造完整补丁；失败不修改任何草稿。 */
export function patchReferenceRow(rows: DraftRow[], snapshot: ReferenceSnapshot, generation: number, source: TableInfo, key: ForeignKeyInfo, values: CellValue[], clear = false): DraftRow[] {
  const row = rows.find(item => item.id === snapshot.rowId);
  const metadata = (info: TableInfo) => JSON.stringify([info.database, info.name, info.editableKey.map(name => referenceColumn(info, name).name.toLowerCase()), snapshot.foreignKey.columns.map(name => { const column = referenceColumn(info, name); return { ...column, name: column.name.toLowerCase() }; })]);
  if (!row || row.deleted || generation !== snapshot.generation || JSON.stringify(row.data) !== JSON.stringify(snapshot.data) || referenceSignature(key) !== referenceSignature(snapshot.foreignKey) || metadata(source) !== metadata(snapshot.source)) throw new Error(text.changed);
  if (!referenceWritable(source, key) || values.length !== key.columns.length || values.some(value => value === undefined)) throw new Error(text.readonly);
  if (clear ? !referenceClearable(source, key) || values.some(value => value !== null) : values.some(value => value === null)) throw new Error(text.nullParent);
  const patch = Object.fromEntries(sourceReference(source, key).columns.map((name, index) => [name, structuredClone(values[index])]));
  return rows.map(item => item.id === row.id ? { ...item, data: { ...item.data, ...patch } } : item);
}
