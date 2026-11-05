import { createHash } from 'node:crypto';
import type { DatabaseObject } from '../../shared/contracts';
import { postgresRoutineInfoSchema, type PostgresRoutineManageInput, type PostgresRoutineReadInput } from '../../shared/postgresRoutine';
import { postgresIdentifier } from '../../shared/postgresSql';
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

/** 原事务内匹配完整签名；目录摘要保留可见定义之外的所有者、授权和配置。 */
export async function readPostgresRoutineFacts(connection: PostgresConnection, input: PostgresRoutineReadInput) {
  const qualified = /^"((?:[^"]|"")+)"\."((?:[^"]|"")+)"\(/.exec(input.name);
  if (!qualified) throw Error('PostgreSQL 重载签名无效');
  const [, schema, name] = qualified.map(value => value.replaceAll('""', '"'));
  const result = await connection.query(`SELECT pg_catalog.jsonb_build_object(
    'name', ${signature}, 'category', p.prokind::text, 'arguments', pg_catalog.pg_get_function_arguments(p.oid),
    'returns', pg_catalog.pg_get_function_result(p.oid), 'language', l.lanname, 'owner', pg_catalog.pg_get_userbyid(p.proowner),
    'volatility', p.provolatile::text, 'securityDefiner', p.prosecdef, 'comment', pg_catalog.obj_description(p.oid, 'pg_proc'),
    'definition', pg_catalog.pg_get_functiondef(p.oid))::text,
    p.oid::text, n.oid::text, p.proargtypes::text, p.xmin::text, pg_catalog.pg_has_role(p.proowner, 'USAGE'),
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((pg_catalog.to_jsonb(p) - 'proname')::text, 'UTF8')), 'hex')
    ${source} JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = $2::name AND p.proname = $3::name AND ${visible}
      AND (CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END) = $4
      AND ${signature} = $1`, [input.name, schema, name, input.kind], { rows: 2, bytes: 2 * 1024 * 1024 });
  if (result.truncated) throw Error('PostgreSQL 函数定义超过读取预算');
  const row = result.rows[0];
  if (result.rows.length !== 1 || typeof row.c0 !== 'string' || typeof row.c1 !== 'string' || typeof row.c2 !== 'string' ||
      typeof row.c3 !== 'string' || typeof row.c4 !== 'string' || typeof row.c6 !== 'string')
    throw Error('PostgreSQL 重载不存在、已改名或当前角色不可见');
  const catalog = JSON.parse(row.c0);
  const canManage = row.c5 === 't';
  const preserved = JSON.stringify([row.c1, row.c2, row.c6, catalog.owner, catalog.comment]);
  const stamp = createHash('sha256').update(JSON.stringify([input.name, preserved, row.c4, canManage])).digest('hex');
  return { schema, name, oid: row.c1, schemaOid: row.c2, inputVector: row.c3, preserved,
    argumentsSql: input.name.slice(qualified[0].length - 1), info: postgresRoutineInfoSchema.parse({ ...catalog, canManage, stamp }) };
}

/** 独立定义读取按目录解析重载，不依赖参数类型的访问权限。 */
export async function readPostgresRoutine(connection: PostgresConnection, input: PostgresRoutineReadInput) {
  await startPostgresDdl(connection, true);
  const { info } = await readPostgresRoutineFacts(connection, input);
  if ((await connection.query('COMMIT', undefined, { rows: 0, bytes: 1024 })).postgresCommand !== 'COMMIT')
    throw Error('PostgreSQL 函数定义读取未完成');
  return info;
}

/** 用同所有者命令锁定 pg_proc 对象，锁后复核目录，删除始终由 RESTRICT 检查依赖。 */
export async function compilePostgresRoutineManage(connection: PostgresConnection, input: PostgresRoutineManageInput) {
  const original = await readPostgresRoutineFacts(connection, input);
  if (!original.info.canManage) throw Error('当前角色没有例程管理权限');
  if (original.info.stamp !== input.stamp) throw Error('原例程已变化，请刷新定义后继续');
  const budget = () => ({ rows: 2, bytes: 4096 });
  const sqlKind = input.kind === 'function' ? 'FUNCTION ' : 'PROCEDURE ';
  const label = input.kind === 'function' ? '函数' : '过程';
  const sqlTarget = sqlKind + original.info.name;
  const guard = { sql: 'ALTER ' + sqlTarget + ' OWNER TO ' + postgresIdentifier(original.info.owner), stamp: original.info.stamp };

  async function assertRenameAvailable(current: PostgresConnection, newName: string) {
    const result = await current.query(`SELECT EXISTS (SELECT FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = $1::oid AND p.proname = $2::name AND p.proargtypes::text = $3),
      pg_catalog.current_setting('max_identifier_length')`, [original.schemaOid, newName, original.inputVector], budget());
    const row = result.rows[0];
    if (result.truncated || result.rows.length !== 1 || row.c0 !== 'f') throw Error('目标名称已存在相同输入签名');
    if (Buffer.byteLength(newName) > Number(row.c1)) throw Error('新名称超过服务器标识符长度');
  }

  const plan = {
    guard, protocol: 'extended' as const,
    async preflight(current: PostgresConnection) {
      const facts = await readPostgresRoutineFacts(current, input);
      if (facts.info.stamp !== original.info.stamp) throw Error('原例程已变化，请刷新定义后继续');
      if (input.action === 'rename') await assertRenameAvailable(current, input.newName);
      return facts.info.stamp;
    },
  };
  if (input.action === 'rename') {
    if (input.newName === original.name) throw Error('请输入不同的例程名称');
    await assertRenameAvailable(connection, input.newName);
    const identifier = postgresIdentifier(input.newName);
    const destination = postgresIdentifier(original.schema) + '.' + identifier + original.argumentsSql;
    return { ...plan, table: destination, success: 'PostgreSQL ' + label + '已确认重命名',
      statements: ['ALTER ' + sqlTarget + ' RENAME TO ' + identifier],
      async verify(current: PostgresConnection) {
        const actual = await readPostgresRoutineFacts(current, { ...input, name: destination });
        if (actual.preserved !== original.preserved) throw Error('重命名后的例程身份或属性与原例程不同，未提交');
      },
    };
  }
  return { ...plan, table: input.name, success: 'PostgreSQL ' + label + '已确认删除',
    statements: ['DROP ' + sqlTarget + ' RESTRICT'],
    async verify(current: PostgresConnection) {
      const result = await current.query(`SELECT EXISTS (SELECT FROM pg_catalog.pg_proc p WHERE p.oid = $1::oid
        OR (p.pronamespace = $2::oid AND p.proname = $3::name AND p.proargtypes::text = $4))`,
      [original.oid, original.schemaOid, original.name, original.inputVector], budget());
      if (result.truncated || result.rows.length !== 1 || result.rows[0].c0 !== 'f') throw Error('未确认原例程已从目录删除');
    },
  };
}
