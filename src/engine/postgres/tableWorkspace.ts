import { createHash, randomUUID } from 'node:crypto';
import type { CellValue, DataRow } from '../../shared/contracts';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import { isPostgresRelatedTabId } from '../../shared/postgresRelatedTab';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import type { CsvExportDelimiter } from '../../shared/csvExport';
import { FILTER_LIMITS } from '../../shared/filtering';
import {
  isPostgresSqlExportColumn, isPostgresSqlExportRelation, isPostgresFilteredUpdateColumn, isPostgresTableFiltered, postgresCountedWindow, postgresFilteredWriteMaxRows,
  postgresFilteredUpdateSchema, postgresTableLimits, postgresTableSortRules, postgresTableSortSchema, postgresTableValueLimits,
  type PostgresTableApplyInput, type PostgresTableColumn, type PostgresTableExportInput, type PostgresTableField, type PostgresTableImportInput, type PostgresTableOutcome,
  type PostgresTablePage, type PostgresTablePageInput, type PostgresTablePreview, type PostgresTablePreviewInput,
  type PostgresTableReleaseInput, type PostgresTableTarget,
  type PostgresTableReferenceInput, type PostgresTableReferenceResult, type PostgresTableColumnReadInput, type PostgresTableValuesInput, type PostgresTableValues, type PostgresTableHistogramInput,
  type PostgresRelatedTableInput, type PostgresRelatedTablePage,
  type PostgresFilteredUpdateInput,
} from '../../shared/postgresTable';
import type { PostgresConnection } from './connection';
import { readPostgresSqlExportSettings, type PostgresSqlExportSettings } from './sqlExport';
import { readPostgresCopySource, type PostgresCopySource } from './copyImportFile';
import { postgresTableCondition, postgresTableReadOrder } from '../../shared/postgresTableReadSql';
import { readPostgresTableReferences, type PostgresReferenceSourceRow, type PostgresReferenceRowVersion } from './tableReferences';
import { readPostgresColumnStatistics } from './tableStatistics';
import { hasPostgresRoundtripFloatText, readPostgresTableHistogram } from './tableHistogram';
import { readTableValueOptionsOrder } from '../../shared/tableValueOptions';
import {
  postgresDraftSchema, type PostgresDraftDocument, type PostgresDraftRestored,
} from '../../shared/postgresTableDraft';

type Scoped<T> = T & { owner: string; connectionRevision: number };
type Connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing?: boolean) => Promise<T>;
type Capabilities = PostgresTablePage['capabilities'];
interface Relation {
  oid: string;
  sql: string;
  kind: PostgresTablePage['relationKind'];
  columns: PostgresTableColumn[];
  keys: string[];
  fingerprint: string;
  capabilities: Capabilities;
  canImport: boolean;
  canReadSystemColumns: boolean;
}
interface Original extends PostgresReferenceRowVersion { digest: string; key: string; }
interface Write { kind: keyof Capabilities; sql: string; values: unknown[]; original?: Original; }
interface FilteredWriteMatch { sql: string; values: unknown[]; signature: string; count: number; }
type FilteredWrite = { kind: 'update'; fields: PostgresTableField[] } | { kind: 'delete' };
type ExportSource = { kind: 'copy'; write: (sink: (chunk: Buffer) => Promise<void>) => Promise<number> } |
  { kind: 'cursor'; columns: PostgresTableColumn[]; rows: AsyncIterable<CellValue[]>;
    replay?: { table: string; settings: PostgresSqlExportSettings } };
interface Snapshot {
  scope: Scoped<PostgresTableTarget>;
  token: string;
  expires: number;
  relation: Relation;
  rows: Original[];
  options: Pick<PostgresTablePageInput, 'filter' | 'sort'>;
  window?: Pick<PostgresTablePageInput, 'offset' | 'limit'>;
  writeEligible: boolean;
  related?: RelatedScope;
  preview?: { token: string; expires: number; writes: Write[]; filtered?: FilteredWriteMatch };
}
interface TableSnapshots { current: Snapshot; retained: Map<string, Snapshot>; }
interface RelatedScope {
  target: Scoped<PostgresTableTarget>;
  originTable: string;
  relation: Relation;
  row: Original;
  incoming: boolean;
  lookup: NonNullable<PostgresTableReferenceInput['lookup']>;
  expires: number;
  editSource?: { token: string; relation: Relation; rows: Original[] };
}
export type PostgresTableImportRequest = Scoped<PostgresTableImportInput> & { source: PostgresCopySource };
const noWrites: Capabilities = { insert: false, update: false, delete: false };
// 按内置类型 OID 开放可原生比较且文本可往返的字段，避免同名自定义类型混入。
const valueOptionTypes = new Set([
  '16', '17', '20', '21', '23', '25', '700', '701', '1042', '1043', '1082', '1083', '1114', '1184', '1266', '1700', '2950', '3802',
]);
const small = () => ({ rows: 1024, bytes: 2 * 1024 * 1024 });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const only = (relation: Relation) => (relation.kind === 'r' ? 'ONLY ' : '') + relation.sql;
const pageScope = ({ filter, sort }: Snapshot['options']) =>
  JSON.stringify([filter, postgresTableSortRules(sort).map(({ column, direction, nulls }) => [column, direction, nulls])]);

/** 每次从实际库读取关系、主键顺序、列权限与结构；标识符及类型显示均来自目录。 */
async function readRelation(connection: PostgresConnection, table: string): Promise<Relation> {
  const { schema, name } = postgresRelationName(table);
  const header = await connection.query(`
    SELECT c.oid, pg_catalog.pg_relation_filenode(c.oid), c.relkind, c.relispartition, c.relhasrules,
           pg_catalog.has_table_privilege(c.oid, 'INSERT'), pg_catalog.has_table_privilege(c.oid, 'UPDATE'),
           pg_catalog.has_table_privilege(c.oid, 'DELETE'),
           (SELECT i.indexrelid FROM pg_catalog.pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND i.indisvalid),
           CASE WHEN c.relkind IN ('v','m') THEN pg_catalog.pg_get_viewdef(c.oid, false) END,
           pg_catalog.row_security_active(c.oid), c.relispopulated, pg_catalog.has_table_privilege(c.oid, 'SELECT')
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname::text = $1 AND c.relname::text = $2 AND c.relkind IN ('r','p','v','m','f')
      AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
  `, [schema, name], small());
  const info = header.rows[0];
  if (!info || typeof info.c0 !== 'string') throw Error('PostgreSQL关系不存在、已改名或无权查看');
  if (info.c2 === 'm' && info.c11 === 'f') throw Error('PostgreSQL 物化视图尚未填充数据，请从「查看结构」执行刷新。');
  // 复制记录根据标识属性和默认表达式的序列依赖省略字段，避免猜测 DEFAULT 文本。
  const fields = await connection.query(`
    SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
           a.atthasdef, a.attgenerated, a.attidentity, a.atttypid,
           coalesce((SELECT k.position FROM pg_catalog.pg_index i,
             LATERAL pg_catalog.unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
             WHERE i.indrelid = a.attrelid AND i.indisprimary AND i.indisvalid AND k.attnum = a.attnum
               AND k.position <= i.indnkeyatts), 0),
           a.attnum, a.attcollation, pg_catalog.pg_get_expr(d.adbin, d.adrelid),
           a.attidentity <> '' OR EXISTS (
             SELECT 1 FROM pg_catalog.pg_depend dependency
             JOIN pg_catalog.pg_class sequence ON sequence.oid = dependency.refobjid AND sequence.relkind = 'S'
             WHERE dependency.classid = 'pg_catalog.pg_attrdef'::regclass AND dependency.objid = d.oid
               AND dependency.refclassid = 'pg_catalog.pg_class'::regclass AND dependency.refobjsubid = 0
           )
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum
  `, [info.c0], small());
  if (!fields.rows.length || fields.truncated || fields.rows.length > 1022) throw Error('PostgreSQL列目录不完整或超过表页预算');
  const columns = fields.rows.map((field, index): PostgresTableColumn => ({
    key: 'c' + index, name: String(field.c0), type: String(field.c1), nullable: field.c2 !== 't',
    defaultValue: field.c3 === 't' || field.c5 !== '', generated: field.c4 !== '' || field.c5 === 'a',
    primary: Number(field.c7) > 0, binary: field.c6 === '17', ...(field.c5 === 'a' ? { identityAlways: true } : {}),
    ...(valueOptionTypes.has(String(field.c6)) ? { valueOptions: true } : {}),
    ...(field.c11 === 't' ? { sequenceDefault: true } : {}),
  }));
  const keys = fields.rows.map((field, index) => ({ index, position: Number(field.c7) }))
    .filter(item => item.position > 0).sort((a, b) => a.position - b.position)
    .map(item => columns[item.index].name);
  const kind = info.c2 as Relation['kind'];
  const editable = kind === 'r' && info.c3 === 'f' && info.c4 === 'f';
  return {
    oid: info.c0, sql: postgresIdentifier(schema) + '.' + postgresIdentifier(name), kind, columns, keys,
    fingerprint: digest([info, fields.rows]),
    canImport: (kind === 'r' || kind === 'p') && info.c4 === 'f' && info.c5 === 't' && info.c10 === 'f',
    canReadSystemColumns: (kind === 'r' || kind === 'p') && info.c12 === 't',
    capabilities: {
      insert: editable && info.c5 === 't',
      update: editable && keys.length > 0 && info.c6 === 't',
      delete: editable && keys.length > 0 && info.c7 === 't',
    },
  };
}

function columnIdentifier(relation: Relation, name: string): string {
  const column = relation.columns.find(column => column.name === name);
  if (!column) throw Error('PostgreSQL排序或筛选列已变化');
  return postgresIdentifier(column.name);
}

/** 翻页、游标和 COPY 共用排序，显式规则优先，同值时沿用关系的分页键。 */
function readSql(relation: Relation, input: Pick<PostgresTablePageInput, 'filter' | 'sort'>,
  page?: Pick<PostgresTablePageInput, 'limit' | 'offset' | 'checkFilterColumns'>, columns = relation.columns, copy = false) {
  const key = (id: string) => columnIdentifier(relation, id);
  const projection = columns.map(column => postgresIdentifier(column.name)).join(', ');
  // 载入方案时连停用规则也要核对，避免方案套用到字段已删除或改名的关系上。
  if (page?.checkFilterColumns && input.filter) {
    for (const name of 'rules' in input.filter ? input.filter.rules.map(rule => rule.column) : [input.filter.column]) key(name);
  }
  const ordering = postgresTableReadOrder(input.sort, relation.kind, relation.keys, key);
  const args: unknown[] = page ? [page.limit + 1, page.offset] : [];
  // COPY 流使用简单协议，其筛选值使用与会话转义设置无关的显式字面量。
  const condition = postgresTableCondition(input.filter, key, value => copy ? postgresDdlLiteral(value) : '$' + args.push(value));
  const withOriginal = !!page && (relation.canReadSystemColumns || relation.capabilities.update || relation.capabilities.delete);
  // 分区的物理行号可能相同，同时保留真实分区 OID。三项身份打包成一列，保留宽表预算。
  const markers = withOriginal ? ', pg_catalog.json_build_array(ctid::text, xmin::text, tableoid::oid::text)::text' : '';
  return { sql: 'SELECT ' + projection + markers + ' FROM ' + only(relation) + (condition ? ' WHERE ' + condition : '') +
    (ordering.length ? ' ORDER BY ' + ordering.join(', ') : '') + (page ? ' LIMIT $1 OFFSET $2' : ''), args, withOriginal };
}

/** 在服务端原样绑定值；DEFAULT为固定关键字，二进制输入按十六进制还原。 */
function fieldExpression(field: PostgresTableField, relation: Relation, values: unknown[]): { column: string; expression: string } {
  const column = relation.columns.find(item => item.key === field.column);
  if (!column || column.generated) throw Error('列已变化或由数据库生成，不能直接修改');
  const value = field.value;
  if (value.mode === 'default') return { column: postgresIdentifier(column.name), expression: 'DEFAULT' };
  if (value.mode === 'null' && !column.nullable) throw Error('非空列不能写入 NULL：' + column.name);
  if (value.mode === 'binary' && !column.binary) throw Error('十六进制字节只能写入 BYTEA：' + column.name);
  values.push(value.mode === 'null' ? null : value.mode === 'binary' ? Buffer.from(value.value, 'hex') : value.value);
  return { column: postgresIdentifier(column.name), expression: '$' + values.length };
}

/** 一行只对应快照中的原物理版本，定位字段由引擎保管并通过协议绑定。 */
function rowPredicate(values: unknown[], row: Pick<Original, 'tid' | 'version'>): string {
  const pos = values.length + 1;
  values.push(row.tid, row.version);
  return 'ctid = $' + pos + '::tid AND xmin = $' + (pos + 1) + '::xid';
}

/** 关联读取和编辑共用原行核对。分区 OID、物理版本和完整值摘要都必须匹配。 */
async function readOriginalRow(connection: PostgresConnection, relation: Relation, row: Omit<Original, 'key'>): Promise<DataRow> {
  const args: unknown[] = [];
  const predicate = rowPredicate(args, row);
  const projection = relation.columns.map(column => postgresIdentifier(column.name)).join(', ');
  const current = await connection.query('SELECT ' + projection + ' FROM ' + only(relation) + ' WHERE ' + predicate +
    ' AND tableoid = $3::oid AND pg_catalog.to_regclass($4)::oid = $5::oid',
  [...args, row.tableOid, relation.sql, relation.oid], { rows: 2, bytes: 8 * 1024 * 1024 });
  if (current.truncated || current.rows.length !== 1 || digest(current.rows[0]) !== row.digest)
    throw Error('原记录已变化，请刷新后重试');
  return current.rows[0];
}

async function referenceSource(connection: PostgresConnection, relation: Relation, row: Original,
  incoming: boolean, verify: boolean): Promise<PostgresReferenceSourceRow> {
  if (verify) await readOriginalRow(connection, relation, row);
  return { incoming, sql: only(relation), tid: row.tid, version: row.version, tableOid: row.tableOid,
    oid: relation.oid, name: relation.sql };
}

/** 控制表页事务锁及每条语句的数据库端等待上限。 */
async function begin(connection: PostgresConnection, mode: 'page' | 'export' | 'write' | 'filteredWrite' = 'write'): Promise<void> {
  await connection.query(mode === 'page' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' :
    mode === 'export' ? 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY' :
      mode === 'filteredWrite' ? 'BEGIN ISOLATION LEVEL READ COMMITTED' : 'BEGIN', undefined, small());
  for (const sql of ["SET LOCAL statement_timeout = '15s'", "SET LOCAL lock_timeout = '5s'", "SET LOCAL idle_in_transaction_session_timeout = '20s'"]) {
    await connection.query(sql, undefined, small());
  }
}

/** 预览和锁内复核都读完整匹配集合。排序只规范行版本签名，不改变筛选集合。 */
async function filteredWriteVersions(connection: PostgresConnection, sql: string, values: unknown[]) {
  const limit = postgresFilteredWriteMaxRows;
  const result = await connection.query(sql, values, { rows: limit + 1, bytes: 256 * 1024 });
  if (result.truncated || result.rows.length > limit) throw Error(`按筛选操作最多 ${limit} 行，请缩小筛选范围`);
  const versions = result.rows.map(row => {
    if (typeof row.c0 !== 'string' || typeof row.c1 !== 'string') throw Error('按筛选操作的原行版本未完整返回');
    return [row.c0, row.c1] as const;
  }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return { positions: versions.map(([position]) => position), signature: digest(versions) };
}

/** 页面、预览、提交绑定同一文档和表标签；所有真实数据修改使用独立事务。 */
export class PostgresTableWorkspace {
  private readonly snapshots = new Map<string, TableSnapshots>();
  private readonly active = new Set<string>();
  private readonly related = new Map<string, RelatedScope>();

  private key(scope: Scoped<PostgresTableTarget>): string { return JSON.stringify([scope.owner, scope.tabId]); }

  /** 当前草稿必须保留。只在同一目录和筛选范围内尽量保留撤销历史，过期历史不阻断翻页。 */
  async page(input: Scoped<PostgresTablePageInput>, connect: Connect): Promise<PostgresTablePage> {
    return (await this.loadPage(input, connect)).page;
  }

  /** 恢复需要当前普通表页能力，核对失败时当前表页及已签能力保持。 */
  async restoreDraft(input: Scoped<PostgresTableTarget & { pageToken: string; document: PostgresDraftDocument }>,
    connect: Connect): Promise<Omit<PostgresDraftRestored, 'name'>> {
    const document = postgresDraftSchema.parse(input.document);
    const current = this.snapshot(input, true);
    if (!current.window || document.target.connectionId !== input.connectionId || document.target.database !== input.database ||
        document.target.table !== input.table) throw Error('PostgreSQL 草稿不属于当前连接、数据库或表');
    const { connectionId, database, table, tabId, owner, connectionRevision } = input;
    const view = document.view;
    const restored = await this.loadPage({ connectionId, database, table, tabId, owner, connectionRevision, ...view, checkFilterColumns: true },
      connect, document);
    return { ...restored, view };
  }

  /** 恢复与活动页在同一个只读快照核验，所有原页一次性签发。 */
  private async loadPage(input: Scoped<PostgresTablePageInput>, connect: Connect, file?: PostgresDraftDocument):
    Promise<Pick<PostgresDraftRestored, 'page' | 'entries'>> {
    if (isPostgresRelatedTabId(input.tabId)) throw Error('关联表页必须按原外键范围读取');
    const key = this.key(input);
    if (this.active.has(key)) throw Error('当前PostgreSQL表页仍有在途操作');
    this.active.add(key);
    try {
      const previous = this.snapshots.get(key);
      const options = { filter: input.filter, sort: postgresTableSortSchema.parse(input.sort) };
      const pins = input.retainPageTokens ?? [], historyPins = input.retainHistoryPageTokens ?? [];
      const allPins = [...pins, ...historyPins];
      if (allPins.length > postgresTableLimits.draftPages || new Set(allPins).size !== allPins.length)
        throw Error('草稿及历史原页不能重复或超过保留上限');
      const retained = new Map(pins.map(pageToken => [pageToken, this.snapshot({ ...input, pageToken }, true, true)]));
      const scopeKey = pageScope(options);
      for (const snapshot of retained.values()) if (pageScope(snapshot.options) !== scopeKey)
        throw Error('请先处理草稿，再更改筛选或排序');
      const history = new Map<string, Snapshot>();
      for (const pageToken of historyPins) {
        try {
          const snapshot = this.snapshot({ ...input, pageToken }, true, true);
          if (pageScope(snapshot.options) === scopeKey) history.set(pageToken, snapshot);
        } catch { /* 原页已过期或不属于本工作区，忽略对应历史。 */ }
      }
      const result = await connect(async connection => {
        await begin(connection, 'page');
        const relation = await readRelation(connection, input.table);
        const restored = file ? await this.verifyDraft(connection, relation, file) : undefined;
        let counted: ReturnType<typeof postgresCountedWindow> | undefined;
        if (input.navigation) {
          const values: unknown[] = [];
          const condition = postgresTableCondition(options.filter, name => columnIdentifier(relation, name), value => '$' + values.push(value));
          const count = await connection.query('SELECT pg_catalog.count(*)::text FROM ' + only(relation) +
            (condition ? ' WHERE ' + condition : ''), values, small());
          if (count.truncated || count.rows.length !== 1) throw Error('PostgreSQL 匹配记录计数未完整返回');
          counted = postgresCountedWindow(count.rows[0].c0, input.limit, input.offset, input.navigation);
        }
        const { sql, args, withOriginal } = readSql(relation, options, { ...input, offset: counted?.offset ?? input.offset });
        const records = await connection.query(sql, args, { rows: input.limit + 1, bytes: 8 * 1024 * 1024 });
        // 数量与页面必须来自同一只读快照。易变视图或截断造成不一致时保留旧页。
        if (counted && (records.truncated || records.rows.length !== counted.expected))
          throw Error('PostgreSQL 计数与本次页记录不一致，请缩小筛选范围或刷新');
        const completed = await connection.query('COMMIT', undefined, small());
        if (completed.postgresCommand !== 'COMMIT') throw Error('PostgreSQL表页读取事务未完成');
        const rows: DataRow[] = [], originals: Original[] = [];
        const keyColumns = relation.columns.filter(column => column.primary);
        for (const raw of records.rows.slice(0, input.limit)) {
          const row = Object.fromEntries(relation.columns.map(column => [column.key, raw[column.key]]));
          if (withOriginal) {
            const marker = raw['c' + relation.columns.length];
            const [tid, version, tableOid] = typeof marker === 'string' ? JSON.parse(marker) : [];
            if (typeof tid !== 'string' || typeof version !== 'string' || typeof tableOid !== 'string')
              throw Error('PostgreSQL原行身份回包不完整');
            originals.push({ tid, version, tableOid, digest: digest(row),
              key: digest([relation.fingerprint, keyColumns.map(column => row[column.key])]) });
          }
          rows.push(row);
        }
        return { relation, rows, originals, counted, restored, hasNext: records.rows.length > input.limit, truncated: records.truncated };
      });
      for (const snapshot of retained.values()) if (snapshot.relation.fingerprint !== result.relation.fingerprint)
        throw Error('关系结构或权限已变化，请先核对并处理原草稿');
      if (file && (this.snapshots.get(key) !== previous || result.truncated)) throw Error('PostgreSQL 草稿原页已变化或记录读取不完整');
      const capabilities = result.truncated ? noWrites : result.relation.capabilities;
      const now = Date.now();
      for (const [id, value] of this.snapshots) if (value.current.expires <= now) this.snapshots.delete(id);
      if (!this.snapshots.has(key) && this.snapshots.size >= 128) throw Error('PostgreSQL表页快照已满，请关闭空闲表标签');
      const exportToken = randomUUID();
      const writeEligible = Object.values(capabilities).some(Boolean);
      const { owner, tabId, connectionRevision, connectionId, database, table } = input;
      const scope = { owner, tabId, connectionRevision, connectionId, database, table };
      const current: Snapshot = {
        token: exportToken, scope,
        expires: now + 30 * 60 * 1000, relation: retained.values().next().value?.relation ?? result.relation,
        rows: result.truncated ? [] : result.originals, options, writeEligible,
        window: { offset: result.counted?.offset ?? input.offset, limit: input.limit },
      };
      const groups = file?.groups.map((window, index): Snapshot => ({
        token: randomUUID(), scope, window, expires: current.expires, relation: result.relation,
        rows: result.restored![index], options, writeEligible,
      })) ?? [];
      for (const group of groups) retained.set(group.token, group);
      const entries = file?.entries.map(({ group, change }) => ({
        offset: groups[group].window!.offset, change: { ...change, pageToken: groups[group].token },
        ...(change.kind === 'insert' ? {} : { rowKey: groups[group].rows[change.row].key }),
      })) ?? [];
      const retainedHistoryPageTokens: string[] = [];
      for (const [pageToken, snapshot] of history) {
        if (snapshot.expires <= now || snapshot.relation.fingerprint !== result.relation.fingerprint) continue;
        retained.set(pageToken, snapshot);
        retainedHistoryPageTokens.push(pageToken);
      }
      for (const snapshot of retained.values()) snapshot.preview = undefined;
      this.snapshots.set(key, { current, retained });
      const page: PostgresTablePage = {
        columns: result.relation.columns, rows: result.rows, hasNext: result.hasNext, truncated: result.truncated,
        order: result.relation.keys.length ? 'primary' : ['r','p'].includes(result.relation.kind) ? 'physical' : 'unstable',
        ...(result.relation.keys.length ? { primaryKey: result.relation.keys } : {}),
        relationKind: result.relation.kind, capabilities, exportToken, ...(writeEligible ? { pageToken: exportToken } : {}),
        ...(retainedHistoryPageTokens.length ? { retainedHistoryPageTokens } : {}),
        ...(result.counted ? { counted: { matchingRows: result.counted.matchingRows, offset: result.counted.offset } } : {}),
        ...(result.originals.length && (capabilities.update || capabilities.delete)
          ? { rowKeys: result.originals.map(row => row.key) } : {}),
        ...(!result.truncated && result.originals.length ? { canBrowseReferences: true as const } : {}),
        ...(result.relation.canImport ? { canImport: true as const } : {}),
      };
      return { page, entries };
    } finally { this.active.delete(key); }
  }

  /** 所有定位都绑定原物理版本及完整值摘要，主键摘要从实时原行重算。 */
  private async verifyDraft(connection: PostgresConnection, relation: Relation, file: PostgresDraftDocument): Promise<Original[][]> {
    if (relation.fingerprint !== file.relation) throw Error('PostgreSQL 草稿的原表结构或权限已变化');
    const groups = file.groups.map((): Original[] => []);
    const keyColumns = relation.columns.filter(column => column.primary), keys = new Set<string>();
    for (const { group, change, original } of file.entries) {
      if (!relation.capabilities[change.kind]) throw Error('PostgreSQL 草稿包含当前表不允许的操作');
      if (change.kind !== 'delete') for (const field of change.fields) fieldExpression(field, relation, []);
      if (change.kind === 'insert' || !original) continue;
      const row = await readOriginalRow(connection, relation, original);
      const key = digest([relation.fingerprint, keyColumns.map(column => row[column.key])]);
      if (keys.has(key)) throw Error('同一原记录只允许一个草稿动作');
      keys.add(key);
      groups[group][change.row] = { ...original, key };
    }
    return groups;
  }

  /** 消费原页及确认过的列映射；只有数据库确认 COMMIT 后才报告导入行数。 */
  async importData(input: PostgresTableImportRequest, connect: Connect, check: () => void, commitStart: () => void): Promise<PostgresTableOutcome> {
    const key = this.key(input);
    if (this.active.has(key)) throw Error('当前 PostgreSQL 表页仍有在途操作');
    const snapshot = this.snapshot(input);
    const selected = input.columns.map(key => snapshot.relation.columns.find(column => column.key === key));
    if (!snapshot.relation.canImport || selected.length !== input.source.header.length ||
        new Set(input.columns).size !== selected.length || selected.some(column => !column || !isPostgresSqlExportColumn(column)))
      throw Error('目标表或列映射不可导入，请刷新表页并重新核对');
    const projection = (selected as PostgresTableColumn[]).map(column => postgresIdentifier(column.name)).join(', ');
    this.snapshots.delete(key);
    this.active.add(key);
    let receipt: PostgresTableOutcome | undefined;
    try {
      await connect(async connection => {
        let sent = false;
        let commitAttempted = false;
        try {
          check();
          await begin(connection);
          const locked = await connection.query('LOCK TABLE ' + only(snapshot.relation) + ' IN ROW EXCLUSIVE MODE', undefined, small());
          if (locked.postgresCommand !== 'LOCK') throw Error('PostgreSQL 未确认目标表锁');
          const relation = await readRelation(connection, input.table);
          if (relation.fingerprint !== snapshot.relation.fingerprint || !relation.canImport)
            throw Error('目标表结构或写入权限已变化，请刷新表页');
          await connection.query("SET LOCAL statement_timeout = '0'", undefined, small());
          const command = 'COPY ' + relation.sql + ' (' + projection + ') FROM STDIN WITH (FORMAT CSV, HEADER ' +
            (input.source.hasHeader ? 'true' : 'false') + ', ENCODING \'UTF8\', DELIMITER ' +
            postgresDdlLiteral(input.source.delimiter) + ')';
          const rows = await readPostgresCopySource(input.source, stream => {
            check(); sent = true;
            return connection.copyIn(command, stream);
          });
          check();
          commitStart();
          commitAttempted = true;
          const completed = await connection.query('COMMIT', undefined, small());
          if (completed.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen)
            throw Error('PostgreSQL 未确认导入提交');
          receipt = { outcome: 'committed', affected: rows, message: 'PostgreSQL 已提交导入，共 ' + rows + ' 行' };
        } catch (reason) {
          receipt = await this.rollbackWrite(connection, sent, commitAttempted, reason);
        }
      }, true);
      return receipt!;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (receipt) return { ...receipt, message: receipt.message + '；连接收尾异常：' + message };
      return { outcome: 'notSent', affected: 0, message };
    } finally { this.active.delete(key); }
  }

  /** 令牌不能跨标签、库、连接修订或文档使用。 */
  private snapshot(input: Scoped<PostgresTableReleaseInput>, writing = false, allowRetained = false, relatedEdit = false): Snapshot {
    const group = this.snapshots.get(this.key(input));
    const snapshot = group?.current.token === input.pageToken ? group.current : allowRetained ? group?.retained.get(input.pageToken) : undefined;
    const scope = snapshot?.scope;
    if (!snapshot || !scope || snapshot.token !== input.pageToken || snapshot.expires <= Date.now() ||
        scope.connectionId !== input.connectionId || scope.connectionRevision !== input.connectionRevision ||
        scope.database !== input.database || scope.table !== input.table) throw Error('PostgreSQL表页快照已过期或来源变化，请刷新');
    if (writing && !snapshot.writeEligible) throw Error('原表页没有记录修改能力，请刷新');
    if (snapshot.related && (!relatedEdit || !this.relatedCurrent(snapshot.related)))
      throw Error('关联编辑令牌只可用于原记录修改');
    return snapshot;
  }

  /** 外键目录和候选只读，返回前再次核对当前页，不能借已经翻走的表页回包。 */
  async references(input: Scoped<PostgresTableReferenceInput>, connect: Connect): Promise<PostgresTableReferenceResult> {
    const key = this.key(input);
    if (this.active.has(key)) throw Error('当前 PostgreSQL 表页仍有在途操作');
    const rowIndex = input.parentRow ?? input.childrenRow;
    const browsing = rowIndex !== undefined;
    const original = this.snapshot(input, !browsing);
    const source = rowIndex === undefined ? undefined : original.rows[rowIndex];
    const incoming = input.childrenRow !== undefined;
    if (browsing && !source) throw Error('原记录不可定位，请刷新表页');
    if (!browsing && !original.relation.capabilities.insert && !original.relation.capabilities.update)
      throw Error('原表页不支持写入外键字段');
    const result = await connect(async connection => {
      await begin(connection, 'page');
      const relation = await readRelation(connection, input.table);
      if (relation.fingerprint !== original.relation.fingerprint) throw Error('原表页结构或权限已变化，请刷新');
      const sourceRow = source && await referenceSource(connection, relation, source, incoming, !!input.lookup);
      const references = await readPostgresTableReferences(connection, relation.oid, relation.columns, input.lookup, sourceRow);
      const reply = await connection.query('COMMIT', undefined, small());
      if (reply.postgresCommand !== 'COMMIT') throw Error('PostgreSQL 外键候选读取未完成');
      return references;
    });
    if (this.active.has(key) || this.snapshot(input, !browsing) !== original) throw Error('PostgreSQL 原表页已变化，请重新打开外键记录');
    const lookup = input.lookup;
    if (input.relatedTabId && source && lookup) {
      const choice = result.choices.find(item => item.id === lookup.id && item.stamp === lookup.stamp);
      if (!choice || !result.page || (!incoming && !result.page.rows.length)) throw Error('没有可打开的关联记录');
      const table = postgresIdentifier(choice.schema) + '.' + postgresIdentifier(choice.table);
      const { owner, connectionRevision, connectionId, database } = input;
      const target = { owner, connectionRevision, connectionId, database, table, tabId: input.relatedTabId };
      const now = Date.now(), relatedKey = this.key(target);
      for (const [id, scope] of this.related) if (scope.expires <= now) this.related.delete(id);
      if (this.related.has(relatedKey) || this.related.size >= 128) throw Error('关联表页已存在或达到数量上限');
      this.related.set(relatedKey, { target, originTable: input.table, relation: original.relation, row: source,
        incoming, lookup, expires: now + 30 * 60 * 1000 });
      return { choices: result.choices, opened: { tabId: target.tabId, table } };
    }
    return result;
  }

  /** 新标签只继承已核准的关联来源，翻页与刷新均重新核对权限、外键和原记录。 */
  async relatedPage(input: Scoped<Extract<PostgresRelatedTableInput, { operation: 'page' }>>,
    connect: Connect): Promise<PostgresRelatedTablePage> {
    return this.useRelated(input, async (scope, key) => {
      this.snapshots.delete(key);
      scope.editSource = undefined;
      const search = scope.incoming ? input.search ?? scope.lookup.search : '';
      const offset = scope.incoming ? input.offset : 0;
      const result = await connect(async connection => {
        await begin(connection, 'page');
        const { relation, source } = await this.relatedOrigin(connection, scope);
        const target = await readRelation(connection, scope.target.table);
        const capture = target.canReadSystemColumns && target.capabilities.update;
        const lookup = { ...scope.lookup, search, offset };
        const { choices, page, versions } = await readPostgresTableReferences(connection, relation.oid, relation.columns, lookup, source, true, capture);
        const choice = choices.find(item => item.id === lookup.id && item.stamp === lookup.stamp);
        if (!choice || !page) throw Error('原关联已变化，请重新打开');
        // 关联结果按键列优先展示。编辑摘要必须恢复目标表的字段序，与普通记录核对保持一致。
        const byName = new Map(page.columns.map(column => [column.name, column.key]));
        const rows = versions?.length && target.columns.every(column => byName.has(column.name)) ? versions.map((version, index) => {
          const data = Object.fromEntries(target.columns.map(column => [column.key, page.rows[index][byName.get(column.name)!]]));
          return { ...version, digest: digest(data), key: digest(target.columns.filter(column => column.primary).map(column => data[column.key])) };
        }) : undefined;
        const reply = await connection.query('COMMIT', undefined, small());
        if (reply.postgresCommand !== 'COMMIT') throw Error('PostgreSQL 关联记录读取未完成');
        return { page, incoming: scope.incoming, constraint: choice.name, offset, search, target, rows };
      });
      const { target, rows, ...page } = result;
      if (!this.relatedCurrent(scope)) throw Error('关联表页已失效，请从源记录重新打开');
      if (!rows) return page;
      const editToken = randomUUID();
      scope.editSource = { token: editToken, relation: target, rows };
      return { ...page, editToken };
    });
  }

  /** 关联页只为用户明确选中的一行签发更新快照，沿用普通记录预览和事务。 */
  async relatedEdit(input: Scoped<Extract<PostgresRelatedTableInput, { operation: 'edit' }>>, connect: Connect): Promise<PostgresTablePage> {
    return this.useRelated(input, async (scope, key) => {
      const source = scope.editSource, original = source?.rows[input.row];
      if (!source || source.token !== input.pageToken || !original) throw Error('关联记录已过期，请刷新后编辑');
      const { relation, row } = await connect(async connection => {
        await begin(connection, 'page');
        await this.verifyRelated(connection, scope);
        const relation = await readRelation(connection, input.table);
        if (!relation.capabilities.update || relation.fingerprint !== source.relation.fingerprint)
          throw Error('关联目标结构或编辑权限已变化，请刷新');
        const row = await readOriginalRow(connection, relation, original);
        const reply = await connection.query('COMMIT', undefined, small());
        if (reply.postgresCommand !== 'COMMIT') throw Error('PostgreSQL 关联记录读取未完成');
        return { relation, row };
      });
      if (!this.relatedCurrent(scope)) throw Error('关联表页已失效，请从源记录重新打开');
      const now = Date.now(), pageToken = randomUUID(), capabilities = { ...noWrites, update: true };
      for (const [id, group] of this.snapshots) if (group.current.expires <= now) this.snapshots.delete(id);
      if (!this.snapshots.has(key) && this.snapshots.size >= 128) throw Error('PostgreSQL表页快照已满，请关闭空闲表标签');
      this.snapshots.set(key, { current: {
        scope: scope.target, token: pageToken, expires: scope.expires, relation: { ...relation, capabilities },
        rows: [original], options: {}, writeEligible: true, related: scope,
      }, retained: new Map() });
      return { pageToken, columns: relation.columns, rows: [row], order: 'primary', relationKind: relation.kind,
        hasNext: false, truncated: false, capabilities };
    });
  }

  private relatedCurrent(scope: RelatedScope): boolean {
    return this.related.get(this.key(scope.target)) === scope && scope.expires > Date.now();
  }

  private async useRelated<T>(input: Scoped<PostgresTableTarget>, work: (scope: RelatedScope, key: string) => Promise<T>): Promise<T> {
    const key = this.key(input), scope = this.related.get(key);
    if (!scope || !this.relatedCurrent(scope) || scope.target.table !== input.table || scope.target.connectionId !== input.connectionId ||
        scope.target.connectionRevision !== input.connectionRevision || scope.target.database !== input.database)
      throw Error('关联表页已失效，请从源记录重新打开');
    if (this.active.has(key)) throw Error('当前 PostgreSQL 表页仍有在途操作');
    this.active.add(key);
    try { return await work(scope, key); }
    finally { this.active.delete(key); }
  }

  private async relatedOrigin(connection: PostgresConnection, scope: RelatedScope) {
    const relation = await readRelation(connection, scope.originTable);
    if (relation.fingerprint !== scope.relation.fingerprint) throw Error('关联来源结构或权限已变化，请重新打开');
    return { relation, source: await referenceSource(connection, relation, scope.row, scope.incoming, true) };
  }

  /** 核对外键及原行版本即可确认范围。目标行的原值由普通编辑事务单独加锁复核。 */
  private async verifyRelated(connection: PostgresConnection, scope: RelatedScope): Promise<void> {
    if (!this.relatedCurrent(scope)) throw Error('关联表页已失效，请从源记录重新打开');
    const { relation, source } = await this.relatedOrigin(connection, scope);
    const { choices } = await readPostgresTableReferences(connection, relation.oid, relation.columns, undefined, source);
    if (!choices.some(choice => choice.id === scope.lookup.id && choice.stamp === scope.lookup.stamp) || !this.relatedCurrent(scope))
      throw Error('原关联已变化，请重新打开');
  }

  closeRelated(input: Scoped<PostgresTableTarget>): null {
    const key = this.key(input), scope = this.related.get(key);
    if (scope?.target.connectionId === input.connectionId && scope.target.database === input.database && scope.target.table === input.table) {
      this.related.delete(key);
      if (this.snapshots.get(key)?.current.related === scope) this.snapshots.delete(key);
    }
    return null;
  }

  /** 字段只读任务复用原表页范围，读前核对列目录，读后拒绝已撤销的原页。 */
  private async readColumn<T>(input: Scoped<PostgresTableColumnReadInput>, connect: Connect,
    read: (connection: PostgresConnection, relation: Relation, column: PostgresTableColumn, filter: Snapshot['options']['filter']) => Promise<T>): Promise<T> {
    const original = this.snapshot(input);
    const key = this.key(input);
    if (this.active.has(key)) throw Error('当前 PostgreSQL 表页仍有在途操作');
    this.active.add(key);
    try {
      const result = await connect(async connection => {
        await begin(connection, 'page');
        const relation = await readRelation(connection, input.table);
        if (relation.fingerprint !== original.relation.fingerprint) throw Error('原表页结构或权限已变化，请刷新');
        const column = relation.columns.find(item => item.key === input.column);
        if (!column) throw Error('原表页字段已变化，请刷新');
        const output = await read(connection, relation, column, original.options.filter);
        const completed = await connection.query('COMMIT', undefined, small());
        if (completed.postgresCommand !== 'COMMIT') throw Error('PostgreSQL 字段读取事务未完成');
        return output;
      });
      if (this.snapshot(input) !== original) throw Error('PostgreSQL 原表页已变化，请重新打开字段读取');
      return result;
    } finally { this.active.delete(key); }
  }

  /** 候选沿原表页已应用条件读全范围，原生分组保留列的比较与排序规则。 */
  values(input: Scoped<PostgresTableValuesInput>, connect: Connect): Promise<PostgresTableValues> {
    return this.readColumn(input, connect, async (connection, relation, column, filter) => {
      if (!column.valueOptions) throw Error('当前字段不支持按不同值筛选');
      if (column.type === 'real' || column.type === 'double precision') {
        // 改精度会影响已应用的文字筛选。服务端启用舍入时拒绝生成可能失真的候选。
        if (!await hasPostgresRoundtripFloatText(connection)) throw Error('服务器浮点文本输出精度不足，无法准确按不同值筛选');
      }
      const name = postgresIdentifier(column.name), args: unknown[] = [input.search];
      const condition = postgresTableCondition(filter, field => columnIdentifier(relation, field), value => '$' + args.push(value));
      const maximum = postgresTableValueLimits.groups + 1;
      const order = readTableValueOptionsOrder(input.order);
      const frequencyOrder = order === 'value' ? '' : order === 'count-desc' ? 'grouped_values.frequency DESC, ' : 'grouped_values.frequency ASC, ';
      // 次数使用原 bigint 排序，搜索与排序覆盖所有分组；同次数沿用原显示顺序。
      const rows = await connection.query(`
        SELECT pg_catalog.left(display, ${FILTER_LIMITS.valueLength + 1}), frequency::text
        FROM (SELECT pg_catalog.min(${name}::text COLLATE pg_catalog."C") AS display,
                     pg_catalog.count(*) AS frequency
              FROM ${only(relation)} ${condition ? 'WHERE ' + condition : ''}
              GROUP BY ${name}) AS grouped_values
        WHERE $1::text = '' OR pg_catalog.strpos(display, $1) > 0
        ORDER BY ${frequencyOrder}display NULLS FIRST LIMIT ${maximum}
      `, args, { rows: maximum, bytes: 12 * 1024 * 1024 });
      if (rows.truncated) throw Error('PostgreSQL 不同值超过读取预算，请缩小搜索范围');
      const options = rows.rows.slice(0, postgresTableValueLimits.groups).map(row => {
        const value = row.c0, count = row.c1;
        if ((value !== null && typeof value !== 'string') || typeof count !== 'string' || !/^[1-9]\d{0,18}$/.test(count))
          throw Error('PostgreSQL 不同值回包无效');
        const clipped = value !== null && value.length > FILTER_LIMITS.valueLength;
        return { value: clipped ? Array.from(value).slice(0, 200).join('') : value, count, clipped };
      });
      return { options, truncated: rows.rows.length > postgresTableValueLimits.groups };
    });
  }

  /** 统计全部符合当前条件的已提交数据，不读取分页记录或 Renderer 草稿。 */
  statistics(input: Scoped<PostgresTableColumnReadInput>, connect: Connect) {
    return this.readColumn(input, connect, (connection, relation, column, filter) => {
      const args: unknown[] = [];
      const condition = postgresTableCondition(filter, field => columnIdentifier(relation, field), value => '$' + args.push(value));
      return readPostgresColumnStatistics(connection, column, only(relation) + (condition ? ' WHERE ' + condition : ''), args);
    });
  }

  /** 分布独立于总和及方差计算，沿原表页快照验证与已应用筛选读取。 */
  histogram(input: Scoped<PostgresTableHistogramInput>, connect: Connect) {
    return this.readColumn(input, connect, (connection, relation, column, filter) => {
      const args: unknown[] = [];
      const condition = postgresTableCondition(filter, field => columnIdentifier(relation, field), value => '$' + args.push(value));
      return readPostgresTableHistogram(connection, column, only(relation) + (condition ? ' WHERE ' + condition : ''), args, input.bins);
    });
  }

  /** 先声明游标锁住并复核关系。原生 COPY 使用同一事务中的单条 SELECT 快照。 */
  async exportData(input: Scoped<PostgresTableExportInput>, connect: Connect, check: () => void,
    delimiter: CsvExportDelimiter, consume: (source: ExportSource) => Promise<void>) {
    const key = this.key(input);
    if (this.active.has(key)) throw Error('当前PostgreSQL表页仍有在途操作');
    const snapshot = this.snapshot({ ...input, pageToken: input.exportToken });
    this.active.add(key);
    try {
      await connect(async connection => {
        check();
        await begin(connection, 'export');
        const relation = await readRelation(connection, input.table);
        if (relation.fingerprint !== snapshot.relation.fingerprint) throw Error('导出关系结构已变化，请刷新表页');
        const columns = input.columns.map(key => relation.columns.find(column => column.key === key));
        if (columns.some(column => !column)) throw Error('导出列已变化，请刷新表页');
        const selected = columns as PostgresTableColumn[];
        if (input.format === 'sql' && (!isPostgresSqlExportRelation(relation.kind) || !selected.every(isPostgresSqlExportColumn)))
          throw Error('SQL 数据脚本只支持表的可插入列，计算生成列由目标表恢复');
        const { sql, args } = readSql(relation, snapshot.options, undefined, selected);
        const declared = await connection.query('DECLARE dbark_table_export NO SCROLL CURSOR FOR ' + sql, args, small(), undefined, 'extended');
        if (declared.postgresCommand !== 'DECLARE') throw Error('PostgreSQL 导出游标未确认');
        const locked = await readRelation(connection, input.table);
        if (locked.fingerprint !== relation.fingerprint) throw Error('游标声明后关系已变化，请刷新表页');
        if (input.format === 'copy') {
          // 大文件可持续读取超过普通表页时限，连接仍可由导出任务取消。
          await connection.query("SET LOCAL statement_timeout = '0'", undefined, small());
          const query = readSql(relation, snapshot.options, undefined, selected, true).sql;
          const command = 'COPY (' + query + ') TO STDOUT WITH (FORMAT CSV, HEADER true, ENCODING \'UTF8\', DELIMITER ' +
            postgresDdlLiteral(delimiter) + ')';
          await consume({ kind: 'copy', write: sink => connection.copyOut(command, sink) });
        } else {
          const replay = input.format === 'sql' ? { table: relation.sql, settings: await readPostgresSqlExportSettings(connection) } : undefined;
          await consume({ kind: 'cursor', columns: selected, rows: readExportCursor(connection, selected, check), replay });
        }
        check();
        const closed = await connection.query('CLOSE dbark_table_export', undefined, small());
        if (closed.postgresCommand !== 'CLOSE') throw Error('PostgreSQL 导出游标未关闭');
        const completed = await connection.query('COMMIT', undefined, small());
        if (completed.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen)
          throw Error('PostgreSQL 导出读取未完成');
      });
    } finally { this.active.delete(key); }
  }

  /** 保存与预览使用同一原页及变更校验，文件捕获不会签发提交令牌。 */
  private planDraft(input: Scoped<PostgresTablePreviewInput>) {
    if (this.active.has(this.key(input))) throw Error('当前PostgreSQL表页仍有在途操作');
    const snapshot = this.snapshot(input, false, false, true), relation = snapshot.relation;
    const counts = { insert: 0, update: 0, delete: 0 };
    const sources = new Map<string, Snapshot>();
    const keys = new Set<string>(), tids = new Set<string>();
    const writes: Write[] = input.changes.map(change => {
      const pageToken = change.pageToken ?? input.pageToken;
      let source = sources.get(pageToken);
      if (!source) {
        source = this.snapshot({ ...input, pageToken }, true, true, true);
        if (source.relation.fingerprint !== relation.fingerprint) throw Error('原页关系结构或权限已变化');
        sources.set(pageToken, source);
      }
      if (!relation.capabilities[change.kind]) throw Error('此PostgreSQL关系不支持该记录操作');
      const values: unknown[] = [];
      const fields = change.kind === 'delete' ? [] : change.fields.map(field => fieldExpression(field, relation, values));
      counts[change.kind]++;
      if (change.kind === 'insert') {
        const sql = 'INSERT INTO ' + relation.sql + (fields.length
          ? ' (' + fields.map(field => field.column).join(', ') + ') VALUES (' + fields.map(field => field.expression).join(', ') + ')'
          : ' DEFAULT VALUES');
        return { kind: change.kind, sql, values };
      }
      const original = source.rows[change.row];
      if (!original) throw Error('待修改的原行已失效');
      if (keys.has(original.key) || tids.has(original.tid)) throw Error('同一原记录只允许一个草稿动作');
      keys.add(original.key); tids.add(original.tid);
      const predicate = rowPredicate(values, original);
      const sql = change.kind === 'delete'
        ? 'DELETE FROM ' + only(relation) + ' WHERE ' + predicate
        : 'UPDATE ' + only(relation) + ' SET ' + fields.map(field => field.column + ' = ' + field.expression).join(', ') + ' WHERE ' + predicate;
      return { kind: change.kind, sql, values, original };
    });
    return { snapshot, counts, writes, sources };
  }

  captureDraft(input: Scoped<PostgresTablePreviewInput> & { endpoint: string }): PostgresDraftDocument {
    const { snapshot, sources, writes } = this.planDraft(input);
    if (!snapshot.window || snapshot.related) throw Error('只能保存普通 PostgreSQL 表页的草稿');
    const groups = [...sources.values()];
    const indexes = new Map(groups.map((source, index) => [source.token, index]));
    return postgresDraftSchema.parse({
      version: 1, kind: 'tabrelio.postgresql.tableDraft',
      target: { connectionId: input.connectionId, database: input.database, table: input.table },
      endpoint: input.endpoint, relation: snapshot.relation.fingerprint, view: { ...snapshot.window, ...snapshot.options },
      groups: groups.map(source => source.window),
      entries: input.changes.map(({ pageToken, ...change }, index) => {
        const original = writes[index].original;
        return { group: indexes.get(pageToken ?? snapshot.token), change,
          ...(original ? { original: { tid: original.tid, version: original.version, tableOid: original.tableOid, digest: original.digest } } : {}) };
      }),
    });
  }

  /** 预览只签发服务端构建的语句，不执行写入或读取渲染器提供的SQL。 */
  preview(input: Scoped<PostgresTablePreviewInput>): PostgresTablePreview {
    const { snapshot, counts, writes, sources } = this.planDraft(input);
    const token = randomUUID();
    snapshot.preview = { token, expires: Math.min(Date.now() + 5 * 60 * 1000, ...Array.from(sources.values(), source => source.expires)), writes };
    return { previewToken: token, statements: writes.map(write => write.sql), counts };
  }

  async previewFilteredUpdate(input: Scoped<PostgresFilteredUpdateInput>, connect: Connect): Promise<PostgresTablePreview> {
    const { connectionId, database, table, tabId, pageToken } = input;
    const { fields } = postgresFilteredUpdateSchema.parse({ connectionId, database, table, tabId, pageToken, fields: input.fields });
    return this.previewFilteredWrite(input, { kind: 'update', fields }, connect);
  }

  previewFilteredDelete(input: Scoped<PostgresTableReleaseInput>, connect: Connect): Promise<PostgresTablePreview> {
    return this.previewFilteredWrite(input, { kind: 'delete' }, connect);
  }

  /** 只用原页已应用的筛选计算预览。完整匹配的行版本和写入语句保留在一次性凭据中。 */
  private async previewFilteredWrite(input: Scoped<PostgresTableReleaseInput>, write: FilteredWrite, connect: Connect): Promise<PostgresTablePreview> {
    const snapshot = this.snapshot(input, true);
    const key = this.key(input), { relation, options } = snapshot;
    if (this.active.has(key)) throw Error('当前 PostgreSQL 表页仍有在途操作');
    const verb = write.kind === 'update' ? '更新' : '删除';
    if (relation.kind !== 'r' || !relation.capabilities[write.kind] || !relation.canReadSystemColumns || !isPostgresTableFiltered(options.filter))
      throw Error(`按筛选${verb}需要已应用筛选的可写普通表及主键`);
    const values: string[] = [], writeValues: unknown[] = [];
    const condition = postgresTableCondition(options.filter, name => columnIdentifier(relation, name), value => '$' + values.push(value));
    if (!condition) throw Error(`请先应用筛选再批量${verb}`);
    const assignments = write.kind === 'update' ? write.fields.map(field => {
      const column = relation.columns.find(item => item.key === field.column);
      if (!column || !isPostgresFilteredUpdateColumn(column)) throw Error('按筛选更新不能写主键或生成列');
      const { column: name, expression } = fieldExpression(field, relation, writeValues);
      return `${name} = ${expression}`;
    }).join(', ') : '';
    const operation = write.kind === 'update' ? `UPDATE ${only(relation)} SET ${assignments}` : `DELETE FROM ${only(relation)}`;
    const matchSql = `SELECT ctid::text, xmin::text FROM ${only(relation)} WHERE ${condition} LIMIT ${postgresFilteredWriteMaxRows + 1}`;
    snapshot.preview = undefined;
    this.active.add(key);
    try {
      const match = await connect(async connection => {
        await begin(connection, 'page');
        if ((await readRelation(connection, input.table)).fingerprint !== relation.fingerprint) throw Error('原表结构或权限已变化，请刷新');
        const result = await filteredWriteVersions(connection, matchSql, values);
        if ((await connection.query('COMMIT', undefined, small())).postgresCommand !== 'COMMIT') throw Error(`按筛选${verb}预览事务未完成`);
        return result;
      });
      if (this.snapshot(input, true) !== snapshot) throw Error('原表页已变化，请重新预览');
      const count = match.positions.length;
      if (!count) throw Error('当前筛选没有匹配记录');
      const sql = `${operation} WHERE ctid = ANY($${writeValues.push(match.positions)}::tid[])`;
      const token = randomUUID();
      snapshot.preview = { token, expires: Math.min(snapshot.expires, Date.now() + 5 * 60 * 1000),
        writes: [{ kind: write.kind, sql, values: writeValues }], filtered: { sql: matchSql, values, signature: match.signature, count } };
      const scope = { condition, parameters: values };
      const counts = { insert: 0, update: 0, delete: 0, [write.kind]: count };
      return { previewToken: token, statements: [sql], counts,
        ...(write.kind === 'update' ? { filteredUpdate: { ...scope, fields: write.fields } } : { filteredDelete: scope }) };
    } finally { this.active.delete(key); }
  }

  /** 先消费预览。只有确认回滚且原页仍有效时，才保留跨页草稿引用的快照。 */
  async apply(input: Scoped<PostgresTableApplyInput>, connect: Connect): Promise<PostgresTableOutcome> {
    const key = this.key(input);
    if (this.active.has(key)) throw Error('当前PostgreSQL表页仍有在途操作');
    const snapshot = this.snapshot(input, false, false, true), preview = snapshot.preview;
    if (!preview || preview.token !== input.previewToken || preview.expires <= Date.now()) throw Error('PostgreSQL提交预览已失效');
    if (input.confirmedRows !== preview.filtered?.count) throw Error('确认行数与按筛选操作的预览不一致');
    const group = this.snapshots.get(key);
    snapshot.preview = undefined;
    this.active.add(key);
    let receipt: PostgresTableOutcome | undefined;
    let draftsRetained = false;
    try {
      try {
        await connect(async connection => {
          receipt = await this.applyTransaction(connection, snapshot.relation, input.table, preview.writes, snapshot.related, preview.filtered);
        }, true);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        receipt = receipt
          ? { ...receipt, message: receipt.message + '；连接收尾异常：' + message }
          : { outcome: 'notSent', affected: 0, message };
      }
      draftsRetained = receipt?.outcome === 'rolledBack' && this.snapshots.get(key) === group && preview.expires > Date.now();
      return draftsRetained ? { ...receipt!, draftsRetained: true } : receipt!;
    } finally {
      if (!draftsRetained && this.snapshots.get(key) === group) this.snapshots.delete(key);
      this.active.delete(key);
    }
  }

  /** 提交回执以实际命令标签及空闲状态为准，断线时保留未知终态。 */
  private async applyTransaction(connection: PostgresConnection, expected: Relation, table: string, writes: Write[],
    related?: RelatedScope, filtered?: FilteredWriteMatch): Promise<PostgresTableOutcome> {
    let sent = false;
    let commitAttempted = false;
    try {
      // 等锁期间可能有事务提交。显式使用读已提交，锁后的复核才能取得新快照。
      await begin(connection, filtered ? 'filteredWrite' : 'write');
      const current = await readRelation(connection, table);
      if (current.fingerprint !== expected.fingerprint || current.sql !== expected.sql) throw Error('关系结构或权限已变化，请重新读取');
      // 筛选集合复核和写入期间阻止其他事务增删改，避免新匹配行在核对后进入原范围。
      await connection.query('LOCK TABLE ' + only(current) + (filtered ? ' IN SHARE ROW EXCLUSIVE MODE' : ' IN ROW EXCLUSIVE MODE'), undefined, small());
      const locked = await readRelation(connection, table);
      if (locked.fingerprint !== expected.fingerprint || writes.some(write => !locked.capabilities[write.kind])) {
        throw Error('锁定后的关系结构或权限已变化，请重新读取');
      }
      const projection = locked.columns.map(column => postgresIdentifier(column.name)).join(', ');
      for (const { original } of writes) if (original) {
        const args: unknown[] = [];
        const row = await connection.query('SELECT ' + projection + ' FROM ' + only(locked) +
          ' WHERE ' + rowPredicate(args, original) + ' FOR UPDATE', args, { rows: 2, bytes: 8 * 1024 * 1024 });
        if (row.truncated || row.rows.length !== 1 || digest(row.rows[0]) !== original.digest) {
          throw Error('原记录已被修改、删除或替换，整批未写入，请刷新');
        }
      }
      if (related) await this.verifyRelated(connection, related);
      if (filtered) {
        const match = await filteredWriteVersions(connection, filtered.sql, filtered.values);
        if (match.signature !== filtered.signature) throw Error('筛选匹配集合或原行版本已变化，整批未写入，请重新预览');
      }
      for (const write of writes) {
        sent = true;
        const result = await connection.query(write.sql, write.values, small());
        if (result.postgresCommand !== write.kind.toUpperCase() || result.affectedRows !== (filtered?.count ?? 1))
          throw Error(filtered ? '数据库确认的影响行数与筛选预览不一致' : '数据库未确认该语句恰好影响一行');
      }
      commitAttempted = true;
      const result = await connection.query('COMMIT', undefined, small());
      if (result.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen) {
        throw Error('PostgreSQL未确认提交');
      }
      return { outcome: 'committed', affected: filtered?.count ?? writes.length, message: 'PostgreSQL已确认整批提交' };
    } catch (reason) {
      return this.rollbackWrite(connection, sent, commitAttempted, reason);
    }
  }

  /** COMMIT 发出后，单凭连接已空闲无法确定这批写入的结果。 */
  private async rollbackWrite(connection: PostgresConnection, sent: boolean, commitAttempted: boolean, reason: unknown): Promise<PostgresTableOutcome> {
    const message = connection.error(reason).message;
    if (!sent) return { outcome: 'notSent', affected: 0, message };
    const state = connection.state();
    if (!state.transactionKnown || (commitAttempted && !state.transactionOpen))
      return { outcome: 'unknown', affected: 0, message: '提交状态待核对：' + message };
    try {
      if (state.transactionOpen) {
        const rollback = await connection.query('ROLLBACK', undefined, small());
        if (rollback.postgresCommand !== 'ROLLBACK') throw Error('未收到回滚确认');
      }
      if (!connection.state().transactionKnown || connection.state().transactionOpen) throw Error('回滚状态未知');
      return { outcome: 'rolledBack', affected: 0, message: '整批已回滚：' + message };
    } catch {
      return { outcome: 'unknown', affected: 0, message: '事务终态待核对：' + message };
    }
  }
  /** 释放仅消费同一文档的原页令牌，旧标签销毁不影响后来读取的快照。 */
  release(input: Scoped<PostgresTableReleaseInput>): void {
    const key = this.key(input);
    const snapshot = this.snapshots.get(key)?.current;
    if (snapshot?.token === input.pageToken && snapshot.scope.connectionId === input.connectionId) this.snapshots.delete(key);
  }

  /** 原表能力也参与连接断开路由，冷打开的表页无需额外缓存密码。 */
  connectionIds(): string[] {
    return [...new Set([...this.snapshots.values()].map(group => group.current.scope.connectionId)
      .concat([...this.related.values()].map(scope => scope.target.connectionId)))];
  }

  /** 断开或修改传输配置后撤销该连接的全部待提交预览。 */
  clear(connectionId: string): void {
    for (const [key, group] of this.snapshots) if (group.current.scope.connectionId === connectionId) this.snapshots.delete(key);
    for (const [key, scope] of this.related) if (scope.target.connectionId === connectionId) this.related.delete(key);
  }
}

/** 每次读取有界行批，消费完才取下一批，任何截断都使整份文件失败。 */
async function* readExportCursor(connection: PostgresConnection, columns: PostgresTableColumn[], check: () => void) {
  for (;;) {
    check();
    const batch = await connection.query('FETCH FORWARD 64 FROM dbark_table_export', undefined, { rows: 64, bytes: 64 * 1024 * 1024 });
    if (batch.postgresCommand !== 'FETCH' || batch.truncated || batch.affectedRows !== batch.rows.length ||
        batch.columns.length !== columns.length || batch.columns.some((column, i) => column.name !== columns[i].name))
      throw Error('PostgreSQL 导出批次不完整或超过大小预算');
    for (const row of batch.rows) {
      check();
      yield batch.columns.map(column => row[column.key]);
    }
    if (batch.rows.length < 64) return;
  }
}
