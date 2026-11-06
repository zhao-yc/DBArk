import { createHash } from 'node:crypto';
import { dataSearchCatalogueLimits, dataSearchCatalogueSchema, type DataSearchCatalogueEntry, type DataSearchCataloguePage } from '../../shared/dataSearchCatalogue';
import { dataSearchLimits as limits, postgresDataSearchTargetSchema, type DataSearchInput, type DataSearchMatcher,
  type DataSearchRow, type DataSearchTarget, type DataSearchTargetMetadata, type PostgresSearchRowIdentity } from '../../shared/dataSearch';
import { dataSearchRecordLimits, type DataSearchRecord } from '../../shared/dataSearchRecords';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import type { CellValue, DataRow } from '../../shared/contracts';
import type { DataSearchScanSource } from '../dataSearchTasks';
import type { DataSearchRecords, RecordPreparation } from '../dataSearchRecords';
import type { PostgresConnection } from './connection';
import { postgresSearchPredicate } from './definitionSearch';
import { readRelation } from './tableWorkspace';

type Read = <T>(database: string | undefined, action: (connection: PostgresConnection) => Promise<T>) => Promise<T>;
const budget = (rows = 1, bytes = 8192) => ({ rows, bytes });
const relationSource = 'FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace';
const relationScope = "c.relkind IN ('r','p','v','m') AND c.relpersistence IN ('p','u') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')";
const relationKind = "CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END";
const qualified = `pg_catalog.format('"%s"."%s"', pg_catalog.replace(n.nspname::text, '"', '""'), pg_catalog.replace(c.relname::text, '"', '""'))`;
const cOrder = 'COLLATE pg_catalog."C"';
const fetchRows = 16;
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^\d{1,10}$/.test(value);

function exactRelation(table: string) {
  const { schema, name } = postgresRelationName(table);
  if (table !== postgresIdentifier(schema) + '.' + postgresIdentifier(name)) throw Error('需要 PostgreSQL 目录返回的完整关系名称');
  return [schema, name];
}

/** 目录只读实际可连接的库及可 SELECT 的列。对象游标使用显示的完整限定名。 */
export async function readPostgresDataSearchCatalogue(connection: PostgresConnection, raw: unknown): Promise<DataSearchCataloguePage> {
  const input = dataSearchCatalogueSchema.parse(raw);
  if (input.dialect !== 'postgresql' || ('database' in input && connection.database !== input.database))
    throw Error('PostgreSQL 搜索目录与目标数据库不符');
  const limit = dataSearchCatalogueLimits.entries + 1;
  let sql: string, params: (string | null)[];
  if (input.kind === 'databases') {
    sql = `SELECT d.datname::text FROM pg_catalog.pg_database d WHERE d.datallowconn AND NOT d.datistemplate
      AND pg_catalog.has_database_privilege(d.oid, 'CONNECT') AND pg_catalog.starts_with(d.datname::text, $1::text)
      AND ($2::text IS NULL OR d.datname::text ${cOrder} > $2::text) ORDER BY d.datname::text ${cOrder} LIMIT ${limit}`;
    params = [input.prefix, input.after ?? null];
  } else if (input.kind === 'objects') {
    sql = `SELECT name, kind FROM (SELECT ${qualified}, ${relationKind} ${relationSource}
      WHERE ${relationScope} AND pg_catalog.has_any_column_privilege(c.oid, 'SELECT')
      AND (pg_catalog.starts_with(c.relname::text, $1::text) OR pg_catalog.starts_with(${qualified}, $1::text))
      ) AS visible(name, kind) WHERE ($2::text IS NULL OR name ${cOrder} > $2::text) ORDER BY name ${cOrder} LIMIT ${limit}`;
    params = [input.prefix, input.after ?? null];
  } else {
    sql = `SELECT a.attname::text, pg_catalog.format_type(a.atttypid, a.atttypmod), a.atttypid = 17, a.attnum::text
      ${relationSource} JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
      WHERE ${relationScope} AND n.nspname::text = $1 AND c.relname::text = $2 AND (${relationKind}) = $3
      AND a.attnum > $4::int AND NOT a.attisdropped AND pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT')
      AND pg_catalog.starts_with(a.attname::text, $5::text) ORDER BY a.attnum LIMIT ${limit}`;
    params = [...exactRelation(input.table), input.objectKind, input.after ?? '0', input.prefix];
  }
  const result = await connection.query(sql, params, budget(limit, dataSearchCatalogueLimits.pageBytes));
  if (result.truncated) throw Error('PostgreSQL 搜索目录超过回包预算');
  const entries: DataSearchCatalogueEntry[] = result.rows.slice(0, limit - 1).map(row => {
    if (typeof row.c0 !== 'string' || !row.c0) throw Error('PostgreSQL 搜索目录名称无效');
    if (input.kind === 'databases') return { name: row.c0, kind: 'database' };
    if (input.kind === 'objects' && (row.c1 === 'table' || row.c1 === 'view')) return { name: row.c0, kind: row.c1 };
    if (input.kind === 'columns' && typeof row.c1 === 'string' && (row.c2 === 't' || row.c2 === 'f') && id(row.c3))
      return { name: row.c0, kind: 'column', dataType: row.c1, binary: row.c2 === 't', ordinal: Number(row.c3) };
    throw Error('PostgreSQL 搜索目录结构无效');
  });
  const last = entries.at(-1), hasMore = result.rows.length === limit;
  return { kind: input.kind, entries, hasMore, ...(hasMore && last ? { next: last.ordinal ? String(last.ordinal) : last.name } : {}) };
}

/** 每个字段块持有自身只读事务，接收确认前不会再次 FETCH。 */
async function begin(connection: PostgresConnection) {
  if ((await connection.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY', undefined, budget())).postgresCommand !== 'BEGIN')
    throw Error('PostgreSQL 搜索只读事务未确认');
  await connection.query(`SELECT pg_catalog.set_config('search_path','pg_catalog',true),
    pg_catalog.set_config('TimeZone','UTC',true), pg_catalog.set_config('DateStyle','ISO, YMD',true),
    pg_catalog.set_config('bytea_output','hex',true), pg_catalog.set_config('extra_float_digits','3',true),
    pg_catalog.set_config('IntervalStyle','postgres',true), pg_catalog.set_config('statement_timeout','15s',true),
    pg_catalog.set_config('lock_timeout','2s',true), pg_catalog.set_config('idle_in_transaction_session_timeout','75s',true)`, undefined, budget());
}

async function searchTarget(connection: PostgresConnection, raw: DataSearchTarget, allowViews: boolean) {
  const target = postgresDataSearchTargetSchema.parse(raw);
  if (target.database !== connection.database || (target.kind === 'view' && !allowViews)) throw Error('PostgreSQL 搜索目标库或视图确认不符');
  exactRelation(target.table);
  const columnsSql = target.columns.map(column => postgresIdentifier(column.name)).join(', ');
  // PREPARE 解析并锁定关系。先复核目录种类，再允许规划查询，防止旧表被换成未确认的视图。
  const scope = await connection.query('PREPARE dbark_search_scope AS SELECT ' + columnsSql + ' FROM ' + target.table, undefined, budget());
  if (scope.postgresCommand !== 'PREPARE') throw Error('PostgreSQL 搜索关系锁未确认');
  const relation = await readRelation(connection, target.table, true);
  const view = relation.kind === 'v' || relation.kind === 'm';
  if (target.table !== relation.sql || view !== (target.kind === 'view') || !['r','p','v','m'].includes(relation.kind))
    throw Error('PostgreSQL 搜索关系已变化或不支持，请重新读取目录');
  const from = (relation.kind === 'r' ? 'ONLY ' : '') + relation.sql;
  const columnMap = new Map(relation.columns.map(column => [column.name, column]));
  const describe = (name: string) => {
    const column = columnMap.get(name);
    if (!column) throw Error('PostgreSQL 搜索字段已变化');
    return { name, dataType: column.type, binary: !!column.binary, nullable: column.nullable };
  };
  const columns = target.columns.map(column => describe(column.name));
  if (columns.some((column, index) => column.binary && target.columns[index].representation !== 'hex'))
    throw Error('PostgreSQL BYTEA 字段需要选择 HEX 表示');
  const keys = !view && relation.canReadSystemColumns ? relation.keys.map(describe) : [];
  const metadata: DataSearchTargetMetadata = { target, columns, keyColumns: keys, indexMetadataIncomplete: false,
    ...(!keys.length ? { keyUnavailableReason: !view && relation.keys.length ? 'key-not-selectable' : 'no-key' } : {}) };
  return { metadata, relation, from };
}

type SearchTarget = Awaited<ReturnType<typeof searchTarget>>;
async function prepareRecord(connection: PostgresConnection, { relation }: SearchTarget): Promise<RecordPreparation> {
  const result = await connection.query(`SELECT pg_catalog.current_database(), current_user, pg_catalog.inet_server_addr()::text,
    pg_catalog.inet_server_port()::text, pg_catalog.pg_postmaster_start_time()::text, d.oid::text,
    CASE WHEN pg_catalog.has_function_privilege('pg_catalog.pg_control_system()', 'EXECUTE')
      THEN (pg_catalog.pg_control_system()).system_identifier::text END
    FROM pg_catalog.pg_database d WHERE d.datname = pg_catalog.current_database()`, undefined, budget());
  if (result.truncated || result.rows.length !== 1 || !id(result.rows[0].c5) || typeof result.rows[0].c4 !== 'string')
    return { reason: 'identity-unproven' };
  return { identity: { server: sha(result.rows[0]), tableId: relation.oid, definition: relation.fingerprint } };
}

/** 服务器匹配完整文字，驱动仅接收短预览、长度及独立的有界键。 */
export function postgresDataSearchPlan({ metadata, from }: SearchTarget, matcher: DataSearchMatcher, rows: number) {
  if (!Number.isInteger(rows) || rows < 1 || rows > limits.rows + 1) throw Error('PostgreSQL 搜索行预算无效');
  const predicates: string[] = [], projections: string[] = [];
  metadata.target.columns.forEach((column, index) => {
    const name = postgresIdentifier(column.name);
    const expression = column.representation === 'hex'
      ? `pg_catalog.upper(pg_catalog.encode(${metadata.columns[index].binary ? name : `pg_catalog.convert_to(${name}::text,'UTF8')`}, 'hex'))`
      : name + '::text';
    const predicate = matcher.kind === 'null' ? name + ' IS NULL' : postgresSearchPredicate(expression, matcher.pattern);
    predicates.push('(' + predicate + ')');
    projections.push('(' + predicate + ')', `pg_catalog.left(${expression}, ${limits.previewCharacters})`, `pg_catalog.char_length(${expression})::text`);
  });
  if (metadata.keyColumns.length) {
    const keys = metadata.keyColumns.map(column => postgresIdentifier(column.name) + '::text');
    projections.push(`CASE WHEN ${keys.map(key => `pg_catalog.octet_length(${key})`).join(' + ')} <= ${limits.keyBytes}
      THEN pg_catalog.jsonb_build_array(${keys.join(', ')})::text END`,
    'tableoid::text', 'ctid::text', 'xmin::text', 'pg_catalog.pg_relation_filenode(tableoid)::text');
  }
  return { sql: 'SELECT ' + projections.join(', ') + ' FROM ' + from + ' WHERE (' + predicates.join(' OR ') + ') LIMIT ' + rows,
    params: matcher.kind === 'text' ? [matcher.pattern.text] : [] };
}

function decodeRow(metadata: DataSearchTargetMetadata, row: DataRow): DataSearchRow {
  const cell = (index: number) => row['c' + index];
  const cells = metadata.columns.map((_, index) => {
    const matched = cell(index * 3), preview = cell(index * 3 + 1), count = cell(index * 3 + 2);
    if ((matched !== null && matched !== 't' && matched !== 'f') ||
        (preview === null ? count !== null : typeof preview !== 'string' || typeof count !== 'string' || !/^\d+$/.test(count)))
      throw Error('PostgreSQL 搜索预览回包无效');
    return { matched: matched === 't', preview: preview as string | null, characters: count as string | null,
      truncated: typeof count === 'string' && Number(count) > limits.previewCharacters };
  });
  if (!cells.some(value => value.matched)) throw Error('PostgreSQL 搜索回包没有匹配字段');
  if (!metadata.keyColumns.length) return { cells, keyValues: null, keyUnavailableReason: metadata.keyUnavailableReason };
  const offset = cells.length * 3, raw = cell(offset), tableOid = cell(offset + 1), tid = cell(offset + 2), xmin = cell(offset + 3), fileNode = cell(offset + 4);
  if (raw === null || typeof raw === 'string' && Buffer.byteLength(raw) > limits.keyBytes)
    return { cells, keyValues: null, keyUnavailableReason: 'key-too-large' };
  const keys: unknown = typeof raw === 'string' ? JSON.parse(raw) : undefined;
  if (!Array.isArray(keys) || keys.length !== metadata.keyColumns.length || !keys.every(value => typeof value === 'string') ||
      !id(tableOid) || typeof tid !== 'string' || !/^\(\d+,\d+\)$/.test(tid) || !id(xmin) || !id(fileNode))
    throw Error('PostgreSQL 记录定位身份不完整');
  return { cells, keyValues: keys, postgresIdentity: { tableOid, tid, xmin, fileNode } };
}

/** 保留原动作错误直到专用连接真正关闭。传输或清理异常不会被当成单表失败继续。 */
export function postgresDataSearchSource(input: DataSearchInput, records: DataSearchRecords, read: Read, check: () => void): DataSearchScanSource {
  let broken = false;
  return {
    checkCancelled: check, broken: () => broken,
    async read(target, rows, open, peak) {
      let opened = false, failure: { reason: unknown } | undefined;
      try {
        await read(target.database, async connection => {
          opened = true;
          try {
            await begin(connection);
            const selected = await searchTarget(connection, target, input.allowViews);
            const metadata = selected.metadata;
            const prepared = metadata.keyColumns.length ? await prepareRecord(connection, selected) : { reason: 'no-key' as const };
            const receive = open(metadata, row => records.capture(input.connectionId, input.taskId, metadata, row, prepared));
            const plan = postgresDataSearchPlan(selected, input.matcher, rows);
            const cursor = await connection.query('DECLARE dbark_data_search NO SCROLL CURSOR FOR ' + plan.sql, plan.params, budget(), undefined, 'extended');
            if (cursor.postgresCommand !== 'DECLARE') throw Error('PostgreSQL 搜索游标未确认');
            for (;;) {
              check();
              const page = await connection.query('FETCH FORWARD ' + fetchRows + ' FROM dbark_data_search', undefined, budget(fetchRows, fetchRows * limits.rowBytes));
              if (page.truncated) throw Error('PostgreSQL 搜索批次超过读取预算');
              peak(page.rows.length, Buffer.byteLength(JSON.stringify(page.rows)));
              for (const row of page.rows) await receive(decodeRow(metadata, row));
              if (page.rows.length < fetchRows) break;
            }
            if ((await connection.query('ROLLBACK', undefined, budget())).postgresCommand !== 'ROLLBACK') {
              broken = true;
              throw Error('PostgreSQL 搜索事务收尾未确认');
            }
          } catch (reason) {
            broken ||= connection.broken;
            failure = { reason };
          }
        });
      } catch (reason) {
        broken = opened || (reason as { postgresDatabaseUnavailable?: boolean }).postgresDatabaseUnavailable !== true;
        throw reason;
      }
      if (failure) throw failure.reason;
    },
  };
}

export async function readPostgresDataSearchRecord(connection: PostgresConnection, entry: ReturnType<DataSearchRecords['lookup']>): Promise<DataSearchRecord> {
  const identity: PostgresSearchRowIdentity | undefined = entry.postgresIdentity;
  if (!identity) throw Error('记录定位方言与保存的连接不匹配');
  await begin(connection);
  const target = await searchTarget(connection, entry.metadata.target, false);
  const prepared = await prepareRecord(connection, target);
  if ('reason' in prepared || JSON.stringify(prepared.identity) !== JSON.stringify(entry.identity) ||
      JSON.stringify(target.metadata) !== JSON.stringify(entry.metadata))
    throw Error('PostgreSQL 原表或字段已变化，请重新搜索');
  const columns = [...target.metadata.columns];
  for (const key of target.metadata.keyColumns) if (!columns.some(column => column.name === key.name)) columns.push(key);
  const width = Math.min(dataSearchRecordLimits.fieldCharacters, Math.floor((dataSearchRecordLimits.recordBytes - 16_384) / (6 * columns.length)));
  const projection = columns.flatMap(column => {
    const name = postgresIdentifier(column.name);
    return column.binary ? [`pg_catalog.encode(pg_catalog.substr(${name}, 1, ${width}), 'hex')`, `pg_catalog.octet_length(${name})::text`]
      : [`pg_catalog.left(${name}::text, ${width})`, `pg_catalog.char_length(${name}::text)::text`];
  });
  const keys = target.metadata.keyColumns.map((column, index) => `${postgresIdentifier(column.name)}::text ${cOrder} = $${index + 5}::text`);
  const result = await connection.query(`SELECT ${projection.join(', ')} FROM ${target.from}
    WHERE tableoid = $1::oid AND ctid = $2::tid AND xmin::text = $3::text AND pg_catalog.pg_relation_filenode(tableoid) = $4::oid
      AND ${keys.join(' AND ')} LIMIT 2`, [identity.tableOid, identity.tid, identity.xmin, identity.fileNode, ...entry.keyValues],
    budget(2, dataSearchRecordLimits.recordBytes));
  if (result.truncated || result.rows.length !== 1) throw Error('PostgreSQL 原记录已变化、移除或不可见，请重新搜索');
  const fields = columns.map((column, index) => {
    const raw = result.rows[0]['c' + index * 2], length = result.rows[0]['c' + (index * 2 + 1)];
    if (raw === null && length === null) return { ...column, value: null, characters: null, truncated: false };
    if (typeof raw !== 'string' || typeof length !== 'string' || !/^\d+$/.test(length)) throw Error('PostgreSQL 定位字段回包无效');
    const value: CellValue = column.binary ? { type: 'binary', base64: Buffer.from(raw, 'hex').toString('base64') } : raw;
    return { ...column, value, characters: length, truncated: Number(length) > width };
  });
  const output: DataSearchRecord = { target: target.metadata.target, fields, timeZone: '+00:00', searchedAt: entry.searchedAt,
    readAt: new Date().toISOString(), readOnly: true };
  if (Buffer.byteLength(JSON.stringify(output)) > dataSearchRecordLimits.recordBytes) throw Error('PostgreSQL 定位记录超过回包预算');
  if ((await connection.query('ROLLBACK', undefined, budget())).postgresCommand !== 'ROLLBACK') throw Error('PostgreSQL 定位事务收尾未确认');
  return output;
}
