import type { QueryOutcome, QueryResult, ResultExportData } from '../shared/contracts';

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
