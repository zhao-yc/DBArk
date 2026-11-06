import { structureSearchLimits, type PostgresDefinitionTarget } from '../../shared/databaseSearch';
import type { DatabaseSearchPattern } from '../../shared/databaseSearchPattern';
import { definitionTextWithinBudget } from '../../shared/definitionNavigation';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import { postgresIdentifier } from '../../shared/postgresSql';
import type { PostgresStructureResult } from '../../shared/postgresStructure';
import { definitionNavigationResult } from '../definitionNavigation';
import type { PostgresConnection } from './connection';
import { readPostgresStructureFacts } from './relationStructure';
import { postgresRoutineSignatureSql, postgresRoutineVisibleSql } from './routine';

/** 规范专用短连接上的反编译上下文，保证搜索与重新打开使用同一种文本。 */
export async function preparePostgresSearchConnection(connection: PostgresConnection, database: string) {
  if (connection.database !== database) throw Error('PostgreSQL 搜索连接未绑定目标数据库');
  await connection.query(`SELECT pg_catalog.set_config('search_path', 'pg_catalog', false),
    pg_catalog.set_config('statement_timeout', '5s', false), pg_catalog.set_config('lock_timeout', '1s', false),
    pg_catalog.set_config('standard_conforming_strings', 'on', false),
    pg_catalog.set_config('default_transaction_read_only', 'on', false)`, undefined, { rows: 1, bytes: 1024 });
}

/** 表文本由已有关系目录生成。只读查看字段和表达式，不从表或所属序列读取数据。 */
function relationDefinition(output: PostgresStructureResult) {
  const name = postgresIdentifier(output.schema) + '.' + postgresIdentifier(output.name);
  const comments = output.columns.filter(column => column.comment !== null).map(column =>
    'COMMENT ON COLUMN ' + name + '.' + postgresIdentifier(column.name) + ' IS ' + postgresDdlLiteral(column.comment!) + ';');
  const view = output.kind === 'v' || output.kind === 'm';
  const type = output.kind === 'm' ? 'MATERIALIZED VIEW' : view ? 'VIEW' : output.kind === 'f' ? 'FOREIGN TABLE' : 'TABLE';
  if (output.comment !== null) comments.push('COMMENT ON ' + type + ' ' + name + ' IS ' + postgresDdlLiteral(output.comment) + ';');
  const indexes = output.indexes.map(index => index.definition + ';');
  if (view) {
    if (!output.viewDefinition) throw Error('PostgreSQL 视图查询定义未完整返回');
    return [`CREATE ${type} ${name} AS\n${output.viewDefinition}`, ...indexes, ...comments].join('\n\n');
  }
  const columns = output.columns.map(column => {
    let text = postgresIdentifier(column.name) + ' ' + column.type;
    if (column.collation) text += ' COLLATE ' + column.collation;
    if (column.identity) text += ' GENERATED ' + (column.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT') + ' AS IDENTITY';
    else if (column.generationExpression !== null)
      text += ' GENERATED ALWAYS AS (' + column.generationExpression + ') ' + (column.generation === 'v' ? 'VIRTUAL' : 'STORED');
    else if (column.defaultExpression !== null) text += ' DEFAULT ' + column.defaultExpression;
    if (!column.nullable) text += ' NOT NULL';
    return text;
  });
  const constraints = output.constraints.map(item => 'CONSTRAINT ' + postgresIdentifier(item.name) + ' ' + item.definition);
  const declaration = `CREATE ${type} ${name} (\n  ${[...columns, ...constraints].join(',\n  ')}\n)` +
    (output.partitionKey ? ' PARTITION BY ' + output.partitionKey : '') + ';';
  const bound = output.partitionBound?.split('\n').map(line => '-- ' + line).join('\n');
  return [declaration, ...(bound ? [bound] : []), ...indexes, ...comments].join('\n\n');
}

/** 用目录完整限定名及输入类型签名核对对象，只返回与搜索窗口相同的展示正文。 */
export async function readPostgresDefinitionText(connection: PostgresConnection, target: Omit<PostgresDefinitionTarget, 'connectionId'>) {
  if (connection.database !== target.database) throw Error('PostgreSQL 定义连接未绑定目标数据库');
  let source: string;
  if (target.kind === 'table' || target.kind === 'view') {
    const { output } = await readPostgresStructureFacts(connection, target.name);
    const exact = postgresIdentifier(output.schema) + '.' + postgresIdentifier(output.name);
    if (exact !== target.name || (target.kind === 'view') !== (output.kind === 'v' || output.kind === 'm'))
      throw Error('PostgreSQL 定义对象已变化');
    source = relationDefinition(output);
  } else {
    const result = await connection.query(`SELECT pg_catalog.pg_get_functiondef(p.oid), pg_catalog.obj_description(p.oid, 'pg_proc')
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE p.oid = pg_catalog.to_regprocedure($1::text) AND ${postgresRoutineVisibleSql}
        AND ${postgresRoutineSignatureSql} COLLATE pg_catalog."C" = $1::text
        AND CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END = $2::text`,
      [target.name, target.kind], { rows: 2, bytes: structureSearchLimits.definitionBytes + 8192 });
    const row = result.rows[0];
    if (result.truncated) throw Error('PostgreSQL 例程定义超过 2 MiB');
    if (result.rows.length !== 1 || typeof row.c0 !== 'string' || (row.c1 !== null && typeof row.c1 !== 'string'))
      throw Error('PostgreSQL 例程不存在、已改名或当前角色不可见');
    source = row.c0 + (row.c1 === null ? '' : '\nCOMMENT ON ' + target.kind.toUpperCase() + ' ' + target.name + ' IS ' + postgresDdlLiteral(row.c1) + ';');
  }
  if (!source || !definitionTextWithinBudget(source)) throw Error('PostgreSQL 完整目录定义超过 2 MiB 或编码无效');
  return source;
}

/** 普通匹配保留百分号和下划线，大小写转换与正则均使用服务器语义。 */
export function postgresSearchPredicate(column: 'match_name' | 'definition_text', pattern: DatabaseSearchPattern) {
  const name = pattern.caseSensitive ? column : `pg_catalog.lower(${column})`;
  const value = pattern.caseSensitive ? '$1::text' : 'pg_catalog.lower($1::text)';
  return pattern.mode === 'regexp' ? `${column} ${pattern.caseSensitive ? '~' : '~*'} $1::text`
    : pattern.mode === 'whole' ? `${name} COLLATE pg_catalog."C" = ${value}`
    : pattern.mode === 'prefix' ? `pg_catalog.starts_with(${name}, ${value})`
    : `pg_catalog.strpos(${name}, ${value}) > 0`;
}

export async function matchPostgresDefinition(connection: PostgresConnection, source: string, pattern: DatabaseSearchPattern) {
  const folded = !pattern.caseSensitive && pattern.mode !== 'regexp';
  const result = await connection.query(`SELECT pg_catalog.char_length(definition_text)::text
    ${folded ? ', pg_catalog.lower(definition_text), pg_catalog.lower($1::text)' : ''}
    FROM (SELECT $2::text AS definition_text) AS body WHERE ${postgresSearchPredicate('definition_text', pattern)}`,
    [pattern.text, source], { rows: 1, bytes: 4 * 1024 * 1024 });
  if (result.truncated) throw Error('PostgreSQL 定义匹配回包超过预算');
  const match = result.rows[0];
  if (!match) return;
  const characters = Number(match.c0);
  if (!Number.isSafeInteger(characters) || characters < 1 || characters > structureSearchLimits.definitionBytes)
    throw Error('PostgreSQL 定义匹配长度无效');
  return { definitionCharacters: characters, definitionNavigation: definitionNavigationResult(source, pattern,
    { navigationText: match.c1, navigationNeedle: match.c2 }) };
}
