import { postgresColumnStatistics, postgresStatisticValueLimit } from '../../shared/postgresColumnStatistics';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresTableColumn } from '../../shared/postgresTable';
import type { PostgresConnection } from './connection';

/** 只接收已核对的目录列和绑定条件。原始字段只读一次，避免易变视图的计数与极值脱节。 */
export async function readPostgresColumnStatistics(connection: PostgresConnection, column: PostgresTableColumn, from: string, args: unknown[]) {
  const isText = column.valueOptions && /^(text|character(?: varying)?(?:\(\d+\))?)$/.test(column.type);
  const isNumeric = column.valueOptions && /^(smallint|integer|bigint|real|double precision|numeric(?:\(.*\))?)$/.test(column.type);
  const finite = `value::text NOT IN ('NaN', 'Infinity', '-Infinity')`;
  const bounded = (sql: string) => `pg_catalog.left((${sql})::text, ${postgresStatisticValueLimit + 1})`;
  const aggregate = (name: string) => bounded(`pg_catalog.${name}(value) FILTER (WHERE ${finite})`);
  const groups = column.valueOptions ? `, 'groups', (SELECT pg_catalog.jsonb_build_object(
    'distinct', pg_catalog.count(*)::text, 'unique', (pg_catalog.count(*) FILTER (WHERE frequency = 1))::text,
    'min', (SELECT ${bounded('value')} FROM frequency ORDER BY value ASC LIMIT 1),
    'max', (SELECT ${bounded('value')} FROM frequency ORDER BY value DESC LIMIT 1)
    ) FROM frequency)` : '';
  const numeric = isNumeric ? `, 'numeric', pg_catalog.jsonb_build_object(
    'zero', (pg_catalog.count(*) FILTER (WHERE value = 0))::text,
    'nonFinite', (pg_catalog.count(*) FILTER (WHERE NOT (${finite})))::text,
    'sum', ${aggregate('sum')}, 'average', ${aggregate('avg')}, 'deviation', ${aggregate('stddev_pop')}
    )` : '';
  // 重用 CTE 让不同值和聚合统计共享原始结果。分组与排序使用列本身的类型及排序规则。
  const result = await connection.query(`
    WITH source(value) AS (SELECT ${postgresIdentifier(column.name)} FROM ${from})
    ${groups ? ', frequency AS (SELECT value, pg_catalog.count(*) AS frequency FROM source WHERE value IS NOT NULL GROUP BY value)' : ''}
    SELECT pg_catalog.jsonb_build_object('rows', pg_catalog.count(*)::text, 'nonNull', pg_catalog.count(value)::text
      ${isText ? ", 'empty', (pg_catalog.count(*) FILTER (WHERE pg_catalog.octet_length(value::text) = 0))::text" : ''}
      ${groups}${numeric}
    ) FROM source
  `, args, { rows: 1, bytes: 256 * 1024 });
  const data = result.rows[0]?.c0;
  if (result.truncated || result.rows.length !== 1 || typeof data !== 'string') throw Error('PostgreSQL 字段概况未完整返回');
  return postgresColumnStatistics(JSON.parse(data));
}
