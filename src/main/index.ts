import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } from 'electron';
import { join, basename } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { EngineBroker } from './broker';
import { LocalStore } from './storage';
import { ConnectionConfigManager } from './connectionConfig';
import { ConnectionTransfer } from './connectionTransfer';
import { assertConnectionReady } from '../shared/connectionTransfer';
import { confirmConnectionFiles, resolveFileToken } from './fileTokens';
import { ExportReservations } from './exportReservations';
import { persistedQueryError, persistedTaskMessage } from './taskPrivacy';
import { readQueryFile, writeQueryFile } from './queryFiles';
import { validateCommand } from '../shared/validation';
import type { Command, ConnectionProfile, HistoryEntry, QueryFileEncoding, TaskEvent, TaskRecord } from '../shared/contracts';
import type { QueryExportProgress } from '../shared/queryStreamExport';
import type { TableColumnApplyProgress } from '../shared/tableColumnPatches';

if (process.env.DBARK_USER_DATA) { mkdirSync(process.env.DBARK_USER_DATA, { recursive: true }); app.setPath('userData', process.env.DBARK_USER_DATA); }
app.setName('DBArk');
let window: BrowserWindow | undefined;
let store: LocalStore;
let broker: EngineBroker;
let connectionConfig: ConnectionConfigManager;
let connectionTransfer: ConnectionTransfer;
let shuttingDown = false;
let shutdownComplete = false;
let stateFlushed: { resolve(): void; reject(error: Error): void } | undefined;
let hasPendingEdits = false;
let rendererHasSettings = false;
let lastStorageWarning = 0;
const sessions = new Map<string, { connectionId: string; database?: string }>();
const files = new Map<string, { path: string; purpose: string; format?: string }>();
const queryFileOperations = new Set<Promise<unknown>>();
const exportReservations = new ExportReservations();
const preparingTasks = new Map<string, { cancelled: boolean; failure?: string }>();
const exportProgress = new Map<string, QueryExportProgress>();
const structureProgress = new Map<string, TableColumnApplyProgress>();
const structureTokens = new Map<string, { purpose: 'columns' | 'indexes'; connectionId: string; expires: number; kind: 'snapshot' | 'preview'; snapshotId?: string }>();
const tasks = new Map<string, TaskRecord>();
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
  if (event.queryExport) exportProgress.set(event.taskId, { ...event.queryExport });
  const structure = event.indexPatch ?? event.columnPatch;
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
  const structurePurpose = command.startsWith('schema.columns.') ? 'columns' as const : command.startsWith('schema.indexes.') ? 'indexes' as const : undefined;
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
  switch (command) {
    case 'query.cancel': {
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
    case 'connections.importApply': if (shuttingDown) throw new Error('客户端正在退出，不能导入连接'); return connectionTransfer.apply(input);
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
    case 'snippets.list': return store.snippets();
    case 'snippets.save': return store.saveSnippet(input);
    case 'snippets.delete': return store.deleteSnippet(input.id);
    case 'queries.save': return store.saveQuery({ ...input, updatedAt: new Date().toISOString() });
    case 'queries.delete': return store.deleteQuery(input.id);
    case 'history.list': return store.history(input.connectionId);
    case 'tasks.list': return store.tasks();
    case 'settings.get': rendererHasSettings = true; return store.settings();
    case 'settings.save': {
      try { store.saveSettings(input); stateFlushed?.resolve(); }
      catch (error) { stateFlushed?.reject(error instanceof Error ? error : new Error(String(error))); throw error; }
      finally { stateFlushed = undefined; }
      return;
    }
    case 'files.choose': return chooseFile(input);
    case 'files.path': { const file = files.get(input.token); if (!file) throw new Error('文件选择已失效，请重新选择'); return file.path; }
    case 'files.readQuery': return queryFileOperation(() => readQueryFile(resolveFileToken(files, input.fileToken, 'query', 'sql'), input.encoding));
    case 'files.writeQuery': return queryFileOperation(() => writeSelectedQuery(input));
    case 'query.exportStream': input = { ...input, filePath: resolveFileToken(files, input.fileToken, 'export', input.format) }; break;
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
    if (tasks.has(taskId)) throw new Error('任务编号已使用，请重新发起操作');
    const task: TaskRecord = { id: taskId, kind: command, status: 'running', progress: 0, message: '正在执行', startedAt };
    tasks.set(taskId, task); store.saveTask(task);
  }
  const session = sessions.get(input.sessionId);
  const history: HistoryEntry | undefined = (command === 'query.execute' || command === 'query.executeParameterized' || command === 'query.exportStream') && session ? { id: randomUUID(), connectionId: session.connectionId, database: session.database, sql: input.sql, startedAt, elapsedMs: 0, success: false } : undefined;
  const preparing: { cancelled: boolean; failure?: string } = { cancelled: false }; if (taskId) preparingTasks.set(taskId, preparing);
  let releaseTarget: (() => void) | undefined;
  let sentToEngine = false;
  try {
    if (command === 'query.exportStream' || command === 'files.export' || command === 'files.exportResult') releaseTarget = await exportReservations.acquire(input.filePath);
    if (preparing.failure) throw new Error(preparing.failure);
    // 文件路径归一化期间的取消在主进程捕获，不能丢失后继续发送用户 SQL。
    if (preparing.cancelled) throw new Error('任务在准备阶段已取消，尚未发送用户 SQL；原目标文件保持不变');
    connectionConfig.assertAvailable(requestConnectionId);
    // 令牌目标只来自可信引擎输出；修订在投递前同步读取，客户端不能注入或覆盖。
    if (structureCommand && command !== structurePrefix + 'release') input = { ...input, connectionRevision: store.connectionRevision() };
    if (taskId) preparingTasks.delete(taskId);
    sentToEngine = true;
    const result = await broker.request(command, input);
    if (command === structurePrefix + 'get' || command === structurePrefix + 'preview') {
      if (structureTokens.size >= 128) throw new Error('结构令牌缓存已达上限，请关闭旧预览后重试');
      const token = command === structurePrefix + 'get' ? result.snapshotId : result.previewToken;
      structureTokens.set(token, { purpose: structurePurpose!, connectionId: result.target.connectionId, expires: Date.parse(result.expiresAt), kind: command === structurePrefix + 'get' ? 'snapshot' : 'preview', ...(command === structurePrefix + 'preview' ? { snapshotId: input.snapshotId } : {}) });
    }
    if (command === structurePrefix + 'release') {
      if (input.snapshotId) for (const [token, value] of structureTokens) if (value.purpose === structurePurpose && (token === input.snapshotId || value.snapshotId === input.snapshotId)) structureTokens.delete(token);
      if (input.previewToken) structureTokens.delete(input.previewToken);
    }
    if (command === 'sessions.open') sessions.set(result.sessionId, { connectionId: input.connectionId, database: input.database });
    if (command === 'sessions.close') sessions.delete(input.sessionId);
    if (taskId && tasks.get(taskId)?.status === 'running') taskEvent({ taskId, status: 'completed', progress: 100, message: '执行完成' });
    if (history) persistAuxiliary(() => store.addHistory({ ...history, elapsedMs: Date.now() - start, success: true }));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : '操作失败';
    if (taskId && tasks.get(taskId)?.status === 'running') taskEvent({ taskId, status: preparing.cancelled ? 'cancelled' : 'failed', progress: 0, message, ...(structureCommand ? { [structurePurpose === 'indexes' ? 'indexPatch' : 'columnPatch']: { phase: 'connecting' as const, ddlSubmitted: sentToEngine && command === structurePrefix + 'apply', ddlCompleted: false, definitionVerified: false, outcome: sentToEngine && command === structurePrefix + 'apply' ? 'unknown' as const : 'not-sent' as const, ...structureProgress.get(taskId) } } : {}), ...(command === 'query.exportStream' ? { queryExport: { phase: 'preparing' as const, statementsCompleted: 0, rowsWritten: 0, bytesWritten: 0, fileCommitted: false, ...exportProgress.get(taskId), sqlMayHaveExecuted: sentToEngine, transactionKnown: false } } : {}) });
    if (history) persistAuxiliary(() => store.addHistory({ ...history, elapsedMs: Date.now() - start, error: persistedQueryError(command, message) }));
    throw error;
  } finally { if (command === structurePrefix + 'apply') structureTokens.delete(input.previewToken); if (taskId) { preparingTasks.delete(taskId); exportProgress.delete(taskId); structureProgress.delete(taskId); } releaseTarget?.(); }
}

/** 按平台生成中文原生菜单，查询快捷键统一发送给当前工作区。 */
function createMenu(): void {
  const action = (name: string) => () => window?.webContents.send('dbark:menu', name);
  const mac = process.platform === 'darwin';
  const menu: Electron.MenuItemConstructorOptions[] = [
    ...(mac ? [{ label: 'DBArk', submenu: [{ label: '关于 DBArk', role: 'about' }, { type: 'separator' }, { label: '隐藏 DBArk', role: 'hide' }, { label: '退出 DBArk', role: 'quit' }] } as Electron.MenuItemConstructorOptions] : []),
    { label: '文件', submenu: [{ label: '新建连接', accelerator: 'CmdOrCtrl+Shift+N', click: action('new-connection') }, { label: '新建查询', accelerator: 'CmdOrCtrl+N', click: action('new-query') }, { label: '打开 SQL 文件', accelerator: 'CmdOrCtrl+O', click: action('open-sql-file') }, { label: '另存 SQL 文件', accelerator: 'CmdOrCtrl+Shift+S', click: action('save-sql-file') }, { label: '保存查询', accelerator: 'CmdOrCtrl+S', click: action('save-query') }, { type: 'separator' }, { label: '退出', role: 'quit' }] },
    { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
    { label: '查询', submenu: [{ label: '执行查询', accelerator: 'CmdOrCtrl+Enter', click: action('execute') }] },
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
    await Promise.allSettled([...queryFileOperations]);
    await broker?.close();
    for (const task of tasks.values()) if (task.status === 'running') persistAuxiliary(() => store.saveTask({ ...task, status: 'cancelled', finishedAt: new Date().toISOString(), message: '客户端已退出，请核对操作结果' }));
    store?.close(); shutdownComplete = true; app.quit();
  })().catch(async error => {
    stateFlushed = undefined;
    const answer = await dialog.showMessageBox({ type: 'error', title: '退出前保存失败', message: error instanceof Error ? error.message : String(error), detail: '可以返回工作台排查后重试，或放弃未保存的配置并退出。', buttons: ['返回工作台','放弃未保存配置并退出'], defaultId: 0, cancelId: 0 });
    if (answer.response === 1) {
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
  for (const preparing of preparingTasks.values()) preparing.failure = '数据库进程已退出，准备任务已停止；尚未发送用户 SQL，原目标文件保持不变';
  sessions.clear();
  structureTokens.clear();
  for (const task of tasks.values()) if (task.status === 'running') {
    const preparing = preparingTasks.has(task.id);
    if (task.kind.startsWith('schema.columns.') || task.kind.startsWith('schema.indexes.')) {
      const last = structureProgress.get(task.id), possiblySent = !preparing && (task.kind === 'schema.columns.apply' || task.kind === 'schema.indexes.apply');
      const progress: TableColumnApplyProgress = { phase: last?.phase ?? 'connecting', ddlSubmitted: Boolean(last?.ddlSubmitted || possiblySent), ddlCompleted: last?.ddlCompleted ?? false, definitionVerified: last?.definitionVerified ?? false, outcome: last?.ddlCompleted ? 'succeeded' : possiblySent ? 'unknown' : 'not-sent' };
      taskEvent({ taskId: task.id, status: 'failed', progress: task.progress, message: '数据库进程已退出，结构操作不会自动重放，请核对最新定义', ...(task.kind.startsWith('schema.indexes.') ? { indexPatch: progress } : { columnPatch: progress }) });
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
    broker = new EngineBroker(taskEvent, engineExited);
    connectionConfig = new ConnectionConfigManager(store, broker);
    connectionTransfer = new ConnectionTransfer(store);
    ipcMain.handle('dbark:request', async (event, payload: unknown) => {
      try {
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== rendererURL) throw new Error('不允许的请求来源');
        if (!payload || typeof payload !== 'object' || !('command' in payload) || !('input' in payload) || typeof payload.command !== 'string') throw new Error('请求格式无效');
        const input = validateCommand(payload.command, payload.input);
        return { ok: true, result: await dispatch(payload.command as Command, input) };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '客户端操作失败' }; }
    });
    createMenu(); await createWindow();
  }).catch(error => { dialog.showErrorBox('DBArk 启动失败', error instanceof Error ? error.message : String(error)); shutdownComplete = true; app.quit(); });
}
