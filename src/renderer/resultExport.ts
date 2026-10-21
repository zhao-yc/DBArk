import { projectQueryResultRows, snapshotQueryResultColumns } from './queryResultColumns';
import type { CellValue, QueryOutcome, QueryResult, ResultExportData } from '../shared/contracts';
import { resultExportLimits, validateResultExportData } from '../shared/resultExport';
import { zh } from './locales/zh-CN';

/** 失败或取消留下的 stream 从不参与导出；旧快照不依赖当前查询是否成功或连接是否在线。 */
export function exportableQueryResult(busy: boolean, outcome: QueryOutcome | null, resultIndex: number, pinned?: QueryResult): QueryResult | undefined {
  if (busy) return undefined;
  const result = pinned ?? outcome?.results[resultIndex];
  return result?.columns.length ? result : undefined;
}

/** 导出只投影必要列属性并复用不可变行引用，不复制整表或传输原 SQL。 */
export function resultExportData(result: ResultExportData): ResultExportData {
  return { columns: result.columns.map(({ key, name }) => ({ key, name })), rows: result.rows, truncated: result.truncated };
}

export interface ResultGridSelection { scope: object; rows: QueryResult['rows']; columns: QueryResult['columns']; indices: ReadonlySet<number> }
export interface ResultSelectionBinding {
  result: QueryResult; rows: QueryResult['rows']; columns: QueryResult['columns']; rowRefs: QueryResult['rows'];
  visibleColumns: QueryResult['columns']; visibleRefs: QueryResult['columns'];
  columnRefs: QueryResult['columns']; columnValues: QueryResult['columns']; truncated: boolean; context: readonly unknown[];
}

/** 勾选证明只观察自有数据字段；访问器或非协议二进制不能在核对期间执行代码。 */
function selectionCell(row: QueryResult['rows'][number], key: string): CellValue {
  const descriptor = row && typeof row === 'object' ? Object.getOwnPropertyDescriptor(row, key) : undefined;
  if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error(zh.resultExport.selectionInvalid);
  const value: unknown = descriptor.value;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== 2) throw Error(zh.resultExport.selectionInvalid);
  const type = Object.getOwnPropertyDescriptor(value, 'type'), base64 = Object.getOwnPropertyDescriptor(value, 'base64');
  if (!type || !base64 || !('value' in type) || !('value' in base64) || !type.enumerable || !base64.enumerable || type.value !== 'binary' || typeof base64.value !== 'string') throw Error(zh.resultExport.selectionInvalid);
  return { type: 'binary', base64: base64.value };
}
/** 勾选只属于一个准确结果和显示代次；失效后旧网格回调不能重新领取新结果。 */
export class ResultExportSelection {
  private binding?: ResultSelectionBinding;
  private selection?: { binding: ResultSelectionBinding; indices: number[]; data: ResultExportData; sourceValues: CellValue[][] };
  /** 新执行或显式切换在setState之前撤销，不能等待effect清空。 */
  invalidate(): void { this.binding = undefined; this.selection = undefined; }
  /** 渲染时同步比对实际对象、数组与元数据；A→B→A也获得新的绑定。 */
  bind(result: QueryResult | undefined, context: readonly unknown[], visibleColumns = result?.columns): ResultSelectionBinding | undefined {
    if (!result || !visibleColumns?.length || result.rows.length > resultExportLimits.rows || result.columns.length > resultExportLimits.columns) { this.invalidate(); return; }
    const previous = this.binding;
    if (!previous || previous.result !== result || previous.visibleColumns !== visibleColumns || context.length !== previous.context.length || context.some((value, i) => !Object.is(value, previous.context[i])) || !this.current(previous)) {
      this.selection = undefined;
      this.binding = { result, rows: result.rows, columns: result.columns, visibleColumns, visibleRefs: visibleColumns.slice(), rowRefs: result.rows.slice(), columnRefs: result.columns.slice(), columnValues: result.columns.map(column => ({ ...column })), truncated: result.truncated, context: [...context] };
    }
    return this.binding;
  }
  /** 同一数组内换行、换列或改已选值也失效，不能由相同result引用掩盖漂移。 */
  current(binding: ResultSelectionBinding | undefined): binding is ResultSelectionBinding {
    // 旧binding只返回拒绝，绝不能撤销已经接纳的较新owner。
    if (!binding || binding !== this.binding) return false;
    const revoke = () => { this.invalidate(); return false; };
    if (binding.result.rows !== binding.rows || binding.result.columns !== binding.columns || binding.result.truncated !== binding.truncated || binding.rows.length !== binding.rowRefs.length || binding.columns.length !== binding.columnRefs.length || binding.visibleColumns.length !== binding.visibleRefs.length || binding.visibleColumns.some((column,i)=>column!==binding.visibleRefs[i])) return revoke();
    if (binding.rows.some((row, i) => row !== binding.rowRefs[i]) || binding.columns.some((column, i) => column !== binding.columnRefs[i] || column.key !== binding.columnValues[i].key || column.name !== binding.columnValues[i].name || column.type !== binding.columnValues[i].type)) return revoke();
    try {
      if (this.selection?.binding === binding && !this.selection.indices.every((index, i) => {
        const live=binding.rows[index],saved=this.selection!.sourceValues[i];
        return Object.keys(live).length===binding.columns.length&&binding.columns.every((column,position)=>{
          const a=selectionCell(live,column.key),b=saved[position];
          return a&&b&&typeof a==='object'&&typeof b==='object'?a.type===b.type&&a.base64===b.base64:Object.is(a,b);
        });
      })) return revoke();
    } catch { return revoke(); }
    return true;
  }
  /** 按显示顺序生成有界原值快照；先校验预算再克隆，不接受空选回退全量。 */
  select(binding: ResultSelectionBinding | undefined, event: ResultGridSelection): boolean {
    if (!this.current(binding) || event.scope !== binding || event.rows !== binding.rows || event.columns !== binding.visibleColumns) return false;
    this.selection = undefined;
    if (!event.indices.size) return true;
    if (event.indices.size > resultExportLimits.rows) throw Error(zh.resultExport.selectionInvalid);
    const indices = [...event.indices].sort((a, b) => a - b);
    if (indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= binding.rows.length)) throw Error(zh.resultExport.selectionInvalid);
    // 原接纳回执仍观察整行键和值漂移；只保存有界浅值摘要，不克隆隐藏的大字符串或向文件夹带隐藏列。
    if(indices.length*binding.columns.length>resultExportLimits.cells)throw Error(zh.resultExport.selectionInvalid);
    let sourceValues: CellValue[][];
    try {
      sourceValues=indices.map(index=>{
        const row=binding.rows[index];if(Object.keys(row).length!==binding.columns.length)throw Error(zh.resultExport.selectionInvalid);
        return binding.columns.map(column=>selectionCell(row,column.key));
      });
    } catch (reason) { this.invalidate(); throw reason; }
    const data = projectQueryResultRows(binding.result,binding.visibleColumns,indices);
    validateResultExportData(data);
    this.selection = { binding, indices, data: structuredClone(data), sourceValues };
    return true;
  }
  /** 全结果也在打开时冻结当前可见列；不得复用可变原结果引用。 */
  allSnapshot(binding: ResultSelectionBinding | undefined): QueryResult {
    if (!this.current(binding)) throw Error(zh.resultExport.selectionInvalid);
    return snapshotQueryResultColumns(binding.result,binding.visibleColumns);
  }
  /** 按钮可用性直接核同步绑定，不信任上一轮React状态。 */
  count(binding: ResultSelectionBinding | undefined): number { return this.current(binding) && this.selection?.binding === binding ? this.selection.indices.length : 0; }
  /** 父级只证明本代已接纳的非空有序索引；不修改选择，也不返回私有数组引用。 */
  matchesIndices(binding: ResultSelectionBinding | undefined, indices: readonly number[]): boolean {
    if (!this.current(binding) || this.selection?.binding !== binding || !this.selection.indices.length || !Array.isArray(indices)) return false;
    const length = Object.getOwnPropertyDescriptor(indices, 'length');
    if (!length || length.value !== this.selection.indices.length || Reflect.ownKeys(indices).length !== length.value + 1) return false;
    return this.selection.indices.every((index, position) => {
      const descriptor = Object.getOwnPropertyDescriptor(indices, String(position));
      return !!descriptor && 'value' in descriptor && descriptor.enumerable === true && Object.is(descriptor.value, index);
    });
  }
  /** 对话框持有独立副本；后续勾选、换页或修改源引用不能改变已打开的导出范围。 */
  snapshot(binding: ResultSelectionBinding | undefined): QueryResult {
    if (!this.count(binding) || !this.selection) throw Error(zh.resultExport.selectionInvalid);
    const data = structuredClone(this.selection.data);
    return { ...data, columns: data.columns.map(column => ({ ...column, type: '' })), elapsedMs: 0, statement: '' };
  }
}
