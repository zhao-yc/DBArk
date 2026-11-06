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
  syncSnapshotId?: string;
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

export const sqliteDataSyncLimits = { selected: 100, bytes: 1024 * 1024, lifetimeMs: 5 * 60_000 } as const;
export const sqliteDataSyncPreviewSchema = z.object({
  snapshotId: fields.taskId, selected: z.array(z.number().int().min(0).max(sqliteDataCompareLimits.rows * 2 - 1)).min(1).max(sqliteDataSyncLimits.selected),
}).strict().refine(value => new Set(value.selected).size === value.selected.length, '同步选择不能重复');
export type SqliteDataSyncPreviewInput = z.infer<typeof sqliteDataSyncPreviewSchema>;
export interface SqliteDataSyncPreview {
  previewId: string; confirmation: string;
  counts: import('./sqliteTableEdit').SqliteTableEditCounts;
}

export const sqliteDataSyncZh = {
  select: '选择同步差异', count: (value: number) => `已选 ${value} 行`,
  preview: '预览同步到右侧', apply: '确认同步到右侧', back: '返回差异列表',
  confirm: '输入准确的右侧目标', working: '正在同步到右侧',
  insert: '插入', update: '更新', delete: '删除',
  scope: '只修改所选右侧行。左侧使用本次比较时的快照值，右侧原值变化会使整批回滚。右侧有触发器或被外键引用时会在写入前拦截。',
  unavailable: '筛选比较、只读连接及含生成列的右侧表可查看差异。同步请使用支持写入的完整比较。',
  stale: 'SQLite 差异或同步预览已失效，请重新比较',
} as const;
