import { postgresTableLimits, type PostgresTableChange, type PostgresTablePage } from '../shared/postgresTable';
import { postgresBatchFillZh } from './locales/postgresBatchFill.zh-CN';

/** 一组勾选必须完整对应同一原页中的不同原行。已标记删除的行拒绝重新进入批量操作。 */
export function postgresBatchRows(page: PostgresTablePage, selected: ReadonlySet<number>, prior: (key: string) => PostgresTableChange | undefined) {
  const { rows } = postgresBatchFillZh;
  if (!page.pageToken || page.truncated || !selected.size || selected.size > postgresTableLimits.changes) throw Error(rows);
  const keys = new Set<string>();
  return [...selected].sort((a, b) => a - b).map(index => {
    const key = page.rowKeys?.[index], original = page.rows[index];
    if (!Number.isSafeInteger(index) || !original || !key || keys.has(key)) throw Error(rows);
    keys.add(key);
    const previous = prior(key);
    if (previous?.kind === 'delete') throw Error(rows);
    return { index, original, previous };
  });
}
