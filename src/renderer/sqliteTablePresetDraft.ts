import type { SqliteFilterDraft, SqliteSortDraft } from './sqliteTableBrowser';
import { validateSqlitePresetColumns, type SqliteTablePresetQuery } from '../shared/sqliteTablePresets';

/** 一次构造完整条件表单，typed原文与缺省启用标记保持；不创建读取或编辑器。 */
export function sqlitePresetDraft(raw: unknown, columns: readonly string[], id: () => string): { query: SqliteTablePresetQuery; filters: SqliteFilterDraft[]; sort: SqliteSortDraft[] } {
  const query = validateSqlitePresetColumns(raw, columns);
  return { query, filters: query.filters.map(filter => ({ id: id(), column: filter.column, operator: filter.operator, kind: filter.value?.kind ?? filter.values?.[0].kind ?? 'text', value: filter.value?.value ?? filter.values?.[0].value ?? '', ...(filter.enabled === undefined ? {} : { enabled: filter.enabled }), ...(filter.secondValue ? { secondValue: filter.secondValue.value } : {}), ...(filter.values ? { values: filter.values.map(value => value.value) } : {}), ...(filter.selectedValues ? { selectedValues: filter.selectedValues.map(value => ({ ...value })) } : {}) })), sort: query.sort.map(rule => ({ id: id(), ...rule })) };
}
