import type { FilterGroup, FilterMode, FilterRule, SortRule, TableInfo } from '../shared/contracts';
import { buildFilteredTableSelect } from '../shared/tableReadSql';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { tableFilteredSelectZh as text } from './locales/tableFilteredSelect.zh-CN';

export interface TableFilteredSelectScope { filters: FilterRule[]; filterMode?: FilterMode; filterGroup?: FilterGroup; sort: SortRule[]; }

/** 只冻结已应用条件和原结构；行数据不进入本地SQL编译或新标签。 */
export class TableFilteredSelectIntent {
  readonly info: TableInfo;
  readonly readScope: TableFilteredSelectScope;
  readonly limit: number;
  readonly metadata: string;
  #valid = true;
  #consumed = false;
  #values: readonly unknown[];
  #guard: () => boolean;
  constructor(info: TableInfo, scope: TableFilteredSelectScope, limit: number, values: readonly unknown[], guard: () => boolean) {
    this.info = freeze(structuredClone(info)); this.readScope = freeze(structuredClone(scope)); this.limit = limit;
    this.metadata = tableCopyMetadataKey(info); this.#values = [...values]; this.#guard = guard;
    // 入口即核完整合同，不能把坏字段或坏筛选静默丢弃后生成另一条查询。
    buildFilteredTableSelect({ info: this.info, ...this.readScope, columns: this.info.columns.map(column => column.name), limit });
  }
  /** 渲染身份一旦变化永久撤销，恢复相同值也不能复活原打开动作。 */
  observe(values: readonly unknown[]): void { if (values.length !== this.#values.length || values.some((value, index) => value !== this.#values[index])) this.invalidate(); }
  invalidate(): void { this.#valid = false; }
  current(): boolean { if (this.#valid) { let valid = false; try { valid = this.#guard() === true; } catch {} if (!valid) this.invalidate(); } return this.#valid && !this.#consumed; }
  /** 再次按同一冻结范围生成，供父入口逐字比较预览，而不是信任回传SQL。 */
  compile(columns: readonly string[]): { sql: string; parameters: 0 } {
    if (!this.current()) throw Error(text.changed);
    return buildFilteredTableSelect({ info: this.info, ...this.readScope, columns: [...columns], limit: this.limit });
  }
  /** 只在最终同步来源门和标签预算都通过之后消费；回调抛错也不重复打开。 */
  consume(): boolean { if (!this.current()) return false; this.#consumed = true; return true; }
}

/** 结构和条件合同仅含普通数据；禁止确认期间被父对象原地改写。 */
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
