import { structureSearchLimits as limits, type PostgresStructureSearchKind, type StructureSearchHit, type StructureSearchPage } from '../../shared/databaseSearch';
import type { DatabaseSearchPattern } from '../../shared/databaseSearchPattern';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { StructureSearchState } from '../structureSearch';
import type { PostgresConnection } from './connection';
import { postgresStructureVisibleSql } from './relationStructure';
import { postgresRoutineSignatureSql, postgresRoutineVisibleSql } from './routine';
import { postgresSequenceVisibleSql } from './sequence';

const relations = 'FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace';
const schemaScope = "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')";
const relationScope = `${schemaScope} AND c.relpersistence IN ('p','u') AND c.relkind IN ('r','p','v','m','f') AND ${postgresStructureVisibleSql}`;
const qualified = `pg_catalog.format('"%s"."%s"', pg_catalog.replace(n.nspname::text, '"', '""'), pg_catalog.replace(c.relname::text, '"', '""'))`;
const relationKind = "CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END";
const collation = 'COLLATE pg_catalog."C"';

/** 名称来源固定为系统目录，沿用打开详情时的权限范围，不读取表行或执行用户函数。 */
function source(kind: PostgresStructureSearchKind) {
  if (kind === 'procedure' || kind === 'function')
    return `SELECT ${postgresRoutineSignatureSql}, p.proname::text, '${kind}'::text
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE ${postgresRoutineVisibleSql} AND ${kind === 'procedure' ? "p.prokind = 'p'" : "p.prokind IN ('f','w')"}`;
  if (kind === 'sequence') return `SELECT ${qualified}, c.relname::text, 'sequence'::text ${relations}
    WHERE ${schemaScope} AND c.relkind = 'S' AND c.relpersistence IN ('p','u') AND ${postgresSequenceVisibleSql}`;
  if (kind === 'table' || kind === 'view') return `SELECT ${qualified}, c.relname::text, ${relationKind}
    ${relations} WHERE ${relationScope} AND ${kind === 'view' ? "c.relkind IN ('v','m')" : "c.relkind IN ('r','p','f')"}`;
  if (kind === 'column') return `SELECT ${qualified}, a.attname::text, ${relationKind}
    ${relations} JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    WHERE ${relationScope} AND a.attnum > 0 AND NOT a.attisdropped`;
  if (kind === 'index') return `SELECT ${qualified}, ic.relname::text, ${relationKind}
    ${relations} JOIN pg_catalog.pg_index i ON i.indrelid = c.oid JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
    WHERE ${relationScope}`;
  const constraint = { primaryKey: 'p', foreignKey: 'f', uniqueKey: 'u', check: 'c' }[kind];
  if (!constraint) throw Error('未知 PostgreSQL 搜索类别');
  return `SELECT ${qualified}, co.conname::text, ${relationKind}
    ${relations} JOIN pg_catalog.pg_constraint co ON co.conrelid = c.oid
    WHERE ${relationScope} AND co.contype = '${constraint}'`;
}

/** 普通文字不使用 LIKE 通配符。续页使用准确的限定名及名称排序键，重载签名保持独立。 */
export function postgresStructureSearchQuery(kind: PostgresStructureSearchKind, pattern: DatabaseSearchPattern,
  take: number, after?: StructureSearchState['after']) {
  if (!Number.isInteger(take) || take < 1 || take > limits.pageHits) throw Error('结构搜索批次大小无效');
  const name = pattern.caseSensitive ? 'match_name' : 'pg_catalog.lower(match_name)';
  const value = pattern.caseSensitive ? '$1::text' : 'pg_catalog.lower($1::text)';
  const match = pattern.mode === 'regexp' ? `match_name ${pattern.caseSensitive ? '~' : '~*'} $1::text`
    : pattern.mode === 'whole' ? `${name} ${collation} = ${value}`
    : pattern.mode === 'prefix' ? `pg_catalog.starts_with(${name}, ${value})`
    : `pg_catalog.strpos(${name}, ${value}) > 0`;
  const cursor = after ? `AND (object_name ${collation}, match_name ${collation}) > ($2::text, $3::text)` : '';
  return {
    sql: `SELECT object_name, match_name, parent_kind FROM (${source(kind)}) AS names(object_name, match_name, parent_kind)
      WHERE (${match}) ${cursor} ORDER BY object_name ${collation}, match_name ${collation} LIMIT ${take + 1}`,
    params: after ? [pattern.text, after.object, after.name] : [pattern.text],
  };
}

type Read = <T>(database: string, action: (connection: PostgresConnection) => Promise<T>) => Promise<T>;
const stateCode = (error: unknown) => (error as { postgresSqlState?: string }).postgresSqlState;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 512);

/** 每页至多连接一个数据库。权限或对象目录失败保留当前进度，运输或清理失败丢弃整页。 */
export async function readPostgresStructureSearchPage(state: StructureSearchState, read: Read, check: () => void): Promise<StructureSearchPage> {
  const { input } = state;
  const perDatabase = input.kinds.length;
  const database = input.databases[Math.floor(state.scope / perDatabase)];
  const end = (Math.floor(state.scope / perDatabase) + 1) * perDatabase;
  const page: StructureSearchPage = { hits: [], failures: [], totalHits: state.total, completedScopes: state.scope,
    scopeCount: input.databases.length * perDatabase, limitReached: false, stoppedOnError: false };
  let started = false;
  try {
    await read(database, async connection => {
      started = true;
      if (connection.database !== database) throw Error('PostgreSQL 搜索连接未绑定目标数据库');
      await connection.query(`SELECT pg_catalog.set_config('search_path', 'pg_catalog', false),
        pg_catalog.set_config('statement_timeout', '5s', false), pg_catalog.set_config('lock_timeout', '1s', false),
        pg_catalog.set_config('default_transaction_read_only', 'on', false)`, undefined, { rows: 1, bytes: 1024 });
      let bytes = 0;
      for (let reads = 0; reads < limits.pageQueries && state.scope < end && page.hits.length < limits.pageHits &&
          state.total < input.maxResults; reads++) {
        check();
        const kind = input.kinds[state.scope % perDatabase] as PostgresStructureSearchKind;
        const take = Math.min(limits.pageHits - page.hits.length, input.maxResults - state.total);
        const query = postgresStructureSearchQuery(kind, input.pattern, take, state.after);
        let result;
        try { result = await connection.query(query.sql, query.params, { rows: take + 1, bytes: 2 * 1024 * 1024 }); }
        catch (error) {
          check();
          if (connection.broken || !stateCode(error)) throw error;
          page.failures.push({ database, kind, message: message(error) });
          state.scope++;
          state.after = undefined;
          if (input.onError === 'stop') { page.stoppedOnError = true; break; }
          continue;
        }
        check();
        if (result.truncated || result.rows.length > take + 1) throw Error('PostgreSQL 结构搜索目录回包超出预算');
        let cut = false;
        for (const { c0: object, c1: name, c2: parentKind } of result.rows.slice(0, take)) {
          if (typeof object !== 'string' || typeof name !== 'string' || !name.length || !object.length ||
              (parentKind !== 'table' && parentKind !== 'view' && parentKind !== 'sequence' &&
               parentKind !== 'procedure' && parentKind !== 'function')) throw Error('PostgreSQL 结构搜索返回无效的对象身份');
          if (parentKind === 'table' || parentKind === 'view' || parentKind === 'sequence') {
            const relation = postgresRelationName(object);
            if (object.length > 512 || object !== postgresIdentifier(relation.schema) + '.' + postgresIdentifier(relation.name))
              throw Error('PostgreSQL 结构搜索返回无效的关系名称');
          } else if (object.length > 64 * 1024) throw Error('PostgreSQL 例程签名超出预算');
          const hit: StructureSearchHit = { database, kind, object, name, parentKind, dialect: 'postgresql' };
          bytes += Buffer.byteLength(JSON.stringify(hit), 'utf8') + 1;
          if (bytes > limits.pageBytes - 32 * 1024) {
            if (!page.hits.length) throw Error('PostgreSQL 单条结构命中超出预算');
            cut = true;
            break;
          }
          page.hits.push(hit);
          state.total++;
          state.after = { object, name };
        }
        if (cut) break;
        if (result.rows.length <= take) { state.scope++; state.after = undefined; }
      }
    });
  } catch (error) {
    check();
    if (started || (error as { postgresDatabaseUnavailable?: boolean }).postgresDatabaseUnavailable !== true) throw error;
    page.failures.push({ database, kind: input.kinds[state.scope % perDatabase], message: message(error) });
    state.scope = end;
    state.after = undefined;
    page.stoppedOnError = input.onError === 'stop';
  }
  page.totalHits = state.total;
  page.completedScopes = state.scope;
  page.limitReached = !page.stoppedOnError && state.total >= input.maxResults && state.scope < page.scopeCount;
  return page;
}
