import { parseSqliteTableDraft, sqliteDraftChanges, sqliteDraftGroups, sqliteTableDraftMessages, type SqliteTableDraftDocument, type SqliteDraftRestored } from '../shared/sqliteTableDraft';
import { assertSqliteTablePage } from './sqliteTableBrowser';

/** 文件只能组织变更，Main回包必须为每组签独立新能力，且完整覆盖所有原行及待提交值。 */
export function assertSqliteDraftRestored(value: SqliteDraftRestored, source: SqliteTableDraftDocument, taskId: string): void {
  const document = parseSqliteTableDraft(source), expected = sqliteDraftGroups(document), pages = [value, ...(value.additionalPages ?? [])];
  const invalid = () => { throw Error(sqliteTableDraftMessages.invalid); };
  if (pages.length !== expected.length || !!document.workspace !== Array.isArray(value.additionalPages) || value.page?.offset !== (document.workspace?.activeOffset ?? 0)) invalid();
  const ids = new Set<string>(), offsets = new Set<number>();
  for (const item of pages) {
    const group = expected.find(group => group.offset === item.page?.offset), edit = item.page?.edit;
    if (!group || offsets.has(group.offset) || edit?.kind !== 'editable' || ids.has(edit.snapshotId) || item.page.schemaKey !== document.schemaKey || item.page.hasMore || JSON.stringify(edit.columns) !== JSON.stringify(document.columns)) return invalid();
    assertSqliteTablePage(item.page, { ...document.target, taskId, limit: group.limit, offset: group.offset, mode: 'and', filters: [], sort: [], editing: true, ...(document.relation ? { relation: document.relation } : {}) });
    if (JSON.stringify(item.changes) !== JSON.stringify(sqliteDraftChanges({ ...document, changes: group.changes })) || JSON.stringify(edit.rows) !== JSON.stringify(group.changes.flatMap(change => change.kind === 'insert' ? [] : [change.before]))) invalid();
    ids.add(edit.snapshotId); offsets.add(group.offset);
  }
}
