import type { SqliteReferenceOutput } from '../shared/sqliteReference';
import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteEditValueSchema, type SqliteOriginalValue } from '../shared/sqliteTableEdit';
import { sqliteRelationshipName as fold } from '../shared/sqliteRelationships';
import { sqliteReadCellOriginal } from './sqliteTableCellFilter';
import type { SqliteDraftRow } from './sqliteTableEditor';

export interface SqliteReferenceChoice { foreignKey: number; proof: SqliteReferenceOutput; values: readonly SqliteOriginalValue[] | null; }
const same = (a: readonly SqliteOriginalValue[], b: readonly SqliteOriginalValue[]) => a.length === b.length && a.every((value, i) => value.kind === b[i].kind && (value.kind === 'null' || b[i].kind !== 'null' && (value.kind === 'blob' ? value.value.toLowerCase() === b[i].value.toLowerCase() : value.value === b[i].value)));

/** 只从准确父页原值提取整组键；NULL不是父关联，超预算值不经过显示文本降级。 */
export function sqliteReferenceTuple(output: SqliteReferenceOutput, index: number): SqliteOriginalValue[] {
  const page = output.page;
  if (!page || !output.referencedColumns || !Number.isSafeInteger(index) || index < 0 || index >= page.result.rows.length) throw Error('请先选择当前父候选页中的一行');
  return output.referencedColumns.map(name => {
    const column = page.columns.findIndex(column => fold(column.name) === fold(name));
    if (column < 0) throw Error('SQLite父键映射已变化');
    const value = sqliteEditValueSchema.parse(sqliteReadCellOriginal(page, index, column));
    if (value.kind === 'null') throw Error('NULL父键不建立关联，请使用明确的清空关联操作');
    return value;
  });
}

/** SQL的亲和性或collation匹配不等于原键不变；必须复读到严格相同的整组typed值。 */
export function assertSqliteReferenceChoice(proof: SqliteReferenceOutput, values: readonly SqliteOriginalValue[]): void {
  if (proof.request.reference !== 'page' || !same(proof.request.values, values) || !proof.page?.result.rows.some((_row, index) => { try { return same(sqliteReferenceTuple(proof, index), values); } catch { return false; } })) throw Error('所选父键已删除或变化，请重新读取候选后选择');
}

/** 生成单次Editor.save的完整行，保留其它草稿列；清空只允许所有子键列可空且可编辑。 */
export function sqliteReferenceDraft(page: SqliteTablePage, row: SqliteDraftRow, choice: SqliteReferenceChoice): (SqliteOriginalValue | undefined)[] {
  const { proof, values } = choice, request = proof.request, edit = page.edit;
  if (edit?.kind !== 'editable' || row.deleted || request.connectionId !== page.target.connectionId || request.database !== 'main' || request.table !== page.target.table || request.schemaKey !== page.schemaKey || proof.source.name !== page.target.table) throw Error('原SQLite外键来源已变化');
  const key = proof.source.foreignKeys.find(key => key.ordinal === choice.foreignKey);
  if (!key || !key.columns.length || values && (request.reference !== 'page' || request.foreignKey !== key.ordinal || values.length !== key.columns.length) || !values && request.reference !== 'catalog') throw Error('SQLite外键暂存映射无效');
  if (values) assertSqliteReferenceChoice(proof, values);
  const next = [...row.values], seen = new Set<number>();
  key.columns.forEach((name, i) => {
    const index = edit.columns.findIndex(column => fold(column.name) === fold(name)), column = edit.columns[index];
    if (!column || seen.has(index) || column.generated || page.columns[index]?.name !== column.name || !values && !column.nullable) throw Error('外键字段不可编辑或不允许整组NULL');
    seen.add(index); next[index] = values ? sqliteEditValueSchema.parse(values[i]) : { kind: 'null' };
  });
  return next;
}
