import type { CellValue } from '../../shared/contracts';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresTableColumn } from '../../shared/postgresTable';
import type { PostgresConnection } from './connection';

const settings = ['DateStyle', 'IntervalStyle', 'TimeZone', 'timezone_abbreviations', 'lc_monetary', 'xmloption', 'extra_float_digits', 'search_path'] as const;
export type PostgresSqlExportSettings = Record<typeof settings[number], string>;
export interface PostgresTableBackupSql { beforeData: string[]; afterData: string[]; }

/** 读取游标所用的文本解释环境，保留实际 schema 顺序和能往返的浮点精度。 */
export async function readPostgresSqlExportSettings(connection: PostgresConnection): Promise<PostgresSqlExportSettings> {
  const names = settings.slice(0, -1).map(name => 'pg_catalog.current_setting(' + postgresDdlLiteral(name) + ')');
  const result = await connection.query('SELECT ' + names.join(', ') +
    ", COALESCE((SELECT pg_catalog.string_agg(pg_catalog.quote_ident(ns), ',' ORDER BY pos) " +
    "FROM pg_catalog.unnest(pg_catalog.current_schemas(true)) WITH ORDINALITY AS s(ns, pos)), '')",
  undefined, { rows: 1, bytes: 64 * 1024 });
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || settings.some((_, i) => typeof row['c' + i] !== 'string'))
    throw Error('PostgreSQL SQL 导出的会话设置未完整读取');
  const values = Object.fromEntries(settings.map((name, i) => [name, row['c' + i]])) as PostgresSqlExportSettings;
  if (!(Number(values.extra_float_digits) > 0)) throw Error('SQL 导出要求 PostgreSQL 的 extra_float_digits 大于 0，以保留浮点往返精度');
  return values;
}

/** 以目标列类型解释字面值，字节使用 PostgreSQL BYTEA 十六进制输入格式。 */
function literal(value: CellValue) {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return postgresDdlLiteral(value);
  if (typeof value === 'object') return postgresDdlLiteral('\\x' + Buffer.from(value.base64, 'base64').toString('hex'));
  throw Error('PostgreSQL SQL 导出值不是原始文本或字节');
}

/** 按行数和字节封顶多行 INSERT，回放脚本内的设置只在原事务生效。 */
export async function writePostgresSqlData(table: string, columns: PostgresTableColumn[], values: PostgresSqlExportSettings,
  source: AsyncIterable<CellValue[]>, write: (chunk: string) => Promise<void>, progress: (rows: number) => void,
  backup?: PostgresTableBackupSql) {
  const prefix = 'INSERT INTO ' + table + ' (' + columns.map(column => postgresIdentifier(column.name)).join(', ') + ')' +
    (columns.some(column => column.identityAlways) ? ' OVERRIDING SYSTEM VALUE' : '') + ' VALUES\n';
  await write((backup ? '-- tabrelio PostgreSQL 单表备份 (UTF-8)\n' : '-- tabrelio PostgreSQL data export (UTF-8)\n') + 'BEGIN;\nSELECT\n  ' +
    settings.map(name => 'pg_catalog.set_config(' + postgresDdlLiteral(name) + ', ' + postgresDdlLiteral(values[name]) + ', true)').join(',\n  ') + ';\n');
  for (const statement of backup?.beforeData ?? []) await write(statement + ';\n');
  let tuples: string[] = [], bytes = 0, rows = 0;
  /** 一次只写入当前有界批次，完成磁盘背压后继续消费游标。 */
  async function flush() {
    if (!tuples.length) return;
    await write(prefix + tuples.join(',\n') + ';\n');
    tuples = [];
    bytes = 0;
  }
  for await (const row of source) {
    if (row.length !== columns.length) throw Error('PostgreSQL SQL 导出行与字段不一致');
    const tuple = '(' + row.map(literal).join(', ') + ')';
    const size = Buffer.byteLength(tuple) + 2;
    if (tuples.length >= 64 || bytes + size > 1024 * 1024) await flush();
    tuples.push(tuple);
    bytes += size;
    if (++rows % 256 === 0) progress(rows);
  }
  await flush();
  for (const statement of backup?.afterData ?? []) await write(statement + ';\n');
  await write('COMMIT;\n');
  return rows;
}
