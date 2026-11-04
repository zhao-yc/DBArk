import type { CellValue } from '../shared/contracts';
import { bindSqliteResultStorage } from '../shared/sqliteResultStorage';
import type { QueryRowDetails, QueryRowDetailsView } from './queryRowDetails';
import { canonicalBinaryBytes } from './recordProjections';
import { assertTextInputBudget } from './boundedTextInput';
import { sqliteReadonlyValue, type SqliteReadonlyValue } from './sqliteReadonlyRecord';
import { queryReadonlyRecordZh as text } from './locales/queryReadonlyRecord.zh-CN';
import type { ReadonlyRecordViewField } from './components/ReadonlyRecordView';

type ReturnedValue = SqliteReadonlyValue | Readonly<{ kind: 'number'; representation: 'javascript-number'; value: string }> | Readonly<{ kind: 'boolean'; value: boolean }>;
export interface QueryReadonlyField { readonly key: string; readonly name: string; readonly protocolType: string; readonly value: ReturnedValue; }
export const queryReadonlyJsonBudget = Object.freeze({ units: 2 * 1024 * 1024, bytes: 2 * 1024 * 1024, message: text.limited });
/** 无SQLite事实时只保留返回值类型；大整数／DECIMAL字串不经Number，也不由协议名称猜测。 */
function returned(value: CellValue): ReturnedValue {
  if (value === null) return Object.freeze({ kind: 'null' });
  if (typeof value === 'string') return Object.freeze({ kind: 'text', value });
  if (typeof value === 'boolean') return Object.freeze({ kind: 'boolean', value });
  if (typeof value === 'number' && Number.isFinite(value)) return Object.freeze({ kind: 'number', representation: 'javascript-number', value: Object.is(value, -0) ? '-0' : String(value) });
  if (value && typeof value === 'object' && value.type === 'binary') return Object.freeze({ kind: 'blob', encoding: 'base64', value: value.base64, bytes: canonicalBinaryBytes(value.base64) });
  throw Error(text.invalid);
}
/** 当前查询结果或固定快照的一行；列键决定身份，重复别名不会合并，完整文档不含SQL或连接信息。 */
export class QueryReadonlyRecord {
  readonly documentFields: readonly QueryReadonlyField[];
  readonly fields: readonly ReadonlyRecordViewField[];
  private readonly storageCurrent: () => boolean;
  private readonly sourceTypes: 'sqlite-storage' | 'returned-values';
  private dead = false;
  constructor(private readonly controller: QueryRowDetails, private readonly view: QueryRowDetailsView, private readonly scope: () => boolean) {
    if (!scope() || !controller.valid(view)) throw Error(text.stale);
    const result = view.binding.result;
    this.storageCurrent = bindSqliteResultStorage(result);
    this.sourceTypes = result.sqliteStorage ? 'sqlite-storage' : 'returned-values';
    const codes = result.sqliteStorage?.rows[view.index];
    this.documentFields = Object.freeze(view.binding.metadata.map((column, index) => Object.freeze({ key: column.key, name: column.name, protocolType: column.type, value: codes === undefined ? returned(view.values[index]) : sqliteReadonlyValue(view.values[index], codes[index]) })));
    this.fields = Object.freeze(this.documentFields.map(field => Object.freeze({ name: field.name, type: field.protocolType, generated: false, kind: field.value.kind, raw: field.value.kind === 'null' ? null : String(field.value.value), parse: field.value.kind === 'text', ...(field.value.kind === 'blob' ? { bytes: field.value.bytes } : {}) })));
    if (!this.current()) throw Error(text.stale);
  }
  /** 原结果、值、类型或外层来源变化后永久失效；大BLOB只比原字串，不深拷贝或序列化。 */
  current(): boolean {
    if (this.dead) return false;
    try { if (!this.scope() || !this.controller.valid(this.view) || !this.storageCurrent()) this.dead = true; } catch { this.dead = true; }
    return !this.dead;
  }
  /** 输出当前完整行而非整个结果集；双预算失败时不返回部分文档，原树仍可查看。 */
  json(): string {
    if (!this.current()) throw Error(text.stale);
    let units = 0;
    for (const field of this.documentFields) { units += field.key.length + field.name.length + field.protocolType.length + (field.value.kind === 'null' ? 0 : String(field.value.value).length); if (units > queryReadonlyJsonBudget.units) throw Error(text.limited); }
    const output = JSON.stringify({ format: 'DBArk-query-record-view', version: 1, complete: true, resultTruncated: this.view.binding.truncated, sourceTypes: this.sourceTypes, fields: this.documentFields }, null, 2);
    assertTextInputBudget(output, queryReadonlyJsonBudget);
    if (!this.current()) throw Error(text.stale); return output;
  }
}
