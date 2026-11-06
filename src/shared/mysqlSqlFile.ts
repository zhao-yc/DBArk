import { z } from 'zod';

const identity = z.string().min(1).max(128).refine(value => !value.includes('\0'));
export const mysqlSqlFileTitle = '执行 MySQL／MariaDB SQL 文件';
export const mysqlSqlFileMaxBytes = 10 * 1024 ** 3;
export const mysqlSqlFileEncodings = ['utf8', 'utf16le', 'gb18030'] as const;
export const mysqlSqlFileChooseSchema = z.object({
  connectionId: identity,
  database: z.string().min(1).refine(value => [...value].length <= 64 && !value.includes('\0')).nullable(),
  encoding: z.enum(mysqlSqlFileEncodings),
}).strict();
export const mysqlSqlFileExecuteSchema = mysqlSqlFileChooseSchema.extend({
  fileToken: z.uuid(), taskId: identity, acknowledgeScript: z.literal(true),
});
export type MysqlSqlFileChooseInput = z.infer<typeof mysqlSqlFileChooseSchema>;
export type MysqlSqlFileExecuteInput = z.infer<typeof mysqlSqlFileExecuteSchema>;
export interface MysqlSqlFileChoice { token: string; name: string; bytes: number }
