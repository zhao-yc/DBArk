import { createHash } from 'node:crypto';
import type { DatabaseObject } from '../../shared/contracts';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
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
  // 保留 float4 的往返精度，避免连接默认显示精度影响估算值的核对。
  await connection.query('SET LOCAL extra_float_digits = 3', undefined, { rows: 0, bytes: 1024 });
  const result = await connection.query(`SELECT pg_catalog.jsonb_build_object(
    'name', ${signature}, 'category', p.prokind::text, 'arguments', pg_catalog.pg_get_function_arguments(p.oid),
    'returns', pg_catalog.pg_get_function_result(p.oid), 'language', l.lanname, 'owner', pg_catalog.pg_get_userbyid(p.proowner),
    'volatility', p.provolatile::text, 'securityDefiner', p.prosecdef, 'comment', pg_catalog.obj_description(p.oid, 'pg_proc'),
    'strict', p.proisstrict, 'parallel', p.proparallel::text, 'cost', p.procost::text,
    'rows', CASE WHEN p.proretset THEN p.prorows::text END, 'configuration', p.proconfig,
    'definition', pg_catalog.pg_get_functiondef(p.oid),
    'editableBody', CASE WHEN l.lanname IN ('sql', 'plpgsql') AND p.probin IS NULL
      AND pg_catalog.to_jsonb(p)->>'prosqlbody' IS NULL AND pg_catalog.octet_length(p.prosrc) BETWEEN 1 AND 131072
      AND pg_catalog.pg_has_role(p.proowner, 'USAGE') THEN p.prosrc END)::text,
    p.oid::text, n.oid::text, p.proargtypes::text, p.xmin::text, pg_catalog.pg_has_role(p.proowner, 'USAGE'),
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((pg_catalog.to_jsonb(p) - 'proname')::text, 'UTF8')), 'hex')
    ${source} JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE n.nspname = $2::name AND p.proname = $3::name AND ${visible}
      AND (CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END) = $4
      AND ${signature} = $1`, [input.name, schema, name, input.kind], { rows: 2, bytes: 3 * 1024 * 1024 });
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

/** 目录摘要仅排除计划允许变化的属性，同时覆盖出向依赖。 */
async function readRoutineShape(connection: PostgresConnection, oid: string, columns: string[], includeComment = true) {
  const result = await connection.query(`SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(p) - $2::text[],
      CASE WHEN $3::boolean THEN pg_catalog.obj_description(p.oid, 'pg_proc') END, (SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(d.objsubid, d.refclassid, d.refobjid, d.refobjsubid, d.deptype)
        ORDER BY d.objsubid, d.refclassid, d.refobjid, d.refobjsubid, d.deptype)
      FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND d.objid = p.oid)
    )::text, 'UTF8')), 'hex') FROM pg_catalog.pg_proc p WHERE p.oid = $1::oid`,
  [oid, '{' + columns.join(',') + '}', includeComment ? 'true' : 'false'], { rows: 2, bytes: 1024 });
  if (result.truncated || result.rows.length !== 1 || typeof result.rows[0].c0 !== 'string')
    throw Error('未确认原例程属性与依赖');
  return result.rows[0].c0;
}

const volatilitySql = { i: 'IMMUTABLE', s: 'STABLE', v: 'VOLATILE' } as const;
const parallelSql = { u: 'UNSAFE', r: 'RESTRICTED', s: 'SAFE' } as const;

/** 构造有限的 ALTER 属性选项，启用定义者身份时同时固定搜索路径。 */
async function planRoutineProperties(connection: PostgresConnection, sqlTarget: string,
  info: Awaited<ReturnType<typeof readPostgresRoutineFacts>>['info'],
  changes: Extract<PostgresRoutineManageInput, { action: 'properties' }>['changes']) {
  if (info.category === 'p' && [changes.volatility, changes.parallel, changes.strict, changes.cost, changes.rows].some(value => value !== undefined))
    throw Error('过程只支持编辑执行身份和注释');
  if (changes.rows !== undefined && info.rows === null) throw Error('仅返回集合的函数可设置估算行数');
  const estimates = await connection.query('SELECT $1::real::text, $2::real::text',
    [changes.cost ?? null, changes.rows ?? null], { rows: 2, bytes: 1024 });
  const estimate = estimates.rows[0];
  if (estimates.truncated || estimates.rows.length !== 1) throw Error('未确认 PostgreSQL 估算值');
  if ([estimate.c0, estimate.c1].some(value => value !== null && !(Number(value) > 0 && Number.isFinite(Number(value)))))
    throw Error('估算值超出 PostgreSQL real 的正数范围');
  const expected = {
    volatility: changes.volatility ?? info.volatility, parallel: changes.parallel ?? info.parallel,
    strict: changes.strict ?? info.strict, securityDefiner: changes.securityDefiner ?? info.securityDefiner,
    cost: typeof estimate.c0 === 'string' ? estimate.c0 : info.cost,
    rows: typeof estimate.c1 === 'string' ? estimate.c1 : info.rows,
    comment: changes.comment === undefined ? info.comment : changes.comment,
    configuration: info.configuration,
  };
  const options: string[] = [];
  if (expected.volatility !== info.volatility) options.push(volatilitySql[expected.volatility]);
  if (expected.parallel !== info.parallel) options.push('PARALLEL ' + parallelSql[expected.parallel]);
  if (expected.strict !== info.strict) options.push(expected.strict ? 'STRICT' : 'CALLED ON NULL INPUT');
  if (expected.cost !== info.cost) options.push('COST ' + changes.cost);
  if (expected.rows !== info.rows) options.push('ROWS ' + changes.rows);
  if (expected.securityDefiner !== info.securityDefiner) {
    options.push(expected.securityDefiner ? 'SECURITY DEFINER' : 'SECURITY INVOKER');
    if (expected.securityDefiner) {
      options.push('SET search_path TO pg_catalog, pg_temp');
      const existing = info.configuration ?? [];
      const path = 'search_path=pg_catalog, pg_temp';
      expected.configuration = existing.some(value => value.startsWith('search_path='))
        ? existing.map(value => value.startsWith('search_path=') ? path : value) : [...existing, path];
    }
  }
  const statements = options.length ? ['ALTER ' + sqlTarget + ' ' + options.join(' ')] : [];
  if (expected.comment !== info.comment)
    statements.push('COMMENT ON ' + sqlTarget + ' IS ' + (expected.comment === null ? 'NULL' : postgresDdlLiteral(expected.comment)));
  if (!statements.length) throw Error('例程属性没有变化');
  return { statements, expected };
}

/** 仅替换服务器反编译文本中和原 prosrc 逐字一致的最后一个 AS 字面量。 */
function routineBodyStatement(info: { definition: string; editableBody: string | null }, body: string) {
  if (info.editableBody === null) throw Error('当前例程未提供可编辑的 SQL 或 PL/pgSQL 字符串正文');
  if (info.editableBody === body) throw Error('例程正文没有变化');
  const delimiter = /(\$[A-Za-z_][A-Za-z_0-9]*\$)\n$/.exec(info.definition)?.[1];
  const suffix = '\nAS ' + delimiter + info.editableBody + delimiter + '\n';
  if (!delimiter || !info.definition.endsWith(suffix)) throw Error('无法定位服务器定义中的原例程正文');
  return info.definition.slice(0, -suffix.length) + '\nAS ' + postgresDdlLiteral(body);
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
  if (input.action === 'edit') {
    const statement = routineBodyStatement(original.info, input.body);
    const shape = await readRoutineShape(connection, original.oid, ['prosrc']);
    return { ...plan, table: input.name, success: 'PostgreSQL ' + label + '正文已确认更新', statements: [statement],
      async preflight(current: PostgresConnection) {
        const stamp = await plan.preflight(current);
        if (await readRoutineShape(current, original.oid, ['prosrc']) !== shape) throw Error('原例程属性或依赖已变化，请重新预览');
        await current.query('SET LOCAL check_function_bodies = on', undefined, budget());
        return stamp;
      },
      async verify(current: PostgresConnection) {
        const actual = await readPostgresRoutineFacts(current, input);
        if (actual.oid !== original.oid || actual.info.editableBody !== input.body ||
            await readRoutineShape(current, actual.oid, ['prosrc']) !== shape)
          throw Error('回读的正文、例程身份或依赖与预览不同，未提交');
      },
    };
  }
  if (input.action === 'properties') {
    const { statements, expected } = await planRoutineProperties(connection, sqlTarget, original.info, input.changes);
    const editableColumns = ['provolatile', 'proparallel', 'proisstrict', 'prosecdef', 'procost', 'prorows', 'proconfig'];
    const shape = await readRoutineShape(connection, original.oid, editableColumns, false);
    return { ...plan, table: input.name, success: 'PostgreSQL ' + label + '属性已确认更新', statements,
      async preflight(current: PostgresConnection) {
        const stamp = await plan.preflight(current);
        if (await readRoutineShape(current, original.oid, editableColumns, false) !== shape)
          throw Error('原例程属性或依赖已变化，请重新预览');
        return stamp;
      },
      async verify(current: PostgresConnection) {
        const actual = await readPostgresRoutineFacts(current, input);
        if (actual.oid !== original.oid || Object.entries(expected).some(([key, value]) =>
          JSON.stringify(actual.info[key as keyof typeof expected]) !== JSON.stringify(value)) ||
            await readRoutineShape(current, actual.oid, editableColumns, false) !== shape)
          throw Error('回读的例程属性、身份或依赖与预览不同，未提交');
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
