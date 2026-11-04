import { sqliteEditValueSchema, sqliteTableEditLimits, type SqliteOriginalValue } from '../shared/sqliteTableEdit';
import type { SqliteDraftRow } from './sqliteTableEditor';
import { sqliteFillSourceCurrent, type SqliteFillSource, type SqliteFillField } from './sqliteTableFill';
import { sqliteRecordBatchZh as text } from './locales/sqliteRecordBatch.zh-CN';
export interface SqliteRecordPatch { rowId: string; fields: readonly SqliteFillField[]; }
/** typed值按原文比较，原非有限REAL、大TEXT／BLOB和DEFAULT不因未触碰而被重新解析。 */
export function sameSqliteBatchValue(left: SqliteOriginalValue | undefined, right: SqliteOriginalValue | undefined): boolean { return left === undefined || right === undefined ? left === right : left.kind === right.kind && (left.kind === 'null' || right.kind !== 'null' && left.value === right.value); }
/** 将窗口每条输入与各自原行比较，任何非法值先拒绝，原来源及其它行始终不变。 */
export function sqliteBatchRow(source: SqliteFillSource, index: number, values?: readonly (SqliteOriginalValue | undefined)[]): SqliteDraftRow {
  if (!sqliteFillSourceCurrent(source, source.page, source.rows) || !Number.isInteger(index) || index < 0 || index >= source.selected.length) throw Error(text.stale);
  const row = source.selected[index], columns = source.page.edit?.kind === 'editable' ? source.page.edit.columns : [];
  if (!values) return row;
  if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype || values.length !== columns.length || Reflect.ownKeys(values).length !== values.length + 1) throw Error(text.invalid);
  const next = columns.map((column, at) => {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(at)); if (!descriptor?.enumerable || !('value' in descriptor)) throw Error(text.invalid);
    const raw: unknown = descriptor.value, before = row.values[at];
    if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))) throw Error(text.invalid);
    const keys = raw === undefined ? [] : Reflect.ownKeys(raw); if (raw !== undefined && (!keys.length || keys.length > 2)) throw Error(text.invalid);
    const copied = raw === undefined ? undefined : Object.fromEntries(keys.map(key => { const item = Object.getOwnPropertyDescriptor(raw, key); if (typeof key !== 'string' || !item?.enumerable || !('value' in item)) throw Error(text.invalid); return [key, item.value]; }));
    if (copied && (!['null','text','integer','real','blob'].includes(copied.kind as string) || (copied.kind === 'null' ? keys.length !== 1 || keys[0] !== 'kind' : keys.length !== 2 || !keys.includes('kind') || !keys.includes('value')))) throw Error(text.invalid);
    if (sameSqliteBatchValue(before, copied as SqliteOriginalValue | undefined)) return before;
    if (column.generated || copied === undefined && row.index !== undefined) throw Error(text.invalid);
    return copied === undefined ? undefined : Object.freeze(sqliteEditValueSchema.parse(copied));
  });
  Object.freeze(next); return Object.freeze({ ...row, values: next });
}
/** 所有勾选记录的窗口缓冲；离开只更新本缓冲，Editor和数据库始终不动。 */
export class SqliteRecordBatch {
  private readonly buffers = new Map<number, SqliteDraftRow>();
  private invalid = false;
  private readonly originals: readonly SqliteDraftRow[];
  constructor(readonly source: SqliteFillSource) {
    if (!this.current() || !source.selected.length) throw Error(text.stale);
    this.originals = source.selected.map(row => { const values = row.values.map(value => value === undefined ? undefined : Object.freeze({ ...value })); Object.freeze(values); return Object.freeze({ ...row, values }); });
  }
  /** 观察失效后留下永久墓碑，恢复同一引用不能复活旧批量输入。 */
  current(): boolean { if (!this.invalid && !sqliteFillSourceCurrent(this.source, this.source.page, this.source.rows)) this.invalid = true; return !this.invalid; }
  row(index: number): SqliteDraftRow { if (!Number.isInteger(index) || index < 0 || index >= this.originals.length) throw Error(text.invalid); return this.buffers.get(index) ?? this.originals[index]; }
  /** 全字段验证后才保留一行；导航失败不留下半行，也不自动暂存原草稿。 */
  keep(index: number, values?: readonly (SqliteOriginalValue | undefined)[]): void {
    if (!this.current()) throw Error(text.stale); this.row(index);
    if (values) { const candidate = sqliteBatchRow(this.source, index, values); this.collect(index, candidate); if (!this.current()) throw Error(text.stale); this.buffers.set(index, candidate); }
  }
  /** 最后当前行只作为临时候选，父级暂存失败时仍可修改后重试，不能消费原输入。 */
  patches(index: number, values: readonly (SqliteOriginalValue | undefined)[]): readonly SqliteRecordPatch[] {
    if (!this.current()) throw Error(text.stale); return this.collect(index, sqliteBatchRow(this.source, index, values));
  }
  /** 行间缓冲也累计完整变化预算，拒绝后保留先前行与当前窗口，不允许累积无界待确认输入。 */
  private collect(index: number, candidate: SqliteDraftRow): readonly SqliteRecordPatch[] {
    const result: SqliteRecordPatch[] = []; let cells = 0, units = 0;
    for (let at = 0; at < this.source.selected.length; at++) {
      const before = this.source.selected[at], after = at === index ? candidate : this.row(at), fields: SqliteFillField[] = [];
      for (let column = 0; column < before.values.length; column++) if (!sameSqliteBatchValue(before.values[column], after.values[column])) {
        if (++cells > sqliteTableEditLimits.cells) throw Error(text.budget);
        const value = after.values[column]; units += this.source.page.columns[column].name.length + (value && value.kind !== 'null' ? value.value.length : 0); if (units > sqliteTableEditLimits.inputUnits) throw Error(text.budget);
        fields.push(Object.freeze({ column, value: value === undefined ? undefined : Object.freeze({ ...value }) }));
      }
      if (fields.length) result.push(Object.freeze({ rowId: before.id, fields: Object.freeze(fields) }));
    }
    return Object.freeze(result);
  }
}
