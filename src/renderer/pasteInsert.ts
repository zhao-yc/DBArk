import type { DataRow, TableInfo } from '../shared/contracts';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { newDraftRow, type DraftRow } from './dataChanges';
import { cellClipboardType, decodeClipboard, maxClipboardCells, maxClipboardCharacters, type ClipboardCell } from './gridClipboard';
import { recordReadonlyReason, recordTargetKey, recordValueSummary, type RecordContext } from './recordViews';
import { ownCell } from './lib';
import { pasteInsertZh as text } from './locales/pasteInsert.zh-CN';
import { zh } from './locales/zh-CN';

export const pasteInsertRowLimit = 1000;
export type PasteInsertMapping = readonly (string | null)[];
export interface PasteInsertPlan { readonly data: readonly DataRow[]; readonly columns: number; readonly metadata: string; }
const preparedPlans = new WeakSet<object>();

/** 摘要有界且类型明确，外部文字NULL不会显示成实际SQL NULL。 */
export function pasteInsertSummary(row: DataRow, key: string): string {
  const value = ownCell(row, key);
  return value === undefined ? text.defaultValue : typeof value === 'string' ? `${text.textValue}：${recordValueSummary(value)}` : recordValueSummary(value);
}

/** 只消费用户本次paste事件提供的数据；未知DBArk格式不能偷偷退回text/plain。 */
export function readPasteInsert(data: Pick<DataTransfer, 'types' | 'getData'>): { values: ClipboardCell[][]; plain: string } {
  const types = Array.from(data.types);
  if (types.some(type => type.startsWith(cellClipboardType) && type !== cellClipboardType)) throw Error(text.typedInvalid);
  const typed = types.includes(cellClipboardType) ? data.getData(cellClipboardType) : '';
  if (types.includes(cellClipboardType) && !typed) throw Error(text.typedInvalid);
  const plain = data.getData('text/plain');
  return { values: decodePasteInsert(typed, plain), plain };
}

/** 复用原10M字符/50k单元解码，先整批检查行数及矩形，再分配预览或草稿。 */
export function decodePasteInsert(typed: string, plain: string): ClipboardCell[][] {
  if (!typed && !plain) throw Error(text.noData);
  if (plain.length > maxClipboardCharacters) throw Error(zh.clipboard.text001);
  const values = decodeClipboard(typed, plain);
  assertShape(values);
  return values;
}
function assertShape(values: readonly (readonly ClipboardCell[])[]) {
  if (!values.length) throw Error(text.noData);
  if (values.length > pasteInsertRowLimit) throw Error(text.rowLimit);
  const width = values[0].length;
  if (!width || values.some(row => row.length !== width)) throw Error(text.shape);
  if (width * values.length > maxClipboardCells) throw Error(text.shape);
}

/** 初始映射只按当前可见可写字段顺序；自增和生成列始终默认省略。 */
export function defaultPasteInsertMapping(info: TableInfo, visible: readonly string[], width: number): PasteInsertMapping {
  const names = visible.filter(name => info.columns.some(column => column.name === name && !column.generated && !/\bauto_increment\b/i.test(column.extra)));
  return Array.from({ length: width }, (_, index) => names[index] ?? null);
}

/** 预览拥有独立值副本；undefined只省略字段，不把DEFAULT与NULL或外部NULL字样混同。 */
export function preparePasteInsert(info: TableInfo, values: readonly (readonly ClipboardCell[])[], mapping: PasteInsertMapping): PasteInsertPlan {
  assertShape(values);
  if (mapping.length !== values[0].length) throw Error(text.mappingInvalid);
  const targets = mapping.filter((key): key is string => key !== null);
  if (!targets.length) throw Error(text.mappingEmpty);
  if (new Set(targets).size !== targets.length || targets.some(name => !info.columns.some(column => column.name === name && !column.generated))) throw Error(text.mappingInvalid);
  const data = values.map(row => {
    const entries = mapping.flatMap<[string, Exclude<ClipboardCell, undefined>]>((name, index) => name === null || row[index] === undefined ? [] : [[name, structuredClone(row[index])!]]);
    const result = Object.fromEntries(entries) as DataRow;
    for (const value of Object.values(result)) if (value && typeof value === 'object') Object.freeze(value);
    return Object.freeze(result);
  });
  const plan = Object.freeze({ data: Object.freeze(data), columns: values[0].length, metadata: tableCopyMetadataKey(info) });
  preparedPlans.add(plan); return plan;
}

/** 本地一次性票据绑定目标、目录及整页引用，关闭/旧回调/元数据ABA都不能消费新页。 */
export class PasteInsertIntent {
  private used = false;
  private readonly metadata: string;
  private readonly target: string;
  constructor(readonly rows: DraftRow[], readonly context: RecordContext, readonly visible: readonly string[]) {
    const reason = recordReadonlyReason(context); if (reason) throw Error(reason);
    if (context.info!.database !== context.target.database || context.info!.name !== context.target.table) throw Error(text.changed);
    this.metadata = tableCopyMetadataKey(context.info!); this.target = recordTargetKey(context.target);
    this.context = { ...context, target: { ...context.target } }; this.visible = [...visible];
  }
  /** 生命周期改变只失效，不重试、回放或自动丢弃任何旧草稿。 */
  invalidate() { this.used = true; }
  reason(rows: DraftRow[], context: RecordContext): string {
    if (this.used) return text.already;
    return recordReadonlyReason(context) || (rows !== this.rows || context.info !== this.context.info || context.generation !== this.context.generation || context.connectionVersion !== this.context.connectionVersion || recordTargetKey(context.target) !== this.target || !context.info || tableCopyMetadataKey(context.info) !== this.metadata ? text.changed : '');
  }
  /** 完整校验后才分配UUID；任一错误都不会发布部分草稿，旧行和旧original引用保持。 */
  consume(plan: PasteInsertPlan, rows: DraftRow[], context: RecordContext, id: () => string): { rows: DraftRow[]; ids: string[] } {
    const reason = this.reason(rows, context); if (reason) throw Error(reason);
    if (!preparedPlans.has(plan) || plan.metadata !== this.metadata || !plan.data.length || plan.data.length > pasteInsertRowLimit) throw Error(text.changed);
    this.used = true;
    const ids = new Set(rows.map(row => row.id)), inserted = plan.data.map(data => {
      const next = id(); if (!next || ids.has(next)) throw Error(text.invalidId); ids.add(next);
      return newDraftRow(next, structuredClone(data));
    });
    return { rows: [...rows, ...inserted], ids: inserted.map(row => row.id) };
  }
}
