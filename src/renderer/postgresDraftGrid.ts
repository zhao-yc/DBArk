import type { DataRow } from '../shared/contracts';
import type { PostgresTablePage } from '../shared/postgresTable';
import type { PostgresDraftEntry } from '../shared/postgresTableDraft';
import type { GridCellPresentation } from './components/ResultsGrid';
import { binaryCellFromHex } from './binaryCell';
import { cellPreview, ownCell } from './lib';
import { postgresTableZh as text } from './locales/postgresTable.zh-CN';

/** 草稿按稳定主键匹配当前页。仅生成展示和值覆盖，不改变网格交互持有的原行。 */
export function postgresDraftGrid(page: PostgresTablePage, draft: readonly PostgresDraftEntry[]) {
  const prior = new Map(draft.flatMap(entry => entry.rowKey ? [[entry.rowKey, entry.change] as const] : []));
  const fields = new Map<DataRow, Map<string, GridCellPresentation>>();
  const deleted = new Set<DataRow>();
  for (const [index, row] of page.rows.entries()) {
    const key = page.rowKeys?.[index], change = key ? prior.get(key) : undefined;
    if (change?.kind === 'delete') deleted.add(row);
    if (change?.kind !== 'update') continue;
    fields.set(row, new Map<string, GridCellPresentation>(change.fields.map(({ column, value }) => {
      if (value.mode === 'default') return [column, { value: undefined, label: text.gridDraftDefault, title: text.gridDraftDefault,
        className: 'pg-grid-staged', copyError: text.gridDraftDefaultCopy }];
      const actual = value.mode === 'null' ? null : value.mode === 'binary' ? binaryCellFromHex(value.value) : value.value;
      const label = cellPreview(actual);
      return [column, { value: actual, label, title: text.gridDraftValue(label), className: 'pg-grid-staged' }];
    })));
  }
  return {
    hasChanges: fields.size > 0 || deleted.size > 0,
    cell(row: DataRow, key: string): GridCellPresentation | undefined {
      if (deleted.has(row)) {
        const value = ownCell(row, key);
        return { value, title: text.gridDraftDeleted(cellPreview(value)), className: 'pg-grid-deleted' };
      }
      return fields.get(row)?.get(key);
    },
  };
}
