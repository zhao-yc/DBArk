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
export function resultExportData(result: QueryResult): ResultExportData {
  return { columns: result.columns.map(({ key, name }) => ({ key, name })), rows: result.rows, truncated: result.truncated };
}

export interface ResultGridSelection { scope: object; rows: QueryResult['rows']; columns: QueryResult['columns']; indices: ReadonlySet<number> }
export interface ResultSelectionBinding {
  result: QueryResult; rows: QueryResult['rows']; columns: QueryResult['columns']; rowRefs: QueryResult['rows'];
  visibleColumns: QueryResult['columns']; visibleRefs: QueryResult['columns'];
  columnRefs: QueryResult['columns']; columnValues: QueryResult['columns']; truncated: boolean; context: readonly unknown[];
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
    if (!binding || binding !== this.binding || binding.result.rows !== binding.rows || binding.result.columns !== binding.columns || binding.result.truncated !== binding.truncated || binding.rows.length !== binding.rowRefs.length || binding.columns.length !== binding.columnRefs.length || binding.visibleColumns.length !== binding.visibleRefs.length || binding.visibleColumns.some((column,i)=>column!==binding.visibleRefs[i])) return false;
    if (binding.rows.some((row, i) => row !== binding.rowRefs[i]) || binding.columns.some((column, i) => column !== binding.columnRefs[i] || column.key !== binding.columnValues[i].key || column.name !== binding.columnValues[i].name || column.type !== binding.columnValues[i].type)) return false;
    if (this.selection?.binding === binding) return this.selection.indices.every((index, i) => {
      const live=binding.rows[index],saved=this.selection!.sourceValues[i];
      return Object.keys(live).length===binding.columns.length&&binding.columns.every((column,position)=>{
        if(!Object.hasOwn(live,column.key))return false;
        const a=live[column.key],b=saved[position];
        return a&&b&&typeof a==='object'&&typeof b==='object'?a.type===b.type&&a.base64===b.base64:Object.is(a,b);
      });
    });
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
    const sourceValues=indices.map(index=>{
      const row=binding.rows[index];if(Object.keys(row).length!==binding.columns.length)throw Error(zh.resultExport.selectionInvalid);
      return binding.columns.map(column=>{if(!Object.hasOwn(row,column.key))throw Error(zh.resultExport.selectionInvalid);const cell=row[column.key];return cell&&typeof cell==='object'?{type:cell.type,base64:cell.base64}:cell;});
    });
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
  /** 对话框持有独立副本；后续勾选、换页或修改源引用不能改变已打开的导出范围。 */
  snapshot(binding: ResultSelectionBinding | undefined): QueryResult {
    if (!this.count(binding) || !this.selection) throw Error(zh.resultExport.selectionInvalid);
    const data = structuredClone(this.selection.data);
    return { ...data, columns: data.columns.map(column => ({ ...column, type: '' })), elapsedMs: 0, statement: '' };
  }
}
