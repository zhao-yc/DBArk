import { z } from 'zod';
import { resultSqlTargetSchema } from './resultSql';
import { queryInsertZh as text } from './queryInsertExport.zh-CN';

/** 新执行没有预知来源列；目标字段只按明确的位置对应，不猜名称或SQL来源。 */
export const queryInsertTargetSchema = z.object({
  database: resultSqlTargetSchema.shape.database,
  table: resultSqlTargetSchema.shape.table,
  columns: z.array(resultSqlTargetSchema.shape.columns.element.shape.name).min(1).max(1024),
}).strict().refine(target => new Set(target.columns.map(name => name.normalize('NFC').toLowerCase())).size === target.columns.length, text.mapping);
export type QueryInsertTarget = z.infer<typeof queryInsertTargetSchema>;
export const queryInsertLimits = { sampleRows: 20, sampleBytes: 4 * 1024 * 1024 } as const;
export interface QueryInsertSample { sql: string; shownRows: number; totalRows: number }
