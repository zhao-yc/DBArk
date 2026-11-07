import type { SqliteSyncEvidence } from './sqliteDataSync';
import { compareSqliteTables } from './sqliteDataCompare';
import { sqliteDataCompareSchema, type SqliteDataCompareOutput } from '../shared/sqliteDataCompare';
import { parseSqliteTableDraft, type SqliteTableDraftDocument, type SqliteDraftRestored } from '../shared/sqliteTableDraft';
import { sqliteIncomingInputSchema, sqliteIncomingLimits, type SqliteIncomingInput, type SqliteIncomingOutput } from '../shared/sqliteIncoming';
import { readSqliteIncoming } from './sqliteIncoming';
import { randomUUID } from 'node:crypto';
import type { CommandMap, DatabaseObject, SqliteConnectionProfile, TaskEvent } from '../shared/contracts';
import { SqliteDriverError, SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteDriverLimits, type SqliteProcessExit, type SqliteProcessTransport, type SqliteValue } from '../engine/sqlite/protocol';
import { createSqliteProcess } from './sqliteProcess';
import { SqliteQuerySession } from './sqliteQuerySession';
import { readSqliteCompletion } from './sqliteCompletion';
import { readSqliteCatalogDefinition, readSqliteObjectDefinition, sqliteObjectDefinitionDatabase } from './sqliteObjectDefinition';
import { StructureSearchPages, type StructureSearchState } from '../engine/structureSearchPages';
import { structureSearchInputSchema, structureSearchContinueSchema } from '../shared/databaseSearch';
import { DataSearchReferences } from '../engine/dataSearchReferences';
import { DataSearchScans } from '../engine/dataSearchScans';
import { dataSearchInputSchema } from '../shared/dataSearch';
import { dataSearchCatalogueSchema } from '../shared/dataSearchCatalogue';
import { dataSearchRecordReadSchema } from '../shared/dataSearchRecords';
import { readSqliteDataSearchCatalogue, readSqliteDataSearchRecord, sqliteDataSearchSource } from './sqliteDataSearch';
import { readSqliteStructureSearchPage } from './sqliteStructureSearch';
import { objectDefinitionInputSchema, objectDefinitionLimits, objectDefinitionTaskPrefix, type ObjectDefinitionOutput } from '../shared/objectDefinition';
import { sqliteCompletionInputSchema, sqliteCompletionLimits, sqliteCompletionTaskPrefix, type SqliteCompletionOutput } from '../shared/sqliteCompletion';
import { sqliteTablePageSchema, type SqliteTablePage, type SqliteTablePageInput } from '../shared/sqliteTableBrowse';
import { readSqliteTablePage, SqliteTableBrowseCancelled } from './sqliteTableBrowse';
import { readSqliteValueOptions } from './sqliteValueOptions';
import { readSqliteRowCount, readSqliteStatistics } from './sqliteStatistics';
import { sqliteRowCountInputSchema, sqliteStatisticsInputSchema, sqliteStatisticsLimits, type SqliteRowCountInput, type SqliteRowCountOutput, type SqliteStatisticsInput, type SqliteStatisticsOutput } from '../shared/sqliteStatistics';
import { readSqliteRelationships } from './sqliteRelationships';
import { readSqliteReference } from './sqliteReference';
import { sqliteReferenceInputSchema, sqliteReferenceLimits, type SqliteReferenceInput, type SqliteReferenceOutput } from '../shared/sqliteReference';
import { readSqliteSchemaScript } from './sqliteSchemaExport';
import { sqliteSchemaScriptSchema } from '../shared/sqliteSchemaScript';
import { sqliteRelationshipsInputSchema, type SqliteRelationshipsInput, type SqliteRelationshipsOutput } from '../shared/sqliteRelationships';
import { sqliteValueOptionsInputSchema, type SqliteValueOptionsInput, type SqliteValueOptionsOutput } from '../shared/sqliteValueOptions';
import { sqliteTableExportSchema, type SqliteTableExportOutput } from '../shared/sqliteTableExport';
import { SqliteTableExportFile, prepareSqliteTableExport, type SqliteTableExportRequest } from './sqliteTableExport';
import type { AtomicFileIO } from '../engine/atomicFile';
import { SqliteTableEdits, applySqliteTableEdit, sqliteEditNotSent, type SqliteEditApplyRequest, type SqliteEditClaim } from './sqliteTableEdit';
import type { SqliteTableEditOutcome } from '../shared/sqliteTableEdit';
import { sqliteTableCreatePreviewSchema, sqliteTableCreateApplySchema, sqliteTableCreateReleaseSchema, type SqliteTableCreatePreviewOutput, type SqliteTableCreateOutcome } from '../shared/sqliteTableCreate';
import { SqliteTableCreates, prepareSqliteCreateSnapshot, applySqliteTableCreate, sqliteCreateNotSent, type SqliteTableCreatePreviewRequest, type SqliteTableCreateApplyRequest, type SqliteCreateClaim, type SqliteCreateSnapshot } from './sqliteTableCreate';
import { sqliteTableImportInspectSchema, sqliteTableImportPreviewSchema, sqliteTableImportApplySchema, sqliteTableImportReleaseSchema, sqliteTableImportMessages as importText, type SqliteTableImportInspectOutput, type SqliteTableImportPreviewOutput, type SqliteTableImportOutcome } from '../shared/sqliteTableImport';
import { SqliteTableImports, assertSqliteImportSource, readSqliteImportTarget, verifySqliteImportTarget, inspectSqliteImportFile, previewSqliteImport, applySqliteImport, sqliteImportNotSent, type SqliteImportInspection, type SqliteTableImportInspectRequest, type SqliteTableImportPreviewRequest, type SqliteTableImportApplyRequest, type SqliteTableImportControl } from './sqliteTableImport';
import { sqliteImportSourceInspectSchema, sqliteImportSourceReleaseSchema, sqliteImportSourceMessages, type SqliteImportSourceInspectOutput } from '../shared/sqliteImportSource';
import { SqliteImportSources, inspectSqliteImportSource, type SqliteImportSourceRequest } from './sqliteImportSource';
import { sqliteIndexesInspectSchema, sqliteIndexesPreviewSchema, sqliteIndexesApplySchema, sqliteIndexesReleaseSchema, sqliteIndexesMessages, type SqliteIndexesInspectOutput, type SqliteIndexesPreviewOutput, type SqliteIndexesOutcome } from '../shared/sqliteIndexes';
import { SqliteIndexes, inspectSqliteIndexes, verifySqliteIndexes, applySqliteIndexes, sqliteIndexesNotSent, type SqliteIndexesInspectRequest, type SqliteIndexesPreviewRequest, type SqliteIndexesApplyRequest } from './sqliteIndexes';
import { sqliteColumnsInspectSchema, sqliteColumnsPreviewSchema, sqliteColumnsApplySchema, sqliteColumnsReleaseSchema, sqliteColumnsMessages, type SqliteColumnsInspectOutput, type SqliteColumnsPreviewOutput, type SqliteColumnsOutcome } from '../shared/sqliteColumns';
import { sqliteTableRebuildInspectSchema, sqliteTableRebuildPreviewSchema, sqliteTableRebuildApplySchema, sqliteTableRebuildReleaseSchema, sqliteTableRebuildMessages, type SqliteTableRebuildInspectOutput, type SqliteTableRebuildPreviewOutput, type SqliteTableRebuildOutcome } from '../shared/sqliteTableRebuild';
import { SqliteTableRebuild, inspectSqliteTableRebuild, verifySqliteTableRebuild, applySqliteTableRebuild, sqliteTableRebuildNotSent, type SqliteTableRebuildInspectRequest, type SqliteTableRebuildPreviewRequest, type SqliteTableRebuildApplyRequest } from './sqliteTableRebuild';
import { SqliteColumns, inspectSqliteColumns, verifySqliteColumns, applySqliteColumns, sqliteColumnsNotSent, type SqliteColumnsInspectRequest, type SqliteColumnsPreviewRequest, type SqliteColumnsApplyRequest } from './sqliteColumns';
import { sqliteTableRenameInspectSchema, sqliteTableRenamePreviewSchema, sqliteTableRenameApplySchema, sqliteTableRenameReleaseSchema, sqliteTableRenameMessages, type SqliteTableRenameInspectOutput, type SqliteTableRenamePreviewOutput, type SqliteTableRenameOutcome } from '../shared/sqliteTableRename';
import { SqliteTableRenames, inspectSqliteTableRename, verifySqliteTableRename, applySqliteTableRename, sqliteTableRenameNotSent, type SqliteTableRenameInspectRequest, type SqliteTableRenamePreviewRequest, type SqliteTableRenameApplyRequest } from './sqliteTableRename';
import { sqliteTableMaintenanceInspectSchema, sqliteTableMaintenancePreviewSchema, sqliteTableMaintenanceApplySchema, sqliteTableMaintenanceReleaseSchema, sqliteTableMaintenanceMessages, type SqliteTableMaintenanceInspectOutput, type SqliteTableMaintenancePreviewOutput, type SqliteTableMaintenanceOutcome } from '../shared/sqliteTableMaintenance';
import { SqliteTableMaintenance, inspectSqliteTableMaintenance, verifySqliteTableMaintenance, applySqliteTableMaintenance, sqliteTableMaintenanceNotSent, type SqliteTableMaintenanceInspectRequest, type SqliteTableMaintenancePreviewRequest, type SqliteTableMaintenanceApplyRequest } from './sqliteTableMaintenance';
import { sqliteObjectsInspectSchema, sqliteObjectsPreviewSchema, sqliteObjectsApplySchema, sqliteObjectsReleaseSchema, sqliteObjectsMessages, type SqliteObjectsInspectOutput, type SqliteObjectsPreviewOutput, type SqliteObjectsOutcome } from '../shared/sqliteObjects';
import { SqliteObjects, inspectSqliteObjects, verifySqliteObjects, applySqliteObjects, sqliteObjectsNotSent, type SqliteObjectsInspectRequest, type SqliteObjectsPreviewRequest, type SqliteObjectsApplyRequest } from './sqliteObjects';

/** SQLite文件导入独立并发上限；原任务settled之后才归还槽位。 */
const sqliteImportConcurrency = 2;
type SqliteImportResult = SqliteTableImportInspectOutput | SqliteTableImportPreviewOutput | SqliteTableImportOutcome | SqliteImportSourceInspectOutput;
/** 用真实结果字段窄化，不以阶段字符串把任意泛型结果强转成写入事实。 */
function importOutcome(value: SqliteImportResult | undefined): SqliteTableImportOutcome | undefined { return value && 'outcome' in value ? value : undefined; }
type SqliteIndexesResult = SqliteIndexesInspectOutput | SqliteIndexesPreviewOutput | SqliteIndexesOutcome;
function indexesOutcome(value: SqliteIndexesResult | undefined): SqliteIndexesOutcome | undefined { return value && 'outcome' in value ? value : undefined; }
type SqliteTableRebuildResult = SqliteTableRebuildInspectOutput | SqliteTableRebuildPreviewOutput | SqliteTableRebuildOutcome;
function rebuildOutcome(value: SqliteTableRebuildResult | undefined): SqliteTableRebuildOutcome | undefined { return value && 'outcome' in value ? value : undefined; }
type SqliteColumnsResult = SqliteColumnsInspectOutput | SqliteColumnsPreviewOutput | SqliteColumnsOutcome;
function columnsOutcome(value: SqliteColumnsResult | undefined): SqliteColumnsOutcome | undefined { return value && 'outcome' in value ? value : undefined; }

type SqliteTableRenameResult = SqliteTableRenameInspectOutput | SqliteTableRenamePreviewOutput | SqliteTableRenameOutcome;
function tableRenameOutcome(value: SqliteTableRenameResult | undefined): SqliteTableRenameOutcome | undefined { return value && 'outcome' in value ? value : undefined; }

type SqliteTableMaintenanceResult = SqliteTableMaintenanceInspectOutput | SqliteTableMaintenancePreviewOutput | SqliteTableMaintenanceOutcome;
function maintenanceOutcome(value: SqliteTableMaintenanceResult | undefined): SqliteTableMaintenanceOutcome | undefined { return value && 'outcome' in value ? value : undefined; }

type SqliteObjectsResult = SqliteObjectsInspectOutput | SqliteObjectsPreviewOutput | SqliteObjectsOutcome;
function objectsOutcome(value: SqliteObjectsResult | undefined): SqliteObjectsOutcome | undefined { return value && 'outcome' in value ? value : undefined; }

interface Resource { transport: SqliteProcessTransport; driver?: SqliteDriverSession; }
interface Connection {
  id: string; profile?: SqliteConnectionProfile; closing: boolean; blocked: boolean; failure?: unknown;
  pending: Set<Promise<unknown>>; resources: Set<Resource>; files: Set<SqliteTableExportFile>; closeWork?: Promise<void>;
}
interface Session {
  connection: Connection; profile: SqliteConnectionProfile; query: SqliteQuerySession; driver: SqliteDriverSession;
  pending?: Promise<unknown>; closing: boolean; closeWork?: Promise<void>; userHandoff?: { work?: Promise<unknown> };
}
interface QueryTask { kind: 'query'; session: Session; active?: Promise<unknown>; preparing?: boolean; cancelled?: boolean; }
interface DraftRestoreInput { connectionId: string; taskId: string; draft: SqliteTableDraftDocument; }
interface BrowseTask {
  assertCurrent?(): void;
  purpose?: 'relationships' | 'statistics' | 'reference' | 'incoming';
  kind: 'browse'; connection: Connection; cancelled: boolean; boundaryCancelled: boolean; cleaning: boolean;
  resource?: Resource; driver?: SqliteDriverSession; active?: Promise<unknown>; cancelWork?: Promise<void>;
  cleanupFailure?: unknown; cancelFailure?: unknown;
}
interface FinishedBrowseTask { kind: 'browse-finished'; active?: undefined; }
interface CompletionTask extends BrowseTask { session?: Session; abortRead?: AbortController; dataSearch?: true; }
interface ExportTask extends Omit<BrowseTask, 'kind'> {
  kind: 'export'; input: SqliteTableExportRequest; file?: SqliteTableExportFile;
  committing: boolean; retainedDestination: boolean; rows: number;
}
interface FinishedExportTask { kind: 'export-finished'; active?: undefined; }
interface EditTask extends Omit<BrowseTask, 'kind'> { kind: 'edit'; committing: boolean; input: SqliteEditApplyRequest; claim: SqliteEditClaim; }
interface FinishedEditTask { kind: 'edit-finished' | 'edit-preview-finished'; active?: undefined; }
interface CreateAttachment { connection: Connection; profile: SqliteConnectionProfile; }
interface CreatePreviewTask extends Omit<BrowseTask, 'kind'> { kind: 'create-preview'; input: SqliteTableCreatePreviewRequest; exit?: SqliteProcessExit; attachment?: CreateAttachment; }
interface CreateTask extends Omit<BrowseTask, 'kind'> { kind: 'create'; input: SqliteTableCreateApplyRequest; claim: SqliteCreateClaim; committing: boolean; exit?: SqliteProcessExit; attachment?: CreateAttachment; }
interface FinishedCreateTask { kind: 'create-finished' | 'create-preview-finished'; active?: undefined; }
interface ImportTask extends Omit<BrowseTask, 'kind'> { kind: 'import'; input: { taskId: string; assertCurrent(): void }; committing: boolean; abort: AbortController; exit?: SqliteProcessExit; }
interface FinishedImportTask { kind: 'import-finished'; active?: undefined; }
interface IndexesTask extends Omit<ImportTask, 'kind'> { kind: 'indexes'; }
interface FinishedIndexesTask { kind: 'indexes-finished'; active?: undefined; }
interface RebuildTask extends Omit<ImportTask, 'kind'> { kind: 'rebuild'; }
interface FinishedRebuildTask { kind: 'rebuild-finished'; active?: undefined; }
interface ColumnsTask extends Omit<ImportTask, 'kind'> { kind: 'columns'; }
interface FinishedColumnsTask { kind: 'columns-finished'; active?: undefined; }
interface TableRenameTask extends Omit<ImportTask, 'kind'> { kind: 'table-rename'; }
interface FinishedTableRenameTask { kind: 'table-rename-finished'; active?: undefined; }
interface MaintenanceTask extends Omit<ImportTask, 'kind'> { kind: 'maintenance'; }
interface FinishedMaintenanceTask { kind: 'maintenance-finished'; active?: undefined; }
interface ObjectsTask extends Omit<ImportTask, 'kind'> { kind: 'objects'; }
interface FinishedObjectsTask { kind: 'objects-finished'; active?: undefined; }
type ReadTask = RebuildTask | BrowseTask | ExportTask | EditTask | CreatePreviewTask | CreateTask | ImportTask | IndexesTask | ColumnsTask | TableRenameTask | MaintenanceTask | ObjectsTask;
type Task = RebuildTask | FinishedRebuildTask | QueryTask | BrowseTask | FinishedBrowseTask | ExportTask | FinishedExportTask | EditTask | FinishedEditTask | CreatePreviewTask | CreateTask | FinishedCreateTask | ImportTask | FinishedImportTask | IndexesTask | FinishedIndexesTask | ColumnsTask | FinishedColumnsTask | TableRenameTask | FinishedTableRenameTask | MaintenanceTask | FinishedMaintenanceTask | ObjectsTask | FinishedObjectsTask;
/** 所有独立utility任务共用原连接取消/关闭账本，不因新增建表另建孤岛。 */
function readTask(task: Task): task is ReadTask { return ['rebuild', 'browse', 'export', 'edit', 'create-preview', 'create', 'import', 'indexes', 'columns', 'table-rename', 'maintenance', 'objects'].includes(task.kind); }
function committing(task: ReadTask): boolean { return 'committing' in task && task.committing; }
export interface SqliteRuntimeOptions {
  emit: (event: TaskEvent) => void;
  resolveProfile: (id: string) => SqliteConnectionProfile | undefined;
  createTransport?: () => SqliteProcessTransport;
  /** 仅内核测试注入真实短写/失败IO及更小文件预算，渲染IPC不接受。 */
  tableExport?: { io?: AtomicFileIO; maxBytes?: number };
}

/** 显示字段和临时选择令牌不影响物理目标；路径、只读属性及锁等待设置均属于连接身份。 */
function sameTarget(left: SqliteConnectionProfile, right: unknown): boolean {
  const next = right as SqliteConnectionProfile | undefined;
  return next?.dialect === 'sqlite' && left.id === next.id && left.sqlite.filePath === next.sqlite?.filePath
    && left.sqlite.readOnly === next.sqlite.readOnly && left.sqlite.busyTimeoutMs === next.sqlite.busyTimeoutMs;
}
/** 多项收尾必须全部尝试，最后保留每一个准确失败原因。 */
function failures(results: PromiseSettledResult<unknown>[], message: string): void {
  const reasons = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
  if (reasons.length) throw new AggregateError(reasons, message);
}

/** 原工作区的SQLite路由终点；不实例化网络引擎，不重连或重放任何用户SQL。 */
export class SqliteRuntime {
  private readonly connections = new Map<string, Connection>();
  private readonly sessions = new Map<string, Session>();
  private readonly tasks = new Map<string, Task>();
  private readonly completionReads = new Map<string, CompletionTask>();
  private readonly structureSearches = new StructureSearchPages();
  private readonly dataSearchReferences = new DataSearchReferences();
  private readonly dataSearchScans = new DataSearchScans(event => this.options.emit(event), undefined, this.dataSearchReferences);
  private readonly definitionReads = new Map<string, CompletionTask>();
  private stopping = false;
  private closeWork?: Promise<void>;
  private forceWork?: Promise<void>;
  private readonly edits = new SqliteTableEdits();
  private readonly creates = new SqliteTableCreates();
  private readonly imports = new SqliteTableImports();
  private readonly importSources = new SqliteImportSources();
  private readonly indexes = new SqliteIndexes();
  private readonly columns = new SqliteColumns();
  private readonly rebuilds = new SqliteTableRebuild();
  private readonly objects = new SqliteObjects();
  private readonly tableMaintenance = new SqliteTableMaintenance();
  private readonly tableRenames = new SqliteTableRenames();
  private importsActive = 0;

  constructor(private readonly options: SqliteRuntimeOptions) {}

  /** 命名空间归属永久有效，迟到或未知的SQLite编号也不能进入mysql2。 */
  ownsSession(id: string): boolean { return typeof id === 'string' && id.startsWith('sqlite:'); }
  /** 历史任务编号仍属于原路由，旧取消不会影响下一项任务。 */
  ownsTask(id: string): boolean { return this.tasks.has(id) || this.definitionReads.has(id) || typeof id === 'string' && id.startsWith(sqliteCompletionTaskPrefix); }
  /** 已知、打开中及关闭失败的连接均保留在本路由。 */
  ownsConnection(id: string): boolean { return this.connections.has(id); }

  /** Main已完成路径授权；这里仍检查配置形状，不接受内存库、缺失路径或其它方言。 */
  private profile(value: unknown, id?: string): SqliteConnectionProfile {
    const profile = value as SqliteConnectionProfile | undefined;
    if (!profile || profile.dialect !== 'sqlite' || !profile.id || id !== undefined && profile.id !== id
      || !profile.sqlite || !profile.sqlite.filePath || profile.sqlite.filePath.includes('\0')
      || profile.pendingFiles?.includes('sqliteDatabase') || typeof profile.sqlite.readOnly !== 'boolean'
      || !Number.isInteger(profile.sqlite.busyTimeoutMs) || profile.sqlite.busyTimeoutMs < 0 || profile.sqlite.busyTimeoutMs > 5000) throw Error('SQLite缺少Main授权的有效数据库文件配置');
    return structuredClone(profile);
  }
  /** 创建连接屏障必须先于异步打开；已开始关闭的连接不能被新请求复活。 */
  private connection(id: string): Connection {
    if (this.stopping) throw Error('SQLite运行时正在退出，不能开始新操作');
    if (typeof id !== 'string' || !id) throw Error('SQLite连接编号无效');
    let connection = this.connections.get(id);
    if (!connection) { connection = { id, closing: false, blocked: false, pending: new Set(), resources: new Set(), files: new Set() }; this.connections.set(id, connection); }
    if (connection.closing || connection.blocked) throw Error('SQLite连接正在关闭或资源尚未确认释放，请先显式断开连接，不能开始新操作', { cause: connection.failure });
    return connection;
  }
  /** 未确认资源永久保留隔离；迟到exit本身不解除，只有显式连接close或forceClose可以解除。 */
  private block(connection: Connection, reason: unknown): void { connection.blocked = true; connection.failure ??= reason; }
  /** 在投递前占用连接，完成后才解除；拒绝不会丢弃仍未退出的transport。 */
  private track<T>(connection: Connection, action: () => Promise<T>): Promise<T> {
    const work = (async () => action())(); connection.pending.add(work);
    void work.then(() => connection.pending.delete(work), () => connection.pending.delete(work)); return work;
  }
  /** 工厂产生的每个准确对象都登记到真实exit，打开失败也不能只清理Promise。 */
  private async driver(connection: Connection, profile: SqliteConnectionProfile, readOnly = profile.sqlite.readOnly, register?: (resource: Resource) => void, rebuild = false, sourcePath?: string, dataSearch = false): Promise<SqliteDriverSession> {
    const owned: { resource?: Resource } = {};
    try {
      const create = () => {
        const transport = (this.options.createTransport ?? createSqliteProcess)();
        const resource: Resource = { transport }; owned.resource = resource; connection.resources.add(resource);
        void transport.exited.then(() => connection.resources.delete(resource), () => {});
        register?.(resource);
        return transport;
      };
      const options = { path: profile.sqlite.filePath!, readOnly, busyTimeoutMs: profile.sqlite.busyTimeoutMs };
      const driver = await (sourcePath ? SqliteDriverSession.openTableCopy(create, options, sourcePath) : rebuild ? SqliteDriverSession.openRebuild(create, options) : dataSearch ? SqliteDriverSession.openDataSearch(create, options) : SqliteDriverSession.open(create, options));
      // 并发open始终绑定各自工厂闭包中的原对象，不能依赖资源集合顺序或PID。
      if (!owned.resource || !connection.resources.has(owned.resource)) {
        await driver.close(); throw new SqliteDriverError('SQLite打开期间准确资源已退出', 'SQLITE_PROCESS_EXIT', null, 0, driver.isClosed);
      }
      owned.resource.driver = driver;
      if (connection.blocked) { await driver.close(); throw Error('SQLite并发打开期间已有资源退出未确认，本次不发布会话'); }
      return driver;
    } catch (reason) { if (owned.resource && connection.resources.has(owned.resource)) this.block(connection, reason); throw reason; }
  }

  /** 短读使用独立driver；关闭确认优先于返回结果，关闭失败保留句柄和失败事实。 */
  private async short<T>(connection: Connection, profile: SqliteConnectionProfile, action: (driver: SqliteDriverSession) => Promise<T>, readOnly = profile.sqlite.readOnly): Promise<T> {
    const driver = await this.driver(connection, profile, readOnly);
    let value!: T, failed = false, failure: unknown;
    try { value = await action(driver); }
    catch (reason) { failed = true; failure = reason; if (!driver.isUsable && !driver.isClosed) this.block(connection, reason); }
    try { await driver.close(); }
    catch (reason) { if (!driver.isClosed) this.block(connection, reason); if (failed) throw new AggregateError([failure, reason], 'SQLite原操作失败且原driver关闭未确认', { cause: failure }); throw reason; }
    if (failed) throw failure; return value;
  }
  /** 只允许main；不把数据库选择翻译成ATTACH或MySQL USE。 */
  private database(database: unknown): void {
    if (database !== undefined && database !== null && database !== 'main') throw Error('SQLite原工作区目前只支持main数据库');
  }
  /** 每次元数据读取重新解析Main可信路径，禁止复用用户事务或渲染传入的profile。 */
  private metadata(input: any, action: (driver: SqliteDriverSession, check: () => void) => Promise<unknown>): Promise<unknown> {
    this.database(input.database);
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
    this.assertTarget(connection, profile);
    const check = () => {
      if (this.stopping || connection.closing || connection.blocked) throw Error('SQLite连接正在关闭或不可用');
      this.assertTarget(connection, this.profile(this.options.resolveProfile(input.connectionId), input.connectionId));
    };
    return this.track(connection, () => this.short(connection, profile, driver => action(driver, check), true));
  }
  /** 两端复用原连接生命周期和短读关闭。仅对本次独占驱动投递取消。 */
  private compareData(raw: unknown, signal: AbortSignal, owner: () => void, capture?: (evidence: SqliteSyncEvidence) => void): Promise<SqliteDataCompareOutput> {
    const input = sqliteDataCompareSchema.parse(raw);
    const watch = async <T>(driver: SqliteDriverSession, action: () => Promise<T>) => {
      const cancel = () => { void driver.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancel, { once: true });
      try { signal.throwIfAborted(); return await action(); }
      finally { signal.removeEventListener('abort', cancel); }
    };
    return this.metadata(input.source, (left, checkLeft) => watch(left, async () => {
      const check = () => { signal.throwIfAborted(); owner(); checkLeft(); };
      check();
      if (input.source.connectionId === input.target.connectionId) return compareSqliteTables(left, left, input, check, capture);
      return this.metadata(input.target, (right, checkRight) => watch(right, () => {
        const a = left.identity, b = right.identity;
        if (!a || !b) throw Error('无法确认 SQLite 两侧的文件身份');
        if (a.device === b.device && a.inode === b.inode) throw Error('两条连接指向同一个 SQLite 文件，请用同一条连接选择两张表');
        return compareSqliteTables(left, right, input, () => { check(); checkRight(); }, capture);
      }));
    })) as Promise<SqliteDataCompareOutput>;
  }
  /** 补全只保留有界活动请求；会话分支串行借用原driver，独立分支只读打开并确认原exit。 */
  private completion(source: unknown): Promise<SqliteCompletionOutput> {
    const input = sqliteCompletionInputSchema.parse(source);
    if (this.completionReads.has(input.taskId) || this.tasks.has(input.taskId) || this.completionReads.size >= sqliteCompletionLimits.active) return Promise.reject(Error('SQLite补全任务编号已使用或读取繁忙'));
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    const session = input.sessionId === undefined ? undefined : this.session(input.sessionId);
    if (session && (session.connection !== connection || session.query.connectionId !== input.connectionId || !sameTarget(session.profile, profile))) return Promise.reject(Error('SQLite补全会话不属于原连接'));
    if (session?.userHandoff || session?.pending || session?.query.completionState().busy) return Promise.reject(Error('SQLite原查询会话已有运行操作'));
    const revision = session?.query.completionState().objectsRevision;
    const task: CompletionTask = { kind: 'browse', connection, session, cancelled: false, boundaryCancelled: false, cleaning: false };
    this.completionReads.set(input.taskId, task);
    const check = () => {
      this.browseCheck(task);
      if (!sameTarget(profile, this.options.resolveProfile(profile.id)) || session?.closing || session && session.query.completionState().objectsRevision !== revision) throw Error('SQLite补全原连接或会话目录已失效');
    };
    const action = async () => {
      if (session) { check(); return readSqliteCompletion(session.driver, input, { check, sessionRevision: revision }); }
      let value: SqliteCompletionOutput | undefined, failed = false, failure: unknown;
      try { check(); task.driver = await this.driver(connection, profile, true, resource => { task.resource = resource; }); check(); value = await readSqliteCompletion(task.driver, input, { check }); }
      catch (reason) { failed = true; failure = reason; if (task.driver && !task.driver.isUsable && !task.driver.isClosed) this.block(connection, reason); }
      if (task.driver) {
        task.cleaning = true;
        try { await task.driver.close(); }
        catch (reason) { task.cleanupFailure = reason; if (!task.driver.isClosed) this.block(connection, reason); failure = failed ? new AggregateError([failure, reason], 'SQLite补全读取失败且原资源关闭未确认') : reason; failed = true; }
      }
      if (task.resource && connection.resources.has(task.resource)) { task.cleanupFailure = Error('SQLite补全准确进程exit尚未确认'); this.block(connection, task.cleanupFailure); failure = task.cleanupFailure; failed = true; }
      if (failed) throw failure; check(); return value!;
    };
    const work = session ? this.sessionOperation(session, action) : this.track(connection, action); task.active = work;
    const retire = () => { task.active = undefined; if ((!task.resource || !connection.resources.has(task.resource)) && this.completionReads.get(input.taskId) === task) this.completionReads.delete(input.taskId); };
    void work.then(retire, retire); return work;
  }
  /** 原事务上的补全只登记取消并等待短读边界，不interrupt、kill、rollback或关闭用户会话。 */
  private cancelCompletion(task: CompletionTask): Promise<void> {
    if (!task.session) { const work = this.cancelBrowse(task); task.abortRead?.abort(); return work; }
    task.cancelled = true;
    return task.active?.then(() => {}, () => {}) ?? Promise.resolve();
  }
  /** 对象定义与补全共用原session边界取消；独立只读任务占槽直到准确exit确认。 */
  private objectDefinition(source: unknown): Promise<ObjectDefinitionOutput> {
    const input = objectDefinitionInputSchema.parse(source);
    const database = sqliteObjectDefinitionDatabase(input.database);
    if (!input.sessionId && database === 'temp') return Promise.reject(Error('SQLite临时对象必须从原查询会话读取'));
    if (this.definitionReads.has(input.taskId) || this.completionReads.has(input.taskId) || this.tasks.has(input.taskId) || this.definitionReads.size >= objectDefinitionLimits.active) return Promise.reject(Error('SQLite对象定义任务编号已使用或读取繁忙'));
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    const session = input.sessionId === undefined ? undefined : this.session(input.sessionId);
    if (session && (session.connection !== connection || session.query.connectionId !== input.connectionId || !sameTarget(session.profile, profile))) return Promise.reject(Error('SQLite对象定义会话不属于原连接'));
    if (session && (!session.driver.isUsable || session.userHandoff || session.pending || session.query.completionState().busy)) return Promise.reject(Error('SQLite原查询会话不可用或已有运行操作'));
    const revision = session?.query.completionState().objectsRevision;
    const task: CompletionTask = { kind: 'browse', connection, session, cancelled: false, boundaryCancelled: false, cleaning: false };
    // 借用原资源但不关闭它；若失效且exit未确认，该任务仍占并发槽，直到显式断开连接。
    if (session) task.resource = [...connection.resources].find(resource => resource.driver === session.driver);
    const check = () => {
      this.browseCheck(task);
      if (!sameTarget(profile, this.options.resolveProfile(profile.id)) || session && (session.closing || !session.driver.isUsable || this.sessions.get(input.sessionId!) !== session || session.query.completionState().objectsRevision !== revision)) throw Error('SQLite对象定义原连接或会话目录已失效');
    };
    return this.trackDefinitionRead(input.taskId, task, session
      ? () => { check(); return readSqliteObjectDefinition(session.driver, input, { check, revision }); }
      : () => this.ownedDefinitionRead(task, profile, check, driver => readSqliteObjectDefinition(driver, input, { check })));
  }

  /** 搜索和定义短读共用准确进程退出、取消与故障隔离规则。 */
  private trackDefinitionRead<T>(taskId: string, task: CompletionTask, action: () => Promise<T>): Promise<T> {
    const { connection, session } = task;
    this.definitionReads.set(taskId, task);
    const work = session ? this.sessionOperation(session, action) : this.track(connection, action);
    task.active = work;
    const retire = () => {
      task.active = undefined;
      const safe = session ? session.driver.isUsable || session.driver.isClosed : !task.resource || !connection.resources.has(task.resource);
      if (safe && this.definitionReads.get(taskId) === task) this.definitionReads.delete(taskId);
    };
    void work.then(retire, retire);
    return work;
  }

  private async ownedDefinitionRead<T>(task: CompletionTask, profile: SqliteConnectionProfile, check: () => void,
    action: (driver: SqliteDriverSession) => Promise<T>, dataSearch = false): Promise<T> {
    const { connection } = task;
    let value!: T, failed = false, failure: unknown;
    try {
      check();
      task.driver = await this.driver(connection, profile, true, resource => { task.resource = resource; }, false, undefined, dataSearch);
      check();
      value = await action(task.driver);
    } catch (reason) {
      failed = true; failure = reason;
      if (task.driver && !task.driver.isUsable && !task.driver.isClosed) this.block(connection, reason);
    }
    if (task.driver) {
      task.cleaning = true;
      try { await task.driver.close(); }
      catch (reason) {
        task.cleanupFailure = reason;
        if (!task.driver.isClosed) this.block(connection, reason);
        failure = failed ? new AggregateError([failure, reason], 'SQLite目录读取失败且原资源关闭未确认') : reason;
        failed = true;
      }
    }
    if (task.resource && connection.resources.has(task.resource)) {
      task.cleanupFailure = Error('SQLite目录读取准确进程exit尚未确认');
      this.block(connection, task.cleanupFailure); failure = task.cleanupFailure; failed = true;
    }
    if (failed) throw failure;
    check();
    return value;
  }

  private searchStructure(raw: Record<string, unknown>, next: boolean) {
    const { profile: _profile, ...request } = raw;
    const input = next ? structureSearchContinueSchema.parse(request) : structureSearchInputSchema.parse(request);
    if (this.ownsTask(input.taskId) || this.completionReads.has(input.taskId) || this.definitionReads.size >= objectDefinitionLimits.active)
      throw Error('SQLite 搜索编号已使用或目录读取繁忙');
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId);
    const connection = this.connection(profile.id);
    this.assertTarget(connection, profile);
    const abortRead = new AbortController();
    const task: CompletionTask = { kind: 'browse', connection, cancelled: false, boundaryCancelled: false, cleaning: false, abortRead };
    const check = () => {
      this.browseCheck(task);
      if (!sameTarget(profile, this.options.resolveProfile(profile.id))) throw Error('SQLite 搜索连接已变化，请重新搜索');
    };
    const read = (state: StructureSearchState) => this.trackDefinitionRead(input.taskId, task, () =>
      this.ownedDefinitionRead(task, profile, check, driver => readSqliteStructureSearchPage(driver, state, check, () => { task.cleaning = true; }, abortRead.signal)));
    return next ? this.structureSearches.nextPage(input, 'sqlite', read) : this.structureSearches.startPage(input, 'sqlite', read);
  }

  private searchData(command: 'search.catalogue' | 'search.dataStart' | 'search.recordRead', raw: Record<string, unknown>) {
    const { profile: _profile, ...request } = raw;
    const input = command === 'search.catalogue' ? dataSearchCatalogueSchema.parse(request)
      : command === 'search.dataStart' ? dataSearchInputSchema.parse(request) : dataSearchRecordReadSchema.parse(request);
    if (command !== 'search.recordRead' && (!('dialect' in input) || input.dialect !== 'sqlite'))
      throw Error('搜索方言与保存的 SQLite 连接不匹配');
    if (this.ownsTask(input.taskId) || this.completionReads.has(input.taskId) || this.definitionReads.size >= objectDefinitionLimits.active)
      throw Error('SQLite 搜索编号已使用或读取繁忙');
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId);
    const connection = this.connection(profile.id);
    this.assertTarget(connection, profile);
    const abortRead = new AbortController();
    const task: CompletionTask = { kind: 'browse', connection, cancelled: false, boundaryCancelled: false, cleaning: false, abortRead,
      ...(command === 'search.dataStart' ? { dataSearch: true as const } : {}) };
    const check = () => {
      this.browseCheck(task);
      if (!sameTarget(profile, this.options.resolveProfile(profile.id))) throw Error('SQLite 搜索连接已变化，请重新搜索');
    };
    const control = { check, beginCleanup: () => { task.cleaning = true; }, cleanupFailed: (reason: unknown) => { task.cleanupFailure = reason; } };
    const read = async <T>(action: (driver: SqliteDriverSession, scope: typeof control) => Promise<T>) => {
      try { return await this.ownedDefinitionRead(task, profile, check, driver => action(driver, control), command !== 'search.catalogue'); }
      finally {
        // 只在当前物理文件会话已释放时丢弃句柄。未知退出必须留给原连接收尾。
        if (!task.resource || !connection.resources.has(task.resource)) { task.driver = undefined; task.resource = undefined; task.cleaning = false; }
      }
    };
    if ('targets' in input) return this.dataSearchScans.startScan(input, scan =>
      this.trackDefinitionRead(input.taskId, task, async () => {
        const interrupt = () => this.dataSearchScans.interrupt(input.taskId);
        abortRead.signal.addEventListener('abort', interrupt, { once: true });
        try { await scan(sqliteDataSearchSource(input, this.dataSearchReferences, read, check, () => !!task.cleanupFailure || connection.blocked)); }
        finally { abortRead.signal.removeEventListener('abort', interrupt); }
      }));
    if ('kind' in input) return this.trackDefinitionRead(input.taskId, task, () =>
      read((driver, scope) => readSqliteDataSearchCatalogue(driver, input, scope)));
    const entry = this.dataSearchReferences.lookup(input);
    return this.trackDefinitionRead(input.taskId, task, async () => {
      const result = await read((driver, scope) => readSqliteDataSearchRecord(driver, entry, scope));
      if (this.dataSearchReferences.lookup(input) !== entry) throw Error('SQLite 原搜索引用已变化，请重新搜索');
      return result;
    });
  }

  /** 已有连接身份不能因外部配置变化而静默更换；活动标签持有创建时的完整快照。 */
  private assertTarget(connection: Connection, profile: SqliteConnectionProfile): void {
    if (connection.profile && !sameTarget(connection.profile, profile)) throw Error('SQLite连接配置已变化，请先显式关闭原连接，现有会话未重连');
    connection.profile ??= structuredClone(profile);
  }
  /** 元数据仅执行固定参数化SQL，并对目录大小施加明确上限。 */
  private async rows(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[] = [], maxRows = 10001): Promise<SqliteValue[][]> {
    const rows: SqliteValue[][] = [];
    const result = await driver.execute(sql, { parameters, maxRows, maxBytes: 16 * 1024 * 1024, onBatch: batch => { rows.push(...batch.rows); } });
    if (result.statements.some(statement => statement.truncated)) throw Error('SQLite元数据超过读取预算，请缩小范围');
    return rows;
  }
  /** 会话关闭屏障与连接关闭屏障均先检查，状态查询仍可显示失效事实。 */
  private session(id: string, allowClosing = false): Session {
    const session = this.sessions.get(id);
    if (!session) throw Error('SQLite原查询会话不存在或已经关闭，不会自动重连');
    if (!allowClosing && (this.stopping || session.closing || session.connection.closing || session.connection.blocked)) throw Error('SQLite原查询会话正在关闭或资源尚未确认释放，不能开始新操作', { cause: session.connection.failure });
    return session;
  }
  /** 每个物理会话只有一个操作；在适配器异步进入前也保留忙态屏障。 */
  private sessionOperation<T>(session: Session, action: () => Promise<T>): Promise<T> {
    if (session.pending) return Promise.reject(Error('SQLite原查询会话已有运行操作'));
    const work = this.track(session.connection, async () => {
      try { return await action(); }
      catch (reason) { if (!session.driver.isUsable && !session.driver.isClosed) this.block(session.connection, reason); throw reason; }
    }); session.pending = work;
    void work.then(() => { if (session.pending === work) session.pending = undefined; }, () => { if (session.pending === work) session.pending = undefined; }); return work;
  }
  /** 明确用户动作只接管本会话准确目录短读；其它查询/事务仍立即互斥，不等待或取消别人的SQL。 */
  private userSessionOperation<T>(session: Session, action: () => Promise<T>, check: () => void = () => {}): Promise<T> {
    if (session.userHandoff) return Promise.reject(Error('SQLite原查询会话已有运行操作'));
    const pending = session.pending;
    if (!pending) return this.sessionOperation(session, async () => { check(); return action(); });
    const completion = [...this.completionReads.values(), ...this.definitionReads.values()].find(task => task.session === session && task.active === pending);
    if (!completion) return Promise.reject(Error('SQLite原查询会话已有运行操作'));
    const owner: { work?: Promise<unknown> } = {}, connection = session.connection;
    session.userHandoff = owner; completion.cancelled = true;
    // 先同步占有排他意图，再等待完整短读终态；旧目录ACK先到不能让新目录或另一用户动作抢占。
    const work = this.track(connection, async () => {
      try {
        await pending.catch(() => {});
        if (session.userHandoff !== owner || this.sessions.get(session.query.sessionId) !== session || this.connections.get(connection.id) !== connection || this.stopping || session.closing || connection.closing || connection.blocked || !sameTarget(session.profile, this.options.resolveProfile(connection.id))) throw Error('SQLite原会话交接期间连接已关闭或改变，尚未发送用户SQL');
        check();
        return await this.sessionOperation(session, async () => { check(); return action(); });
      } finally { if (session.userHandoff === owner) session.userHandoff = undefined; }
    });
    owner.work = work; return work;
  }

  /** 新的只读分页任务和查询任务共享编号墓碑，但绝不共享查询会话及其事务。 */
  /** 仅Main私有调用：原文件文档先解析，复用原只读资源账本、准确取消及退出确认，不创建查询会话。 */
  private tableDraftRestore(source: { connectionId: string; taskId: string; draft: SqliteTableDraftDocument; assertCurrent(): void }): Promise<SqliteDraftRestored> {
    const draft = parseSqliteTableDraft(source.draft), input = { connectionId: source.connectionId, taskId: source.taskId, draft };
    if (typeof source.assertCurrent !== 'function' || typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 200 || input.connectionId !== draft.target.connectionId) return Promise.reject(Error('SQLite草稿恢复内部来源无效'));
    source.assertCurrent(); const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
    this.assertTarget(connection, profile); if (this.tasks.has(input.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    const task: BrowseTask = { kind: 'browse', connection, cancelled: false, boundaryCancelled: false, cleaning: false, assertCurrent: source.assertCurrent }; this.tasks.set(input.taskId, task);
    const work = this.track(connection, () => this.browse(task, input, profile)); task.active = work;
    const retire = () => { task.active = undefined; this.retireBrowse(input.taskId, task); }; void work.then(retire, retire); return work;
  }
  private tablePage(source: unknown): Promise<SqliteTablePage> {
    const input = sqliteTablePageSchema.parse(source), profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
    this.assertTarget(connection, profile);
    if (this.tasks.has(input.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    const task: BrowseTask = { kind: 'browse', connection, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const work = this.track(connection, () => this.browse(task, input, profile)); task.active = work;
    const retire = () => { task.active = undefined; this.retireBrowse(input.taskId, task); };
    void work.then(retire, retire); return work;
  }
  /** 不同值读取复用准确只读资源账本及取消屏障，不创建用户查询会话或编辑快照。 */
  private valueOptions(source: unknown): Promise<SqliteValueOptionsOutput> {
    const input = sqliteValueOptionsInputSchema.parse(source), profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
    this.assertTarget(connection, profile); if (this.tasks.has(input.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    const task: BrowseTask = { kind: 'browse', connection, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const work = this.track(connection, () => this.browse(task, input, profile)); task.active = work;
    const retire = () => { task.active = undefined; this.retireBrowse(input.taskId, task); }; void work.then(retire, retire); return work;
  }
  /** 字段概况沿原只读资源账本；准确任务结束且资源退出后才归还并发槽。 */
  private statistics(source: unknown, countRows = false): Promise<SqliteStatisticsOutput | SqliteRowCountOutput> {
    const input = countRows ? sqliteRowCountInputSchema.parse(source) : sqliteStatisticsInputSchema.parse(source);
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
    this.assertTarget(connection, profile);
    if (this.tasks.has(input.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    if ([...this.tasks.values()].filter(task => task.kind === 'browse' && task.purpose === 'statistics').length >= sqliteStatisticsLimits.active) return Promise.reject(Error('SQLite统计任务已达并发上限'));
    const task: BrowseTask = { kind: 'browse', purpose: 'statistics', connection, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const work = this.track(connection, () => this.browse(task, input, profile)); task.active = work;
    const retire = () => { task.active = undefined; this.retireBrowse(input.taskId, task); }; void work.then(retire, retire); return work;
  }
  /** 关系图复用原只读资源账本；排队及退出未确认的任务仍占槽，不借用用户会话。 */
  private relationships(source: unknown): Promise<SqliteRelationshipsOutput> {
    const input = sqliteRelationshipsInputSchema.parse(source), profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
    this.assertTarget(connection, profile);
    if (this.tasks.has(input.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    if ([...this.tasks.values()].filter(task => task.kind === 'browse' && task.purpose === 'relationships').length >= 2) return Promise.reject(Error('SQLite关系图读取任务已达并发上限'));
    const task: BrowseTask = { kind: 'browse', purpose: 'relationships', connection, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const work = this.track(connection, () => this.browse(task, input, profile)); task.active = work;
    const retire = () => { task.active = undefined; this.retireBrowse(input.taskId, task); }; void work.then(retire, retire); return work;
  }
  /** 外键浏览只使用独立只读worker；排队与退出未确认的任务继续占槽。 */
  private reference(source: unknown): Promise<SqliteReferenceOutput> {
    const input = sqliteReferenceInputSchema.parse(source), profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
    this.assertTarget(connection, profile);
    if (this.tasks.has(input.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    if ([...this.tasks.values()].filter(task => task.kind === 'browse' && task.purpose === 'reference').length >= sqliteReferenceLimits.active) return Promise.reject(Error('SQLite外键浏览任务已达并发上限'));
    const task: BrowseTask = { kind: 'browse', purpose: 'reference', connection, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const work = this.track(connection, () => this.browse(task, input, profile)); task.active = work;
    const retire = () => { task.active = undefined; this.retireBrowse(input.taskId, task); }; void work.then(retire, retire); return work;
  }
  /** 反向关联沿同一独立只读资源账本，准确退出前不释放目录／子页任务槽。 */
  private incoming(source: unknown): Promise<SqliteIncomingOutput> {
    const input = sqliteIncomingInputSchema.parse(source), profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
    this.assertTarget(connection, profile);
    if (this.tasks.has(input.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    if ([...this.tasks.values()].filter(task => task.kind === 'browse' && task.purpose === 'incoming').length >= sqliteIncomingLimits.active) return Promise.reject(Error('SQLite子记录浏览任务已达并发上限'));
    const task: BrowseTask = { kind: 'browse', purpose: 'incoming', connection, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const work = this.track(connection, () => this.browse(task, input, profile)); task.active = work;
    const retire = () => { task.active = undefined; this.retireBrowse(input.taskId, task); }; void work.then(retire, retire); return work;
  }
  /** 终态且准确exit之后只保留编号墓碑；未确认资源仍由原任务和连接账本持有。 */
  private retireBrowse(taskId: string, task: BrowseTask): void {
    if (!task.active && (!task.resource || !task.connection.resources.has(task.resource)) && this.tasks.get(taskId) === task) this.tasks.set(taskId, { kind: 'browse-finished' });
  }
  /** 每个异步边界都重读取消与连接屏障，迟到open/元数据/SELECT不能发布或启动后继读取。 */
  private browseCheck(task: ReadTask): void {
    if (task.cancelled || task.connection.closing || this.stopping) { task.boundaryCancelled = true; throw new SqliteTableBrowseCancelled(); }
    if (task.kind === 'browse') task.assertCurrent?.();
    if (task.connection.blocked) throw Error('SQLite连接仍有退出未确认资源，表浏览未继续', { cause: task.connection.failure });
  }
  /** 只读任务在原driver回滚并关闭、准确进程exit确认后才交付最终Page。 */
  private browse(task: BrowseTask, input: SqliteTablePageInput, profile: SqliteConnectionProfile): Promise<SqliteTablePage>;
  private browse(task: BrowseTask, input: SqliteValueOptionsInput, profile: SqliteConnectionProfile): Promise<SqliteValueOptionsOutput>;
  private browse(task: BrowseTask, input: SqliteRelationshipsInput, profile: SqliteConnectionProfile): Promise<SqliteRelationshipsOutput>;
  private browse(task: BrowseTask, input: SqliteStatisticsInput | SqliteRowCountInput, profile: SqliteConnectionProfile): Promise<SqliteStatisticsOutput | SqliteRowCountOutput>;
  private browse(task: BrowseTask, input: SqliteReferenceInput, profile: SqliteConnectionProfile): Promise<SqliteReferenceOutput>;
  private browse(task: BrowseTask, input: SqliteIncomingInput, profile: SqliteConnectionProfile): Promise<SqliteIncomingOutput>;
  private browse(task: BrowseTask, input: DraftRestoreInput, profile: SqliteConnectionProfile): Promise<SqliteDraftRestored>;
  private async browse(task: BrowseTask, input: SqliteTablePageInput | SqliteValueOptionsInput | SqliteRelationshipsInput | SqliteStatisticsInput | SqliteRowCountInput | SqliteReferenceInput | SqliteIncomingInput | DraftRestoreInput, profile: SqliteConnectionProfile): Promise<SqliteTablePage | SqliteValueOptionsOutput | SqliteRelationshipsOutput | SqliteStatisticsOutput | SqliteRowCountOutput | SqliteReferenceOutput | SqliteIncomingOutput | SqliteDraftRestored> {
    let value: SqliteTablePage | SqliteValueOptionsOutput | SqliteRelationshipsOutput | SqliteStatisticsOutput | SqliteRowCountOutput | SqliteReferenceOutput | SqliteIncomingOutput | SqliteDraftRestored | undefined, failed = false, failure: unknown;
    const aggregate = task.purpose === 'statistics' ? ('column' in input ? 'SQLite字段概况' : 'SQLite匹配行数') : undefined;
    try {
      this.options.emit({ taskId: input.taskId, status: 'running', progress: 0, message: 'draft' in input ? '正在只读核验SQLite草稿完整原行' : 'incoming' in input ? input.incoming === 'catalog' ? '正在读取SQLite反向外键目录' : '正在读取SQLite关联子记录' : 'reference' in input ? input.reference === 'catalog' ? '正在读取SQLite外键目录' : '正在读取SQLite父记录' : aggregate ? '正在读取' + aggregate : 'tables' in input ? '正在读取SQLite表关系快照' : 'column' in input ? '正在读取SQLite不同值快照' : '正在读取SQLite只读分页快照' });
      this.browseCheck(task);
      task.driver = await this.driver(task.connection, profile, true, resource => {
        task.resource = resource;
        // 原Promise先拒绝而exit迟到时，直到真实exit才可解除任务对utility对象的重引用。
        void resource.transport.exited.then(() => this.retireBrowse(input.taskId, task), () => {});
      });
      this.browseCheck(task);
      const control = { check: () => this.browseCheck(task), beginCleanup: () => { task.cleaning = true; }, cleanupFailed: (reason: unknown) => { task.cleanupFailure = reason; } };
      if ('draft' in input) value = await this.edits.restoreDraft(task.driver, input.draft, profile, control);
      else if ('incoming' in input) value = await readSqliteIncoming(task.driver, input, control);
      else if ('reference' in input) value = await readSqliteReference(task.driver, input, control);
      else if ('tables' in input) value = await readSqliteRelationships(task.driver, input, control);
      else if ('search' in input) value = await readSqliteValueOptions(task.driver, input, control);
      else if ('column' in input) value = await readSqliteStatistics(task.driver, input, control);
      else if ('limit' in input) value = await readSqliteTablePage(task.driver, input, { ...control, prepareEdit: (catalogue, driver) => this.edits.preparePage(driver, input, profile, catalogue, { ...control, beginCleanup: () => {} }) });
      else value = await readSqliteRowCount(task.driver, input, control);
    } catch (reason) {
      failed = true; failure = reason;
      if (task.driver && !task.driver.isUsable && !task.driver.isClosed) this.block(task.connection, reason);
    }
    if (task.driver) {
      task.cleaning = true;
      try { await task.driver.close(); }
      catch (reason) {
        task.cleanupFailure = reason; if (!task.driver.isClosed) this.block(task.connection, reason);
        failure = failed ? new AggregateError([failure, reason], 'SQLite表浏览失败且原driver关闭未确认', { cause: failure }) : reason; failed = true;
      }
    }
    if (!failed) try { this.browseCheck(task); } catch (reason) { failed = true; failure = reason; }
    if (task.resource && task.connection.resources.has(task.resource)) {
      const reason = Error('SQLite表浏览准确进程退出尚未确认，保留原句柄', { cause: failure });
      this.block(task.connection, reason); task.cleanupFailure = reason;
      failure = failed ? new AggregateError([failure, reason], 'SQLite表浏览未完成且原资源退出未确认', { cause: failure }) : reason; failed = true;
    }
    if (failed) {
      const draftPages = value && 'changes' in value ? [value, ...(value.additionalPages ?? [])] : [];
      for (const item of draftPages) if (item.page.edit?.kind === 'editable') this.edits.release({ snapshotId: item.page.edit.snapshotId });
      if (value && 'edit' in value && value.edit?.kind === 'editable') this.edits.release({ snapshotId: value.edit.snapshotId });
      const nativeCancelled = failure instanceof SqliteDriverError && ['SQLITE_CANCELLED', 'SQLITE_CANCELLED_SESSION_CLOSED'].includes(failure.code);
      const openingCancelled = task.cancelled && failure instanceof SqliteDriverError && failure.sessionClosed && failure.code === 'SQLITE_PROCESS_EXIT';
      const cancelled = !task.cleanupFailure && !task.cancelFailure && (failure instanceof SqliteTableBrowseCancelled || task.boundaryCancelled || nativeCancelled || openingCancelled);
      // 取消终态先于原Promise拒绝送达Main；未确认exit必须保持failed，不能被取消意图粉饰。
      try { this.options.emit({ taskId: input.taskId, status: cancelled ? 'cancelled' : 'failed', progress: 0, message: cancelled ? 'SQLite表浏览已取消' : failure instanceof Error ? failure.message : 'SQLite表浏览失败' }); } catch { /* 保留原只读结果/资源事实，不因终态通知异常重试。 */ }
      throw failure;
    }
    try { this.options.emit({ taskId: input.taskId, status: 'completed', progress: 100, rows: value && 'source' in value ? value.page?.result.rows.length : value && 'tables' in value ? value.tables.length : value && 'values' in value ? value.values.length : value && 'result' in value ? value.result.rows.length : undefined, message: 'draft' in input ? 'SQLite草稿原行只读核验完成，尚未提交任何修改' : 'incoming' in input ? 'SQLite关联子记录只读浏览完成' : 'reference' in input ? 'SQLite外键只读浏览完成' : aggregate ? aggregate + '读取完成' : 'tables' in input ? 'SQLite表关系读取完成' : 'column' in input ? 'SQLite不同值读取完成' : 'SQLite只读分页读取完成' }); } catch { /* 数据及准确资源终态已确认，不重放查询。 */ }
    return value!;
  }
  /** 打开中没有driver时也只终止本任务准确transport，并等待其真实exit而非猜测PID。 */
  private async stopOpening(task: ReadTask): Promise<void> {
    const resource = task.resource; if (!resource || !task.connection.resources.has(resource)) return;
    try { resource.transport.terminate(); } catch { /* 终止调用异常仍以真实exit为准。 */ }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([resource.transport.exited, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('SQLite表浏览打开取消后进程exit尚未确认，保留准确句柄')), sqliteDriverLimits.exitTimeoutMs); timer.unref(); })]);
    } finally { clearTimeout(timer); }
  }
  /** 取消意图先同步登记，随后取消原driver并等原任务rollback/close；历史编号不会影响后继读取。 */
  private cancelBrowse(task: ReadTask): Promise<void> {
    if (task.cancelWork) return task.cancelWork;
    if (committing(task)) return task.active?.then(() => {}, () => {}) ?? Promise.resolve();
    if (!task.active) { task.cancelled = true; return Promise.resolve(); }
    task.cancelled = true;
    if (task.kind === 'import') task.abort.abort();
    const work = (async () => {
      try {
        if (task.driver) { if (!task.cleaning) await task.driver.cancel(); } else await this.stopOpening(task);
        await task.active?.catch(() => {});
        if (task.cleanupFailure) throw task.cleanupFailure;
        if (task.resource && task.connection.resources.has(task.resource)) throw Error('SQLite表浏览取消后仍有退出未确认资源');
      } catch (reason) {
        task.cancelFailure = reason;
        if (task.resource && task.connection.resources.has(task.resource)) this.block(task.connection, reason);
        throw reason;
      }
    })();
    task.cancelWork = work; void work.catch(() => { if (task.cancelWork === work) task.cancelWork = undefined; }); return work;
  }

  /** 文件路径与函数能力只能由同进程Main注入；严格公共合同不允许夹带任意SQL或profile。 */
  private tableExport(source: unknown): Promise<SqliteTableExportOutput> {
    const raw = source as SqliteTableExportRequest;
    if (!raw || typeof raw.filePath !== 'string' || typeof raw.assertCurrent !== 'function' || typeof raw.validateDestination !== 'function' || typeof raw.retainDestinationUntil !== 'function') return Promise.reject(Error('SQLite导出缺少Main原文档与目标文件能力'));
    const { filePath, assertCurrent, validateDestination, retainDestinationUntil, ...publicInput } = raw;
    const parsed = sqliteTableExportSchema.parse(publicInput); assertCurrent();
    const profile = this.profile(this.options.resolveProfile(parsed.connectionId), parsed.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    if (this.tasks.has(parsed.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    const input: SqliteTableExportRequest = { ...parsed, filePath, assertCurrent, validateDestination, retainDestinationUntil };
    const task: ExportTask = { kind: 'export', connection, input, cancelled: false, boundaryCancelled: false, cleaning: false, committing: false, retainedDestination: false, rows: 0 }; this.tasks.set(parsed.taskId, task);
    const work = this.track(connection, () => this.export(task, profile)); task.active = work;
    const retire = () => { task.active = undefined; this.retireExport(parsed.taskId, task); };
    void work.then(retire, retire); return work;
  }
  /** 不可取消rename开始后只报告真实提交；之前每次读取/写入仍核原Main文档和连接屏障。 */
  private exportCheck(task: ExportTask): void { if (!task.committing) { this.browseCheck(task); task.input.assertCurrent(); } }
  /** 文件与DB资源都确认释放才退轻量墓碑；未知partial不能随utility退出丢失。 */
  private retireExport(taskId: string, task: ExportTask): void {
    if (!task.active && (!task.resource || !task.connection.resources.has(task.resource)) && (!task.file || task.file.closed) && this.tasks.get(taskId) === task) this.tasks.set(taskId, { kind: 'export-finished' });
  }
  /** 流式导出只暂存，必须先确认原driver正常关闭，再准备和原子发布文件。 */
  private async export(task: ExportTask, profile: SqliteConnectionProfile): Promise<SqliteTableExportOutput> {
    let failed = false, failure: unknown;
    const event = (status: TaskEvent['status'], message: string, progress = 0) => { this.options.emit({ taskId: task.input.taskId, status, progress, rows: task.rows, message }); };
    try {
      event('running', '正在导出SQLite文件'); this.exportCheck(task);
      const maximum = this.options.tableExport?.maxBytes;
      if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 10 * 1024 ** 3)) throw Error('SQLite导出内部文件预算无效');
      const file = task.file = new SqliteTableExportFile(task.input, () => this.exportCheck(task), () => { this.exportCheck(task); task.committing = true; }, this.options.tableExport?.io, maximum);
      task.connection.files.add(file);
      void file.recovered.then(() => { task.connection.files.delete(file); this.retireExport(task.input.taskId, task); });
      task.driver = await this.driver(task.connection, profile, true, resource => { task.resource = resource; void resource.transport.exited.then(() => this.retireExport(task.input.taskId, task), () => {}); });
      this.exportCheck(task);
      task.rows = await prepareSqliteTableExport(task.driver, task.input, file, {
        check: () => this.exportCheck(task), beginCleanup: () => { task.cleaning = true; }, cleanupFailed: reason => { task.cleanupFailure = reason; },
        progress: rows => { task.rows = rows; event('running', '已暂存SQLite导出' + rows + '行'); },
      });
    } catch (reason) { failed = true; failure = reason; if (task.driver && !task.driver.isUsable && !task.driver.isClosed) this.block(task.connection, reason); }
    if (task.driver) {
      task.cleaning = true;
      try { await task.driver.close(); }
      catch (reason) { task.cleanupFailure = reason; if (!task.driver.isClosed) this.block(task.connection, reason); failure = failed ? new AggregateError([failure, reason], 'SQLite导出失败且原driver关闭未确认', { cause: failure }) : reason; failed = true; }
    }
    if (task.resource && task.connection.resources.has(task.resource)) {
      const reason = Error('SQLite完整导出原DB进程尚未确认退出，文件不能发布', { cause: failure });
      this.block(task.connection, reason); task.cleanupFailure = reason; failure = failed ? new AggregateError([failure, reason], 'SQLite导出及原DB资源退出未确认', { cause: failure }) : reason; failed = true;
    }
    if (!failed) try { this.exportCheck(task); await task.file!.prepare(); this.exportCheck(task); await task.file!.commit(); }
    catch (reason) { failed = true; failure = reason; }
    if (task.file) try { await task.file.dispose(); }
    catch (reason) {
      task.cleanupFailure = reason; this.block(task.connection, reason);
      if (!task.retainedDestination) {
        task.retainedDestination = true;
        try { task.input.retainDestinationUntil(task.file.recovered); }
        catch (guardFailure) { failure = new AggregateError([failure, guardFailure], 'SQLite导出目标预留保留回执异常，原文件资源仍保留', { cause: failure }); }
      }
      failure = failed ? new AggregateError([failure, reason], 'SQLite导出失败且原文件资源清理未确认', { cause: failure }) : reason; failed = true;
    }
    if (task.file?.fileCommitted) {
      // 文件真实提交优先于晚取消/通知异常，残留资源另由准确账本保留，不改写为取消成功。
      try { event('completed', task.cleanupFailure ? 'SQLite文件已提交，原暂存资源仍需确认收尾' : 'SQLite完整导出完成', 100); } catch { /* 保留真实fileCommitted事实。 */ }
      return { rows: task.rows, fileCommitted: true };
    }
    if (!failed) { failed = true; failure = Error('SQLite导出未取得文件提交事实'); }
    const nativeCancelled = failure instanceof SqliteDriverError && ['SQLITE_CANCELLED', 'SQLITE_CANCELLED_SESSION_CLOSED'].includes(failure.code);
    const openingCancelled = task.cancelled && failure instanceof SqliteDriverError && failure.sessionClosed && failure.code === 'SQLITE_PROCESS_EXIT';
    const cancelled = !task.cleanupFailure && !task.cancelFailure && !task.committing && (failure instanceof SqliteTableBrowseCancelled || task.boundaryCancelled || nativeCancelled || openingCancelled);
    try { event(cancelled ? 'cancelled' : 'failed', cancelled ? 'SQLite完整导出已取消，原目标文件保持不变' : failure instanceof Error ? failure.message : 'SQLite完整导出失败'); } catch { /* 不覆盖原失败和资源事实。 */ }
    throw failure;
  }

  /** 已领取写预览的生命周期与准确driver归同一任务，COMMIT边界后不以取消/断连强杀原进程。 */
  private tableEditApply(source: unknown, synchronization?: SqliteEditClaim): Promise<SqliteTableEditOutcome> {
    const input = source as SqliteEditApplyRequest;
    if (!input || typeof input.operationId !== 'string' || !input.operationId || typeof input.assertCurrent !== 'function' || typeof input.recordWriteFact !== 'function') return Promise.reject(Error('SQLite表格写入缺少Main同步提交事实能力'));
    if (this.tasks.has(input.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    const { operationId: _operation, assertCurrent: _assert, recordWriteFact: _record, ...publicInput } = input;
    const claim = synchronization ?? this.edits.claim(publicInput), connection = this.connections.get(claim.snapshot.target.connectionId);
    if (!connection) {
      const outcome = sqliteEditNotSent(claim, input, 'SQLite原连接已关闭'); if (!synchronization) this.edits.settle(claim, outcome.outcome); this.tasks.set(input.taskId, { kind: 'edit-finished' });
      try { this.options.emit({ taskId: input.taskId, status: 'failed', progress: 0, message: outcome.message }); } catch { /* 原not-sent事实不被通知异常覆盖。 */ }
      return Promise.resolve(outcome);
    }
    const task: EditTask = { kind: 'edit', connection, input, claim, committing: false, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const work = this.track(connection, () => this.editApply(task)); task.active = work;
    const retire = () => { task.active = undefined; this.retireEdit(input.taskId, task); }; void work.then(retire, retire); return work;
  }
  /** 编辑终态不保留整页原数据或回调；未确认exit仍保持准确进程强引用与关闭屏障。 */
  private retireEdit(id: string, task: EditTask): void { if (!task.active && (!task.resource || !task.connection.resources.has(task.resource)) && this.tasks.get(id) === task) this.tasks.set(id, { kind: 'edit-finished' }); }
  private editCheck(task: EditTask): void { if (!task.committing) { this.browseCheck(task); task.input.assertCurrent(); } }
  /** 执行失败也交付结构化结果；只有未知资源保守阻新建，提交ACK永远优先于后续清理错误。 */
  private async editApply(task: EditTask): Promise<SqliteTableEditOutcome> {
    let outcome: SqliteTableEditOutcome | undefined;
    try {
      this.options.emit({ taskId: task.input.taskId, status: 'running', progress: 0, message: '正在提交SQLite表格草稿；原值及SQL不进入任务概要' }); this.editCheck(task);
      const current = this.profile(this.options.resolveProfile(task.claim.snapshot.target.connectionId));
      if (current.sqlite.readOnly || !sameTarget(task.claim.snapshot.profile, current)) throw Error('SQLite连接配置已变化，原写入未发送');
      task.driver = await this.driver(task.connection, current, false, resource => { task.resource = resource; void resource.transport.exited.then(() => this.retireEdit(task.input.taskId, task), () => {}); });
      this.editCheck(task);
      outcome = await applySqliteTableEdit(task.driver, task.claim, task.input, { check: () => this.editCheck(task), beginCommit: () => { this.editCheck(task); task.committing = true; }, beginCleanup: () => { task.cleaning = true; }, cleanupFailed: reason => { task.cleanupFailure = reason; } });
    } catch (reason) { outcome = sqliteEditNotSent(task.claim, task.input, reason instanceof Error ? reason.message : 'SQLite修改未发送'); }
    if (!task.claim.synchronization) this.edits.settle(task.claim, outcome.outcome);
    if (task.driver) {
      task.cleaning = true;
      try { await task.driver.close(); }
      catch (reason) { task.cleanupFailure = reason; outcome.cleanupWarning = true; if (!task.driver.isClosed) this.block(task.connection, reason); }
    }
    if (task.resource && task.connection.resources.has(task.resource)) { const reason = Error('SQLite表格修改原进程退出尚未确认'); this.block(task.connection, reason); task.cleanupFailure = reason; outcome.cleanupWarning = true; }
    const cancelled = task.cancelled && !task.cleanupFailure && outcome.outcome !== 'unknown' && outcome.outcome !== 'committed';
    try { this.options.emit({ taskId: task.input.taskId, status: outcome.outcome === 'committed' ? 'completed' : cancelled ? 'cancelled' : 'failed', progress: outcome.outcome === 'committed' ? 100 : 0, rows: outcome.fact.appliedRows, message: outcome.message }); } catch { /* 不覆盖原COMMIT/ROLLBACK事实，原批次绝不重放。 */ }
    return outcome;
  }

  /** 私有owner能力先于任何打开；方言与路径唯Main已存profile可信。 */
  private tableCreatePreview(source: unknown): Promise<SqliteTableCreatePreviewOutput> {
    const raw = source as SqliteTableCreatePreviewRequest;
    if (!raw || typeof raw.assertCurrent !== 'function') return Promise.reject(Error('SQLite建表预览缺少Main原文档能力'));
    const { assertCurrent, ...publicInput } = raw, input = sqliteTableCreatePreviewSchema.parse(publicInput); assertCurrent();
    if (this.tasks.has(input.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    this.tasks.set(input.taskId, { kind: 'create-preview-finished' });
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    const sourceId = 'copy' in input ? input.copy.sourceConnectionId : undefined;
    const sourceProfile = sourceId ? this.profile(this.options.resolveProfile(sourceId), sourceId) : undefined;
    const attachment = sourceProfile ? { connection: this.connection(sourceProfile.id), profile: structuredClone(sourceProfile) } : undefined;
    const task: CreatePreviewTask = { kind: 'create-preview', connection, input: { ...input, assertCurrent }, cancelled: false, boundaryCancelled: false, cleaning: false, attachment }; this.tasks.set(input.taskId, task);
    const work = this.trackCreate(task, () => this.createPreview(task, profile)); task.active = work; const done = () => { task.active = undefined; this.retireCreate(input.taskId, task); }; void work.then(done, done); return work;
  }
  /** 终态不永久保留设计、回调与utility；未知exit仍由原连接强持有准确句柄。 */
  private retireCreate(id: string, task: CreatePreviewTask | CreateTask): void { if (!task.active && (!task.resource || !task.connection.resources.has(task.resource)) && this.tasks.get(id) === task) this.tasks.set(id, { kind: task.kind === 'create' ? 'create-finished' : 'create-preview-finished' }); }
  /** 附件进程由目标持有，来源连接也等待同一个任务结束，关闭任一端都撤销提交前操作。 */
  private trackCreate<T>(task: CreatePreviewTask | CreateTask, action: () => Promise<T>): Promise<T> {
    return this.track(task.connection, () => task.attachment ? this.track(task.attachment.connection, action) : action());
  }
  private createCheck(task: CreatePreviewTask | CreateTask): void {
    if (task.kind === 'create' && task.committing) return;
    this.browseCheck(task); task.input.assertCurrent();
    if (task.attachment) {
      const { connection, profile } = task.attachment;
      if (connection.closing || connection.blocked || this.connections.get(profile.id) !== connection) throw Error('SQLite 复制来源连接正在关闭或不可用');
      const current = this.profile(this.options.resolveProfile(profile.id), profile.id);
      this.assertTarget(connection, current);
      if (!sameTarget(current, profile)) throw Error('SQLite 复制来源连接已变化');
    }
  }
  /** 预览只有RO事务完整回滚、原driver正常关闭与exit0后才发布私有能力。 */
  private async createPreview(task: CreatePreviewTask, profile: SqliteConnectionProfile): Promise<SqliteTableCreatePreviewOutput> {
    let snapshot: SqliteCreateSnapshot | undefined, failure: unknown, failed = false;
    try {
      this.options.emit({ taskId: task.input.taskId, status: 'running', progress: 0, message: '正在读取SQLite建表只读预览，概要不保存设计、SQL或路径' }); this.createCheck(task);
      task.driver = await this.driver(task.connection, profile, true, resource => { task.resource = resource; void resource.transport.exited.then(exit => { task.exit = exit; this.retireCreate(task.input.taskId, task); }, () => {}); }, false, task.attachment?.profile.sqlite.filePath); this.createCheck(task);
      snapshot = await prepareSqliteCreateSnapshot(task.driver, task.input, profile, { check: () => this.createCheck(task), beginCleanup: () => { task.cleaning = true; }, cleanupFailed: reason => { task.cleanupFailure = reason; } }, task.attachment?.profile);
    } catch (reason) { failed = true; failure = reason; }
    if (task.driver) {
      task.cleaning = true;
      if (!failed && !task.driver.isUsable) { failed = true; failure = Error('SQLite建表预览原会话提前失效'); }
      try { await task.driver.close(); } catch (reason) { failed = true; failure = reason; task.cleanupFailure = reason; if (!task.driver.isClosed) this.block(task.connection, reason); }
      if (task.exit?.code !== 0 || task.exit?.signal !== null) { failed = true; failure ??= Error('SQLite建表预览原进程未正常退出'); }
    }
    if (task.resource && task.connection.resources.has(task.resource)) { failed = true; const reason = Error('SQLite建表预览仍有未确认原资源'); task.cleanupFailure = reason; failure ??= reason; this.block(task.connection, reason); }
    if (!failed) try { this.createCheck(task); } catch (reason) { failed = true; failure = reason; }
    if (failed) {
      const cancelled = !task.cleanupFailure && !task.cancelFailure && task.cancelled;
      try { this.options.emit({ taskId: task.input.taskId, status: cancelled ? 'cancelled' : 'failed', progress: 0, message: cancelled ? 'SQLite建表预览已取消' : 'SQLite建表预览失败，设计未执行' }); } catch { /* 原错误与资源事实优先。 */ }
      throw failure;
    }
    let result: SqliteTableCreatePreviewOutput;
    try { result = this.creates.publish(snapshot!); } catch (reason) { try { this.options.emit({ taskId: task.input.taskId, status: 'failed', progress: 0, message: 'SQLite建表预览预算不足，设计未执行' }); } catch { /* 不覆盖预算拒绝。 */ } throw reason; }
    try { this.options.emit({ taskId: task.input.taskId, status: 'completed', progress: 100, message: 'SQLite建表预览已完成，尚未发送DDL' }); } catch { /* 预览无写，不重试只读请求。 */ }
    return result;
  }
  /** 精确一次claim，确认错误也消费；取得目标后正常执行失败均返回结构化事实。 */
  private tableCreateApply(source: unknown): Promise<SqliteTableCreateOutcome> {
    const input = source as SqliteTableCreateApplyRequest;
    if (!input || typeof input.assertCurrent !== 'function' || typeof input.recordCreateFact !== 'function' || typeof input.operationId !== 'string' || !input.operationId) return Promise.reject(Error('SQLite建表缺少Main同步事实与原文档能力'));
    if (this.tasks.has(input.taskId)) return Promise.reject(Error('SQLite任务编号已经使用'));
    const { operationId: _operation, assertCurrent: _assert, recordCreateFact: _record, ...publicInput } = input;
    const parsed = sqliteTableCreateApplySchema.parse(publicInput); this.tasks.set(parsed.taskId, { kind: 'create-finished' });
    const claim = this.creates.claim(parsed), connection = this.connections.get(claim.target.connectionId);
    const sourceProfile = claim.copy?.attachment?.profile, sourceConnection = sourceProfile ? this.connections.get(sourceProfile.id) : undefined;
    if (!connection || sourceProfile && !sourceConnection) { const result = sqliteCreateNotSent(claim, input); this.tasks.set(input.taskId, { kind: 'create-finished' }); try { this.options.emit({ taskId: input.taskId, status: 'failed', progress: 0, message: 'SQLite建表未发送，原连接已关闭' }); } catch { /* 保留not-sent。 */ } return Promise.resolve(result); }
    const attachment = sourceProfile && sourceConnection ? { connection: sourceConnection, profile: sourceProfile } : undefined;
    const task: CreateTask = { kind: 'create', connection, input, claim, committing: false, cancelled: false, boundaryCancelled: false, cleaning: false, attachment }; this.tasks.set(input.taskId, task);
    const work = this.trackCreate(task, () => this.createApply(task)); task.active = work; const done = () => { task.active = undefined; this.retireCreate(input.taskId, task); }; void work.then(done, done); return work;
  }
  /** 原COMMIT边界后的撤权/取消只等真实ACK，不强杀准确写进程或重放DDL。 */
  private async createApply(task: CreateTask): Promise<SqliteTableCreateOutcome> {
    let result: SqliteTableCreateOutcome;
    try {
      this.options.emit({ taskId: task.input.taskId, status: 'running', progress: 0, message: '正在创建SQLite表，概要不保存设计、SQL或路径' }); this.createCheck(task);
      const profile = this.profile(this.options.resolveProfile(task.claim.target.connectionId)); if (profile.sqlite.readOnly || !sameTarget(profile, task.claim.profile)) throw Error('SQLite建表连接修订或只读属性已变化');
      task.driver = await this.driver(task.connection, profile, false, resource => { task.resource = resource; void resource.transport.exited.then(exit => { task.exit = exit; this.retireCreate(task.input.taskId, task); }, () => {}); }, false, task.attachment?.profile.sqlite.filePath); this.createCheck(task);
      result = await applySqliteTableCreate(task.driver, task.claim, task.input, { check: () => this.createCheck(task), beginCommit: () => { this.createCheck(task); task.committing = true; }, beginCleanup: () => { task.cleaning = true; }, cleanupFailed: reason => { task.cleanupFailure = reason; } });
    } catch { result = sqliteCreateNotSent(task.claim, task.input); }
    if (task.driver) {
      task.cleaning = true;
      if (!task.driver.isUsable) { result.cleanupWarning = true; task.cleanupFailure ??= Error('SQLite建表原会话提前失效'); }
      try { await task.driver.close(); } catch (reason) { result.cleanupWarning = true; task.cleanupFailure = reason; if (!task.driver.isClosed) this.block(task.connection, reason); }
      if (task.exit?.code !== 0 || task.exit?.signal !== null) { result.cleanupWarning = true; task.cleanupFailure ??= Error('SQLite建表原进程未正常退出'); }
    }
    if (task.resource && task.connection.resources.has(task.resource)) { const reason = Error('SQLite建表原资源退出未确认'); result.cleanupWarning = true; task.cleanupFailure = reason; this.block(task.connection, reason); }
    const cancelled = task.cancelled && !task.cleanupFailure && !task.cancelFailure && result.outcome !== 'committed' && result.outcome !== 'unknown';
    try { this.options.emit({ taskId: task.input.taskId, status: result.outcome === 'committed' ? 'completed' : cancelled ? 'cancelled' : 'failed', progress: result.outcome === 'committed' ? 100 : 0, message: result.message }); } catch { /* 原提交/回滚ACK不被通知错误覆盖。 */ }
    return result;
  }

  /** 有效导入任务编号立即留SQLite墓碑，失败、过期或错误确认也不能被其它任务复用。 */
  private reserveImportTask(id: string): void { if (this.stopping || this.tasks.has(id)) throw Error('SQLite正在退出或任务编号已经使用'); this.tasks.set(id, { kind: 'import-finished' }); }
  private importCheck(task: RebuildTask | ImportTask | IndexesTask | ColumnsTask | TableRenameTask | MaintenanceTask | ObjectsTask): void { if (!task.committing) { this.browseCheck(task); task.input.assertCurrent(); } }
  private importControl(task: ImportTask): SqliteTableImportControl { return { signal: task.abort.signal, check: () => this.importCheck(task), beginCleanup: () => { task.cleaning = true; }, cleanupFailed: reason => { task.cleanupFailure = reason; }, progress: records => { this.importCheck(task); this.options.emit({ taskId: task.input.taskId, status: 'running', progress: 0, message: '正在处理SQLite导入记录；概要不保存文件原值或路径', rows: records }); } }; }
  private retireImport(task: ImportTask): void { if (!task.active && (!task.resource || !task.connection.resources.has(task.resource)) && this.tasks.get(task.input.taskId) === task) this.tasks.set(task.input.taskId, { kind: 'import-finished' }); }
  /** 结束准确utility后释放重引用；流文件读取仍由同一任务/pending/AbortController持有。 */
  private async closeImportDriver(task: RebuildTask | ImportTask | IndexesTask | ColumnsTask | TableRenameTask | MaintenanceTask | ObjectsTask): Promise<void> {
    let failure: unknown; const cancelledExit = task.cancelled && !task.committing && task.driver?.isClosed;
    task.cleaning = true;
    if (task.driver) {
      if (!task.driver.isUsable && !cancelledExit) failure = Error('SQLite导入原会话提前失效');
      try { await task.driver.close(); } catch (reason) { failure = reason; if (!task.driver.isClosed) this.block(task.connection, reason); }
      if (!cancelledExit && (task.exit?.code !== 0 || task.exit?.signal !== null)) failure ??= Error('SQLite导入原进程未正常退出');
    }
    if (task.resource && task.connection.resources.has(task.resource)) { failure ??= Error('SQLite导入原进程退出未确认'); this.block(task.connection, failure); }
    if (failure) { task.cleanupFailure = failure; throw failure; }
    task.driver = undefined; task.resource = undefined; task.exit = undefined; task.cleaning = false;
  }
  /** 导入使用私有并发预算；实际原任务settled才归还槽位，不能以取消意图提前释放。 */
  private startImport<T extends SqliteImportResult>(input: ImportTask['input'], connection: Connection, phase: 'source' | 'inspect' | 'preview' | 'apply', action: (task: ImportTask) => Promise<T>): Promise<T> {
    if (this.importsActive >= sqliteImportConcurrency) throw Error('SQLite导入已有活动文件任务，请等待原任务收尾');
    this.importsActive++; const task: ImportTask = { kind: 'import', input, connection, abort: new AbortController(), committing: false, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const work = this.track(connection, async () => {
      let result: T | undefined, failed = false, failure: unknown;
      try { this.options.emit({ taskId: input.taskId, status: 'running', progress: 0, message: phase === 'source' ? sqliteImportSourceMessages.running : importText.running }); this.importCheck(task); result = await action(task); }
      catch (reason) { failed = true; failure = reason; }
      if (task.driver || task.resource) try { await this.closeImportDriver(task); } catch (reason) { const outcome = phase === 'apply' ? importOutcome(result) : undefined; if (outcome) outcome.cleanupWarning = true; else { failure = failed ? new AggregateError([failure, reason], 'SQLite导入操作及准确资源收尾失败') : reason; failed = true; } }
      if (!failed && phase !== 'apply') try { this.importCheck(task); } catch (reason) { failed = true; failure = reason; }
      if (failed) { const cancelled = task.cancelled && !task.cleanupFailure && !task.cancelFailure; try { this.options.emit({ taskId: input.taskId, status: cancelled ? 'cancelled' : 'failed', progress: 0, message: cancelled ? 'SQLite导入文件任务已取消，未确认提交' : 'SQLite导入文件任务未完成，请核对文件或原连接' }); } catch { /* 原错误事实优先，不重放。 */ } throw failure; }
      const outcome = phase === 'apply' ? importOutcome(result) : undefined, invalid = phase === 'preview' && result && 'ok' in result && !result.ok;
      if (outcome && task.cleanupFailure) outcome.cleanupWarning = true;
      const cancelled = !!outcome && task.cancelled && !task.cleanupFailure && !task.cancelFailure && outcome.outcome !== 'committed' && outcome.outcome !== 'unknown';
      try { this.options.emit({ taskId: input.taskId, status: outcome ? outcome.outcome === 'committed' ? 'completed' : cancelled ? 'cancelled' : 'failed' : invalid ? 'failed' : 'completed', progress: outcome && outcome.outcome !== 'committed' || invalid ? 0 : 100, message: outcome?.message ?? (invalid ? 'SQLite全文件预检发现问题，未签发提交能力' : phase === 'source' ? sqliteImportSourceMessages.inspected : 'SQLite导入文件检查已完成，未执行原表写入') }); } catch { /* 原ACK与完整文件事实不受通知失败覆盖。 */ }
      return result!;
    }); task.active = work; const done = () => { this.importsActive--; task.active = undefined; this.retireImport(task); }; void work.then(done, done); return work;
  }
  /** 文件来源检查零utility，只登记原连接的文件任务及AbortController，随后显式建表不使来源过期。 */
  private importSourceInspect(source: unknown): Promise<SqliteImportSourceInspectOutput> {
    const raw = source as SqliteImportSourceRequest; if (!raw || typeof raw.filePath !== 'string' || typeof raw.assertCurrent !== 'function') throw Error('SQLite来源检查缺少Main文件和原文档能力');
    const { filePath, assertCurrent, ...publicInput } = raw, input = sqliteImportSourceInspectSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent();
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    return this.startImport({ taskId: input.taskId, assertCurrent }, connection, 'source', async task => {
      const checked = await inspectSqliteImportSource({ ...input, filePath, assertCurrent }, profile, this.importControl(task)); this.importCheck(task); return this.importSources.publish(checked);
    });
  }
  private tableImportInspect(source: unknown): Promise<SqliteTableImportInspectOutput> {
    const raw = source as SqliteTableImportInspectRequest; if (!raw || typeof raw.filePath !== 'string' || typeof raw.assertCurrent !== 'function') throw Error('SQLite导入检查缺少Main文件和原文档能力');
    const { filePath, assertCurrent, ...publicInput } = raw, input = sqliteTableImportInspectSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent();
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    const request = { ...input, filePath, assertCurrent }, claim = input.sourceId ? this.importSources.claim(request, profile) : undefined;
    const checkOwner = () => { assertCurrent(); if (claim) this.importSources.assertClaim(claim); };
    try {
      return this.startImport({ taskId: input.taskId, assertCurrent: checkOwner }, connection, 'inspect', async task => {
        const control = this.importControl(task); if (claim) await this.importSources.verify(claim, control);
        const fileIdentity = await assertSqliteImportSource(filePath, profile, control, claim?.source.fileIdentity);
        task.driver = await this.driver(connection, profile, true, resource => { task.resource = resource; void resource.transport.exited.then(exit => { task.exit = exit; this.retireImport(task); }, () => {}); }); this.importCheck(task);
        const target = await readSqliteImportTarget(task.driver, profile, input.table, control); await this.closeImportDriver(task); this.importCheck(task);
        const checked = await inspectSqliteImportFile(request, target, fileIdentity, control); if (claim) await this.importSources.verify(claim, control, checked); this.importCheck(task);
        return this.imports.publish(checked);
      }).then(output => { if (claim) this.importSources.finish(claim, true); return output; }).finally(() => { if (claim) this.importSources.finish(claim, false); });
    } catch (reason) { if (claim) this.importSources.finish(claim, false); throw reason; }
  }
  private tableImportPreview(source: unknown): Promise<SqliteTableImportPreviewOutput> {
    const raw = source as SqliteTableImportPreviewRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite导入预检缺少Main原文档能力');
    const { assertCurrent, ...publicInput } = raw, input = sqliteTableImportPreviewSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent(); const inspection = this.imports.inspection(input.inspectionId);
    const profile = this.profile(this.options.resolveProfile(inspection.target.connectionId)); if (!sameTarget(profile, inspection.profile)) throw Error(importText.stale); const connection = this.connection(profile.id);
    const retained = this.imports.retainInspection(inspection), checkOwner = () => { assertCurrent(); retained.check(); };
    try {
      return this.startImport({ taskId: input.taskId, assertCurrent: checkOwner }, connection, 'preview', async task => {
        await this.verifyImportCatalogue(task, inspection);
        const checked = await previewSqliteImport(inspection, { ...input, assertCurrent: checkOwner }, this.importControl(task)); this.importCheck(task);
        await this.verifyImportCatalogue(task, inspection); this.importCheck(task);
        return this.imports.publishPreview(inspection, checked);
      }).finally(retained.release);
    } catch (reason) { retained.release(); throw reason; }
  }
  /** 每次只读目录检查均使用原连接登记的独立utility，真实close/exit后才继续原文件任务。 */
  private async verifyImportCatalogue(task: ImportTask, inspection: SqliteImportInspection): Promise<void> {
    this.importCheck(task);
    task.driver = await this.driver(task.connection, inspection.profile, true, resource => { task.resource = resource; void resource.transport.exited.then(exit => { task.exit = exit; this.retireImport(task); }, () => {}); }); this.importCheck(task);
    await verifySqliteImportTarget(task.driver, inspection, this.importControl(task)); await this.closeImportDriver(task); this.importCheck(task);
  }
  private tableImportApply(source: unknown): Promise<SqliteTableImportOutcome> {
    const raw = source as SqliteTableImportApplyRequest;
    if (!raw || typeof raw.assertCurrent !== 'function' || typeof raw.recordWriteFact !== 'function' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.operationId)) throw Error('SQLite导入提交缺少Main同步事实与原文档能力');
    const { operationId, assertCurrent, recordWriteFact, ...publicInput } = raw, input = sqliteTableImportApplySchema.parse(publicInput); this.reserveImportTask(input.taskId); const claim = this.imports.claim(input), request = { ...input, operationId, assertCurrent, recordWriteFact }, connection = this.connections.get(claim.inspection.target.connectionId);
    if (!connection) { const result = sqliteImportNotSent(claim, request); try { this.options.emit({ taskId: input.taskId, status: 'failed', progress: 0, message: importText.notSent }); } catch { /* not-sent不被通知覆盖。 */ } return Promise.resolve(result); }
    return this.startImport({ taskId: input.taskId, assertCurrent }, connection, 'apply', async task => {
      let result: SqliteTableImportOutcome;
      try {
        this.importCheck(task); const profile = this.profile(this.options.resolveProfile(claim.inspection.target.connectionId)); if (!claim.confirmed || profile.sqlite.readOnly || !sameTarget(profile, claim.inspection.profile)) throw Error(importText.stale);
        task.driver = await this.driver(connection, profile, false, resource => { task.resource = resource; void resource.transport.exited.then(exit => { task.exit = exit; this.retireImport(task); }, () => {}); }); this.importCheck(task);
        result = await applySqliteImport(task.driver, claim, request, { ...this.importControl(task), beginCommit: () => { this.importCheck(task); task.committing = true; } });
      } catch { result = sqliteImportNotSent(claim, request); }
      this.imports.settle(claim, result.outcome);
      if (claim.inspection.file.sourceId && ['committed', 'unknown'].includes(result.outcome)) { this.importSources.complete(claim.inspection.file.sourceId, result.outcome); this.imports.releaseSource(claim.inspection.file.sourceId); }
      return result;
    });
  }

  /** 索引任务使用原准确连接/transport账本；终态且exit确认后只留下轻量编号墓碑。 */
  private startIndexes<T extends SqliteIndexesResult>(input: IndexesTask['input'], connection: Connection, phase: 'inspect' | 'preview' | 'apply', action: (task: IndexesTask) => Promise<T>): Promise<T> {
    const task: IndexesTask = { kind: 'indexes', input, connection, abort: new AbortController(), committing: false, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const retire = () => { if (!task.active && (!task.resource || !connection.resources.has(task.resource)) && this.tasks.get(input.taskId) === task) this.tasks.set(input.taskId, { kind: 'indexes-finished' }); };
    const work = this.track(connection, async () => {
      let value: T | undefined, failure: unknown, failed = false;
      try { this.options.emit({ taskId: input.taskId, status: 'running', progress: 0, message: sqliteIndexesMessages.running, sqliteIndexesOperation: phase }); this.importCheck(task); value = await action(task); }
      catch (reason) { failure = reason; failed = true; }
      if (task.driver || task.resource) try { await this.closeImportDriver(task); } catch (reason) { const outcome = indexesOutcome(value); if (outcome) outcome.cleanupWarning = true; else { failure = failed ? new AggregateError([failure, reason], 'SQLite索引操作及准确资源收尾失败') : reason; failed = true; } }
      if (!failed && phase !== 'apply') try { this.importCheck(task); } catch (reason) { failure = reason; failed = true; }
      if (failed) { try { this.options.emit({ taskId: input.taskId, status: task.cancelled && !task.cleanupFailure && !task.cancelFailure ? 'cancelled' : 'failed', progress: 0, message: 'SQLite索引操作未完成，未自动重试', sqliteIndexesOperation: phase }); } catch { /* 原目录/资源失败事实优先。 */ } throw failure; }
      const outcome = indexesOutcome(value), cancelled = task.cancelled && !task.cleanupFailure && !task.cancelFailure && outcome?.outcome !== 'committed' && outcome?.outcome !== 'unknown';
      if (outcome && task.cleanupFailure) outcome.cleanupWarning = true;
      try { this.options.emit({ taskId: input.taskId, status: outcome ? outcome.outcome === 'committed' ? 'completed' : cancelled ? 'cancelled' : 'failed' : 'completed', progress: !outcome || outcome.outcome === 'committed' ? 100 : 0, message: outcome?.message ?? 'SQLite索引目录或预览已完成，尚未执行索引写入', sqliteIndexesOperation: phase, ...(outcome ? { sqliteIndexes: structuredClone(outcome.fact) } : {}) }); } catch { /* 原COMMIT/ROLLBACK ACK不被通知失败改变。 */ }
      return value!;
    }); task.active = work; const done = () => { task.active = undefined; retire(); }; void work.then(done, done);
    // 迟到exit仍只回收原准确资源，不解除连接blocked屏障。
    void work.finally(() => { if (task.resource) void task.resource.transport.exited.then(retire, () => {}); }).catch(() => {}); return work;
  }
  /** 同一任务的每个读取边界都复核取消/owner，收尾错误留原资源事实。 */
  private indexControl(task: IndexesTask) { return { check: () => this.importCheck(task), beginCleanup: () => { task.cleaning = true; }, cleanupFailed: (reason: unknown) => { task.cleanupFailure = reason; } }; }
  /** 每个独立driver都先登记准确transport，直到真实exit才可回收。 */
  private async openIndexesDriver(task: IndexesTask, profile: SqliteConnectionProfile, readOnly: boolean): Promise<void> {
    task.driver = await this.driver(task.connection, profile, readOnly, resource => { task.resource = resource; void resource.transport.exited.then(exit => { task.exit = exit; }, () => {}); }); this.importCheck(task);
  }
  /** 原只读utility和快照均关闭确认后才发布目录能力。 */
  private indexesInspect(source: unknown): Promise<SqliteIndexesInspectOutput> {
    const raw = source as SqliteIndexesInspectRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite索引检查缺少Main原文档能力'); const { assertCurrent, ...publicInput } = raw, input = sqliteIndexesInspectSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent();
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    return this.startIndexes({ taskId: input.taskId, assertCurrent }, connection, 'inspect', async task => { await this.openIndexesDriver(task, profile, true); const snapshot = await inspectSqliteIndexes(task.driver!, profile, input.table, this.indexControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.indexes.publish(snapshot); });
  }
  /** 预览保留准确RO引用直到Promise结束；自然TTL与显式撤权互不混淆。 */
  private indexesPreview(source: unknown): Promise<SqliteIndexesPreviewOutput> {
    const raw = source as SqliteIndexesPreviewRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite索引预览缺少Main原文档能力'); const { assertCurrent, ...publicInput } = raw, input = sqliteIndexesPreviewSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent(); const catalogue = this.indexes.catalogue(input.catalogueId);
    const profile = this.profile(this.options.resolveProfile(catalogue.target.connectionId)); if (!sameTarget(profile, catalogue.profile)) throw Error(sqliteIndexesMessages.stale); const connection = this.connection(profile.id); this.assertTarget(connection, profile); const pin = this.indexes.pin(catalogue), checkOwner = () => { assertCurrent(); pin.check(); };
    try { return this.startIndexes({ taskId: input.taskId, assertCurrent: checkOwner }, connection, 'preview', async task => { await this.openIndexesDriver(task, profile, true); await verifySqliteIndexes(task.driver!, catalogue, this.indexControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.indexes.preview(catalogue, input.actions); }).finally(pin.release); } catch (reason) { pin.release(); throw reason; }
  }
  /** 单次领取预览并注入Main同步回执，原写事务不借用任何用户标签会话。 */
  private indexesApply(source: unknown): Promise<SqliteIndexesOutcome> {
    const raw = source as SqliteIndexesApplyRequest; if (!raw || typeof raw.operationId !== 'string' || !raw.operationId || raw.operationId.length > 200 || typeof raw.assertCurrent !== 'function' || typeof raw.recordIndexesFact !== 'function') throw Error('SQLite索引提交缺少Main同步事实和原文档能力');
    const { operationId, assertCurrent, recordIndexesFact, ...publicInput } = raw, input = sqliteIndexesApplySchema.parse(publicInput); this.reserveImportTask(input.taskId); const claim = this.indexes.claim(input), connection = this.connections.get(claim.catalogue.target.connectionId);
    const request: SqliteIndexesApplyRequest = { ...input, operationId, assertCurrent, recordIndexesFact: fact => { const result: unknown = recordIndexesFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite索引事实必须同步持久化'); this.options.emit({ taskId: input.taskId, status: fact.commitAcknowledged ? 'completed' : 'running', progress: fact.commitAcknowledged ? 100 : 0, message: sqliteIndexesMessages.running, sqliteIndexesOperation: 'apply', sqliteIndexes: structuredClone(fact) }); } };
    if (!connection) { const value = sqliteIndexesNotSent(claim, request); try { this.options.emit({ taskId: input.taskId, status: 'failed', progress: 0, message: sqliteIndexesMessages.notSent, sqliteIndexesOperation: 'apply', sqliteIndexes: structuredClone(value.fact) }); } catch { /* 未发送事实优先。 */ } return Promise.resolve(value); }
    return this.startIndexes({ taskId: input.taskId, assertCurrent }, connection, 'apply', async task => {
      let value: SqliteIndexesOutcome;
      try { this.importCheck(task); const profile = this.profile(this.options.resolveProfile(claim.catalogue.target.connectionId)); if (!claim.confirmed || profile.sqlite.readOnly || !sameTarget(profile, claim.catalogue.profile)) throw Error(sqliteIndexesMessages.stale); await this.openIndexesDriver(task, profile, false); value = await applySqliteIndexes(task.driver!, claim, request, { ...this.indexControl(task), beginCommit: () => { this.importCheck(task); task.committing = true; } }); }
      catch { value = sqliteIndexesNotSent(claim, request); }
      this.indexes.settle(claim, value.outcome); return value;
    });
  }

  /** 字段任务使用原准确连接/transport账本；终态且exit确认后只留下轻量编号墓碑。 */
  private startColumns<T extends SqliteColumnsResult>(input: ColumnsTask['input'], connection: Connection, phase: 'inspect' | 'preview' | 'apply', action: (task: ColumnsTask) => Promise<T>): Promise<T> {
    const task: ColumnsTask = { kind: 'columns', input, connection, abort: new AbortController(), committing: false, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const retire = () => { if (!task.active && (!task.resource || !connection.resources.has(task.resource)) && this.tasks.get(input.taskId) === task) this.tasks.set(input.taskId, { kind: 'columns-finished' }); };
    const work = this.track(connection, async () => {
      let value: T | undefined, failure: unknown, failed = false;
      try { this.options.emit({ taskId: input.taskId, status: 'running', progress: 0, message: sqliteColumnsMessages.running, sqliteColumnsOperation: phase }); this.importCheck(task); value = await action(task); }
      catch (reason) { failure = reason; failed = true; }
      if (task.driver || task.resource) try { await this.closeImportDriver(task); } catch (reason) { const outcome = columnsOutcome(value); if (outcome) outcome.cleanupWarning = true; else { failure = failed ? new AggregateError([failure, reason], 'SQLite字段操作及准确资源收尾失败') : reason; failed = true; } }
      if (!failed && phase !== 'apply') try { this.importCheck(task); } catch (reason) { failure = reason; failed = true; }
      if (failed) { try { this.options.emit({ taskId: input.taskId, status: task.cancelled && !task.cleanupFailure && !task.cancelFailure ? 'cancelled' : 'failed', progress: 0, message: 'SQLite字段操作未完成，未自动重试', sqliteColumnsOperation: phase }); } catch { /* 原目录/资源失败事实优先。 */ } throw failure; }
      const outcome = columnsOutcome(value), cancelled = task.cancelled && !task.cleanupFailure && !task.cancelFailure && outcome?.outcome !== 'committed' && outcome?.outcome !== 'unknown';
      if (outcome && task.cleanupFailure) outcome.cleanupWarning = true;
      try { this.options.emit({ taskId: input.taskId, status: outcome ? outcome.outcome === 'committed' ? 'completed' : cancelled ? 'cancelled' : 'failed' : 'completed', progress: !outcome || outcome.outcome === 'committed' ? 100 : 0, message: outcome?.message ?? 'SQLite字段目录或预览已完成，尚未执行字段写入', sqliteColumnsOperation: phase, ...(outcome ? { sqliteColumns: structuredClone(outcome.fact) } : {}) }); } catch { /* 原COMMIT/ROLLBACK ACK不被通知失败改变。 */ }
      return value!;
    }); task.active = work; const done = () => { task.active = undefined; retire(); }; void work.then(done, done);
    // 迟到exit仍只回收原准确资源，不解除连接blocked屏障。
    void work.finally(() => { if (task.resource) void task.resource.transport.exited.then(retire, () => {}); }).catch(() => {}); return work;
  }
  /** 同一任务的每个读取边界都复核取消/owner，收尾错误留原资源事实。 */
  private columnControl(task: ColumnsTask) { return { check: () => this.importCheck(task), beginCleanup: () => { task.cleaning = true; }, cleanupFailed: (reason: unknown) => { task.cleanupFailure = reason; } }; }
  /** 每个独立driver都先登记准确transport，直到真实exit才可回收。 */
  private async openColumnsDriver(task: ColumnsTask, profile: SqliteConnectionProfile, readOnly: boolean): Promise<void> {
    task.driver = await this.driver(task.connection, profile, readOnly, resource => { task.resource = resource; void resource.transport.exited.then(exit => { task.exit = exit; }, () => {}); }); this.importCheck(task);
  }
  /** 原只读utility和快照均关闭确认后才发布目录能力。 */
  private columnsInspect(source: unknown): Promise<SqliteColumnsInspectOutput> {
    const raw = source as SqliteColumnsInspectRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite字段检查缺少Main原文档能力'); const { assertCurrent, ...publicInput } = raw, input = sqliteColumnsInspectSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent();
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    return this.startColumns({ taskId: input.taskId, assertCurrent }, connection, 'inspect', async task => { await this.openColumnsDriver(task, profile, true); const snapshot = await inspectSqliteColumns(task.driver!, profile, input.table, this.columnControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.columns.publish(snapshot); });
  }
  /** 预览保留准确RO引用直到Promise结束；自然TTL与显式撤权互不混淆。 */
  private columnsPreview(source: unknown): Promise<SqliteColumnsPreviewOutput> {
    const raw = source as SqliteColumnsPreviewRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite字段预览缺少Main原文档能力'); const { assertCurrent, ...publicInput } = raw, input = sqliteColumnsPreviewSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent(); const catalogue = this.columns.catalogue(input.catalogueId);
    const profile = this.profile(this.options.resolveProfile(catalogue.target.connectionId)); if (!sameTarget(profile, catalogue.profile)) throw Error(sqliteColumnsMessages.stale); const connection = this.connection(profile.id); this.assertTarget(connection, profile); const pin = this.columns.pin(catalogue), checkOwner = () => { assertCurrent(); pin.check(); };
    try { return this.startColumns({ taskId: input.taskId, assertCurrent: checkOwner }, connection, 'preview', async task => { await this.openColumnsDriver(task, profile, true); await verifySqliteColumns(task.driver!, catalogue, this.columnControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.columns.preview(catalogue, input.actions); }).finally(pin.release); } catch (reason) { pin.release(); throw reason; }
  }
  /** 单次领取预览并注入Main同步回执，原写事务不借用任何用户标签会话。 */
  private columnsApply(source: unknown): Promise<SqliteColumnsOutcome> {
    const raw = source as SqliteColumnsApplyRequest; if (!raw || typeof raw.operationId !== 'string' || !raw.operationId || raw.operationId.length > 200 || typeof raw.assertCurrent !== 'function' || typeof raw.recordColumnsFact !== 'function') throw Error('SQLite字段提交缺少Main同步事实和原文档能力');
    const { operationId, assertCurrent, recordColumnsFact, ...publicInput } = raw, input = sqliteColumnsApplySchema.parse(publicInput); this.reserveImportTask(input.taskId); const claim = this.columns.claim(input), connection = this.connections.get(claim.catalogue.target.connectionId);
    const request: SqliteColumnsApplyRequest = { ...input, operationId, assertCurrent, recordColumnsFact: fact => { const result: unknown = recordColumnsFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite字段事实必须同步持久化'); this.options.emit({ taskId: input.taskId, status: fact.commitAcknowledged ? 'completed' : 'running', progress: fact.commitAcknowledged ? 100 : 0, message: sqliteColumnsMessages.running, sqliteColumnsOperation: 'apply', sqliteColumns: structuredClone(fact) }); } };
    if (!connection) { const value = sqliteColumnsNotSent(claim, request); try { this.options.emit({ taskId: input.taskId, status: 'failed', progress: 0, message: sqliteColumnsMessages.notSent, sqliteColumnsOperation: 'apply', sqliteColumns: structuredClone(value.fact) }); } catch { /* 未发送事实优先。 */ } return Promise.resolve(value); }
    return this.startColumns({ taskId: input.taskId, assertCurrent }, connection, 'apply', async task => {
      let value: SqliteColumnsOutcome;
      try { this.importCheck(task); const profile = this.profile(this.options.resolveProfile(claim.catalogue.target.connectionId)); if (!claim.confirmed || profile.sqlite.readOnly || !sameTarget(profile, claim.catalogue.profile)) throw Error(sqliteColumnsMessages.stale); await this.openColumnsDriver(task, profile, false); value = await applySqliteColumns(task.driver!, claim, request, { ...this.columnControl(task), beginCommit: () => { this.importCheck(task); task.committing = true; } }); }
      catch { value = sqliteColumnsNotSent(claim, request); }
      this.columns.settle(claim, value.outcome); return value;
    });
  }

  /** 表重建任务使用原准确连接/transport账本；终态且exit确认后只留下轻量编号墓碑。 */
  private startRebuild<T extends SqliteTableRebuildResult>(input: RebuildTask['input'], connection: Connection, phase: 'inspect' | 'preview' | 'apply', action: (task: RebuildTask) => Promise<T>): Promise<T> {
    const task: RebuildTask = { kind: 'rebuild', input, connection, abort: new AbortController(), committing: false, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const retire = () => { if (!task.active && (!task.resource || !connection.resources.has(task.resource)) && this.tasks.get(input.taskId) === task) this.tasks.set(input.taskId, { kind: 'rebuild-finished' }); };
    const work = this.track(connection, async () => {
      let value: T | undefined, failure: unknown, failed = false;
      try { this.options.emit({ taskId: input.taskId, status: 'running', progress: 0, message: sqliteTableRebuildMessages.running, sqliteTableRebuildOperation: phase }); this.importCheck(task); value = await action(task); }
      catch (reason) { failure = reason; failed = true; }
      if (task.driver || task.resource) try { await this.closeImportDriver(task); } catch (reason) { const outcome = rebuildOutcome(value); if (outcome) outcome.cleanupWarning = true; else { failure = failed ? new AggregateError([failure, reason], 'SQLite表重建操作及准确资源收尾失败') : reason; failed = true; } }
      if (!failed && phase !== 'apply') try { this.importCheck(task); } catch (reason) { failure = reason; failed = true; }
      if (failed) { try { this.options.emit({ taskId: input.taskId, status: task.cancelled && !task.cleanupFailure && !task.cancelFailure ? 'cancelled' : 'failed', progress: 0, message: 'SQLite表重建操作未完成，未自动重试', sqliteTableRebuildOperation: phase }); } catch { /* 原目录/资源失败事实优先。 */ } throw failure; }
      const outcome = rebuildOutcome(value), cancelled = task.cancelled && !task.cleanupFailure && !task.cancelFailure && outcome?.outcome !== 'committed' && outcome?.outcome !== 'unknown';
      if (outcome && task.cleanupFailure) outcome.cleanupWarning = true;
      try { this.options.emit({ taskId: input.taskId, status: outcome ? outcome.outcome === 'committed' ? 'completed' : cancelled ? 'cancelled' : 'failed' : 'completed', progress: !outcome || outcome.outcome === 'committed' ? 100 : 0, message: outcome?.message ?? 'SQLite表重建目录或预览已完成，尚未执行表重建写入', sqliteTableRebuildOperation: phase, ...(outcome ? { sqliteTableRebuild: structuredClone(outcome.fact) } : {}) }); } catch { /* 原COMMIT/ROLLBACK ACK不被通知失败改变。 */ }
      return value!;
    }); task.active = work; const done = () => { task.active = undefined; retire(); }; void work.then(done, done);
    // 迟到exit仍只回收原准确资源，不解除连接blocked屏障。
    void work.finally(() => { if (task.resource) void task.resource.transport.exited.then(retire, () => {}); }).catch(() => {}); return work;
  }
  /** 同一任务的每个读取边界都复核取消/owner，收尾错误留原资源事实。 */
  private rebuildControl(task: RebuildTask) { return { check: () => this.importCheck(task), beginCleanup: () => { task.cleaning = true; }, cleanupFailed: (reason: unknown) => { task.cleanupFailure = reason; } }; }
  /** 每个独立driver都先登记准确transport，直到真实exit才可回收。 */
  private async openRebuildDriver(task: RebuildTask, profile: SqliteConnectionProfile, readOnly: boolean): Promise<void> {
    task.driver = await this.driver(task.connection, profile, readOnly, resource => { task.resource = resource; void resource.transport.exited.then(exit => { task.exit = exit; }, () => {}); }, !readOnly); this.importCheck(task);
  }
  /** 原只读utility和快照均关闭确认后才发布目录能力。 */
  private rebuildInspect(source: unknown): Promise<SqliteTableRebuildInspectOutput> {
    const raw = source as SqliteTableRebuildInspectRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite表重建检查缺少Main原文档能力'); const { assertCurrent, ...publicInput } = raw, input = sqliteTableRebuildInspectSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent();
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    return this.startRebuild({ taskId: input.taskId, assertCurrent }, connection, 'inspect', async task => { await this.openRebuildDriver(task, profile, true); const snapshot = await inspectSqliteTableRebuild(task.driver!, profile, input.table, this.rebuildControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.rebuilds.publish(snapshot); });
  }
  /** 预览保留准确RO引用直到Promise结束；自然TTL与显式撤权互不混淆。 */
  private rebuildPreview(source: unknown): Promise<SqliteTableRebuildPreviewOutput> {
    const raw = source as SqliteTableRebuildPreviewRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite表重建预览缺少Main原文档能力'); const { assertCurrent, rebuildNames, ...publicInput } = raw, input = sqliteTableRebuildPreviewSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent(); const catalogue = this.rebuilds.catalogue(input.catalogueId);
    const profile = this.profile(this.options.resolveProfile(catalogue.target.connectionId)); if (!sameTarget(profile, catalogue.profile)) throw Error(sqliteTableRebuildMessages.stale); const connection = this.connection(profile.id); this.assertTarget(connection, profile); const pin = this.rebuilds.pin(catalogue), checkOwner = () => { assertCurrent(); pin.check(); };
    try { return this.startRebuild({ taskId: input.taskId, assertCurrent: checkOwner }, connection, 'preview', async task => { await this.openRebuildDriver(task, profile, true); await verifySqliteTableRebuild(task.driver!, catalogue, this.rebuildControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.rebuilds.preview(catalogue, input.changes, rebuildNames, input.columnOrder, input.foreignKeyEdits, input.primaryKeyEdit, input.uniqueEdits, input.checkEdits); }).finally(pin.release); } catch (reason) { pin.release(); throw reason; }
  }
  /** 单次领取预览并注入Main同步回执，原写事务不借用任何用户标签会话。 */
  private rebuildApply(source: unknown): Promise<SqliteTableRebuildOutcome> {
    const raw = source as SqliteTableRebuildApplyRequest; if (!raw || typeof raw.operationId !== 'string' || !raw.operationId || raw.operationId.length > 200 || typeof raw.assertCurrent !== 'function' || typeof raw.recordRebuildFact !== 'function') throw Error('SQLite表重建提交缺少Main同步事实和原文档能力');
    const { operationId, assertCurrent, recordRebuildFact, ...publicInput } = raw, input = sqliteTableRebuildApplySchema.parse(publicInput); this.reserveImportTask(input.taskId); const claim = this.rebuilds.claim(input), connection = this.connections.get(claim.catalogue.target.connectionId);
    const request: SqliteTableRebuildApplyRequest = { ...input, operationId, assertCurrent, recordRebuildFact: fact => { const result: unknown = recordRebuildFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite表重建事实必须同步持久化'); this.options.emit({ taskId: input.taskId, status: fact.commitAcknowledged ? 'completed' : 'running', progress: fact.commitAcknowledged ? 100 : 0, message: sqliteTableRebuildMessages.running, sqliteTableRebuildOperation: 'apply', sqliteTableRebuild: structuredClone(fact) }); } };
    if (!connection) { const value = sqliteTableRebuildNotSent(claim, request); try { this.options.emit({ taskId: input.taskId, status: 'failed', progress: 0, message: sqliteTableRebuildMessages.notSent, sqliteTableRebuildOperation: 'apply', sqliteTableRebuild: structuredClone(value.fact) }); } catch { /* 未发送事实优先。 */ } return Promise.resolve(value); }
    const pin = this.rebuilds.pin(claim.catalogue); request.assertCurrent = () => { assertCurrent(); pin.check(); };
    try { return this.startRebuild({ taskId: input.taskId, assertCurrent: request.assertCurrent }, connection, 'apply', async task => {
      let value: SqliteTableRebuildOutcome, applyStarted = false;
      try { this.importCheck(task); const profile = this.profile(this.options.resolveProfile(claim.catalogue.target.connectionId)); if (!claim.confirmed || profile.sqlite.readOnly || !sameTarget(profile, claim.catalogue.profile)) throw Error(sqliteTableRebuildMessages.stale); await this.openRebuildDriver(task, profile, false); applyStarted = true; value = await applySqliteTableRebuild(task.driver!, claim, request, { ...this.rebuildControl(task), beginCommit: () => { this.importCheck(task); task.committing = true; } }); }
      catch (reason) { if (applyStarted) throw reason; value = sqliteTableRebuildNotSent(claim, request); }
      this.rebuilds.settle(claim, value.outcome); return value;
    }).finally(pin.release); } catch (reason) { pin.release(); throw reason; }
  }

  /** 表重命名共用原准确连接/transport账本；终态且exit确认后只留下轻量编号墓碑。 */
  private startTableRename<T extends SqliteTableRenameResult>(input: TableRenameTask['input'], connection: Connection, phase: 'inspect' | 'preview' | 'apply', action: (task: TableRenameTask) => Promise<T>): Promise<T> {
    const task: TableRenameTask = { kind: 'table-rename', input, connection, abort: new AbortController(), committing: false, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const retire = () => { if (!task.active && (!task.resource || !connection.resources.has(task.resource)) && this.tasks.get(input.taskId) === task) this.tasks.set(input.taskId, { kind: 'table-rename-finished' }); };
    const work = this.track(connection, async () => {
      let value: T | undefined, failure: unknown, failed = false;
      try { this.options.emit({ taskId: input.taskId, status: 'running', progress: 0, message: sqliteTableRenameMessages.running, sqliteTableRenameOperation: phase }); this.importCheck(task); value = await action(task); }
      catch (reason) { failure = reason; failed = true; }
      if (task.driver || task.resource) try { await this.closeImportDriver(task); } catch (reason) { const outcome = tableRenameOutcome(value); if (outcome) outcome.cleanupWarning = true; else { failure = failed ? new AggregateError([failure, reason], 'SQLite表重命名操作及准确资源收尾失败') : reason; failed = true; } }
      if (!failed && phase !== 'apply') try { this.importCheck(task); } catch (reason) { failure = reason; failed = true; }
      if (failed) { try { this.options.emit({ taskId: input.taskId, status: task.cancelled && !task.cleanupFailure && !task.cancelFailure ? 'cancelled' : 'failed', progress: 0, message: 'SQLite表重命名操作未完成，未自动重试', sqliteTableRenameOperation: phase }); } catch { /* 原目录/资源失败事实优先。 */ } throw failure; }
      const outcome = tableRenameOutcome(value), cancelled = task.cancelled && !task.cleanupFailure && !task.cancelFailure && outcome?.outcome !== 'committed' && outcome?.outcome !== 'unknown';
      if (outcome && task.cleanupFailure) outcome.cleanupWarning = true;
      try { this.options.emit({ taskId: input.taskId, status: outcome ? outcome.outcome === 'committed' ? 'completed' : cancelled ? 'cancelled' : 'failed' : 'completed', progress: !outcome || outcome.outcome === 'committed' ? 100 : 0, message: outcome?.message ?? 'SQLite表重命名目录或预览已完成，尚未执行重命名', sqliteTableRenameOperation: phase, ...(outcome ? { sqliteTableRename: structuredClone(outcome.fact) } : {}) }); } catch { /* 原COMMIT/ROLLBACK ACK不被通知失败改变。 */ }
      return value!;
    }); task.active = work; const done = () => { task.active = undefined; retire(); }; void work.then(done, done);
    // 迟到exit仍只回收原准确资源，不解除连接blocked屏障。
    void work.finally(() => { if (task.resource) void task.resource.transport.exited.then(retire, () => {}); }).catch(() => {}); return work;
  }
  /** 同一任务的每个读取边界都复核取消/owner，收尾错误留原资源事实。 */
  private tableRenameControl(task: TableRenameTask) { return { check: () => this.importCheck(task), beginCleanup: () => { task.cleaning = true; }, cleanupFailed: (reason: unknown) => { task.cleanupFailure = reason; } }; }
  /** 每个独立driver都先登记准确transport，直到真实exit才可回收。 */
  private async openTableRenameDriver(task: TableRenameTask, profile: SqliteConnectionProfile, readOnly: boolean): Promise<void> {
    task.driver = await this.driver(task.connection, profile, readOnly, resource => { task.resource = resource; void resource.transport.exited.then(exit => { task.exit = exit; }, () => {}); }); this.importCheck(task);
  }
  /** 原只读utility和快照均关闭确认后才发布目录能力。 */
  private tableRenameInspect(source: unknown): Promise<SqliteTableRenameInspectOutput> {
    const raw = source as SqliteTableRenameInspectRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite表重命名检查缺少Main原文档能力'); const { assertCurrent, ...publicInput } = raw, input = sqliteTableRenameInspectSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent();
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    return this.startTableRename({ taskId: input.taskId, assertCurrent }, connection, 'inspect', async task => { await this.openTableRenameDriver(task, profile, true); const snapshot = await inspectSqliteTableRename(task.driver!, profile, input.table, this.tableRenameControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.tableRenames.publish(snapshot); });
  }
  /** 预览保留准确RO引用直到Promise结束；自然TTL与显式撤权互不混淆。 */
  private tableRenamePreview(source: unknown): Promise<SqliteTableRenamePreviewOutput> {
    const raw = source as SqliteTableRenamePreviewRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite表重命名预览缺少Main原文档能力'); const { assertCurrent, ...publicInput } = raw, input = sqliteTableRenamePreviewSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent(); const catalogue = this.tableRenames.catalogue(input.catalogueId);
    const profile = this.profile(this.options.resolveProfile(catalogue.target.connectionId)); if (!sameTarget(profile, catalogue.profile)) throw Error(sqliteTableRenameMessages.stale); const connection = this.connection(profile.id); this.assertTarget(connection, profile); const pin = this.tableRenames.pin(catalogue), checkOwner = () => { assertCurrent(); pin.check(); };
    try { return this.startTableRename({ taskId: input.taskId, assertCurrent: checkOwner }, connection, 'preview', async task => { await this.openTableRenameDriver(task, profile, true); await verifySqliteTableRename(task.driver!, catalogue, this.tableRenameControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.tableRenames.preview(catalogue, input.newName); }).finally(pin.release); } catch (reason) { pin.release(); throw reason; }
  }
  /** 单次领取预览并注入Main同步回执，原写事务不借用任何用户标签会话。 */
  private tableRenameApply(source: unknown): Promise<SqliteTableRenameOutcome> {
    const raw = source as SqliteTableRenameApplyRequest; if (!raw || typeof raw.operationId !== 'string' || !raw.operationId || raw.operationId.length > 200 || typeof raw.assertCurrent !== 'function' || typeof raw.recordTableRenameFact !== 'function') throw Error('SQLite表重命名提交缺少Main同步事实和原文档能力');
    const { operationId, assertCurrent, recordTableRenameFact, ...publicInput } = raw, input = sqliteTableRenameApplySchema.parse(publicInput); this.reserveImportTask(input.taskId); const claim = this.tableRenames.claim(input), connection = this.connections.get(claim.catalogue.target.connectionId);
    const request: SqliteTableRenameApplyRequest = { ...input, operationId, assertCurrent, recordTableRenameFact: fact => { const result: unknown = recordTableRenameFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite表重命名事实必须同步持久化'); this.options.emit({ taskId: input.taskId, status: fact.commitAcknowledged ? 'completed' : 'running', progress: fact.commitAcknowledged ? 100 : 0, message: sqliteTableRenameMessages.running, sqliteTableRenameOperation: 'apply', sqliteTableRename: structuredClone(fact) }); } };
    if (!connection) { const value = sqliteTableRenameNotSent(claim, request); try { this.options.emit({ taskId: input.taskId, status: 'failed', progress: 0, message: sqliteTableRenameMessages.notSent, sqliteTableRenameOperation: 'apply', sqliteTableRename: structuredClone(value.fact) }); } catch { /* 未发送事实优先。 */ } return Promise.resolve(value); }
    return this.startTableRename({ taskId: input.taskId, assertCurrent }, connection, 'apply', async task => {
      let value: SqliteTableRenameOutcome;
      try { this.importCheck(task); const profile = this.profile(this.options.resolveProfile(claim.catalogue.target.connectionId)); if (!claim.confirmed || profile.sqlite.readOnly || !sameTarget(profile, claim.catalogue.profile)) throw Error(sqliteTableRenameMessages.stale); await this.openTableRenameDriver(task, profile, false); value = await applySqliteTableRename(task.driver!, claim, request, { ...this.tableRenameControl(task), beginCommit: () => { this.importCheck(task); task.committing = true; } }); }
      catch { value = sqliteTableRenameNotSent(claim, request); }
      this.tableRenames.settle(claim, value.outcome); return value;
    });
  }

  /** 表维护使用原准确连接/transport账本；终态且exit确认后只留下轻量编号墓碑。 */
  private startMaintenance<T extends SqliteTableMaintenanceResult>(input: MaintenanceTask['input'], connection: Connection, phase: 'inspect' | 'preview' | 'apply', action: (task: MaintenanceTask) => Promise<T>): Promise<T> {
    const task: MaintenanceTask = { kind: 'maintenance', input, connection, abort: new AbortController(), committing: false, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const retire = () => { if (!task.active && (!task.resource || !connection.resources.has(task.resource)) && this.tasks.get(input.taskId) === task) this.tasks.set(input.taskId, { kind: 'maintenance-finished' }); };
    const work = this.track(connection, async () => {
      let value: T | undefined, failure: unknown, failed = false;
      try { this.options.emit({ taskId: input.taskId, status: 'running', progress: 0, message: sqliteTableMaintenanceMessages.running, sqliteTableMaintenanceOperation: phase }); this.importCheck(task); value = await action(task); }
      catch (reason) { failure = reason; failed = true; }
      if (task.driver || task.resource) try { await this.closeImportDriver(task); } catch (reason) { const outcome = maintenanceOutcome(value); if (outcome) outcome.cleanupWarning = true; else { failure = failed ? new AggregateError([failure, reason], 'SQLite表维护操作及准确资源收尾失败') : reason; failed = true; } }
      if (!failed && phase !== 'apply') try { this.importCheck(task); } catch (reason) { failure = reason; failed = true; }
      if (failed) { try { this.options.emit({ taskId: input.taskId, status: task.cancelled && !task.cleanupFailure && !task.cancelFailure ? 'cancelled' : 'failed', progress: 0, message: 'SQLite表维护操作未完成，未自动重试', sqliteTableMaintenanceOperation: phase }); } catch { /* 原目录/资源失败事实优先。 */ } throw failure; }
      const outcome = maintenanceOutcome(value), cancelled = task.cancelled && !task.cleanupFailure && !task.cancelFailure && outcome?.outcome !== 'committed' && outcome?.outcome !== 'unknown';
      if (outcome && task.cleanupFailure) outcome.cleanupWarning = true;
      try { this.options.emit({ taskId: input.taskId, status: outcome ? outcome.outcome === 'committed' ? 'completed' : cancelled ? 'cancelled' : 'failed' : 'completed', progress: !outcome || outcome.outcome === 'committed' ? 100 : 0, message: outcome?.message ?? 'SQLite表维护目录或预览已完成，尚未执行清空或删除', sqliteTableMaintenanceOperation: phase, ...(outcome ? { sqliteTableMaintenance: structuredClone(outcome.fact) } : {}) }); } catch { /* 原COMMIT/ROLLBACK ACK不被通知失败改变。 */ }
      return value!;
    }); task.active = work; const done = () => { task.active = undefined; retire(); }; void work.then(done, done);
    // 迟到exit仍只回收原准确资源，不解除连接blocked屏障。
    void work.finally(() => { if (task.resource) void task.resource.transport.exited.then(retire, () => {}); }).catch(() => {}); return work;
  }
  /** 同一任务的每个读取边界都复核取消/owner，收尾错误留原资源事实。 */
  private maintenanceControl(task: MaintenanceTask) { return { check: () => this.importCheck(task), beginCleanup: () => { task.cleaning = true; }, cleanupFailed: (reason: unknown) => { task.cleanupFailure = reason; } }; }
  /** 每个独立driver都先登记准确transport，直到真实exit才可回收。 */
  private async openMaintenanceDriver(task: MaintenanceTask, profile: SqliteConnectionProfile, readOnly: boolean): Promise<void> {
    task.driver = await this.driver(task.connection, profile, readOnly, resource => { task.resource = resource; void resource.transport.exited.then(exit => { task.exit = exit; }, () => {}); }); this.importCheck(task);
  }
  /** 原只读utility和快照均关闭确认后才发布目录能力。 */
  private maintenanceInspect(source: unknown): Promise<SqliteTableMaintenanceInspectOutput> {
    const raw = source as SqliteTableMaintenanceInspectRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite表维护检查缺少Main原文档能力'); const { assertCurrent, ...publicInput } = raw, input = sqliteTableMaintenanceInspectSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent();
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    return this.startMaintenance({ taskId: input.taskId, assertCurrent }, connection, 'inspect', async task => { await this.openMaintenanceDriver(task, profile, true); const snapshot = await inspectSqliteTableMaintenance(task.driver!, profile, input.table, this.maintenanceControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.tableMaintenance.publish(snapshot); });
  }
  /** 预览保留准确RO引用直到Promise结束；自然TTL与显式撤权互不混淆。 */
  private maintenancePreview(source: unknown): Promise<SqliteTableMaintenancePreviewOutput> {
    const raw = source as SqliteTableMaintenancePreviewRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite表维护预览缺少Main原文档能力'); const { assertCurrent, ...publicInput } = raw, input = sqliteTableMaintenancePreviewSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent(); const catalogue = this.tableMaintenance.catalogue(input.catalogueId);
    const profile = this.profile(this.options.resolveProfile(catalogue.target.connectionId)); if (!sameTarget(profile, catalogue.profile)) throw Error(sqliteTableMaintenanceMessages.stale); const connection = this.connection(profile.id); this.assertTarget(connection, profile); const pin = this.tableMaintenance.pin(catalogue), checkOwner = () => { assertCurrent(); pin.check(); };
    try { return this.startMaintenance({ taskId: input.taskId, assertCurrent: checkOwner }, connection, 'preview', async task => { await this.openMaintenanceDriver(task, profile, true); const rowCount = await verifySqliteTableMaintenance(task.driver!, catalogue, this.maintenanceControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.tableMaintenance.preview(catalogue, input.action, input.resetSequence, rowCount); }).finally(pin.release); } catch (reason) { pin.release(); throw reason; }
  }
  /** 单次领取预览并注入Main同步回执，原写事务不借用任何用户标签会话。 */
  private maintenanceApply(source: unknown): Promise<SqliteTableMaintenanceOutcome> {
    const raw = source as SqliteTableMaintenanceApplyRequest; if (!raw || typeof raw.operationId !== 'string' || !raw.operationId || raw.operationId.length > 200 || typeof raw.assertCurrent !== 'function' || typeof raw.recordMaintenanceFact !== 'function') throw Error('SQLite表维护提交缺少Main同步事实和原文档能力');
    const { operationId, assertCurrent, recordMaintenanceFact, ...publicInput } = raw, input = sqliteTableMaintenanceApplySchema.parse(publicInput); this.reserveImportTask(input.taskId); const claim = this.tableMaintenance.claim(input), connection = this.connections.get(claim.catalogue.target.connectionId);
    const request: SqliteTableMaintenanceApplyRequest = { ...input, operationId, assertCurrent, recordMaintenanceFact: fact => { const result: unknown = recordMaintenanceFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite表维护事实必须同步持久化'); this.options.emit({ taskId: input.taskId, status: fact.commitAcknowledged ? 'completed' : 'running', progress: fact.commitAcknowledged ? 100 : 0, message: sqliteTableMaintenanceMessages.running, sqliteTableMaintenanceOperation: 'apply', sqliteTableMaintenance: structuredClone(fact) }); } };
    if (!connection) { const value = sqliteTableMaintenanceNotSent(claim, request); try { this.options.emit({ taskId: input.taskId, status: 'failed', progress: 0, message: sqliteTableMaintenanceMessages.notSent, sqliteTableMaintenanceOperation: 'apply', sqliteTableMaintenance: structuredClone(value.fact) }); } catch { /* 未发送事实优先。 */ } return Promise.resolve(value); }
    return this.startMaintenance({ taskId: input.taskId, assertCurrent }, connection, 'apply', async task => {
      let value: SqliteTableMaintenanceOutcome;
      try { this.importCheck(task); const profile = this.profile(this.options.resolveProfile(claim.catalogue.target.connectionId)); if (!claim.confirmed || profile.sqlite.readOnly || !sameTarget(profile, claim.catalogue.profile)) throw Error(sqliteTableMaintenanceMessages.stale); await this.openMaintenanceDriver(task, profile, false); value = await applySqliteTableMaintenance(task.driver!, claim, request, { ...this.maintenanceControl(task), beginCommit: () => { this.importCheck(task); task.committing = true; } }); }
      catch { value = sqliteTableMaintenanceNotSent(claim, request); }
      this.tableMaintenance.settle(claim, value.outcome); return value;
    });
  }

  /** 对象任务使用原准确连接/transport账本；终态且exit确认后只留下轻量编号墓碑。 */
  private startObjects<T extends SqliteObjectsResult>(input: ObjectsTask['input'], connection: Connection, phase: 'inspect' | 'preview' | 'apply', action: (task: ObjectsTask) => Promise<T>): Promise<T> {
    const task: ObjectsTask = { kind: 'objects', input, connection, abort: new AbortController(), committing: false, cancelled: false, boundaryCancelled: false, cleaning: false }; this.tasks.set(input.taskId, task);
    const retire = () => { if (!task.active && (!task.resource || !connection.resources.has(task.resource)) && this.tasks.get(input.taskId) === task) this.tasks.set(input.taskId, { kind: 'objects-finished' }); };
    const work = this.track(connection, async () => {
      let value: T | undefined, failure: unknown, failed = false;
      try { this.options.emit({ taskId: input.taskId, status: 'running', progress: 0, message: sqliteObjectsMessages.running, sqliteObjectsOperation: phase }); this.importCheck(task); value = await action(task); }
      catch (reason) { failure = reason; failed = true; }
      if (task.driver || task.resource) try { await this.closeImportDriver(task); } catch (reason) { const outcome = objectsOutcome(value); if (outcome) outcome.cleanupWarning = true; else { failure = failed ? new AggregateError([failure, reason], 'SQLite对象操作及准确资源收尾失败') : reason; failed = true; } }
      if (!failed && phase !== 'apply') try { this.importCheck(task); } catch (reason) { failure = reason; failed = true; }
      if (failed) { try { this.options.emit({ taskId: input.taskId, status: task.cancelled && !task.cleanupFailure && !task.cancelFailure ? 'cancelled' : 'failed', progress: 0, message: 'SQLite对象操作未完成，未自动重试', sqliteObjectsOperation: phase }); } catch { /* 原目录/资源失败事实优先。 */ } throw failure; }
      const outcome = objectsOutcome(value), cancelled = task.cancelled && !task.cleanupFailure && !task.cancelFailure && outcome?.outcome !== 'committed' && outcome?.outcome !== 'unknown';
      if (outcome && task.cleanupFailure) outcome.cleanupWarning = true;
      try { this.options.emit({ taskId: input.taskId, status: outcome ? outcome.outcome === 'committed' ? 'completed' : cancelled ? 'cancelled' : 'failed' : 'completed', progress: !outcome || outcome.outcome === 'committed' ? 100 : 0, message: outcome?.message ?? 'SQLite对象目录或预览已完成，尚未执行定义修改', sqliteObjectsOperation: phase, ...(outcome ? { sqliteObjects: structuredClone(outcome.fact) } : {}) }); } catch { /* 原COMMIT/ROLLBACK ACK不被通知失败改变。 */ }
      return value!;
    }); task.active = work; const done = () => { task.active = undefined; retire(); }; void work.then(done, done);
    // 迟到exit仍只回收原准确资源，不解除连接blocked屏障。
    void work.finally(() => { if (task.resource) void task.resource.transport.exited.then(retire, () => {}); }).catch(() => {}); return work;
  }
  /** 同一任务的每个读取边界都复核取消/owner，收尾错误留原资源事实。 */
  private objectsControl(task: ObjectsTask) { return { check: () => this.importCheck(task), beginCleanup: () => { task.cleaning = true; }, cleanupFailed: (reason: unknown) => { task.cleanupFailure = reason; } }; }
  /** 每个独立driver都先登记准确transport，直到真实exit才可回收。 */
  private async openObjectsDriver(task: ObjectsTask, profile: SqliteConnectionProfile, readOnly: boolean): Promise<void> {
    task.driver = await this.driver(task.connection, profile, readOnly, resource => { task.resource = resource; void resource.transport.exited.then(exit => { task.exit = exit; }, () => {}); }); this.importCheck(task);
  }
  /** 原只读utility和快照均关闭确认后才发布目录能力。 */
  private objectsInspect(source: unknown): Promise<SqliteObjectsInspectOutput> {
    const raw = source as SqliteObjectsInspectRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite对象检查缺少Main原文档能力'); const { assertCurrent, ...publicInput } = raw, input = sqliteObjectsInspectSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent();
    const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id); this.assertTarget(connection, profile);
    return this.startObjects({ taskId: input.taskId, assertCurrent }, connection, 'inspect', async task => { await this.openObjectsDriver(task, profile, true); const snapshot = await inspectSqliteObjects(task.driver!, profile, input, this.objectsControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.objects.publish(snapshot); });
  }
  /** 预览保留准确RO引用直到Promise结束；自然TTL与显式撤权互不混淆。 */
  private objectsPreview(source: unknown): Promise<SqliteObjectsPreviewOutput> {
    const raw = source as SqliteObjectsPreviewRequest; if (!raw || typeof raw.assertCurrent !== 'function') throw Error('SQLite对象预览缺少Main原文档能力'); const { assertCurrent, ...publicInput } = raw, input = sqliteObjectsPreviewSchema.parse(publicInput); this.reserveImportTask(input.taskId); assertCurrent(); const catalogue = this.objects.catalogue(input.catalogueId);
    const profile = this.profile(this.options.resolveProfile(catalogue.target.connectionId)); if (!sameTarget(profile, catalogue.profile)) throw Error(sqliteObjectsMessages.stale); const connection = this.connection(profile.id); this.assertTarget(connection, profile); const pin = this.objects.pin(catalogue), checkOwner = () => { assertCurrent(); pin.check(); };
    try { return this.startObjects({ taskId: input.taskId, assertCurrent: checkOwner }, connection, 'preview', async task => { await this.openObjectsDriver(task, profile, true); await verifySqliteObjects(task.driver!, catalogue, this.objectsControl(task)); await this.closeImportDriver(task); this.importCheck(task); return this.objects.preview(catalogue, input.sql); }).finally(pin.release); } catch (reason) { pin.release(); throw reason; }
  }
  /** 单次领取预览并注入Main同步回执，原写事务不借用任何用户标签会话。 */
  private objectsApply(source: unknown): Promise<SqliteObjectsOutcome> {
    const raw = source as SqliteObjectsApplyRequest; if (!raw || typeof raw.operationId !== 'string' || !raw.operationId || raw.operationId.length > 200 || typeof raw.assertCurrent !== 'function' || typeof raw.recordObjectsFact !== 'function') throw Error('SQLite对象提交缺少Main同步事实和原文档能力');
    const { operationId, assertCurrent, recordObjectsFact, ...publicInput } = raw, input = sqliteObjectsApplySchema.parse(publicInput); this.reserveImportTask(input.taskId); const claim = this.objects.claim(input), connection = this.connections.get(claim.catalogue.target.connectionId);
    const request: SqliteObjectsApplyRequest = { ...input, operationId, assertCurrent, recordObjectsFact: fact => { const result: unknown = recordObjectsFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite对象事实必须同步持久化'); this.options.emit({ taskId: input.taskId, status: fact.commitAcknowledged ? 'completed' : 'running', progress: fact.commitAcknowledged ? 100 : 0, message: sqliteObjectsMessages.running, sqliteObjectsOperation: 'apply', sqliteObjects: structuredClone(fact) }); } };
    if (!connection) { const value = sqliteObjectsNotSent(claim, request); try { this.options.emit({ taskId: input.taskId, status: 'failed', progress: 0, message: sqliteObjectsMessages.notSent, sqliteObjectsOperation: 'apply', sqliteObjects: structuredClone(value.fact) }); } catch { /* 未发送事实优先。 */ } return Promise.resolve(value); }
    return this.startObjects({ taskId: input.taskId, assertCurrent }, connection, 'apply', async task => {
      let value: SqliteObjectsOutcome;
      try { this.importCheck(task); const profile = this.profile(this.options.resolveProfile(claim.catalogue.target.connectionId)); if (!claim.confirmed || profile.sqlite.readOnly || !sameTarget(profile, claim.catalogue.profile)) throw Error(sqliteObjectsMessages.stale); await this.openObjectsDriver(task, profile, false); value = await applySqliteObjects(task.driver!, claim, request, { ...this.objectsControl(task), beginCommit: () => { this.importCheck(task); task.committing = true; } }); }
      catch { value = sqliteObjectsNotSent(claim, request); }
      this.objects.settle(claim, value.outcome); return value;
    });
  }

  /** 仅列出已经接入原工作区的命令；其余命令在SQLite终点明确拒绝。 */
  async request(command: string, input: any): Promise<any> {
    switch (command) {
      case 'connections.test': {
        const profile = this.profile(input), connection = this.connection(profile.id);
        return this.track(connection, () => this.short(connection, profile, async driver => ({ version: driver.version, dialect: 'sqlite' as const })));
      }
      case 'connections.open': {
        const profile = this.profile(input.profile ?? this.options.resolveProfile(input.id), input.id), connection = this.connection(profile.id);
        this.assertTarget(connection, profile);
        return this.track(connection, async () => {
          const status = await this.short(connection, profile, async driver => ({ version: driver.version, dialect: 'sqlite' as const }));
          if (connection.closing || connection.blocked || this.stopping) throw Error('SQLite打开期间连接已关闭或资源退出未确认，本次不发布连接');
          return status;
        });
      }
      case '__connections.prepareSave': {
        const connection = this.connections.get(input.id), next = input.profile;
        if (!next || next.id !== input.id) throw Error('SQLite配置检查缺少有效目标配置');
        const changed = input.transportChanged || connection && (!connection.profile || !sameTarget(connection.profile, next));
        if (!connection || !changed) return;
        if (connection.closing || connection.blocked || connection.pending.size || connection.resources.size || connection.files.size || [...this.sessions.values()].some(session => session.connection === connection)) throw Error('SQLite连接仍有打开的会话、运行操作或未确认资源；请先显式关闭标签并断开连接，现有任务未取消');
        this.structureSearches.releaseConnection(input.id);
        this.dataSearchReferences.releaseConnection(input.id);
        this.edits.releaseConnection(input.id); this.creates.releaseConnection(input.id); this.imports.releaseConnection(input.id); this.importSources.releaseConnection(input.id); this.indexes.releaseConnection(input.id); this.columns.releaseConnection(input.id);this.rebuilds.releaseConnection(input.id); this.objects.releaseConnection(input.id); this.tableMaintenance.releaseConnection(input.id); this.tableRenames.releaseConnection(input.id); this.connections.delete(input.id); return;
      }
      case 'connections.close': return this.closeConnection(input.id);
      case 'sessions.open': {
        this.database(input.database);
        const profile = this.profile(this.options.resolveProfile(input.connectionId), input.connectionId), connection = this.connection(profile.id);
        this.assertTarget(connection, profile);
        return this.track(connection, async () => {
          const driver = await this.driver(connection, profile);
          if (connection.closing || connection.blocked || this.stopping) { await driver.close(); throw Error('SQLite打开期间连接已关闭或资源退出未确认，本次不发布会话'); }
          const sessionId = 'sqlite:' + randomUUID();
          const query = new SqliteQuerySession(profile.id, driver, this.options.emit, sessionId);
          this.sessions.set(sessionId, { connection, profile, query, driver, closing: false }); return { sessionId };
        });
      }
      case 'sessions.close': { const session = this.sessions.get(input.sessionId); if (session) await this.closeSession(session); return; }
      case 'query.sessionState': return this.session(input.sessionId, true).query.state();
      case 'query.completionState': { const session = this.session(input.sessionId, true); return session.query.completionState(!!session.pending || !!session.userHandoff || session.closing || session.connection.closing || session.connection.blocked || this.stopping); }
      case 'query.parameterNames': { const session = this.session(input.sessionId); return this.userSessionOperation(session, async () => session.query.parameterNames(input as CommandMap['query.parameterNames']['input'])); }
      case 'query.execute':
      case 'query.executeParameterized':
      case 'query.explain': {
        const session = this.session(input.sessionId);
        if (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 200 || input.taskId.startsWith(sqliteCompletionTaskPrefix) || input.taskId.startsWith(objectDefinitionTaskPrefix) || this.tasks.has(input.taskId) || this.completionReads.has(input.taskId) || this.definitionReads.has(input.taskId)) throw Error('SQLite任务编号无效或已经使用');
        const task: QueryTask = { kind: 'query', session, preparing: true, cancelled: false }; this.tasks.set(input.taskId, task);
        const check = () => { if (task.cancelled || this.tasks.get(input.taskId) !== task) throw Error('SQLite用户操作在会话交接期间已取消，尚未发送SQL'); };
        const work = this.userSessionOperation(session, () => { check(); task.preparing = false; return command === 'query.explain' ? session.query.explain(input as CommandMap['query.explain']['input']) : command === 'query.executeParameterized' ? session.query.executeParameterized(input as CommandMap['query.executeParameterized']['input']) : session.query.execute(input as CommandMap['query.execute']['input']); }, check); task.active = work;
        void work.then(() => { task.active = undefined; }, () => { task.active = undefined; }); return work;
      }
      case 'query.transaction': { const session = this.session(input.sessionId, input.action === 'rollback'); return this.userSessionOperation(session, () => session.query.transaction(input)); }
      case 'query.cancel': {
        const definition = this.definitionReads.get(input.taskId); if (definition) return this.cancelCompletion(definition);
        const completion = this.completionReads.get(input.taskId); if (completion) return this.cancelCompletion(completion);
        const task = this.tasks.get(input.taskId);
        if (task?.active && readTask(task)) return this.cancelBrowse(task);
        if (task?.active && task.kind === 'query') try { task.cancelled = true; if (!task.preparing) await task.session.query.cancel(input.taskId); await task.active.catch(() => {}); }
        catch (reason) { if (!task.session.driver.isUsable && !task.session.driver.isClosed) this.block(task.session.connection, reason); throw reason; }
        return;
      }
      case 'sqlite.compareData': return this.compareData(input.source, input.signal, input.assertOwner, input.capture);
      case 'sqlite.compareSync.apply':
        if (!input.claim?.synchronization) throw Error('SQLite 同步缺少准确的比较预览');
        return this.tableEditApply(input.request, input.claim);
      case 'sqlite.tablePage': return this.tablePage(input);
      case 'sqlite.valueOptions': return this.valueOptions(input);
      case 'sqlite.statistics': return this.statistics(input);
      case 'sqlite.countRows': return this.statistics(input, true);
      case 'sqlite.schemaScript': {
        const source = sqliteSchemaScriptSchema.parse(input);
        // 短读自行确认 driver 关闭；边界检查只中止读取，不干预回滚或用户事务。
        return this.metadata(source, (driver, check) => readSqliteSchemaScript(driver, source, { check, beginCleanup: () => {}, cleanupFailed: () => {} }));
      }
      case 'sqlite.relationships': return this.relationships(input);
      case 'sqlite.incomingPage': return this.incoming(input);
      case 'sqlite.referencePage': return this.reference(input);
      case 'sqlite.completion': return this.completion(input);
      case 'search.catalogue': case 'search.dataStart': case 'search.recordRead': return this.searchData(command, input);
      case 'search.dataNext': return this.dataSearchScans.next(input);
      case 'search.recordsRelease': return this.dataSearchReferences.release(input);
      case 'search.dataRelease': {
        if (!this.dataSearchScans.assertOwner(input)) return;
        const task = this.definitionReads.get(input.taskId);
        if (task?.dataSearch) await this.cancelCompletion(task);
        return this.dataSearchScans.release(input);
      }
      case 'search.structure': return this.searchStructure(input, false);
      case 'search.structureContinue': return this.searchStructure(input, true);
      case 'search.release': return this.structureSearches.release(input);
      case 'query.objectDefinition': return this.objectDefinition(input);
      case 'sqlite.tableExport': return this.tableExport(input);
      // 私有命令不在公开CommandMap或IPC校验表中，只供Main草稿文件服务调用。
      case 'sqlite.tableDraft.capture': {
        if (this.stopping) throw Error('SQLite正在退出，不能保存草稿');
        return this.edits.captureDraft(input.source, input.endpointKey, input.activeSnapshotId);
      }
      case 'sqlite.tableDraft.restore': return this.tableDraftRestore(input);
      case 'sqlite.tableEdit.preview': {
        if (this.stopping || this.tasks.has(input.taskId)) throw Error('SQLite正在退出或任务编号已经使用');
        this.tasks.set(input.taskId, { kind: 'edit-preview-finished' }); return this.edits.preview(input);
      }
      case 'sqlite.tableEdit.apply': return this.tableEditApply(input);
      case 'sqlite.tableEdit.release': return this.edits.release(input);
      case 'sqlite.tableCreate.preview': return this.tableCreatePreview(input);
      case 'sqlite.tableCreate.apply': return this.tableCreateApply(input);
      case 'sqlite.tableCreate.release': return this.creates.release(sqliteTableCreateReleaseSchema.parse(input).previewId);
      case 'sqlite.tableImport.inspect': return this.tableImportInspect(input);
      case 'sqlite.indexes.inspect': return this.indexesInspect(input);
      case 'sqlite.indexes.preview': return this.indexesPreview(input);
      case 'sqlite.indexes.apply': return this.indexesApply(input);
      case 'sqlite.indexes.release': return this.indexes.release(sqliteIndexesReleaseSchema.parse(input));
      case 'sqlite.tableRebuild.inspect': return this.rebuildInspect(input);
      case 'sqlite.tableRebuild.preview': return this.rebuildPreview(input);
      case 'sqlite.tableRebuild.apply': return this.rebuildApply(input);
      case 'sqlite.tableRebuild.release': return this.rebuilds.release(sqliteTableRebuildReleaseSchema.parse(input));
      case 'sqlite.columns.inspect': return this.columnsInspect(input);
      case 'sqlite.columns.preview': return this.columnsPreview(input);
      case 'sqlite.columns.apply': return this.columnsApply(input);
      case 'sqlite.columns.release': return this.columns.release(sqliteColumnsReleaseSchema.parse(input));
      case 'sqlite.objects.inspect': return this.objectsInspect(input);
      case 'sqlite.objects.preview': return this.objectsPreview(input);
      case 'sqlite.objects.apply': return this.objectsApply(input);
      case 'sqlite.objects.release': return this.objects.release(sqliteObjectsReleaseSchema.parse(input));
      case 'sqlite.tableMaintenance.inspect': return this.maintenanceInspect(input);
      case 'sqlite.tableMaintenance.preview': return this.maintenancePreview(input);
      case 'sqlite.tableMaintenance.apply': return this.maintenanceApply(input);
      case 'sqlite.tableMaintenance.release': return this.tableMaintenance.release(sqliteTableMaintenanceReleaseSchema.parse(input));
      case 'sqlite.tableRename.inspect': return this.tableRenameInspect(input);
      case 'sqlite.tableRename.preview': return this.tableRenamePreview(input);
      case 'sqlite.tableRename.apply': return this.tableRenameApply(input);
      case 'sqlite.tableRename.release': return this.tableRenames.release(sqliteTableRenameReleaseSchema.parse(input));
      case 'sqlite.importSource.inspect': return this.importSourceInspect(input);
      case 'sqlite.importSource.release': { const id = sqliteImportSourceReleaseSchema.parse(input).sourceId; this.importSources.release(id); this.imports.releaseSource(id); return; }
      case 'sqlite.tableImport.preview': return this.tableImportPreview(input);
      case 'sqlite.tableImport.apply': return this.tableImportApply(input);
      case 'sqlite.tableImport.release': return this.imports.release(sqliteTableImportReleaseSchema.parse(input));
      case 'metadata.databases': return this.metadata(input, async () => ['main']);
      case 'metadata.objects': return this.metadata(input, async driver => {
        const rows = await this.rows(driver, "SELECT name,type FROM main.sqlite_schema WHERE type IN ('table','view','trigger') AND substr(name,1,7) <> 'sqlite_' ORDER BY type,name LIMIT 10001");
        if (rows.length > 10000) throw Error('SQLite对象数量超过10000，请缩小范围');
        return rows.map(row => ({ name: row[0], kind: row[1] })) as DatabaseObject[];
      });
      case 'metadata.ddl': return this.metadata(input, async (driver, check) => {
        if (typeof input.name !== 'string' || !input.name || /^sqlite_/i.test(input.name) ||
            !['table', 'view', 'trigger', 'index'].includes(input.kind)) throw Error('SQLite对象定义类型或名称无效');
        try {
          await driver.execute('BEGIN');
          return await readSqliteCatalogDefinition(driver, input.name, input.kind, { check });
        } finally { if (driver.isUsable && driver.transaction) await driver.execute('ROLLBACK'); }
      });
      default: throw Error('SQLite尚未接入此功能：' + command);
    }
  }

  /** 显式关闭标签先取消准确任务，并等待原execute消费者终态，然后关闭原driver。 */
  private closeSession(session: Session): Promise<void> {
    if (session.closeWork) return session.closeWork;
    session.closing = true;
    const work = (async () => {
      const active = [...this.tasks.entries()].filter(([, task]) => task.kind === 'query' && task.session === session && task.active);
      const completion = [...this.completionReads.values(), ...this.definitionReads.values()].filter(task => task.session === session && task.active);
      const cancelled = await Promise.allSettled([...active.map(([id]) => session.query.cancel(id)), ...completion.map(task => this.cancelCompletion(task))]);
      await Promise.allSettled([...(session.pending ? [session.pending] : []), ...(session.userHandoff?.work ? [session.userHandoff.work] : [])]);
      failures(cancelled, 'SQLite取消尚未确认，保留原会话');
      try { await session.query.close(); }
      catch (reason) { if (!session.driver.isClosed) this.block(session.connection, reason); throw reason; }
      this.sessions.delete(session.query.sessionId);
    })();
    session.closeWork = work; void work.catch(() => { if (session.closeWork === work) session.closeWork = undefined; }); return work;
  }
  /** 先阻新建，再取消并等原操作；未知句柄只能保持隔离，不能以kill冒充正常释放。 */
  private closeConnection(id: string): Promise<void> {
    const connection = this.connections.get(id); if (!connection) return Promise.resolve();
    if (connection.closeWork) return connection.closeWork;
    connection.closing = true;
    this.structureSearches.releaseConnection(id);
    this.dataSearchReferences.releaseConnection(id);
    this.edits.releaseConnection(id);
    this.creates.releaseConnection(id);
    this.imports.releaseConnection(id);
    this.importSources.releaseConnection(id);
    this.indexes.releaseConnection(id);
    this.columns.releaseConnection(id);this.rebuilds.releaseConnection(id); this.objects.releaseConnection(id); this.tableMaintenance.releaseConnection(id); this.tableRenames.releaseConnection(id);
    const work = (async () => {
      const browse = [...this.tasks.values()].filter((task): task is ReadTask => readTask(task) && !!task.active && (task.connection === connection || (task.kind === 'create' || task.kind === 'create-preview') && task.attachment?.connection === connection));
      const completion = [...this.completionReads.values(), ...this.definitionReads.values()].filter(task => task.connection === connection && task.active);
      const browseDrivers = new Set([...browse.map(task => task.driver), ...completion.map(task => task.session?.driver ?? task.driver)]);
      const cancelled = await Promise.allSettled([...browse.map(task => this.cancelBrowse(task)), ...completion.map(task => this.cancelCompletion(task)), ...[...connection.resources].filter(resource => resource.driver?.isBusy && !browseDrivers.has(resource.driver)).map(resource => resource.driver!.cancel())]);
      await Promise.allSettled([...connection.pending]);
      const closed = await Promise.allSettled([...this.sessions.values()].filter(session => session.connection === connection).map(session => this.closeSession(session)));
      const drivers = await Promise.allSettled([...connection.resources].filter(resource => resource.driver).map(resource => resource.driver!.close()));
      const files = await Promise.allSettled([...connection.files].map(file => file.recover()));
      failures([...cancelled, ...closed, ...drivers, ...files], 'SQLite连接收尾未全部确认，保留准确资源');
      if (connection.resources.size) throw Error('SQLite仍有未确认退出的准确句柄，连接保持关闭屏障', { cause: connection.failure });
      if (connection.files.size) throw Error('SQLite仍有未确认清理的原导出文件，保留连接关闭屏障');
      for (const [taskId, task] of this.completionReads) if (task.connection === connection) this.completionReads.delete(taskId);
      for (const [taskId, task] of this.definitionReads) if (task.connection === connection) this.definitionReads.delete(taskId);
      this.connections.delete(id);
    })();
    connection.closeWork = work; void work.catch(() => { if (connection.closeWork === work) connection.closeWork = undefined; }); return work;
  }
  /** 普通退出不因一例失败中断其它连接收尾，失败后仍可显式重试。 */
  close(): Promise<void> {
    if (this.closeWork) return this.closeWork;
    this.stopping = true;
    const work = (async () => { const results: PromiseSettledResult<unknown>[] = []; for (const id of this.connections.keys()) results.push(...await Promise.allSettled([this.closeConnection(id)])); failures(results, 'SQLite退出仍有连接资源未确认'); })();
    this.closeWork = work; void work.catch(() => { if (this.closeWork === work) this.closeWork = undefined; }); return work;
  }
  /** 强退只终止自己登记的准确transport，必须等真实exit；不通过PID或进程名扩大范围。 */
  forceClose(): Promise<void> {
    if (this.forceWork) return this.forceWork;
    this.stopping = true;
    const work = (async () => {
      for (const task of this.tasks.values()) if (readTask(task) && !committing(task) && task.active) { task.cancelled = true; if (task.kind === 'import') task.abort.abort(); }
      for (const task of this.completionReads.values()) task.cancelled = true;
      for (const task of this.definitionReads.values()) { task.cancelled = true; task.abortRead?.abort(); }
      for (const id of this.connections.keys()) { this.structureSearches.releaseConnection(id); this.edits.releaseConnection(id); this.creates.releaseConnection(id); this.imports.releaseConnection(id); this.importSources.releaseConnection(id); this.indexes.releaseConnection(id); this.columns.releaseConnection(id);this.rebuilds.releaseConnection(id); this.objects.releaseConnection(id); this.tableMaintenance.releaseConnection(id); this.tableRenames.releaseConnection(id); }
      const protectedResources = new Set([...this.tasks.values()].filter((task): task is ReadTask => readTask(task) && committing(task) && !!task.active).map(task => task.resource));
      const resources = [...this.connections.values()].flatMap(connection => { connection.closing = true; return [...connection.resources]; });
      for (const resource of resources) if (!protectedResources.has(resource)) try { resource.transport.terminate(); } catch { /* 仍等待真实exit，终止调用异常不能跳过其它句柄。 */ }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.all(resources.map(resource => resource.transport.exited)), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('SQLite强退尚未确认全部进程退出，保留准确句柄')), sqliteDriverLimits.exitTimeoutMs); timer.unref(); })]);
        await Promise.allSettled([...this.connections.values()].flatMap(connection => [...connection.pending]));
        const files = await Promise.allSettled([...this.connections.values()].flatMap(connection => [...connection.files]).map(file => file.recover())); failures(files, 'SQLite强退仍有原导出文件未确认清理');
        if ([...this.connections.values()].some(connection => connection.resources.size)) throw Error('SQLite强退资源账本仍未清零');
        if ([...this.connections.values()].some(connection => connection.files.size)) throw Error('SQLite强退原导出文件账本仍未清零');
        this.sessions.clear(); this.connections.clear(); this.completionReads.clear(); this.definitionReads.clear(); this.dataSearchReferences.close();
      } finally { clearTimeout(timer); }
    })();
    this.forceWork = work; void work.catch(() => { if (this.forceWork === work) this.forceWork = undefined; }); return work;
  }
}
