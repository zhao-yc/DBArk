import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresTableColumn } from '../../shared/postgresTable';
import { decodePostgresTableHistogram, postgresHistogramBins, postgresHistogramBoundLimit, postgresHistogramKind, type PostgresHistogramBins } from '../../shared/postgresTableHistogram';
import type { PostgresConnection } from './connection';

/** 浮点候选与分布都依赖可往返的服务器文本，但不能修改会影响原筛选的会话设置。 */
export async function hasPostgresRoundtripFloatText(connection: PostgresConnection) {
  const precision = await connection.query("SELECT pg_catalog.current_setting('extra_float_digits')::int >= 3 OR " +
    "(pg_catalog.current_setting('server_version_num')::int >= 120000 AND pg_catalog.current_setting('extra_float_digits')::int > 0)",
  undefined, { rows: 1, bytes: 1024 });
  return !precision.truncated && precision.rows[0]?.c0 === 't';
}

/** 一个共享 CTE 固定字段值，易变视图的极值与计数也来自同一次读取。 */
export async function readPostgresTableHistogram(connection: PostgresConnection, column: PostgresTableColumn,
  from: string, args: unknown[], requestedBins: PostgresHistogramBins) {
  const bins = postgresHistogramBins.parse(requestedBins);
  const kind = postgresHistogramKind(column);
  if (!kind) throw Error('当前 PostgreSQL 字段不支持数值分布');
  if (kind === 'float' && !await hasPostgresRoundtripFloatText(connection))
    throw Error('服务器浮点文本输出精度不足，无法准确区分数值分布区间');
  const value = kind === 'integer' ? 'value::numeric' : `CASE WHEN value::text NOT IN ('NaN', 'Infinity', '-Infinity')
    THEN ${kind === 'float' ? 'value::text::numeric' : 'value'} END`;
  const step = { 5: '0.2', 10: '0.1', 20: '0.05' }[bins];
  // 加权端点无需先相减，避免大范围差值扩大；数组原生比较包含每个区间的左端点。
  const result = await connection.query(`
    WITH raw(value) AS (SELECT ${postgresIdentifier(column.name)} FROM ${from}),
    source AS (SELECT value IS NULL AS is_null, ${value} AS finite FROM raw),
    bounds AS (
      SELECT pg_catalog.count(*) AS rows, pg_catalog.count(*) FILTER (WHERE is_null) AS nulls,
        pg_catalog.count(finite) AS finite, pg_catalog.min(finite) AS low, pg_catalog.max(finite) AS high
      FROM source
    ), checked AS (
      SELECT *, greatest(pg_catalog.length(low::text), pg_catalog.length(high::text)) > ${postgresHistogramBoundLimit} AS oversized
      FROM bounds
    ), cuts AS (
      SELECT DISTINCT low * (1 - slot * ${step}) + high * (slot * ${step}) AS lower
      FROM checked CROSS JOIN pg_catalog.generate_series(0, ${bins - 1}) AS slots(slot)
      WHERE NOT oversized AND low IS NOT NULL
    ), edges AS (SELECT pg_catalog.array_agg(lower ORDER BY lower) AS points FROM cuts),
    frequencies AS (
      SELECT pg_catalog.width_bucket(finite, points) AS slot, pg_catalog.count(*) AS quantity
      FROM source CROSS JOIN edges WHERE finite IS NOT NULL AND points IS NOT NULL GROUP BY 1
    )
    SELECT CASE WHEN oversized THEN NULL ELSE pg_catalog.json_build_object(
      'rows', rows::text, 'nulls', nulls::text, 'finite', finite::text, 'high', high::text,
      'buckets', COALESCE((SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
        'lower', lower::text, 'count', COALESCE(quantity, 0)::text) ORDER BY slot)
        FROM edges CROSS JOIN pg_catalog.unnest(points) WITH ORDINALITY AS bucket(lower, slot)
        LEFT JOIN frequencies USING (slot)), '[]'::json)
    ) END FROM checked
  `, args, { rows: 1, bytes: 256 * 1024 });
  const data = result.rows[0]?.c0;
  if (result.truncated || result.rows.length !== 1) throw Error('PostgreSQL 数值分布未完整返回');
  if (data === null) throw Error('PostgreSQL 数值分布的极值超过边界长度预算');
  if (typeof data !== 'string') throw Error('PostgreSQL 数值分布未完整返回');
  return decodePostgresTableHistogram(JSON.parse(data), column.name, bins, kind === 'float');
}
