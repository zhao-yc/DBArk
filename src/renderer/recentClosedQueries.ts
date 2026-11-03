import type { WorkspaceTab } from './store';

const maxEntries = 10;
const maxText = 20_000_000;
type ConnectionScope = { connections: { id: string }[]; connectionVersions: Record<string, number> };
export type RetainedQuery = { draft: Omit<WorkspaceTab, 'id'> & { kind: 'query'; sql: string }; connection: object; version: number };

/** 只保留可重开的草稿字段，源文件、保存查询绑定和运行状态不进入记录。 */
export function captureRetainedQuery(tab: WorkspaceTab, scope: ConnectionScope): RetainedQuery | undefined {
  const connection = scope.connections.find(item => item.id === tab.connectionId);
  if (tab.kind !== 'query' || !connection || !tab.sql || tab.sql.length > maxText || !tab.sql.trim()) return;
  const { title, connectionId, sql, database, databaseContext, queryEditorHeight, queryEditorWidth, queryResultPlacement } = tab;
  const draft: RetainedQuery['draft'] = { kind: 'query', title, connectionId, sql,
    ...(database === undefined ? {} : { database }), ...(databaseContext ? { databaseContext: { ...databaseContext } } : {}),
    ...(queryEditorHeight === undefined ? {} : { queryEditorHeight }), ...(queryEditorWidth === undefined ? {} : { queryEditorWidth }),
    ...(queryResultPlacement === undefined ? {} : { queryResultPlacement }) };
  return { draft, connection, version: scope.connectionVersions[connectionId] ?? 0 };
}

/** 仅当前窗口内存保留，按关闭顺序取最近一个仍属于原连接的草稿。 */
export class RecentClosedQueries {
  private entries: RetainedQuery[] = [];

  remember(entry: RetainedQuery): void {
    this.entries.unshift(entry);
    let total = 0;
    const overflow = this.entries.findIndex((item, index) => (total += item.draft.sql.length) > maxText || index >= maxEntries);
    if (overflow >= 0) this.entries.length = overflow;
  }

  peek(scope: ConnectionScope): RetainedQuery | undefined {
    return this.entries.find(entry => this.matches(entry, scope));
  }

  consume(entry: RetainedQuery): void {
    this.entries = this.entries.filter(item => item !== entry);
  }

  /** 连接一旦离开原身份就清除记录，随后恢复同名配置也不会复活。 */
  prune(scope: ConnectionScope): void {
    this.entries = this.entries.filter(entry => this.matches(entry, scope));
  }

  private matches({ draft, connection, version }: RetainedQuery, scope: ConnectionScope): boolean {
    return scope.connections.find(item => item.id === draft.connectionId) === connection && (scope.connectionVersions[draft.connectionId] ?? 0) === version;
  }
}
