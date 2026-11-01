import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { SqliteDraftRow } from './sqliteTableEditor';
import { encodeSqliteClipboard, decodeSqliteClipboard, convertSqliteClipboardCell, sqliteClipboardLimits, type SqliteClipboardCell, type SqlitePasteKind } from './sqliteTableClipboard';
import { sqliteTableRangePasteZh as text } from './locales/sqliteTableRangePaste.zh-CN';

export interface SqlitePasteAnchor { row: SqliteDraftRow; column: number; }
export interface SqliteRangePastePlan { readonly rows: number; readonly width: number; readonly changedCells: number; readonly startRow: number; readonly endRow: number; readonly startColumn: number; readonly endColumn: number; readonly columns: readonly string[]; }
export interface SqliteRangePastePreviewCell { column: string; oldValue: SqliteClipboardCell; newValue: SqliteClipboardCell; changed: boolean; }
export interface SqliteRangePastePreview { columns: string[]; rows: { row: number; cells: SqliteRangePastePreviewCell[] }[]; }
interface RowOwner { row: SqliteDraftRow; id: string; index: number | undefined; deleted: boolean; values: SqliteDraftRow['values']; width: number; }
interface Prepared { page: SqliteTablePage; rows: readonly SqliteDraftRow[]; rowOwners: RowOwner[]; anchor: SqlitePasteAnchor; schema: string; before: string[][]; values: SqliteClipboardCell[][]; }
const plans = new WeakMap<SqliteRangePastePlan, Prepared>();
const allowed: readonly SqlitePasteKind[] = ['preserve', 'text', 'integer', 'real', 'blob', 'null', 'default'];
/** 只使用准确Main编辑快照；来源剪贴板的字段名或自带标志不能授予修改资格。 */
function editable(page: SqliteTablePage) {
  const edit = page.edit;
  if (edit?.kind !== 'editable' || page.target.kind !== 'table' || page.target.database !== 'main') throw Error(text.readonly);
  if (!edit.snapshotId || !edit.columns.length || edit.columns.length > sqliteClipboardLimits.columns || edit.columns.length !== page.columns.length || edit.columns.some((column, index) => column.name !== page.columns[index].name || !!column.generated !== !!page.columns[index].generated)) throw Error(text.invalid);
  return edit;
}
/** 目录的全部字段及原定位/有效期纳入签名，不能同引用静默更换目标后沿用旧计划。 */
function metadata(page: SqliteTablePage): string { const edit = editable(page); return JSON.stringify([page.schemaKey, page.target, page.columns, edit.snapshotId, edit.expiresAt, edit.columns, edit.locator]); }
/** 稀疏、访问器和额外键数组不能把未检查内容伪装成空单元格。 */
function pureArray(raw: unknown, maximum: number): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > maximum || Reflect.ownKeys(raw).length !== raw.length + 1) throw Error(text.invalid);
  const values: unknown[] = []; for (let index = 0; index < raw.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(raw, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) throw Error(text.invalid); values.push(descriptor.value); } return values;
}
/** row对象必须属于这一个原草稿数组；同id新对象、行头或失效起点都不是原位置。 */
function start(page: SqliteTablePage, rows: readonly SqliteDraftRow[], anchor: SqlitePasteAnchor): number {
  editable(page); if (!Array.isArray(rows) || !anchor || !Number.isInteger(anchor.column) || anchor.column < 0 || anchor.column >= page.columns.length) throw Error(text.anchorRequired);
  const index = rows.indexOf(anchor.row); if (index < 0) throw Error(text.anchorRequired); return index;
}
/** 按kind/value内容生成相关原值签名，不受对象属性次序影响；DEFAULT和NULL不同，原REAL无穷可展示。 */
function signature(value: SqliteClipboardCell): string { return value === undefined ? 'DEFAULT' : value.kind === 'null' ? 'NULL' : JSON.stringify([value.kind, value.value]); }
/** 原rows对象及其每行/值数组身份均保持；原地改相关值同样使计划失效。 */
function assertPlan(plan: SqliteRangePastePlan, page: SqliteTablePage, rows: readonly SqliteDraftRow[], anchor: SqlitePasteAnchor): Prepared {
  const prepared = plans.get(plan); if (!prepared || prepared.page !== page || prepared.rows !== rows || prepared.anchor.row !== anchor?.row || prepared.anchor.column !== anchor?.column || prepared.schema !== metadata(page) || prepared.rowOwners.length !== rows.length) throw Error(text.stale);
  for (let index = 0; index < rows.length; index++) { const row = rows[index], owner = prepared.rowOwners[index]; if (row !== owner.row || row.id !== owner.id || row.index !== owner.index || row.deleted !== owner.deleted || row.values !== owner.values || row.values.length !== owner.width) throw Error(text.stale); }
  const offset = rows.indexOf(anchor.row); if (offset !== plan.startRow - 1) throw Error(text.stale);
  for (let row = 0; row < plan.rows; row++) for (let column = 0; column < plan.width; column++) if (signature(rows[offset + row].values[anchor.column + column]) !== prepared.before[row][column]) throw Error(text.stale);
  return prepared;
}
/** 完整矩形先预检再签发；按起点位置逐格转换，任何错误都不发布部分修改。 */
export function prepareSqliteRangePaste(page: SqliteTablePage, rows: readonly SqliteDraftRow[], anchor: SqlitePasteAnchor, input: readonly (readonly SqliteClipboardCell[])[], kinds?: readonly SqlitePasteKind[]): SqliteRangePastePlan {
  const edit = editable(page), offset = start(page, rows, anchor); if (Array.isArray(input) && input.length > sqliteClipboardLimits.pasteRows) throw Error(text.rowLimit);
  // 复用既有纯编码/解码的500行、10000格、2MiB、Unicode及原动态类型门；不访问任何系统剪贴板。
  const copied = encodeSqliteClipboard(input), values = decodeSqliteClipboard(copied.sqlite, '', '').values, height = values.length, width = values[0].length;
  if (offset + height > rows.length || anchor.column + width > edit.columns.length) throw Error(text.outOfBounds);
  const conversions = kinds === undefined ? Array<SqlitePasteKind>(width).fill('preserve') : pureArray(kinds, width); if (conversions.length !== width || conversions.some(kind => typeof kind !== 'string' || !allowed.includes(kind as SqlitePasteKind))) throw Error(text.kindsInvalid);
  if (edit.columns.slice(anchor.column, anchor.column + width).some(column => column.generated)) throw Error(text.generated);
  const result: SqliteClipboardCell[][] = [], before: string[][] = []; let changedCells = 0;
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    const target = rows[offset + rowIndex]; if (target.deleted) throw Error(text.deleted); if (!Array.isArray(target.values) || target.values.length !== edit.columns.length || typeof target.id !== 'string' || !target.id || target.index !== undefined && (!Number.isInteger(target.index) || target.index < 0 || target.index >= edit.rows.length)) throw Error(text.invalid);
    const next: SqliteClipboardCell[] = [], original: string[] = [];
    for (let column = 0; column < width; column++) { const value = convertSqliteClipboardCell(values[rowIndex][column], conversions[column] as SqlitePasteKind); if (value === undefined && target.index !== undefined) throw Error(text.defaultExisting); const previous = signature(target.values[anchor.column + column]); if (previous !== signature(value)) changedCells++; original.push(previous); next.push(value); }
    before.push(original); result.push(next);
  }
  // 目标转换可能放大BLOB为TEXT；重新通过整组预算再保管结果，不绕过原输入门。
  const normalized = decodeSqliteClipboard(encodeSqliteClipboard(result).sqlite, '', '').values;
  const plan: SqliteRangePastePlan = Object.freeze({ rows: height, width, changedCells, startRow: offset + 1, endRow: offset + height, startColumn: anchor.column + 1, endColumn: anchor.column + width, columns: Object.freeze(edit.columns.slice(anchor.column, anchor.column + width).map(column => column.name)) });
  plans.set(plan, { page, rows, rowOwners: rows.map(row => ({ row, id: row.id, index: row.index, deleted: row.deleted, values: row.values, width: row.values.length })), anchor: { row: anchor.row, column: anchor.column }, schema: metadata(page), before, values: normalized }); return plan;
}
/** 原页、原rows及准确起点再次核对；只交区域矩阵副本，实际editor仍要完整再校验预算和票据。 */
export function sqliteRangePastePlanValues(plan: SqliteRangePastePlan, page: SqliteTablePage, rows: readonly SqliteDraftRow[], anchor: SqlitePasteAnchor): SqliteClipboardCell[][] { return assertPlan(plan, page, rows, anchor).values.map(row => row.map(value => value === undefined ? undefined : { ...value })); }
/** 预览不消费计划，仅复制前10行old/new；来源列名不改变实际按位置的目标顺序。 */
export function sqliteRangePastePreview(plan: SqliteRangePastePlan, page: SqliteTablePage, rows: readonly SqliteDraftRow[], anchor: SqlitePasteAnchor): SqliteRangePastePreview {
  const prepared = assertPlan(plan, page, rows, anchor), offset = plan.startRow - 1;
  const clone = (value: SqliteClipboardCell): SqliteClipboardCell => value === undefined ? undefined : { ...value };
  return { columns: [...plan.columns], rows: prepared.values.slice(0, 10).map((values, index) => ({ row: offset + index + 1, cells: values.map((value, column) => ({ column: plan.columns[column], oldValue: clone(rows[offset + index].values[anchor.column + column]), newValue: clone(value), changed: prepared.before[index][column] !== signature(value) })) })) };
}
