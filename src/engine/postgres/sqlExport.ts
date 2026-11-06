import type { CellValue } from '../../shared/contracts';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresTableColumn } from '../../shared/postgresTable';
import type { PostgresConnection } from './connection';

const settings = ['DateStyle', 'IntervalStyle', 'TimeZone', 'timezone_abbreviations', 'lc_monetary', 'xmloption', 'extra_float_digits', 'search_path'] as const;
export type PostgresSqlExportSettings = Record<typeof settings[number], string>;
export interface PostgresTableBackupSql {
  sequences: string[];
  table: string;
  defaults: string[];
  afterData: string[];
  foreignKeys: string[];
  finalize: string[];
}
type Write = (chunk: string) => Promise<void>;

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

/** 回放脚本的文本解释设置只在备份自己的事务内生效。 */
export function writePostgresSqlPreamble(values: PostgresSqlExportSettings, write: Write, title: string) {
  return write('-- tabrelio PostgreSQL ' + title + ' (UTF-8)\nBEGIN;\nSELECT\n  ' +
    settings.map(name => 'pg_catalog.set_config(' + postgresDdlLiteral(name) + ', ' + postgresDdlLiteral(values[name]) + ', true)').join(',\n  ') + ';\n');
}

export async function writePostgresSqlStatements(statements: Iterable<string>, write: Write) {
  for (const statement of statements) await write(statement + ';\n');
}

/** 按行数和字节封顶多行 INSERT，多表回放共享同一个外层事务。 */
export async function writePostgresSqlRows(table: string, columns: PostgresTableColumn[],
  source: AsyncIterable<CellValue[]>, write: Write, progress: (rows: number) => void) {
  const prefix = 'INSERT INTO ' + table + ' (' + columns.map(column => postgresIdentifier(column.name)).join(', ') + ')' +
    (columns.some(column => column.identityAlways) ? ' OVERRIDING SYSTEM VALUE' : '') + ' VALUES\n';
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
  return rows;
}

/** 单表备份和原 SQL 数据导出沿用同一个事务脚本入口。 */
export async function writePostgresSqlData(table: string, columns: PostgresTableColumn[], values: PostgresSqlExportSettings,
  source: AsyncIterable<CellValue[]>, write: Write, progress: (rows: number) => void, backup?: PostgresTableBackupSql) {
  await writePostgresSqlPreamble(values, write, backup ? '单表备份' : 'data export');
  if (backup) await writePostgresSqlStatements([...backup.sequences, backup.table, ...backup.defaults], write);
  const rows = await writePostgresSqlRows(table, columns, source, write, progress);
  if (backup) await writePostgresSqlStatements([...backup.afterData, ...backup.foreignKeys, ...backup.finalize], write);
  await write('COMMIT;\n');
  return rows;
}
