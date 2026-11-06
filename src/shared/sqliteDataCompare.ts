import { z } from 'zod';
import { sqliteTablePageSchema } from './sqliteTableBrowse';
import type { SqliteValue } from '../engine/sqlite/protocol';

export const sqliteDataCompareLimits = { rows: 10000, bytes: 8 * 1024 * 1024, timeoutMs: 60_000, page: 25 } as const;
const fields = sqliteTablePageSchema.shape;
const endpoint = z.object({ connectionId: fields.connectionId, database: fields.database, table: fields.table }).strict();
export const sqliteDataCompareSchema = z.object({
  source: endpoint, target: endpoint,
  taskId: fields.taskId, filters: fields.filters, mode: fields.mode,
}).strict().superRefine((input, context) => {
  if (!sqliteTablePageSchema.safeParse({ ...input.source, taskId: input.taskId, filters: input.filters, mode: input.mode, sort: [], limit: 1, offset: 0 }).success)
    context.addIssue({ code: 'custom', message: 'SQLite 比较筛选条件无效或超过预算' });
});
export type SqliteDataCompareInput = z.infer<typeof sqliteDataCompareSchema>;
export type SqliteDataCompareEndpoint = z.infer<typeof endpoint>;
export type SqliteDataCompareKind = 'source-only' | 'target-only' | 'different';
export interface SqliteDataCompareRow {
  kind: SqliteDataCompareKind;
  key: SqliteValue[];
  cells: { column: number; source?: SqliteValue; target?: SqliteValue }[];
}
export interface SqliteDataCompareOutput {
  snapshot: 'one-file' | 'two-files';
  keyColumns: string[];
  columns: string[];
  sourceRows: number;
  targetRows: number;
  equal: number;
  counts: Record<SqliteDataCompareKind, number>;
  differences: SqliteDataCompareRow[];
}

export const sqliteDataCompareZh = {
  title: '比较 SQLite 表数据',
  source: '左侧来源', target: '右侧目标', connection: '连接', table: '表',
  filter: '两侧应用同一个精确筛选', filterColumn: '筛选列名', filterValue: '筛选值', filterType: '存储类型',
  types: { text: '文本', integer: '整数', real: '实数', blob: '十六进制字节' },
  run: '比较数据', running: '正在读取两个表的快照', cancel: '取消比较', close: '关闭',
  cancelled: 'SQLite 数据比较已取消', timeout: 'SQLite 数据比较超时，请缩小筛选范围',
  intro: '按同名主键匹配，比较两侧同名字段的真实存储类型和值。每侧最多 10,000 行及 8 MiB。',
  keys: '匹配主键', equal: '相同', sourceRows: '左侧行数', targetRows: '右侧行数',
  'source-only': '仅左侧', 'target-only': '仅右侧', different: '字段值不同',
  singleSnapshot: '两张表使用同一个文件快照。',
  splitSnapshot: '两个文件分别建立读取快照。若比较期间有写入，两侧快照可能处于不同时间点。',
  all: '全部差异', noDiff: '没有符合当前筛选的差异', kind: '差异类型', detail: '查看字段差异',
  prev: '上一页', next: '下一页', field: '字段', absent: '无此行',
} as const;
