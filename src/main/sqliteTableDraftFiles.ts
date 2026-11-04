import type { SqliteConnectionProfile } from '../shared/contracts';
import { decodeSqliteTableDraft, encodeSqliteTableDraft, parseSqliteTableDraft, sqliteTableDraftLimits, sqliteTableDraftMessages, type SqliteTableDraftDocument } from '../shared/sqliteTableDraft';
import { BoundedDraftFiles, type TableDraftFilePorts } from './tableDraftFiles';
import { tableDraftEndpointKey } from './tableDraftBinding';
/** SQLite使用独立文件格式，原子IO／单句柄／取消及清理门与已有表格草稿共用。 */
export class SqliteTableDraftFiles extends BoundedDraftFiles<SqliteTableDraftDocument> {
  constructor(ports: TableDraftFilePorts) { super(ports, { bytes: sqliteTableDraftLimits.bytes, encode: encodeSqliteTableDraft, decode: decodeSqliteTableDraft }); }
}
/** 捕获只允许本机保存的可写SQLite连接；文档不能通过自身字段选择新文件或凭据。 */
export function bindSqliteTableDraft(source: SqliteTableDraftDocument, profile: SqliteConnectionProfile): SqliteTableDraftDocument {
  const document = parseSqliteTableDraft(source);
  if (profile.dialect !== 'sqlite' || profile.sqlite.readOnly || document.target.connectionId !== profile.id) throw Error(sqliteTableDraftMessages.changed);
  return parseSqliteTableDraft({ ...document, endpointKey: tableDraftEndpointKey(profile) });
}
/** 端点只由Main当前配置计算；恢复还须Runtime独立核实际dev／inode、完整DDL和原行。 */
export function assertSqliteTableDraftBinding(source: SqliteTableDraftDocument, target: SqliteTableDraftDocument['target'], profile: SqliteConnectionProfile): void {
  const document = parseSqliteTableDraft(source);
  if (profile.dialect !== 'sqlite' || profile.sqlite.readOnly || target.connectionId !== profile.id || document.target.connectionId !== target.connectionId || document.target.database !== target.database || document.target.table !== target.table || document.endpointKey !== tableDraftEndpointKey(profile)) throw Error(sqliteTableDraftMessages.changed);
}
