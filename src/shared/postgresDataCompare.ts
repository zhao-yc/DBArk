import { z } from 'zod';
import type { CellValue } from './contracts';
import { postgresQuickTableFilterSchema, postgresTableTargetSchema } from './postgresTable';

const endpoint = postgresTableTargetSchema.omit({ tabId: true });
export const postgresDataCompareSchema = z.object({
  source: endpoint, target: endpoint, taskId: z.uuid(), filter: postgresQuickTableFilterSchema.optional(),
}).strict().refine(({ source, target }) =>
  source.connectionId !== target.connectionId || source.database !== target.database || source.table !== target.table,
'请选择不同的 PostgreSQL 比较目标');

export const postgresDataCompareCatalogueSchema = endpoint.omit({ table: true }).partial({ database: true });
export type PostgresDataCompareCatalogueInput = z.infer<typeof postgresDataCompareCatalogueSchema>;

export type PostgresDataCompareInput = z.infer<typeof postgresDataCompareSchema>;
export type PostgresDataCompareEndpoint = z.infer<typeof endpoint>;
export type PostgresDataCompareKind = 'source-only' | 'target-only' | 'different';
export interface PostgresDataCompareRow {
  kind: PostgresDataCompareKind;
  key: CellValue[];
  cells: { column: number; source?: CellValue; target?: CellValue }[];
}
export interface PostgresDataCompareOutput {
  sharedSnapshot: boolean;
  columns: { name: string; type: string }[];
  keyColumns: string[];
  sourceRows: number;
  targetRows: number;
  equal: number;
  counts: Record<PostgresDataCompareKind, number>;
  differences: PostgresDataCompareRow[];
}
export const postgresDataCompareLimits = { rows: 10000, bytes: 8 * 1024 * 1024, timeoutMs: 60000, page: 25 };
export const postgresDataCompareZh = {
  title: '比较 PostgreSQL 表数据', source: '左侧来源', target: '右侧目标', connection: '连接', database: '数据库', table: '表',
  intro: '按同名主键比较普通表或分区表的同名字段。每侧最多 10,000 行及 8 MiB，可用同一文本筛选缩小范围。',
  shared: '两张表使用同一个数据库快照。', split: '两侧独立读取，快照可能处于不同时间点。',
  filter: '两侧应用同一文本包含筛选', filterColumn: '筛选列名', filterValue: '包含文本',
  run: '比较数据', running: '正在读取 PostgreSQL 表快照', cancel: '取消比较', close: '关闭',
  cancelled: 'PostgreSQL 数据比较已取消', timeout: 'PostgreSQL 数据比较超时，请缩小筛选范围',
  key: '匹配主键', equal: '相同', sourceRows: '左侧行数', targetRows: '右侧行数', all: '全部差异', kind: '差异类型',
  'source-only': '仅左侧', 'target-only': '仅右侧', different: '字段值不同',
  noDiff: '没有符合当前范围的差异', details: '查看字段差异', prev: '上一页', next: '下一页', absent: '无此行', field: '字段',
} as const;
