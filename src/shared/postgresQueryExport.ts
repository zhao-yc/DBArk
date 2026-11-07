import { z } from 'zod';
import { csvExportDelimiters } from './csvExport';
import { queryParameterTypes, validateQueryParameters, type QueryParameterNames } from './queryParameters';
import { postgresNewIdentifier } from './postgresCreateTable';
import { currentPostgresStatement, splitPostgresSql } from './postgresSql';
import { dataMarkupFormats, dataMarkupText } from './dataMarkupExport';

const parameters = z.array(z.object({name: z.string(), type: z.enum(queryParameterTypes), value: z.string().optional()}).strict())
  .max(200).superRefine((values, context) => {
    try { validateQueryParameters(values, 38); }
    catch { context.addIssue({code: 'custom', message: 'PostgreSQL 导出参数类型或预算无效'}); }
  });

const postgresQueryInsertColumns = z.array(postgresNewIdentifier).min(1).max(1024)
  .refine(names => new Set(names).size === names.length, 'PostgreSQL INSERT 目标字段不能重名');
export const postgresQueryInsertTargetSchema = z.object({
  schema: postgresNewIdentifier, table: postgresNewIdentifier, columns: postgresQueryInsertColumns.optional(),
}).strict();

/** 使用带双引号的标识符，大小写不同的名称各自保留。 */
export function postgresQueryInsertColumnsForResult(target: z.infer<typeof postgresQueryInsertTargetSchema>, source: string[]): string[] {
  const columns = target.columns ?? source;
  if (columns.length !== source.length) throw Error('PostgreSQL INSERT 目标字段数必须与查询结果列数一致');
  if (!postgresQueryInsertColumns.safeParse(columns).success) throw Error('PostgreSQL INSERT 字段名无效或重复，请填写唯一的目标字段或修改查询别名');
  return columns;
}

export const postgresQueryExportSchema = z.object({
  connectionId: z.string().min(1).max(200), database: z.string().min(1).max(256),
  taskId: z.string().min(1).max(200), fileToken: z.string().min(1).max(200),
  sql: z.string().min(1).max(4 * 1024 * 1024), format: z.enum(['csv', 'json', 'xlsx', 'sql', ...dataMarkupFormats]),
  encoding: z.enum(['utf8', 'utf16le', 'gb18030']), csvDelimiter: z.enum(csvExportDelimiters).optional(),
  parameters: parameters.optional(), insertTarget: postgresQueryInsertTargetSchema.optional(),
}).strict()
  .refine(input => input.csvDelimiter === undefined || input.format === 'csv', '分隔符仅用于 CSV 导出')
  .refine(input => input.format === 'sql' ? !!input.insertTarget : input.insertTarget === undefined, '仅 PostgreSQL INSERT SQL 导出需要明确目标')
  .superRefine((input, context) => {
    const markup = dataMarkupText(input.format);
    if (markup && input.encoding !== 'utf8') context.addIssue({ code: 'custom', path: ['encoding'], message: markup.utf8 });
  })
  .refine(input => input.format !== 'xlsx' && input.format !== 'sql' || input.encoding === 'utf8', 'PostgreSQL INSERT SQL 和 Excel 导出使用 UTF-8');

export type PostgresQueryExportInput = z.infer<typeof postgresQueryExportSchema>;
export interface PostgresQueryExportOutput { rows: number; fileCommitted: true; }

/** 导出使用独立会话，只有两种字符串模式都指向同一原语句和参数时才接受。 */
export function postgresCurrentQueryExportSource(source: string, offset: number): string {
  const primary = currentPostgresStatement(source, offset, true);
  const alternate = currentPostgresStatement(source, offset, false);
  if (offset > primary.end || primary.start !== alternate.start || primary.end !== alternate.end ||
      primary.parameters.length !== alternate.parameters.length ||
      primary.parameters.some((position, index) => position !== alternate.parameters[index]))
    throw Error('当前位置没有边界明确的 PostgreSQL 导出语句');
  if (!['SELECT', 'WITH'].includes(primary.keyword))
    throw Error('请将光标放在要完整导出的 PostgreSQL SELECT 或 WITH 语句中');
  const end = source[primary.end] === ';' ? primary.end + 1 : primary.end;
  return source.slice(primary.start, end);
}

/** 表单识别只读本地模板。两个候选模式须同意范围与编号，实际投递仍由新会话复核。 */
export function postgresExportParameterNames(sql: string): QueryParameterNames {
  const ordinary = splitPostgresSql(sql, true), escaped = splitPostgresSql(sql, false);
  const part = ordinary[0], alternative = escaped[0];
  if (ordinary.length !== 1 || escaped.length !== 1 || part.start !== alternative.start || part.end !== alternative.end ||
      JSON.stringify(part.parameters) !== JSON.stringify(alternative.parameters))
    throw Error('导出参数需要边界明确的单条 PostgreSQL 查询');
  if (part.parameters.some((position, index) => position !== index + 1)) throw Error('PostgreSQL 位置参数必须从 $1 连续编号');
  return {names: part.parameters.map(position => 'p' + position), warnings: [], maxDecimalScale: 38,
    allowTimeEndpointFraction: false, ansiQuotes: true, noBackslashEscapes: true};
}
