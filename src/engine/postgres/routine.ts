import type { DatabaseObject } from '../../shared/contracts';
import { postgresRoutineInfoSchema, type PostgresRoutineReadInput } from '../../shared/postgresRoutine';
import type { PostgresConnection } from './connection';
import { startPostgresDdl } from './createTable';

// 只用输入类型向量区分重载，参数名称、默认值和 OUT 字段的变化不改变身份。
const signature = `pg_catalog.format('"%s"."%s"(%s)', pg_catalog.replace(n.nspname::text, '"', '""'),
  pg_catalog.replace(p.proname::text, '"', '""'), pg_catalog.oidvectortypes(p.proargtypes))`;
const source = `FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace`;
const visible = `p.prokind IN ('f', 'p', 'w') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND (pg_catalog.has_function_privilege(p.oid, 'EXECUTE')
    OR pg_catalog.pg_has_role(p.proowner, 'USAGE'))`;

/** 固定 search_path 生成可重复解析的签名，保留非系统类型的完整限定名。 */
export async function readPostgresRoutineCatalog(connection: PostgresConnection): Promise<DatabaseObject[]> {
  // 对象目录使用独立短连接，一次往返固定签名输出和读取预算。
  const settings = await connection.query(`SELECT pg_catalog.current_setting('server_version_num'),
    pg_catalog.set_config('search_path', 'pg_catalog', false), pg_catalog.set_config('statement_timeout', '5s', false),
    pg_catalog.set_config('lock_timeout', '1s', false)`, undefined, { rows: 1, bytes: 1024 });
  const version = Number(settings.rows[0]?.c0);
  if (!Number.isInteger(version)) throw Error('PostgreSQL 目录版本读取未完成');
  if (version < 110000) return []; // 旧目录没有 prokind，保持已有关系列表可用。
  const result = await connection.query(`SELECT ${signature}, p.prokind::text ${source}
    WHERE ${visible} ORDER BY n.nspname, p.proname, p.proargtypes LIMIT 10001`, undefined, { rows: 10001, bytes: 4 * 1024 * 1024 });
  return result.rows.slice(0, 10000).map(row => ({ name: String(row.c0), kind: row.c1 === 'p' ? 'procedure' : 'function' }));
}

/** 按 schema、名称和目录签名匹配重载，不解析用户对参数类型的访问权限。 */
export async function readPostgresRoutine(connection: PostgresConnection, input: PostgresRoutineReadInput) {
  const qualified = /^"((?:[^"]|"")+)"\."((?:[^"]|"")+)"\(/.exec(input.name);
  if (!qualified) throw Error('PostgreSQL 重载签名无效');
  const [, schema, name] = qualified.map(value => value.replaceAll('""', '"'));
  await startPostgresDdl(connection, true);
  const result = await connection.query(`SELECT pg_catalog.jsonb_build_object(
    'name', ${signature}, 'category', p.prokind::text, 'arguments', pg_catalog.pg_get_function_arguments(p.oid),
    'returns', pg_catalog.pg_get_function_result(p.oid), 'language', l.lanname, 'owner', pg_catalog.pg_get_userbyid(p.proowner),
    'volatility', p.provolatile::text, 'securityDefiner', p.prosecdef, 'comment', pg_catalog.obj_description(p.oid, 'pg_proc'),
    'definition', pg_catalog.pg_get_functiondef(p.oid))::text
    ${source} JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = $2::name AND p.proname = $3::name AND ${visible}
      AND (CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END) = $4
      AND ${signature} = $1`, [input.name, schema, name, input.kind], { rows: 2, bytes: 2 * 1024 * 1024 });
  if ((await connection.query('COMMIT', undefined, { rows: 0, bytes: 1024 })).postgresCommand !== 'COMMIT')
    throw Error('PostgreSQL 函数定义读取未完成');
  if (result.truncated) throw Error('PostgreSQL 函数定义超过读取预算');
  const row = result.rows[0];
  if (result.rows.length !== 1 || typeof row.c0 !== 'string') throw Error('PostgreSQL 重载不存在、已改名或当前角色不可见');
  return postgresRoutineInfoSchema.parse(JSON.parse(row.c0));
}
