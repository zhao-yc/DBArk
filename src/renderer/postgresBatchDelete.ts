import type { PostgresTableChange, PostgresTablePage } from '../shared/postgresTable';
import { cellPreview, ownCell } from './lib';
import { postgresBatchDeleteZh as text } from './locales/postgresBatchDelete.zh-CN';
import { postgresBatchRows } from './postgresBatchSelection';

/** 审阅展示原始主键，删除仍只提交原页行索引，定位依据由引擎保管。 */
export function postgresBatchDeletePlan(page: PostgresTablePage, selected: ReadonlySet<number>,
  prior: (key: string) => PostgresTableChange | undefined) {
  const primary = page.columns.filter(column => column.primary);
  if (!page.capabilities.delete || !primary.length) throw Error(text.stale);
  const rows = postgresBatchRows(page, selected, prior);
  const changes: PostgresTableChange[] = rows.map(({ index }) => ({ kind: 'delete', row: index }));
  return {
    changes,
    updates: rows.filter(row => row.previous?.kind === 'update').length,
    rows: rows.map(({ index, original }) => ({
      index,
      key: primary.map(column => {
        const raw = ownCell(original, column.key);
        if (raw === undefined || raw === null) throw Error(text.stale);
        return { name: column.name, value: raw === '' ? '""' : cellPreview(raw, 160) };
      }),
    })),
  };
}
export type PostgresBatchDeletePlan = ReturnType<typeof postgresBatchDeletePlan>;
