import { TableCopyDataTasks } from './tableCopyDataTasks';
import { verifyTableDraft } from './tableDraftVerify';
import { readRoutineInvocationMetadata, type RoutineInvocationInput } from './routineInvocationMetadata';
import { routineInvocationZh } from '../shared/routineInvocation.zh-CN';
import type { TableDraftVerifyInput } from '../shared/tableDraftCommands';
import { ResultInsertTasks } from './resultInsert';
import { TableFilteredUpdateTasks } from './tableFilteredUpdate';
import { TableFilteredDeleteTasks } from './tableFilteredDelete';
import { tableFilteredDeletePreviewInputSchema, tableFilteredDeleteApplyInputSchema, tableFilteredDeleteReleaseInputSchema } from '../shared/tableFilteredDelete';
import { tableFilteredUpdatePreviewInputSchema, tableFilteredUpdateApplyInputSchema, tableFilteredUpdateReleaseInputSchema } from '../shared/tableFilteredUpdate';
import { resultInsertPreviewInputSchema, resultInsertApplyInputSchema, resultInsertReleaseInputSchema } from '../shared/resultInsert';
import { TableCreateTasks } from './tableCreateTasks';
import { readServerMonitor } from './serverMonitor';
import { IndependentTaskResources, type IndependentTaskResourceLease } from './independentTaskResources';
import { CsvExportFieldCatalogs, type CsvExportFieldSnapshot } from './csvExportFields';
import { TableCopyStructureTasks } from './tableCopyStructureTasks';
import { applyTableTransaction, emptyTableApplyEvidence } from './tableApplyTransaction';
import type { TableApplyEvidence } from '../shared/tableApplyReceipt';
import type { TableApplyBinding } from '../shared/tableApplyReceipt';
import { randomUUID } from 'node:crypto';
import { SchemaCompareTasks } from './schemaCompareTasks';
import { readSchemaComparisonTarget } from './schemaCompare';
import { open, rename, rm } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { exportExcelFile, previewExcelSheet, readExcelRows } from './excelFiles';
import { ExcelReadTasks } from './excelReadTasks';
import { validateExcelMapping } from '../shared/excelTransfer';
import { validateLosslessImport } from './losslessImport';
import iconv from 'iconv-lite';
import { Types, type FieldPacket, type ResultSetHeader } from 'mysql2';
import type { CellValue, CommandMap, EngineCommand, ConnectionProfile, DataRow, QueryOutcome, QueryResult, ResultColumn, RowChange, TableDesign, TaskEvent } from '../shared/contracts';
import { connectionTransportChanged } from '../shared/connectionProfile';
import { bindQueryParameters, namedParameterTokens, queryParameterLimits, validateQueryParameters, type QueryParameter, type SqlLexicalMode } from '../shared/queryParameters';
import { canonicalReference, validateReferenceValues } from '../shared/references';
import { buildReferencePageSql, buildChildReferencePageSql, hasStableReferencePagination } from './references';
import { readIncomingReferences, resolveIncomingReference, recheckIncomingReference } from './incomingReferences';
import { readTableStatistics } from './tableStatistics';
import { readTableValueOptions } from './tableValueOptions';
import type { TableValueOptionsInput } from '../shared/tableValueOptions';
import type { TableStatisticsInput } from '../shared/tableStatistics';
import { incomingReferenceLimits, incomingReferenceMessages, type IncomingReferencesInput, type ChildReferencePageInput } from '../shared/incomingReferences';
import { connect, execute, type ManagedConnection } from './connection';
import * as metadata from './metadata';
import { completionMetadata } from './completionMetadata';
import type {CompletionMetadataInput} from '../shared/sqlCompletion';
import {completionSessionState, initialCompletionDatabase, invalidateCompletionDatabase} from './completionSession';
import {readSessionObject} from './sessionObjectRead';
import {StructureSearches} from './structureSearch';
import {DataSearchTasks} from './dataSearchTasks';
import {readDataSearchCatalogue} from './dataSearchCatalogue';
import{DataSearchRecords}from'./dataSearchRecords';
import { TableCopySources } from './tableCopySources';
import { tableCopySourceLimits } from '../shared/tableCopySource';
import {queryDatabaseFromSession} from '../shared/queryContext';
import { csvCell, csvHeader, encodingName, previewFile, readRecords, readText } from './files';
import { csvExportDelimiter } from '../shared/csvExport';
import { csvImportHasHeader } from '../shared/csvImport';
import { preflightImportFile } from './fileImportPreflight';
import type { FileImportPreflightInput } from '../shared/fileImportPreflight';
import { fileImportTransactionMode, fileImportTransactionText } from '../shared/fileImportTransaction';
import { ResultFileTasks } from './resultFileTasks';
import { TableColumnPatchTasks } from './tableColumnPatchTasks';
import { TableIndexPatchTasks } from './tableIndexPatchTasks';
import { TableRenameTasks } from './tableRenameTasks';
import { TableAutoIncrementTasks } from './tableAutoIncrementTasks';
import { TableCheckTasks } from './tableCheckTasks';
import { TableCommentTasks } from './tableCommentTasks';
import { TableDropTasks } from './tableDropTasks';
import { TableTruncateTasks } from './tableTruncateTasks';
import { DatabaseDropTasks } from './databaseDropTasks';
import { DatabaseCreateTasks } from './databaseCreateTasks';
import { DatabaseDefaultEncodingTasks } from './databaseDefaultEncodingTasks';
import { queryFailureMessage, type QueryFailureSourceRange } from '../shared/queryFailure';
import { canContinueQueryError, formatQueryScriptError, queryContinueOnErrorLimits, queryScriptReportSummary, truncateQueryScriptMessage, type QueryScriptReport } from '../shared/queryContinueOnError';
import { TableDefaultEncodingTasks } from './tableDefaultEncodingTasks';
import { TableForeignKeyPatchTasks } from './tableForeignKeyPatchTasks';
import type { StructureTaskContext, StructureTaskOptions } from './structureDefinition';
import { structureTaskQuery } from './structureDefinition';
import { StructurePatchCache } from './structurePatchCache';
import { StructureExecutionLocks } from './structureExecutionLocks';
import { parseTableColumnDefinition } from './tableColumnDefinition';
import { assertStructureExportMode, assertTableStructureExportable } from '../shared/tableColumnPatches';
import { createQueryStreamFile } from './queryStreamFile';
import { QueryInsertConfirmations } from './queryInsertConfirmations';
import { queryInsertTargetSchema } from '../shared/queryInsertExport';
import { queryInsertZh } from '../shared/queryInsertExport.zh-CN';
import { explainQuery } from './queryExplain';
import { explainLimits } from '../shared/explain';
import { analyzeQuery } from './queryAnalyze';
import { queryAnalyzeCapability } from '../shared/queryAnalyze';
import { applyQueryTransactionSettings, readQueryTransactionSettings, queryTransactionSettingsMayHaveChanged, type QueryTransactionSettingsContext } from './queryTransactionSettings';
import { consumeQueryFrames } from './queryStreamProtocol';
import { prepareTableFilteredExport, type PreparedTableFilteredExport } from './tableFilteredExport';
import { tableFilteredExportText } from '../shared/tableFilteredExport';
import { queryExportWireProtocol, queryStreamExportLimits, type QueryExportProgress, type QueryExportResultSummary, type QueryStreamExportInput, type QueryStreamExportOutput } from '../shared/queryStreamExport';
import { buildChanges, buildDesign, buildPageSql, deserializeCell, exportLiteral, identifier, inlineParameters, qualified, serializeCell, splitSql, SqlScriptScanner, typedCellPlaceholder } from './sql';
import { currentSqlStatement } from './currentStatement';
import { QueryWarningCollector } from './queryWarnings';
import type { FileImportResult, SqlFileImportReceipt } from '../shared/sqlFileImport';
import { sqlFileImportMessage } from '../shared/sqlFileImport';
import { SqlFileImportPositions } from './sqlFileImportPosition';
import { createSqlFileImportEvidence, finishSqlFileImportEvidence, sqlFileImportTransaction, type SqlFileImportEvidence } from './sqlFileImportReceipt';
import { fileImportConflict } from '../shared/fileImportConflict';
import { readFileImportKeyCatalog } from './fileImportConflictCatalog';
import { createFileImportConflictEvidence, finishFileImportConflictEvidence, importFileWithConflict, type FileImportConflictControl, type FileImportConflictEvidence } from './fileImportConflict';

interface Session { id: string; connectionId: string; managed: ManagedConnection; busy: boolean; }
interface ConflictImportLease { connectionId: string; controller: AbortController; done: Promise<void>; phase: 'connecting' | 'running' | 'closing'; evidence: FileImportConflictEvidence; }
interface RunningTask {
  id: string; managed: ManagedConnection; cancelled: boolean; inFlight: boolean; generation: number;
  cancelPending?: Promise<void>; serverStatus?: number; done: Promise<void>; finish(): void;
  tableApply?: TableApplyEvidence;
  queryExport?: QueryExportProgress; fileCommitStarted?: boolean;
  transactionSettingsChangeSubmitted?: boolean;
  continueOnErrorMode?: boolean;
  collectWarningsMode?: boolean;
  sqlFileImport?: SqlFileImportEvidence;
  fileImportConflict?: FileImportConflictEvidence;
  fileImport?: { committing: boolean; finalCommit: boolean; commitAcknowledged: boolean; committedRows: number; result?: { rows: number; errors: string[] }; failure?: Error };
}
interface ResultBudget { remainingRows: number; remainingBytes: number; remainingResults: number; }
interface IndependentTask { commitProtected?: () => boolean; connectionId: string; controller: AbortController; done: Promise<void>; managed?: ManagedConnection; resources?: IndependentTaskResourceLease; resourceCloseFailed?: boolean; cancelPending?: Promise<void>; stopPending?:Promise<void>; cancelError?: Error; cancelRequested?: boolean; actionSettled?: boolean; structureTask?: boolean; generation?: number; commandTerminal?: Promise<void>; commandInFlight?:boolean; fileFinalization?: boolean; fileCommitStarted?: boolean; fileCommitted?: boolean; }
interface IndependentFileFinalizer<T> { commit(check: () => void, start: () => void): Promise<T>; dispose(): Promise<void>; committed(): boolean; }
type Input = Record<string, any>;

/** 独立数据库进程的入口；网络连接与文件流不会进入 Electron 渲染进程。 */
export class Engine {
  private readonly excelReads = new ExcelReadTasks(event => this.emit(event));
  private readonly excelConnecting = new Map<string, { connectionId: string; controller: AbortController; done: Promise<void> }>();
  private readonly conflictImports = new Map<string, ConflictImportLease>();
  private readonly profiles = new Map<string, ConnectionProfile>();
  private readonly sessions = new Map<string, Session>();
  private readonly tasks = new Map<string, RunningTask>();
  private readonly insertConfirmations=new QueryInsertConfirmations();
  private closing = false;
  private readonly independentTasks = new Map<string, IndependentTask>();
  private readonly independentResources = new IndependentTaskResources();
  private readonly disconnecting = new Set<string>();
  private readonly connectionUses = new Map<string, number>();
  private readonly pendingUses = new Set<Promise<void>>();
  private readonly resultFiles: ResultFileTasks;
  private readonly resultInserts: ResultInsertTasks;
  private readonly tableFilteredUpdates: TableFilteredUpdateTasks;
  private readonly tableFilteredDeletes: TableFilteredDeleteTasks;
  private readonly columnPatches: TableColumnPatchTasks;
  private readonly indexPatches: TableIndexPatchTasks;
  private readonly tableDataCopies: TableCopyDataTasks;
  private readonly tableCopies: TableCopyStructureTasks;
  private readonly tableRenames: TableRenameTasks;
  private readonly tableAutoIncrements: TableAutoIncrementTasks;
  private readonly tableChecks: TableCheckTasks;
  private readonly tableComments: TableCommentTasks;
  private readonly tableDrops: TableDropTasks;
  private readonly tableTruncates: TableTruncateTasks;
  private readonly tableCreates: TableCreateTasks;
  private readonly databaseDrops: DatabaseDropTasks;
  private readonly databaseCreates: DatabaseCreateTasks;
  private readonly databaseDefaultEncodings: DatabaseDefaultEncodingTasks;
  private readonly tableDefaultEncodings: TableDefaultEncodingTasks;
  private readonly foreignKeyPatches: TableForeignKeyPatchTasks;
  private readonly schemaComparisons: SchemaCompareTasks;
  private readonly structureCache = new StructurePatchCache();
  private readonly csvExportFields = new CsvExportFieldCatalogs(this.structureCache);
  private readonly structureExecutions = new StructureExecutionLocks();
  private readonly structureSearches=new StructureSearches();
  private readonly dataSearches:DataSearchTasks;
  private readonly dataSearchRecords=new DataSearchRecords();
  private readonly tableCopySources = new TableCopySources();
  /** 注入任务事件出口，使引擎既能在 utility process 中运行，也能独立测试。 */
  constructor(private readonly emit: (event: TaskEvent) => void = () => undefined,options?:{dataSearchAcknowledgementMs?:number}) {
    this.dataSearches=new DataSearchTasks(emit,options?.dataSearchAcknowledgementMs,this.dataSearchRecords);
    this.resultFiles = new ResultFileTasks(emit);
    // 整批写入与结构执行共用目标锁，COMMIT发出后取消只能等待真实结果。
    this.resultInserts = new ResultInsertTasks({ run: (target, taskId, action, progress, execution) => this.withIndependentTask(target.connectionId, taskId, (managed, control) => action({ managed, ...control }), undefined, execution ? '写入查询结果' : '预览查询结果写入', true, () => ({ resultInsert: { ...progress } }), false, undefined, execution ? { target, commitProtected: () => progress.commitMayHaveBeenSent } : undefined) });
    // 全范围填充独占目标锁；COMMIT已发送后取消只能等待原ACK与严格关闭，不发送KILL。
    this.tableFilteredUpdates = new TableFilteredUpdateTasks({ run: (target, taskId, action, progress, execution, finalize) => this.withIndependentTask(target.connectionId, taskId, (managed, control) => action({ managed, ...control }), undefined, execution ? '填充全部筛选匹配行' : '快照全部筛选匹配行', true, () => ({ tableFilteredUpdate: { ...progress } }), false, undefined, execution ? { target, commitProtected: () => progress.commitMayHaveBeenSent } : undefined, finalize), stop: taskId => this.stopIndependentRead(taskId) });
    // 删除在独立用途和目标执行锁中运行；提交可能发送后只等待原ACK，不重放或KILL。
    this.tableFilteredDeletes = new TableFilteredDeleteTasks({ run: (target, taskId, action, progress, execution, finalize) => this.withIndependentTask(target.connectionId, taskId, (managed, control) => action({ managed, ...control }), undefined, execution ? '删除全部筛选匹配行' : '快照全部筛选匹配行', true, () => ({ tableFilteredDelete: { ...progress } }), false, undefined, execution ? { target, commitProtected: () => progress.commitMayHaveBeenSent } : undefined, finalize), stop: taskId => this.stopIndependentRead(taskId) });
    this.schemaComparisons = new SchemaCompareTasks({ read: (target, taskId) => this.withIndependentTask(target.connectionId, taskId, (managed, control) => readSchemaComparisonTarget({ managed, ...control }, target), undefined, '只读结构比较', true, undefined, true), cancel: taskId => this.cancelTask(taskId) }, emit);
    this.columnPatches = new TableColumnPatchTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), { label: options.label, purpose: 'columns', progress: options.columnPatch, executionTarget: options.executionTarget }) }, undefined, this.structureCache);
    this.indexPatches = new TableIndexPatchTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.tableDataCopies = new TableCopyDataTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.tableCopies = new TableCopyStructureTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.tableRenames = new TableRenameTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.tableAutoIncrements = new TableAutoIncrementTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.tableChecks = new TableCheckTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.tableComments = new TableCommentTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.tableDrops = new TableDropTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.tableTruncates = new TableTruncateTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.tableCreates = new TableCreateTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.databaseDrops = new DatabaseDropTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.databaseCreates = new DatabaseCreateTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.databaseDefaultEncodings = new DatabaseDefaultEncodingTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.tableDefaultEncodings = new TableDefaultEncodingTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
    this.foreignKeyPatches = new TableForeignKeyPatchTasks({ run: (connectionId, taskId, action, options) => this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), options) }, undefined, this.structureCache);
  }

  /** 主进程只注入可信 profile/filePath；其他字段按共享接口处理。 */
  async handle(command: EngineCommand, input: Input): Promise<any> {
    if (this.closing && command !== 'table.filteredDelete.release' && command !== 'table.filteredUpdate.release' && command !== 'result.insertRelease' && command !== 'schema.databaseDefaultEncoding.release' && command !== 'schema.databaseDrop.release' && command !== 'schema.tableChecks.release') throw new Error('数据库引擎正在关闭，不能开始新操作');
    switch (command) {
      case 'table.filteredDelete.preview': case 'table.filteredDelete.apply': {
        const profile = input.profile as ConnectionProfile | undefined;
        if (!profile || profile.id !== input.connectionId || !Number.isSafeInteger(input.connectionRevision) || input.connectionRevision < 0) throw Error('主进程未提供可信删除连接及修订');
        if (!this.profiles.has(profile.id)) this.profiles.set(profile.id, profile);
        const { profile: _profile, connectionRevision, ...request } = input;
        return command === 'table.filteredDelete.preview' ? this.tableFilteredDeletes.preview(tableFilteredDeletePreviewInputSchema.parse(request), connectionRevision) : this.tableFilteredDeletes.apply(tableFilteredDeleteApplyInputSchema.parse(request), connectionRevision);
      }
      case 'table.filteredDelete.release': return this.tableFilteredDeletes.release(tableFilteredDeleteReleaseInputSchema.parse(input));
      case 'table.filteredUpdate.preview': case 'table.filteredUpdate.apply': {
        const profile = input.profile as ConnectionProfile | undefined;
        if (!profile || profile.id !== input.connectionId || !Number.isSafeInteger(input.connectionRevision) || input.connectionRevision < 0) throw Error('主进程未提供可信填充连接及修订');
        if (!this.profiles.has(profile.id)) this.profiles.set(profile.id, profile);
        const { profile: _profile, connectionRevision, ...request } = input;
        return command === 'table.filteredUpdate.preview' ? this.tableFilteredUpdates.preview(tableFilteredUpdatePreviewInputSchema.parse(request), connectionRevision) : this.tableFilteredUpdates.apply(tableFilteredUpdateApplyInputSchema.parse(request), connectionRevision);
      }
      case 'table.filteredUpdate.release': return this.tableFilteredUpdates.release(tableFilteredUpdateReleaseInputSchema.parse(input));
      case 'result.insertPreview': case 'result.insertApply': {
        const profile = input.profile as ConnectionProfile | undefined;
        if (!profile || profile.id !== input.connectionId) throw Error('主进程未提供可信结果写入连接');
        if (!Number.isSafeInteger(input.connectionRevision) || input.connectionRevision < 0) throw Error('结果写入缺少可信连接修订');
        if (!this.profiles.has(profile.id)) this.profiles.set(profile.id, profile);
        const { profile: _profile, connectionRevision, ...request } = input;
        return command === 'result.insertPreview' ? this.resultInserts.preview(resultInsertPreviewInputSchema.parse(request), connectionRevision) : this.resultInserts.apply(resultInsertApplyInputSchema.parse(request), connectionRevision);
      }
      case 'result.insertRelease': return this.resultInserts.release(resultInsertReleaseInputSchema.parse(input));
      case '__connections.prepareSave': {
        const next = input.profile as ConnectionProfile;
        if (!next || next.id !== input.id) throw new Error('主进程未提供有效连接配置');
        const previous = this.profiles.get(input.id);
        const changed = input.transportChanged || (previous && connectionTransportChanged(previous, next, { preserveMissingSecrets: false }));
        if (changed && (this.connectionUses.has(input.id) || this.independentResources.retained(input.id) || [...this.sessions.values()].some(session => session.connectionId === input.id) || [...this.tasks.values()].some(task => task.managed.profile.id === input.id))) throw new Error('该连接仍有打开的会话或正在执行的操作，或存在待确认的连接资源；请先关闭相关标签并显式断开连接，再修改地址或认证配置，现有任务未被取消');
        if (changed || !previous) this.profiles.delete(input.id);
        await this.schemaComparisons.close(input.id);
        this.resultInserts.releaseConnection(input.id);
        await this.tableFilteredUpdates.releaseConnection(input.id);
        await this.tableFilteredDeletes.releaseConnection(input.id);
        this.tableRenames.releaseConnection(input.id);
        this.databaseDrops.releaseConnection(input.id);
        this.structureCache.release(input.id);
        this.structureSearches.releaseConnection(input.id);
        this.dataSearchRecords.releaseConnection(input.id);
        this.tableCopySources.releaseConnection(input.id);
        return;
      }
      case 'connections.test': return this.withConnectionUse(input.id, async () => {
        const managed = await connect(input as ConnectionProfile);
        try { return managed.status; } finally { await managed.close(); }
      });
      case 'connections.open': return this.withConnectionUse(input.id, async () => {
        const profile = input.profile as ConnectionProfile | undefined;
        if (!profile || profile.id !== input.id) throw new Error('主进程未提供有效连接配置');
        const managed = await connect(profile);
        try { this.profiles.set(profile.id, profile); return managed.status; } finally { await managed.close(); }
      });
      case 'schema.compare': {
        for (const [profile, target] of [[input.sourceProfile, input.source], [input.targetProfile, input.target]]) {
          if (!profile || profile.id !== target.connectionId) throw new Error('主进程未提供有效结构比较连接配置');
          if (!this.profiles.has(profile.id)) this.profiles.set(profile.id, profile);
        }
        if (this.taskIdInUse(input.taskId)) throw new Error('任务编号已使用');
        return this.withConnectionUse(input.source.connectionId, () => this.withConnectionUse(input.target.connectionId, () => this.schemaComparisons.compare({ taskId: input.taskId, source: input.source, target: input.target }, input.connectionRevision)));
      }
      case 'schema.comparePreview': return this.schemaComparisons.preview({ snapshotId: input.snapshotId, selections: input.selections }, input.connectionRevision);
      case 'schema.compareRelease': return this.schemaComparisons.release(input.snapshotId);
      case 'connections.close': {
        if (this.disconnecting.has(input.id)) throw Error('该连接正在断开，请等待本次资源回收完成');
        this.disconnecting.add(input.id);
        try {
        const comparisonCleanup = this.schemaComparisons.close(input.id);
        const filteredUpdateCleanup = this.tableFilteredUpdates.releaseConnection(input.id);
        const filteredDeleteCleanup = this.tableFilteredDeletes.releaseConnection(input.id);
        this.resultInserts.releaseConnection(input.id);
        this.tableRenames.releaseConnection(input.id);
        this.databaseDrops.releaseConnection(input.id);
        this.dataSearchRecords.releaseConnection(input.id);
        this.tableCopySources.releaseConnection(input.id);
        this.structureCache.release(input.id);
        this.structureSearches.releaseConnection(input.id);
        const connecting = [...this.excelConnecting.values()].filter(task => task.connectionId === input.id);
        connecting.forEach(task => task.controller.abort());
        const conflicts = [...this.conflictImports.values()].filter(task => task.connectionId === input.id);
        conflicts.forEach(task => { if (task.phase === 'connecting') task.controller.abort(); });
        const active = [...this.tasks.values()].filter(task => task.managed.profile.id === input.id);
        const independent = [...this.independentTasks].filter(([, task]) => task.connectionId === input.id);
        const cancellations = await Promise.allSettled([comparisonCleanup, filteredUpdateCleanup, filteredDeleteCleanup, ...active.map(task => this.cancelTask(task.id)), ...independent.map(([id]) => this.cancelTask(id))]);
        await Promise.all([...connecting.map(task => task.done), ...conflicts.map(task => task.done), ...active.map(task => task.done), ...independent.map(([, task]) => task.done)]);
        for (const [id, session] of this.sessions) if (session.connectionId === input.id) { await session.managed.close(); this.sessions.delete(id); }
        const recovered = await this.independentResources.recover(input.id);
        if (recovered.remaining) throw Error('独立任务连接资源尚未确认释放，请核对服务器及隧道状态后再次显式断开；原操作未重放');
        this.profiles.delete(input.id);
        this.dataSearchRecords.releaseConnection(input.id);
        this.tableCopySources.releaseConnection(input.id);
        this.structureCache.release(input.id);
        const failed = cancellations.find(result => result.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
        // 仅显式断开且原任务与物理资源均已证实收尾，才解除数据库属性的保守隔离锁。
        this.databaseDefaultEncodings.releaseConnection(input.id);
        return;
        } finally { this.disconnecting.delete(input.id); }
      }
      case 'sessions.open': return this.withConnectionUse(input.connectionId, async () => {
        const managed = await connect(this.profile(input.connectionId), input.database);
        const sessionId = randomUUID();
        this.sessions.set(sessionId, { id: sessionId, connectionId: input.connectionId, managed, busy: false });
        return { sessionId };
      });
      case 'sessions.close': {
        const session = this.sessions.get(input.sessionId);
        if (!session) return;
        const active = [...this.tasks.values()].filter(task => task.managed === session.managed);
        await Promise.all(active.map(task => this.cancelTask(task.id)));
        await Promise.all(active.map(task => task.done));
        if (session.busy) throw new Error('会话操作尚未结束，请稍后关闭');
        await session.managed.close(); this.sessions.delete(input.sessionId); return;
      }
      case 'metadata.databases': return this.withConnection(input.connectionId, connection => metadata.databases(connection));
      // 监控只用独立短连接，不借用SQL标签事务；原任务严格收尾后才交还快照。
      case 'serverMonitor.read': {
        this.copySourceProfile(input);
        return this.withIndependentTask(input.connectionId, input.taskId,
          (managed, control) => readServerMonitor({ managed, ...control }, { connectionId: input.connectionId, taskId: input.taskId, ...(input.sessionLimit !== undefined ? { sessionLimit: input.sessionLimit } : {}) }),
          undefined, '读取服务器监控', true, () => ({}));
      }
      case 'search.structure':case 'search.structureContinue':{
        const profile=input.profile as ConnectionProfile|undefined;
        if(!profile||profile.id!==input.connectionId)throw Error('主进程未提供有效搜索连接配置');
        if(!this.profiles.has(profile.id))this.profiles.set(profile.id,profile);
        const run=<T>(action:(managed:ManagedConnection,control:Pick<StructureTaskContext,'checkCancelled'|'commandStarted'>)=>Promise<T>)=>this.withIndependentTask(input.connectionId,input.taskId,action,undefined,'搜索结构',true);
        // profile是主进程专用字段，不属于可传入或续页修改的公开搜索范围。
        const {profile:_,...request}=input;
        return command==='search.structure'?this.structureSearches.start(request,run):this.structureSearches.next(request,run);
      }
      case 'search.release':return this.structureSearches.release(input);
      case 'search.dataStart':{
        const {profile,...request}=input;
        if(!profile||profile.id!==input.connectionId)throw Error('主进程未提供有效数据搜索连接配置');
        if(!this.profiles.has(profile.id))this.profiles.set(profile.id,profile);
        return this.dataSearches.start(request,action=>this.withIndependentTask(input.connectionId,input.taskId,(managed,control)=>action({managed,...control,stop:()=>this.stopIndependentRead(input.taskId)}),undefined,'搜索数据',true,()=>this.dataSearches.detail(input.taskId)));
      }
      case 'search.dataNext':return this.dataSearches.next(input);
      case 'search.recordsRelease':return this.dataSearchRecords.release(input);
      case 'search.recordRead':{
        const{profile,...request}=input;if(!profile||profile.id!==input.connectionId)throw Error('主进程未提供有效记录连接配置');if(!this.profiles.has(profile.id))this.profiles.set(profile.id,profile);
        return this.withIndependentTask(input.connectionId,input.taskId,(managed,control)=>this.dataSearchRecords.read({managed,...control},request),undefined,'正在定位命中记录',true);
      }
      case 'search.catalogue':{
        const{profile,...request}=input;if(!profile||profile.id!==input.connectionId)throw Error('主进程未提供有效范围连接配置');if(!this.profiles.has(profile.id))this.profiles.set(profile.id,profile);
        return this.withIndependentTask(input.connectionId,input.taskId,(managed,control)=>readDataSearchCatalogue({managed,...control},request),undefined,'读取搜索范围',true);
      }
      case 'search.dataRelease':
        if(!this.dataSearches.assertOwner(input))return;await this.cancelTask(input.taskId);return this.dataSearches.release(input);
      case 'metadata.completion': {
        // 主进程注入保存配置即可启动可取消短读，不额外开一次不可取消的测试连接。
        const profile=input.profile as ConnectionProfile|undefined;
        if(profile){if(profile.id!==input.connectionId)throw new Error('补全连接配置目标不符');if(!this.profiles.has(profile.id))this.profiles.set(profile.id,profile);}
        // 补全结果也须等待原流真实关闭，不能在 QUIT 回调先到时被资源确认门拒绝。
        return this.withIndependentTask(input.connectionId,input.taskId,(managed,control)=>completionMetadata(managed,input as CompletionMetadataInput,control),undefined,'读取补全元数据',true);
      }
      case 'metadata.objects': return this.withConnection(input.connectionId, connection => metadata.objects(connection, input.database));
      case 'metadata.routineInvocation': {
        // Main注入保存配置；直接进入独立短会话，不触碰现有查询事务或先开不可取消连接。
        if (input.profile) this.copySourceProfile(input);
        return this.withIndependentTask(input.connectionId, input.taskId, (managed, control) => readRoutineInvocationMetadata({ managed, ...control }, input as RoutineInvocationInput), undefined, routineInvocationZh.reading, true);
      }
      case 'metadata.table': {
        // 方案应用由Main补充已验证配置，直接进入原独立元数据租约；不另开无法取消的连接。
        if(input.profile)this.copySourceProfile(input);
        return input.taskId ? this.withIndependentTask(input.connectionId, input.taskId, async (connection, control) => {
        // 独立预览元数据也等待实际目录查询终态和连接关闭；KILL ACK 不能替代资源收尾。
        const ended = control.commandStarted();
        try { return await metadata.tableInfo(connection, input.database, input.table); }
        finally { ended(); }
      }, undefined, '读取表格元数据', true) : this.withConnection(input.connectionId, connection => metadata.tableInfo(connection, input.database, input.table));
      }
      case 'metadata.ddl': return this.withConnection(input.connectionId, connection => metadata.objectDdl(connection, input.database, input.name, input.kind));
      case 'query.execute': return this.withSession(input.sessionId, managed => this.runTask(input.taskId, managed, '执行 SQL', task => this.queryScript(task, input.sql, input.maxRows, undefined, input.currentStatement, 'query', input.continueOnError, input.collectWarnings), outcome => outcome.failure ? { status: 'failed', message: outcome.failure.message } : undefined));
      case 'query.exportStream': {
        this.assertFile(input);
        return this.withSession(input.sessionId, managed => this.runTask(input.taskId, managed, '执行 SQL 并完整导出', task => this.exportQueryStream(task, input as QueryStreamExportInput & { filePath: string })));
      }
      case 'query.confirmInsertExport':this.insertConfirmations.confirm({taskId:input.taskId,previewToken:input.previewToken,confirmation:input.confirmation});return;
      case 'query.parameterNames': return this.withSession(input.sessionId, async managed => {
        const mode = await this.sqlMode(managed);
        const preview = this.parameterPlan(input.sql, mode);
        return { names: preview.names, ...mode, warnings: preview.warnings, maxDecimalScale: this.maxDecimalScale(managed), allowTimeEndpointFraction: managed.status.dialect === 'mariadb' };
      });
      case 'query.sessionState': {
        // 即使会话已断开也允许读取缓存；此命令不建连、不查询、不改变事务与诊断状态。
        const session = this.sessions.get(input.sessionId);
        if (!session) throw new Error('会话不存在，请重新打开标签页');
        const { managed } = session;
        return { transactionOpen: managed.serverStatus !== undefined && (managed.serverStatus & 1) !== 0, transactionKnown: managed.serverStatus !== undefined && managed.transactionStateKnown !== false, broken: managed.broken || managed.serverStatus === undefined };
      }
      case 'query.completionState': {
        // 只读缓存不排队、不建连、不查询，不能改变ROW_COUNT、警告、事务或临时表。
        const session=this.sessions.get(input.sessionId);if(!session)throw new Error('会话不存在，请重新打开标签页');
        return completionSessionState(session.managed,session.busy);
      }
      case 'query.executeParameterized': return this.withSession(input.sessionId, managed => this.runTask(input.taskId, managed, '执行参数查询', task => this.queryScript(task, input.sql, input.maxRows, input.parameters, undefined, 'parameterized', input.continueOnError, input.collectWarnings), outcome => outcome.failure ? { status: 'failed', message: outcome.failure.message } : undefined));
      case 'query.temporaryState':{
        const session=this.sessions.get(input.sessionId);if(!session?.managed.sessionObjects)throw new Error('会话对象目录不存在，请重新连接');
        return session.managed.sessionObjects.snapshot(session.busy,session.managed.broken);
      }
      case 'query.temporaryCompletion':{
        const session=this.sessions.get(input.sessionId);if(!session?.managed.sessionObjects)throw new Error('会话对象目录不存在，请重新连接');if(session.busy||session.managed.broken)throw new Error('会话对象目录暂不可用');
        return session.managed.sessionObjects.completion(input.kind==='objects'?{kind:'objects',database:input.database,prefix:input.prefix,objectKind:'relation'}:{kind:'columns',database:input.database,table:input.table,prefix:input.prefix,...(input.details?{details:true}:{})});
      }
      case 'query.temporaryRead':return this.withSession(input.sessionId,managed=>this.runTask(input.taskId,managed,'读取会话临时对象结构',task=>readSessionObject(managed,{database:input.database,table:input.table},{start:()=>{this.checkCancelled(task);task.inFlight=true;task.generation++;},check:()=>this.checkCancelled(task),finish:async()=>{task.inFlight=false;await task.cancelPending;}})));
      case 'query.explain': return this.withSession(input.sessionId, managed => this.runTask(input.taskId, managed, '查看执行计划', async task => {
        if (!Number.isInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > 100000 || ![undefined, 'auto', 'text'].includes(input.format)) throw Error('执行计划参数无效');
        const mode = await this.sqlMode(managed, task);
        const result = await explainQuery(input.sql, input.format ?? 'auto', {
          status: managed.status, mode, check: () => this.checkCancelled(task), reusable: () => !managed.broken && managed.serverStatus !== undefined,
          run: sql => this.streamQuery(task, sql, Math.min(input.maxRows, explainLimits.textRows), 0, { remainingRows: Math.min(input.maxRows, explainLimits.textRows), remainingBytes: 1024 * 1024, remainingResults: 1 }),
        });
        if (managed.serverStatus === undefined) { managed.broken = true; managed.connection.destroy(); }
        return { ...result, transactionOpen: managed.serverStatus === undefined ? undefined : Boolean(managed.serverStatus & 1) };
      }));
      case 'query.analyzeContext': return this.withSession(input.sessionId, managed => this.runTask(input.taskId, managed, '读取实际分析上下文', async task => {
        const capability = queryAnalyzeCapability(managed.status);
        if (!capability.supported) throw Error(capability.reason ?? '当前服务器不支持实际执行分析');
        // 仅此显式入口读取内置函数，既不接收用户SQL，也不提交、切库或建立替代会话。
        const results = await this.streamQuery(task, 'SELECT DATABASE() AS __dbark_analyze_database', 1, 0, { remainingRows: 1, remainingBytes: 4096, remainingResults: 1 });
        const result = results[0], value = result?.rows[0]?.[result.columns[0]?.key];
        if (results.length !== 1 || result.columns.length !== 1 || result.rows.length !== 1 || result.truncated || !(value === null || typeof value === 'string')) {
          invalidateCompletionDatabase(managed); throw Error('无法完整确认原会话的实际默认库，未允许执行分析');
        }
        managed.completionDatabase = initialCompletionDatabase(value);
        const state = completionSessionState(managed, false);
        if (state.broken || !state.databaseKnown) throw Error('无法确认原会话的实际默认库，未允许执行分析');
        return state;
      }));
      case 'query.analyze': return this.withSession(input.sessionId, managed => this.runTask(input.taskId, managed, '实际执行分析', async task => {
        if (input.acknowledged !== true || !Number.isInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > 100000 || !(input.expectedDatabase === null || typeof input.expectedDatabase === 'string' && input.expectedDatabase.length > 0 && input.expectedDatabase.length <= 64)) throw Error('实际执行分析参数无效或尚未确认');
        const capability = queryAnalyzeCapability(managed.status);
        if (!capability.supported) throw Error(capability.reason ?? '当前服务器不支持实际执行分析');
        // 确认的是原物理会话的真实默认库；未知、切库或断线后均不能执行旧确认。
        const assertDatabase = () => {
          this.checkCancelled(task);
          if (managed.broken || !managed.completionDatabase?.known || managed.completionDatabase.database !== input.expectedDatabase) throw Error('会话默认库自确认后已变化或未知，请重新打开实际执行分析');
        };
        assertDatabase();
        const mode = await this.sqlMode(managed, task);
        assertDatabase();
        const result = await analyzeQuery(input.sql, input.acknowledged, {
          status: managed.status, mode, check: () => this.checkCancelled(task), reusable: () => !managed.broken && managed.serverStatus !== undefined,
          run: sql => { assertDatabase(); return this.streamQuery(task, sql, Math.min(input.maxRows, explainLimits.textRows), 0, { remainingRows: Math.min(input.maxRows, explainLimits.textRows), remainingBytes: 1024 * 1024, remainingResults: 1 }, sql, true); },
        });
        if (managed.serverStatus === undefined) { managed.broken = true; managed.connection.destroy(); }
        return { ...result, transactionOpen: managed.serverStatus === undefined ? undefined : Boolean(managed.serverStatus & 1) };
      }));
      case 'query.cancel': return this.cancelTask(input.taskId);
      case 'query.transaction': return this.withSession(input.sessionId, async managed => {
        const actions: Record<string, string> = { begin: 'START TRANSACTION', commit: 'COMMIT', rollback: 'ROLLBACK' };
        if (!Object.hasOwn(actions, input.action)) throw new Error('事务操作无效');
        await execute(managed, actions[input.action]);
      });
      case 'query.transactionSettings.read': return this.withSession(input.sessionId, managed => this.runTask(input.taskId, managed, '读取本会话事务默认设置', task => readQueryTransactionSettings(this.transactionSettingsContext(managed, task))));
      case 'query.transactionSettings.apply': return this.withSession(input.sessionId, async managed => {
        let setMayHaveBeenSent = false;
        try {
          return await this.runTask(input.taskId, managed, '修改本会话事务默认设置', task => applyQueryTransactionSettings(input.expected, input.isolation, input.readOnly, this.transactionSettingsContext(managed, task, () => { setMayHaveBeenSent = true; })));
        } catch (error) {
          // runTask尾部也会检查取消；SET已发后此处仍须保留“可能改变”的边界。
          if (setMayHaveBeenSent) throw queryTransactionSettingsMayHaveChanged(error);
          throw error;
        }
      });
      case 'table.copySourceRead': {
        this.copySourceProfile(input);
        // 主进程配置仅用于建连，不能混入严格的公开租约输入；其余额外字段继续拒绝。
        const { profile: trustedProfile, ...request } = input;
        return this.withCopySourceTask(input.connectionId, input.taskId, context => this.tableCopySources.read(context, request));
      }
      case 'table.copySourceRelease': return this.tableCopySources.release(input);
      case 'table.page': if (input.copySource) {
        this.copySourceProfile(input);
        return this.withCopySourceTask(input.connectionId, input.taskId, context => this.tableCopySources.page(context, input as CommandMap['table.page']['input'], (managed, sql, page, pageSize, binary) => this.readPage(managed, sql, page, pageSize, binary, true)));
      } else return this.withConnection(input.connectionId, async managed => {
        const info = await metadata.tableInfo(managed, input.database, input.table);
        const statement = buildPageSql(info, input.page, input.pageSize, input.filters, input.sort, input.filterMode, input.filterGroup);
        // 筛选值用十六进制字面量嵌入已验证模板，避免文本协议受 SQL 转义模式影响。
        const sql = inlineParameters(statement.sql, statement.params);
        return this.readPage(managed, sql, input.page, input.pageSize, info.columns.some(column => /^(?:FLOAT|DOUBLE|REAL)\b/i.test(column.type)));
      });
      case 'table.incomingReferences': {
        this.copySourceProfile(input);
        return this.withIndependentTask(input.connectionId, input.taskId, (managed, control) => readIncomingReferences({ managed, ...control }, input as IncomingReferencesInput), undefined, '读取引用此表的子表', true);
      }
      case 'table.statistics': {
        this.copySourceProfile(input);
        return this.withIndependentTask(input.connectionId, input.taskId, (managed, control) => readTableStatistics({ managed, ...control }, input as TableStatisticsInput, () => this.stopIndependentRead(input.taskId)), undefined, '统计服务器筛选数据', true);
      }
      case 'table.valueOptions': {
        this.copySourceProfile(input);
        // 候选使用独立只读会话；原终包与严格连接清理完成后才发布，不读取父页草稿。
        return this.withIndependentTask(input.connectionId, input.taskId, (managed, control) => readTableValueOptions({ managed, ...control }, input as TableValueOptionsInput, () => this.stopIndependentRead(input.taskId)), undefined, '读取服务器不同值', true);
      }
      case 'table.exportFiltered': {
        this.assertFile(input); this.copySourceProfile(input);
        let prepared: PreparedTableFilteredExport | undefined; let beginCommit: () => void = () => { throw Error('文件发布尚未获得原数据库收尾授权'); };
        const finalizer: IndependentFileFinalizer<import('../shared/tableFilteredExport').TableFilteredExportOutput> = {
          async commit(check, start) { check(); if (!prepared) throw Error('完整导出暂存尚未完成'); beginCommit = start; return prepared.commit(); },
          dispose: async () => { await prepared?.dispose(); }, committed: () => prepared?.fileCommitted === true,
        };
        return this.withIndependentTask(input.connectionId, input.taskId, async (managed, control) => {
          prepared = await prepareTableFilteredExport({ managed, ...control }, input as import('../shared/tableFilteredExport').TableFilteredExportInput & { filePath: string }, {
            stop: () => this.stopIndependentRead(input.taskId), onCommitStart: () => beginCommit(),
            onProgress: rows => this.emit({ taskId: input.taskId, status: 'running', progress: 0, message: tableFilteredExportText.label, rows }),
          });
          return { rows: prepared.rows, fileCommitted: true as const };
        }, undefined, tableFilteredExportText.label, true, undefined, false, finalizer);
      }
      case 'table.childReferencePage': {
        this.copySourceProfile(input);
        return this.withIndependentTask(input.connectionId, input.taskId, async (managed, control) => {
          const request = input as ChildReferencePageInput; validateReferenceValues(request.matchValues);
          const context = { managed, ...control }, current = await resolveIncomingReference(context, request, request.relation);
          const sql = buildChildReferencePageSql(current.source, current.target, current.relation.foreignKey, request.matchValues, request.page, request.pageSize, request.filters, request.sort, request.filterMode, request.filterGroup);
          const ended = control.commandStarted(); let page;
          try { page = await this.readPage(managed, sql, request.page, request.pageSize, current.target.columns.some(column => /^(?:FLOAT|DOUBLE|REAL)\b/i.test(column.type)), true); }
          finally { ended(); }
          control.checkCancelled(); await recheckIncomingReference(context, request, request.relation, current);
          const result = { source: current.source, sourceDigest: current.sourceDigest, relation: current.relation, target: current.target, page, stablePagination: hasStableReferencePagination(current.target) };
          if (Buffer.byteLength(JSON.stringify(result)) > incomingReferenceLimits.bytes) throw Error(incomingReferenceMessages.budget);
          return result;
        }, undefined, '读取关联子记录', true);
      }
      case 'table.referencePage': return this.withIndependentTask(input.connectionId, input.taskId, async managed => {
        if (input.matchValues !== undefined) validateReferenceValues(input.matchValues);
        const source = await metadata.tableInfo(managed, input.database, input.table);
        const matches = source.foreignKeys.filter(key => key.name.toLowerCase() === String(input.foreignKeyName).toLowerCase());
        if (matches.length !== 1) throw new Error('外键已不存在或名称不明确，请刷新表结构');
        const current = matches[0];
        const target = await metadata.tableInfo(managed, current.referencedDatabase, current.referencedTable);
        const foreignKey = canonicalReference(source, current, target);
        const sql = buildReferencePageSql(target, foreignKey, input.matchValues, input.page, input.pageSize, input.filters, input.sort, input.filterMode, input.filterGroup);
        const page = await this.readPage(managed, sql, input.page, input.pageSize, target.columns.some(column => /^(?:FLOAT|DOUBLE|REAL)\b/i.test(column.type)));
        return { source, foreignKey, target, page };
      });
      case 'table.draftVerify': {
        this.copySourceProfile(input);
        return this.withIndependentTask(input.connectionId, input.taskId, (managed, control) => verifyTableDraft({ managed, ...control }, input as TableDraftVerifyInput), undefined, '核对待恢复草稿原行', true);
      }
      case 'table.preview': return this.withConnection(input.connectionId, async managed => buildChanges(await metadata.tableInfo(managed, input.database, input.table), input.changes));
      case 'table.apply': return this.withConnection(input.connectionId, managed => this.runTask(input.taskId, managed, '提交数据修改', task => this.applyChanges(task, input)));
      case 'schema.preview': return this.withConnection(input.connectionId, async managed => {
        const design = input.design as TableDesign;
        const original = design.originalName ? await metadata.tableInfo(managed, design.database, design.originalName) : undefined;
        if ((original as { unsupportedDesign?: boolean } | undefined)?.unsupportedDesign) throw new Error('表包含复杂索引、不可见属性或表达式默认值，请使用 SQL 定义编辑以保留这些属性');
        if (original && /^\s*`.*\b(?:COLLATE|CHARACTER SET|ON UPDATE|INVISIBLE|COLUMN_FORMAT|STORAGE|CHECK)\b/im.test(original.ddl)) throw new Error('表字段包含设计器尚未支持的属性，请使用 SQL 定义编辑以保留属性');
        return buildDesign(design, original, await this.noBackslashEscapes(managed));
      });
      case 'schema.apply': return this.withConnection(input.connectionId, managed => this.runTask(input.taskId, managed, '执行结构变更', task => this.queryScript(task, input.sql, 1000)), input.database);
      case 'schema.columns.get': return this.columnPatches.get(input as any, input.connectionRevision);
      case 'schema.columns.preview': return this.columnPatches.preview(input as any, input.connectionRevision);
      case 'schema.columns.apply': return this.columnPatches.apply(input as any, input.connectionRevision);
      case 'schema.columns.release': return this.columnPatches.releaseTokens(input);
      case 'schema.indexes.get': return this.indexPatches.get(input as any, input.connectionRevision);
      case 'schema.tableCopyData.get': return this.tableDataCopies.get(input as any, input.connectionRevision);
      case 'schema.tableCopyData.preview': return this.tableDataCopies.preview(input as any, input.connectionRevision);
      case 'schema.tableCopyData.apply': return this.tableDataCopies.apply(input as any, input.connectionRevision);
      case 'schema.tableCopyData.release': return this.tableDataCopies.releaseTokens(input);
      case 'schema.tableCopyStructure.get': return this.tableCopies.get(input as any, input.connectionRevision);
      case 'schema.tableCopyStructure.preview': return this.tableCopies.preview(input as any, input.connectionRevision);
      case 'schema.tableCopyStructure.apply': return this.tableCopies.apply(input as any, input.connectionRevision);
      case 'schema.tableCopyStructure.release': return this.tableCopies.releaseTokens(input);
      case 'schema.tableRename.get': return this.tableRenames.get(input as any, input.connectionRevision);
      case 'schema.tableRename.preview': return this.tableRenames.preview(input as any, input.connectionRevision);
      case 'schema.tableRename.apply': return this.tableRenames.apply(input as any, input.connectionRevision);
      case 'schema.tableRename.release': return this.tableRenames.releaseTokens(input);
      case 'schema.tableAutoIncrement.get': return this.tableAutoIncrements.get(input as any, input.connectionRevision);
      case 'schema.tableAutoIncrement.preview': return this.tableAutoIncrements.preview(input as any, input.connectionRevision);
      case 'schema.tableAutoIncrement.apply': return this.tableAutoIncrements.apply(input as any, input.connectionRevision);
      case 'schema.tableAutoIncrement.release': return this.tableAutoIncrements.releaseTokens(input);
      case 'schema.tableChecks.get': {
        const { profile, connectionRevision, ...request } = input;
        if (!profile || profile.id !== request.connectionId) throw Error('主进程未提供准确的检查约束连接配置');
        this.copySourceProfile(input);
        return this.tableChecks.get(request as any, connectionRevision);
      }
      case 'schema.tableChecks.preview': {
        const { connectionRevision, ...request } = input;
        return this.tableChecks.preview(request as any, connectionRevision);
      }
      case 'schema.tableChecks.apply': {
        const { connectionRevision, ...request } = input;
        return this.tableChecks.apply(request as any, connectionRevision);
      }
      case 'schema.tableChecks.release': return this.tableChecks.releaseTokens(input);
      case 'schema.tableComment.get': return this.tableComments.get(input as any, input.connectionRevision);
      case 'schema.tableCreate.get': return this.tableCreates.get(input as any, input.connectionRevision);
      case 'schema.tableCreate.preview': return this.tableCreates.preview(input as any, input.connectionRevision);
      case 'schema.tableCreate.apply': return this.tableCreates.apply(input as any, input.connectionRevision);
      case 'schema.tableCreate.release': return this.tableCreates.releaseTokens(input);
      case 'schema.databaseDrop.get': return this.databaseDrops.get(input as any, input.connectionRevision);
      case 'schema.databaseDrop.preview': return this.databaseDrops.preview(input as any, input.connectionRevision);
      case 'schema.databaseDrop.apply': return this.databaseDrops.apply(input as any, input.connectionRevision);
      case 'schema.databaseDrop.release': return this.databaseDrops.releaseTokens(input);
      case 'schema.databaseCreate.get': return this.databaseCreates.get(input as any, input.connectionRevision);
      case 'schema.databaseDefaultEncoding.get': return this.databaseDefaultEncodings.get(input as any, input.connectionRevision);
      case 'schema.databaseDefaultEncoding.preview': return this.databaseDefaultEncodings.preview(input as any, input.connectionRevision);
      case 'schema.databaseDefaultEncoding.apply': return this.databaseDefaultEncodings.apply(input as any, input.connectionRevision);
      case 'schema.databaseDefaultEncoding.release': return this.databaseDefaultEncodings.releaseTokens(input);
      case 'schema.databaseCreate.preview': return this.databaseCreates.preview(input as any, input.connectionRevision);
      case 'schema.databaseCreate.apply': return this.databaseCreates.apply(input as any, input.connectionRevision);
      case 'schema.databaseCreate.release': return this.databaseCreates.releaseTokens(input);
      case 'schema.tableDefaultEncoding.get': return this.tableDefaultEncodings.get(input as any, input.connectionRevision);
      case 'schema.tableDefaultEncoding.preview': return this.tableDefaultEncodings.preview(input as any, input.connectionRevision);
      case 'schema.tableDefaultEncoding.apply': return this.tableDefaultEncodings.apply(input as any, input.connectionRevision);
      case 'schema.tableDefaultEncoding.release': return this.tableDefaultEncodings.releaseTokens(input);
      case 'schema.tableComment.preview': return this.tableComments.preview(input as any, input.connectionRevision);
      case 'schema.tableComment.apply': return this.tableComments.apply(input as any, input.connectionRevision);
      case 'schema.tableComment.release': return this.tableComments.releaseTokens(input);
      case 'schema.tableDrop.get': return this.tableDrops.get(input as any, input.connectionRevision);
      case 'schema.tableDrop.preview': return this.tableDrops.preview(input as any, input.connectionRevision);
      case 'schema.tableDrop.apply': return this.tableDrops.apply(input as any, input.connectionRevision);
      case 'schema.tableDrop.release': return this.tableDrops.releaseTokens(input);
      case 'schema.tableTruncate.get': return this.tableTruncates.get(input as any, input.connectionRevision);
      case 'schema.tableTruncate.preview': return this.tableTruncates.preview(input as any, input.connectionRevision);
      case 'schema.tableTruncate.apply': return this.tableTruncates.apply(input as any, input.connectionRevision);
      case 'schema.tableTruncate.release': return this.tableTruncates.releaseTokens(input);
      case 'schema.indexes.preview': return this.indexPatches.preview(input as any, input.connectionRevision);
      case 'schema.indexes.apply': return this.indexPatches.apply(input as any, input.connectionRevision);
      case 'schema.indexes.release': return this.indexPatches.releaseTokens(input);
      case 'schema.foreignKeys.get': return this.foreignKeyPatches.get(input as any, input.connectionRevision);
      case 'schema.foreignKeys.preview': return this.foreignKeyPatches.preview(input as any, input.connectionRevision);
      case 'schema.foreignKeys.apply': return this.foreignKeyPatches.apply(input as any, input.connectionRevision);
      case 'schema.foreignKeys.release': return this.foreignKeyPatches.releaseTokens(input);
      case 'files.preview': this.assertFile(input); return previewFile(input as Parameters<typeof previewFile>[0]);
      case 'files.preflight': {
        this.assertFile(input);
        // 全文件检查使用独立只读连接；原任务和读取流真实收尾后才归还取消及关闭占用。
        let checkedRecords = 0;
        return this.withIndependentTask(input.connectionId, input.taskId, (managed, control) =>
          preflightImportFile({ managed, ...control }, input as FileImportPreflightInput & { filePath: string }, progress => {
            checkedRecords = progress.checkedRecords;
            this.emit({ taskId: input.taskId, status: 'running', progress: 0, rows: checkedRecords, message: `正在校验导入文件，已检查 ${checkedRecords} 条记录` });
          }), undefined, '校验整份导入文件', true, () => ({ rows: checkedRecords }));
      }
      case 'excel.sheets':
      case 'excel.preview': {
        this.assertFile(input);
        if (this.taskIdInUse(input.taskId)) throw new Error('任务编号已在执行');
        return this.excelReads.run(command, input as any);
      }
      case 'excel.import': fileImportConflict('xlsx', input); fileImportTransactionMode('xlsx', input); this.assertFile(input); return this.withExcelTask(input, '导入 Excel', task => this.importExcel(task, input));
      case 'excel.export': this.assertFile(input); return this.withExcelTask(input, '导出 Excel', task => this.exportExcel(task, input));
      case 'files.importKeys': return this.readImportKeys(input);
      case 'files.import': {
        this.assertFile(input); const mode = fileImportTransactionMode(input.format, input);
        const conflict = fileImportConflict(input.format, input);
        // 请求配置错误在建连及SQL运行回执之前拒绝；importFile内仍保留同一防线。
        if (Object.hasOwn(input, 'csvHasHeader')) {
          if (typeof input.csvHasHeader !== 'boolean') throw new Error('CSV 首行字段名配置必须为布尔值');
          csvImportHasHeader(input.format, input.csvHasHeader);
        }
        if (conflict) {
          if (this.closing || !input.taskId || this.taskIdInUse(input.taskId)) throw Error('任务编号为空或任务已在执行');
          const evidence = createFileImportConflictEvidence(input.taskId, conflict.mode);
          return this.withConflictImport(input, evidence, task => {
            return importFileWithConflict({ connectionId: input.connectionId, database: input.database, table: input.table }, input.format, input.mapping, conflict, mode, readRecords(input.filePath, input.format, input.encoding, input.csvDelimiter, input.csvHasHeader), evidence, this.conflictImportControl(task));
          });
        }
        if (input.format === 'sql') {
          const evidence = createSqlFileImportEvidence(input.taskId, input.encoding);
          try { return await this.withConnection(input.connectionId, managed => this.runTask(input.taskId, managed, '导入SQL文件', task => { task.sqlFileImport = evidence; return this.importFile(task, input); }), input.database, true); }
          catch {
            // 关闭晚失败不能丢弃原SQL/ROLLBACK回执；错误正文可能含本机路径，统一有界说明。
            return finishSqlFileImportEvidence(evidence, evidence.result.sql?.termination === 'cancelled', 'SQL文件连接或任务收尾未确认；请核对服务器，不要重复导入');
          }
        }
        const evidence: NonNullable<RunningTask['fileImport']> = { committing: false, finalCommit: false, commitAcknowledged: false, committedRows: 0 };
        try { return await this.withConnection(input.connectionId, managed => this.runTask(input.taskId, managed, '导入文件', task => { task.fileImport = evidence; return this.importFile(task, input); }), input.database, mode === 'atomic'); }
        catch (error) {
          if (!evidence.commitAcknowledged || !evidence.result) { if (evidence.failure && error !== evidence.failure) throw Error(`${evidence.failure.message}；附加收尾错误：${this.errorMessage(error)}`); throw error; }
          // 物理关闭晚失败不能抹掉已收到的COMMIT ACK，也不自动重新导入。
          try { this.emit({ taskId: input.taskId, status: 'completed', progress: 100, rows: evidence.committedRows, message: fileImportTransactionText.committedCleanup }); } catch { /* 返回值仍保留真实提交行数。 */ }
          return { rows: evidence.committedRows, errors: [...evidence.result.errors, fileImportTransactionText.committedCleanup] };
        }
      }
      case 'files.exportColumns': {
        const target = { connectionId: input.connectionId, database: input.database, table: input.table };
        const read = await this.withIndependentTask(input.connectionId, input.taskId, async (managed, control) => { const info = await metadata.tableInfo(managed, input.database, input.table); control.checkCancelled(); return this.csvExportFields.prepare(target, info, managed, input.connectionRevision); }, undefined, '读取CSV导出字段', true);
        return this.csvExportFields.publish(read);
      }
      case 'files.releaseExportColumns': return this.csvExportFields.release(input.catalogId);
      case 'files.export': {
        this.assertFile(input);
        if (input.csvSelection && (input.format !== 'csv' || !input.includeData)) throw Error('字段选择只适用于CSV数据导出');
        const projection = input.csvSelection ? this.csvExportFields.consume(input.csvSelection, { connectionId: input.connectionId, database: input.database, table: input.table }, input.connectionRevision) : undefined;
        return this.withConnection(input.connectionId, managed => this.runTask(input.taskId, managed, '导出文件', task => this.exportFile(task, input, projection)), input.database);
      }
      case 'files.exportResult': {
        this.assertFile(input);
        if (this.taskIdInUse(input.taskId)) throw new Error('任务编号已在执行');
        return this.resultFiles.run(input as Parameters<ResultFileTasks['run']>[0]);
      }
      default: throw new Error(`数据库进程不支持命令：${command}`);
    }
  }

  /** 所有任务通道共用编号占用检查，避免集成后取消误命中另一种活动任务。 */
  private taskIdInUse(id: string): boolean { return this.tasks.has(id) || this.independentTasks.has(id) || this.independentResources.owns(id) || this.resultFiles.has(id) || this.excelReads.has(id) || this.excelConnecting.has(id) || this.conflictImports.has(id) || this.schemaComparisons.has(id); }

  /** 关闭前取消任务并释放固定会话，未提交事务由服务器在断开时回滚。 */
  async closeAll(): Promise<void> {
    this.closing = true;
    try {
    this.excelConnecting.forEach(task => task.controller.abort());
    this.conflictImports.forEach(task => { if (task.phase === 'connecting') task.controller.abort(); });
    const comparisonCleanup = this.schemaComparisons.close();
    const filteredUpdateCleanup = this.tableFilteredUpdates.close();
    const filteredDeleteCleanup = this.tableFilteredDeletes.close();
    this.resultInserts.close();
    this.tableRenames.releaseConnection();
    this.databaseDrops.releaseConnection();
    this.structureCache.release();
    const independent = [...this.independentTasks];
    const active = [...this.tasks.values()];
    const fileCleanup = Promise.all([this.resultFiles.closeAll(), this.excelReads.closeAll()]);
    const cancellations = await Promise.allSettled([comparisonCleanup, filteredUpdateCleanup, filteredDeleteCleanup, ...active.map(task => this.cancelTask(task.id)), ...independent.map(([id]) => this.cancelTask(id))]);
    await Promise.all([...active.map(task => task.done), ...independent.map(([, task]) => task.done)]);
    await fileCleanup;
    // 首个 await 之前已进入的建连也必须收尾，避免退出后迟到注册会话。
    await Promise.all([...this.pendingUses]);
    this.dataSearchRecords.close();
    this.tableCopySources.close();
    await Promise.all([...this.sessions.values()].map(session => session.managed.close()));
    // 已关闭的查询会话不能在返回工作台后被继续使用；未知独立资源的profile仍保留供显式恢复。
    this.sessions.clear();
    const recovered = await this.independentResources.recover();
    if (recovered.remaining) throw Error('退出前仍有独立任务资源未确认释放，请核对服务器及隧道状态后重试；原操作未重放');
    this.sessions.clear(); this.profiles.clear();
    this.structureCache.release();
    const failed = cancellations.find(result => result.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
    } catch (error) {
      // 返回工作台后仍可显式断开和恢复原资源；普通退出失败不能永久封死引擎入口。
      this.closing = false; throw error;
    }
  }

  /** 只读取已经由主进程解密并成功打开的连接配置，不接受界面任意凭据。 */
  private profile(id: string): ConnectionProfile {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error('请先打开数据库连接');
    return profile;
  }

  /** 只有主进程可补充可信连接配置；不允许租约读取覆盖一个已经打开的目标。 */
  private copySourceProfile(input: Input): void {
    if (input.profile && input.profile.id !== input.connectionId) throw new Error('主进程未提供有效表页连接配置');
    if (!this.profiles.has(input.connectionId) && input.profile) this.profiles.set(input.connectionId, input.profile);
  }

  /** 新增只读任务受15秒总期限及原KILL/关闭终态保护，不以Promise超时抢先返回。 */
  private async withCopySourceTask<T>(connectionId: string, taskId: string, action: (context: Pick<StructureTaskContext, 'managed' | 'commandStarted' | 'checkCancelled'>) => Promise<T>): Promise<T> {
    let expired = false, settled = false, cancelling: Promise<unknown> | undefined;
    const pending = this.withIndependentTask(connectionId, taskId, (managed, control) => action({ managed, ...control }), undefined, '读取完整复制源', true, () => ({}), true);
    // 保留原Promise供finally等待并传播控制失败，旁路处理器仅防止等待期间的未处理拒绝。
    const timer = setTimeout(() => { if (settled) return; expired = true; cancelling = this.cancelTask(taskId); void cancelling.catch(() => undefined); }, tableCopySourceLimits.timeoutMs);
    timer.unref();
    try { const result = await pending; if (expired) throw new Error('完整复制源读取超过15秒；请求已收尾，未生成草稿。'); return result; }
    // pending等待真正的命令及连接终态；保留取消控制或关闭失败，不能统一包装成已成功取消。
    catch (error) { throw error; }
    finally { settled = true; clearTimeout(timer); await cancelling; }
  }

  /** 元数据和文件任务使用独立连接，避免干扰 SQL 标签页里的事务与临时表。 */
  private async withConnection<T>(id: string, action: (managed: ManagedConnection) => Promise<T>, database?: string, strict = false): Promise<T> {
    return this.withConnectionUse(id, async () => {
      const managed = await connect(this.profile(id), database);
      try { return await action(managed); } finally { if (strict) await managed.close({ strict: true }); else await managed.close(); }
    });
  }

  /** 在首个 await 建连之前登记活动，覆盖会话尚未入表和独立元数据任务的竞态。 */
  private async withConnectionUse<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (this.closing || this.disconnecting.has(id)) throw Error('连接正在关闭，不能分配新的任务资源');
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    this.pendingUses.add(done);
    this.connectionUses.set(id, (this.connectionUses.get(id) ?? 0) + 1);
    try { return await action(); }
    finally { const remaining = (this.connectionUses.get(id) ?? 1) - 1; if (remaining) this.connectionUses.set(id, remaining); else this.connectionUses.delete(id); this.pendingUses.delete(done); finish(); }
  }

  /** Excel 在建连前占用任务编号并绑定 AbortSignal，取消、断开与退出不能漏掉尚未创建的运行任务。 */
  private async withExcelTask<T>(input: Input, label: string, action: (task: RunningTask) => Promise<T>): Promise<T> {
    const id = input.taskId;
    if (this.closing || !id || this.taskIdInUse(id)) throw new Error('任务编号为空或任务已在执行');
    const controller = new AbortController(); let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    this.excelConnecting.set(id, { connectionId: input.connectionId, controller, done });
    let submitted = false;
    try {
      return await this.withConnectionUse(input.connectionId, async () => {
        const managed = await connect(this.profile(input.connectionId), input.database, controller.signal);
        try {
          if (controller.signal.aborted || this.closing) throw new Error('Excel 任务在建连阶段已取消，尚未读取或写入数据');
          // 同步交接编号，中间没有 await；取消必定命中建连或实际运行任务之一。
          this.excelConnecting.delete(id); submitted = true;
          return await this.runTask(id, managed, label, action);
        } finally { await managed.close(); }
      });
    } catch (reason) {
      if (!submitted) this.emit({ taskId: id, status: controller.signal.aborted ? 'cancelled' : 'failed', progress: 0, message: controller.signal.aborted ? 'Excel 任务在建连阶段已取消，尚未读取或写入数据' : this.errorMessage(reason) });
      if (controller.signal.aborted) throw new Error('Excel 任务在建连阶段已取消，尚未读取或写入数据');
      throw reason;
    } finally { this.excelConnecting.delete(id); finish(); }
  }

  /** 新策略建连前独占编号，迟到连接先复核取消；租约覆盖真实运行及严格关闭，不改变旧Excel/默认导入。 */
  private async withConflictImport(input: Input, evidence: FileImportConflictEvidence, action: (task: RunningTask) => Promise<FileImportResult>): Promise<FileImportResult> {
    const id = input.taskId;
    if (this.closing || !id || this.taskIdInUse(id)) throw Error('任务编号为空或任务已在执行');
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const lease: ConflictImportLease = { connectionId: input.connectionId, controller: new AbortController(), done, phase: 'connecting', evidence };
    this.conflictImports.set(id, lease);
    try {
      return await this.withConnectionUse(input.connectionId, async () => {
        const managed = await connect(this.profile(input.connectionId), input.database, lease.controller.signal);
        try {
          if (lease.controller.signal.aborted || this.closing) return finishFileImportConflictEvidence(evidence, true);
          lease.phase = 'running';
          return await this.runTask(id, managed, '按匹配键导入文件', task => { task.fileImportConflict = evidence; return action(task); }, undefined, lease);
        } finally { lease.phase = 'closing'; await managed.close({ strict: true }); }
      });
    } catch {
      const result = finishFileImportConflictEvidence(evidence, lease.controller.signal.aborted, '导入连接或任务收尾未确认；原处理与提交回执已保留，请核对资源，不要重复导入');
      if (lease.phase === 'connecting' && !lease.controller.signal.aborted) try { this.emit({ taskId: id, status: 'failed', progress: 0, message: result.errors[0] }); } catch { /* 回执仍保留准备失败。 */ }
      return result;
    } finally {
      if (lease.controller.signal.aborted && !evidence.finalCommitAcknowledged) {
        finishFileImportConflictEvidence(evidence, true);
        try { this.emit({ taskId: id, status: 'cancelled', progress: 0, message: evidence.result.errors[0] ?? '导入在建连阶段已取消，尚未读取或写入数据' }); } catch { /* 取消事实由回执保留。 */ }
      }
      this.conflictImports.delete(id); finish();
    }
  }

  /** 独立任务从建连前登记，到服务器及本地连接收尾后才释放编号和配置锁。 */
  private async withIndependentTask<T>(connectionId: string, taskId: string, action: (managed: ManagedConnection, control: Omit<StructureTaskContext, 'managed'>) => Promise<T>, options?: StructureTaskOptions, readLabel?:string, strictRead=false,readDetail?:()=>Partial<TaskEvent>, quiet=false, fileFinalizer?: IndependentFileFinalizer<T>, dataWrite?: { target: { database: string; table: string }; commitProtected(): boolean }, taskFinalizer?: (succeeded: boolean) => Promise<void>): Promise<T> {
    let resourcesStarted = false;
    return this.withConnectionUse(connectionId, async () => {
      if (this.closing || !taskId || this.taskIdInUse(taskId)) throw new Error('任务编号为空或任务已在执行');
      const profile = this.profile(connectionId);
      // 字段、索引及后续外键执行共用资源集合，不能在重核与关闭之间并行修改相关父表。
      const executionTargets = [...(dataWrite ? [dataWrite.target] : []), ...(options?.executionTarget ? [options.executionTarget] : []), ...(options?.executionTargets ?? [])];
      if (options?.executionDatabase !== undefined && executionTargets.length) throw new Error('库级与表级结构执行范围不能混用；未发送 DDL');
      const releaseExecution = options?.executionDatabase !== undefined ? this.structureExecutions.acquireDatabase(connectionId, options.executionDatabase) : this.structureExecutions.acquire(connectionId, executionTargets);
      let resources: IndependentTaskResourceLease;
      try { resources = this.independentResources.reserve(connectionId, taskId, releaseExecution); }
      catch (error) { releaseExecution(); throw error; }
      resourcesStarted = true;
      const controller = new AbortController();
      let finish!: () => void;
      const done = new Promise<void>(resolve => { finish = resolve; });
      const task: IndependentTask = { commitProtected: dataWrite?.commitProtected, connectionId, controller, done, resources, structureTask: Boolean(options)||strictRead, generation: 0, ...(fileFinalizer ? { fileFinalization: true } : {}) };
      this.independentTasks.set(taskId, task);
      const label = options?.label ?? readLabel ?? '读取关联记录';
      const detail = () => options ? (options.purpose === 'tableCreate' ? { tableCreate: { ...options.progress } } : options.purpose === 'tableCopyData' ? { tableCopyData: { ...options.progress } } : options.purpose === 'tableCopyStructure' ? { tableCopyStructure: { ...options.progress } } : options.purpose === 'databaseDefaultEncoding' ? { databaseDefaultEncoding: { ...options.progress } } : options.purpose === 'databaseDrop' ? { databaseDrop: { ...options.progress } } : options.purpose === 'databaseCreate' ? { databaseCreate: { ...options.progress } } : options.purpose === 'tableRename' ? { tableRename: { ...options.progress } } : options.purpose === 'tableAutoIncrement' ? { tableAutoIncrement: { ...options.progress } } : options.purpose === 'tableDefaultEncoding' ? { tableDefaultEncoding: { ...options.progress } } : options.purpose === 'tableDrop' ? { tableDrop: { ...options.progress } } : options.purpose === 'tableTruncate' ? { tableTruncate: { ...options.progress } } : options.purpose === 'tableChecks' ? { tableChecks: { ...options.progress } } : options.purpose === 'tableComment' ? { tableComment: { ...options.progress } } : options.purpose === 'indexes' ? { indexPatch: { ...options.progress } } : options.purpose === 'foreignKeys' ? { foreignKeyPatch: { ...options.progress } } : { columnPatch: { ...options.progress } }) : readDetail?.()??{};
      const send = (event: TaskEvent) => { if (!quiet) this.emit(event); };
      const report = () => send({ taskId, status: 'running', progress: 0, message: label, ...detail() });
      const checkCancelled = () => { if (task.cancelRequested || controller.signal.aborted) throw new Error('任务已取消；已执行的结构或数据变更不会撤销'); };
      const commandStarted = (): (() => void) => {
        checkCancelled();const generation=task.generation=(task.generation??0)+1;task.commandInFlight=true;task.stopPending=undefined;
        let terminal!: () => void;task.commandTerminal=new Promise<void>(resolve=>{terminal=resolve;});let ended=false;
        return()=>{if(ended)return;ended=true;if(task.generation===generation)task.commandInFlight=false;terminal();};
      };
      let managed: ManagedConnection | undefined;
      let failure: unknown; let result!: T;
      try {
        report();
        managed = await connect(profile, undefined, controller.signal, receipt => resources.capture(receipt));
        resources.capture(managed.resources);
        task.managed = managed;
        if (controller.signal.aborted) throw new Error('任务已取消');
        result = await action(managed, { report, checkCancelled, commandStarted });
      } catch (error) { failure = error; }
      finally {
        // 成功或失败均已离开动作阶段，迟到取消只等待收尾，不再给关闭中的连接创建 KILL 控制。
        task.actionSettled = true;
        let resourcesReleased = false;
        try { await task.cancelPending;await task.stopPending; resourcesReleased = !task.cancelError; } catch (error) { failure = error; }
        // 事件接收方异常也必须继续实际关闭连接并释放全部关联资源。
        if (options && !failure) { options.progress.phase = 'releasing'; try { report(); } catch (error) { failure ??= error; } }
        try { await managed?.close(options||strictRead ? { strict: true } : undefined); }
        catch { task.resourceCloseFailed = true; failure ??= Error('独立任务连接关闭失败，物理终态尚未确认；请显式断开连接并核对资源状态，原操作未重放'); }
        // 动作Promise与资源隔离分别结算：失败也唤醒等待者，原任务号及全部目标锁仍可保留。
        const confirmed = resources.settle(Boolean(task.resourceCloseFailed));
        resourcesReleased = resourcesReleased && confirmed;
        if (!confirmed) failure ??= Error('独立任务物理资源尚未确认释放，请显式断开连接；原操作未重放');
        // 本用途保持任务编号、配置锁和done，直到数据库严格收尾后才允许原子文件替换。
        // 此间取消只登记意图，不再向已退出的数据库线程发送KILL；替换开始后保留真实提交结果。
        if (fileFinalizer) {
          if (!failure && resourcesReleased && !task.cancelError) {
            try { result = await fileFinalizer.commit(checkCancelled, () => { checkCancelled(); task.fileCommitStarted = true; }); task.fileCommitted = fileFinalizer.committed(); }
            catch (error) { failure = error; }
          }
          try { await fileFinalizer.dispose(); }
          catch (error) {
            if (fileFinalizer.committed()) { task.fileCommitted = true; try { send({ taskId, status: 'running', progress: 100, message: '文件已保存，但本地收尾报告异常；请核对文件，不要自动重试' }); } catch { /* 已提交事实不因通知异常变成未导出。 */ } }
            else failure ??= error;
          }
        }
        // 私有快照清理也保留原taskId、connectionUses及done，不借文件发布状态冒充数据库提交。
        if (taskFinalizer) { try { await taskFinalizer(!failure && resourcesReleased && !task.cancelRequested && !controller.signal.aborted); } catch (error) { failure ??= error; } }
        this.independentTasks.delete(taskId); finish();
        // 新建表动作可因发送前取消失败，但严格收尾事实独立成立；未知DDL由用途自身继续保守锁定。
        if ((options?.purpose === 'tableCreate' && managed || options?.purpose === 'databaseDefaultEncoding') && resourcesReleased && !task.cancelError) options?.onResourcesReleased?.();
      }
      if (task.fileCommitted) {
        // 原子替换已确认，迟到通知或收尾异常不能把真实文件提交改报为未导出。
        try { send({ taskId, status: 'completed', progress: 100, message: `${label}完成` }); } catch { /* 返回值仍携带真实fileCommitted事实。 */ }
        return result;
      }
      if (controller.signal.aborted || task.cancelRequested) failure ??= task.cancelError ?? (options?.progress.ddlCompleted ? undefined : new Error('任务已取消'));
      if (task.cancelError) failure = task.cancelError;
      const knownComplete = options?.progress.ddlCompleted;
      const status = task.cancelError ? 'failed' : failure ? ((controller.signal.aborted || task.cancelRequested) && !knownComplete ? 'cancelled' : 'failed') : 'completed';
      const message=failure ? (options ? `${label}未全部完成；${knownComplete ? 'DDL 已完成，不要重复执行，请核对最新定义及资源状态' : options.progress.ddlSubmitted ? 'DDL 可能已执行，请核对最新定义；未自动重放' : '尚未发送 DDL'}` : this.errorMessage(failure)) : `${label}完成`;
      this.dataSearches.observe(taskId,status,message);
      send({ taskId, status, progress: failure ? 0 : 100, message:readDetail?`${label}${status==='completed'?'完成':status==='cancelled'?'已取消':'失败'}`:message, ...detail() });
      if (failure) throw failure;
      return result;
    }).catch(error => {
      // 目录/编号/配置准入在资源预留之前失败，没有网络分配，可归还本次数据库属性锁。
      if (!resourcesStarted && options?.purpose === 'databaseDefaultEncoding') options.onResourcesReleased?.();
      throw error;
    });
  }

  /** 普通表页与关联表页共用流式预算和按真实字段名序列化的规则。 */
  private async readPage(managed: ManagedConnection, sql: string, page: number, pageSize: number, binaryRows = false, waitTerminal = false) {
    if (managed.signal?.aborted) throw new Error('任务已取消');
    // 文本协议会截短 FLOAT 的有效位，二进制协议保留相邻 FLOAT/DOUBLE 候选的真实值。
    const query = binaryRows ? managed.connection.execute({ sql, rowsAsArray: true }) : managed.connection.query({ sql, rowsAsArray: true });
    // 新来源路径在流预算失败时仍等驱动命令/连接真实终态；原表页行为不变。
    let finishTerminal!: () => void; let terminalError: Error | undefined;
    const terminal = waitTerminal ? new Promise<void>(resolve => { finishTerminal = resolve; }) : undefined;
    const commandEnded = () => finishTerminal();
    const commandFailed = (error: Error) => { terminalError = error; finishTerminal(); };
    const connectionEnded = () => commandFailed(new Error('表页连接在读取完成前断开'));
    if (terminal) { query.once('end', commandEnded); query.once('error', commandFailed); managed.connection.once('end', connectionEnded); managed.connection.once('error', commandFailed); managed.signal?.addEventListener('abort', connectionEnded, { once: true }); }
    let fields: FieldPacket[] = [];
    query.on('fields', (value: FieldPacket[]) => { fields = value; });
    const stream = query.stream({ highWaterMark: 8 });
    const abort = () => { stream.destroy(new Error('任务已取消')); };
    managed.signal?.addEventListener('abort', abort, { once: true });
    const rows: DataRow[] = []; let bytes = 0;
    try {
      for await (const raw of stream) {
        const values = raw as unknown[];
        if (this.rawRowBytes(values) > 256 * 1024) throw new Error('当前页包含超过 256 KiB 的大字段行，未返回可编辑数据；请筛选该行之外的数据，或使用文件导出读取完整内容');
        const row = Object.fromEntries(fields.map((field, index) => [field.name, serializeCell(values[index])])); bytes += Buffer.byteLength(JSON.stringify(row));
        if (bytes > 16 * 1024 * 1024) throw new Error('当前页数据超过 16 MiB，未返回可编辑数据；请减小页大小或使用文件导出');
        rows.push(row);
      }
    } finally {
      managed.signal?.removeEventListener('abort', abort); stream.destroy();
      if (terminal) { await terminal; query.removeListener('end', commandEnded); query.removeListener('error', commandFailed); managed.connection.removeListener('end', connectionEnded); managed.connection.removeListener('error', commandFailed); managed.signal?.removeEventListener('abort', connectionEnded); }
    }
    if (terminalError) throw terminalError;
    return { rows: rows.slice(0, pageSize), columns: this.columns(fields, true), page, pageSize, hasMore: rows.length > pageSize };
  }

  /** 同一会话不允许并行操作，确保事务、临时表和取消操作作用于确定的连接。 */
  private async withSession<T>(id: string, action: (managed: ManagedConnection) => Promise<T>): Promise<T> {
    const session = this.sessions.get(id);
    if (!session) throw new Error('会话不存在，请重新打开标签页');
    if (session.busy) throw new Error('当前标签页正在执行操作，请等待或取消');
    if (session.managed.broken) throw new Error('会话连接已断开，请重新打开标签页；写操作未自动重放');
    session.busy = true;
    try { return await action(session.managed); } finally { session.busy = false; }
  }

  /** 统一登记任务、发送终态并等待取消控制连接结束后释放任务标识。 */
  private async runTask<T>(id: string, managed: ManagedConnection, label: string, action: (task: RunningTask) => Promise<T>, terminal?: (result: T) => { status: 'failed'; message: string } | undefined, conflictLease?: ConflictImportLease): Promise<T> {
    const ownConflictLease = conflictLease && this.conflictImports.get(id) === conflictLease && conflictLease.phase === 'running' && !this.tasks.has(id);
    if (this.closing || !id || this.taskIdInUse(id) && !ownConflictLease) throw new Error('任务编号为空或任务已在执行');
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const task: RunningTask = { id, managed, cancelled: false, inFlight: false, generation: 0, done, finish };
    this.tasks.set(id, task);
    // 在取得会话互斥后、发送用户SQL前固定历史上下文，避免完成后读到脚本切换后的库。
    this.emit({ taskId: id, status: 'running', progress: 0, message: label, executionDatabase:queryDatabaseFromSession(completionSessionState(managed,false)) });
    try {
      const result = await action(task);
      if (task.fileImportConflict) {
        let cleanup: string | undefined;
        try { await task.cancelPending; } catch { cleanup = '导入取消控制收尾失败；请核对原服务器连接，不会自动重试'; }
        const retained = finishFileImportConflictEvidence(task.fileImportConflict, task.cancelled, cleanup), report = retained.conflicts!;
        this.emit({ taskId: id, status: report.termination === 'cancelled' ? 'cancelled' : retained.errors.length ? 'failed' : 'completed', progress: 100, message: retained.errors[0] ?? '按匹配键导入完成；匹配更新计数包含未改变值的命令' });
        return retained as T;
      }
      if (task.sqlFileImport) {
        let cleanup: string | undefined;
        try { await task.cancelPending; } catch { cleanup = 'SQL文件取消控制收尾失败；请核对原服务器连接，不会自动重试'; }
        const retained = finishSqlFileImportEvidence(task.sqlFileImport, task.cancelled, cleanup);
        this.emit({ taskId: id, status: task.cancelled ? 'cancelled' : retained.errors.length ? 'failed' : 'completed', progress: 100, message: retained.errors[0] ?? 'SQL文件执行完成；服务器影响计数不等于提交行数' });
        return retained as T;
      }
      if (!task.tableApply?.commitAcknowledged && !task.fileImport?.commitAcknowledged) this.checkCancelled(task);
      if (task.tableApply?.commitAcknowledged || task.fileImport?.commitAcknowledged || task.fileImport?.failure) await task.cancelPending?.catch(() => undefined); else await task.cancelPending;
      const errors = (result as { errors?: string[] } | undefined)?.errors;
      // 仅显式查询策略可把保留前序结果的回包判为失败，不按任意对象的failure属性猜全局终态。
      const final = terminal?.(result);
      this.emit({ taskId: id, status: final?.status ?? (errors?.length ? 'failed' : 'completed'), progress: 100, message: final?.message ?? (errors?.length ? errors[0] : `${label}完成`), ...(task.queryExport ? { queryExport: { ...task.queryExport } } : {}) });
      return result;
    } catch (error) {
      if (task.fileImportConflict) {
        let cleanup = '导入任务收尾异常；原处理与提交回执已保留，不会自动重试';
        try { await task.cancelPending; } catch { cleanup += '；取消控制连接收尾未确认'; }
        const retained = finishFileImportConflictEvidence(task.fileImportConflict, task.cancelled, cleanup);
        try { this.emit({ taskId: id, status: retained.conflicts?.termination === 'cancelled' ? 'cancelled' : 'failed', progress: 0, message: retained.errors[0] ?? cleanup }); } catch { /* 事件故障不能抹掉已取得的提交事实。 */ }
        return retained as T;
      }
      if (task.sqlFileImport) {
        let cleanup = 'SQL文件任务收尾异常；原执行及回滚证据已保留，不会自动重试';
        try { await task.cancelPending; } catch { cleanup += '；取消控制连接收尾未确认'; }
        const retained = finishSqlFileImportEvidence(task.sqlFileImport, task.cancelled, cleanup);
        try { this.emit({ taskId: id, status: task.cancelled ? 'cancelled' : 'failed', progress: 0, message: retained.errors[0] ?? cleanup }); } catch { /* 事件通道故障不能抹掉SQL回执。 */ }
        return retained as T;
      }
      if (task.fileImport?.commitAcknowledged && task.fileImport.result) {
        await task.cancelPending?.catch(() => undefined);
        try { this.emit({ taskId: id, status: 'completed', progress: 100, rows: task.fileImport.committedRows, message: fileImportTransactionText.committedCleanup }); } catch { /* COMMIT事实优先于晚通知异常。 */ }
        return task.fileImport.result as T;
      }
      if (task.tableApply?.commitAcknowledged) {
        await task.cancelPending?.catch(() => undefined);
        this.emit({ taskId: id, status: 'completed', progress: 100, message: '服务器已确认目标事务提交；请查看提交记录' });
        return { affectedRows: task.tableApply.serverReportedRows } as T;
      }
      if (task.fileImport?.failure) { await task.cancelPending?.catch(() => undefined); error = task.fileImport.failure; }
      else if (task.transactionSettingsChangeSubmitted) {
        try { await task.cancelPending; }
        catch (cancelError) { error = new AggregateError([error, cancelError], '本会话设置执行与取消收尾失败'); }
      } else if (task.continueOnErrorMode) {
        try { await task.cancelPending; }
        catch (cancelError) { error = new AggregateError([error, cancelError], '遇错继续任务与取消收尾失败；已停止，不会自动重试'); }
      } else if (task.collectWarningsMode) {
        try { await task.cancelPending; }
        catch (cancelError) { error = new AggregateError([error, cancelError], '警告采集任务与取消收尾失败；原语句可能已执行，不会自动重试'); }
      } else await task.cancelPending;
      if (task.transactionSettingsChangeSubmitted) error = queryTransactionSettingsMayHaveChanged(error);
      this.emit({ taskId: id, status: task.cancelled && !task.fileCommitStarted ? 'cancelled' : 'failed', progress: 0, message: this.errorMessage(error), ...(task.queryExport ? { queryExport: { ...task.queryExport } } : {}) });
      throw error;
    } finally {
      // 取消连接仍在建立时，不能放开会话给下一条查询，以免 KILL 误伤复用线程。
      if (task.fileImportConflict || task.sqlFileImport) await task.cancelPending?.catch(() => undefined);
      else if (task.tableApply?.commitAcknowledged || task.fileImport?.commitAcknowledged || task.fileImport?.failure) await task.cancelPending?.catch(() => undefined);
      // 本功能取消收尾的原错误已在catch合并；finally仍须释放任务，不能再次抛出覆盖终态。
      else if (task.transactionSettingsChangeSubmitted) await task.cancelPending?.catch(() => undefined);
      else if (task.continueOnErrorMode) await task.cancelPending?.catch(() => undefined);
      else if (task.collectWarningsMode) await task.cancelPending?.catch(() => undefined);
      else await task.cancelPending;
      this.tasks.delete(id); task.finish();
    }
  }

  /** 在下一条 SQL 或下一批文件写入前响应取消，不声称撤销已提交的数据。 */
  private checkCancelled(task: RunningTask): void { if (task.cancelled && !task.fileCommitStarted) throw new Error('任务已取消；此前已经提交的操作不会撤销'); }
  /** 将未知异常转换为可传输文字，避免跨进程依赖 Error 原型。 */
  private errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
  /** 文件路径必须由主进程的已授权 token 解析结果注入。 */
  private assertFile(input: Input): void { if (typeof input.filePath !== 'string' || !input.filePath) throw new Error('主进程未提供已授权文件路径'); }
  /** 逐个转换单元格，同时保留 __proto__ 等合法的数据库字段名。 */
  private row(value: Record<string, unknown>): DataRow { return Object.fromEntries(Object.entries(value).map(([name, cell]) => [name, serializeCell(cell)])); }
  /** 在 base64 与 JSON 分配之前估算一行大小，提前拦截巨型字段。 */
  private rawRowBytes(values: unknown[]): number { return values.reduce<number>((size, cell) => size + (Buffer.isBuffer(cell) ? Math.ceil(cell.length * 4 / 3) : typeof cell === 'string' ? Buffer.byteLength(cell, 'utf8') : 16), 0); }
  /** 查询结果使用位置键防止同名列覆盖，表格页则保留真实字段名用于编辑。 */
  private columns(fields: FieldPacket[], names = false): ResultColumn[] { return fields.map((field, index) => ({ key: names ? field.name : `c${index}`, name: field.name, type: String(field.columnType === undefined ? '未知' : (Types as unknown as Record<number, string>)[field.columnType] ?? field.columnType) })); }
  /** 从实际服务器会话读取字符串转义模式，供扫描器与 DDL 生成共用。 */
  private async noBackslashEscapes(managed: ManagedConnection): Promise<boolean> {
    return (await this.sqlMode(managed)).noBackslashEscapes;
  }

  /** 使用当前标签会话的协议缓存，不插入 SELECT，以免覆盖 ROW_COUNT、FOUND_ROWS 和警告。 */
  private async sqlMode(managed: ManagedConnection, task?: RunningTask): Promise<SqlLexicalMode> {
    if (task) this.checkCancelled(task);
    if (managed.sqlMode === undefined) {
      if (managed.serverStatus === undefined) throw new Error('无法确定会话 SQL 模式，请关闭此标签并新建查询重新连接；未执行本次 SQL');
      return { noBackslashEscapes: Boolean(managed.serverStatus & 512), noBackslashEscapesKnown: managed.noBackslashEscapesKnown !== false, ansiQuotes: false, ansiQuotesKnown: false };
    }
    const modes = managed.sqlMode.split(',');
    return { noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES'), noBackslashEscapesKnown: true, ansiQuotes: modes.includes('ANSI_QUOTES'), ansiQuotesKnown: true };
  }

  /** MariaDB 10.2.1 起允许 38 位小数，MySQL 及更早 MariaDB 保持 30 位。 */
  private maxDecimalScale(managed: ManagedConnection): 30 | 38 {
    const version = /^(\d+)\.(\d+)\.(\d+).*MariaDB/i.exec(managed.status.version.replace(/^5\.5\.5-/, ''));
    if (!version) return 30;
    const [, major, minor, patch] = version.map(Number);
    return major > 10 || (major === 10 && (minor > 2 || (minor === 2 && patch >= 1))) ? 38 : 30;
  }

  /** 明确的常量 SET 可预演；服务器表达式与版本条件只能在执行后读取实际模式。 */
  private nextStaticMode(sql: string, mode: SqlLexicalMode): SqlLexicalMode | undefined {
    const clean = sql.replace(/^(?:\s+|\/\*(?![!]|M!)[\s\S]*?\*\/|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$))*/, '');
    const assignment = /^SET\s+(?:(?:SESSION|LOCAL)\s+|@@(?:(?:SESSION|LOCAL)\.)?)?sql_mode\s*=\s*(['"])([A-Za-z0-9_,\s]*)\1\s*$/i.exec(clean);
    if (assignment && !(assignment[1] === '"' && mode.ansiQuotes)) {
      const modes = assignment[2].toUpperCase().split(',').map(value => value.trim());
      return { noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: modes.includes('ANSI_QUOTES') || modes.includes('ANSI') };
    }
    if (/^(?:SET|CALL|EXECUTE)\b/i.test(clean) || /\/\*(?:!|M!)/.test(clean)) return undefined;
    return mode;
  }

  /** 静态路径一次校验完整模板；动态模式边界后预览仅为当前模式下的候选名称。 */
  private parameterPlan(sql: string, initial: SqlLexicalMode, values?: ReadonlyMap<string, string>): { names: string[]; warnings: string[]; dynamic: boolean } {
    if (typeof sql !== 'string' || Buffer.byteLength(sql) > queryParameterLimits.sqlBytes) throw new Error('参数查询模板不能超过 20 MiB');
    const scanner = new SqlScriptScanner(initial.noBackslashEscapes, initial.ansiQuotes, initial.ansiQuotesKnown !== false, initial.noBackslashEscapesKnown !== false);
    const names = new Set<string>(); let mode = initial, dynamic = false, bytes = 0, first = true;
    for (;;) {
      let statement: string | undefined;
      try {
        scanner.setMode(mode.noBackslashEscapes, mode.ansiQuotes, mode.ansiQuotesKnown !== false, mode.noBackslashEscapesKnown !== false);
        statement = scanner.push(first ? sql : '', true, 1)[0]; first = false;
        if (!statement) break;
        for (const token of namedParameterTokens(statement, mode)) names.add(token.name);
        if (names.size > queryParameterLimits.names) throw new Error('查询参数不能超过 200 个');
        if (values && !dynamic) {
          bytes += Buffer.byteLength(bindQueryParameters(statement, values, mode));
          if (bytes > queryParameterLimits.sqlBytes) throw new Error('展开后的 SQL 合计不能超过 20 MiB');
        }
      } catch (error) { if (!dynamic) throw error; break; }
      const next = this.nextStaticMode(statement, mode);
      if (next) mode = next; else dynamic = true;
    }
    if (names.size > queryParameterLimits.names) throw new Error('查询参数不能超过 200 个');
    if (values && !dynamic && [...values.keys()].some(name => !names.has(name))) throw new Error('存在 SQL 未使用的多余参数');
    const warnings = initial.ansiQuotesKnown === false || initial.noBackslashEscapesKnown === false ? ['会话完整 SQL 模式暂不可确定；仅执行所有可能引号模式下语句和参数边界完全一致的 SQL。遇到引号歧义时请新建查询标签，原标签事务未自动回滚，可明确提交或回滚。'] : [];
    if (dynamic) warnings.push('脚本含依赖服务器的 SQL 模式变更；后续参数名称仅为当前模式下的预览，执行时逐条重新识别。后续缺参或语法错误会停止脚本，此前已提交语句保留。');
    return { names: [...names], dynamic, warnings };
  }

  /** 取消只针对仍然运行的那一代语句；控制连接失败时销毁原会话，不重连重放。 */
  private async cancelTask(id: string): Promise<void> {
    const conflict = this.conflictImports.get(id);
    if (conflict?.phase === 'connecting') { conflict.controller.abort(); finishFileImportConflictEvidence(conflict.evidence, true); await conflict.done; return; }
    if (conflict?.phase === 'closing') { await conflict.done; return; }
    const connecting = this.excelConnecting.get(id);
    if (connecting) { connecting.controller.abort(); await connecting.done; return; }
    if (this.excelReads.has(id)) return this.excelReads.cancel(id);
    if (this.schemaComparisons.has(id)) return this.schemaComparisons.cancel(id);
    const independent = this.independentTasks.get(id);
    // 结果插入的COMMIT已发送时不再KILL，避免把已提交误报为已撤销。
    if (independent) {
      if (independent.commitProtected?.()) { await independent.done; return; }
      if (independent.actionSettled) { if (independent.fileFinalization && !independent.fileCommitStarted) independent.cancelRequested = true; await independent.done; return; }
      independent.cancelRequested = true;
      this.dataSearches.interrupt(id);
      if (!independent.cancelPending) {
        const managed = independent.managed;
        if (!managed) independent.controller.abort();
        else independent.cancelPending = (async () => {
          let control: ManagedConnection | undefined;
          const threadId = managed.connection.threadId;
          const generation = independent.generation, terminal = independent.commandTerminal;
          try {
            control = await connect(managed.profile, undefined, undefined, receipt => independent.resources?.capture(receipt));
            independent.resources?.capture(control.resources);
            if (this.independentTasks.get(id) !== independent || independent.managed !== managed || managed.connection.threadId !== threadId || managed.broken || independent.generation !== generation) throw new Error('独立任务连接或命令代次已变化，不能发送取消命令');
            if (!Number.isSafeInteger(threadId) || (threadId ?? 0) < 1) throw new Error('无法确认独立任务连接编号');
            // 单纯关闭 socket 无法唤醒服务器的元数据锁等待，必须明确结束此专用会话。
            await execute(control, `KILL CONNECTION ${threadId}`);
            // KILL 的 ACK 只确认请求被接受；结构任务必须等原命令回调或服务器真实断开才销毁本地流。
            if (independent.structureTask) await terminal;
          } catch (error) {
            if ((error as { errno?: number }).errno !== 1094) {
              independent.cancelError = new Error('取消控制连接失败，已关闭本地独立连接，但无法确认服务器任务已结束，请检查服务器连接状态');
              // 控制建连可同步失败；先标记本地流不可再等待终包，再触发销毁，不能卡住ACK消费者。
              managed.broken=true;managed.connection.destroy();
            }
          } finally {
            independent.controller.abort();
            try { await control?.close(independent.structureTask ? { strict: true } : undefined); } catch { independent.resourceCloseFailed = true; independent.cancelError = new Error('取消控制连接清理失败，请核对服务器任务及连接状态'); }
          }
        })();
      }
      await independent.cancelPending; await independent.done;
      if (independent.cancelError) throw independent.cancelError;
      return;
    }
    if (this.resultFiles.has(id)) { this.resultFiles.cancel(id); return; }
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.fileImportConflict?.finalCommitAcknowledged) return;
    if (task.fileImportConflict?.committing) { if (!task.fileImportConflict.finalCommit) task.cancelled = true; return; }
    // COMMIT一旦发送就不再KILL；中间批提交后仍响应取消，最后提交则保留真实ACK。
    if (task.fileImport?.committing) { if (!task.fileImport.finalCommit) task.cancelled = true; return; }
    if (task.fileCommitStarted || task.tableApply?.commitMayHaveBeenSent) return;
    task.cancelled = true;this.insertConfirmations.cancel(id);
    return this.stopTaskCommand(task);
  }

  /** 搜索上限或消费者失败只停止当前只读命令；不标记用户取消，也不重放后续查询。 */
  private async stopIndependentRead(id:string):Promise<void>{
    const task=this.independentTasks.get(id);if(!task)return;
    if(task.cancelPending)return task.cancelPending;if(task.stopPending)return task.stopPending;
    const managed=task.managed,generation=task.generation,terminal=task.commandTerminal;
    task.stopPending=(async()=>{
      if(!managed||!task.commandInFlight||managed.broken)return;
      let control:ManagedConnection|undefined;
      try{
        control=await connect(managed.profile,undefined,undefined,receipt=>task.resources?.capture(receipt));task.resources?.capture(control.resources);
        if(this.independentTasks.get(id)!==task||task.managed!==managed||task.generation!==generation||!task.commandInFlight||managed.broken)return;
        const threadId=managed.connection.threadId;if(!Number.isSafeInteger(threadId)||(threadId??0)<1)throw Error('无法确认搜索连接编号');
        await execute(control,`KILL QUERY ${threadId}`);await terminal;
      }catch(error){
        if((error as{errno?:number}).errno!==1094){task.cancelError=Error('搜索停止控制失败，已关闭本地连接；请核对服务器资源状态');managed.broken=true;managed.connection.destroy();task.controller.abort();}
      }finally{try{await control?.close({strict:true});}catch{task.resourceCloseFailed=true;task.cancelError=Error('搜索控制连接清理失败，请核对服务器资源状态');}}
    })();return task.stopPending;
  }

  /** 文件写入失败也停止当前命令，但不伪装成用户取消；代次保护和控制连接收尾与取消共用。 */
  private async stopTaskCommand(task: RunningTask): Promise<void> {
    if (task.cancelPending) return task.cancelPending;
    const generation = task.generation;
    task.cancelPending = (async () => {
      if (!task.inFlight) return;
      let control: ManagedConnection | undefined;
      try {
        control = await connect(task.managed.profile);
        if (!task.inFlight || task.generation !== generation || this.tasks.get(task.id) !== task || task.managed.broken) return;
        const threadId = task.managed.connection.threadId;
        if (!Number.isSafeInteger(threadId) || (threadId ?? 0) < 1) throw new Error('无法确认待取消的连接编号');
        await execute(control, `KILL QUERY ${threadId}`);
      } catch {
        if (task.inFlight && task.generation === generation) { task.managed.broken = true; task.managed.connection.destroy(); }
      } finally { await control?.close(); }
    })();
    return task.cancelPending;
  }

  /** 参数化短操作也登记查询代次，以便导入和批量修改在同样的取消边界内运行。 */
  private async statement<T = ResultSetHeader>(task: RunningTask, sql: string, params: CellValue[] = [], acknowledged?: (result: T) => void): Promise<T> {
    this.checkCancelled(task);
    task.inFlight = true; task.generation++;
    try {
      const rows = (await execute<T>(task.managed, sql, params.map(deserializeCell))).rows;
      if (rows && typeof rows === 'object' && 'serverStatus' in rows) task.managed.serverStatus = task.serverStatus = Number(rows.serverStatus);
      acknowledged?.(rows);
      return rows;
    }
    finally { task.inFlight = false; await task.cancelPending; }
  }

  /** 显式冲突导入专用端口；原连接、取消代次及完整ACK均留在同一任务，默认导入不经过此路径。 */
  private conflictImportControl(task: RunningTask): FileImportConflictControl {
    const managed = task.managed;
    const observe = (rows: unknown) => {
      if (rows && typeof rows === 'object' && !Array.isArray(rows) && 'serverStatus' in rows && Number.isInteger(rows.serverStatus) && Number(rows.serverStatus) >= 0 && Number(rows.serverStatus) <= 65535) { managed.serverStatus = Number(rows.serverStatus); managed.transactionStateKnown = true; }
    };
    return {
      managed, checkCancelled: () => this.checkCancelled(task), cancelled: () => task.cancelled,
      progress: records => this.emit({ taskId: task.id, status: 'running', progress: 0, rows: task.fileImportConflict?.result.rows ?? 0, message: `已处理 ${records} 条源记录；已确认提交当前处理结果` }),
      query: async <T>(sql: string, values: (string | number | boolean | null | Buffer)[] = [], hooks?: { submitted?(): void; acknowledged?(rows: T): void }): Promise<T> => {
        this.checkCancelled(task);
        if (managed.broken) throw Error('原导入连接已断开，不会自动重连或重试');
        task.inFlight = true; task.generation++; managed.serverStatus = undefined; managed.transactionStateKnown = false;
        let warningKnown = false, warningBad = false;
        const onPacket = (packet: { sql?: string; warningStatus?: number }) => { if (packet.sql === sql) { warningKnown = true; if (!Number.isInteger(packet.warningStatus) || packet.warningStatus !== 0) warningBad = true; } };
        managed.connection.on('dbark:session-state', onPacket);
        try {
          hooks?.submitted?.();
          const rows = (await execute<T>(managed, sql, values)).rows;
          if (Array.isArray(rows) && (!warningKnown || warningBad)) throw Error('内部锁定或目录查询警告数未知或非零，当前批拒绝提交');
          observe(rows); hooks?.acknowledged?.(rows); return rows;
        } finally { managed.connection.removeListener('dbark:session-state', onPacket); task.inFlight = false; await task.cancelPending; }
      },
      rollback: async () => {
        await task.cancelPending;
        if (managed.broken) throw Error('原导入连接已断开，不能确认回滚');
        task.inFlight = true; task.generation++; managed.serverStatus = undefined; managed.transactionStateKnown = false;
        try { const rows = (await execute<ResultSetHeader>(managed, 'ROLLBACK')).rows; observe(rows); return rows; }
        finally { task.inFlight = false; await task.cancelPending; }
      },
    };
  }

  /** 建连前登记只读目录任务，15秒只发取消意图；原命令及物理资源确实收尾后才交付或失败。 */
  private async readImportKeys(input: Input) {
    let expired = false, settled = false, cancelling: Promise<void> | undefined;
    const pending = this.withIndependentTask(input.connectionId, input.taskId, async (managed, control) => {
      const context: StructureTaskContext = { managed, ...control };
      const query = async <T>(sql: string, values: (string | number | boolean | null | Buffer)[] = []): Promise<T> => {
        const actual = values.length ? inlineParameters(sql, values.map(value => Buffer.isBuffer(value) ? { type: 'binary' as const, base64: value.toString('base64') } : value)) : sql;
        managed.serverStatus = undefined; managed.transactionStateKnown = false;
        let warningKnown = false, warningBad = false;
        const onPacket = (packet: { sql?: string; warningStatus?: number }) => { if (packet.sql === actual) { warningKnown = true; if (packet.warningStatus !== 0) warningBad = true; } };
        managed.connection.on('dbark:session-state', onPacket);
        try {
          const rows = (await structureTaskQuery<T>(context, actual)).rows;
          if (Array.isArray(rows)) { if (!warningKnown || warningBad) throw Error('匹配键目录读取警告未知或非零'); }
          else {
            const header = rows as ResultSetHeader;
            if (!header || header.affectedRows !== 0 || header.warningStatus !== 0 || !Number.isInteger(header.serverStatus) || header.serverStatus < 0 || header.serverStatus > 65535) throw Error('匹配键目录事务未收到完整无警告ACK');
            managed.serverStatus = header.serverStatus; managed.transactionStateKnown = true;
            if (Boolean(header.serverStatus & 1) !== (sql === 'START TRANSACTION')) throw Error('匹配键目录事务状态与命令不一致');
          }
          return rows;
        } finally { managed.connection.removeListener('dbark:session-state', onPacket); }
      };
      await query('SET SESSION lock_wait_timeout = 5');
      await query('SET SESSION innodb_lock_wait_timeout = 5');
      await query('START TRANSACTION');
      // 错误/取消由独立任务严格关闭原物理连接，不在原命令未终态时抢发清理SQL。
      await query(`SELECT 1 FROM ${qualified(input.database, input.table)} LIMIT 0`);
      const result = await readFileImportKeyCatalog(managed, { connectionId: input.connectionId, database: input.database, table: input.table }, query);
      await query('ROLLBACK'); control.checkCancelled(); return result.catalog;
    }, undefined, '读取导入匹配键', true);
    const timer = setTimeout(() => { if (settled) return; expired = true; cancelling = this.cancelTask(input.taskId); void cancelling.catch(() => undefined); }, 15000);
    timer.unref();
    try { const result = await pending; if (expired) throw Error('读取匹配键目录超过15秒；原任务已收尾，未生成目录'); return result; }
    finally { settled = true; clearTimeout(timer); await cancelling; }
  }

  /** 固定诊断不走结果流或执行历史；清掉旧状态后只采信本条命令的新协议包。 */
  private transactionSettingsContext(managed: ManagedConnection, task: RunningTask, onSetSent?: () => void): QueryTransactionSettingsContext {
    return {
      status: managed.status, physicalId: () => managed.connection.threadId,
      check: () => { this.checkCancelled(task); if (managed.broken) throw Error('原会话连接已断开；不会自动重连或重放'); },
      protocolState: () => ({ known: managed.transactionStateKnown === true, broken: managed.broken, serverStatus: managed.serverStatus }),
      onSetSent: () => { task.transactionSettingsChangeSubmitted = true; onSetSent?.(); },
      query: async (sql, onSend) => {
        this.checkCancelled(task);
        if (managed.broken) throw Error('原会话连接已断开；不会自动重连或重放');
        task.inFlight = true; task.generation++;
        managed.transactionStateKnown = false; managed.serverStatus = undefined;
        try {
          // 标记位与驱动投递在同一同步调用栈；投递后失败不能自动重试设置。
          onSend?.();
          const result = await execute<unknown>(managed, sql);
          if (result.rows && typeof result.rows === 'object' && 'serverStatus' in result.rows && Number.isInteger(result.rows.serverStatus)) {
            managed.serverStatus = Number(result.rows.serverStatus); managed.transactionStateKnown = true;
          }
          return result;
        } finally { task.inFlight = false; await task.cancelPending; }
      },
    };
  }

  /** 工作台与完整导出共用唯一调度器；每次消费一条，实际执行结束后才按会话模式解释尾部。 */
  private async *queryStatements(task: RunningTask, sql: string, parameters?: QueryParameter[], currentStatement?: { offset: number }, locate?: (range: QueryFailureSourceRange | undefined) => void): AsyncGenerator<{ statement: string; template: string; mode: SqlLexicalMode; ordinal: number }> {
    locate?.(undefined);
    if (typeof sql !== 'string' || Buffer.byteLength(sql) > queryParameterLimits.sqlBytes) throw new Error('SQL 模板不能超过 20 MiB');
    const values = parameters === undefined ? undefined : validateQueryParameters(parameters, this.maxDecimalScale(task.managed), task.managed.status.dialect === 'mariadb');
    let mode = await this.sqlMode(task.managed, task);
    if (currentStatement !== undefined) {
      // 只用本会话实际模式定位；之前的SET不执行，DELIMITER过程体也不二次按分号拆分。
      const current = currentSqlStatement(sql, currentStatement.offset, mode);
      if (!current) throw new Error('光标所在位置没有可执行的完整语句；未执行相邻语句或全文');
      this.checkCancelled(task);
      locate?.({ start: current.start, end: current.end });
      yield { statement: current.sql, template: current.sql, mode, ordinal: 1 };
      locate?.(undefined);
      return;
    }
    if (values) this.parameterPlan(sql, mode, values);
    const scanner = new SqlScriptScanner(mode.noBackslashEscapes, mode.ansiQuotes, mode.ansiQuotesKnown !== false, mode.noBackslashEscapesKnown !== false);
    let ordinal = 0, expandedBytes = 0, first = true;
    const used = new Set<string>();
    for (;;) {
      this.checkCancelled(task);
      scanner.setMode(mode.noBackslashEscapes, mode.ansiQuotes, mode.ansiQuotesKnown !== false, mode.noBackslashEscapesKnown !== false);
      const chunk = first ? sql : '', located = locate ? scanner.pushLocated(chunk, true, 1)[0] : undefined;
      const template = locate ? located?.sql : scanner.push(chunk, true, 1)[0]; first = false;
      if (!template) break;
      locate?.(located?.sourceRange);
      const statement = values ? bindQueryParameters(template, values, mode) : template;
      if (values) for (const token of namedParameterTokens(template, mode)) used.add(token.name);
      if ((expandedBytes += Buffer.byteLength(statement)) > queryParameterLimits.sqlBytes) throw new Error('展开后的 SQL 合计不能超过 20 MiB');
      yield { statement, template, mode, ordinal: ++ordinal };
      // 仅恢复到下一轮才继续读取真实模式；上一条已完成的位置不得标成下一条扫描/模式错误。
      locate?.(undefined);
      mode = await this.sqlMode(task.managed, task);
    }
    if (values && [...values.keys()].some(name => !used.has(name))) throw new Error('脚本执行结束后发现未使用的多余参数；动态模式下无法提前确定全部参数边界');
  }

  /** 顺序执行脚本并共享结果预算，末尾读取真实事务状态供界面提示。 */
  private async queryScript(task: RunningTask, sql: string, maxRows: number, parameters?: QueryParameter[], currentStatement?: { offset: number }, failureMode?: 'query' | 'parameterized', continueOnError?: boolean, collectWarnings?: boolean): Promise<QueryOutcome> {
    if (continueOnError === true) return this.queryScriptContinuing(task, sql, maxRows, parameters, currentStatement, failureMode, collectWarnings);
    if (collectWarnings === true) return this.queryScriptWithWarnings(task, sql, maxRows, parameters, currentStatement, failureMode);
    const started = performance.now();
    const values = parameters !== undefined || failureMode === 'parameterized';
    const results: QueryResult[] = [];
    // 限额由整项任务共享，防止很多结果集或大 BLOB 绕过单结果集行数限制。
    const budget: ResultBudget = { remainingRows: maxRows, remainingBytes: 16 * 1024 * 1024, remainingResults: 200 };
    let executed = 0, sourceRange: QueryFailureSourceRange | undefined;
    try {
      if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100000) throw new Error('查询结果上限必须在 1～100000 之间');
      if (failureMode === 'parameterized' && !Array.isArray(parameters)) throw new Error('参数查询必须提供参数列表');
      for await (const { statement, template } of this.queryStatements(task, sql, parameters, currentStatement, failureMode ? range => { sourceRange = range ? { ...range } : undefined; } : undefined)) {
        try { results.push(...await this.streamQuery(task, statement, maxRows, results.length, budget, template, currentStatement !== undefined)); }
        catch (error) {
          if (!values) throw error;
          if (task.cancelled) this.checkCancelled(task);
          const code = (error as { code?: unknown })?.code;
          const safeCode = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? `（${code}）` : '';
          throw new Error(`参数查询失败${safeCode}；服务器错误详情可能包含参数值，已隐藏`);
        }
        sourceRange = undefined; executed++;
        this.emit({ taskId: task.id, status: 'running', progress: 0, message: `已执行 ${executed} 条语句` });
      }
    } catch (error) {
      // 用户取消仍沿原拒绝及控制连接收尾路径，不制造可继续消费的成功/部分回包。
      if (failureMode && task.cancelled) throw error;
      // 数据库错误可能含展开值，参数任务只返回代码；标签事务保持原有状态，由用户决定提交或回滚。
      const code = (error as { code?: unknown })?.code;
      const detail = values && typeof code === 'string' ? `数据库错误 ${/^[A-Z0-9_]+$/.test(code) ? code : '未知'}` : this.errorMessage(error);
      if (!failureMode) throw new Error(`第 ${executed + 1} 条 SQL 未完成；已完成 ${executed} 条，此前已提交语句保留，未自动回滚或重放。${detail}`);
      const message = queryFailureMessage(executed, detail);
      const outcome: QueryOutcome = { results, elapsedMs: performance.now() - started, failure: { statementOrdinal: executed + 1, statementsCompleted: executed, message, ...(sourceRange ? { sourceRange } : {}) } };
      // ERR没有新状态位；旧cached IN_TRANS即便非零也不能冒充失败后的真实事务状态。
      const status = task.managed.serverStatus;
      if (task.managed.transactionStateKnown !== false && !task.managed.broken && status !== undefined && Number.isInteger(status) && status >= 0 && status <= 65535) outcome.transactionOpen = (status & 1) !== 0;
      return outcome;
    }
    const transactionOpen = task.managed.serverStatus === undefined ? undefined : (task.managed.serverStatus & 1) !== 0;
    if (transactionOpen === undefined) {
      // SQL 已经执行成功，缺少协议状态不能让用户误以为可以安全重试写操作。
      task.managed.broken = true; task.managed.connection.destroy();
      this.emit({ taskId: task.id, status: 'running', progress: 99, message: 'SQL 已执行，但无法确认当前事务状态；会话已断开，请重新连接并核对结果，不要直接重复写操作。' });
    }
    return { results, elapsedMs: performance.now() - started, transactionOpen };
  }

  /** 显式警告模式仍首错即停；采集与用户SQL分开计事实，默认路径不进入此分支。 */
  private async queryScriptWithWarnings(task: RunningTask, sql: string, maxRows: number, parameters?: QueryParameter[], currentStatement?: { offset: number }, failureMode?: 'query' | 'parameterized'): Promise<QueryOutcome> {
    task.collectWarningsMode = true;
    const started = performance.now(), results: QueryResult[] = [], parameterized = parameters !== undefined || failureMode === 'parameterized';
    const warnings = new QueryWarningCollector(parameterized), budget: ResultBudget = { remainingRows: maxRows, remainingBytes: 16 * 1024 * 1024, remainingResults: 200 };
    let completed = 0, ordinal = 1, sourceRange: QueryFailureSourceRange | undefined, currentCompleted = false;
    let failure: QueryOutcome['failure'];
    try {
      if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100000) throw Error('查询结果上限必须在 1～100000 之间');
      if (failureMode === 'parameterized' && !Array.isArray(parameters)) throw Error('参数查询必须提供参数列表');
      for await (const item of this.queryStatements(task, sql, parameters, currentStatement, range => { sourceRange = range ? { ...range } : undefined; })) {
        ordinal = item.ordinal; currentCompleted = false;
        let originalError: unknown, driverError: unknown, commandEnded = false;
        const physicalId = task.managed.connection.threadId;
        try {
          results.push(...await this.streamQuery(task, item.statement, maxRows, results.length, budget, item.template, currentStatement !== undefined, { driverError: error => { driverError = error; }, commandEnded: () => { commandEnded = true; } }));
          currentCompleted = true; completed++;
        } catch (error) { originalError = error; }
        if (task.cancelled) this.checkCancelled(task);
        try {
          await this.captureQueryWarnings(task, warnings, ordinal, sourceRange, currentCompleted ? 'completed' : 'failed', commandEnded && (!originalError || originalError === driverError && canContinueQueryError(originalError)));
        } catch (captureError) {
          if (task.cancelled) throw captureError;
          // 原SQL失败事实优先，采集故障在独立warnings组明确记录，不能覆盖首错。
          if (originalError) throw originalError;
          throw captureError;
        }
        if (originalError) throw originalError;
        if (!this.queryWarningsSessionKnown(task, physicalId)) throw Error('原语句已执行，但警告采集后的原会话状态未知；已停止后续SQL，不会自动重试');
        sourceRange = undefined; ordinal = completed + 1; currentCompleted = false;
        this.emit({ taskId: task.id, status: 'running', progress: 0, message: `已执行 ${completed} 条语句` });
      }
    } catch (error) {
      if (task.cancelled) throw error;
      const detail = formatQueryScriptError(error, parameterized);
      failure = { statementOrdinal: ordinal, statementsCompleted: completed, message: currentCompleted ? `第 ${ordinal} 条SQL已执行，但警告采集或原连接状态未完整确认；请核对执行结果，不要直接重试。${detail}` : queryFailureMessage(completed, detail), ...(sourceRange ? { sourceRange } : {}) };
    }
    const outcome: QueryOutcome = { results, elapsedMs: performance.now() - started, warnings: warnings.report, ...(failure ? { failure } : {}) };
    const status = task.managed.serverStatus;
    if (!task.managed.broken && task.managed.transactionStateKnown === true && Number.isInteger(status) && status! >= 0 && status! <= 65535) outcome.transactionOpen = Boolean(status! & 1);
    return outcome;
  }

  /** 固定SHOW共用原任务代次和取消控制；不进入用户结果/SQL历史，也不自动重连或补偿事务。 */
  private async captureQueryWarnings(task: RunningTask, collector: QueryWarningCollector, statementOrdinal: number, sourceRange: QueryFailureSourceRange | undefined, status: 'completed' | 'failed', allowed: boolean): Promise<void> {
    this.checkCancelled(task);
    const statement = { statementOrdinal, ...(sourceRange ? { sourceRange: { ...sourceRange } } : {}), status };
    if (!allowed || task.managed.broken) { collector.unavailable(statement); return; }
    const physicalId = task.managed.connection.threadId, original = this.transactionSettingsContext(task.managed, task);
    await collector.capture(statement, {
      check: () => this.checkCancelled(task), broken: () => task.managed.broken,
      query: async sql => {
        this.checkCancelled(task);
        if (!Number.isSafeInteger(physicalId) || (physicalId ?? 0) < 1 || task.managed.connection.threadId !== physicalId) throw Error('原警告会话身份未知');
        const result = await original.query(sql);
        this.checkCancelled(task);
        if (task.managed.connection.threadId !== physicalId) throw Error('原警告会话身份变化');
        return result;
      },
    });
  }

  /** 诊断ERR没有新事务状态，不能因原SQL成功就绕过未知状态继续投递尾句。 */
  private queryWarningsSessionKnown(task: RunningTask, physicalId: number | undefined): boolean {
    const managed = task.managed, status = managed.serverStatus;
    return !managed.broken && Number.isSafeInteger(physicalId) && (physicalId ?? 0) > 0 && managed.connection.threadId === physicalId && managed.transactionStateKnown === true && Number.isInteger(status) && status! >= 0 && status! <= 65535;
  }

  /** 显式遇错继续共用原调度器与整批预算；成功语句和失败片段不混合，不重放任何语句。 */
  private async queryScriptContinuing(task: RunningTask, sql: string, maxRows: number, parameters?: QueryParameter[], currentStatement?: { offset: number }, failureMode?: 'query' | 'parameterized', collectWarnings?: boolean): Promise<QueryOutcome> {
    task.continueOnErrorMode = true;
    const started = performance.now(), results: QueryResult[] = [];
    const budget: ResultBudget = { remainingRows: maxRows, remainingBytes: 16 * 1024 * 1024, remainingResults: 200 };
    const report: QueryScriptReport = { mode: 'continue-on-error', statementsAttempted: 0, statementsCompleted: 0, reachedEnd: false, errors: [] };
    const parameterized = parameters !== undefined || failureMode === 'parameterized';
    const warnings = collectWarnings === true ? new QueryWarningCollector(parameterized) : undefined;
    if (warnings) task.collectWarningsMode = true;
    let sourceRange: QueryFailureSourceRange | undefined, activeOrdinal: number | undefined;
    /** 参数任务始终先分类原错误，再隐藏所有可能含展开值的明细。 */
    const record = (error: unknown, kind: 'server' | 'stopped', ordinal: number) => {
      if (report.errors.length >= queryContinueOnErrorLimits.errors) return;
      report.errors.push({ kind, statementOrdinal: ordinal, statementsCompleted: report.statementsCompleted, message: formatQueryScriptError(error, parameterized), ...(sourceRange ? { sourceRange: { ...sourceRange } } : {}) });
    };
    try {
      if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100000) throw Error('查询结果上限必须在 1～100000 之间');
      if (failureMode === 'parameterized' && !Array.isArray(parameters)) throw Error('参数查询必须提供参数列表');
      for await (const { statement, template, ordinal } of this.queryStatements(task, sql, parameters, currentStatement, range => { sourceRange = range ? { ...range } : undefined; })) {
        this.checkCancelled(task); activeOrdinal = ordinal; report.statementsAttempted = ordinal;
        let driverError: unknown, commandEnded = false, currentCompleted = false;
        const physicalId = task.managed.connection.threadId;
        try {
          const completed = await this.streamQuery(task, statement, maxRows, results.length, budget, template, currentStatement !== undefined, { driverError: error => { driverError = error; }, commandEnded: () => { commandEnded = true; } });
          results.push(...completed); currentCompleted = true; report.statementsCompleted++;
          if (warnings) await this.captureQueryWarnings(task, warnings, ordinal, sourceRange, 'completed', commandEnded);
          if (task.managed.broken || task.managed.transactionStateKnown !== true || !Number.isInteger(task.managed.serverStatus) || task.managed.serverStatus! < 0 || task.managed.serverStatus! > 65535 || warnings && !this.queryWarningsSessionKnown(task, physicalId)) { activeOrdinal = undefined; sourceRange = undefined; throw Error('当前语句已执行，但无法确认新的原会话协议状态，已停止后续语句'); }
        } catch (error) {
          if (task.cancelled) this.checkCancelled(task);
          if (task.managed.broken || error !== driverError || !canContinueQueryError(error)) {
            if (warnings && !currentCompleted) warnings.unavailable({ statementOrdinal: ordinal, sourceRange, status: 'failed' });
            if (currentCompleted) { activeOrdinal = undefined; sourceRange = undefined; }
            throw error;
          }
          record(error, 'server', ordinal);
          if (warnings) await this.captureQueryWarnings(task, warnings, ordinal, sourceRange, 'failed', commandEnded);
          if (report.errors.length >= queryContinueOnErrorLimits.errors) { report.stopReason = '错误记录已达到100条上限，已停止后续语句'; break; }
          await this.refreshContinuingSession(task);
          this.checkCancelled(task);
        }
        activeOrdinal = undefined; sourceRange = undefined;
        this.emit({ taskId: task.id, status: 'running', progress: 0, message: `已尝试 ${report.statementsAttempted} 条语句，完整完成 ${report.statementsCompleted} 条` });
      }
      if (!report.stopReason) report.reachedEnd = true;
    } catch (error) {
      if (task.cancelled) throw error;
      if (report.errors.at(-1)?.statementOrdinal !== activeOrdinal || activeOrdinal === undefined) record(error, 'stopped', activeOrdinal ?? report.statementsAttempted + 1);
      report.stopReason = truncateQueryScriptMessage(formatQueryScriptError(error, parameterized));
    }
    const outcome: QueryOutcome = { results, elapsedMs: performance.now() - started, scriptReport: report, ...(warnings ? { warnings: warnings.report } : {}) };
    if (report.errors.length) {
      const first = report.errors[0];
      outcome.failure = { statementOrdinal: first.statementOrdinal, statementsCompleted: first.statementsCompleted, message: queryScriptReportSummary(report), ...(first.sourceRange ? { sourceRange: { ...first.sourceRange } } : {}) };
    }
    const status = task.managed.serverStatus;
    if (!task.managed.broken && task.managed.transactionStateKnown === true && Number.isInteger(status) && status! >= 0 && status! <= 65535) outcome.transactionOpen = Boolean(status! & 1);
    return outcome;
  }

  /** ERR后读取会改变诊断信息，因此仅用户显式开启继续时调用；不提交、不切库、不另建连接。 */
  private async refreshContinuingSession(task: RunningTask): Promise<void> {
    const managed = task.managed, id = managed.connection.threadId;
    this.checkCancelled(task);
    if (managed.broken || !Number.isSafeInteger(id) || (id ?? 0) < 1) throw Error('无法确认继续执行的原物理会话');
    const diagnostic = 'SELECT @@SESSION.sql_mode AS __dbark_continue_mode,CAST(CONNECTION_ID() AS CHAR) AS __dbark_continue_connection,DATABASE() AS __dbark_continue_database';
    const context = this.transactionSettingsContext(managed, task), result = await context.query(diagnostic);
    this.checkCancelled(task);
    const names = ['__dbark_continue_mode', '__dbark_continue_connection', '__dbark_continue_database'];
    const response = result.rows;
    if (!Array.isArray(response) || response.length !== 1 || !response[0] || typeof response[0] !== 'object' || Array.isArray(response[0]) || Object.keys(response[0]).length !== 3 || names.some(name => !Object.hasOwn(response[0], name)) || !Array.isArray(result.fields) || result.fields.length !== 3 || result.fields.some((field, index) => field.name !== names[index])) throw Error('无法完整恢复继续执行的原会话状态');
    const row = response[0] as Record<string, unknown>, mode = row[names[0]], database = initialCompletionDatabase(row[names[2]]), protocol = context.protocolState();
    if (typeof mode !== 'string' || mode.length > 65536 || !/^(?:[A-Z0-9_]+(?:,[A-Z0-9_]+)*)?$/.test(mode) || row[names[1]] !== String(id) || managed.connection.threadId !== id || !database.known || protocol.broken || !protocol.known || !Number.isInteger(protocol.serverStatus) || protocol.serverStatus! < 0 || protocol.serverStatus! > 65535) throw Error('无法确认继续执行的原会话身份、模式或事务状态');
    if (Boolean(protocol.serverStatus! & 512) !== mode.split(',').includes('NO_BACKSLASH_ESCAPES')) throw Error('原会话模式与新鲜协议状态矛盾，已停止继续执行');
    managed.sqlMode = mode; managed.noBackslashEscapesKnown = true; managed.completionDatabase = database;
  }

  /** 在原标签会话执行一次；文件消费者背压，界面仅保留共享预算内的预览。 */
  private async exportQueryStream(task: RunningTask, input: QueryStreamExportInput & { filePath: string }): Promise<QueryStreamExportOutput> {
    const started = performance.now();
    const results: QueryExportResultSummary[] = [], preview: QueryOutcome = { results: [], elapsedMs: 0 };
    const ordinals = { results: 0, rows: 0 };
    const previews = new Map<number, QueryResult>();
    let previewBytes = queryStreamExportLimits.previewBytes - queryStreamExportLimits.results * 256;
    let lastProgress = 0;
    const progress: QueryExportProgress = task.queryExport = { phase: 'preparing', statementsCompleted: 0, rowsWritten: 0, bytesWritten: 0, fileCommitted: false, sqlMayHaveExecuted: false, transactionKnown: false, peakBufferedRows: 0, peakBufferedBytes: 0 };
    let writer: Awaited<ReturnType<typeof createQueryStreamFile>> | undefined;
    /** 人工确认等待前后仍核原物理会话；发布前断线不借新连接，既有格式沿原取消策略。 */
    const checkFile=()=>{this.checkCancelled(task);if(input.format==='sql'&&!task.fileCommitStarted&&(this.closing||task.managed.broken||this.sessions.get(input.sessionId)?.managed!==task.managed))throw Error(queryInsertZh.stale);};
    /** 状态仅来自原会话缓存，未确认时不把旧位冒充当前事务真值。 */
    const refresh = () => {
      progress.transactionKnown = !task.managed.broken && task.managed.serverStatus !== undefined && task.managed.transactionStateKnown !== false;
      progress.transactionOpen = progress.transactionKnown ? Boolean(task.managed.serverStatus! & 1) : undefined;
      if (writer) { progress.bytesWritten = writer.bytesWritten; progress.rowsWritten = writer.rowsWritten; progress.fileCommitted = writer.fileCommitted; }
    };
    const report = (force = false) => {
      refresh();
      if (force || performance.now() - lastProgress >= 100) {
        lastProgress = performance.now();
        this.emit({ taskId: task.id, status: 'running', progress: 0, message: `已执行 ${progress.statementsCompleted} 条语句，写入 ${progress.rowsWritten} 行`, rows: progress.rowsWritten, queryExport: { ...progress } });
      }
    };
    try {
      if ((input.format !== 'csv') !== (input.resultSelection.kind === 'all') || !['csv', 'json', 'csv-zip','sql'].includes(input.format)) throw new Error('JSON、CSV容器和INSERT必须导出全部结果；单CSV必须指定行结果序号');
      if(input.format==='sql')queryInsertTargetSchema.parse(input.insertTarget);else if(input.insertTarget!==undefined)throw Error(queryInsertZh.nonSql);
      if (input.resultSelection.kind === 'row-result' && (!Number.isInteger(input.resultSelection.ordinal) || input.resultSelection.ordinal < 1 || input.resultSelection.ordinal > queryStreamExportLimits.results)) throw new Error('行结果序号必须在 1～200 之间');
      if (!['text-strict', 'binary-explicit'].includes(input.protocol)) throw new Error('完整导出的执行协议无效');
      writer = await createQueryStreamFile({ filePath: input.filePath, format: input.format, encoding: input.encoding, resultSelection: input.resultSelection, ...(input.csvDelimiter === undefined ? {} : { csvDelimiter: input.csvDelimiter }), checkCancelled: checkFile, onCommitStart: () => { task.fileCommitStarted = true; progress.phase = 'committing'; report(true); },...(input.format==='sql'?{insertTarget:input.insertTarget,beforeInsertCommit:async(sample,bytes)=>{checkFile();progress.phase='awaiting-confirmation';await this.insertConfirmations.wait(task.id,sample,input.insertTarget!,input.encoding,bytes,queryInsert=>{refresh();this.emit({taskId:task.id,status:'running',progress:0,message:queryInsertZh.pending,queryExport:{...progress},queryInsert});});checkFile();}}:{}) });
      for await (const { statement, template, mode, ordinal } of this.queryStatements(task, input.sql, input.parameters)) {
        this.checkCancelled(task);
        const wire = queryExportWireProtocol(statement, input.protocol, mode);
        const statementStarted = performance.now(), previewStart = preview.results.length;
        progress.phase = 'executing'; progress.sqlMayHaveExecuted = true;
        task.inFlight = true; task.generation++;
        try {
          await consumeQueryFrames(task.managed, statement, wire, {
            statementOrdinal: ordinal, ordinals, checkCancelled: () => this.checkCancelled(task), stop: () => this.stopTaskCommand(task),
            queuePeak: (rows, bytes) => { progress.peakBufferedRows = Math.max(progress.peakBufferedRows ?? 0, rows); progress.peakBufferedBytes = Math.max(progress.peakBufferedBytes ?? 0, bytes); },
            consume: async frame => {
              this.checkCancelled(task);
              progress.currentResultOrdinal = frame.resultOrdinal; progress.phase = 'writing';
              await writer!.write(frame);
              if (frame.kind === 'rows-start' || frame.kind === 'status') {
                const status = frame.kind === 'status' ? { affectedRows: frame.affectedRows, insertId: frame.insertId, warningCount: frame.warningCount } : {};
                const summary: QueryExportResultSummary = { resultOrdinal: frame.resultOrdinal, statementOrdinal: frame.statementOrdinal, kind: frame.kind === 'status' ? 'status' : 'rows', rowsWritten: 0, ...status, ...(frame.kind === 'rows-start' ? { rowResultOrdinal: frame.rowResultOrdinal } : {}) };
                results.push(summary);
                const columns = frame.kind === 'rows-start' ? frame.columns.map(({ key, name, type }) => ({ key, name, type })) : [];
                const text = template.slice(0, 32768), bytes = Buffer.byteLength(text) + Buffer.byteLength(JSON.stringify(columns));
                const retained = bytes <= previewBytes;
                if (retained) previewBytes -= bytes;
                const result: QueryResult = { columns: retained ? columns : [], rows: [], statement: retained ? text : '', elapsedMs: 0, truncated: !retained, ...status };
                preview.results.push(result); previews.set(frame.resultOrdinal, result);
              } else if (frame.kind === 'rows-end') {
                if (frame.warningCount !== undefined) {
                  results[frame.resultOrdinal - 1].warningCount = frame.warningCount;
                  previews.get(frame.resultOrdinal)!.warningCount = frame.warningCount;
                }
              } else if (frame.kind === 'row') {
                const summary = results[frame.resultOrdinal - 1];
                if (input.resultSelection.kind === 'all' || summary.rowResultOrdinal === input.resultSelection.ordinal) summary.rowsWritten++;
                const result = previews.get(frame.resultOrdinal)!;
                if (!result.truncated && result.rows.length < queryStreamExportLimits.previewRows) {
                  const row = Object.fromEntries(frame.values.map((value, index) => [`c${index}`, value]));
                  const bytes = Buffer.byteLength(JSON.stringify(row));
                  if (bytes <= previewBytes && bytes <= 256 * 1024) { result.rows.push(row); previewBytes -= bytes; }
                  else result.truncated = true;
                } else result.truncated = true;
              }
              this.checkCancelled(task); report(); progress.phase = 'executing';
            },
          });
        } finally { task.inFlight = false; await task.cancelPending; }
        for (const result of preview.results.slice(previewStart)) result.elapsedMs = performance.now() - statementStarted;
        progress.statementsCompleted++; report(true);
      }
      if (!progress.statementsCompleted) throw new Error('没有可执行的 SQL 语句');
      this.checkCancelled(task); progress.phase = 'writing';
      await writer.complete();
      await writer.abort();
      refresh(); preview.elapsedMs = performance.now() - started; preview.transactionOpen = progress.transactionOpen;
      return { statementsCompleted: progress.statementsCompleted, results, fileCommitted: true, transactionKnown: progress.transactionKnown, transactionOpen: progress.transactionOpen, preview };
    } catch (error) {
      let cleanupError: unknown, cleanupFailed = false;
      // 清理错误不能遮蔽服务器 ERR 后的未知事务状态，也不能跳过统一失败摘要。
      try { await writer?.abort(); }
      catch (failure) { cleanupFailed = true; cleanupError = failure; }
      finally { refresh(); }
      const code = (error as { code?: unknown })?.code;
      const safeCode = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? `（${code}）` : '';
      const detail = input.parameters !== undefined ? `完整导出失败${safeCode}；错误详情可能包含参数值，已隐藏` : this.errorMessage(error);
      const cleanupDetail = cleanupFailed ? `；临时文件清理失败${input.parameters !== undefined ? '，错误详情已隐藏' : `：${this.errorMessage(cleanupError)}`}` : '';
      throw new Error(`完整导出在${{ preparing: '准备', executing: '执行', writing: '写入', 'awaiting-confirmation':'等待发布确认', committing: '文件提交' }[progress.phase]}阶段失败；已完成 ${progress.statementsCompleted} 条 SQL。${progress.sqlMayHaveExecuted ? 'SQL 可能已执行，此前已提交操作保留，未自动回滚或重放。' : '尚未发送用户 SQL。'}${detail}${cleanupDetail}`);
    }
  }

  /** 多结果集按服务器序号隔离；IPC 每批至多 200 行，返回结果受用户上限约束。 */
  private async streamQuery(task: RunningTask, sql: string, maxRows: number, offset: number, budget: ResultBudget = { remainingRows: maxRows, remainingBytes: 16 * 1024 * 1024, remainingResults: 200 }, displaySql = sql, reportExecutionSql = false, continuing?: { driverError(error: Error): void; commandEnded?(): void; commandSucceeded?(): void; affectedRows?(value: unknown): void }): Promise<QueryResult[]> {
    this.checkCancelled(task);
    task.inFlight = true; task.generation++;
    const started = performance.now(), results: QueryResult[] = [], batches = new Map<number, DataRow[]>(), batchBytes = new Map<number, number>();
    const discarded = new Set<number>();
    // 显式继续时仅保留已有有界rows；整条成功后才发布，CALL中途ERR不会泄露部分结果。
    const report = (event: TaskEvent) => { if (!continuing) this.emit(event); };
    let nextImplicitResult = 0;
    /** 按服务器结果序号分配结果容器，超过任务预算后不再保留后续结果。 */
    const ensure = (index: number): QueryResult | undefined => {
      if (discarded.has(index)) return;
      if (!results[index]) {
        const text = displaySql.length > 32768 ? displaySql.slice(0, 32768) + '\n-- 结果附带 SQL 文本已截断；完整语句可在执行历史查看。' : displaySql;
        const bytes = Buffer.byteLength(text);
        if (budget.remainingResults <= 0 || bytes + 256 > budget.remainingBytes) { discarded.add(index); return; }
        budget.remainingResults--;
        budget.remainingBytes -= bytes + 256;
        results[index] = { columns: [], rows: [], truncated: false, elapsedMs: 0, statement: text };
      }
      return results[index];
    };
    /** 将当前结果集的缓冲批次送出；不同结果集不会混用列定义与数据。 */
    const flush = (index: number) => {
      const batch = batches.get(index);
      if (batch?.length) report({ taskId: task.id, status: 'running', progress: 0, message: `已接收 ${results[index].rows.length} 行`, resultIndex: offset + index, batch, rows: results[index].rows.length });
      batches.set(index, []); batchBytes.set(index, 0);
    };
    try {
      await new Promise<void>((resolve, reject) => {
        const query = task.managed.connection.query({ sql, rowsAsArray: true });
        // 驱动已接收当前片段后才授权落历史；取消/定位失败/同步投递失败都没有全文或空SQL历史。
        if (reportExecutionSql && !continuing) this.emit({ taskId: task.id, status: 'running', progress: 0, message: '已发送当前语句', executionSql: sql });
        /** 驱动解析器或底层连接的致命错误也必须结束任务，不能让界面永久等待。 */
        let settled = false;
        const fail = (error: Error) => { if (settled) return; settled = true; task.managed.transactionStateKnown = false; cleanup(); reject(error); };
        let deferredError: Error | undefined;
        let activeRowsIndex: number | undefined, pendingRowsWarning: number | undefined;
        /** EOF和OK共用会话事件；先暂存，到下一边界排除紧随其后的CALL状态包。 */
        const finishRowsWarning = () => {
          if (activeRowsIndex !== undefined && pendingRowsWarning !== undefined && results[activeRowsIndex]) results[activeRowsIndex].warningCount = pendingRowsWarning;
          pendingRowsWarning = undefined;
        };
        const onSessionState = (packet: { sql?: string; warningStatus?: number }) => {
          if (settled || packet.sql !== sql) return;
          finishRowsWarning();
          if (Number.isInteger(packet.warningStatus) && packet.warningStatus! >= 0 && packet.warningStatus! <= 65535) pendingRowsWarning = packet.warningStatus;
        };
        const transport = continuing ? (task.managed.connection as unknown as { stream?: { once(event: string, listener: () => void): void; removeListener(event: string, listener: () => void): void } }).stream : undefined;
        const connectionFailed = (error: Error) => { if (settled) return; task.managed.broken = true; fail(deferredError ?? error); };
        const connectionEnded = () => connectionFailed(new Error('查询连接在结果完成前断开；不会自动重连或重放'));
        const cleanup = () => { task.managed.connection.removeListener('error', connectionFailed); task.managed.connection.removeListener('end', connectionEnded); task.managed.connection.removeListener('dbark:session-state', onSessionState); transport?.removeListener('close', connectionEnded); };
        task.managed.connection.once('error', connectionFailed); task.managed.connection.once('end', connectionEnded);
        task.managed.connection.on('dbark:session-state', onSessionState);
        transport?.once('close', connectionEnded);
        /** 本地消费异常只停止原命令并等待终态，不凭伪造errno把它当服务器ERR继续。 */
        const consume = <T extends unknown[]>(action: (...args: T) => void): ((...args: T) => void) => !continuing ? action : (...args) => {
          if (settled || deferredError) return;
          try { action(...args); }
          catch (error) { deferredError = error instanceof Error ? error : Error(String(error)); void this.stopTaskCommand(task).catch(() => undefined); }
        };
        query.on('fields', consume((fields: FieldPacket[] | undefined, index: number | undefined) => {
          if (settled) return;
          // mysql2 对 DDL/DML 状态包会发送 fields(undefined)，该包没有列定义。
          if (!fields) return;
          const resultIndex = index ?? nextImplicitResult;
          finishRowsWarning(); activeRowsIndex = resultIndex;
          nextImplicitResult = resultIndex + 1;
          const result = ensure(resultIndex); if (!result) return;
          result.columns = this.columns(fields);
          const bytes = Buffer.byteLength(JSON.stringify(result.columns));
          if (bytes > budget.remainingBytes) { result.columns = []; result.truncated = true; }
          else budget.remainingBytes -= bytes;
          report({ taskId: task.id, status: 'running', progress: 0, message: '读取结果集', resultIndex: offset + resultIndex, columns: result.columns });
        }));
        query.on('result', consume((value: unknown[] | ResultSetHeader, resultIndex: number | undefined) => {
          if (settled) return;
          // CALL 的最终状态包没有索引，必须接在已有行结果集之后，不能覆盖首个结果。
          const index = resultIndex ?? nextImplicitResult;
          if (!Array.isArray(value)) { nextImplicitResult = index + 1; pendingRowsWarning = undefined; activeRowsIndex = undefined; }
          if (!Array.isArray(value)) { task.managed.serverStatus = task.serverStatus = value.serverStatus; continuing?.affectedRows?.(value.affectedRows); }
          const result = ensure(index); if (!result) return;
          if (!Array.isArray(value)) {
            result.affectedRows = value.affectedRows; result.insertId = String(value.insertId); result.warningCount = value.warningStatus; return;
          }
          if (result.truncated || result.rows.length >= maxRows || budget.remainingRows <= 0) { result.truncated = true; return; }
          // 先检查原始值大小，避免将巨大 Buffer 编成 base64 后才发现超限。
          const rawSize = this.rawRowBytes(value);
          if (rawSize > 256 * 1024 || rawSize > budget.remainingBytes) { result.truncated = true; return; }
          const row = Object.fromEntries(value.map((cell, index) => [`c${index}`, serializeCell(cell)]));
          const size = Buffer.byteLength(JSON.stringify(row));
          if (size > 256 * 1024 || size > budget.remainingBytes) { result.truncated = true; return; }
          budget.remainingRows--; budget.remainingBytes -= size;
          result.rows.push(row);
          const batch = batches.get(index) ?? []; batch.push(row); batches.set(index, batch);
          batchBytes.set(index, (batchBytes.get(index) ?? 0) + size);
          if (batch.length >= 200 || (batchBytes.get(index) ?? 0) >= 256 * 1024) flush(index);
        }));
        query.once('error', error => {
          if (!continuing) { fail(error); return; }
          if (!deferredError) { deferredError = error; continuing.driverError(error); }
          // 服务器ERR不等于命令end；原终态到达前不能发送状态诊断或下一句。
        }).once('end', () => { continuing?.commandEnded?.(); if (settled) return; finishRowsWarning(); if (deferredError) { fail(deferredError); return; } continuing?.commandSucceeded?.(); settled = true; cleanup(); resolve(); });
        if (reportExecutionSql && continuing) consume(() => this.emit({ taskId: task.id, status: 'running', progress: 0, message: '已发送当前语句', executionSql: sql }))();
      });
      for (let index = 0; index < results.length; index++) { flush(index); if (results[index]) results[index].elapsedMs = performance.now() - started; }
      if (discarded.size) {
        const last = results.filter(Boolean).at(-1); if (last) last.truncated = true;
        this.emit({ taskId: task.id, status: 'running', progress: 0, message: '结果达到 200 个结果集或 16 MiB 总上限，后续结果未传输；语句仍已执行。请拆分脚本查看。' });
      }
      this.checkCancelled(task);
      if (continuing) for (let index = 0; index < results.length; index++) {
        const result = results[index]; if (!result) continue;
        if (result.columns.length) this.emit({ taskId: task.id, status: 'running', progress: 0, message: '读取结果集', resultIndex: offset + index, columns: result.columns });
        for (let start = 0; start < result.rows.length; start += 200) this.emit({ taskId: task.id, status: 'running', progress: 0, message: `已接收 ${Math.min(start + 200, result.rows.length)} 行`, resultIndex: offset + index, batch: result.rows.slice(start, start + 200), rows: Math.min(start + 200, result.rows.length) });
      }
      task.serverStatus = task.managed.serverStatus;
      return results.filter(Boolean);
    } finally { task.inFlight = false; await task.cancelPending; }
  }

  /** 任一更新/删除未精确命中一行即视为冲突，整批回滚；FOUND_ROWS 允许原值回写。 */
  private async applyChanges(task: RunningTask, input: Input): Promise<{ affectedRows: number }> {
    const evidence = task.tableApply = emptyTableApplyEvidence(), binding = input.tableApplyBinding as TableApplyBinding | undefined;
    let info: import('../shared/contracts').TableInfo;
    try { info = await metadata.tableInfo(task.managed, input.database, input.table); }
    catch (error) {
      if (binding) this.emit({ taskId: task.id, status: 'running', progress: 0, message: '提交前检查未完成', tableApply: { operationId: binding.operationId, sequence: 1, phase: 'terminal', reason: 'validation', evidence } });
      throw error;
    }
    return applyTableTransaction(info, input.changes, {
      evidence, operationId: binding?.operationId, expectedPlan: binding?.plan,
      checkCancelled: () => this.checkCancelled(task), broken: () => task.managed.broken, cancelled: () => task.cancelled,
      send: (sql, params, ack) => this.statement(task, sql, params, ack),
      lockInfo: async () => { await this.statement(task, 'SELECT 1 FROM ' + qualified(input.database, input.table) + ' LIMIT 0'); return metadata.tableInfo(task.managed, input.database, input.table); },
      rollback: async () => (await execute<ResultSetHeader>(task.managed, 'ROLLBACK')).rows,
      emit: progress => this.emit({ taskId: task.id, status: 'running', progress: 0, message: progress.phase === 'committing' ? '正在确认提交，暂不能取消' : '数据提交结果请查看提交记录', tableApply: progress })
    });
  }

  /** Excel 在写入前重验完整工作表、指纹与目标映射，再复用文件导入的分批事务和参数绑定。 */
  private async importExcel(task: RunningTask, input: Input): Promise<{ rows: number; errors: string[] }> {
    const options = { filePath: input.filePath, sheetId: input.sheetId, headerRow: input.headerRow, protocol: input.protocol, checkCancelled: () => this.checkCancelled(task) };
    const sample = await previewExcelSheet(options);
    if (sample.fingerprint !== input.fingerprint) throw new Error('工作簿自预览后已发生变化，请重新预览并确认字段映射');
    const info = await metadata.tableInfo(task.managed, input.database, input.table);
    validateExcelMapping(input.mapping, sample.columns, info.columns.filter(column => !column.generated).map(column => column.name));
    // 与表格修改共用可靠键、InnoDB 和类型化参数策略；仅追加，不更新既有记录。
    buildChanges(info, []);
    return this.importFile(task, { ...input, format: 'xlsx', mapping: Object.fromEntries(input.mapping.map((item: { source: string; target: string }) => [item.source, item.target])) }, readExcelRows({ ...options, expectedFingerprint: input.fingerprint }));
  }

  /** 独立连接以一致性快照流式读表；有限样本明确限制 1000 行，完整范围仍受 XLSX 产品预算约束。 */
  private async exportExcel(task: RunningTask, input: Input): Promise<{ rows: number }> {
    const info = await metadata.tableInfo(task.managed, input.database, input.table);
    const engine = this;
    /** 数据流结束并回滚只读快照后，文件引擎才可原子替换目标；失败和取消都等待流释放。 */
    async function* rows(): AsyncGenerator<CellValue[]> {
      await engine.statement(task, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await engine.statement(task, 'START TRANSACTION WITH CONSISTENT SNAPSHOT');
      try {
        engine.checkCancelled(task); task.inFlight = true; task.generation++;
        const order = info.editableKey.length ? ` ORDER BY ${info.editableKey.map(identifier).join(', ')}` : '';
        const sql = `SELECT ${info.columns.map(column => identifier(column.name)).join(', ')} FROM ${qualified(input.database, input.table)}${order}${input.scope === 'all' ? '' : ' LIMIT 1000'}`;
        const options = { sql, rowsAsArray: true };
        const query = info.columns.some(column => /^(?:FLOAT|DOUBLE|REAL)\b/i.test(column.type)) ? task.managed.connection.execute(options) : task.managed.connection.query(options);
        const stream = query.stream({ highWaterMark: 32 });
        const settled = finished(stream, { cleanup: true }); void settled.catch(() => undefined);
        try { for await (const row of stream) { engine.checkCancelled(task); yield (row as unknown[]).map(serializeCell); } }
        finally {
          // 消费者因写盘失败或预算中止时同样停止实际 SELECT，不能留下服务器继续生产整张表。
          if (!stream.readableEnded) await engine.stopTaskCommand(task);
          stream.destroy(); await settled.catch(() => undefined); task.inFlight = false; await task.cancelPending;
        }
      } finally {
        task.inFlight = false; await task.cancelPending;
        if (!task.managed.broken) await execute(task.managed, 'ROLLBACK');
      }
    }
    const result = await exportExcelFile({ filePath: input.filePath, columns: info.columns, rows: rows(), checkCancelled: () => this.checkCancelled(task), onCommitStart: () => { task.fileCommitStarted = true; }, onProgress: count => this.emit({ taskId: task.id, status: 'running', progress: 0, rows: count, message: `已写入 Excel ${count} 行` }) });
    return { rows: result.rows };
  }

  /** CSV/JSON可整文件单事务；缺省保持每500行提交，任何未知终态都不重放或伪报回滚。 */
  private async importFile(task: RunningTask, input: Input, records?: AsyncIterable<DataRow>): Promise<{ rows: number; errors: string[] }> {
    const transactionMode = fileImportTransactionMode(input.format, input), atomic = transactionMode === 'atomic';
    // 内部调用也不能把 CSV 标题选项混入 SQL、JSON 或 Excel，并在任何事务前校验。
    if (Object.hasOwn(input, 'csvHasHeader')) {
      if (typeof input.csvHasHeader !== 'boolean') throw new Error('CSV 首行字段名配置必须为布尔值');
      csvImportHasHeader(input.format, input.csvHasHeader);
    }
    if (input.format === 'sql') return this.importSql(task, input);
    if (!['csv', 'json'].includes(input.format) && !(input.format === 'xlsx' && records)) throw new Error('不支持的导入格式');
    const evidence = task.fileImport ??= { committing: false, finalCommit: false, commitAcknowledged: false, committedRows: 0 };
    /** 映射只信当前同会话真实目录，禁止生成列与重复目标，数值仍交原无损校验。 */
    const plan = (info: Awaited<ReturnType<typeof metadata.tableInfo>>) => {
      if (info.engine.toUpperCase() !== 'INNODB') throw new Error('CSV/JSON 导入仅支持 InnoDB 表，以保证失败可回滚');
      if (atomic && info.objectKind !== 'table') throw new Error('整文件原子提交仅支持可确认的 InnoDB 基本表');
      const columns = new Map(info.columns.map(column => [column.name, column])), mapping = Object.entries(input.mapping as Record<string, string>);
      if (!mapping.length) throw new Error('请至少映射一个源字段');
      if (new Set(mapping.map(([, target]) => target)).size !== mapping.length) throw new Error('多个源字段不能映射到同一个目标字段');
      for (const [, target] of mapping) if (!columns.has(target) || columns.get(target)?.generated) throw new Error(`目标字段不存在或为生成列：${target}`);
      return { info, columns, mapping, insertPrefix: `INSERT INTO ${qualified(input.database, input.table)} (${mapping.map(([, target]) => identifier(target)).join(', ')}) VALUES ` };
    };
    let selected = atomic ? undefined : plan(await metadata.tableInfo(task.managed, input.database, input.table));
    let committed = 0, pending = 0, sourceLine = 0, committing = false, transactionStarted = false, transactionProtected = false;
    const status = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535;
    /** 原子模式必须看到真实连续IN_TRANS；不能把缓存缺项或隐式提交当成受保护事务。 */
    const checkTransaction = () => {
      if (atomic && (task.managed.broken || task.managed.transactionStateKnown !== true || !status(task.managed.serverStatus) || !(task.managed.serverStatus & 1))) { transactionProtected = false; throw Error(fileImportTransactionText.transactionUnknown); }
    };
    /** COMMIT的原ACK先登记行数，再等待取消/通知收尾；未知提交绝不补发ROLLBACK来伪造撤销。 */
    const commit = async (final: boolean) => {
      this.checkCancelled(task); checkTransaction(); committing = true; evidence.committing = true; evidence.finalCommit = final;
      await this.statement<ResultSetHeader>(task, 'COMMIT', [], acknowledged => {
        if (atomic ? !status(acknowledged.serverStatus) || !!(acknowledged.serverStatus & 1) : acknowledged.serverStatus !== undefined && (!status(acknowledged.serverStatus) || !!(acknowledged.serverStatus & 1))) throw Error(fileImportTransactionText.commitUnknown);
        committed += pending; pending = 0; transactionStarted = false; evidence.committedRows = committed;
        if (final) { evidence.commitAcknowledged = true; evidence.result = { rows: committed, errors: [] }; }
        else { committing = false; evidence.committing = false; }
      });
    };
    try {
      await this.statement<ResultSetHeader>(task, 'START TRANSACTION', [], acknowledged => { transactionStarted = true; if (atomic && (!status(acknowledged.serverStatus) || !(acknowledged.serverStatus & 1))) throw Error(fileImportTransactionText.transactionUnknown); });
      if (atomic) {
        checkTransaction();
        try { await this.statement(task, `SELECT 1 FROM ${qualified(input.database, input.table)} LIMIT 0`); }
        catch (error) { throw Error(`${fileImportTransactionText.lockFailed}。${this.errorMessage(error)}`); }
        checkTransaction(); selected = plan(await metadata.tableInfo(task.managed, input.database, input.table)); checkTransaction(); transactionProtected = true;
        this.emit({ taskId: task.id, status: 'running', progress: 0, rows: 0, message: fileImportTransactionText.atomicScope });
      }
      const { info, columns, mapping, insertPrefix } = selected!;
      for await (const row of records ?? readRecords(input.filePath, input.format, input.encoding, input.csvDelimiter, input.csvHasHeader)) {
        this.checkCancelled(task); checkTransaction(); sourceLine++;
        const values = mapping.map(([source, target]) => {
          if (!Object.hasOwn(row, source)) throw new Error(`源记录缺少字段：${source}`);
          let value = row[source];
          if (input.format === 'csv' && typeof value === 'string' && value.startsWith('base64:') && /^(?:tinyblob|blob|mediumblob|longblob|binary|varbinary|bit)/i.test(columns.get(target)!.type)) value = { type: 'binary', base64: value.slice(7) };
          validateLosslessImport(columns.get(target)!, value, task.managed.status.dialect);
          return value;
        });
        let inserted: ResultSetHeader;
        if (input.format === 'xlsx') {
          const change = buildChanges(info, [{ kind: 'insert', values: Object.fromEntries(mapping.map(([, target], index) => [target, values[index]])) }]).statements[0];
          inserted = await this.statement(task, change.sql, change.params);
        } else inserted = await this.statement(task, insertPrefix + '(' + mapping.map(([, target], index) => typedCellPlaceholder(columns.get(target)!, values[index])).join(', ') + ')', values);
        pending++;
        if (atomic && (!status(inserted.serverStatus) || !(inserted.serverStatus & 1))) { transactionProtected = false; throw Error(fileImportTransactionText.transactionUnknown); }
        checkTransaction();
        if (atomic && inserted.affectedRows !== 1) throw Error('INSERT影响行数无法确认为一行，整文件拒绝提交');
        // OK 包的警告数必须立即核对；SHOW WARNINGS 是诊断语句，不能先发下一条 INSERT/COMMIT 清掉诊断区。
        if (!Number.isSafeInteger(inserted.warningStatus) || inserted.warningStatus !== 0) {
          const diagnostics = await this.statement<{ Code: number; Level: string }[]>(task, 'SHOW WARNINGS LIMIT 32');
          const codes = Array.isArray(diagnostics) ? diagnostics.map(item => String(item.Code)).filter(code => /^\d+$/.test(code)).join(', ') : '';
          throw new Error(`INSERT 返回警告或无法确认警告数，当前批拒绝提交，不能确认无损转换${codes ? `；诊断代码：${codes}` : ''}`);
        }
        if (!atomic && pending === 500) {
          await commit(false);
          this.emit({ taskId: task.id, status: 'running', progress: 0, rows: committed, message: `已提交 ${committed} 行（每批 500 行）` });
          await this.statement(task, 'START TRANSACTION', [], () => { transactionStarted = true; });
        } else if (atomic && pending % 500 === 0) this.emit({ taskId: task.id, status: 'running', progress: 0, rows: 0, message: `已写入 ${pending} 行，整文件仍待提交；尚未确认任何行提交` });
      }
      await commit(true); return evidence.result!;
    } catch (error) {
      if (evidence.commitAcknowledged && evidence.result) return evidence.result;
      let rolledBack = false, cancellationFailure: unknown;
      if (!committing && transactionStarted) {
        // 先等原代次取消控制结束，不能让迟到KILL落到本轮清理ROLLBACK。
        try { await task.cancelPending; } catch (failure) { cancellationFailure = failure; }
        if (!task.managed.broken) try { const result = (await execute<ResultSetHeader>(task.managed, 'ROLLBACK')).rows; rolledBack = status(result.serverStatus) && !(result.serverStatus & 1) && result.warningStatus === 0; } catch { /* 仅在原ACK完整时宣称已回滚。 */ }
      }
      const rollback = committing ? fileImportTransactionText.commitUnknown : transactionStarted && (!rolledBack || atomic && !transactionProtected && pending > 0) ? fileImportTransactionText.rollbackUnknown : transactionStarted ? atomic ? '整文件目标表事务已确认回滚' : `当前批 ${pending} 行已回滚` : '当前事务尚未写入数据';
      const message = `第 ${sourceLine || 1} 条记录导入失败；已确认提交 ${committed} 行，${rollback}。${this.errorMessage(error)}${cancellationFailure ? `；取消控制收尾失败：${this.errorMessage(cancellationFailure)}` : ''}`;
      evidence.failure = new Error(message);
      if (task.cancelled || cancellationFailure) throw evidence.failure;
      // 保留已提交行数与定位信息，调用方可以展示明确的部分成功结果。
      this.emit({ taskId: task.id, status: 'running', progress: 0, rows: committed, message });
      return { rows: committed, errors: [message] };
    }
  }

  /** SQL 脚本遵循其自身事务语义；DDL 隐式提交与此前已提交语句不能回滚。 */
  private async importSql(task: RunningTask, input: Input): Promise<FileImportResult> {
    const evidence = task.sqlFileImport ??= createSqlFileImportEvidence(task.id, input.encoding);
    const receipt = evidence.result.sql!, positions = new SqlFileImportPositions();
    let phase: NonNullable<SqlFileImportReceipt['failure']>['phase'] = 'initial-mode';
    /** 阶段也由异步drain闭包更新；显式读取完整联合类型，不沿用外层词法窄化。 */
    const currentPhase = (): NonNullable<SqlFileImportReceipt['failure']>['phase'] => phase;
    let current: NonNullable<SqlFileImportReceipt['failure']>['statement'];
    let attempted = false, currentCompleted = false, pendingRows = 0, legacyRows = 0;
    /** 服务器完整返回的影响计数单独累计；溢出或非法值降为未知，不伪造精确零。 */
    const add = (left: number | null, right: unknown): number | null => left !== null && typeof right === 'number' && Number.isSafeInteger(right) && right >= 0 && Number.isSafeInteger(left + right) ? left + right : null;
    /** 原连接只尝试一次ROLLBACK；完整ACK、无warning及新鲜关闭状态缺一不可。 */
    const rollback = async () => {
      receipt.rollback = { state: 'unconfirmed', message: '原连接回滚结果尚未确认；此前提交及非事务副作用可能保留' };
      try {
        await task.cancelPending;
        if (task.managed.broken) throw Error('原连接已断开，不能确认回滚');
        task.inFlight = true; task.generation++; task.managed.serverStatus = undefined; task.managed.transactionStateKnown = false;
        const result = (await execute<ResultSetHeader>(task.managed, 'ROLLBACK')).rows;
        if (!result || Array.isArray(result) || !Number.isInteger(result.serverStatus) || result.serverStatus < 0 || result.serverStatus > 65535 || (result.serverStatus & 1) !== 0 || result.warningStatus !== 0 || result.affectedRows !== 0 || sqlFileImportTransaction(task.managed) !== 'closed' || task.managed.serverStatus !== result.serverStatus) throw Error('ROLLBACK未收到可确认的无警告关闭事务ACK');
        receipt.rollback = { state: 'confirmed' };
      } catch (error) { receipt.rollback.message = sqlFileImportMessage(this.errorMessage(error)); }
      finally { task.inFlight = false; receipt.transaction = sqlFileImportTransaction(task.managed); }
    };
    try {
      const initialMode = await this.sqlMode(task.managed, task);
      const scanner = new SqlScriptScanner(initialMode.noBackslashEscapes, initialMode.ansiQuotes, initialMode.ansiQuotesKnown !== false, initialMode.noBackslashEscapesKnown !== false);
      /** 每次仅执行一个原扫描范围；模式刷新失败仍属于刚完成的语句。 */
      const drain = async (chunk: string, final = false) => {
        positions.append(chunk); let first = true;
        for (;;) {
          phase = 'parse'; current = undefined; this.checkCancelled(task);
          const item = scanner.pushLocated(first ? chunk : '', final, 1)[0]; first = false;
          if (!item) { positions.discardBefore(scanner.retainedSourceOffset); return; }
          const location = positions.locate(item.sourceRange);
          current = { ordinal: receipt.completedStatements + 1, ...(location ? { location } : {}) };
          phase = 'execute'; attempted = true; currentCompleted = false;
          let affected: number | null = 0, observedAffected = false;
          const completed = () => {
            if (currentCompleted) return; currentCompleted = true; receipt.completedStatements++;
            receipt.serverReportedAffectedRows = affected === null ? null : add(receipt.serverReportedAffectedRows, affected);
            const start = item.sql.replace(/^(?:\s+|\/\*[\s\S]*?\*\/|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$))*/, '');
            // 只保留旧rows兼容估算，不据此宣称提交/持久行数；SAVEPOINT同样不能推算持久效果。
            if (/^ROLLBACK\b(?!\s+(?:WORK\s+)?TO\b)/i.test(start)) pendingRows = 0;
            else {
              if (/^(?:BEGIN\b|START\s+TRANSACTION\b)/i.test(start)) { legacyRows += pendingRows; pendingRows = 0; }
              pendingRows += affected ?? 0;
              if (sqlFileImportTransaction(task.managed) === 'closed') { legacyRows += pendingRows; pendingRows = 0; }
            }
          };
          const result = await this.streamQuery(task, item.sql, 1, 0, undefined, item.sql, false, { driverError: () => {}, affectedRows: value => { observedAffected = true; affected = add(affected, value); }, commandSucceeded: completed });
          // 网络端口替身可只返回完整结果；真实驱动在command end先记录ACK事实，取消晚到也不会抹掉它。
          if (!currentCompleted) { if (!observedAffected) for (const set of result) if (set.affectedRows !== undefined) affected = add(affected, set.affectedRows); completed(); }
          phase = 'mode-refresh'; current!.ordinal = receipt.completedStatements;
          const mode = await this.sqlMode(task.managed, task);
          scanner.setMode(mode.noBackslashEscapes, mode.ansiQuotes, mode.ansiQuotesKnown !== false, mode.noBackslashEscapesKnown !== false);
          positions.discardBefore(scanner.retainedSourceOffset);
          if (receipt.completedStatements % 100 === 0) this.emit({ taskId: task.id, status: 'running', progress: 0, message: `已完整执行${receipt.completedStatements}条SQL；累计服务器影响计数不是提交行数` });
        }
      };
      phase = 'read';
      for await (const chunk of readText(input.filePath, input.encoding)) { await drain(chunk); phase = 'read'; current = undefined; }
      await drain('', true); phase = 'finalize'; current = undefined; this.checkCancelled(task);
      receipt.transaction = sqlFileImportTransaction(task.managed);
      if (receipt.transaction === 'unknown') throw Error('无法确认SQL脚本结束时的服务器事务状态');
      if (receipt.transaction === 'open') throw Error('脚本结束时仍有未提交事务；请为脚本补充明确的COMMIT/ROLLBACK');
      receipt.termination = 'completed'; delete receipt.failure;
    } catch (error) {
      // 完整end后才到达的取消/消费者异常，不得虚构下一条执行失败。
      let failurePhase = currentPhase();
      if (failurePhase === 'execute' && currentCompleted) { failurePhase = 'finalize'; current = undefined; }
      receipt.termination = task.cancelled ? 'cancelled' : 'failed';
      receipt.failure = { phase: failurePhase, message: sqlFileImportMessage(failurePhase === 'read' ? '读取SQL文件失败；请核对所选文件及读取权限' : this.errorMessage(error)), ...((failurePhase === 'execute' || failurePhase === 'mode-refresh') && current ? { statement: current } : {}) };
      if (attempted) await rollback(); else receipt.transaction = sqlFileImportTransaction(task.managed);
    }
    evidence.result.rows = Number.isSafeInteger(legacyRows) && legacyRows >= 0 ? legacyRows : 0;
    return finishSqlFileImportEvidence(evidence, task.cancelled);
  }

  /** 导出使用流背压和临时文件；完成后原子替换，取消或失败不留下伪完整目标文件。 */
  private async exportFile(task: RunningTask, input: Input, projection?: CsvExportFieldSnapshot & { selected: string[] }): Promise<{ rows: number }> {
    if (!['csv', 'json', 'sql'].includes(input.format)) throw new Error('不支持的导出格式');
    if (!input.includeData && !(input.format === 'sql' && input.includeStructure)) throw new Error('请选择导出数据，或以 SQL 格式导出结构');
    const encoding = encodingName(input.encoding), delimiter = csvExportDelimiter(input.format, input.csvDelimiter); let selectedTransaction = false;
    try {
    if (projection) {
      // 同一独立会话先取得事务MDL再重读目录；LIMIT 0不读取行值，DDL不能在核对后换列。
      await this.statement(task, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await this.statement(task, 'START TRANSACTION WITH CONSISTENT SNAPSHOT'); selectedTransaction = true;
      await this.statement(task, 'SELECT 1 FROM ' + qualified(input.database, input.table) + ' LIMIT 0');
    }
    const info = await metadata.tableInfo(task.managed, input.database, input.table);
    if (input.format === 'sql' && input.includeStructure) {
      // 使用本次独立导出连接的完整缓存模式；在创建临时文件前拒绝不可保真定义，不重写或删除默认值。
      const mode = task.managed.sqlMode;
      assertStructureExportMode(mode);
      if (info.objectKind === 'table') {
        const modes = mode.toUpperCase().split(',');
        const document = parseTableColumnDefinition(info.ddl, { dialect: task.managed.status.dialect, mode: { noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: modes.includes('ANSI_QUOTES') } });
        assertTableStructureExportable(document, mode);
        if (document.table !== input.table || (document.database !== undefined && document.database !== input.database)) throw new Error('结构定义与导出目标不一致，未写入目标文件');
      } else if (info.objectKind !== 'view') throw new Error('无法确认服务器对象为基本表或视图，未导出结构；可以单独导出数据');
    }
    this.checkCancelled(task);
    const dataColumns = projection ? this.csvExportFields.project(projection, info, task.managed) : info.columns.filter(column => input.format !== 'sql' || !column.generated);
    const temporaryPath = `${input.filePath}.dbark-${randomUUID()}.partial`;
    const file = await open(temporaryPath, 'wx');
    let count = 0, completed = false;
    /** 按目标编码完整写出文本，在短写和循环间隙处理剩余字节与取消请求。 */
    const write = async (text: string) => {
      this.checkCancelled(task);
      const buffer = iconv.encode(text, encoding); let offset = 0;
      // FileHandle.write 允许短写，必须消费 bytesWritten 后继续，不能丢失文件尾部数据。
      while (offset < buffer.length) {
        this.checkCancelled(task);
        const result = await file.write(buffer, offset, buffer.length - offset);
        if (result.bytesWritten === 0) throw new Error('目标文件无法继续写入');
        offset += result.bytesWritten;
      }
    };
    try {
      if (encoding === 'utf16le') await write('\uFEFF');
      if (input.format === 'sql') {
        await write('-- DBArk SQL 导出；请在目标数据库执行\nSET NAMES utf8mb4;\n');
        if (input.includeStructure) await write(info.ddl + ';\n\n');
      }
      if (input.includeData) {
        if (input.format === 'csv') await write(dataColumns.map(column => csvHeader(column.name, delimiter)).join(delimiter) + '\r\n');
        if (input.format === 'json') await write('[\n');
        if (!projection) { await this.statement(task, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); await this.statement(task, 'START TRANSACTION WITH CONSISTENT SNAPSHOT'); }
        // 表头写入和事务准备都可能等待；真正标记在途并发送SELECT前重核，已接受取消不能启动新流。
        this.checkCancelled(task);
        task.inFlight = true; task.generation++;
        const options = { sql: `SELECT ${dataColumns.map(column => identifier(column.name)).join(', ')} FROM ${qualified(input.database, input.table)}`, rowsAsArray: true };
        // 与表页一样保留浮点二进制位，避免相邻唯一键导出后变成同一个短小数。
        const query = dataColumns.some(column => /^(?:FLOAT|DOUBLE|REAL)\b/i.test(column.type)) ? task.managed.connection.execute(options) : task.managed.connection.query(options);
        const stream = query.stream({ highWaterMark: 32 });
        try {
          for await (const raw of stream) {
            this.checkCancelled(task);
            if (projection && (!Array.isArray(raw) || raw.length !== dataColumns.length)) throw Error('CSV实际行字段与已核目录不一致，未替换目标文件');
            const row = Object.fromEntries(dataColumns.map((column, index) => [column.name, serializeCell((raw as unknown[])[index])]));
            if (input.format === 'csv') await write(dataColumns.map(column => csvCell(row[column.name], delimiter)).join(delimiter) + '\r\n');
            else if (input.format === 'json') await write((count ? ',\n' : '') + JSON.stringify(row));
            else await write(`INSERT INTO ${identifier(input.table)} (${dataColumns.map(column => identifier(column.name)).join(', ')}) VALUES (${dataColumns.map(column => exportLiteral(row[column.name])).join(', ')});\n`);
            count++;
            if (count % 500 === 0) this.emit({ taskId: task.id, status: 'running', progress: 0, rows: count, message: `已导出 ${count} 行` });
          }
        } finally {
          stream.destroy(); task.inFlight = false; await task.cancelPending;
        }
        if (input.format === 'json') await write('\n]\n');
        await this.statement(task, 'ROLLBACK'); selectedTransaction = false;
      }
      this.checkCancelled(task);
      await file.sync();
      // 三种表文件格式共用提交协议；同步和关闭等待后均重核，不能接受取消后再覆盖原件。
      this.checkCancelled(task);
      await file.close();
      this.checkCancelled(task);
      // 与现有任务取消协议共用屏障；检查和标记间不让出执行权，rename 仅发送一次。
      // 进入替换窗口后等待真实结果：成功报告完成，失败报告失败，不能伪称已取消或自动重试。
      task.fileCommitStarted = true;
      await rename(temporaryPath, input.filePath); completed = true;
      return { rows: count };
    } finally {
      await file.close().catch(() => undefined);
      if (!completed) await rm(temporaryPath, { force: true });
    }
    } finally {
      // 目录重核、文件打开或取消失败也释放读取事务；连接关闭仍沿原独立任务finally完成。
      if (selectedTransaction) await this.statement(task, 'ROLLBACK').catch(() => undefined);
    }
  }
}
