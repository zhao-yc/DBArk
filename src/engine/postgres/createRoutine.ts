import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import type { PostgresRoutineCreateInput } from '../../shared/postgresRoutine';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresConnection } from './connection';

// 驱动会消耗传入的预算，每次目录请求都要独立分配。
const budget = () => ({ rows: 2, bytes: 256 * 1024 });
const parameterModes = { in: 'i', out: 'o', inout: 'b', variadic: 'v' } as const;

/** 类型只从目录取得可拼接的规范名称，OID 用于识别同名替换。 */
async function readTypes(connection: PostgresConnection, names: string[]) {
  if (!names.length) return [];
  const result = await connection.query(`SELECT t.oid::text, pg_catalog.format_type(t.oid, NULL)
    FROM pg_catalog.jsonb_array_elements_text($1::jsonb) WITH ORDINALITY AS requested(name, position)
    JOIN pg_catalog.pg_type t ON t.oid = pg_catalog.to_regtype(requested.name)
    WHERE pg_catalog.has_schema_privilege(t.typnamespace, 'USAGE') AND pg_catalog.has_type_privilege(t.oid, 'USAGE')
    ORDER BY requested.position`, [JSON.stringify(names)], { rows: 102, bytes: 128 * 1024 });
  if (result.truncated || result.rows.length !== names.length) throw Error('部分参数或返回类型不存在或不可用');
  return result.rows.map(row => ({ oid: String(row.c0), sql: String(row.c1) }));
}

/** 预览与确认共用原 schema、角色、输入类型和重载检查。 */
async function readTarget(connection: PostgresConnection, draft: PostgresRoutineCreateInput) {
  const explicitReturn = draft.kind === 'function' && draft.returns;
  const types = await readTypes(connection, [...draft.parameters.map(parameter => parameter.type), ...(explicitReturn ? [explicitReturn] : [])]);
  const inputVector = draft.parameters.flatMap((parameter, index) => parameter.mode === 'out' ? [] : [types[index].oid]).join(' ');
  const result = await connection.query(`SELECT n.oid::text, r.oid::text, pg_catalog.current_setting('max_identifier_length'),
    EXISTS (SELECT FROM pg_catalog.pg_proc p WHERE p.pronamespace = n.oid AND p.proname = $2::name AND p.proargtypes::text = $3)
    FROM pg_catalog.pg_namespace n CROSS JOIN pg_catalog.pg_roles r
    WHERE n.nspname::text = $1 AND r.rolname = current_user
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND pg_catalog.has_schema_privilege(n.oid, 'CREATE')`,
  [draft.schema, draft.name, inputVector], budget());
  const row = result.rows[0];
  if (result.truncated || result.rows.length !== 1 || typeof row.c0 !== 'string' || typeof row.c1 !== 'string')
    throw Error('PostgreSQL schema 不存在或没有创建权限');
  if (row.c3 === 't') throw Error('目标 schema 已存在相同输入签名的例程');
  if ([draft.name, ...draft.parameters.map(parameter => parameter.name)].some(name => Buffer.byteLength(name) > Number(row.c2)))
    throw Error('例程或参数名称超过服务器标识符长度');
  return { schemaOid: row.c0, ownerOid: row.c1, types, inputVector };
}

/** 正文以独立字符串保存，DDL 由结构化字段生成，确认后同一事务内回读。 */
export async function compilePostgresRoutine(connection: PostgresConnection, draft: PostgresRoutineCreateInput) {
  const original = await readTarget(connection, draft);
  const { types, schemaOid, ownerOid, inputVector } = original;
  const qualified = [draft.schema, draft.name].map(postgresIdentifier).join('.');
  const inputTypes = draft.parameters.flatMap((parameter, index) => parameter.mode === 'out' ? [] : [types[index].sql]);
  const identity = qualified + '(' + inputTypes.join(', ') + ')';
  const parameters = draft.parameters.map((parameter, index) => {
    const value = parameter.default;
    const defaultSql = value.mode === 'none' ? '' : ' DEFAULT ' + (value.mode === 'null' ? 'NULL' : postgresDdlLiteral(value.value));
    return parameter.mode.toUpperCase() + ' ' + postgresIdentifier(parameter.name) + ' ' + types[index].sql + defaultSql;
  });
  const routineType = draft.kind.toUpperCase();
  let expectedReturn: string | null = null;
  let setReturning = false;
  let volatility = 'v';
  let returns = '';
  if (draft.kind === 'function') {
    const outputTypes = draft.parameters.flatMap((parameter, index) =>
      parameter.mode === 'out' || parameter.mode === 'inout' ? [types[index].sql] : []);
    expectedReturn = draft.returns ? types.at(-1)!.sql : outputTypes.length === 1 ? outputTypes[0] : 'record';
    setReturning = draft.setReturning;
    volatility = draft.volatility[0];
    if (draft.returns || setReturning) returns = '\nRETURNS ' + (setReturning ? 'SETOF ' : '') + expectedReturn;
  }
  const security = draft.securityDefiner ? 'SECURITY DEFINER\nSET search_path TO pg_catalog, pg_temp' : 'SECURITY INVOKER';
  const statements = ['CREATE ' + routineType + ' ' + qualified + '(' + parameters.join(', ') + ')' + returns +
    '\nLANGUAGE ' + draft.language + (draft.kind === 'function' ? '\n' + draft.volatility.toUpperCase() : '') +
    '\n' + security + '\nAS ' + postgresDdlLiteral(draft.body)];
  if (draft.comment) statements.push('COMMENT ON ' + routineType + ' ' + identity + ' IS ' + postgresDdlLiteral(draft.comment));
  const stamp = JSON.stringify(original);
  return { table: identity, statements, protocol: 'extended' as const,
    success: draft.kind === 'function' ? 'PostgreSQL 函数已确认创建' : 'PostgreSQL 过程已确认创建',
    async preflight(current: PostgresConnection) {
      if (JSON.stringify(await readTarget(current, draft)) !== stamp) throw Error('原 schema、角色或参数类型已变化，请重新预览');
      await current.query('SET LOCAL check_function_bodies = on', undefined, budget());
      return stamp;
    },
    async verify(current: PostgresConnection) {
      const result = await current.query(`SELECT pg_catalog.jsonb_build_object(
        'body', p.prosrc, 'language', l.lanname, 'types', COALESCE(p.proallargtypes, p.proargtypes::oid[]),
        'names', COALESCE(p.proargnames, ARRAY[]::text[]), 'modes', p.proargmodes,
        'returns', pg_catalog.pg_get_function_result(p.oid), 'returnOid', p.prorettype::text,
        'setReturning', p.proretset, 'volatility', p.provolatile::text,
        'definer', p.prosecdef, 'config', p.proconfig, 'comment', pg_catalog.obj_description(p.oid, 'pg_proc'),
        'defaults', p.pronargdefaults)::text
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
        WHERE p.pronamespace = $1::oid AND p.proname = $2::name AND p.proargtypes::text = $3 AND p.proowner = $4::oid
          AND p.prokind::text = $5`, [schemaOid, draft.name, inputVector, ownerOid, draft.kind === 'function' ? 'f' : 'p'],
      { rows: 2, bytes: 1024 * 1024 });
      const row = result.rows[0];
      if (result.truncated || result.rows.length !== 1 || typeof row.c0 !== 'string') throw Error('未确认新例程的身份');
      const actual = JSON.parse(row.c0);
      const expected = { body: draft.body, language: draft.language, types: types.slice(0, draft.parameters.length).map(type => type.oid),
        names: draft.parameters.map(parameter => parameter.name), modes: draft.parameters.map(parameter => parameterModes[parameter.mode]),
        returns: setReturning ? 'SETOF ' + expectedReturn : expectedReturn, setReturning, volatility, definer: draft.securityDefiner,
        ...(draft.kind === 'function' && draft.returns ? { returnOid: types.at(-1)!.oid } : {}),
        config: draft.securityDefiner ? ['search_path=pg_catalog, pg_temp'] : null, comment: draft.comment || null,
        defaults: draft.parameters.filter(parameter => parameter.default.mode !== 'none').length };
      actual.types = actual.types?.map(String);
      actual.modes ??= draft.parameters.map(() => 'i');
      if (Object.entries(expected).some(([key, value]) => JSON.stringify(actual[key]) !== JSON.stringify(value)))
        throw Error('实际例程参数、属性或正文与预览不同，未提交');
    },
  };
}
