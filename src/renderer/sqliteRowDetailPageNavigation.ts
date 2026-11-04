import { sqliteTableBrowseLimits, type SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteTableView } from './sqliteTableBrowser';
import { queryRowDetailsZh as text } from './locales/queryRowDetails.zh-CN';

/** 只读详情仅在当前页真实首末行继续，不把查询结果或可编辑快照当作只读页。 */
export function sqliteRowDetailPageOffset(page: SqliteTablePage, index: number, direction: -1 | 1): number | undefined {
  const count = page.result.rows.length;
  if (page.edit?.kind === 'editable' || !count || !Number.isSafeInteger(index) || index < 0 || index >= count || direction !== -1 && direction !== 1
    || direction === -1 && index !== 0 || direction === 1 && index !== count - 1
    || !Number.isSafeInteger(page.limit) || page.limit < 1 || !Number.isSafeInteger(page.offset) || page.offset < 0) return;
  const offset = direction === -1 ? Math.max(0, page.offset - page.limit) : page.offset + page.limit;
  if (!Number.isSafeInteger(offset) || offset > sqliteTableBrowseLimits.offset || (direction === -1 ? page.offset === 0 : !page.hasMore)) return;
  return offset;
}

/** 只持有一次相邻页读取意图，不执行IPC、不复制字段值，也不扫描空页。 */
export class SqliteRowDetailPageNavigation {
  private valid = true;
  private page?: SqliteTablePage;
  private readonly sourceKey: string;
  private readonly sourceOffset: number;
  readonly offset: number;
  message = '';
  constructor(readonly source: SqliteTablePage, index: number, readonly direction: -1 | 1, private readonly check: () => boolean) {
    const offset = sqliteRowDetailPageOffset(source, index, direction);
    if (offset === undefined) throw Error(text.sqlitePageUnavailable);
    this.offset = offset; this.sourceKey = this.key(source); this.sourceOffset = source.offset;
  }
  /** 绑定实际对象种类、结构与分页，列元数据也不能借同名字段替换。 */
  private key(page: SqliteTablePage): string { return JSON.stringify([page.target.connectionId, page.target.database, page.target.table, page.target.kind, page.schemaKey, page.limit, page.columns, page.result.columns]); }
  /** 来源一旦失效即留下墓碑，恢复相同连接和标签也不复活。 */
  current(): boolean {
    if (!this.valid) return false;
    try { if (!this.check() || this.source.offset !== this.sourceOffset || this.key(this.source) !== this.sourceKey) throw Error(text.sqlitePageStale); return true; }
    catch { this.invalidate(); return false; }
  }
  /** 撤销仅影响自己，不取消原Browser或其他任务。 */
  invalidate(message = text.sqlitePageStale): void { this.valid = false; this.page = undefined; this.message = message; }
  /** 停止、失败、空页及错页都明确结束；只有原Browser的终态准确页可交接。 */
  observe(view: SqliteTableView): void {
    if (!this.current()) return;
    if (view.stopping || view.error) { this.invalidate(view.error || text.sqlitePageStopped); return; }
    if (view.busy) return;
    const page = view.page;
    if (!page || page.offset !== this.offset || this.key(page) !== this.sourceKey || page.edit?.kind === 'editable') { this.invalidate(); return; }
    if (!page.result.rows.length) { this.invalidate(text.sqlitePageEmpty); return; }
    if (this.page && this.page !== page) { this.invalidate(); return; }
    this.page = page;
  }
  /** 新页完整绑定后只消费一次原行号，不复用旧行引用或同名键。 */
  consume(page: SqliteTablePage): number | undefined {
    if (!this.current() || this.page !== page) return;
    const index = this.direction === 1 ? 0 : page.result.rows.length - 1;
    this.valid = false; this.page = undefined; this.message = ''; return index;
  }
}
