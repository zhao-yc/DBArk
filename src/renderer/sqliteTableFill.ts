import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteTableEditLimits, type SqliteOriginalValue } from '../shared/sqliteTableEdit';
import type { SqliteDraftRow } from './sqliteTableEditor';
import { sqliteTableEditZh as text } from './locales/sqliteTableEdit.zh-CN';

export interface SqliteFillField { column: number; value: SqliteOriginalValue | undefined; }
export interface SqliteFillSource {
  readonly page: SqliteTablePage; readonly rows: readonly SqliteDraftRow[]; readonly selected: readonly SqliteDraftRow[];
  readonly columns: readonly number[]; readonly allNew: boolean;
}
/** 来源沿原64MiB快照与driver单值1MiB门；BLOB原字节转十六进制后允许两倍文本长度。 */
export const sqliteFillSourceLimits = { rows: 1500, columns: 1024, bytes: sqliteTableEditLimits.snapshotBytes, valueBytes: 1024 * 1024 } as const;
interface RowOwner { row: SqliteDraftRow; id: string; index: number | undefined; deleted: boolean; values: SqliteDraftRow['values']; cells: (SqliteOriginalValue | undefined)[]; }
interface BaselineOwner { values: readonly unknown[]; cells: (SqliteOriginalValue | undefined)[]; }
interface Owner { page: SqliteTablePage; rows: readonly SqliteDraftRow[]; edit: SqliteTablePage['edit']; columns: SqliteTablePage['columns']; editColumns: object; baseline: object; baselineOwners: BaselineOwner[]; metadata: string; owners: RowOwner[]; valid: boolean; }
const sources = new WeakMap<SqliteFillSource, Owner>(), encoder = new TextEncoder();
const unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
/** 自有data记录先核描述符，禁止来源校验执行getter或接受继承字段。 */
function data(raw: unknown, maximum: number): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw Error(text.invalid);
  const keys = Reflect.ownKeys(raw); if (keys.length > maximum) throw Error(text.invalid); const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) { const item = Object.getOwnPropertyDescriptor(raw, key); if (typeof key !== 'string' || !item?.enumerable || !('value' in item)) throw Error(text.invalid); result[key] = item.value; } return result;
}
/** 稠密数组长度先界定，随后只取自有数据；先验阶段不复制任何原文。 */
function array(raw: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > maximum || Reflect.ownKeys(raw).length !== raw.length + 1) throw Error(text.invalid);
  for (let i = 0; i < raw.length; i++) { const value = Object.getOwnPropertyDescriptor(raw, String(i)); if (!value?.enumerable || !('value' in value)) throw Error(text.invalid); } return raw;
}
/** 目录仅复制小型纯值，不扫描page.result；包含原定位、有效期及全字段事实。 */
function metadata(page: SqliteTablePage): { edit: Extract<NonNullable<SqliteTablePage['edit']>, { kind: 'editable' }>; columns: SqliteTablePage['columns']; signature: string } {
  const source = data(page, 16), edit = data(source.edit, 8), target = data(source.target, 4);
  if (edit.kind !== 'editable' || target.database !== 'main' || target.kind !== 'table' || typeof edit.snapshotId !== 'string' || !edit.snapshotId || typeof edit.expiresAt !== 'string' || !Number.isFinite(Date.parse(edit.expiresAt)) || typeof source.schemaKey !== 'string') throw Error(text.invalid);
  const columns = array(source.columns, sqliteFillSourceLimits.columns), editColumns = array(edit.columns, sqliteFillSourceLimits.columns); if (!columns.length || columns.length !== editColumns.length) throw Error(text.invalid);
  for (let i = 0; i < columns.length; i++) { const column = data(columns[i], 3), actual = data(editColumns[i], 5); if (typeof column.name !== 'string' || !column.name || column.name.length > 512 || !unicode(column.name) || column.name.includes('\0') || column.name !== actual.name || !!column.generated !== actual.generated) throw Error(text.invalid); }
  let nodes = 0, bytes = 0;
  /** 元数据也须有界且无访问器，避免JSON.stringify调用toJSON或复制巨量字段。 */
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > 32768 || depth > 6) throw Error(text.invalid);
    if (value === undefined || value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') { if (value.length > sqliteFillSourceLimits.valueBytes || !unicode(value)) throw Error(text.invalid); bytes += encoder.encode(value).byteLength; if (bytes > sqliteFillSourceLimits.bytes) throw Error(text.invalid); return value; }
    if (Array.isArray(value)) return array(value, 1024).map(item => copy(item, depth + 1));
    const fields = data(value, 8); return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, copy(item, depth + 1)]));
  };
  const signature = JSON.stringify(copy([source.schemaKey, source.target, source.columns, edit.snapshotId, edit.expiresAt, edit.columns, edit.locator], 0));
  return { edit: source.edit as Extract<NonNullable<SqliteTablePage['edit']>, { kind: 'editable' }>, columns: source.columns as SqliteTablePage['columns'], signature };
}
/** 原动态类型只保留primitive，不重解析或转换；合法大TEXT、原非有限REAL均可作为未触碰来源。 */
function cell(raw: unknown, account?: (bytes: number) => void): SqliteOriginalValue | undefined {
  account?.(32); if (raw === undefined) return undefined; const fields = data(raw, 2);
  if (fields.kind === 'null' && Object.keys(fields).length === 1) return { kind: 'null' };
  if (!['text', 'integer', 'real', 'blob'].includes(fields.kind as string) || Object.keys(fields).length !== 2 || typeof fields.value !== 'string' || !unicode(fields.value)) throw Error(text.invalid);
  const maximum = fields.kind === 'blob' ? sqliteFillSourceLimits.valueBytes * 2 : sqliteFillSourceLimits.valueBytes;
  if (fields.value.length > maximum) throw Error(text.invalid); const bytes = encoder.encode(fields.value).byteLength; if (bytes > maximum) throw Error(text.invalid); account?.(bytes);
  return { kind: fields.kind as 'text' | 'integer' | 'real' | 'blob', value: fields.value };
}
/** 每行形状和准确values数组都纳入来源；同id新行或后来删除都不能沿用旧授权。 */
function row(raw: unknown, width: number, originals: number, account?: (bytes: number) => void): RowOwner {
  const fields = data(raw, 4);
  if (Object.keys(fields).some(key => !['id', 'index', 'values', 'deleted'].includes(key)) || typeof fields.id !== 'string' || !fields.id || fields.id.length > 200 || typeof fields.deleted !== 'boolean' || fields.index !== undefined && (!Number.isInteger(fields.index) || (fields.index as number) < 0 || (fields.index as number) >= originals)) throw Error(text.invalid);
  const values = array(fields.values, sqliteFillSourceLimits.columns); if (values.length !== width) throw Error(text.invalid);
  account?.(64 + encoder.encode(fields.id).byteLength); const cells = values.map(value => cell(value, account));
  return { row: raw as SqliteDraftRow, id: fields.id, index: fields.index as number | undefined, deleted: fields.deleted, values: fields.values as SqliteDraftRow['values'], cells };
}
/** 已签发primitive已通过字节/Unicode预算；复核只读描述符及原内容，不为每次按键重新编码原文。 */
function sameCell(raw: unknown, before: SqliteOriginalValue | undefined): boolean {
  if (before === undefined) return raw === undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return false;
  const keys = Reflect.ownKeys(raw); if (keys.length !== (before.kind === 'null' ? 1 : 2)) return false;
  const kind = Object.getOwnPropertyDescriptor(raw, 'kind'); if (!kind?.enumerable || !('value' in kind) || kind.value !== before.kind) return false;
  if (before.kind === 'null') return true;
  const value = Object.getOwnPropertyDescriptor(raw, 'value'); return !!value?.enumerable && 'value' in value && value.value === before.value;
}
/** 勾选来源按展示顺序签发，不冻结真实rows；私有副本只保存有界typed primitive与原物理引用。 */
export function prepareSqliteFill(page: SqliteTablePage, rows: readonly SqliteDraftRow[], selected: readonly SqliteDraftRow[]): SqliteFillSource {
  const info = metadata(page), all = array(rows, sqliteFillSourceLimits.rows), requested = array(selected, sqliteFillSourceLimits.rows), baseline = array(info.edit.rows, 1000);
  if (!requested.length) throw Error(text.invalid); const requestedSet = new Set(requested); if (requestedSet.size !== requested.length || requested.some(item => !all.includes(item))) throw Error(text.invalid);
  let bytes = encoder.encode(info.signature).byteLength; const account = (size: number) => { bytes += size; if (bytes > sqliteFillSourceLimits.bytes) throw Error(text.invalid); };
  const owners = all.map(item => row(item, info.columns.length, baseline.length, account));
  if (new Set(owners.map(item => item.id)).size !== owners.length || owners.some(item => requestedSet.has(item.row) && item.deleted)) throw Error(text.invalid);
  const originals = new Map<number, RowOwner>();
  for (const owner of owners) if (owner.index !== undefined) { if (originals.has(owner.index)) throw Error(text.invalid); originals.set(owner.index, owner); }
  const baselineOwners = baseline.map((raw, index) => {
    const values = array(raw, sqliteFillSourceLimits.columns); if (values.length !== info.columns.length) throw Error(text.invalid);
    // 未修改的原值与draft复用已签primitive记录，新增引用槽也计预算，不重复编码大原文。
    account(16 + values.length * 8); const original = originals.get(index);
    const cells = values.map((value, column) => { if (value === undefined) throw Error(text.invalid); return original && sameCell(value, original.cells[column]) ? original.cells[column] : cell(value, account); });
    return { values, cells };
  });
  const ordered = Object.freeze(owners.filter(item => requestedSet.has(item.row)).map(item => item.row)), columns = Object.freeze(info.edit.columns.flatMap((item, index) => item.generated ? [] : [index])); if (!columns.length) throw Error(text.invalid);
  const source = Object.freeze({ page, rows, selected: ordered, columns, allNew: ordered.every(item => item.index === undefined) });
  sources.set(source, { page, rows, edit: info.edit, columns: info.columns, editColumns: info.edit.columns, baseline: info.edit.rows, baselineOwners, metadata: info.signature, owners, valid: true }); return source;
}
/** 失效即留下墓碑；恢复相同引用或同值不重新授予旧source，必须由当前选择重新签发。 */
export function sqliteFillSourceCurrent(source: SqliteFillSource, page: SqliteTablePage, rows: readonly SqliteDraftRow[]): boolean {
  const owner = sources.get(source); if (!owner?.valid) return false;
  try {
    const info = metadata(page), all = array(rows, sqliteFillSourceLimits.rows);
    if (owner.page !== page || owner.rows !== rows || owner.edit !== info.edit || owner.columns !== info.columns || owner.editColumns !== info.edit.columns || owner.baseline !== info.edit.rows || owner.metadata !== info.signature || owner.owners.length !== all.length) throw Error(text.stale);
    for (let i = 0; i < all.length; i++) {
      const before = owner.owners[i], after = data(all[i], 4);
      if (before.row !== all[i] || before.id !== after.id || before.index !== after.index || before.deleted !== after.deleted || before.values !== after.values) throw Error(text.stale);
      const values = array(after.values, sqliteFillSourceLimits.columns); if (values.length !== before.cells.length) throw Error(text.stale);
      for (let column = 0; column < values.length; column++) if (!sameCell(Object.getOwnPropertyDescriptor(values, String(column))!.value, before.cells[column])) throw Error(text.stale);
    }
    const baseline = array(info.edit.rows, 1000); if (baseline.length !== owner.baselineOwners.length) throw Error(text.stale);
    for (let i = 0; i < baseline.length; i++) { const before = owner.baselineOwners[i], values = array(baseline[i], sqliteFillSourceLimits.columns); if (values !== before.values || values.length !== before.cells.length) throw Error(text.stale); for (let column = 0; column < values.length; column++) if (!sameCell(Object.getOwnPropertyDescriptor(values, String(column))!.value, before.cells[column])) throw Error(text.stale); }
    return true;
  } catch { owner.valid = false; return false; }
}
