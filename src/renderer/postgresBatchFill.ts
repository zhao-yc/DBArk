import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import { ownCell } from './lib';
import { postgresBatchFillZh as text } from './locales/postgresBatchFill.zh-CN';
import { postgresBatchEditableColumn, postgresBatchRows, postgresBatchValueEqual, postgresBatchValueValid } from './postgresBatchSelection';

/** 以明确的勾选行、原行键和可见列构造整批草稿。其它字段及已暂存行版本由原工作区保留。 */
export function postgresBatchFillChanges(page: PostgresTablePage, visible: readonly PostgresTableColumn[],
  selected: ReadonlySet<number>, fields: readonly PostgresTableField[], prior: (key: string) => PostgresTableChange | undefined): PostgresTableChange[] {
  if (!page.capabilities.update) throw Error(text.rows);
  const rows = postgresBatchRows(page, selected, prior);
  const seen = new Set<string>();
  if (!fields.length || fields.length > postgresTableLimits.fields) throw Error(text.fields);
  for (const { column: key, value } of fields) {
    const column = visible.find(item => item.key === key);
    if (!column || !page.columns.includes(column) || !postgresBatchEditableColumn(column) || seen.has(key)) throw Error(text.fields);
    if (!postgresBatchValueValid(column, value)) throw Error(text.invalid);
    seen.add(key);
  }
  const result: PostgresTableChange[] = [];
  for (const { index: row, original, previous } of rows) {
    const previousFields = previous?.kind === 'update' ? previous.fields : [];
    const changed = fields.filter(field => {
      const raw = ownCell(original, field.column);
      if (raw === undefined) throw Error(text.rows);
      return !postgresBatchValueEqual(field.value, previousFields.find(item => item.column === field.column)?.value, raw);
    });
    if (!changed.length) continue;
    const replaced = new Set(changed.map(field => field.column));
    result.push({ kind: 'update', row, fields: [...previousFields.filter(field => !replaced.has(field.column)), ...changed] });
  }
  return result;
}
