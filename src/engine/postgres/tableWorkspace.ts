import { createHash, randomUUID } from 'node:crypto';
import type { CellValue, DataRow } from '../../shared/contracts';
import { postgresIdentifier, postgresRelationName } from '../../shared/postgresSql';
import { postgresDdlLiteral } from '../../shared/postgresCreateTable';
import type { CsvExportDelimiter } from '../../shared/csvExport';
import {
  isPostgresSqlExportColumn, isPostgresSqlExportRelation, postgresTableLimits, type PostgresTableApplyInput, type PostgresTableColumn, type PostgresTableExportInput, type PostgresTableField, type PostgresTableImportInput, type PostgresTableOutcome,
  type PostgresTablePage, type PostgresTablePageInput, type PostgresTablePreview, type PostgresTablePreviewInput,
  type PostgresTableReleaseInput, type PostgresTableTarget,
} from '../../shared/postgresTable';
import type { PostgresConnection } from './connection';
import { readPostgresSqlExportSettings, type PostgresSqlExportSettings } from './sqlExport';
import { readPostgresCopySource, type PostgresCopySource } from './copyImportFile';

type Scoped<T> = T & { owner: string; connectionRevision: number };
type Connect = <T>(action: (connection: PostgresConnection) => Promise<T>, writing?: boolean) => Promise<T>;
type Capabilities = PostgresTablePage['capabilities'];
interface Relation {
  sql: string;
  kind: PostgresTablePage['relationKind'];
  columns: PostgresTableColumn[];
  keys: string[];
  fingerprint: string;
  capabilities: Capabilities;
  canImport: boolean;
}
interface Original { tid: string; version: string; digest: string; key: string; }
interface Write { kind: keyof Capabilities; sql: string; values: unknown[]; original?: Original; }
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
  writeEligible: boolean;
  preview?: { token: string; expires: number; writes: Write[] };
}
interface TableSnapshots { current: Snapshot; retained: Map<string, Snapshot>; }
export type PostgresTableImportRequest = Scoped<PostgresTableImportInput> & { source: PostgresCopySource };
const noWrites: Capabilities = { insert: false, update: false, delete: false };
const small = () => ({ rows: 1024, bytes: 2 * 1024 * 1024 });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const only = (relation: Relation) => (relation.kind === 'r' ? 'ONLY ' : '') + relation.sql;
const pageScope = ({ filter, sort }: Snapshot['options']) =>
  JSON.stringify([filter?.column, filter?.text, sort?.column, sort?.direction]);

/** 每次从实际库读取关系、主键顺序、列权限与结构；标识符及类型显示均来自目录。 */
async function readRelation(connection: PostgresConnection, table: string): Promise<Relation> {
  const { schema, name } = postgresRelationName(table);
  const header = await connection.query(`
    SELECT c.oid, pg_catalog.pg_relation_filenode(c.oid), c.relkind, c.relispartition, c.relhasrules,
           pg_catalog.has_table_privilege(c.oid, 'INSERT'), pg_catalog.has_table_privilege(c.oid, 'UPDATE'),
           pg_catalog.has_table_privilege(c.oid, 'DELETE'),
           (SELECT i.indexrelid FROM pg_catalog.pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND i.indisvalid),
           CASE WHEN c.relkind IN ('v','m') THEN pg_catalog.pg_get_viewdef(c.oid, false) END,
           pg_catalog.row_security_active(c.oid), c.relispopulated
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname::text = $1 AND c.relname::text = $2 AND c.relkind IN ('r','p','v','m','f')
      AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
  `, [schema, name], small());
  const info = header.rows[0];
  if (!info || typeof info.c0 !== 'string') throw Error('PostgreSQL关系不存在、已改名或无权查看');
  if (info.c2 === 'm' && info.c11 === 'f') throw Error('PostgreSQL 物化视图尚未填充数据，请从「查看结构」执行刷新。');
  const fields = await connection.query(`
    SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
           a.atthasdef, a.attgenerated, a.attidentity, a.atttypid,
           coalesce((SELECT k.position FROM pg_catalog.pg_index i,
             LATERAL pg_catalog.unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
             WHERE i.indrelid = a.attrelid AND i.indisprimary AND i.indisvalid AND k.attnum = a.attnum
               AND k.position <= i.indnkeyatts), 0),
           a.attnum, a.attcollation, pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum
  `, [info.c0], small());
  if (!fields.rows.length || fields.truncated || fields.rows.length > 1022) throw Error('PostgreSQL列目录不完整或超过表页预算');
  const columns = fields.rows.map((field, index): PostgresTableColumn => ({
    key: 'c' + index, name: String(field.c0), type: String(field.c1), nullable: field.c2 !== 't',
    defaultValue: field.c3 === 't' || field.c5 !== '', generated: field.c4 !== '' || field.c5 === 'a',
    primary: Number(field.c7) > 0, binary: field.c6 === '17', ...(field.c5 === 'a' ? { identityAlways: true } : {}),
  }));
  const keys = fields.rows.map((field, index) => ({ index, position: Number(field.c7) }))
    .filter(item => item.position > 0).sort((a, b) => a.position - b.position)
    .map(item => postgresIdentifier(columns[item.index].name));
  const kind = info.c2 as Relation['kind'];
  const editable = kind === 'r' && info.c3 === 'f' && info.c4 === 'f';
  return {
    sql: postgresIdentifier(schema) + '.' + postgresIdentifier(name), kind, columns, keys,
    fingerprint: digest([info, fields.rows]),
    canImport: (kind === 'r' || kind === 'p') && info.c4 === 'f' && info.c5 === 't' && info.c10 === 'f',
    capabilities: {
      insert: editable && info.c5 === 't',
      update: editable && keys.length > 0 && info.c6 === 't',
      delete: editable && keys.length > 0 && info.c7 === 't',
    },
  };
}

/** 使用已核对的列号生成安全排序与条件，文字筛选按 PostgreSQL 显示文本匹配。 */
function readSql(relation: Relation, input: Pick<PostgresTablePageInput, 'filter' | 'sort'>,
  page?: Pick<PostgresTablePageInput, 'limit' | 'offset'>, columns = relation.columns, copy = false) {
  const key = (id: string) => {
    const column = relation.columns.find(column => column.name === id);
    if (!column) throw Error('PostgreSQL排序或筛选列已变化');
    return postgresIdentifier(column.name);
  };
  const projection = columns.map(column => postgresIdentifier(column.name)).join(', ');
  const ordered = input.sort ? key(input.sort.column) : undefined;
  const tie = relation.keys.length ? relation.keys : relation.kind === 'r' ? ['ctid'] : relation.kind === 'p' ? ['tableoid', 'ctid'] : [];
  const ordering = [...(ordered && input.sort ? [ordered + (input.sort.direction === 'desc' ? ' DESC' : ' ASC')] : []), ...tie.filter(item => item !== ordered)];
  const args: unknown[] = page ? [page.limit + 1, page.offset] : [];
  let where = '';
  if (input.filter?.text) {
    // COPY 流使用简单协议，其筛选值使用与会话转义设置无关的显式字面量。
    const value = copy ? postgresDdlLiteral(input.filter.text) : '$' + args.push(input.filter.text);
    where = ' WHERE pg_catalog.strpos(' + key(input.filter.column) + '::text, ' + value + ') > 0';
  }
  const withOriginal = !!page && (relation.capabilities.update || relation.capabilities.delete);
  const markers = withOriginal ? ', ctid::text, xmin::text' : '';
  return { sql: 'SELECT ' + projection + markers + ' FROM ' + only(relation) + where +
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
function rowPredicate(values: unknown[], row: Original): string {
  const pos = values.length + 1;
  values.push(row.tid, row.version);
  return 'ctid = $' + pos + '::tid AND xmin = $' + (pos + 1) + '::xid';
}

/** 控制表页事务锁及每条语句的数据库端等待上限。 */
async function begin(connection: PostgresConnection, mode: 'page' | 'export' | 'write' = 'write'): Promise<void> {
  await connection.query(mode === 'page' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' :
    mode === 'export' ? 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY' : 'BEGIN', undefined, small());
  for (const sql of ["SET LOCAL statement_timeout = '15s'", "SET LOCAL lock_timeout = '5s'", "SET LOCAL idle_in_transaction_session_timeout = '20s'"]) {
    await connection.query(sql, undefined, small());
  }
}

/** 页面、预览、提交绑定同一文档和表标签；所有真实数据修改使用独立事务。 */
export class PostgresTableWorkspace {
  private readonly snapshots = new Map<string, TableSnapshots>();
  private readonly active = new Set<string>();

  private key(scope: Scoped<PostgresTableTarget>): string { return JSON.stringify([scope.owner, scope.tabId]); }

  /** 仅保留本标签仍有草稿的原页，导入和导出继续绑定当前页。 */
  async page(input: Scoped<PostgresTablePageInput>, connect: Connect): Promise<PostgresTablePage> {
    const key = this.key(input);
    if (this.active.has(key)) throw Error('当前PostgreSQL表页仍有在途操作');
    this.active.add(key);
    try {
      const pins = input.retainPageTokens ?? [];
      if (pins.length > postgresTableLimits.draftPages) throw Error('草稿原页超过保留上限');
      const retained = new Map(pins.map(pageToken => [pageToken, this.snapshot({ ...input, pageToken }, true, true)]));
      for (const snapshot of retained.values()) if (pageScope(snapshot.options) !== pageScope(input))
        throw Error('请先处理草稿，再更改筛选或排序');
      const result = await connect(async connection => {
        await begin(connection, 'page');
        const relation = await readRelation(connection, input.table);
        const { sql, args, withOriginal } = readSql(relation, input, input);
        const records = await connection.query(sql, args, { rows: input.limit + 1, bytes: 8 * 1024 * 1024 });
        const completed = await connection.query('COMMIT', undefined, small());
        if (completed.postgresCommand !== 'COMMIT') throw Error('PostgreSQL表页读取事务未完成');
        const rows: DataRow[] = [], originals: Original[] = [];
        const keyColumns = relation.columns.filter(column => column.primary);
        for (const raw of records.rows.slice(0, input.limit)) {
          const row = Object.fromEntries(relation.columns.map(column => [column.key, raw[column.key]]));
          if (withOriginal) {
            const tid = raw['c' + relation.columns.length], version = raw['c' + (relation.columns.length + 1)];
            if (typeof tid !== 'string' || typeof version !== 'string') throw Error('PostgreSQL原行身份回包不完整');
            originals.push({ tid, version, digest: digest(row),
              key: digest([relation.fingerprint, keyColumns.map(column => row[column.key])]) });
          }
          rows.push(row);
        }
        return { relation, rows, originals, hasNext: records.rows.length > input.limit, truncated: records.truncated };
      });
      for (const snapshot of retained.values()) if (snapshot.relation.fingerprint !== result.relation.fingerprint)
        throw Error('关系结构或权限已变化，请先核对并处理原草稿');
      this.snapshots.delete(key);
      const capabilities = result.truncated ? noWrites : result.relation.capabilities;
      const now = Date.now();
      for (const [id, value] of this.snapshots) if (value.current.expires <= now) this.snapshots.delete(id);
      if (this.snapshots.size >= 128) throw Error('PostgreSQL表页快照已满，请关闭空闲表标签');
      const exportToken = randomUUID();
      const writeEligible = Object.values(capabilities).some(Boolean);
      const { owner, tabId, connectionRevision, connectionId, database, table, filter, sort } = input;
      for (const snapshot of retained.values()) snapshot.preview = undefined;
      const current: Snapshot = {
        token: exportToken, scope: { owner, tabId, connectionRevision, connectionId, database, table },
        expires: now + 30 * 60 * 1000, relation: retained.values().next().value?.relation ?? result.relation,
        rows: result.originals, options: { filter, sort }, writeEligible,
      };
      this.snapshots.set(key, { current, retained });
      return {
        columns: result.relation.columns, rows: result.rows, hasNext: result.hasNext, truncated: result.truncated,
        order: result.relation.keys.length ? 'primary' : ['r','p'].includes(result.relation.kind) ? 'physical' : 'unstable',
        relationKind: result.relation.kind, capabilities, exportToken, ...(writeEligible ? { pageToken: exportToken } : {}),
        ...(writeEligible && result.originals.length ? { rowKeys: result.originals.map(row => row.key) } : {}),
        ...(result.relation.canImport ? { canImport: true as const } : {}),
      };
    } finally { this.active.delete(key); }
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
          const completed = await connection.query('COMMIT', undefined, small());
          if (completed.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen)
            throw Error('PostgreSQL 未确认导入提交');
          receipt = { outcome: 'committed', affected: rows, message: 'PostgreSQL 已提交导入，共 ' + rows + ' 行' };
        } catch (reason) {
          receipt = await this.rollbackWrite(connection, sent, reason);
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
  private snapshot(input: Scoped<PostgresTableReleaseInput>, writing = false, allowRetained = false): Snapshot {
    const group = this.snapshots.get(this.key(input));
    const snapshot = group?.current.token === input.pageToken ? group.current : allowRetained ? group?.retained.get(input.pageToken) : undefined;
    const scope = snapshot?.scope;
    if (!snapshot || !scope || snapshot.token !== input.pageToken || snapshot.expires <= Date.now() ||
        scope.connectionId !== input.connectionId || scope.connectionRevision !== input.connectionRevision ||
        scope.database !== input.database || scope.table !== input.table) throw Error('PostgreSQL表页快照已过期或来源变化，请刷新');
    if (writing && !snapshot.writeEligible) throw Error('原表页没有记录修改能力，请刷新');
    return snapshot;
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

  /** 预览只签发服务端构建的语句，不执行写入或读取渲染器提供的SQL。 */
  preview(input: Scoped<PostgresTablePreviewInput>): PostgresTablePreview {
    if (this.active.has(this.key(input))) throw Error('当前PostgreSQL表页仍有在途操作');
    const snapshot = this.snapshot(input), relation = snapshot.relation;
    const counts = { insert: 0, update: 0, delete: 0 };
    const sources = new Map<string, Snapshot>();
    const keys = new Set<string>(), tids = new Set<string>();
    const writes: Write[] = input.changes.map(change => {
      const pageToken = change.pageToken ?? input.pageToken;
      let source = sources.get(pageToken);
      if (!source) {
        source = this.snapshot({ ...input, pageToken }, true, true);
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
    const token = randomUUID();
    snapshot.preview = { token, expires: Math.min(Date.now() + 5 * 60 * 1000, ...Array.from(sources.values(), source => source.expires)), writes };
    return { previewToken: token, statements: writes.map(write => write.sql), counts };
  }

  /** 提交先锁住关系并复核全部待修改原行，任何一行冲突都回滚整批。 */
  async apply(input: Scoped<PostgresTableApplyInput>, connect: Connect): Promise<PostgresTableOutcome> {
    const key = this.key(input);
    if (this.active.has(key)) throw Error('当前PostgreSQL表页仍有在途操作');
    const snapshot = this.snapshot(input), preview = snapshot.preview;
    if (!preview || preview.token !== input.previewToken || preview.expires <= Date.now()) throw Error('PostgreSQL提交预览已失效');
    this.snapshots.delete(key);
    this.active.add(key);
    let receipt: PostgresTableOutcome | undefined;
    try {
      await connect(async connection => {
        receipt = await this.applyTransaction(connection, snapshot.relation, input.table, preview.writes);
      }, true);
      return receipt!;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (receipt) return { ...receipt, message: receipt.message + '；连接收尾异常：' + message };
      return { outcome: 'notSent', affected: 0, message };
    } finally { this.active.delete(key); }
  }

  /** 提交回执以实际命令标签及空闲状态为准，断线时保留未知终态。 */
  private async applyTransaction(connection: PostgresConnection, expected: Relation, table: string, writes: Write[]): Promise<PostgresTableOutcome> {
    let sent = false;
    try {
      await begin(connection);
      const current = await readRelation(connection, table);
      if (current.fingerprint !== expected.fingerprint || current.sql !== expected.sql) throw Error('关系结构或权限已变化，请重新读取');
      await connection.query('LOCK TABLE ' + only(current) + ' IN ROW EXCLUSIVE MODE', undefined, small());
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
      for (const write of writes) {
        sent = true;
        const result = await connection.query(write.sql, write.values, small());
        if (result.postgresCommand !== write.kind.toUpperCase() || result.affectedRows !== 1) throw Error('数据库未确认该语句恰好影响一行');
      }
      const result = await connection.query('COMMIT', undefined, small());
      if (result.postgresCommand !== 'COMMIT' || !connection.state().transactionKnown || connection.state().transactionOpen) {
        throw Error('PostgreSQL未确认提交');
      }
      return { outcome: 'committed', affected: writes.length, message: 'PostgreSQL已确认整批提交' };
    } catch (reason) {
      return this.rollbackWrite(connection, sent, reason);
    }
  }

  /** 只依据原连接的事务状态及 ROLLBACK 回执区分已回滚和待核对。 */
  private async rollbackWrite(connection: PostgresConnection, sent: boolean, reason: unknown): Promise<PostgresTableOutcome> {
    const message = connection.error(reason).message;
    if (!sent) return { outcome: 'notSent', affected: 0, message };
    if (!connection.state().transactionKnown) return { outcome: 'unknown', affected: 0, message: '提交状态待核对：' + message };
    try {
      if (connection.state().transactionOpen) {
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
    return [...new Set([...this.snapshots.values()].map(group => group.current.scope.connectionId))];
  }

  /** 断开或修改传输配置后撤销该连接的全部待提交预览。 */
  clear(connectionId: string): void {
    for (const [key, group] of this.snapshots) if (group.current.scope.connectionId === connectionId) this.snapshots.delete(key);
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
