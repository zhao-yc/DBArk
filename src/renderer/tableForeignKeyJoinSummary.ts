import { tableReadIdentifier } from '../shared/tableReadSql';
import { tableForeignKeyJoinSummaryZh as text } from './locales/tableForeignKeyJoinSummary.zh-CN';

export type ForeignKeyJoinSide = 'child' | 'parent';
export interface ForeignKeyJoinGroupKey { side: ForeignKeyJoinSide; column: string; }
export type ForeignKeyJoinAggregateFunction = 'COUNT_ALL' | 'COUNT' | 'COUNT_DISTINCT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
export type ForeignKeyJoinAggregate = { fn: 'COUNT_ALL'; alias: string } | { fn: Exclude<ForeignKeyJoinAggregateFunction, 'COUNT_ALL'>; side: ForeignKeyJoinSide; column: string; alias: string };
export interface ForeignKeyJoinSummary { groups: readonly ForeignKeyJoinGroupKey[]; aggregates: readonly ForeignKeyJoinAggregate[]; }
export interface ForeignKeyJoinGroupDraft extends ForeignKeyJoinGroupKey { id: string; }
export interface ForeignKeyJoinAggregateDraft { id: string; fn: ForeignKeyJoinAggregateFunction; side: ForeignKeyJoinSide; column: string; alias: string; }
type Source = { columns: readonly { name: string; type: string }[] };
export const foreignKeyJoinSummaryLimits = { groups: 20, aggregates: 32 } as const;
export const foreignKeyJoinAggregateFunctions: readonly ForeignKeyJoinAggregateFunction[] = ['COUNT_ALL','COUNT','COUNT_DISTINCT','SUM','AVG','MIN','MAX'];

/** 聚合协议只读普通自有数据属性，拒绝未知项、访问器、空洞和附加数组属性。 */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(text.invalid);
  const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) throw Error(text.invalid);
  const own = Reflect.ownKeys(value); if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) throw Error(text.invalid);
  const result: Record<string, unknown> = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value,key); if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw Error(text.invalid); result[key] = descriptor.value; }
  return result;
}
/** 先核长度再枚举，输出有界新数组，不调用外部迭代器。 */
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value)) throw Error(text.invalid);
  const length = Object.getOwnPropertyDescriptor(value,'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(value).length !== length+1) throw Error(text.invalid);
  const result: unknown[] = [];
  for (let index=0;index<length;index++) { const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor || !descriptor.enumerable || !('value' in descriptor))throw Error(text.invalid);result.push(descriptor.value); }
  return result;
}

/** 本地结构化聚合编译；GROUP BY显式完整列出普通输出，不猜函数依赖或关闭严格模式。 */
export function buildForeignKeyJoinSummary(child: Source, parent: Source, raw: unknown, alias: (side: ForeignKeyJoinSide, ordinal: number, name: string) => string) {
  const root = record(raw,['groups','aggregates']), groups = list(root.groups,foreignKeyJoinSummaryLimits.groups), aggregates = list(root.aggregates,foreignKeyJoinSummaryLimits.aggregates);
  const columns: { side: ForeignKeyJoinSide | 'aggregate'; column: string; alias: string }[] = [], expressions: string[] = [], grouping: string[] = [], keys = new Set<string>(), aliases = new Set<string>(), aggregateReferences = new Map<string,string>();
  /** 列只来自经过主生成器校验的双方元数据，侧别和列名仍按每条声明再核对。 */
  function source(side: unknown, name: unknown) {
    if ((side !== 'child' && side !== 'parent') || typeof name !== 'string') throw Error(text.invalid);
    const source = side === 'child' ? child : parent, index = source.columns.findIndex(column => column.name === name); if (index < 0) throw Error(text.invalid);
    return { side: side as ForeignKeyJoinSide, column: source.columns[index], ordinal: index+1, reference: (side === 'child' ? 'c.' : 'p.') + tableReadIdentifier(name) };
  }
  /** 别名独立引用且大小写不重复；禁止与分组字段的稳定输出别名冲突。 */
  function output(side: ForeignKeyJoinSide | 'aggregate', column: string, name: unknown, expression: string) {
    if (typeof name !== 'string') throw Error(text.invalid); const quoted = tableReadIdentifier(name), key = name.toLowerCase();
    if (aliases.has(key)) throw Error(text.aliasConflict); aliases.add(key); columns.push({side,column,alias:name});expressions.push(expression+' AS '+quoted);if(side==='aggregate')aggregateReferences.set(name,expression);
  }
  for (const raw of groups) { const value=record(raw,['side','column']), item=source(value.side,value.column), key=JSON.stringify([item.side,item.column.name]);if(keys.has(key))throw Error(text.invalid);keys.add(key);grouping.push(item.reference);output(item.side,item.column.name,alias(item.side,item.ordinal,item.column.name),item.reference); }
  for (const raw of aggregates) {
    if (!raw || typeof raw !== 'object') throw Error(text.invalid);
    const descriptor=Object.getOwnPropertyDescriptor(raw,'fn');if(!descriptor || !descriptor.enumerable || !('value' in descriptor))throw Error(text.invalid);
    if (descriptor.value === 'COUNT_ALL') { const value=record(raw,['fn','alias']);output('aggregate',typeof value.alias==='string'?value.alias:'',value.alias,'COUNT(*)');continue; }
    const value=record(raw,['fn','side','column','alias']);if(!foreignKeyJoinAggregateFunctions.includes(value.fn as ForeignKeyJoinAggregateFunction) || value.fn === 'COUNT_ALL')throw Error(text.invalid);
    const item=source(value.side,value.column);
    if ((value.fn === 'SUM' || value.fn === 'AVG') && !/^(?:tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real)\b/i.test(item.column.type)) throw Error(text.numeric);
    const expression = value.fn === 'COUNT_DISTINCT' ? 'COUNT(DISTINCT '+item.reference+')' : value.fn+'('+item.reference+')';output('aggregate',typeof value.alias==='string'?value.alias:'',value.alias,expression);
  }
  if (!columns.length) throw Error(text.empty);
  return { columns, expressions, grouping, keys, aggregateAliases: new Set(aggregateReferences.keys()), aggregateReferences };
}

/** COUNT(*)只携带函数和别名，其它隐藏来源输入保留在界面草稿，不混进有效声明。 */
export function foreignKeyJoinSummaryFromDraft(groups: readonly ForeignKeyJoinGroupDraft[], aggregates: readonly ForeignKeyJoinAggregateDraft[]): ForeignKeyJoinSummary {
  return { groups: groups.map(({side,column})=>({side,column})), aggregates: aggregates.map(value=>value.fn==='COUNT_ALL'?{fn:'COUNT_ALL',alias:value.alias}:{fn:value.fn,side:value.side,column:value.column,alias:value.alias}) };
}
