import { tableCreateDraftSchema, type TableCreateDraft } from '../shared/tableCreate';
import { effectiveTableCreateColumnEncoding, tableCreateHasColumnEncoding } from '../shared/tableCreateColumnEncoding';
import type { TableColumnDefinitionDocument } from '../shared/tableColumnPatches';
import { boundedCreateColumnRows, ordinaryCreateColumnEncodingMatches, ordinaryCreateColumnExtraMatches } from './tableCreateGeneratedColumns';
import { readTableDefaultEncodingDefinition } from './tableDefaultEncodingSql';
import { sameStructureFragment, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { qualified } from './sql';
import { tableCreateColumnDefaultMatches } from './tableCreateColumnDefaults';
import { tableCreateCheckHasJson, tableCreateCheckJsonMatches, type TableCreateChecksProof } from './tableCreateChecks';

const literal = (value: string) => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
/** 原查询终态后仍核取消及断线，核验失败不能转成可重放的CREATE。 */
function active(context: StructureTaskContext): void { context.checkCancelled(); if (context.managed.signal?.aborted || context.managed.broken) throw Error('字段编码核验会话已中断'); }

/** 完整SHOW、TABLES与全列COLUMNS共同证明每列配对；此处不制造已存在列的写权限。 */
export async function verifyCreatedColumnEncodings(context: StructureTaskContext, target: { database: string; table: string }, input: TableCreateDraft, document: TableColumnDefinitionDocument, checkProof?: TableCreateChecksProof): Promise<boolean> {
  active(context); const design = tableCreateDraftSchema.parse(input);
  if (!tableCreateHasColumnEncoding(design) || design.columns.some(column => column.generated) || target.database !== design.database || target.table !== design.name || document.table !== target.table || document.database !== undefined && document.database !== target.database || document.columns.length !== design.columns.length || document.context.dialect !== context.managed.status.dialect) return false;
  const condition = (prefix = '') => `CAST(${prefix}TABLE_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(${prefix}TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY)`;
  const query = async (sql: string, keys: readonly string[], maximum = 1000, budget = 2 * 1024 * 1024) => { const value = await structureTaskQuery<unknown>(context, sql); active(context); return boundedCreateColumnRows(value.rows, keys, maximum, budget); };
  const tables = await query(`SELECT t.TABLE_SCHEMA AS databaseName,t.TABLE_NAME AS tableName,t.TABLE_TYPE AS kind,t.ENGINE AS engine,c.CHARACTER_SET_NAME AS charset,t.TABLE_COLLATION AS collation FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME=t.TABLE_COLLATION WHERE ${condition('t.')} LIMIT 2`, ['databaseName', 'tableName', 'kind', 'engine', 'charset', 'collation'], 2, 64 * 1024);
  if (tables.length !== 1 || tables[0].databaseName !== target.database || tables[0].tableName !== target.table || tables[0].kind !== 'BASE TABLE' || typeof tables[0].engine !== 'string' || tables[0].engine.toUpperCase() !== design.engine.toUpperCase()) return false;
  const table = tables[0], shown = readTableDefaultEncodingDefinition(document.source, document.context);
  if (shown.reasons.length || shown.charset !== design.charset || typeof table.collation !== 'string' || !/^[A-Za-z0-9_]{1,255}$/.test(table.collation) || shown.collation !== undefined && shown.collation !== table.collation || design.collation !== undefined && design.collation !== table.collation) return false;
  // Maria UCA目录无唯一字符集时只接受SHOW显式完整配对，不猜collation前缀。
  if (table.charset === null ? document.context.dialect !== 'mariadb' || shown.collation !== table.collation : table.charset !== design.charset) return false;
  if (shown.collation === undefined) {
    const defaults = await query(`SELECT CHARACTER_SET_NAME AS name,DEFAULT_COLLATE_NAME AS collation FROM information_schema.CHARACTER_SETS WHERE CHARACTER_SET_NAME=${literal(design.charset)} LIMIT 2`, ['name', 'collation'], 2, 64 * 1024);
    if (defaults.length !== 1 || defaults[0].name !== design.charset || defaults[0].collation !== table.collation) return false;
  }
  const encoding = { charset: design.charset, collation: table.collation };
  const columns = await query(`SELECT COLUMN_NAME AS name,ORDINAL_POSITION AS ordinal,COLUMN_TYPE AS typeSql,DATA_TYPE AS dataType,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue,EXTRA AS extra,GENERATION_EXPRESSION AS generationExpression,CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation,COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE ${condition()} ORDER BY ORDINAL_POSITION LIMIT 1001`, ['name', 'ordinal', 'typeSql', 'dataType', 'nullable', 'defaultValue', 'extra', 'generationExpression', 'charset', 'collation', 'comment']);
  if (columns.length !== design.columns.length) return false;
  for (const [index, row] of columns.entries()) {
    const column = document.columns[index], requested = design.columns[index];
    if (row.name !== requested.name || row.name !== column.name || !/^[1-9]\d*$/.test(String(row.ordinal)) || Number(row.ordinal) !== index + 1 || typeof row.typeSql !== 'string' || !sameStructureFragment(row.typeSql, column.type.raw, document.context) || typeof row.dataType !== 'string' || typeof row.extra !== 'string' || !['YES', 'NO'].includes(String(row.nullable)) || (row.nullable === 'YES') !== requested.nullable || column.nullable !== undefined && column.nullable !== (row.nullable === 'YES') || row.comment !== requested.comment || row.comment !== (column.comment ?? '') || row.defaultValue !== null && typeof row.defaultValue !== 'string' || row.generationExpression !== null && row.generationExpression !== '') return false;
    const family = /^[A-Za-z]+/.exec(column.type.raw.trim())?.[0].toUpperCase(), aliases: Record<string, string> = { INTEGER: 'INT', NUMERIC: 'DECIMAL' };
    if (!family || (aliases[family] ?? family) !== row.dataType.toUpperCase()) return false;
    // JSON_VALID及固有utf8mb4_bin配对先有完整证明，当前整行目录仍与准确原SHOW绑定，不按布尔放行。
    if (tableCreateCheckHasJson(checkProof, document, column.name)) { if (!tableCreateCheckJsonMatches(checkProof, document, column.name, row)) return false; continue; }
    const character = /^(?:CHAR|VARCHAR|ENUM|SET|(?:TINY|MEDIUM|LONG)?TEXT)$/i.test(row.dataType);
    if (!tableCreateColumnDefaultMatches(requested, column, row.defaultValue as string | null, document.context) || !ordinaryCreateColumnEncodingMatches(column, row, document, effectiveTableCreateColumnEncoding(requested, encoding)) || !ordinaryCreateColumnExtraMatches(column, row.extra, document.context.dialect, character)) return false;
  }
  const final = (await structureTaskQuery<Record<string, unknown>[]>(context, `SHOW CREATE TABLE ${qualified(target.database, target.table)}`)).rows; active(context);
  return Array.isArray(final) && final.length === 1 && final[0]['Create Table'] === document.source;
}
