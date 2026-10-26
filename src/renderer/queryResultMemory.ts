import type { QueryResult, ResultColumn } from '../shared/contracts';
import { prepareQueryResultOrganization, type QueryResultOrganization } from './queryResultHistory';
import { queryResultMemoryZh as text } from './locales/queryResultMemory.zh-CN';
import { setQueryResultFrozenThrough } from './queryResultColumns';

/** 仅保留字段身份、可见列和完整配置；不保留行、SQL、选择或数据库执行来源。 */
export interface QueryResultMemory {
  readonly columns: readonly ResultColumn[];
  readonly visible: readonly ResultColumn[];
  readonly configuration: QueryResultOrganization;
  readonly frozenThrough?: string;
}
export const queryResultMemoryLimits = { units: 128 * 1024 } as const;

/** 只接受正式控制器可以完整应用的配置，容量不足时不截断或替换旧暂存。 */
export function captureQueryResultMemory(source: QueryResult, visible: ResultColumn[], configuration: QueryResultOrganization, frozenThrough?: string): QueryResultMemory {
  const prepared = prepareQueryResultOrganization(source, [], visible, configuration);
  // 暂存只保存精确可见列键；不缓存网格节点、像素宽度、行数据或SQL。
  const frozen = setQueryResultFrozenThrough({ order: source.columns.map(column => column.key), visible: visible.map(column => column.key) }, frozenThrough);
  const sort = prepared.sorter.view(prepared.sortBinding)!.rules.map(({ column, direction, nulls, ignoreCase }) => ({ column, direction, ...(nulls === undefined ? {} : { nulls }), ...(ignoreCase === undefined ? {} : { ignoreCase }) }));
  const admitted = { expression: prepared.filter.view(prepared.filterBinding)!.expression, sort };
  const columns = source.columns.map(({ key, name, type }) => ({ key, name, type }));
  const shown = visible.map(({ key, name, type }) => ({ key, name, type }));
  const encoded = JSON.stringify({ columns, visible: shown, configuration: admitted, ...(frozen.frozenThrough === undefined ? {} : { frozenThrough: frozen.frozenThrough }) });
  if (encoded.length > queryResultMemoryLimits.units) throw Error(text.limited);
  const copy = JSON.parse(encoded) as QueryResultMemory;
  /** 深冻结独立配置；旧面板或后续编辑不能改写暂存条件。 */
  function freeze(value: object): void {
    for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
    Object.freeze(value);
  }
  freeze(copy); return copy;
}

/** 按完整、有序的键/名称/类型核对，重名字段不能只凭显示名套用。 */
export function queryResultMemoryMatches(memory: QueryResultMemory, source: QueryResult | undefined, visible: readonly ResultColumn[]): boolean {
  const same = (left: readonly ResultColumn[], right: readonly ResultColumn[]) => left.length === right.length && left.every((column, index) => column.key === right[index].key && column.name === right[index].name && column.type === right[index].type);
  if (!source || !same(memory.columns, source.columns) || !same(memory.visible, visible)) return false;
  try { setQueryResultFrozenThrough({ order: source.columns.map(column => column.key), visible: visible.map(column => column.key) }, memory.frozenThrough); }
  catch { return false; }
  return true;
}
