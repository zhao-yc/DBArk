import type { CellValue, DataRow, ResultColumn } from '../shared/contracts';
import { cellClipboardType, encodeClipboard, maxClipboardCells } from './gridClipboard';
import { zh } from './locales/zh-CN';
import { queryResultCopyZh as text } from './locales/queryResultCopy.zh-CN';

export interface QueryResultCopyCell { index: number; row: DataRow; column?: ResultColumn; }
/** 含列名复制保持现有格式；列名仅作表头，重复和空别名不参与字段定位。 */
export function encodeQueryResultWithHeaders(columns: ResultColumn[], rows: DataRow[], indices: ReadonlySet<number>, cell?: QueryResultCopyCell) {
  return encodeQueryResultCopy('headers', columns, rows, indices, cell);
}

/** 单列仅复制当前显示范围中的数据值，活动列必须仍在可见列中。 */
export function encodeQueryResultColumn(columns: ResultColumn[], rows: DataRow[], indices: ReadonlySet<number>, cell?: QueryResultCopyCell) {
  return encodeQueryResultCopy('column', columns, rows, indices, cell);
}

/** 两种复制共用准确行列定位、结果值校验及总单元格上限。 */
function encodeQueryResultCopy(mode: 'headers' | 'column', columns: ResultColumn[], rows: DataRow[], indices: ReadonlySet<number>, cell?: QueryResultCopyCell) {
  if (!columns.length || columns.length > maxClipboardCells) throw Error(text.invalid);
  const keys = columns.map(column => column.key);
  if (keys.some(key => typeof key !== 'string' || !key.length) || new Set(keys).size !== keys.length || columns.some(column => typeof column.name !== 'string')) throw Error(text.invalid);
  const selected = indices.size > 0;
  const headers = mode === 'headers';
  if ((!headers || !selected) && (!cell || !Number.isSafeInteger(cell.index) || cell.index < 0 || cell.index >= rows.length || rows[cell.index] !== cell.row || (cell.column ? !columns.includes(cell.column) : !headers))) throw Error(text.invalid);
  const visible = (!headers || !selected) && cell?.column ? [cell.column] : columns;
  const count = selected ? indices.size : headers ? 1 : rows.length;
  // 表头也占原剪贴板总预算；先拒绝超限，不能先投影巨量单元格再截断。
  if ((count + (headers ? 1 : 0)) * visible.length > maxClipboardCells) throw Error(zh.clipboard.copyLimit);
  const positions = selected ? [...indices].sort((a, b) => a - b) : headers ? [cell!.index] : Array.from({ length: count }, (_, index) => index);
  if (positions.some(index => !Number.isSafeInteger(index) || index < 0 || index >= rows.length)) throw Error(text.invalid);
  const values: CellValue[][] = headers ? [visible.map(column => column.name)] : [];
  for (const index of positions) values.push(visible.map(column => {
    const field = Object.getOwnPropertyDescriptor(rows[index], column.key);
    // 查询结果没有 DEFAULT；缺失、继承或访问器字段不能冒充空串，更不能调用 getter 补取。
    if (!field || !('value' in field) || field.value === undefined) throw Error(text.invalid);
    return field.value as CellValue;
  }));
  return encodeClipboard(values);
}

/** 只在显式按钮点击的同步 copy 事件写原两种格式；无主进程、SQL、焦点或异步补偿入口。 */
export function writeQueryResultClipboard(content: ReturnType<typeof encodeClipboard>, current: () => boolean, target: Document = document): void {
  if (!current()) throw Error(text.invalid);
  let copied = false, failure: unknown;
  const copy = (event: ClipboardEvent) => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (copied) return;
    try {
      if (!current()) throw Error(text.invalid);
      if (!event.clipboardData) throw Error(text.unavailable);
      event.clipboardData.setData('text/plain', content.text);
      event.clipboardData.setData(cellClipboardType, content.typed);
      copied = true;
    } catch (reason) { failure = reason; }
  };
  target.addEventListener('copy', copy, true);
  try {
    // ClipboardEvent可写原自定义MIME；仅阻止本次显式复制冒泡，避免被网格普通复制覆盖。
    const accepted = target.execCommand('copy');
    if (failure) throw failure;
    if (!accepted || !copied) throw Error(text.unavailable);
  } finally { target.removeEventListener('copy', copy, true); }
}
