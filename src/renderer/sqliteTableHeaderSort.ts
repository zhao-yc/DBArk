import { z } from 'zod';
import { sqliteTableBrowseLimits, type SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteTableQuery } from './sqliteTableBrowser';
import { sqliteTableBrowseZh as text } from './locales/sqliteTableBrowse.zh-CN';

const gridRules = z.array(z.object({ columnKey: z.string(), direction: z.enum(['ASC', 'DESC']) }).strict()).max(sqliteTableBrowseLimits.sorts);
export type SqliteHeaderSort = z.infer<typeof gridRules>;

/** 网格键只在本页准确列映射中解析，不把cN或任意SQL片段当成数据库字段。 */
function columnMap(page: SqliteTablePage): Map<string, string> {
  const actual = page.result.columns;
  if (actual.length !== page.columns.length || actual.some((column, index) => column.name !== page.columns[index].name) || new Set(actual.map(column => column.key)).size !== actual.length || new Set(actual.map(column => column.name)).size !== actual.length) throw Error(text.headerInvalid);
  return new Map(actual.map(column => [column.key, column.name]));
}

/** 列头只改变ORDER BY；方向、顺序、唯一性和八列预算均在丢弃草稿前验证。 */
export function sqliteHeaderSortFromGrid(raw: unknown, page: SqliteTablePage): SqliteTableQuery['sort'] {
  const parsed = gridRules.safeParse(raw), columns = columnMap(page);
  if (!parsed.success || new Set(parsed.data.map(rule => rule.columnKey)).size !== parsed.data.length) throw Error(text.headerInvalid);
  return parsed.data.map(rule => {
    const column = columns.get(rule.columnKey); if (column === undefined) throw Error(text.headerInvalid);
    return { column, direction: rule.direction === 'ASC' ? 'asc' : 'desc' };
  });
}

/** 箭头只投影已应用的服务端排序；尚未应用的表单草稿不会改变网格顺序或标记。 */
export function sqliteHeaderSortToGrid(sort: SqliteTableQuery['sort'], page: SqliteTablePage): SqliteHeaderSort {
  const columns = columnMap(page), keys = new Map([...columns].map(([key, name]) => [name, key]));
  const next = sort.map(rule => ({ columnKey: keys.get(rule.column), direction: rule.direction === 'asc' ? 'ASC' : rule.direction === 'desc' ? 'DESC' : undefined }));
  const checked = gridRules.safeParse(next);
  if (!checked.success || new Set(checked.data.map(rule => rule.columnKey)).size !== checked.data.length) throw Error(text.headerInvalid);
  return checked.data;
}
