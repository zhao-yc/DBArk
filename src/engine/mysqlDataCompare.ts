import { randomUUID } from 'node:crypto';
import type { TaskEvent } from '../shared/contracts';
import { mysqlDataCompareSchema, mysqlDataCompareZh as text, mysqlDataSyncZh } from '../shared/mysqlDataCompare';
import { postgresDataCompareLimits as limits, postgresDataSyncLimits as syncLimits,
  postgresDataSyncPreviewSchema, postgresDataSyncApplySchema, type PostgresDataSyncPreview, type PostgresDataCompareEndpoint as Endpoint, type PostgresDataCompareInput as Input } from '../shared/postgresDataCompare';
import { execute, type ManagedConnection } from './connection';
import { identifier, qualified } from './sql';
import { compareTableData, type TableDataSnapshot } from './tableDataDifferences';
import { applyMysqlDataSync, mysqlSyncSupported, readMysqlSyncTarget, type MysqlSyncContext, type MysqlSyncEvidence, type MysqlSyncRow, type MysqlSyncTarget } from './mysqlDataSync';

interface QueryContext {
  managed: ManagedConnection;
  checkCancelled(): void;
  commandStarted(): () => void;
}
type Context = MysqlSyncContext;
type Scope = { owner: string; connectionRevision: number };
interface SyncRecord extends Scope {
  id: string; expires: number; source: Endpoint; target: Endpoint; evidence: MysqlSyncEvidence;
  preview?: { report: PostgresDataSyncPreview; rows: MysqlSyncRow[] };
}
interface Work {
  input: Input; childId?: string; stop?: Promise<void>; cancelled: boolean; timedOut: boolean; done: Promise<void>;
}
interface Host {
  run<T>(connectionId: string, taskId: string, action: (context: Context) => Promise<T>, write?: { target: Endpoint; commitProtected(): boolean }): Promise<T>;
  cancel(taskId: string): Promise<void>;
}
const scope = ' WHERE BINARY TABLE_SCHEMA = BINARY ? AND BINARY TABLE_NAME = BINARY ?';

async function query<T = Record<string, unknown>[]>(context: QueryContext, sql: string, params: string[] = []) {
  const end = context.commandStarted();
  try { const result = await execute<T>(context.managed, sql, params); context.checkCancelled(); return result.rows; }
  finally { end(); }
}

export async function mysqlCompareCatalogue(context: QueryContext, database?: string): Promise<string[]> {
  const rows = database
    ? await query<{ name: string }[]>(context, `SELECT t.TABLE_NAME AS name FROM information_schema.TABLES t
      WHERE BINARY t.TABLE_SCHEMA = BINARY ? AND t.TABLE_TYPE = 'BASE TABLE' AND t.ENGINE = 'InnoDB'
        AND EXISTS (SELECT 1 FROM information_schema.STATISTICS s
          WHERE BINARY s.TABLE_SCHEMA = BINARY t.TABLE_SCHEMA AND BINARY s.TABLE_NAME = BINARY t.TABLE_NAME AND s.INDEX_NAME = 'PRIMARY')
      ORDER BY t.TABLE_NAME LIMIT 10001`, [database])
    : await query<{ name: string }[]>(context, `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA
      WHERE LOWER(SCHEMA_NAME) NOT IN ('mysql','information_schema','performance_schema','sys')
      ORDER BY SCHEMA_NAME LIMIT 10001`);
  if (rows.length > 10000) throw Error('比较目录超过显示预算');
  return rows.map(row => row.name);
}

/** 整数显示宽度不影响值的取值范围。ZEROFILL 仍保留原声明，枚举字面量不改写。 */
function declaration(value: string) {
  return /\bzerofill\b/i.test(value) ? value : value.replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/i, '$1');
}

async function describe(context: Context, target: Endpoint) {
  const params = [target.database, target.table];
  const tables = await query<{ engine: string; kind: string }[]>(context,
    'SELECT ENGINE AS engine, TABLE_TYPE AS kind FROM information_schema.TABLES' + scope, params);
  if (tables.length !== 1 || tables[0].kind !== 'BASE TABLE' || tables[0].engine?.toLowerCase() !== 'innodb')
    throw Error('比较需要两张可读取的 InnoDB 普通表');
  const columns = await query<{ name: string; type: string; dataType: string }[]>(context,
    'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, DATA_TYPE AS dataType FROM information_schema.COLUMNS' +
    scope + ' ORDER BY BINARY COLUMN_NAME LIMIT 1025', params);
  const keys = await query<{ name: string; prefix: string | null }[]>(context,
    'SELECT COLUMN_NAME AS name, SUB_PART AS prefix FROM information_schema.STATISTICS' + scope +
    " AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX LIMIT 1025", params);
  if (!columns.length || columns.length > 1024 || !keys.length || keys.some(key => key.prefix !== null || !columns.some(col => col.name === key.name)))
    throw Error('两侧须有可完整读取的列和非前缀主键');
  return { columns, keys: keys.map(key => key.name) };
}

/** 先验目录，实际读取持有元数据锁，再复核原目录，防止混入并发 DDL。 */
async function readTable(context: Context, target: Endpoint, filter: Input['filter']): Promise<TableDataSnapshot> {
  const before = await describe(context, target);
  const geometry = /^(?:geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection)$/i;
  const projection = before.columns.map(({ name, dataType }) => {
    const field = identifier(name);
    return geometry.test(dataType) ? 'CAST(' + field + ' AS BINARY) AS ' + field : field;
  });
  const params: string[] = [];
  let where = '';
  if (filter?.text) {
    const column = before.columns.find(column => column.name === filter.column);
    if (!column) throw Error('两侧表均须存在筛选列');
    where = ' WHERE LOCATE(CAST(? AS BINARY), CAST(CONVERT(' + identifier(column.name) + ' USING utf8mb4) AS BINARY)) > 0';
    params.push(filter.text);
  }
  const sql = 'SELECT ' + projection.join(', ') + ' FROM ' + qualified(target.database, target.table) + where + ' LIMIT ' + (limits.rows + 1);
  const end = context.commandStarted();
  let page: Awaited<ReturnType<Context['page']>>;
  try { page = await context.page(sql, params); }
  finally { end(); }
  context.checkCancelled();
  if (page.hasMore) throw Error('MySQL／MariaDB 比较超过每侧 10,000 行，请缩小筛选范围');
  const after = await describe(context, target);
  if (JSON.stringify(before) !== JSON.stringify(after) || page.columns.length !== before.columns.length ||
      page.columns.some((column, index) => column.name !== before.columns[index].name)) throw Error('读取期间表结构已变化，请重新比较');
  return { keys: before.keys, columns: before.columns.map(({ name, type }) => ({ name, type: declaration(type) })),
    rows: page.rows.map(row => before.columns.map(column => row[column.name])) };
}

/** 每个配置使用独占读连接。同一配置的两库可共享一个 InnoDB 读视图。 */
export class MysqlDataCompareTasks {
  private sync?: SyncRecord;
  private readonly active = new Map<string, Work>();
  constructor(private readonly host: Host, private readonly emit: (event: TaskEvent) => void) {}
  has(id: string) { return this.active.has(id); }

  async compare(raw: Input, scope?: Scope) {
    const input = mysqlDataCompareSchema.parse(raw);
    if (this.active.has(input.taskId) || this.active.size >= 4) throw Error('MySQL／MariaDB 比较任务繁忙或编号重复');
    let finish!: () => void;
    const work: Work = { input, cancelled: false, timedOut: false, done: new Promise<void>(resolve => { finish = resolve; }) };
    this.sync = undefined;
    this.active.set(input.taskId, work);
    let metadata: MysqlSyncTarget | undefined;
    const check = () => { if (work.cancelled) throw Error(work.timedOut ? text.timeout : text.cancelled); };
    const read = async (targets: Endpoint[]) => {
      check();
      work.childId = randomUUID();
      try {
        return await this.host.run(targets[0].connectionId, work.childId, async context => {
          await query(context, "SET SESSION time_zone = '+00:00'");
          await query(context, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          await query(context, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
          const snapshots: TableDataSnapshot[] = [];
          for (const target of targets) {
            check();
            const snapshot = await readTable(context, target, input.filter);
            snapshots.push(snapshot);
            if (scope && target === input.target && !input.filter?.text) {
              // 无法证明写入权限或结构时仍保留只读比较。取消不得从这个分支降级成成功。
              try {
                const candidate = await readMysqlSyncTarget(context, target);
                if (mysqlSyncSupported(candidate.source, snapshot.columns.map(column => column.name), snapshot.keys)) metadata = candidate;
              } catch { context.checkCancelled(); }
            }
          }
          await query(context, 'COMMIT');
          return snapshots;
        });
      } finally { work.childId = undefined; }
    };
    const timer = setTimeout(() => {
      work.timedOut = true;
      void this.cancel(input.taskId).catch(() => undefined);
    }, limits.timeoutMs);
    timer.unref();
    try {
      this.emit({ taskId: input.taskId, status: 'running', progress: 0, message: text.running });
      const shared = input.source.connectionId === input.target.connectionId;
      const [left, right] = shared ? await read([input.source, input.target]) :
        [(await read([input.source]))[0], (await read([input.target]))[0]];
      check();
      const rows: MysqlSyncRow[] = [];
      const result = compareTableData(left, right, shared, 'MySQL／MariaDB',
        metadata ? (after, before) => { rows.push({ before, after }); } : undefined);
      if (!scope || !metadata || !rows.length) return result;
      const id = randomUUID();
      this.sync = { ...scope, id, expires: Date.now() + syncLimits.lifetimeMs, source: input.source, target: input.target,
        evidence: { metadata, columns: right.columns.map(column => column.name), rows } };
      setTimeout(() => { if (this.sync?.id === id) this.sync = undefined; }, syncLimits.lifetimeMs).unref();
      return { ...result, syncSnapshotId: id };
    } catch (reason) {
      await work.stop;
      check();
      throw reason;
    } finally { clearTimeout(timer); this.active.delete(input.taskId); finish(); }
  }

  private requireSync(scope: Scope, id: string) {
    const record = this.sync;
    if (!record || record.id !== id || record.owner !== scope.owner || record.connectionRevision !== scope.connectionRevision ||
        record.expires <= Date.now() || this.active.size) throw Error(mysqlDataSyncZh.stale);
    return record;
  }

  preview(raw: unknown, scope: Scope): PostgresDataSyncPreview {
    const input = postgresDataSyncPreviewSchema.parse(raw), record = this.requireSync(scope, input.snapshotId);
    record.preview = undefined;
    const rows = input.selected.map(index => record.evidence.rows[index]);
    if (rows.some(row => !row) || Buffer.byteLength(JSON.stringify(rows)) > syncLimits.bytes)
      throw Error('同步选择无效或超过 1 MiB，请减少所选行');
    const counts = { insert: 0, update: 0, delete: 0 };
    for (const row of rows) counts[!row.before ? 'insert' : !row.after ? 'delete' : 'update']++;
    const report = { previewId: randomUUID(), confirmation: qualified(record.target.database, record.target.table), counts };
    record.preview = { report, rows };
    return report;
  }

  /** 只领取一次原预览。任务登记保护提交边界，连接断开等待实际事务终态。 */
  async apply(raw: unknown, scope: Scope, target: Endpoint) {
    const input = postgresDataSyncApplySchema.parse(raw), record = this.requireSync(scope, input.snapshotId);
    const preview = record.preview;
    if (!preview || preview.report.previewId !== input.previewId || preview.report.confirmation !== input.confirmation ||
        JSON.stringify(record.target) !== JSON.stringify(target)) throw Error(mysqlDataSyncZh.stale);
    this.sync = undefined;
    let committing = false, receipt: Awaited<ReturnType<typeof applyMysqlDataSync>> | undefined;
    try {
      await this.host.run(target.connectionId, input.taskId, async context => {
        receipt = await applyMysqlDataSync(context, target, record.evidence, preview.rows, () => { committing = true; });
      }, { target, commitProtected: () => committing });
      return receipt!;
    } catch (reason) {
      if (receipt) return { ...receipt, message: receipt.message + '，连接收尾异常，请核对资源' };
      throw reason;
    }
  }

  async cancel(id: string) {
    const work = this.active.get(id);
    if (!work) return;
    work.cancelled = true;
    if (work.childId) work.stop ??= this.host.cancel(work.childId);
    try { await work.stop; }
    finally { await work.done; }
  }

  async close(connectionId?: string) {
    if (!connectionId || this.sync && [this.sync.source.connectionId, this.sync.target.connectionId].includes(connectionId)) this.sync = undefined;
    const results = await Promise.allSettled([...this.active].filter(([, work]) => !connectionId ||
      [work.input.source.connectionId, work.input.target.connectionId].includes(connectionId)).map(([id]) => this.cancel(id)));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
}
