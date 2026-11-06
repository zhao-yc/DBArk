import { randomUUID } from 'node:crypto';
import type { SqliteConnectionProfile } from '../shared/contracts';
import type { SqliteDataCompareEndpoint } from '../shared/sqliteDataCompare';
import { sqliteDataSyncLimits as limits } from '../shared/sqliteDataCompare';
import type { SqliteFileIdentity, SqliteValue } from '../engine/sqlite/protocol';
import { sqliteEditLocator, type SqliteEditClaim } from './sqliteTableEdit';
import { quoteSqliteIdentifier as quote, type SqliteTableCatalogue } from './sqliteTableBrowse';

export interface SqliteSyncEvidence {
  target: SqliteDataCompareEndpoint;
  identity: SqliteFileIdentity;
  catalogue: SqliteTableCatalogue;
  schemaVersion: string;
  columns: string[];
  keyColumns: string[];
  rows: { key: SqliteValue[]; before?: SqliteValue[]; after?: SqliteValue[] }[];
}

/** 预览仅使用可信比较快照里的键和完整原值。确认前没有数据库写操作。 */
export function buildSqliteSyncClaim(evidence: SqliteSyncEvidence, selected: readonly number[], profile: SqliteConnectionProfile): SqliteEditClaim {
  if (profile.id !== evidence.target.connectionId || profile.sqlite.readOnly) throw Error('SQLite 同步目标连接为只读或已变化');
  const selectedRows = selected.map(index => evidence.rows[index]);
  if (selectedRows.some(row => !row) || Buffer.byteLength(JSON.stringify(selectedRows)) > limits.bytes)
    throw Error('SQLite 同步选择无效或超过 1 MiB，请减少所选行');
  const columns = evidence.columns.map(name => {
    const column = evidence.catalogue.columns.find(item => item.name === name)!;
    return { name, declaredType: column.declaredType, generated: false, nullable: true, hasDefault: false };
  });
  const expires = Date.now() + limits.lifetimeMs;
  const snapshot: SqliteEditClaim['snapshot'] = {
    id: randomUUID(), pageOffset: 0, pageLimit: limits.selected, target: evidence.target, profile,
    identity: evidence.identity, catalogue: evidence.catalogue, columns, schemaVersion: evidence.schemaVersion,
    locator: { kind: 'primary-key', columns: evidence.keyColumns, collations: evidence.keyColumns.map(() => 'BINARY') },
    rows: selectedRows.map(row => row.before ?? []), locators: selectedRows.map(row => row.key),
    expires, bytes: 0, active: 0, revoked: false,
  };
  const counts = { insert: 0, update: 0, delete: 0 };
  const table = '"main".' + quote(evidence.target.table);
  const nonKey = evidence.columns.map((name, index) => ({ name, index })).filter(field => !evidence.keyColumns.includes(field.name));
  const statements = selectedRows.map(({ before, after }, row) => {
    const where = sqliteEditLocator(snapshot, row);
    if (!before && after) {
      counts.insert++;
      return { kind: 'insert' as const, sql: `INSERT OR ABORT INTO ${table} (${evidence.columns.map(quote).join(', ')}) VALUES (${after.map(() => '?').join(', ')})`, parameters: after };
    }
    if (!after) {
      counts.delete++;
      return { kind: 'delete' as const, row, sql: `DELETE FROM ${table} WHERE ${where.sql}`, parameters: where.parameters };
    }
    if (!nonKey.length) throw Error('SQLite 同步没有可更新字段');
    counts.update++;
    return { kind: 'update' as const, row, sql: `UPDATE OR ABORT ${table} SET ${nonKey.map(field => quote(field.name) + '=?').join(', ')} WHERE ${where.sql}`,
      parameters: [...nonKey.map(field => after[field.index]), ...where.parameters] };
  });
  if (statements.some(statement => statement.parameters.length > 1024)) throw Error('SQLite 同步参数数目超过上限');
  return { snapshot, statements, counts, confirmation: 'main.' + evidence.target.table, synchronization: selectedRows.map(row => row.after) };
}
