import type { CellValue, QueryResult, ResultColumn, SortRule } from '../shared/contracts';
import { queryResultSortZh as text } from './locales/queryResultSort.zh-CN';

export const queryResultSortLimits = { rows: 100000, columns: 1024, cells: 2000000, valueUnits: 4096, units: 8 * 1024 * 1024 } as const;
type Kind = 'integer' | 'decimal' | 'float' | 'text' | 'date' | 'datetime' | 'time';
type Exact = { negative: boolean; whole: string; fraction: string };
type Key = null | number | string | Exact;
/** 仅本地快照使用的空值位置；不扩展服务端ORDER BY或共享IPC排序合同。 */
export type QueryResultSortRule = SortRule & { nulls?: 'FIRST' | 'LAST' };
export interface QueryResultSortView { readonly result: QueryResult; readonly sourceIndices: readonly number[]; readonly rules: readonly QueryResultSortRule[]; }
export interface QueryResultSortBinding {
  readonly source: QueryResult; readonly rows: QueryResult['rows']; readonly rowRefs: readonly QueryResult['rows'][number][];
  readonly columns: QueryResult['columns']; readonly columnRefs: readonly ResultColumn[]; readonly metadata: readonly ResultColumn[]; readonly visible: ResultColumn[];
  readonly visibleRefs: readonly ResultColumn[]; readonly context: readonly unknown[]; readonly truncated: boolean;
  readonly reasons: ReadonlyMap<string, string | undefined>;
}
const failure = () => new Error(text.stale);

/** 只接纳已有协议类型及明确SQL别名，不从列名或单元格外观猜测类型。 */
function kind(type: string): Kind | undefined {
  if (typeof type !== 'string' || type.length > 4096) return;
  const match = /^([A-Z_]+)(?:\([0-9, ]+\))?(?: UNSIGNED)?$/.exec(type.trim().toUpperCase());
  const base = match?.[1];
  if (base && ['TINY','SHORT','LONG','INT24','LONGLONG','TINYINT','SMALLINT','MEDIUMINT','INT','INTEGER','BIGINT','YEAR'].includes(base)) return 'integer';
  if (base && ['DECIMAL','NEWDECIMAL','NUMERIC'].includes(base)) return 'decimal';
  if (base === 'FLOAT' || base === 'DOUBLE') return 'float';
  if (type.trim().toUpperCase().endsWith(' UNSIGNED')) return;
  if (base && ['VARCHAR','VAR_STRING','STRING','CHAR','TEXT','TINYTEXT','MEDIUMTEXT','LONGTEXT','ENUM','SET','JSON','TINY_BLOB','MEDIUM_BLOB','LONG_BLOB','BLOB'].includes(base)) return 'text';
  if (base === 'DATE' || base === 'NEWDATE') return 'date';
  if (base === 'DATETIME' || base === 'TIMESTAMP') return 'datetime';
  if (base === 'TIME') return 'time';
}
/** 精确十进制按数字文本比较；负零与前导/尾随零归一，但不改原值。 */
function exact(value: string, integer: boolean): Exact {
  if (!(integer ? /^[+-]?\d+$/ : /^[+-]?\d+(?:\.\d+)?$/).test(value)) throw Error(text.value);
  const negative = value[0] === '-', unsigned = /^[+-]/.test(value) ? value.slice(1) : value;
  const [raw, fraction = ''] = unsigned.split('.'), whole = raw.replace(/^0+(?=\d)/, ''), decimal = fraction.replace(/0+$/, '');
  return { negative: negative && (whole !== '0' || decimal !== ''), whole, fraction: decimal };
}
/** 时间只比较已返回字段，保留微秒、负TIME及三位小时；不创建Date或做时区推断。 */
function temporal(value: string, type: Kind): string | Exact {
  if (type === 'time') {
    const m = /^(-?)(\d{1,3}):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?$/.exec(value);
    if (!m || m[2].padStart(3,'0') > '838') throw Error(text.value);
    return exact(m[1] + m[2] + m[3] + m[4] + '.' + (m[5] ?? '0'), false);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]([0-2]\d):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?)?$/.exec(value);
  // MySQL零日期按原字段比较；不把缺失/异常时区文字猜成一个时刻。
  if (!m || m[2] > '12' || m[3] > '31' || m[4] && m[4] > '23' || (type === 'date') !== !m[4]) throw Error(text.value);
  return m[1]+m[2]+m[3]+(type === 'date' ? '' : m[4]+m[5]+m[6]+(m[7] ?? '').padEnd(6,'0'));
}
/** 只读取自有数据属性，访问器和二进制不能进入排序比较器。 */
function cell(row: QueryResult['rows'][number], column: ResultColumn): CellValue {
  const descriptor = Object.getOwnPropertyDescriptor(row, column.key);
  if (!descriptor || !('value' in descriptor)) throw Error(text.value);
  return descriptor.value;
}
/** 协议数值只按已存在表示接纳；精确类型的非整数number已失去精度，必须拒绝。 */
function key(value: CellValue, type: Kind, unsigned = false): Key {
  if (value === null) return null;
  if (typeof value === 'string' && value.length > queryResultSortLimits.valueUnits) throw Error(text.budget);
  if (type === 'float') { if (typeof value !== 'number' || !Number.isFinite(value) || unsigned && value < 0) throw Error(text.value); return value; }
  if (type === 'integer' || type === 'decimal') {
    let parsed: Exact;
    if (typeof value === 'number') { if (!Number.isSafeInteger(value)) throw Error(text.value); parsed=exact(String(value),true); }
    else { if (typeof value !== 'string') throw Error(text.value); parsed=exact(value,type==='integer'); }
    if (unsigned && parsed.negative) throw Error(text.value); return parsed;
  }
  if (typeof value !== 'string') throw Error(text.value);
  return type === 'text' ? value : temporal(value, type);
}
/** 无locale/Number转换的总序；相等键由调用方按原位置稳定打破。 */
function compare(a: Key, b: Key): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  if (typeof a === 'number' && typeof b === 'number' || typeof a === 'string' && typeof b === 'string') return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a !== 'object' || typeof b !== 'object') throw Error(text.value);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  let order = a.whole.length === b.whole.length ? a.whole === b.whole ? 0 : a.whole < b.whole ? -1 : 1 : a.whole.length < b.whole.length ? -1 : 1;
  for (let i = 0; !order && i < Math.max(a.fraction.length,b.fraction.length); i++) { const left=a.fraction[i] ?? '0', right=b.fraction[i] ?? '0'; if (left !== right) order=left < right ? -1 : 1; }
  return a.negative ? -order : order;
}

/** 筛选与排序共用原比较器；精确类型和时间不经Number/Date，未知类型不给比较资格。 */
export function queryResultFilterKind(column: ResultColumn): 'text' | 'ordered' | undefined {
  const type=kind(column.type);return type==='text'?'text':type?'ordered':undefined;
}
/** 条件输入只按声明类型准入；仅原本浮点类型允许转有限number，精确数值保留字符串。 */
export function queryResultFilterLiteral(column: ResultColumn, value: string): CellValue {
  const type=kind(column.type);if(!type)throw Error(text.type);
  const raw=type==='text'?value:value.trim();let literal:CellValue=raw;
  if(type==='float'){if(!/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw))throw Error(text.value);literal=Number(raw);}
  key(literal,type,column.type.trim().toUpperCase().endsWith(' UNSIGNED'));return literal;
}
/** 返回筛选的已准入键；复用相同NULL、精确小数、原时间字段规则，不猜二进制。 */
export function queryResultFilterKey(column: ResultColumn, value: CellValue): Key {
  const type=kind(column.type);if(!type)throw Error(text.type);return key(value,type,column.type.trim().toUpperCase().endsWith(' UNSIGNED'));
}
export { compare as compareQueryResultFilterKeys };

/** 当前结果单向租约与行索引投影；复用原选择/查找/详情合同，不向行中注入伪造主键。 */
export class QueryResultSort {
  private binding?: QueryResultSortBinding;
  private projection?: QueryResultSortView;
  private values?: { column: ResultColumn; values: CellValue[] }[];
  /** 只冻结本地索引、完整优先级与视图容器，绝不冻结或克隆原行对象。 */
  private project(binding: QueryResultSortBinding, sourceIndices: number[], rules: readonly QueryResultSortRule[] = []): QueryResultSortView {
    const frozenRules=Object.freeze(rules.map(rule=>Object.freeze({...rule})));
    if (!rules.length) return Object.freeze({result:binding.source,sourceIndices:Object.freeze(sourceIndices),rules:frozenRules});
    const rows = sourceIndices.map(i=>binding.rows[i]); Object.freeze(rows);
    return Object.freeze({ result:Object.freeze({...binding.source,rows}), sourceIndices:Object.freeze(sourceIndices), rules:frozenRules });
  }
  /** 旧闭包被撤销后不能靠同样对象恢复；这里只清本地视图。 */
  invalidate(): void { this.binding = undefined; this.projection = undefined; this.values = undefined; }
  /** 显示代次包含原结果、可见列与业务上下文；追加批次也会产生全新未排序视图。 */
  bind(source: QueryResult | undefined, context: readonly unknown[], visible = source?.columns): QueryResultSortBinding | undefined {
    if (!source || !visible || !source.columns.length || source.rows.length > queryResultSortLimits.rows || source.columns.length > queryResultSortLimits.columns) { this.invalidate(); return; }
    const old = this.binding;
    if (old && this.current(old) && old.source === source && old.visible === visible && context.length === old.context.length && context.every((v,i)=>Object.is(v,old.context[i]))) return old;
    this.invalidate();
    const reasons = new Map<string,string | undefined>(), keys=source.columns.map(column=>column.key);
    const identity = keys.every(key=>typeof key==='string'&&key.length>0) && new Set(keys).size === keys.length && new Set(visible.map(c=>c.key)).size === visible.length && new Set(source.rows).size === source.rows.length && visible.every(column=>source.columns.includes(column));
    let units=0;
    for (const column of visible) {
      const type=kind(column.type);
      if (!identity) { reasons.set(column.key,text.identity); continue; }
      if (!type) { reasons.set(column.key,text.type); continue; }
      const unsigned=column.type.trim().toUpperCase().endsWith(' UNSIGNED');
      if (source.rows.length * visible.length > queryResultSortLimits.cells || units > queryResultSortLimits.units) { reasons.set(column.key,text.budget); continue; }
      try {
        for (const row of source.rows) { const value=cell(row,column); units += typeof value === 'string' ? value.length : 1; if (units > queryResultSortLimits.units) throw Error(text.budget); key(value,type,unsigned); }
        reasons.set(column.key,undefined);
      } catch (reason) { reasons.set(column.key,reason instanceof Error && reason.message === text.budget ? text.budget : text.value); }
    }
    const binding:QueryResultSortBinding = { source, rows:source.rows, rowRefs:source.rows.slice(), columns:source.columns, columnRefs:source.columns.slice(), metadata:source.columns.map(c=>({...c})), visible, visibleRefs:visible.slice(),context:[...context],truncated:source.truncated,reasons };
    this.binding=binding; this.projection=this.project(binding,source.rows.map((_,i)=>i)); return binding;
  }
  /** 行位置/列身份及排序键漂移即永久撤销；旧binding不能影响较新的视图。 */
  current(binding: QueryResultSortBinding | undefined): binding is QueryResultSortBinding {
    if (!binding || this.binding !== binding) return false;
    if (binding.source.rows !== binding.rows || binding.source.columns !== binding.columns || binding.source.truncated !== binding.truncated || binding.rows.length !== binding.rowRefs.length || binding.columns.length !== binding.metadata.length || binding.rows.some((r,i)=>r!==binding.rowRefs[i]) || binding.columns.some((c,i)=>c!==binding.columnRefs[i]||c.key!==binding.metadata[i].key||c.name!==binding.metadata[i].name||c.type!==binding.metadata[i].type) || binding.visible.length!==binding.visibleRefs.length || binding.visible.some((c,i)=>c!==binding.visibleRefs[i])) { this.invalidate(); return false; }
    if (this.values) {
      // 即使较早键已能区分所有行，也检查每个活动键，防止次级键漂移后旧复制/导出继续有效。
      try { if (this.values.some(({column,values})=>binding.rows.some((row,i)=>!Object.is(cell(row,column),values[i])))) { this.invalidate(); return false; } } catch { this.invalidate(); return false; }
    }
    return true;
  }
  /** 只返回同一活租约的冻结视图，旧调用不反向撤销较新binding。 */
  view(binding: QueryResultSortBinding | undefined): QueryResultSortView | undefined { return this.current(binding) ? this.projection : undefined; }
  /** 全部键共用文本/单元格预算；按优先级逐键比较，最终并列只按原返回位置稳定打破。 */
  apply(binding: QueryResultSortBinding, previous: QueryResultSortView, rules: readonly QueryResultSortRule[] | QueryResultSortRule = []): QueryResultSortView {
    if (!this.current(binding) || this.projection !== previous) throw failure();
    // 单列调用保留原内部入口兼容；界面传入现有SortRule[]，不得截成最后一列。
    const next: readonly QueryResultSortRule[]=Array.isArray(rules) ? rules : [rules as QueryResultSortRule];
    if (!next.length) { this.values=undefined; return this.projection=this.project(binding,binding.rows.map((_,i)=>i)); }
    if (next.length>binding.visible.length || new Set(next.map(rule=>rule.column)).size!==next.length) throw Error(text.rules);
    if (next.length*binding.rows.length>queryResultSortLimits.cells) throw Error(text.budget);
    const admitted=next.map(rule=>{
      const column=binding.visible.find(c=>c.key===rule.column),type=column&&kind(column.type);
      if (!column || !type || !['ASC','DESC'].includes(rule.direction)) throw Error(text.type);
      if (rule.nulls !== undefined && rule.nulls !== 'FIRST' && rule.nulls !== 'LAST') throw Error(text.nullsInvalid);
      const reason=binding.reasons.get(column.key); if (reason) throw Error(reason);
      return {column,type,direction:rule.direction,nulls:rule.nulls};
    });
    let units=0;
    const values=admitted.map(({column})=>({column,values:binding.rows.map(row=>{const value=cell(row,column);units+=typeof value==='string'?value.length:1;if(units>queryResultSortLimits.units)throw Error(text.budget);return value;})}));
    const keys=admitted.map(({column,type},i)=>values[i].values.map(value=>key(value,type,column.type.trim().toUpperCase().endsWith(' UNSIGNED')))), sourceIndices=binding.rows.map((_,i)=>i);
    sourceIndices.sort((a,b)=>{
      for(let i=0;i<admitted.length;i++){
        const left=keys[i][a],right=keys[i][b],rule=admitted[i];
        // 显式空值位置独立于升降序；两个NULL仍交给下一优先级，空串不视为NULL。
        const nullOrder=left===right?0:left===null?-1:right===null?1:undefined;
        const order=rule.nulls&&nullOrder!==undefined?(rule.nulls==='FIRST'?1:-1)*nullOrder:(rule.direction==='ASC'?1:-1)*compare(left,right);
        if(order)return order;
      }
      return a-b;
    });
    if (!this.current(binding) || this.projection!==previous) throw failure();
    this.values=values;return this.projection=this.project(binding,sourceIndices,next);
  }
}
