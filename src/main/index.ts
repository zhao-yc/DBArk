import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage } from 'electron';
import { join, basename } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { TableApplyReceipts } from './tableApplyReceipts';
import { EngineBroker } from './broker';
import { LocalStore } from './storage';
import { ConnectionConfigManager } from './connectionConfig';
import { ConnectionTransfer } from './connectionTransfer';
import { assertConnectionReady } from '../shared/connectionTransfer';
import { confirmConnectionFiles, resolveFileToken, revokeConnectionFiles } from './fileTokens';
import { connectionReplacementText } from '../shared/connectionTransferMessages';
import { ExportReservations } from './exportReservations';
import { persistedQueryError, persistedTaskMessage } from './taskPrivacy';
import { readQueryFile, writeQueryFile } from './queryFiles';
import { validateCommand } from '../shared/validation';
import type { Command, ConnectionProfile, HistoryEntry, QueryFileEncoding, TaskEvent, TaskRecord } from '../shared/contracts';
import { taskCancelSnapshot } from './taskCancelState';
import type { QueryExportProgress } from '../shared/queryStreamExport';
import type { TableColumnApplyProgress } from '../shared/tableColumnPatches';
import {queryDatabasePatch} from '../shared/queryContext';
import{SavedQuerySearches,SavedQuerySearchCancelled}from'./savedQuerySearch';
import{SavedQueryPages}from'./savedQueryPages';
import{HistoryPages}from'./historyPages';
import { resolveWorkbenchTarget } from './workbench';
import { objectUri } from '../shared/workbench';

if (process.env.DBARK_USER_DATA) { mkdirSync(process.env.DBARK_USER_DATA, { recursive: true }); app.setPath('userData', process.env.DBARK_USER_DATA); }
app.setName('DBArk');
let window: BrowserWindow | undefined;
let store: LocalStore;
let broker: EngineBroker;
let tableApplyReceipts: TableApplyReceipts;
let connectionConfig: ConnectionConfigManager;
let connectionTransfer: ConnectionTransfer;
let savedQuerySearches:SavedQuerySearches;
let savedQueryPages:SavedQueryPages;
let historyPages:HistoryPages;
const localSearchOperations=new Set<Promise<unknown>>();
let shuttingDown = false;
let shutdownComplete = false;
let stateFlushed: { resolve(): void; reject(error: Error): void } | undefined;
let hasPendingEdits = false;
let rendererHasSettings = false;
// 标签清单写入失败后不能把旧布局当作当前空闲事实；必须先成功保存当前布局才能替换。
let rendererSettingsCurrent = true;
let lastStorageWarning = 0;
const sessions = new Map<string, { connectionId: string }>();
// 历史上下文由引擎在会话互斥内报告，不能由渲染进程提供或从较早的标签状态推测。
const pendingQueryHistory = new Map<string, { entry: HistoryEntry; currentStatement: boolean; executionSqlReceived: boolean }>();
const files = new Map<string, { path: string; purpose: string; format?: string }>();
const queryFileOperations = new Set<Promise<unknown>>();
const exportReservations = new ExportReservations();
const preparingTasks = new Map<string, { cancelled: boolean; failure?: string; connectionIds?: string[] }>();
const exportProgress = new Map<string, QueryExportProgress>();
const structureProgress = new Map<string, TableColumnApplyProgress>();
const structureTokens = new Map<string, { purpose: 'columns' | 'indexes' | 'foreignKeys' | 'tableComment' | 'tableDrop' | 'tableTruncate' | 'tableDefaultEncoding' | 'databaseCreate' | 'tableCopyStructure' | 'tableRename' | 'tableAutoIncrement'; connectionId: string; expires: number; kind: 'snapshot' | 'preview'; snapshotId?: string }>();
const tasks = new Map<string, TaskRecord>();
// 补全是高频短读，只在内存保留活动编号；不挤占用户任务历史或逐次触发SQLite写盘。
const completionTasks = new Set<string>();
const lastPersist = new Map<string, number>();
const rendererURL = process.env.DBARK_DEV_URL ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href;

/** 辅助记录失败不能改变已经完成的数据库操作结果，避免用户误以为 SQL 未执行。 */
function persistAuxiliary(action: () => void): void {
  try { action(); }
  catch {
    if (Date.now() - lastStorageWarning > 10000) {
      lastStorageWarning = Date.now();
      window?.webContents.send('dbark:menu', 'warning:数据库操作状态以结果为准，但本地历史或任务记录保存失败，请检查磁盘空间和权限。不要据此重复执行写操作。');
    }
  }
}

/** 任务进度只保留概要；分批结果直接传输，不把整批数据写入配置库。 */
function taskEvent(event: TaskEvent): void {
  if(completionTasks.has(event.taskId))return;
  if (event.tableApply) tableApplyReceipts?.receive(event.taskId, event.tableApply);
  if (event.status !== 'running' && tableApplyReceipts?.confirmed(event.taskId)) event = { ...event, status: 'completed', progress: 100, message: '服务器已确认目标事务提交；附加错误请查看提交记录' };
  const pendingHistory=pendingQueryHistory.get(event.taskId), history=pendingHistory?.entry;
  if(history&&event.executionDatabase)Object.assign(history,queryDatabasePatch(event.executionDatabase));
  // 接收一次实际发送片段；独立布尔状态保证定位失败/发送前取消不能落全文或空SQL。
  if (pendingHistory?.currentStatement && !pendingHistory.executionSqlReceived && typeof event.executionSql === 'string' && event.executionSql.trim()) { pendingHistory.entry.sql = event.executionSql; pendingHistory.executionSqlReceived = true; }
  if (event.queryExport) exportProgress.set(event.taskId, { ...event.queryExport });
  const structure = event.tableCopyStructure ?? event.databaseCreate ?? event.tableDrop ?? event.tableTruncate ?? event.tableAutoIncrement ?? event.tableRename ?? event.tableDefaultEncoding ?? event.tableComment ?? event.foreignKeyPatch ?? event.indexPatch ?? event.columnPatch;
  if (structure) structureProgress.set(event.taskId, { ...structure });
  const current = tasks.get(event.taskId);
  if (current) {
    // 服务器错误可能回显已绑定值；参数查询的失败细节仅送给当前界面，不写入磁盘任务记录。
    const message = persistedTaskMessage(current.kind, event);
    const record = { ...current, status: event.status, progress: event.progress, message, finishedAt: event.status === 'running' ? undefined : new Date().toISOString() };
    tasks.set(event.taskId, record);
    if (event.status !== 'running' || Date.now() - (lastPersist.get(event.taskId) ?? 0) > 1000) {
      persistAuxiliary(() => store.saveTask(record)); lastPersist.set(event.taskId, Date.now());
    }
  }
  if (window && !window.isDestroyed()) window.webContents.send('dbark:task', event);
}

/** 文件只能来自用户打开/保存对话框；数据库进程收到的是主进程解析后的实际路径。 */
async function chooseFile(input: any): Promise<{ token: string; name: string } | null> {
  const filters = input.format ? [{ name: `${String(input.format).toUpperCase()} 文件`, extensions: [input.format] }, { name: '所有文件', extensions: ['*'] }] : [{ name: '所有文件', extensions: ['*'] }];
  let filePath: string | undefined;
  if (input.purpose === 'export' || input.purpose === 'connection-export') {
    const result = await dialog.showSaveDialog(window!, { title: '导出文件', defaultPath: input.suggestedName, filters });
    filePath = result.canceled ? undefined : result.filePath;
  } else {
    const result = await dialog.showOpenDialog(window!, { title: '选择文件', properties: ['openFile'], filters });
    filePath = result.canceled ? undefined : result.filePaths[0];
  }
  if (!filePath) return null;
  const token = randomUUID(); files.set(token, { path: filePath, purpose: input.purpose, format: input.format });
  return { token, name: basename(filePath) };
}

/** 布局请求到达即先撤销空闲依据；包括校验失败，只有完整保存成功才恢复可信标签事实。 */
function validateMainCommand(command: string, input: unknown) {
  if (command === 'settings.save') rendererSettingsCurrent = false;
  return validateCommand(command, input);
}

/** 正常退出等待已授权的小型文件操作，防止中途退出留下未关闭的临时文件。 */
async function queryFileOperation<T>(action: () => Promise<T>): Promise<T> {
  if (shuttingDown) throw new Error('客户端正在退出，不能开始文件操作');
  const operation = action(); queryFileOperations.add(operation);
  try { return await operation; } finally { queryFileOperations.delete(operation); }
}

/** 小型 SQL 保存也占用目标直到原子操作清理完毕，避免与长任务并发覆盖。 */
async function writeSelectedQuery(input: { fileToken: string; sql: string; encoding: QueryFileEncoding }): Promise<void> {
  const path = resolveFileToken(files, input.fileToken, 'export', 'sql');
  const release = await exportReservations.acquire(path);
  try { await writeQueryFile(path, input.sql, input.encoding); } finally { release(); }
}

/** 分派前检查配置保存锁，防止检查通过后另一个请求用旧凭据抢先建连。 */
async function dispatch(command: Command, input: any): Promise<unknown> {
  // 来源释放只撤销内存能力，配置保存和退出收尾时也必须可用，不建立任务或历史。
  if (command === 'table.copySourceRelease' || command === 'files.releaseExportColumns') return broker.request(command, input);
  // 确认与释放不新建连接或任务，不受配置保存锁阻塞；归属由引擎在取消前校验。
  if(command==='search.dataNext'||command==='search.dataRelease'||command==='search.recordsRelease')return broker.request(command,input);
  const structurePurpose = command.startsWith('schema.tableCopyStructure.') ? 'tableCopyStructure' as const : command.startsWith('schema.databaseCreate.') ? 'databaseCreate' as const : command.startsWith('schema.tableRename.') ? 'tableRename' as const : command.startsWith('schema.tableAutoIncrement.') ? 'tableAutoIncrement' as const : command.startsWith('schema.tableDefaultEncoding.') ? 'tableDefaultEncoding' as const : command.startsWith('schema.tableDrop.') ? 'tableDrop' as const : command.startsWith('schema.tableTruncate.') ? 'tableTruncate' as const : command.startsWith('schema.tableComment.') ? 'tableComment' as const : command.startsWith('schema.columns.') ? 'columns' as const : command.startsWith('schema.indexes.') ? 'indexes' as const : command.startsWith('schema.foreignKeys.') ? 'foreignKeys' as const : undefined;
  const structureCommand = structurePurpose !== undefined, structurePrefix = structurePurpose ? `schema.${structurePurpose}.` : '';
  for (const [token, value] of structureTokens) if (value.expires <= Date.now()) structureTokens.delete(token);
  const structureToken = command === structurePrefix + 'preview' ? structureTokens.get(input.snapshotId) : command === structurePrefix + 'apply' ? structureTokens.get(input.previewToken) : undefined;
  if ((command === structurePrefix + 'preview' && (structureToken?.kind !== 'snapshot' || structureToken.purpose !== structurePurpose)) || (command === structurePrefix + 'apply' && (structureToken?.kind !== 'preview' || structureToken.purpose !== structurePurpose))) throw new Error('结构快照或预览已失效或用途不符，请重新读取；未发送 DDL');
  if (command === structurePrefix + 'release') for (const id of [input.snapshotId, input.previewToken]) {
    const value = id ? structureTokens.get(id) : undefined;
    if (value && value.purpose !== structurePurpose) throw new Error('结构令牌用途不符，未释放其他编辑器的预览');
  }
  const requestConnectionId = structureToken?.connectionId ?? input.connectionId ?? sessions.get(input.sessionId)?.connectionId ?? (command.startsWith('connections.') ? input.id : undefined);
  if (structureCommand && shuttingDown) throw new Error('客户端正在退出，不能开始结构操作');
  connectionConfig.assertAvailable(requestConnectionId);
  if (command.startsWith('schema.compare') && shuttingDown) throw new Error('客户端正在退出，不能开始结构比较');
  if (command === 'schema.compare') { connectionConfig.assertAvailable(input.source.connectionId); connectionConfig.assertAvailable(input.target.connectionId); }
  switch (command) {
    case 'workbench.get': return store.workbench();
    // 主进程只写入由严格对象身份生成的链接，不开放任意剪贴板读写权限。
    case 'workbench.copyUri': return clipboard.writeText(objectUri(input));
    case 'workbench.save':
      if (shuttingDown) throw new Error('客户端正在退出，不能修改收藏配置');
      return store.saveWorkbench(input);
    case 'workbench.resolve': {
      if (shuttingDown) throw new Error('客户端正在退出，不能打开收藏');
      const revision = store.connectionRevision();
      return resolveWorkbenchTarget(input, {
        connectionExists: id => store.queryConnectionExists(id),
        connect: async id => { await broker.request('connections.open', { id, profile: store.resolveConnection(id) }); },
        databases: id => broker.request('metadata.databases', { connectionId: id }),
        objects: (id, database) => broker.request('metadata.objects', { connectionId: id, database }),
        assertCurrent: () => {
          connectionConfig.assertAvailable(input.connectionId);
          if (shuttingDown || store.connectionRevision() !== revision) throw new Error('连接配置已变化，请重新打开对象');
        }
      });
    }
    case 'schema.compare': input = { ...input, sourceProfile: store.resolveConnection(input.source.connectionId), targetProfile: store.resolveConnection(input.target.connectionId) }; break;
    case 'search.structure':case 'search.structureContinue':case 'search.dataStart':case 'search.recordRead':
      if(shuttingDown)throw Error('客户端正在退出，不能开始搜索');
      input={...input,profile:store.resolveConnection(input.connectionId)};break;
    case 'table.page':case 'table.copySourceRead': {
      if (command === 'table.page' && !input.copySource) break;
      // 表来源短读仅占用内存任务编号，沿原取消通道；不写执行历史或持久化行值。
      if (shuttingDown) throw new Error('客户端正在退出，不能读取完整复制源');
      if (tasks.has(input.taskId) || completionTasks.has(input.taskId) || savedQueryPages?.owns(input.taskId) || historyPages?.owns(input.taskId)) throw new Error('任务编号已使用');
      if (completionTasks.size >= 8) throw new Error('只读请求繁忙，请稍后再读取');
      connectionConfig.assertAvailable(input.connectionId); completionTasks.add(input.taskId);
      try { return await broker.request(command, { ...input, profile: store.resolveConnection(input.connectionId) }); }
      finally { completionTasks.delete(input.taskId); }
    }
    case 'metadata.completion':case 'search.catalogue': {
      if(shuttingDown)throw new Error('客户端正在退出，不能读取补全目录');
      if(tasks.has(input.taskId)||completionTasks.has(input.taskId)||savedQueryPages?.owns(input.taskId)||historyPages?.owns(input.taskId))throw new Error('任务编号已使用，请重新发起操作');
      if(completionTasks.size>=8)throw new Error('补全目录读取繁忙，请稍后触发');
      completionTasks.add(input.taskId);
      try{return await broker.request(command,{...input,profile:store.resolveConnection(input.connectionId)});}
      finally{completionTasks.delete(input.taskId);}
    }
    case 'query.cancel': {
      if(historyPages?.owns(input.taskId))return historyPages.cancel(input.taskId);
      if(savedQueryPages?.owns(input.taskId))return savedQueryPages.cancel(input.taskId);
      if(savedQuerySearches.has(input.taskId))return savedQuerySearches.cancel(input.taskId);
      if(tasks.get(input.taskId)?.kind.startsWith('search.savedQueries'))return;
      const preparing = preparingTasks.get(input.taskId);
      if (preparing) { preparing.cancelled = true; return; }
      break;
    }
    case 'app.info': return { version: app.getVersion(), platform: process.platform, encryptionAvailable: safeStorage.isEncryptionAvailable(), dataPath: app.getPath('userData') };
    case 'app.setDirty': hasPendingEdits = input.dirty; return;
    case 'connections.list': return store.connections();
    case 'connections.export': return queryFileOperation(async () => {
      const path = resolveFileToken(files, input.fileToken, 'connection-export', 'json');
      const release = await exportReservations.acquire(path);
      try { return await connectionTransfer.exportFile(path, input.connectionIds); } finally { release(); }
    });
    case 'connections.importPreview': return queryFileOperation(() => connectionTransfer.preview(resolveFileToken(files, input.fileToken, 'connection-import', 'json')));
    case 'connections.importReview': if (shuttingDown) throw new Error('客户端正在退出，不能导入连接'); return connectionTransfer.review(input);
    case 'connections.importReviewRelease': return connectionTransfer.releaseReview(input);
    case 'connections.importApply': return queryFileOperation(() => connectionTransfer.applyBatch(input));
    case 'connections.save': return connectionConfig.save(confirmConnectionFiles(input, store.connections().find(profile => profile.id === input.id), files));
    case 'connections.delete': await broker.request('connections.close', input); store.deleteConnection(input.id); return;
    case 'connections.open': input = { ...input, profile: store.resolveConnection(input.id) }; break;
    case 'connections.test': {
      const previous = store.connections().find(profile => profile.id === input.id);
      input = { ...input, pendingFiles: [...new Set([...previous?.pendingFiles ?? [], ...input.pendingFiles ?? []])] };
      assertConnectionReady(input); input = store.resolveConnection(input.id, input as ConnectionProfile); break;
    }
    case 'connections.close':
      for (const [id, session] of sessions) if (session.connectionId === input.id) sessions.delete(id);
      for (const [token, value] of structureTokens) if (value.connectionId === input.id) structureTokens.delete(token);
      break;
    case 'table.preferences.get': return store.tablePreferences(input);
    case 'table.preferences.save': return store.saveTablePreferences(input);
    case 'table.preferences.reset': return store.resetTablePreferences(input);
    case 'queries.list': return store.queries();
    case 'queries.read': { const result = savedQuerySearches.read(input); return { ...result, sourceBinding: store.bindQuerySource(input.id, input.digest) }; }
    case 'queries.pageRelease':return savedQueryPages.release(input);
    case 'queries.deleteChecked':if(shuttingDown)throw Error('客户端正在退出，不能删除保存查询');return savedQueryPages.deleteChecked(input);
    case 'queries.page':case 'queries.pageContinue':case 'history.page':case 'history.pageContinue':{
      if(shuttingDown)throw Error('客户端正在退出，不能读取查询列表');
      if(tasks.has(input.taskId)||completionTasks.has(input.taskId)||savedQueryPages?.owns(input.taskId)||historyPages?.owns(input.taskId))throw Error('请求编号已使用');
      // 列表和补全同属高频短读，活动编号只放内存，不逐次写任务或执行历史。
      completionTasks.add(input.taskId);try{return command==='queries.page'?await savedQueryPages.start(input):command==='queries.pageContinue'?await savedQueryPages.next(input):command==='history.page'?await historyPages.start(input):await historyPages.next(input);}finally{completionTasks.delete(input.taskId);}
    }
    case 'search.savedQueriesRelease':return savedQuerySearches.release(input);
    case 'search.savedQueries':case 'search.savedQueriesContinue':if(shuttingDown)throw Error('客户端正在退出，不能搜索本地查询');break;
    case 'snippets.list': return store.snippets();
    case 'snippets.save': return store.saveSnippet(input);
    case 'snippets.delete': return store.deleteSnippet(input.id);
    case 'queries.create': if(shuttingDown)throw Error('客户端正在退出，不能保存查询'); return store.createBoundQuery(input);
    case 'queries.updateSource': if(shuttingDown)throw Error('客户端正在退出，不能更新原查询'); connectionConfig.assertAvailable(input.content.connectionId); return store.updateBoundQuery(input);
    case 'queries.save': return store.createLegacyQuery({ ...input, updatedAt: new Date().toISOString() });
    case 'queries.delete': return store.deleteQuery(input.id);
    case 'history.list': return store.history(input.connectionId);
    case 'history.pageRelease':return historyPages.release(input);
    case 'history.read':return historyPages.read(input);
    case 'history.readError':return historyPages.readError(input);
    case 'table.applyReceipt.list': return store.tableApplyReceipts(input);
    case 'table.applyReceipt.detail': return store.tableApplyReceipt(input.operationId);
    case 'tasks.list': return store.tasks();
    case 'tasks.cancelState': return taskCancelSnapshot(input.taskIds, tasks, (id, operationId) => tableApplyReceipts.cancelState(id, operationId));
    case 'settings.get': rendererHasSettings = true; return store.settings();
    case 'settings.save': {
      try { store.saveSettings(input); rendererSettingsCurrent = true; stateFlushed?.resolve(); }
      catch (error) { rendererSettingsCurrent = false; stateFlushed?.reject(error instanceof Error ? error : new Error(String(error))); throw error; }
      finally { stateFlushed = undefined; }
      return;
    }
    case 'files.choose': return chooseFile(input);
    case 'files.path': { const file = files.get(input.token); if (!file) throw new Error('文件选择已失效，请重新选择'); return file.path; }
    case 'files.readQuery': return queryFileOperation(() => readQueryFile(resolveFileToken(files, input.fileToken, 'query', 'sql'), input.encoding));
    case 'files.writeQuery': return queryFileOperation(() => writeSelectedQuery(input));
    case 'query.exportStream': input = { ...input, filePath: resolveFileToken(files, input.fileToken, 'export', input.format === 'csv-zip' ? 'zip' : input.format) }; break;
    case 'excel.sheets':
    case 'excel.preview':
    case 'excel.import':
    case 'excel.export': input = { ...input, filePath: resolveFileToken(files, input.fileToken, command === 'excel.export' ? 'export' : 'import', 'xlsx') }; break;
    case 'files.preview':
    case 'files.import':
    case 'files.export':
    case 'files.exportResult': {
      const expected = command === 'files.export' || command === 'files.exportResult' ? 'export' : 'import';
      input = { ...input, filePath: resolveFileToken(files, input.fileToken, expected) }; break;
    }
  }
  const taskId: string | undefined = command !== 'query.cancel' ? input.taskId : undefined;
  const startedAt = new Date().toISOString(); const start = Date.now();
  if (taskId) {
    if (tasks.has(taskId)||completionTasks.has(taskId)||savedQueryPages?.owns(taskId)||historyPages?.owns(taskId)) throw new Error('任务编号已使用，请重新发起操作');
    const task: TaskRecord = { id: taskId, kind: command, status: 'running', progress: 0, message: '正在执行', startedAt };
    tasks.set(taskId, task); store.saveTask(task);
  }
  const session = sessions.get(input.sessionId);
  const currentStatement = command === 'query.execute' && input.currentStatement !== undefined;
  const history: HistoryEntry | undefined = (command === 'query.execute' || command === 'query.executeParameterized' || command === 'query.exportStream') && session ? { id: randomUUID(), connectionId: session.connectionId, databaseContext:{state:'unknown'}, sql: currentStatement ? '' : input.sql, startedAt, elapsedMs: 0, success: false } : undefined;
  const pendingHistory = history ? { entry: history, currentStatement, executionSqlReceived: !currentStatement } : undefined;
  if(pendingHistory&&taskId)pendingQueryHistory.set(taskId,pendingHistory);
  const preparing: { cancelled: boolean; failure?: string; connectionIds?: string[] } = { cancelled: false, connectionIds: command === 'schema.compare' ? [input.source.connectionId, input.target.connectionId] : requestConnectionId ? [requestConnectionId] : [] }; if (taskId) preparingTasks.set(taskId, preparing);
  let releaseTarget: (() => void) | undefined;
  let sentToEngine = false;
  const previewConnectionRevision = command === 'table.preview' ? store.connectionRevision() : 0;
  try {
    if (command === 'query.exportStream' || command === 'files.export' || command === 'files.exportResult' || command === 'excel.export') releaseTarget = await exportReservations.acquire(input.filePath);
    if (preparing.failure) throw new Error(preparing.failure);
    // 文件路径归一化期间的取消在主进程捕获，不能丢失后继续发送用户 SQL。
    if (preparing.cancelled) throw new Error('任务在准备阶段已取消，尚未发送用户 SQL；原目标文件保持不变');
    connectionConfig.assertAvailable(requestConnectionId);
    if (command === 'table.apply') {
      const binding = tableApplyReceipts.prepare(input.taskId, input.previewId, { connectionId: input.connectionId, connectionRevision: store.connectionRevision(), database: input.database, table: input.table }, input.changes);
      const linked = { ...tasks.get(input.taskId)!, tableApplyReceiptId: binding.operationId };
      store.saveTask(linked); tasks.set(input.taskId, linked);
      input = { ...input, tableApplyBinding: binding };
    }
    // 令牌目标只来自可信引擎输出；修订在投递前同步读取，客户端不能注入或覆盖。
    if (structureCommand && command !== structurePrefix + 'release') input = { ...input, connectionRevision: store.connectionRevision() };
    if (command === 'files.exportColumns' || command === 'files.export' && input.csvSelection) input = { ...input, connectionRevision: store.connectionRevision() };
    if (command.startsWith('schema.compare')) {
      input = { ...input, connectionRevision: store.connectionRevision() };
      if (command === 'schema.compare') { connectionConfig.assertAvailable(input.source.connectionId); connectionConfig.assertAvailable(input.target.connectionId); }
    }
    if (taskId) preparingTasks.delete(taskId);
    sentToEngine = true;
    const result = command==='search.savedQueries'?await savedQuerySearches.start(input):command==='search.savedQueriesContinue'?await savedQuerySearches.next(input):await broker.request(command, input);
    if (command === 'table.preview' && previewConnectionRevision !== store.connectionRevision()) throw Error('连接配置自预览开始后已变化，请重新预览');
    if (command === 'table.preview') return { ...result, ...tableApplyReceipts.preview({ connectionId: input.connectionId, connectionRevision: store.connectionRevision(), database: input.database, table: input.table }, input.changes, result) };
    if (command === structurePrefix + 'get' || command === structurePrefix + 'preview') {
      if (structureTokens.size >= 128) throw new Error('结构令牌缓存已达上限，请关闭旧预览后重试');
      const token = command === structurePrefix + 'get' ? result.snapshotId : result.previewToken;
      structureTokens.set(token, { purpose: structurePurpose!, connectionId: result.target.connectionId, expires: Date.parse(result.expiresAt), kind: command === structurePrefix + 'get' ? 'snapshot' : 'preview', ...(command === structurePrefix + 'preview' ? { snapshotId: input.snapshotId } : {}) });
    }
    if (command === structurePrefix + 'release') {
      if (input.snapshotId) for (const [token, value] of structureTokens) if (value.purpose === structurePurpose && (token === input.snapshotId || value.snapshotId === input.snapshotId)) structureTokens.delete(token);
      if (input.previewToken) structureTokens.delete(input.previewToken);
    }
    if (command === 'sessions.open') sessions.set(result.sessionId, { connectionId: input.connectionId });
    if (command === 'sessions.close') sessions.delete(input.sessionId);
    if (command === 'table.apply' && !tableApplyReceipts.confirmed(taskId!)) throw Error('未收到可信提交确认，结果未知；请查看提交记录，不要重复执行原批次');
    if (taskId && command!=='search.dataStart' && tasks.get(taskId)?.status === 'running') taskEvent({ taskId, status: 'completed', progress: 100, message: '执行完成' });
    if (history && pendingHistory?.executionSqlReceived) persistAuxiliary(() => store.addHistory({ ...history, elapsedMs: Date.now() - start, success: true }));
    return command === 'table.apply' ? { ...result, ...tableApplyReceipts.finish(taskId!) } : result;
  } catch (error) {
    if (command === 'table.apply' && taskId && !sentToEngine) tableApplyReceipts.notDispatched(taskId);
    if (command === 'table.apply' && taskId && tableApplyReceipts.confirmed(taskId)) {
      const confirmed = tableApplyReceipts.confirmed(taskId)!; tableApplyReceipts.cleanupFailed(taskId);
      taskEvent({ taskId, status: 'completed', progress: 100, message: '服务器已确认目标事务提交，后续收尾异常；请查看提交记录' });
      return { affectedRows: confirmed.evidence.serverReportedRows, cleanupWarning: true, ...tableApplyReceipts.finish(taskId) };
    }
    const message = error instanceof Error ? error.message : '操作失败';
    if (taskId && tasks.get(taskId)?.status === 'running') taskEvent({ taskId, status: preparing.cancelled || error instanceof SavedQuerySearchCancelled ? 'cancelled' : 'failed', progress: 0, message, ...(structureCommand ? { [structurePurpose === 'tableCopyStructure' ? 'tableCopyStructure' : structurePurpose === 'databaseCreate' ? 'databaseCreate' : structurePurpose === 'tableRename' ? 'tableRename' : structurePurpose === 'tableAutoIncrement' ? 'tableAutoIncrement' : structurePurpose === 'tableDefaultEncoding' ? 'tableDefaultEncoding' : structurePurpose === 'tableDrop' ? 'tableDrop' : structurePurpose === 'tableTruncate' ? 'tableTruncate' : structurePurpose === 'tableComment' ? 'tableComment' : structurePurpose === 'indexes' ? 'indexPatch' : structurePurpose === 'foreignKeys' ? 'foreignKeyPatch' : 'columnPatch']: { phase: 'connecting' as const, ddlSubmitted: sentToEngine && command === structurePrefix + 'apply', ddlCompleted: false, definitionVerified: false, outcome: sentToEngine && command === structurePrefix + 'apply' ? 'unknown' as const : 'not-sent' as const, ...structureProgress.get(taskId) } } : {}), ...(command === 'query.exportStream' ? { queryExport: { phase: 'preparing' as const, statementsCompleted: 0, rowsWritten: 0, bytesWritten: 0, fileCommitted: false, ...exportProgress.get(taskId), sqlMayHaveExecuted: sentToEngine, transactionKnown: false } } : {}) });
    if (history && pendingHistory?.executionSqlReceived) persistAuxiliary(() => store.addHistory({ ...history, elapsedMs: Date.now() - start, error: persistedQueryError(command, message) }));
    throw error;
  } finally { if (command === 'table.apply' && taskId) tableApplyReceipts.finish(taskId); if (command === structurePrefix + 'apply') structureTokens.delete(input.previewToken); if (taskId) { pendingQueryHistory.delete(taskId); preparingTasks.delete(taskId); exportProgress.delete(taskId); structureProgress.delete(taskId); } releaseTarget?.(); }
}

/** 按平台生成中文原生菜单，查询快捷键统一发送给当前工作区。 */
function createMenu(): void {
  const action = (name: string) => () => window?.webContents.send('dbark:menu', name);
  const mac = process.platform === 'darwin';
  const menu: Electron.MenuItemConstructorOptions[] = [
    ...(mac ? [{ label: 'DBArk', submenu: [{ label: '关于 DBArk', role: 'about' }, { type: 'separator' }, { label: '隐藏 DBArk', role: 'hide' }, { label: '退出 DBArk', role: 'quit' }] } as Electron.MenuItemConstructorOptions] : []),
    { label: '文件', submenu: [{ label: '新建连接', accelerator: 'CmdOrCtrl+Shift+N', click: action('new-connection') }, { label: '新建查询', accelerator: 'CmdOrCtrl+N', click: action('new-query') }, { label: '打开 SQL 文件', accelerator: 'CmdOrCtrl+O', click: action('open-sql-file') }, { label: '另存 SQL 文件', accelerator: 'CmdOrCtrl+Shift+S', click: action('save-sql-file') }, { label: '保存查询', accelerator: 'CmdOrCtrl+S', click: action('save-query') }, { type: 'separator' }, { label: '退出', role: 'quit' }] },
    { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
    { label: '查询', submenu: [{ label: '执行查询', accelerator: 'CmdOrCtrl+Enter', click: action('execute') },{label:'全库搜索',accelerator:'CmdOrCtrl+Shift+F',click:action('structure-search')}] },
    { label: '视图', submenu: [{ label: '切换明暗主题', click: action('toggle-theme') }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { label: '重置缩放', role: 'resetZoom' }, { label: '全屏', role: 'togglefullscreen' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
}

/** 创建启用沙箱与上下文隔离的窗口，限制导航并等待页面就绪后显示。 */
async function createWindow(): Promise<void> {
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 1024, minHeight: 680, show: false, backgroundColor: '#101319', title: 'DBArk', icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png'), webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== rendererURL) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window?.show());
  window.on('close', event => { if (!shutdownComplete) { event.preventDefault(); app.quit(); } });
  window.on('closed', () => { window = undefined; files.clear(); });
  await window.loadURL(rendererURL);
}

/** 关闭前提示仍在执行的任务，退出后不得留下数据库执行进程。 */
app.on('before-quit', event => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    if ((hasPendingEdits || [...tasks.values()].some(t => t.status === 'running')) && window) {
      const answer = await dialog.showMessageBox(window, { type: 'warning', title: '仍有待完成的工作', message: '退出会放弃尚未提交的表格修改、断开数据库连接并回滚未提交事务。已提交的操作不会撤销。', buttons: ['继续工作','退出客户端'], defaultId: 0, cancelId: 0 });
      if (answer.response === 0) { shuttingDown = false; return; }
    }
    // 先让界面把防抖队列里的最新编辑落盘，再关闭配置库。
    if (rendererHasSettings && window && !window.isDestroyed()) {
      await Promise.race([new Promise<void>((resolve, reject) => { stateFlushed = { resolve, reject }; window!.webContents.send('dbark:menu', 'persist-state'); }), new Promise((_, reject) => setTimeout(() => reject(new Error('工作台未能及时保存状态')), 3000))]);
      stateFlushed = undefined;
    }
    await savedQuerySearches?.close();await savedQueryPages?.close();await historyPages?.close();await Promise.allSettled([...localSearchOperations]);
    await Promise.allSettled([...queryFileOperations]);
    await broker?.close();
    tableApplyReceipts?.interrupt();
    for (const task of tasks.values()) if (task.status === 'running') {
      const committed = task.kind === 'table.apply' && tableApplyReceipts?.confirmed(task.id);
      persistAuxiliary(() => store.saveTask({ ...task, status: committed ? 'completed' : 'cancelled', finishedAt: new Date().toISOString(), message: committed ? '服务器已确认目标事务提交；请查看提交记录' : '客户端已退出，请核对操作结果' }));
    }
    store?.close(); shutdownComplete = true; app.quit();
  })().catch(async error => {
    stateFlushed = undefined;
    const answer = await dialog.showMessageBox({ type: 'error', title: '退出前保存失败', message: error instanceof Error ? error.message : String(error), detail: '可以返回工作台排查后重试，或放弃未保存的配置并退出。', buttons: ['返回工作台','放弃未保存配置并退出'], defaultId: 0, cancelId: 0 });
    if (answer.response === 1) {
      await savedQuerySearches?.close();await savedQueryPages?.close();await historyPages?.close();await Promise.allSettled([...localSearchOperations]);
      await Promise.allSettled([...queryFileOperations]);
      await broker?.close().catch(() => undefined);
      try { store?.close(); } catch { /* 用户已明确选择退出，避免退出状态永久锁死。 */ }
      shutdownComplete = true; app.quit();
    } else shuttingDown = false;
  });
});
app.on('window-all-closed', () => app.quit());

/** 进程退出使所有尚未投递的准备请求失效，迟到的文件检查不能启动新进程继续写入。 */
function engineExited(): void {
  tableApplyReceipts?.interrupt();
  // 本地保存查询的匹配线程独立于数据库工具进程，不能被数据库进程退出误判为失败。
  for (const preparing of preparingTasks.values()) preparing.failure = '数据库进程已退出，准备任务已停止；尚未发送用户 SQL，原目标文件保持不变';
  sessions.clear();
  structureTokens.clear();
  for (const task of tasks.values()) if (task.status === 'running'&&!task.kind.startsWith('search.savedQueries')) {
    const preparing = preparingTasks.has(task.id);
    if (task.kind.startsWith('schema.tableCopyStructure.') || task.kind.startsWith('schema.databaseCreate.') || task.kind.startsWith('schema.tableRename.') || task.kind.startsWith('schema.tableAutoIncrement.') || task.kind.startsWith('schema.tableDefaultEncoding.') || task.kind.startsWith('schema.tableDrop.') || task.kind.startsWith('schema.tableTruncate.') || task.kind.startsWith('schema.tableComment.') || task.kind.startsWith('schema.columns.') || task.kind.startsWith('schema.indexes.') || task.kind.startsWith('schema.foreignKeys.')) {
      const last = structureProgress.get(task.id), possiblySent = !preparing && (task.kind === 'schema.tableCopyStructure.apply' || task.kind === 'schema.databaseCreate.apply' || task.kind === 'schema.tableRename.apply' || task.kind === 'schema.tableAutoIncrement.apply' || task.kind === 'schema.tableDefaultEncoding.apply' || task.kind === 'schema.tableDrop.apply' || task.kind === 'schema.tableTruncate.apply' || task.kind === 'schema.tableComment.apply' || task.kind === 'schema.columns.apply' || task.kind === 'schema.indexes.apply' || task.kind === 'schema.foreignKeys.apply');
      const progress: TableColumnApplyProgress = { phase: last?.phase ?? 'connecting', ddlSubmitted: Boolean(last?.ddlSubmitted || possiblySent), ddlCompleted: last?.ddlCompleted ?? false, definitionVerified: last?.definitionVerified ?? false, outcome: last?.ddlCompleted ? 'succeeded' : possiblySent ? 'unknown' : 'not-sent' };
      taskEvent({ taskId: task.id, status: 'failed', progress: task.progress, message: '数据库进程已退出，结构操作不会自动重放，请核对最新定义', ...(task.kind.startsWith('schema.tableCopyStructure.') ? { tableCopyStructure: progress } : task.kind.startsWith('schema.databaseCreate.') ? { databaseCreate: progress } : task.kind.startsWith('schema.tableRename.') ? { tableRename: progress } : task.kind.startsWith('schema.tableAutoIncrement.') ? { tableAutoIncrement: progress } : task.kind.startsWith('schema.tableDefaultEncoding.') ? { tableDefaultEncoding: progress } : task.kind.startsWith('schema.tableDrop.') ? { tableDrop: progress } : task.kind.startsWith('schema.tableTruncate.') ? { tableTruncate: progress } : task.kind.startsWith('schema.tableComment.') ? { tableComment: progress } : task.kind.startsWith('schema.indexes.') ? { indexPatch: progress } : task.kind.startsWith('schema.foreignKeys.') ? { foreignKeyPatch: progress } : { columnPatch: progress }) });
      continue;
    }
    taskEvent({ taskId: task.id, status: 'failed', progress: task.progress, message: '数据库进程已退出，请核对操作结果并重新连接', ...(task.kind === 'query.exportStream' ? { queryExport: { phase: 'executing' as const, statementsCompleted: 0, rowsWritten: 0, bytesWritten: 0, fileCommitted: false, ...exportProgress.get(task.id), ...(preparing ? { phase: 'preparing' as const } : {}), sqlMayHaveExecuted: !preparing, transactionKnown: false } } : {}) });
  }
}

if (!app.requestSingleInstanceLock()) { shutdownComplete = true; app.quit(); }
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  void app.whenReady().then(async () => {
    const wasm = app.isPackaged ? join(process.resourcesPath, 'sql-wasm.wasm') : require.resolve('sql.js/dist/sql-wasm.wasm');
    store = await LocalStore.open(join(app.getPath('userData'), 'dbark.sqlite'), wasm, { available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value).toString('base64'), decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64')) });
    tableApplyReceipts = new TableApplyReceipts(store, () => persistAuxiliary(() => { throw Error('提交记录保存失败'); }));
    broker = new EngineBroker(taskEvent, engineExited);
    connectionConfig = new ConnectionConfigManager(store, broker, {
      /** 主进程会话与尚未投递的长任务也必须为空；真实引擎继续检查建连、事务和独立任务。 */
      assertIdle: ids => {
        if (shuttingDown || !rendererSettingsCurrent || [...sessions.values()].some(session => ids.includes(session.connectionId)) || [...preparingTasks.values()].some(task => task.connectionIds?.some(id => ids.includes(id)))) throw new Error(connectionReplacementText.active);
      },
      revokeFiles: ids => {
        revokeConnectionFiles(ids, files);
        for (const [token, value] of structureTokens) if (ids.includes(value.connectionId)) structureTokens.delete(token);
      },
    });
    connectionTransfer = new ConnectionTransfer(store, Date.now, undefined, connectionConfig);
    savedQuerySearches=new SavedQuerySearches(store,join(__dirname,'savedQuerySearchWorker.cjs'),taskEvent);
    savedQueryPages=new SavedQueryPages(store,join(__dirname,'savedQuerySearchWorker.cjs'));
    historyPages=new HistoryPages(store,join(__dirname,'savedQuerySearchWorker.cjs'));
    ipcMain.handle('dbark:request', async (event, payload: unknown) => {
      try {
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== rendererURL) throw new Error('不允许的请求来源');
        if (!payload || typeof payload !== 'object' || !('command' in payload) || !('input' in payload) || typeof payload.command !== 'string') throw new Error('请求格式无效');
        const input = validateMainCommand(payload.command, payload.input);
        const operation=dispatch(payload.command as Command,input),local=payload.command==='search.savedQueries'||payload.command==='search.savedQueriesContinue'||payload.command==='queries.page'||payload.command==='queries.pageContinue'||payload.command==='history.page'||payload.command==='history.pageContinue';if(local)localSearchOperations.add(operation);
        try{return{ok:true,result:await operation};}finally{if(local)localSearchOperations.delete(operation);}
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '客户端操作失败' }; }
    });
    createMenu(); await createWindow();
  }).catch(error => { dialog.showErrorBox('DBArk 启动失败', error instanceof Error ? error.message : String(error)); shutdownComplete = true; app.quit(); });
}
