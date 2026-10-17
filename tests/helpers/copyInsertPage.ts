import type { TableInfo, TablePage } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { prepareCopyInsertSql } from '../../src/renderer/copyInsertSql';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { RecordContext } from '../../src/renderer/recordViews';
import { recordTargetKey } from '../../src/renderer/recordViews';
import type { RecordCopyPage } from '../../src/renderer/recordCopySource';

export function fixture() {
  const info: TableInfo = { database: '库', name: '表', objectKind: 'table', engine: 'MyISAM', ddl: '', columns: [{ name: 'id', type: 'bigint', nullable: false, defaultValue: null, extra: '', generated: false, comment: '' }, { name: '值', type: 'text', nullable: true, defaultValue: null, extra: '', generated: false, comment: '' }], primaryKey: [], editableKey: [], indexes: [], foreignKeys: [] };
  const page: TablePage = { rows: [{ id: '9007199254740993', 值: '甲' }, { id: '2', 值: '乙' }], columns: [], page: 1, pageSize: 50, hasMore: true, copyMetadataKey: tableCopyMetadataKey(info), copySource: { status: 'unavailable', reason: 'no-key', missingColumns: [] } };
  const context: RecordContext = { info, target: { connectionId: '连接', database: '库', table: '表' }, connectionVersion: 7, generation: 3, loaded: true, stale: false, busy: false };
  const binding: RecordCopyPage = { page, target: recordTargetKey(context.target), connectionVersion: 7, generation: 3 };
  const rows: DraftRow[] = page.rows.map((row, index) => ({ id: `行${index}`, original: structuredClone(row), data: structuredClone(row), inserted: false, deleted: false }));
  return { info, page, context, binding, rows, prepare(ids = new Set(['行0'])) { return prepareCopyInsertSql(context, binding, page, rows, ids); } };
}
