import { sqliteTableBrowseLimits, type SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteDraftRow } from './sqliteTableEditor';
import type { SqliteTableView } from './sqliteTableBrowser';
import { sqliteTableEditZh as text } from './locales/sqliteTableEdit.zh-CN';

/** 页内只选择准确原数组中的已有未删除行，不把新增草稿当作服务器下一条。 */
export function sqliteAdjacentRecord(rows: readonly SqliteDraftRow[], row: SqliteDraftRow, direction: -1 | 1): SqliteDraftRow | undefined {
  if (direction !== -1 && direction !== 1 || row.index === undefined || row.deleted) return;
  const index = rows.indexOf(row); if (index < 0) return;
  for (let i = index + direction; i >= 0 && i < rows.length; i += direction) if (rows[i].index !== undefined && !rows[i].deleted) return rows[i];
}

/** 只在真实页边界计算一次相邻偏移，不扫描空页或读取COUNT来猜末页。 */
export function sqliteRecordPageOffset(page: SqliteTablePage, rows: readonly SqliteDraftRow[], row: SqliteDraftRow, direction: -1 | 1): number | undefined {
  if (direction !== -1 && direction !== 1 || page.target.kind !== 'table' || page.edit?.kind !== 'editable' || row.index === undefined || row.deleted || !rows.includes(row) || sqliteAdjacentRecord(rows, row, direction)) return;
  const offset = direction === -1 ? Math.max(0, page.offset - page.limit) : page.offset + page.limit;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > sqliteTableBrowseLimits.offset || (direction === -1 ? page.offset === 0 : !page.hasMore)) return;
  return offset;
}

/** 一次跨页仅兑换准确新页首末行；来源、普通读取或其它模态变化后永久撤权。 */
export class SqliteRecordPageNavigation {
  private valid = true;
  private page?: SqliteTablePage;
  private readonly sourceKey: string;
  message = '';
  readonly offset: number;
  constructor(readonly source: SqliteTablePage, rows: readonly SqliteDraftRow[], row: SqliteDraftRow, readonly direction: -1 | 1, private readonly check: () => boolean) {
    const offset = sqliteRecordPageOffset(source, rows, row, direction); if (offset === undefined) throw Error(text.recordPageUnavailable);
    this.offset = offset; this.sourceKey = this.key(source);
  }
  /** 仅绑定目标、结构与分页元数据，不复制或持久化记录值。 */
  private key(page: SqliteTablePage): string { return JSON.stringify([page.target.connectionId, page.target.database, page.target.table, page.target.kind, page.schemaKey, page.offset, page.limit]); }
  /** 原条件恢复也不能复活已观察到的失效来源。 */
  current(): boolean {
    if (!this.valid) return false;
    try { if (!this.check() || this.key(this.source) !== this.sourceKey) throw Error(text.recordPageStale); return true; }
    catch { this.invalidate(); return false; }
  }
  /** 旧意图只撤销自己，不取消或释放浏览器持有的其它任务。 */
  invalidate(message = text.recordPageStale): void { this.valid = false; this.page = undefined; this.message = message; }
  /** 只接纳原读取结束后发布的准确页；失败、停止、空页和结构变化不自动打开表单。 */
  observe(view: SqliteTableView): void {
    if (!this.current()) return;
    if (view.stopping || view.error) { this.invalidate(view.error || text.recordPageStopped); return; }
    if (view.busy) return;
    const page = view.page;
    if (!page || page.offset !== this.offset || page.limit !== this.source.limit || page.schemaKey !== this.source.schemaKey || [page.target.connectionId, page.target.database, page.target.table, page.target.kind].some((value, index) => value !== [this.source.target.connectionId, this.source.target.database, this.source.target.table, this.source.target.kind][index]) || page.edit?.kind !== 'editable') { this.invalidate(); return; }
    if (!page.edit.rows.length) { this.invalidate(text.recordPageEmpty); return; }
    if (this.page && this.page !== page) { this.invalidate(); return; }
    this.page = page;
  }
  /** 新编辑器实际接管同一页后才消费UUID；重复调用或错页不得借用行号选择。 */
  consume(page: SqliteTablePage, rows: readonly SqliteDraftRow[]): SqliteDraftRow | undefined {
    if (!this.current() || this.page !== page) return;
    const existing = rows.filter(row => row.index !== undefined && !row.deleted);
    const row = this.direction === 1 ? existing[0] : existing.at(-1);
    if (!row || !page.edit || page.edit.kind !== 'editable' || row.index! < 0 || row.index! >= page.edit.rows.length) { this.invalidate(); return; }
    this.valid = false; this.page = undefined; this.message = ''; return row;
  }
}
