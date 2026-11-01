import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteDraftRow } from './sqliteTableEditor';

/** 复选框选择绑定准确展示页及原草稿对象；不能用相同行id或下标接管后继页。 */
export interface SqliteCheckedRows {
  readonly page: SqliteTablePage;
  readonly rows: readonly SqliteDraftRow[];
  readonly selected: readonly SqliteDraftRow[];
  current(): boolean;
}
