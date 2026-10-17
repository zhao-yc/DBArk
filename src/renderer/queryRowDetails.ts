import type { CellValue, DataRow, QueryResult, ResultColumn } from '../shared/contracts';

export const queryRowDetailsLimits = Object.freeze({ rows: 100000, columns: 4096, page: 24, preview: 256, expanded: 65536 });
export interface QueryRowDetailsBinding {
  readonly result: QueryResult; readonly rows: DataRow[]; readonly columns: ResultColumn[];
  readonly rowRefs: readonly DataRow[]; readonly columnRefs: readonly ResultColumn[];
  readonly metadata: readonly ResultColumn[]; readonly context: readonly unknown[]; readonly truncated: boolean;
}
export interface QueryRowDetailsView { readonly id: number; readonly binding: QueryRowDetailsBinding; readonly index: number; readonly row: DataRow; readonly values: readonly CellValue[]; }
export interface QueryRowDetailValue { kind: 'null' | 'empty' | 'text' | 'number' | 'boolean' | 'binary'; text: string; units: number; clipped: boolean; }
const blocked = () => new Error('结果行详情已失效，请从当前结果重新选择一行');
/** 不解析JSON、不转换数值字符串；原型同名列只读取自有数据属性。 */
function value(row: DataRow, key: string): CellValue {
  const descriptor = Object.getOwnPropertyDescriptor(row, key);
  if (!descriptor || !('value' in descriptor)) throw blocked();
  const cell: unknown = descriptor.value;
  if (cell === null || typeof cell === 'string' || typeof cell === 'boolean' || typeof cell === 'number' && Number.isFinite(cell)) return cell;
  if (cell && typeof cell === 'object') {
    const type = Object.getOwnPropertyDescriptor(cell, 'type'), base64 = Object.getOwnPropertyDescriptor(cell, 'base64');
    if (type?.value === 'binary' && typeof base64?.value === 'string') return Object.freeze({ type: 'binary', base64: base64.value });
  }
  throw blocked();
}
/** 有界截取不拆开末尾代理对；完整原值仍由原结果持有，详情不深拷贝大字符串。 */
export function queryRowDetailPrefix(text: string, limit: number): string { const end = Math.min(limit, text.length); return text.slice(0, end > 0 && end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]) ? end - 1 : end); }
/** 二进制明确以原Base64展示，空字节不冒充空串；不解码、联网或注入HTML。 */
export function queryRowDetailValue(cell: CellValue, expanded = false): QueryRowDetailValue {
  const kind = cell === null ? 'null' : typeof cell === 'object' ? 'binary' : typeof cell === 'string' ? cell === '' ? 'empty' : 'text' : typeof cell;
  const raw = cell === null ? 'NULL' : typeof cell === 'object' ? cell.base64 : String(cell), text = queryRowDetailPrefix(raw, expanded ? queryRowDetailsLimits.expanded : queryRowDetailsLimits.preview);
  return { kind: kind as QueryRowDetailValue['kind'], text, units: raw.length, clipped: text.length < raw.length };
}
/** 原结果和已打开行的单向租约；旧动作拒绝，不反向撤销较新视图。 */
export class QueryRowDetails {
  #binding?: QueryRowDetailsBinding; #view?: QueryRowDetailsView; #sequence = 0;
  /** 撤销当前代的全部能力，恢复相同输入也只会生成新绑定。 */
  invalidate(): void { this.#binding = undefined; this.#view = undefined; }
  /** 仅绑定预算内的完整原列，列显示布局不参与身份或值投影。 */
  bind(result: QueryResult | undefined, context: readonly unknown[]): QueryRowDetailsBinding | undefined {
    if (!result || !result.columns.length || result.columns.length > queryRowDetailsLimits.columns || result.rows.length > queryRowDetailsLimits.rows) { this.invalidate(); return; }
    const old = this.#binding;
    if (old && this.current(old) && old.result === result && context.length === old.context.length && context.every((item, i) => Object.is(item, old.context[i]))) return old;
    this.invalidate();
    const keys = result.columns.map(column => column.key);
    if (new Set(keys).size !== keys.length || result.columns.some(column => typeof column.key !== 'string' || !column.key || typeof column.name !== 'string' || typeof column.type !== 'string' || column.key.length > 4096 || column.name.length > 4096 || column.type.length > 4096)) return;
    return this.#binding = Object.freeze({ result, rows: result.rows, columns: result.columns, rowRefs: Object.freeze(result.rows.slice()), columnRefs: Object.freeze(result.columns.slice()), metadata: Object.freeze(result.columns.map(column => Object.freeze({ ...column }))), context: Object.freeze([...context]), truncated: result.truncated });
  }
  /** 比较原数组、原位置和元数据；发现漂移后恢复原引用也不能使旧绑定复活。 */
  current(binding: QueryRowDetailsBinding | undefined): binding is QueryRowDetailsBinding {
    if (!binding || binding !== this.#binding) return false;
    const bad = binding.result.rows !== binding.rows || binding.result.columns !== binding.columns || binding.result.truncated !== binding.truncated || binding.rows.length !== binding.rowRefs.length || binding.columns.length !== binding.columnRefs.length || binding.rows.some((row, i) => row !== binding.rowRefs[i]) || binding.columns.some((column, i) => column !== binding.columnRefs[i] || column.key !== binding.metadata[i].key || column.name !== binding.metadata[i].name || column.type !== binding.metadata[i].type);
    if (bad) { this.invalidate(); return false; } return true;
  }
  /** 从原位置捕获只读行值；不按显示名称、主键或行对象反查位置。 */
  open(binding: QueryRowDetailsBinding | undefined, index: number): QueryRowDetailsView {
    if (!this.current(binding) || !Number.isSafeInteger(index) || index < 0 || index >= binding.rows.length) throw blocked();
    const row = binding.rows[index], values = binding.columns.map(column => value(row, column.key));
    if (!Number.isSafeInteger(++this.#sequence)) { this.invalidate(); throw blocked(); }
    return this.#view = Object.freeze({ id: this.#sequence, binding, index, row, values: Object.freeze(values) });
  }
  /** 相同对象内修改值也撤销当前行；不把快照当成可编辑记录。 */
  valid(view: QueryRowDetailsView): boolean {
    if (view !== this.#view || !this.current(view.binding)) return false;
    try {
      if (view.binding.rows[view.index] !== view.row || !view.binding.columns.every((column, i) => {
        const current = value(view.row, column.key), original = view.values[i];
        return typeof current === 'object' && current && typeof original === 'object' && original ? current.type === original.type && current.base64 === original.base64 : Object.is(current, original);
      })) throw blocked();
      return true;
    } catch { this.invalidate(); return false; }
  }
  /** 翻行前复核准确旧视图，迟到动作不能影响已翻到的新行。 */
  move(view: QueryRowDetailsView, index: number): QueryRowDetailsView { if (!this.valid(view)) throw blocked(); return this.open(view.binding, index); }
  /** 关闭仅清除自身视图，不能把较新打开的详情一起关闭。 */
  close(view: QueryRowDetailsView): boolean { if (view !== this.#view) return false; this.#view = undefined; return true; }
}
