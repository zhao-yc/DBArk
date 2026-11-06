import type { PostgresTableChange, PostgresTableField, PostgresTablePage } from '../shared/postgresTable';
import { ownCell } from './lib';
import { postgresBatchEditZh as text } from './locales/postgresBatchEdit.zh-CN';
import { postgresBatchEditableColumn, postgresBatchValueEqual, postgresBatchValueValid, type PostgresBatchRow } from './postgresBatchSelection';

export type PostgresBatchEditValues = ReadonlyMap<string, PostgresTableField['value']>;
export type PostgresBatchEditInput = ReadonlyMap<number, PostgresBatchEditValues>;

/** 构造逐行更新和明确撤回的原草稿。保持未开放字段及首次编辑时的原行版本。 */
export function postgresBatchEditPlan(page: PostgresTablePage, rows: readonly PostgresBatchRow[], inputs: PostgresBatchEditInput) {
  const columns = new Map(page.columns.filter(postgresBatchEditableColumn).map(column => [column.key, column]));
  const byIndex = new Map(rows.map(row => [row.index, row]));
  const changes: PostgresTableChange[] = [], remove = new Set<string>();
  for (const [index, values] of [...inputs].sort(([left], [right]) => left - right)) {
    const row = byIndex.get(index);
    if (!row || page.rows[index] !== row.original || page.rowKeys?.[index] !== row.key) throw Error(text.stale);
    const prior = row.previous?.kind === 'update' ? row.previous.fields : [];
    const priorByColumn = new Map(prior.map(field => [field.column, field]));
    const fields = prior.filter(field => !columns.has(field.column));
    let changed = prior.some(field => columns.has(field.column) && !values.has(field.column));
    for (const [key, value] of values) {
      const column = columns.get(key), original = ownCell(row.original, key), old = priorByColumn.get(key);
      if (!column || original === undefined || !postgresBatchValueValid(column, value)) throw Error(text.invalid);
      if (old && postgresBatchValueEqual(value, old.value, original)) { fields.push(old); continue; }
      if (!postgresBatchValueEqual(value, undefined, original)) {
        fields.push({ column: key, value });
        changed = true;
      } else if (old) changed = true;
    }
    if (!changed) continue;
    if (fields.length) changes.push({ kind: 'update', row: index, fields });
    else remove.add(row.key);
  }
  return { changes, remove };
}
