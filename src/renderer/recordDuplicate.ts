import type { CellValue, TableInfo } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { ownCell } from './lib';
import { formatText } from './locales/zh-CN';
import { recordDuplicateZh as text } from './locales/recordDuplicate.zh-CN';
import { recordReadonlyReason, type RecordContext } from './recordViews';

/** 沿用表页原可编辑范围，不把查询结果、视图、无键表或过期页提升为可写对象。 */
export function recordDuplicateTargetReason(context: RecordContext, row?: DraftRow): string {
  const reason = recordReadonlyReason(context, row);
  if (reason) return reason;
  if (context.info!.database !== context.target.database || context.info!.name !== context.target.table) return text.changed;
  if (!row || row.inserted || !row.original) return text.selectExisting;
  if (context.info!.editableKey.some(key => !context.info!.columns.some(column => column.name === key) || ownCell(row.original!, key) === undefined || ownCell(row.original!, key) === null)) return text.incompleteKey;
  const names = new Set(context.info!.columns.map(column => column.name));
  if ([...Object.keys(row.original), ...Object.keys(row.data)].some(key => !names.has(key))) return text.changed;
  return '';
}

/** 旧本地复制仍要求两侧完整拥有普通值；后续补取不能绕过这个最终安全门。 */
export function recordDuplicateReadonlyReason(context: RecordContext, row?: DraftRow): string {
  const reason = recordDuplicateTargetReason(context, row); if (reason) return reason;
  // 原始快照与当前草稿均须完整拥有普通字段；SELECT *遗漏的INVISIBLE不是用户选择DEFAULT。
  const missing = context.info!.columns.find(column => !column.generated && !/\bauto_increment\b/i.test(column.extra) && (
    !Object.hasOwn(row!.original!, column.name) || !Object.hasOwn(row!.data, column.name)
    || ownCell(row!.original!, column.name) === undefined || ownCell(row!.data, column.name) === undefined
  ));
  if (missing) return formatText(text.incompleteValues, missing.name);
  return '';
}

/** 只追加新的本地身份；复制已暂存值，既有草稿、original和选中身份均不改写。 */
export function duplicateRecordDraft(rows: DraftRow[], rowId: string | undefined, context: RecordContext, newId: string): DraftRow[] {
  const source = rows.find(row => row.id === rowId);
  const reason = recordDuplicateReadonlyReason(context, source);
  if (reason) throw new Error(reason);
  if (!newId || rows.some(row => row.id === newId) || rows.filter(row => row.id === rowId).length !== 1) throw new Error(text.changed);
  // 只复制完整已加载源值；普通字段缺失必须拒绝，只有生成列/自增列才主动省略。
  const entries = context.info!.columns.flatMap<[string, CellValue]>(column => {
    if (column.generated || /\bauto_increment\b/i.test(column.extra)) return [];
    const value = ownCell(source!.data, column.name);
    if (value === undefined) throw new Error(formatText(text.incompleteValues, column.name));
    // 二进制在线路中是base64包装，深复制包装对象；不经过文本、JSON数值解析或浮点数转换。
    return [[column.name, structuredClone(value)]];
  });
  return [...rows, { id: newId, data: Object.fromEntries(entries), inserted: true, deleted: false }];
}

/** 只比较已知精确值，不推断服务器排序规则、数字转换或尚未加载页的唯一性。 */
function sameKeyValue(left: CellValue | undefined, right: CellValue | undefined): boolean {
  if (left && right && typeof left === 'object' && typeof right === 'object') return left.base64 === right.base64;
  // INT载入为安全整数、文本编辑器返回字符串；重新输入相同键不能因线路类型变化绕过冲突。
  if (typeof left === 'number' && Number.isSafeInteger(left) && typeof right === 'string') return String(left) === right;
  if (typeof right === 'number' && Number.isSafeInteger(right) && typeof left === 'string') return String(right) === left;
  return Object.is(left, right);
}

/** 仅检查本入口生成的新增草稿；确定冲突在请求SQL预览前报错，不改键、不新增数据库读取。 */
export function assertCopiedRecordKeys(rows: readonly DraftRow[], info: TableInfo, copiedIds: ReadonlySet<string>): void {
  if (!copiedIds.size) return;
  const columns = new Set(info.columns.map(column => column.name));
  const seen = new Set<string>();
  const keys = [
    { name: 'PRIMARY', columns: info.primaryKey },
    ...info.indexes.filter(index => index.unique),
    { name: '可靠定位键', columns: info.editableKey },
  ].filter(key => {
    const signature = JSON.stringify(key.columns);
    if (!key.columns.length || key.columns.some(column => !columns.has(column)) || seen.has(signature)) return false;
    seen.add(signature); return true;
  });
  for (const row of rows) {
    if (!copiedIds.has(row.id) || !row.inserted || row.deleted) continue;
    for (const key of keys) {
      // 服务器生成的省略值不能当作NULL；可空唯一键含NULL时允许多条，均不猜测冲突。
      if (key.columns.some(column => ownCell(row.data, column) === undefined || ownCell(row.data, column) === null)) continue;
      const conflict = rows.some(other => other !== row && !other.deleted && key.columns.every(column => sameKeyValue(ownCell(row.data, column), ownCell(other.data, column))));
      if (conflict) throw new Error(formatText(text.keyConflict, key.name, key.columns.join('、')));
    }
  }
}
