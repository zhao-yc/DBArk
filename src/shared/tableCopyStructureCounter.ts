import type { TableAutoIncrementColumn } from './tableAutoIncrement';

/** 服务端计划只传精确十进制字符串；新值须来自已证明的CREATE LIKE规则，不能由客户端指定。 */
export interface TableCopyStructureCounterPlan {
  column: TableAutoIncrementColumn; sourceValue: string; expectedNewValue: '1';
}
/** 结构与计数分开回执；OK包、空表或定义中省略选项都不能替代准确计数观测。 */
export interface TableCopyStructureCounterResult {
  state: 'not-applicable' | 'matched' | 'different' | 'unverified';
  sourceValue?: string; expectedValue?: string; actualValue?: string;
}
