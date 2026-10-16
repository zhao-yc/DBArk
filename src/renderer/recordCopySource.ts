import type { TableCopyPageSources, TableCopySourceReadResult } from '../shared/tableCopySource';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import type { DraftRow } from './dataChanges';
import { ownCell } from './lib';
import { duplicateRecordDraft, recordDuplicateReadonlyReason, recordDuplicateTargetReason } from './recordDuplicate';
import { recordTargetKey, type RecordContext } from './recordViews';

export interface RecordCopyReadIntent {
  taskId: string; target: string; version: number; generation: number; metadata: string;
  info: RecordContext['info']; rows: DraftRow[]; row: DraftRow; data: DraftRow['data']; original: DraftRow['original'];
  dataSnapshot: DraftRow['data']; originalSnapshot: DraftRow['data'];
  selection: unknown; source: Extract<TableCopyPageSources, { status: 'ready' }>; rowRef: string;
  invalidated: boolean; consumed: boolean; cancelSent: boolean;
}
const changed = () => new Error('完整复制源读取期间目标、选择、字段输入或草稿已变化；旧结果已丢弃，未自动重试。');
/** 标量使用Object.is保留-0，二进制只比较原始包装；不能用JSON把不同精度值简化相等。 */
function sameValues(left: DraftRow['data'], right: DraftRow['data']): boolean {
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => {
    if (!Object.hasOwn(right, key)) return false;
    const a = ownCell(left, key), b = ownCell(right, key);
    return a && b && typeof a === 'object' && typeof b === 'object' ? a.type === b.type && a.base64 === b.base64 : Object.is(a, b);
  });
}

/** 仅缺失值且具有同页引擎来源时可补取；视图、未知键、过期目标仍无复制资格。 */
export function recordCopySourceReady(context: RecordContext, row: DraftRow | undefined, source: TableCopyPageSources | undefined, rowRef: string | undefined, now = Date.now()): boolean {
  return !recordDuplicateTargetReason(context, row) && !!recordDuplicateReadonlyReason(context, row) && source?.status === 'ready' && source.expiresAt > now && !!rowRef && source.metadataKey === tableCopyMetadataKey(context.info!);
}
/** 在第一个await前捕获精确引用与代次，来源及选择切走后即使改回也不得复活。 */
export function beginRecordCopyRead(rows: DraftRow[], rowId: string, context: RecordContext, selection: unknown, source: TableCopyPageSources | undefined, rowRef: string | undefined, taskId: string): RecordCopyReadIntent {
  const row = rows.find(item => item.id === rowId);
  if (!recordCopySourceReady(context, row, source, rowRef) || !row || source?.status !== 'ready' || !rowRef) throw changed();
  return { taskId, target: recordTargetKey(context.target), version: context.connectionVersion, generation: context.generation, metadata: tableCopyMetadataKey(context.info!), info: context.info, rows, row, data: row.data, original: row.original, dataSnapshot: structuredClone(row.data), originalSnapshot: structuredClone(row.original!), selection, source, rowRef, invalidated: false, consumed: false, cancelSent: false };
}
/** 一次回包只准消费一次；先完整复核，再把补齐值与显式本地修改合并为临时复制源。 */
export function consumeRecordCopyRead(intent: RecordCopyReadIntent, rows: DraftRow[], context: RecordContext, selection: unknown, source: TableCopyPageSources | undefined, rowRef: string | undefined, result: TableCopySourceReadResult, newId: string): DraftRow[] {
  if (intent.consumed) throw changed(); intent.consumed = true;
  const row = rows.find(item => item.id === intent.row.id);
  if (intent.invalidated || intent.source.expiresAt <= Date.now() || rows !== intent.rows || row !== intent.row || row.data !== intent.data || row.original !== intent.original || !sameValues(row.data, intent.dataSnapshot) || !sameValues(row.original!, intent.originalSnapshot) || context.info !== intent.info || context.connectionVersion !== intent.version || context.generation !== intent.generation || recordTargetKey(context.target) !== intent.target || tableCopyMetadataKey(context.info!) !== intent.metadata || selection !== intent.selection || source !== intent.source || rowRef !== intent.rowRef || recordDuplicateTargetReason(context, row)) throw changed();
  if (!result.complete || recordTargetKey(result.target) !== intent.target || result.pageRef !== intent.source.pageRef || result.rowRef !== intent.rowRef || result.metadataKey !== intent.metadata) throw changed();
  // 引擎已比较加载时指纹；客户端再比较自有原值，不能把服务器的新值覆盖成本页旧快照。
  if (!sameValues(row.original!, Object.fromEntries(Object.keys(row.original!).filter(key => Object.hasOwn(result.values, key)).map(key => [key, result.values[key]])))) throw changed();
  const temporary: DraftRow = { ...row, original: structuredClone(result.values), data: Object.fromEntries([...Object.entries(result.values), ...Object.entries(row.data)]) };
  const appended = duplicateRecordDraft(rows.map(item => item === row ? temporary : item), row.id, context, newId).at(-1)!;
  return [...rows, appended];
}
