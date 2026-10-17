import type { DataRow, TablePage } from '../shared/contracts';
import { assertCopyInsertSqlInput, type CopyInsertSqlInput } from '../shared/copyInsertSql';
import { copyInsertSqlZh as text } from '../shared/copyInsertSql.zh-CN';
import type { DraftRow } from './dataChanges';
import { recordCopyMetadataReason, type RecordCopyPage } from './recordCopySource';
import type { RecordContext } from './recordViews';

/** 精确比较已加载快照，不能用 JSON 把 -0、缺失字段与 NULL 折叠成同一值。 */
function sameRow(left: DataRow | undefined, right: DataRow): boolean {
  return !!left && Object.keys(left).length === Object.keys(right).length && Object.keys(right).every(key => {
    if (!Object.hasOwn(left, key)) return false;
    const a = left[key], b = right[key];
    return a && b && typeof a === 'object' && typeof b === 'object' ? a.type === b.type && a.base64 === b.base64 : Object.is(a, b);
  });
}
/** 仅从当前表页选取原始行，不补取缺失值，不推断查询结果目标，也不包含任何行草稿。 */
export function prepareCopyInsertSql(context: RecordContext, binding: RecordCopyPage | null, page: TablePage | null, rows: DraftRow[], ids: ReadonlySet<string>): CopyInsertSqlInput {
  const info = context.info;
  if (context.busy || context.stale || !context.loaded) throw new Error(text.busy);
  if (!info || info.objectKind !== 'table' || info.database !== context.target.database || info.name !== context.target.table || !page || binding?.page !== page || recordCopyMetadataReason(context, binding) || !page.copySource || page.copySource.missingColumns.length) throw new Error(text.target);
  if (!ids.size || rows.filter(row => ids.has(row.id)).length !== ids.size) throw new Error(text.selection);
  const originals = rows.filter(row => !row.inserted);
  if (originals.length !== page.rows.length || originals.some((row, index) => !sameRow(row.original, page.rows[index]))) throw new Error(text.target);
  const selected = rows.filter(row => ids.has(row.id));
  if (selected.some(row => row.inserted || row.deleted || !sameRow(row.original, row.data))) throw new Error(text.draft);
  const input: CopyInsertSqlInput = {
    database: info.database, table: info.name,
    columns: info.columns.map(({ name, type, nullable, generated, extra }) => ({ name, type, nullable, generated, extra })),
    rows: selected.map(row => row.original!)
  };
  assertCopyInsertSqlInput(input);
  return structuredClone(input);
}
