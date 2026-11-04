import type { CellValue } from '../shared/contracts';
import { assertSqliteStorageTypes, type SqliteTablePage } from '../shared/sqliteTableBrowse';
import type { QueryRowDetails, QueryRowDetailsView } from './queryRowDetails';
import { canonicalBinaryBytes } from './recordProjections';
import { assertTextInputBudget } from './boundedTextInput';
import { sqliteReadonlyRecordZh as text } from './locales/sqliteReadonlyRecord.zh-CN';

export type SqliteReadonlyValue = Readonly<{ kind: 'null' }> | Readonly<{ kind: 'text' | 'integer' | 'real'; value: string }> | Readonly<{ kind: 'blob'; encoding: 'base64'; value: string; bytes: number }>;
export interface SqliteReadonlyField { readonly name: string; readonly declaredType: string; readonly generated: boolean; readonly value: SqliteReadonlyValue; }
export const sqliteReadonlyJsonBudget = Object.freeze({ units: 2 * 1024 * 1024, bytes: 2 * 1024 * 1024, message: text.limited });

/** 只有原完整SQLite表页且结果完全相同才提供新展示方式；旧简化调用继续沿原字段详情。 */
export function sqliteReadonlyRecordAvailable(page: Partial<SqliteTablePage> | undefined, view: QueryRowDetailsView): page is SqliteTablePage {
  return !!page && page.result === view.binding.result && view.binding.context[0] === page && view.binding.context[1] === page.storageTypes && !!page.target && page.target.database === 'main' && ['table', 'view'].includes(page.target.kind) && typeof page.schemaKey === 'string' && /^[a-f0-9]{64}$/.test(page.schemaKey) && Array.isArray(page.columns) && page.columns.length === view.values.length && page.columns.length <= 1024 && Array.isArray(page.storageTypes);
}
/** 类型来自原协议，不把同文TEXT猜成INTEGER；BLOB只核Base64，不解码或分配完整HEX。 */
export function sqliteReadonlyValue(value: CellValue, code: string): SqliteReadonlyValue {
  if (code === 'n' && value === null) return Object.freeze({ kind: 'null' });
  if (code === 't' && typeof value === 'string') return Object.freeze({ kind: 'text', value });
  if (code === 'i' && typeof value === 'string' && value.length <= 20 && /^-?(?:0|[1-9][0-9]*)$/.test(value) && BigInt(value) >= -9223372036854775808n && BigInt(value) <= 9223372036854775807n) return Object.freeze({ kind: 'integer', value });
  if (code === 'r' && typeof value === 'string' && value.length <= 64 && (['Infinity', '-Infinity'].includes(value) || /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(value) && Number.isFinite(Number(value)))) return Object.freeze({ kind: 'real', value });
  if (code === 'b' && value && typeof value === 'object' && value.type === 'binary') return Object.freeze({ kind: 'blob', encoding: 'base64', value: value.base64, bytes: canonicalBinaryBytes(value.base64) });
  throw Error(text.invalid);
}

/** 持有准确只读行和类型事实的单向来源；无编辑快照、IPC或持久化能力。 */
export class SqliteReadonlyRecord {
  readonly fields: readonly SqliteReadonlyField[];
  private readonly columns: SqliteTablePage['columns']; private readonly columnRefs: SqliteTablePage['columns'];
  private readonly types: string[]; private readonly code: string; private readonly target: SqliteTablePage['target']; private readonly targetValue: SqliteTablePage['target']; private readonly schemaKey: string;
  private dead = false;
  constructor(private readonly page: SqliteTablePage, private readonly controller: QueryRowDetails, private readonly view: QueryRowDetailsView, private readonly scope: () => boolean) {
    if (!sqliteReadonlyRecordAvailable(page, view) || !controller.valid(view) || !scope() || page.result.rows[view.index] !== view.row || page.columns.length !== page.result.columns.length) throw Error(text.stale);
    assertSqliteStorageTypes(page);
    this.columns = page.columns; this.columnRefs = page.columns.slice(); this.types = page.storageTypes!; this.code = this.types[view.index]; this.target = page.target; this.targetValue = { ...page.target }; this.schemaKey = page.schemaKey;
    this.fields = Object.freeze(page.columns.map((column, index) => {
      if (column.name !== view.binding.metadata[index].name || typeof column.declaredType !== 'string') throw Error(text.invalid);
      return Object.freeze({ name: column.name, declaredType: column.declaredType, generated: column.generated === true, value: sqliteReadonlyValue(view.values[index], this.code[index]) });
    }));
    if (!this.current()) throw Error(text.stale);
  }
  /** 观察到结构、类型、行或外层来源变化即永久失效，恢复同一引用不能复活。 */
  current(): boolean {
    if (this.dead) return false;
    try {
      if (!this.scope() || !this.controller.valid(this.view) || this.page.result !== this.view.binding.result || this.page.result.rows[this.view.index] !== this.view.row || this.page.columns !== this.columns || this.columns.length !== this.fields.length || this.columns.some((column, index) => column !== this.columnRefs[index] || column.name !== this.fields[index].name || column.declaredType !== this.fields[index].declaredType || (column.generated === true) !== this.fields[index].generated) || this.page.storageTypes !== this.types || this.types.length !== this.page.result.rows.length || this.types[this.view.index] !== this.code || this.page.schemaKey !== this.schemaKey || this.page.target !== this.target || Object.keys(this.targetValue).some(key => this.target[key as keyof typeof this.target] !== this.targetValue[key as keyof typeof this.targetValue])) this.dead = true;
    } catch { this.dead = true; }
    return !this.dead;
  }
  /** 整行完整输出独立于显示筛选；先核原文总量再序列化，超限不提供部分文档。 */
  json(): string {
    if (!this.current()) throw Error(text.stale);
    let units = 0;
    for (const field of this.fields) { units += field.name.length + field.declaredType.length + (field.value.kind === 'null' ? 0 : field.value.value.length); if (units > sqliteReadonlyJsonBudget.units) throw Error(text.limited); }
    const result = JSON.stringify({ format: 'DBArk-SQLite-record-view', version: 1, complete: true, fields: this.fields }, null, 2); assertTextInputBudget(result, sqliteReadonlyJsonBudget);
    if (!this.current()) throw Error(text.stale); return result;
  }
}
