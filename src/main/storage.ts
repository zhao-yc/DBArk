import { assertSqlKeywordCaseWrite, readSqlKeywordCase } from '../shared/sqlKeywordCase';
import { assertQueryFileSourceSettings, queryFileSourceRefSchema, sameQueryFileSource, type QueryFileSourceRef } from '../shared/queryFileSources';
import { privateQueryFileSourceSchema, type PrivateQueryFileSource } from './queryFileSourceRecords';
import { privateQueryRecentFilesSchema, rememberQueryFile, type PrivateQueryRecentFile } from './queryFileRecents';
import { assertQueryLayoutWrite, readQueryEditorHeight } from '../shared/queryLayout';
import { assertEditorIndentationWrite, editorIndentationLimits, readEditorInsertSpaces, readEditorTabSize } from '../shared/editorIndentation';
import { assertEditorWordWrap, defaultEditorWordWrap, readEditorWordWrap } from '../shared/editorWordWrap';
import { assertEditorFontSize, editorFontLimits, readEditorFontSize } from '../shared/editorFont';
import { connectionTransferDocumentSchema, connectionTransferLimits, exportConnectionProfile, importConnectionProfile, importReplacementProfile, type ExportedConnectionProfile } from '../shared/connectionTransfer';
import { connectionReplacementText } from '../shared/connectionTransferMessages';
import { connectionOrganizationApplySchema, connectionOrganizationDefaultColor, type ConnectionOrganizationApply, type ConnectionOrganizationSnapshot } from '../shared/connectionOrganization';
import { connectionOrganizationZh } from '../shared/connectionOrganization.zh-CN';
import { assertTlsPassphrase, tlsCredentialMessages } from '../shared/tlsCredentials';
import { parseTableApplyReceipt, interruptTableApplyReceipt, tableApplyReceiptLimits, type TableApplyReceipt, type TableApplyReceiptListInput, type TableApplyReceiptPage } from '../shared/tableApplyReceipt';
import { persistedTaskMessage } from './taskPrivacy';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { AppSettings, ConnectionProfile, HistoryEntry, SavedQuery, SqlSnippet, TaskRecord } from '../shared/contracts';
import { validateSnippetBudget } from '../shared/snippets';
import { validateSnippetCollection, snippetTransferZh } from '../shared/snippetTransfer';
import { tablePreferenceSaveSchema, tablePreferenceTargetSchema, tablePreferencesSchema, tablePreferenceTargetChanged, validateTablePreferenceBudget, type TablePreferenceTarget, type TablePreferences } from '../shared/tablePreferences';
import{savedQuerySearchLimits}from'../shared/savedQuerySearch';
import type{SavedQueryPagePosition}from'../shared/savedQueryPages';
import type{HistoryPagePosition,HistoryPageInput}from'../shared/historyPages';
import { emptyWorkbench, workbenchDocumentSchema, workbenchSaveSchema, type WorkbenchSnapshot } from '../shared/workbench';
import { querySaveContentSchema, queryUpdateSourceSchema, sameSavedQueryContext, savedQueryOriginContext, type QuerySaveContent, type QuerySaveResult } from '../shared/queryBinding';
import { bindSavedQuery, queryConnectionDigest } from './queryBinding';
import { tablePresetDocumentSchema, tablePresetListSchema, tablePresetSaveSchema, tablePresetSelectSchema, validateTablePresetBudget, type TablePresetTarget, type TablePresetSource, type TablePresetStoredSnapshot as TablePresetSnapshot, type TablePresetSelect } from '../shared/tablePresets';
import { queryResultPresetDocumentSchema, queryResultPresetListSchema, queryResultPresetSaveSchema, queryResultPresetSelectSchema, queryResultPresetRenameSchema, validateQueryResultPresetBudget, type QueryResultPresetSource, type QueryResultPresetStoredSnapshot, type QueryResultPresetValue, type QueryResultPresetSelect, type QueryResultPresetSave, type QueryResultPresetRename } from '../shared/queryResultPresets';
import { importPresetDocumentSchema, importPresetSaveSchema, importPresetDeleteSchema, importPresetLimits, importPresetText, type ImportPresetDocument, type ImportPresetSnapshot, type ImportPresetSaveInput, type ImportPresetDeleteInput } from '../shared/importPresets';
import { parseSavedQueryRecord } from './savedQuerySearchMatch';
import { parseHistoryRecord } from './historyPageMatch';
import { historyDeleteText, type HistoryDeleteReference } from '../shared/historyDelete';
import { historyDeleteByteTotal, historyDeleteReferences } from './historyDeleteStorage';
import { savedQueryOrganizationApplySchema, savedQueryGroupIds, type SavedQueryOrganizationApply, type SavedQueryGroupScope } from '../shared/savedQueryOrganization';
import { applySavedQueryOrganization, readSavedQueryOrganization, savedQueryOrganizationRevision, savedQueryOrganizationSnapshot, savedQueryMembershipCondition, validateSavedQueryOrganizationStorage } from './savedQueryOrganizationStorage';

export interface SecretProtector { available(): boolean; encrypt(value: string): string; decrypt(value: string): string; }
export const defaultSettings: AppSettings = { theme: 'dark', sidebarWidth: 270, resultLimit: 1000, pageSize: 200, dataTypeColors: false, editorFontSize: editorFontLimits.defaultSize, editorWordWrap: defaultEditorWordWrap, editorTabSize: editorIndentationLimits.defaultTabSize, editorInsertSpaces: editorIndentationLimits.defaultInsertSpaces, tabs: [] };
/** 只由不可变预览生成，旧概要和单调修订共同约束最终原子替换。 */
export interface ConnectionImportStorageOptions { expectedRevision: number; replacements: { sourceId: string; targetId: string; previous: ExportedConnectionProfile }[]; }

/** 小型配置库在内存中运行 SQLite，写入时原子替换文件；无需打包本机 ABI 模块。 */
export class LocalStore {
  private connectionRevisionValue = 0;
  private readonly queryFileDocuments = new Map<string, object>();
  private readonly queryFileReloadGenerations = new Map<string, number>();
  private queryFileDocumentSnapshot?: AppSettings['tabs'];
  private queryRevisionValue=0;
  private readonly queryOrganizationGeneration = randomUUID();
  private readonly importPresetGeneration = randomUUID();
  private historyRevisionValue=0;
  private snippetRevisionValue = 0;
  private volatileSecrets = new Map<string, string>();
  private guardedMutation = false;
  /** 绑定数据库、文件路径及系统凭据保护器；仅由 open 创建已迁移的存储实例。 */
  private constructor(private db: Database, private path: string, private protector: SecretProtector, private reopen: (data: Uint8Array) => Database) {}

  /** 加载实际 SQLite 文件并迁移；凭据保护由桌面主进程注入。 */
  static async open(path: string, wasmPath: string, protector: SecretProtector): Promise<LocalStore> {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    const db = new SQL.Database(existsSync(path) ? readFileSync(path) : undefined);
    const store = new LocalStore(db, path, protector, data => new SQL.Database(data));
    try { store.migrate(); } catch (error) { store.close(); throw error; }
    return store;
  }

  /** 版本迁移在事务中进行，失败时保留原磁盘文件。 */
  private migrate(): void {
    const version = Number(this.db.exec('PRAGMA user_version')[0]?.values[0]?.[0] ?? 0);
    if (version > 9) throw new Error('配置库由更新版本的 DBArk 创建，请使用新版本打开');
    // schema9新增按查询文档隔离的私有文件来源表；旧版本不可降级打开。
    // 未知方案版本或损坏文档在任何迁移落盘前拒绝，不能猜测降级或重写原文件。
    if (this.db.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='table_presets'").length) {
      for (const document of this.records<unknown>('SELECT data FROM table_presets')) tablePresetDocumentSchema.parse(document);
    }
    // 可选元数据也须先完整校验；坏文档不能被迁移或任务恢复写盘掩盖。
    if (this.db.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='query_result_presets'").length) this.validateQueryResultPresetCollection();
    // 可选导入配置先校验原始字节和完整文档；未知版本不能被任何迁移写盘覆盖。
    if (this.db.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_presets'").length) this.readImportPresetDocument();
    validateSavedQueryOrganizationStorage(this.db);
    this.mutate(() => {
      this.db.run(`CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS secrets (connection_id TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(connection_id,name));
        CREATE TABLE IF NOT EXISTS queries (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS queries_updated_id ON queries(updated_at COLLATE BINARY DESC,id COLLATE BINARY DESC);
        CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, data TEXT NOT NULL, started_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS history_started_id ON history(started_at COLLATE BINARY DESC,id COLLATE BINARY DESC);
        CREATE INDEX IF NOT EXISTS history_connection_started_id ON history(connection_id COLLATE BINARY,started_at COLLATE BINARY DESC,id COLLATE BINARY DESC);
        CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL, started_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workbench (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sql_snippets (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS table_preferences (connection_id TEXT NOT NULL, database_name TEXT NOT NULL, table_name TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(connection_id,database_name,table_name));
        CREATE TABLE IF NOT EXISTS table_apply_receipts (id TEXT PRIMARY KEY, data TEXT NOT NULL, started_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS table_presets (connection_id TEXT NOT NULL, database_name TEXT NOT NULL, table_name TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(connection_id,database_name,table_name));
        CREATE TABLE IF NOT EXISTS query_file_sources (tab_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, data TEXT NOT NULL);
        -- 最近列表仅为可选元数据缓存，旧schema9客户端可忽略，不改变文件来源的存储合同。
        CREATE TABLE IF NOT EXISTS query_file_recents (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
        -- 查询结果整理方案是可选schema9元数据，不改变旧客户端的原生版本门槛。
        CREATE TABLE IF NOT EXISTS query_result_presets (connection_id TEXT PRIMARY KEY, data TEXT NOT NULL);
        -- 文件解释及人工映射为可选schema9元数据，不保存路径、行值或连接身份。
        CREATE TABLE IF NOT EXISTS import_presets (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
        -- 分组元数据与查询原文分离；旧schema9客户端可忽略，不改变来源摘要。
        CREATE TABLE IF NOT EXISTS saved_query_organization (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS saved_query_memberships (query_id TEXT PRIMARY KEY, group_id TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS saved_query_memberships_group ON saved_query_memberships(group_id,query_id);
        -- 旧客户端合法删除留下的孤儿成员不能在同ID重建时复活。
        DELETE FROM saved_query_memberships WHERE NOT EXISTS (SELECT 1 FROM queries WHERE queries.id=saved_query_memberships.query_id);
        PRAGMA user_version=9;`);
    });
    for (const receipt of this.records<TableApplyReceipt>('SELECT data FROM table_apply_receipts').map(parseTableApplyReceipt)) if (receipt.phase !== 'terminal') this.saveTableApplyReceipt(interruptTableApplyReceipt(receipt));
    const confirmedEdits = new Map(this.records<TableApplyReceipt>('SELECT data FROM table_apply_receipts').map(parseTableApplyReceipt).filter(r => r.outcome === 'committed').map(r => [r.operationId, r]));
    // 旧通用表格任务也只保留固定概要，不能让历史服务器错误继续泄漏字段值。
    for (const task of this.tasks()) if (task.kind === 'table.apply') {
      const { errors: _errors, ...safe } = task;
      const confirmed = task.tableApplyReceiptId ? confirmedEdits.get(task.tableApplyReceiptId) : undefined, status = confirmed ? 'completed' as const : task.status;
      this.saveTask({ ...safe, status, ...(confirmed ? { progress: 100, finishedAt: confirmed.finishedAt } : {}), message: persistedTaskMessage('table.apply', { taskId: task.id, status, progress: task.progress, message: '' }) });
    }
    // 上次异常退出的长任务不自动重试，尤其不能重放写操作。
    for (const task of this.tasks()) if (task.status === 'running') this.saveTask({ ...task, status: 'failed', finishedAt: new Date().toISOString(), message: '应用上次退出时任务未完成，请核对数据库状态' });
  }

  /** 参数化读取 JSON 记录，无论成功失败都释放 SQLite 语句。 */
  private records<T>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try { stmt.bind(params); const rows: T[] = []; while (stmt.step()) rows.push(JSON.parse(String(stmt.getAsObject().data)) as T); return rows; }
    finally { stmt.free(); }
  }

  /** 原子替换配置文件，写盘失败交给调用者恢复内存快照。 */
  private flush(beforeReplace?: () => void): void {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, this.db.export(), { mode: 0o600 });
    // 同步写盘也可能跨过预览期限；只在发布前检查，成功替换后不再制造失败结果。
    try { beforeReplace?.(); } catch (error) {
      try { unlinkSync(temporary); } catch { /* 不覆盖原归属错误，目标配置文件仍未替换。 */ }
      throw error;
    }
    renameSync(temporary, this.path);
  }

  /** 文件写入失败时同时恢复内存数据库和会话凭据，防止后续保存悄悄提交失败操作。 */
  private mutate(action: () => void, assertCurrent?: () => void): void {
    // 归属回调可读取存储，但不得在受保护事务中重入另一次写操作。
    if (this.guardedMutation) throw Error('本地数据正在提交，请稍后重试');
    const snapshot = this.db.export();
    const secrets = new Map(this.volatileSecrets);
    if (assertCurrent) this.guardedMutation = true;
    try {
      this.db.run('BEGIN'); action(); assertCurrent?.(); this.db.run('COMMIT'); this.flush(assertCurrent); this.queryFileDocumentSnapshot = undefined;
    } catch (error) {
      try { this.db.run('ROLLBACK'); } catch { /* COMMIT 后的磁盘错误没有活动事务。 */ }
      this.db.close(); this.db = this.reopen(snapshot); this.volatileSecrets = secrets; this.queryFileDocumentSnapshot = undefined;
      throw new Error(`本地数据保存失败，修改未保存：${error instanceof Error ? error.message : String(error)}`);
    } finally { if (assertCurrent) this.guardedMutation = false; }
  }

  /** 优先读取会话凭据；持久化密文只能通过系统保护器解密。 */
  private readSecret(connectionId: string, name: string): string | undefined {
    const volatile = this.volatileSecrets.get(`${connectionId}\0${name}`);
    if (volatile !== undefined) return volatile;
    const stmt = this.db.prepare('SELECT value FROM secrets WHERE connection_id=? AND name=?');
    try {
      stmt.bind([connectionId, name]);
      if (!stmt.step()) return undefined;
      if (!this.protector.available()) throw new Error('系统凭据加密不可用，请重新输入连接密码');
      try { return this.protector.decrypt(String(stmt.get()[0])); }
      catch { throw new Error('无法解密已保存的凭据，请重新输入密码并保存连接'); }
    } finally { stmt.free(); }
  }

  /** 判断凭据是否存在，不向界面返回任何明文内容。 */
  private hasSecret(connectionId: string, name: string): boolean {
    if (this.volatileSecrets.has(`${connectionId}\0${name}`)) return true;
    const stmt = this.db.prepare('SELECT 1 FROM secrets WHERE connection_id=? AND name=?');
    try { stmt.bind([connectionId, name]); return stmt.step(); } finally { stmt.free(); }
  }

  /** 缺省保持原值，空值清除；系统加密不可用时仅保存到内存。 */
  private putSecret(connectionId: string, name: string, value: string | undefined, remember: boolean): void {
    const effective = value === undefined ? this.readSecret(connectionId, name) : value;
    this.db.run('DELETE FROM secrets WHERE connection_id=? AND name=?', [connectionId, name]);
    this.volatileSecrets.delete(`${connectionId}\0${name}`);
    // 显式空字符串表示清除凭据，不为“空密码”保留密文或已保存标记。
    if (effective === undefined || effective === '') return;
    if (remember && this.protector.available()) {
      let encrypted: string;
      try { encrypted = this.protector.encrypt(effective); }
      catch (error) { if (name === 'tlsPassphrase') throw new Error(tlsCredentialMessages.saveFailed); throw error; }
      this.db.run('INSERT INTO secrets VALUES (?,?,?)', [connectionId, name, encrypted]);
    }
    else this.volatileSecrets.set(`${connectionId}\0${name}`, effective);
  }

  /** 返回界面的连接配置只携带是否存在凭据的标记。 */
  connections(): ConnectionProfile[] {
    return this.records<ConnectionProfile>('SELECT data FROM connections ORDER BY rowid').map(profile => ({ ...profile, hasPassword: this.hasSecret(profile.id, 'password'), ssh: profile.ssh ? { ...profile.ssh, hasPassword: this.hasSecret(profile.id, 'sshPassword'), hasPassphrase: this.hasSecret(profile.id, 'sshPassphrase') } : undefined,
      // 旧TLS概要在没有新秘密时保持原形状，存在标记只由主进程秘密槽计算。
      ...(profile.tls && this.hasSecret(profile.id, 'tlsPassphrase') ? { tls: { ...profile.tls, hasPassphrase: true } } : {}) }));
  }

  /** 把连接与秘密分开存储，保存失败时恢复两者原始状态。 */
  saveConnection(input: ConnectionProfile): ConnectionProfile {
    assertTlsPassphrase(input.tls?.passphrase);
    const profile = structuredClone({ ...input, id: input.id || randomUUID() });
    const previous = this.records<ConnectionProfile>('SELECT data FROM connections WHERE id=?', [profile.id])[0];
    const remember = profile.rememberPassword === true;
    this.mutate(() => {
      this.putSecret(profile.id, 'password', profile.password, remember);
      this.putSecret(profile.id, 'sshPassword', profile.ssh?.password, remember);
      this.putSecret(profile.id, 'sshPassphrase', profile.ssh?.passphrase, remember);
      this.putSecret(profile.id, 'tlsPassphrase', profile.tls?.passphrase, remember);
      delete profile.password; delete profile.hasPassword;
      if (profile.ssh) { delete profile.ssh.password; delete profile.ssh.passphrase; delete profile.ssh.hasPassword; delete profile.ssh.hasPassphrase; }
      if (profile.tls) { delete profile.tls.passphrase; delete profile.tls.hasPassphrase; }
      // 更换数据库目标时与连接配置一起提交；磁盘失败不能先丢失原布局。
      if (previous && tablePreferenceTargetChanged(previous, profile)) this.db.run('DELETE FROM table_preferences WHERE connection_id=?', [profile.id]);
      this.db.run('INSERT INTO connections VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [profile.id, JSON.stringify(profile)]);
    });
    this.connectionRevisionValue++;
    return this.connections().find(x => x.id === profile.id)!;
  }

  /** 任意成功的连接配置或认证变更都会让导入预览失效，失败写盘不改变版本。 */
  connectionRevision(): number { return this.connectionRevisionValue; }

  /** 只读取公开概要与同一主进程全局修订，不解密凭据、不建立连接，也不对列表做隐式截断。 */
  connectionOrganization(): ConnectionOrganizationSnapshot { return { revision: this.connectionRevisionValue, connections: this.connections() }; }

  /** 整批CAS后仅改原SQLite JSON的显示元数据；全部目标先存在，随后一次事务落盘，失败不推进修订。 */
  applyConnectionOrganization(input: ConnectionOrganizationApply): ConnectionOrganizationSnapshot {
    const request = connectionOrganizationApplySchema.parse(input);
    if (request.expectedRevision !== this.connectionRevisionValue) throw Error(connectionOrganizationZh.stale);
    if (this.connectionRevisionValue >= Number.MAX_SAFE_INTEGER) throw Error(connectionOrganizationZh.revisionLimit);
    const profiles = request.ids.map(id => {
      const profile = this.records<ConnectionProfile>('SELECT data FROM connections WHERE id=?', [id])[0];
      if (!profile || profile.id !== id) throw Error(connectionOrganizationZh.missing);
      return profile;
    });
    // Main在此同步方法前逐id调用manager.assertAvailable；本方法不委派单项save/resolve或Broker。
    this.mutate(() => {
      if (request.expectedRevision !== this.connectionRevisionValue) throw Error(connectionOrganizationZh.stale);
      for (const profile of profiles) {
        const next = { ...profile };
        if (request.changes.group !== undefined) next.group = request.changes.group;
        if (request.changes.color !== undefined) next.color = request.changes.color ?? connectionOrganizationDefaultColor;
        this.db.run('UPDATE connections SET data=? WHERE id=?', [JSON.stringify(next), profile.id]);
      }
    });
    this.connectionRevisionValue++;
    return this.connectionOrganization();
  }

  /** 来源只取主进程已保存的连接概要，不解密凭据；摘要不会持久化认证文件路径原文。 */
  private tablePresetSource(target: TablePresetTarget): TablePresetSource {
    const profile=this.records<ConnectionProfile>('SELECT data FROM connections WHERE id=?',[target.connectionId])[0];
    if(!profile)throw Error('方案连接已删除，请重新打开表页');
    return {connectionRevision:this.connectionRevisionValue,connectionDigest:queryConnectionDigest(profile)};
  }
  /** 精确主键读取；空表保留修订墓碑，删除后再创建不能让旧CAS复活。 */
  tablePresets(raw: unknown): TablePresetSnapshot {
    const target=tablePresetListSchema.parse(raw),source=this.tablePresetSource(target);
    const value=this.records<unknown>('SELECT data FROM table_presets WHERE connection_id=? AND database_name=? AND table_name=?',[target.connectionId,target.database,target.table])[0];
    return {...tablePresetDocumentSchema.parse(value??{version:1,revision:0,entries:[]}),source};
  }
  /** 连接修订和来源必须与Main当前事实相同；调用方提供的摘要本身不代表可信。 */
  private checkedTablePresets(input: TablePresetSelect | ReturnType<typeof tablePresetSaveSchema.parse>): TablePresetSnapshot {
    const current=this.tablePresets({connectionId:input.connectionId,database:input.database,table:input.table});
    if(current.revision!==input.expectedRevision||current.source.connectionRevision!==input.source.connectionRevision||current.source.connectionDigest!==input.source.connectionDigest)throw Error('方案或连接配置已变化，请刷新后重试');
    return current;
  }
  /** CAS、全库数量/字节预算与原子落盘在同一同步事务执行，失败恢复内存及原文件。 */
  private writeTablePresets(target:TablePresetTarget,document:TablePresetSnapshot):void {
    const stored=tablePresetDocumentSchema.parse({version:1,revision:document.revision,entries:document.entries});
    const statement=this.db.prepare('SELECT connection_id,database_name,table_name,data FROM table_presets WHERE NOT(connection_id=? AND database_name=? AND table_name=?)');
    let targets=0,count=stored.entries.length,bytes=Buffer.byteLength(JSON.stringify(stored)+target.connectionId+target.database+target.table,'utf8');
    try {
      statement.bind([target.connectionId,target.database,target.table]);
      while(statement.step()){
        const row=statement.get();targets++;const other=tablePresetDocumentSchema.parse(JSON.parse(String(row[3])));
        count+=other.entries.length;bytes+=row.reduce<number>((sum,value)=>sum+Buffer.byteLength(String(value),'utf8'),0);
      }
    } finally {statement.free();}
    validateTablePresetBudget(targets+1,count,bytes);
    this.db.run('INSERT INTO table_presets VALUES (?,?,?,?) ON CONFLICT(connection_id,database_name,table_name) DO UPDATE SET data=excluded.data',[target.connectionId,target.database,target.table,JSON.stringify(stored)]);
  }
  /** 新建不隐式覆盖同名项；覆盖必须携带明确replaceId及所见表级修订。 */
  saveTablePreset(raw:unknown):TablePresetSnapshot {
    const input=tablePresetSaveSchema.parse(raw);let result!:TablePresetSnapshot;
    this.mutate(()=>{
      const current=this.checkedTablePresets(input),same=current.entries.find(item=>item.name===input.name),replaced=current.entries.find(item=>item.id===input.replaceId);
      if(input.replaceId ? !replaced||replaced.name!==input.name : !!same)throw Error('同名方案已存在或已变化，请明确选择覆盖后重试');
      const entry={id:input.replaceId??randomUUID(),name:input.name,connectionDigest:current.source.connectionDigest,configuration:input.configuration};
      result={...current,revision:current.revision+1,entries:input.replaceId?current.entries.map(item=>item.id===input.replaceId?entry:item):[...current.entries,entry]};
      this.writeTablePresets(input,result);
    });
    return result;
  }
  /** 只删除显式选择且修订未变的一项，保留表级修订，不涉及数据库对象。 */
  deleteTablePreset(raw:unknown):TablePresetSnapshot {
    const input=tablePresetSelectSchema.parse(raw);let result!:TablePresetSnapshot;
    this.mutate(()=>{
      const current=this.checkedTablePresets(input);
      if(!current.entries.some(item=>item.id===input.id))throw Error('方案已删除，请刷新后重试');
      result={...current,revision:current.revision+1,entries:current.entries.filter(item=>item.id!==input.id)};this.writeTablePresets(input,result);
    });return result;
  }
  /** 应用只返回完整已存方案，旧目标连接摘要不匹配时整份拒绝；不写SQL或保存自动状态。 */
  selectedTablePreset(raw:unknown) {
    const input=tablePresetSelectSchema.parse(raw),current=this.checkedTablePresets(input),entry=current.entries.find(item=>item.id===input.id);
    if(!entry||entry.connectionDigest!==current.source.connectionDigest)throw Error('方案来源连接已失效，请重新显式保存或覆盖');
    return entry.configuration;
  }

  /** 读取唯一原始文档，先核原字节再解析；坏行、未知版本及超限整体拒绝。 */
  private readImportPresetDocument(): ImportPresetDocument {
    const statement = this.db.prepare('SELECT id,data FROM import_presets');
    try {
      if (!statement.step()) return { version: 1, revision: 0, entries: [] };
      const [id, data] = statement.get();
      if (id !== 1 || typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > importPresetLimits.documentBytes || statement.step()) throw Error(importPresetText.documentBudget);
      return importPresetDocumentSchema.parse(JSON.parse(data));
    } finally { statement.free(); }
  }

  /** generation仅属于本次open，不持久化、不解密凭据；每次返回完整独立配置副本。 */
  importPresets(): ImportPresetSnapshot {
    const document = this.readImportPresetDocument();
    return { generation: this.importPresetGeneration, revision: document.revision, entries: document.entries };
  }

  /** 同步事务内同时核代次和修订，删空后仍保留修订墓碑，拒绝旧会话与ABA复用。 */
  private checkedImportPresets(input: ImportPresetSaveInput | ImportPresetDeleteInput): ImportPresetDocument {
    const document = this.readImportPresetDocument();
    if (input.generation !== this.importPresetGeneration || input.revision !== document.revision || document.revision >= Number.MAX_SAFE_INTEGER) throw Error(importPresetText.stale);
    return document;
  }

  /** 只写严格白名单文档；mutate负责事务、归属终门及原子替换失败的内存/磁盘恢复。 */
  private writeImportPresets(document: ImportPresetDocument): ImportPresetSnapshot {
    const checked = importPresetDocumentSchema.parse(document), data = JSON.stringify(checked);
    this.db.run('INSERT INTO import_presets VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [data]);
    return { generation: this.importPresetGeneration, revision: checked.revision, entries: checked.entries };
  }

  /** 新建或精确覆盖完整配置；名称原文查重，覆盖保留创建时间及集合顺序。 */
  saveImportPreset(raw: unknown, assertCurrent?: () => void): ImportPresetSnapshot {
    const input = importPresetSaveSchema.parse(raw); let result!: ImportPresetSnapshot;
    this.mutate(() => {
      assertCurrent?.(); const current = this.checkedImportPresets(input), previous = input.id ? current.entries.find(entry => entry.id === input.id) : undefined;
      if (input.id && !previous) throw Error(importPresetText.missing);
      if (current.entries.some(entry => entry.name === input.name && entry.id !== input.id)) throw Error(importPresetText.duplicate);
      const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) : 0)).toISOString();
      const entry = { id: previous?.id ?? randomUUID(), name: input.name, configuration: input.configuration, createdAt: previous?.createdAt ?? now, updatedAt: now };
      result = this.writeImportPresets({ version: 1, revision: current.revision + 1, entries: previous ? current.entries.map(item => item.id === previous.id ? entry : item) : [...current.entries, entry] });
    }, assertCurrent);
    return result;
  }

  /** 删除精确编号，最后一项也写入递增修订；不会清理任何查询、连接或其他配置。 */
  deleteImportPreset(raw: unknown, assertCurrent?: () => void): ImportPresetSnapshot {
    const input = importPresetDeleteSchema.parse(raw); let result!: ImportPresetSnapshot;
    this.mutate(() => {
      assertCurrent?.(); const current = this.checkedImportPresets(input);
      if (!current.entries.some(entry => entry.id === input.id)) throw Error(importPresetText.missing);
      result = this.writeImportPresets({ version: 1, revision: current.revision + 1, entries: current.entries.filter(entry => entry.id !== input.id) });
    }, assertCurrent);
    return result;
  }

  /** 来源从真实已保存连接计算；不读取凭据，也不信任界面传入的摘要。 */
  private queryResultPresetSource(connectionId: string): QueryResultPresetSource {
    const profile = this.records<ConnectionProfile>('SELECT data FROM connections WHERE id=?', [connectionId])[0];
    if (!profile) throw Error('方案连接已删除，请重新选择连接');
    return { connectionRevision: this.connectionRevisionValue, connectionDigest: queryConnectionDigest(profile) };
  }

  /** 完整读取单连接文档；即使最后一项删除也保留修订，防止旧CAS再次生效。 */
  queryResultPresets(raw: unknown): QueryResultPresetStoredSnapshot {
    const target = queryResultPresetListSchema.parse(raw), source = this.queryResultPresetSource(target.connectionId);
    const document = this.records<unknown>('SELECT data FROM query_result_presets WHERE connection_id=?', [target.connectionId])[0];
    return { ...queryResultPresetDocumentSchema.parse(document ?? { version: 1, revision: 0, entries: [] }), source };
  }

  /** 全库预算包括空文档墓碑、连接键及原始JSON的UTF-8字节，不截断内容。 */
  private validateQueryResultPresetCollection(replacement?: { connectionId: string; data: string }): void {
    const statement = this.db.prepare('SELECT connection_id,data FROM query_result_presets');
    let connections = replacement ? 1 : 0, entries = 0, bytes = replacement ? Buffer.byteLength(replacement.connectionId + replacement.data, 'utf8') : 0;
    if (replacement) entries = queryResultPresetDocumentSchema.parse(JSON.parse(replacement.data)).entries.length;
    try {
      while (statement.step()) {
        const row = statement.get(), connectionId = String(row[0]), data = String(row[1]);
        queryResultPresetListSchema.parse({ connectionId });
        const document = queryResultPresetDocumentSchema.parse(JSON.parse(data));
        if (replacement?.connectionId === connectionId) continue;
        connections++; entries += document.entries.length; bytes += Buffer.byteLength(connectionId + data, 'utf8');
      }
    } finally { statement.free(); }
    validateQueryResultPresetBudget(connections, entries, bytes);
  }

  /** 在同步事务内核对全局连接修订、连接内容摘要和文档修订，覆盖来源变化及ABA。 */
  private checkedQueryResultPresets(input: QueryResultPresetSelect | QueryResultPresetSave | QueryResultPresetRename): QueryResultPresetStoredSnapshot {
    const current = this.queryResultPresets({ connectionId: input.connectionId });
    if (current.revision !== input.expectedRevision || current.source.connectionRevision !== input.source.connectionRevision || current.source.connectionDigest !== input.source.connectionDigest) throw Error('方案或连接配置已变化，请刷新后重试');
    return current;
  }

  /** 校验文档和全库预算后写入；调用方必须在mutate内执行，失败恢复原内存及文件。 */
  private writeQueryResultPresets(connectionId: string, snapshot: QueryResultPresetStoredSnapshot): void {
    const document = queryResultPresetDocumentSchema.parse({ version: 1, revision: snapshot.revision, entries: snapshot.entries }), data = JSON.stringify(document);
    this.validateQueryResultPresetCollection({ connectionId, data });
    this.db.run('INSERT INTO query_result_presets VALUES (?,?) ON CONFLICT(connection_id) DO UPDATE SET data=excluded.data', [connectionId, data]);
  }

  /** 新建与覆盖均显式提交完整值；覆盖可改名，但不能占用其他编号的名称。 */
  saveQueryResultPreset(raw: unknown): QueryResultPresetStoredSnapshot {
    const input = queryResultPresetSaveSchema.parse(raw); let result!: QueryResultPresetStoredSnapshot;
    this.mutate(() => {
      const current = this.checkedQueryResultPresets(input);
      if (input.replaceId && !current.entries.some(entry => entry.id === input.replaceId)) throw Error('方案已删除，请刷新后重试');
      if (current.entries.some(entry => entry.name === input.name && entry.id !== input.replaceId)) throw Error('同名方案已存在，请选择其它名称或明确覆盖');
      const entry = { id: input.replaceId ?? randomUUID(), name: input.name, connectionDigest: current.source.connectionDigest, value: input.value };
      result = { ...current, revision: current.revision + 1, entries: input.replaceId ? current.entries.map(item => item.id === input.replaceId ? entry : item) : [...current.entries, entry] };
      this.writeQueryResultPresets(input.connectionId, result);
    });
    return result;
  }

  /** 重命名仅修改名称，保留完整值及旧来源摘要，不能借此重新签发失效方案。 */
  renameQueryResultPreset(raw: unknown): QueryResultPresetStoredSnapshot {
    const input = queryResultPresetRenameSchema.parse(raw); let result!: QueryResultPresetStoredSnapshot;
    this.mutate(() => {
      const current = this.checkedQueryResultPresets(input);
      if (!current.entries.some(entry => entry.id === input.id)) throw Error('方案已删除，请刷新后重试');
      if (current.entries.some(entry => entry.id !== input.id && entry.name === input.name)) throw Error('同名方案已存在，请选择其它名称');
      result = { ...current, revision: current.revision + 1, entries: current.entries.map(entry => entry.id === input.id ? { ...entry, name: input.name } : entry) };
      this.writeQueryResultPresets(input.connectionId, result);
    });
    return result;
  }

  /** 删除精确编号并推进文档修订；空文档仍写盘保留墓碑。 */
  deleteQueryResultPreset(raw: unknown): QueryResultPresetStoredSnapshot {
    const input = queryResultPresetSelectSchema.parse(raw); let result!: QueryResultPresetStoredSnapshot;
    this.mutate(() => {
      const current = this.checkedQueryResultPresets(input);
      if (!current.entries.some(entry => entry.id === input.id)) throw Error('方案已删除，请刷新后重试');
      result = { ...current, revision: current.revision + 1, entries: current.entries.filter(entry => entry.id !== input.id) };
      this.writeQueryResultPresets(input.connectionId, result);
    });
    return result;
  }

  /** 只返回已保存的完整整理值；连接变化后的旧项整份拒绝，必须明确覆盖才能恢复。 */
  selectedQueryResultPreset(raw: unknown): QueryResultPresetValue {
    const input = queryResultPresetSelectSchema.parse(raw), current = this.checkedQueryResultPresets(input), entry = current.entries.find(item => item.id === input.id);
    if (!entry || entry.connectionDigest !== current.source.connectionDigest) throw Error('方案来源连接已失效，请重新显式保存或覆盖');
    return entry.value;
  }

  /** 白名单批次在同一事务内新增/受控替换；替换绝不走缺省保留秘密的普通保存路径。 */
  importConnections(input: ExportedConnectionProfile[], allowIncomplete: boolean, options?: ConnectionImportStorageOptions): ConnectionProfile[] {
    const document = connectionTransferDocumentSchema.parse({ format: 'DBArk-connections', version: 1, connections: input });
    if (Buffer.byteLength(JSON.stringify(document), 'utf8') > connectionTransferLimits.fileBytes) throw new Error('连接配置超过 2 MiB 上限');
    const replacements = new Map(options?.replacements.map(item => [item.sourceId, item]) ?? []);
    const targetIds = new Set(options?.replacements.map(item => item.targetId));
    if (options && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision !== this.connectionRevisionValue || replacements.size !== options.replacements.length || targetIds.size !== options.replacements.length || options.replacements.some(item => !document.connections.some(profile => profile.id === item.sourceId)))) throw new Error(connectionReplacementText.expected);
    // 会话槽使用NUL分隔；遇到旧库中有歧义的身份时拒绝替换，不能把另一连接的会话秘密当作本目标清除。
    if (replacements.size && ([...targetIds].some(id => !id || id.includes('\0')) || this.records<ConnectionProfile>('SELECT data FROM connections').some(profile => [...targetIds].some(id => profile.id !== id && profile.id.startsWith(`${id}\0`))))) throw new Error(connectionReplacementText.expected);
    const profiles = document.connections.map(profile => { const replacement = replacements.get(profile.id); return replacement ? importReplacementProfile(profile, replacement.previous) : importConnectionProfile(profile, randomUUID()); });
    if (!allowIncomplete && profiles.some(profile => profile.pendingFiles?.length)) throw new Error('连接含待重新选择的认证文件，请明确确认暂存后再导入');
    this.mutate(() => {
      // CAS在任何写入之前再次检查；JS同步事务中没有await，不允许检查与提交之间插入配置修改。
      if (options && options.expectedRevision !== this.connectionRevisionValue) throw new Error(connectionReplacementText.expected);
      for (const replacement of replacements.values()) {
        const previous = this.records<ConnectionProfile>('SELECT data FROM connections WHERE id=?', [replacement.targetId])[0];
        if (!previous || replacement.previous.id !== replacement.targetId || JSON.stringify(exportConnectionProfile(previous)) !== JSON.stringify(replacement.previous)) throw new Error(connectionReplacementText.expected);
      }
      for (const profile of profiles) {
        if (targetIds.has(profile.id)) {
          // 删除整个秘密命名空间，包括未来新增槽；失败时mutate恢复SQLite及全部会话秘密。
          this.db.run('DELETE FROM secrets WHERE connection_id=?', [profile.id]);
          for (const key of this.volatileSecrets.keys()) if (key.startsWith(`${profile.id}\0`)) this.volatileSecrets.delete(key);
          this.db.run('UPDATE connections SET data=? WHERE id=?', [JSON.stringify(profile), profile.id]);
        } else this.db.run('INSERT INTO connections VALUES (?,?)', [profile.id, JSON.stringify(profile)]);
      }
    });
    this.connectionRevisionValue++;
    return profiles;
  }

  /** 明文只在主进程与数据库执行进程间传递，不交给渲染进程。 */
  resolveConnection(id: string, overrides?: ConnectionProfile): ConnectionProfile {
    const stored = this.connections().find(x => x.id === id);
    const profile = overrides ?? stored;
    if (!profile) throw new Error('连接不存在，请重新选择连接');
    assertTlsPassphrase(profile.tls?.passphrase);
    return { ...profile, password: profile.password ?? this.readSecret(id, 'password'), ssh: profile.ssh ? { ...profile.ssh, password: profile.ssh.password ?? this.readSecret(id, 'sshPassword'), passphrase: profile.ssh.passphrase ?? this.readSecret(id, 'sshPassphrase') } : undefined,
      ...(profile.tls ? { tls: { ...profile.tls, passphrase: profile.tls.passphrase ?? this.readSecret(id, 'tlsPassphrase') } } : {}) };
  }

  /** 删除连接时同时移除其密文和会话内秘密。 */
  deleteConnection(id: string): void {
    this.mutate(() => {
      this.db.run('DELETE FROM connections WHERE id=?', [id]); this.db.run('DELETE FROM secrets WHERE connection_id=?', [id]);
      this.db.run('DELETE FROM table_preferences WHERE connection_id=?', [id]);
      this.db.run('DELETE FROM table_presets WHERE connection_id=?', [id]);
      this.db.run('DELETE FROM query_result_presets WHERE connection_id=?', [id]);
      for (const key of this.volatileSecrets.keys()) if (key.startsWith(`${id}\0`)) this.volatileSecrets.delete(key);
    });
    this.connectionRevisionValue++;
  }
  /** 表偏好只属于已保存连接；校验精确身份，不读取凭据或建立数据库连接。 */
  private preferenceTarget(input: TablePreferenceTarget): TablePreferenceTarget {
    const target = tablePreferenceTargetSchema.parse(input);
    const statement = this.db.prepare('SELECT 1 FROM connections WHERE id=?');
    try { statement.bind([target.connectionId]); if (!statement.step()) throw new Error('连接不存在，无法读取或保存表偏好'); }
    finally { statement.free(); }
    return target;
  }
  /** 已知连接的未保存表返回 null，损坏的布局明确报错，不伪装为空配置。 */
  tablePreferences(input: TablePreferenceTarget): TablePreferences | null {
    const target = this.preferenceTarget(input);
    const value = this.records<TablePreferences>('SELECT data FROM table_preferences WHERE connection_id=? AND database_name=? AND table_name=?', [target.connectionId, target.database, target.table])[0];
    if (value === undefined) return null;
    const preferences = tablePreferencesSchema.parse(value);
    validateTablePreferenceBudget(0, 0, target, preferences);
    return preferences;
  }
  /** 独立主键更新不会被工作区快照覆盖；预算同时计算 UTF-8 数据及三个身份字段。 */
  saveTablePreferences(input: TablePreferenceTarget & { preferences: TablePreferences }): TablePreferences {
    const parsed = tablePreferenceSaveSchema.parse(input);
    const target = this.preferenceTarget({ connectionId: parsed.connectionId, database: parsed.database, table: parsed.table });
    this.mutate(() => {
      const statement = this.db.prepare('SELECT COUNT(*),COALESCE(SUM(length(CAST(connection_id AS BLOB))+length(CAST(database_name AS BLOB))+length(CAST(table_name AS BLOB))+length(CAST(data AS BLOB))),0) FROM table_preferences WHERE NOT(connection_id=? AND database_name=? AND table_name=?)');
      try {
        statement.bind([target.connectionId, target.database, target.table]); statement.step();
        const [count, bytes] = statement.get(); validateTablePreferenceBudget(Number(count), Number(bytes), target, parsed.preferences);
      } finally { statement.free(); }
      this.db.run('INSERT INTO table_preferences VALUES (?,?,?,?) ON CONFLICT(connection_id,database_name,table_name) DO UPDATE SET data=excluded.data', [target.connectionId, target.database, target.table, JSON.stringify(parsed.preferences)]);
    });
    return parsed.preferences;
  }
  /** 仅重置精确目标的布局，已知连接的空记录可重复重置，其他设置和表数据不变。 */
  resetTablePreferences(input: TablePreferenceTarget): void {
    const target = this.preferenceTarget(input);
    this.mutate(() => this.db.run('DELETE FROM table_preferences WHERE connection_id=? AND database_name=? AND table_name=?', [target.connectionId, target.database, target.table]));
  }
  /** 按更新时间返回保存的查询。 */
  queries(): SavedQuery[] { return this.records('SELECT data FROM queries ORDER BY updated_at DESC'); }
  /** 搜索绑定查询及连接库修订；失败写盘不会改变修订。 */
  querySearchRevision():string{return this.queryRevisionValue+':'+this.connectionRevisionValue+':'+readSavedQueryOrganization(this.db).revision;}
  /** 分组CAS同时绑定整个查询库和组织修订；读取只统计元数据，不解密连接。 */
  queryOrganization() { return savedQueryOrganizationSnapshot(this.db, this.queryOrganizationRevision()); }
  /** 每次重启更换世代，防止旧渲染文档或ABA修订重新获得写入资格。 */
  private queryOrganizationRevision(): string { return savedQueryOrganizationRevision(readSavedQueryOrganization(this.db), this.queryRevisionValue, this.queryOrganizationGeneration); }
  /** 同步CAS及所有成员摘要在一次真实SQLite事务核对，写盘失败不推进任何修订。 */
  applyQueryOrganization(raw: SavedQueryOrganizationApply) {
    const input = savedQueryOrganizationApplySchema.parse(raw);
    if (input.expectedRevision !== this.queryOrganizationRevision()) throw Error('保存查询库或分组已变化，请刷新后重试');
    const createdId = input.operation.kind === 'create' ? randomUUID() : undefined;
    this.mutate(() => {
      if (input.expectedRevision !== this.queryOrganizationRevision()) throw Error('保存查询库或分组已变化，请刷新后重试');
      applySavedQueryOrganization(this.db, input.operation, createdId, id => this.querySearchRaw(id));
    });
    return this.queryOrganization();
  }
  /** 二进制主键位置分页，仅取一条正文及下一条存在性，不复制整个查询库。 */
  querySearchNext(after?:string):{id:string;raw:string|null;hasMore:boolean}|null{const statement=this.db.prepare('SELECT id,CASE WHEN length(CAST(data AS BLOB))<=? THEN data ELSE NULL END AS data FROM queries '+(after===undefined?'':'WHERE id COLLATE BINARY>? ')+'ORDER BY id COLLATE BINARY LIMIT 2');try{statement.bind(after===undefined?[savedQuerySearchLimits.recordBytes]:[savedQuerySearchLimits.recordBytes,after]);if(!statement.step())return null;const row=statement.getAsObject();return{id:String(row.id),raw:typeof row.data==='string'?row.data:null,hasMore:statement.step()};}finally{statement.free();}}
  /** 更新时间与ID均降序，复合索引定位下一条，不用OFFSET或复制整页正文数组。 */
  queryPageNext(after?:SavedQueryPagePosition,input?:{group?:SavedQueryGroupScope}):{id:string;updatedAt:string;raw:string|null;hasMore:boolean;groupId?:string}|null{
    const ids=savedQueryGroupIds(readSavedQueryOrganization(this.db).groups,input?.group??{kind:'all'}),scope=savedQueryMembershipCondition(ids),conditions:string[]=[],params:SqlValue[]=[savedQuerySearchLimits.recordBytes];
    if(scope.condition){conditions.push(scope.condition);params.push(...scope.params);}
    if(after){conditions.push('(q.updated_at COLLATE BINARY,q.id COLLATE BINARY)<(?,?)');params.push(after.updatedAt,after.id);}
    const statement=this.db.prepare('SELECT q.id,q.updated_at,m.group_id,CASE WHEN length(CAST(q.data AS BLOB))<=? THEN q.data ELSE NULL END AS data FROM queries q LEFT JOIN saved_query_memberships m ON m.query_id=q.id '+(conditions.length?'WHERE '+conditions.join(' AND ')+' ':'')+'ORDER BY q.updated_at COLLATE BINARY DESC,q.id COLLATE BINARY DESC LIMIT 2');
    try{statement.bind(params);if(!statement.step())return null;const row=statement.getAsObject();return{id:String(row.id),updatedAt:String(row.updated_at),raw:typeof row.data==='string'?row.data:null,...(typeof row.group_id==='string'?{groupId:row.group_id}:{}),hasMore:statement.step()};}finally{statement.free();}
  }
  /** 只在明确打开时读取一条当前原文，过大记录不会进入渲染进程。 */
  querySearchRaw(id:string):string|undefined{const statement=this.db.prepare('SELECT CASE WHEN length(CAST(data AS BLOB))<=? THEN data ELSE NULL END FROM queries WHERE id=?');try{statement.bind([savedQuerySearchLimits.recordBytes,id]);if(!statement.step())return;const raw=statement.get()[0];if(typeof raw!=='string')throw Error('保存查询记录超过128MiB');return raw;}finally{statement.free();}}
  /** 打开查询只核本地连接存在性，不解密密码或尝试数据库网络连接。 */
  queryConnectionExists(id:string):boolean{const statement=this.db.prepare('SELECT 1 FROM connections WHERE id=?');try{statement.bind([id]);return statement.step();}finally{statement.free();}}
  /** 单独读取片段库，不扩大全局工作台快照。 */
  snippets(): SqlSnippet[] { return this.records('SELECT data FROM sql_snippets ORDER BY updated_at DESC,id'); }
  /** 校验数量与正文预算，保存失败使用统一事务快照回退。 */
  saveSnippet(input: SqlSnippet): SqlSnippet {
    const snippet = validateSnippetBudget(this.snippets(), { ...input, updatedAt: new Date().toISOString() });
    this.mutate(() => this.db.run('INSERT INTO sql_snippets VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at', [snippet.id, JSON.stringify(snippet), snippet.updatedAt]));
    this.snippetRevisionValue++;
    return snippet;
  }
  /** 删除片段不会改动查询正文、历史或连接。 */
  deleteSnippet(id: string): void { this.mutate(() => this.db.run('DELETE FROM sql_snippets WHERE id=?', [id])); this.snippetRevisionValue++; }
  /** 修订只在成功落盘后推进，片段往返修改也使旧导入预览失效。 */
  snippetRevision(): number { return this.snippetRevisionValue; }
  /** 一批替换/新增共用原mutate的内存快照、事务及原子文件替换；失败不留下部分行。 */
  applySnippetBatch(input: SqlSnippet[], revision: number, current: () => void): void {
    current(); if (revision !== this.snippetRevisionValue) throw Error(snippetTransferZh.stale);
    const incoming = validateSnippetCollection(input), ids = new Set(incoming.map(s => s.id));
    validateSnippetCollection([...this.snippets().filter(s => !ids.has(s.id)), ...incoming]);
    if (!incoming.length) return;
    const timestamp = new Date().toISOString();
    this.mutate(() => {
      current(); if (revision !== this.snippetRevisionValue) throw Error(snippetTransferZh.stale);
      for (const snippet of incoming) { const saved = { ...snippet, updatedAt: timestamp }; this.db.run('INSERT INTO sql_snippets VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at', [saved.id, JSON.stringify(saved), timestamp]); }
      current();
    });
    this.snippetRevisionValue++;
  }
  /** 查询正文和来源连接一起原子保存。 */
  saveQuery(query: SavedQuery): void { this.mutate(() => this.db.run('INSERT INTO queries VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at', [query.id, JSON.stringify(query), query.updatedAt]));this.queryRevisionValue++; }
  /** 来源身份只读取当前连接的公开路由字段，不通过 resolveConnection 解密凭据。 */
  private querySourceProfile(id?: string): ConnectionProfile | undefined {
    return id ? this.records<ConnectionProfile>('SELECT data FROM connections WHERE id=?', [id])[0] : undefined;
  }
  /** 明确打开后绑定所见原文；不保存正文副本、搜索条件或认证内容。 */
  bindQuerySource(id: string, digest: string) {
    const raw = this.querySearchRaw(id);
    if (raw === undefined) throw Error('原查询已删除，请重新打开列表');
    if (createHash('sha256').update(raw).digest('hex') !== digest) throw Error('原查询已修改，请重新打开后编辑');
    const query = parseSavedQueryRecord(id, raw);
    return bindSavedQuery(query, raw, this.querySourceProfile(query.connectionId));
  }
  /** 保留上下文类别，所有新记录和更新使用同一正文及存储体积校验。 */
  private boundQueryRecord(id: string, content: QuerySaveContent): SavedQuery {
    const context = content.context;
    const query: SavedQuery = { id, name: content.name, ...(content.connectionId ? { connectionId: content.connectionId } : {}), sql: content.sql, updatedAt: new Date().toISOString(),
      ...(context.state === 'legacy' ? context.database === undefined ? {} : { database: context.database } : { databaseContext: { ...context }, ...(context.state === 'known' && context.database !== null ? { database: context.database } : {}) }) };
    return parseSavedQueryRecord(id, JSON.stringify(query));
  }
  /** 新建由主进程分配编号，绝不 upsert 或复用查询标签编号。 */
  createBoundQuery(raw: unknown): QuerySaveResult {
    const content = querySaveContentSchema.parse(raw), query = this.boundQueryRecord(randomUUID(), content);
    let profile: ConnectionProfile | undefined;
    this.mutate(() => {
      profile = this.querySourceProfile(content.connectionId);
      if (content.connectionId && !profile) throw Error('当前连接已删除，请选择有效连接后另存');
      this.db.run('INSERT INTO queries VALUES (?,?,?)', [query.id, JSON.stringify(query), query.updatedAt]);
    });
    this.queryRevisionValue++;
    return { name: query.name, source: bindSavedQuery(query, JSON.stringify(query), profile) };
  }
  /** 原文摘要、连接身份及四类上下文在同一 SQLite 事务内核对，失败恢复内存和磁盘。 */
  updateBoundQuery(raw: unknown): QuerySaveResult {
    const input = queryUpdateSourceSchema.parse(raw), { source, content } = input;
    const query = this.boundQueryRecord(source.id, content); let profile: ConnectionProfile | undefined;
    this.mutate(() => {
      const previous = this.querySearchRaw(source.id);
      if (previous === undefined) throw Error('原查询已删除；请另存为新查询，不会恢复或覆盖原记录');
      if (createHash('sha256').update(previous).digest('hex') !== source.digest) throw Error('原查询已修改；本次未覆盖，请重新打开或另存为新查询');
      const current = parseSavedQueryRecord(source.id, previous), context = savedQueryOriginContext(current.database, current.databaseContext);
      if (source.connectionId !== current.connectionId || content.connectionId !== current.connectionId || !sameSavedQueryContext(source.context, context) || !sameSavedQueryContext(content.context, context)) throw Error('来源连接或默认库状态已变化；请另存为新查询');
      profile = this.querySourceProfile(current.connectionId);
      if (current.connectionId && (!profile || !source.connectionDigest || queryConnectionDigest(profile) !== source.connectionDigest)) throw Error('来源连接已删除或配置已变化；请重新打开或另存为新查询');
      this.db.run('UPDATE queries SET data=?,updated_at=? WHERE id=?', [JSON.stringify(query), query.updatedAt, source.id]);
    });
    this.queryRevisionValue++;
    return { name: query.name, source: bindSavedQuery(query, JSON.stringify(query), profile) };
  }
  /** 旧命令仅兼容新建；已有记录必须提供所见摘要，不能旁路来源更新保护。 */
  createLegacyQuery(query: SavedQuery): void {
    const parsed = parseSavedQueryRecord(query.id, JSON.stringify(query));
    this.mutate(() => {
      if (this.querySearchRaw(parsed.id) !== undefined) throw Error('原查询已存在，更新必须使用来源摘要核对；请从保存查询入口打开');
      this.db.run('INSERT INTO queries VALUES (?,?,?)', [parsed.id, JSON.stringify(parsed), parsed.updatedAt]);
    });
    this.queryRevisionValue++;
  }
  /** 只删除指定查询，不影响数据库或执行历史。 */
  deleteQuery(id: string): void { this.mutate(() => { this.db.run('DELETE FROM saved_query_memberships WHERE query_id=?', [id]); this.db.run('DELETE FROM queries WHERE id=?', [id]); });this.queryRevisionValue++; }
  /** 历史显示限制为最近 500 条，可以按连接筛选。 */
  history(connectionId?: string): HistoryEntry[] { return this.records(`SELECT data FROM history ${connectionId ? 'WHERE connection_id=?' : ''} ORDER BY started_at DESC LIMIT 500`, connectionId ? [connectionId] : []); }
  /** 历史或连接成功变化即失效旧页；写盘失败不改变本地修订。 */
  historyPageRevision():string{return this.historyRevisionValue+':'+this.connectionRevisionValue;}
  /** 精确读取原索引和有界原文，不能把坏索引或超限正文转换成有效历史。 */
  historyDeleteRecord(id: string): { id: string; startedAt: string; connectionId: string; raw: string | null } | undefined {
    if (typeof id !== 'string' || !id.length || id.length > 200) throw Error(historyDeleteText.invalidRecord);
    const statement = this.db.prepare('SELECT id,connection_id,started_at,CASE WHEN length(CAST(data AS BLOB))<=? THEN data ELSE NULL END AS data FROM history WHERE id COLLATE BINARY=?');
    try {
      statement.bind([savedQuerySearchLimits.recordBytes, id]);
      if (!statement.step()) return;
      const row = statement.getAsObject();
      if (typeof row.id !== 'string' || row.id !== id || typeof row.started_at !== 'string' || typeof row.connection_id !== 'string') throw Error(historyDeleteText.invalidRecord);
      return { id: row.id, startedAt: row.started_at, connectionId: row.connection_id, raw: typeof row.data === 'string' ? row.data : null };
    } finally { statement.free(); }
  }
  /** 仅删除预览授权的精确ID；整批原文、索引和来源均确认后才执行第一条删除。 */
  deleteHistorySnapshot(expectedRevision: string, refs: readonly HistoryDeleteReference[], assertCurrent: () => void): number {
    const references = historyDeleteReferences(refs);
    const current = () => {
      assertCurrent();
      if (expectedRevision !== this.historyPageRevision() || !Number.isSafeInteger(this.historyRevisionValue) || this.historyRevisionValue < 0 || this.historyRevisionValue >= Number.MAX_SAFE_INTEGER) throw Error(historyDeleteText.stale);
    };
    current();
    this.mutate(() => {
      current(); let total = 0;
      for (const reference of references) {
        current();
        const row = this.historyDeleteRecord(reference.id);
        if (!row) throw Error(historyDeleteText.missing);
        if (row.raw === null) throw Error(historyDeleteText.budget);
        total = historyDeleteByteTotal(total, Buffer.byteLength(row.raw));
        const entry = parseHistoryRecord(row.id, row.raw);
        if (entry.startedAt !== row.startedAt || (entry.connectionId ?? '') !== row.connectionId) throw Error(historyDeleteText.invalidRecord);
        if (createHash('sha256').update(row.raw).digest('hex') !== reference.digest) throw Error(historyDeleteText.stale);
      }
      current();
      for (const reference of references) {
        this.db.run('DELETE FROM history WHERE id COLLATE BINARY=?', [reference.id]);
        if (this.db.getRowsModified() !== 1) throw Error(historyDeleteText.stale);
      }
    }, current);
    // 只在原子文件替换完成后推进一次修订，任何回滚都保留原预览修订。
    this.historyRevisionValue++;
    return references.length;
  }
  /** 原始时间与ID复合键分页，范围用参数绑定；一次只交付一条完整记录。 */
  historyPageNext(after:HistoryPagePosition|undefined,input:HistoryPageInput):{id:string;startedAt:string;connectionId:string;raw:string|null;hasMore:boolean}|null{
    const conditions:string[]=[],params:SqlValue[]=[savedQuerySearchLimits.recordBytes];
    if(input.scope.kind!=='all'){conditions.push('connection_id COLLATE BINARY=?');params.push(input.scope.kind==='connection'?input.scope.connectionId:'');}
    if(after){conditions.push('(started_at COLLATE BINARY,id COLLATE BINARY)<(?,?)');params.push(after.startedAt,after.id);}
    const statement=this.db.prepare('SELECT id,connection_id,started_at,CASE WHEN length(CAST(data AS BLOB))<=? THEN data ELSE NULL END AS data FROM history '+(conditions.length?'WHERE '+conditions.join(' AND ')+' ':'')+'ORDER BY started_at COLLATE BINARY DESC,id COLLATE BINARY DESC LIMIT 2');
    try{statement.bind(params);if(!statement.step())return null;const row=statement.getAsObject();return{id:String(row.id),startedAt:String(row.started_at),connectionId:String(row.connection_id),raw:typeof row.data==='string'?row.data:null,hasMore:statement.step()};}finally{statement.free();}
  }
  /** 显式打开或查看错误才读取单条当前原文，不把全量正文带进列表。 */
  historyRaw(id:string):string|undefined{const statement=this.db.prepare('SELECT CASE WHEN length(CAST(data AS BLOB))<=? THEN data ELSE NULL END FROM history WHERE id=?');try{statement.bind([savedQuerySearchLimits.recordBytes,id]);if(!statement.step())return;const raw=statement.get()[0];if(typeof raw!=='string')throw Error('执行历史记录超过128MiB');return raw;}finally{statement.free();}}
  /** 写入执行历史并限制总量，避免配置文件持续膨胀。 */
  addHistory(entry: HistoryEntry): void { this.mutate(() => { this.db.run('INSERT INTO history VALUES (?,?,?,?)', [entry.id, entry.connectionId, JSON.stringify(entry), entry.startedAt]); this.db.run('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY started_at COLLATE BINARY DESC,id COLLATE BINARY DESC LIMIT 1000)'); });this.historyRevisionValue++; }
  /** 独立提交回执不被普通任务挤占；未知/执行中不淘汰，满时写入失败先于派发。 */
  saveTableApplyReceipt(input: TableApplyReceipt): void {
    const receipt = parseTableApplyReceipt(input);
    this.mutate(() => {
      const records = this.records<TableApplyReceipt>('SELECT data FROM table_apply_receipts').map(parseTableApplyReceipt);
      const old = records.find(r => r.operationId === receipt.operationId);
      if (old && (old.taskId !== receipt.taskId || old.previewId !== receipt.previewId || JSON.stringify(old.target) !== JSON.stringify(receipt.target))) throw Error('提交记录身份不能替换');
      if (!old && records.length >= tableApplyReceiptLimits.records) {
        const evict = records.filter(r => r.phase === 'terminal' && r.outcome !== 'unknown').sort((a,b) => a.startedAt.localeCompare(b.startedAt) || a.operationId.localeCompare(b.operationId))[0];
        if (!evict) throw Error('提交记录已满，未知或执行中记录不能自动删除；未派发本批数据写入');
        this.db.run('DELETE FROM table_apply_receipts WHERE id=?', [evict.operationId]);
      }
      this.db.run('INSERT INTO table_apply_receipts VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [receipt.operationId, JSON.stringify(receipt), receipt.startedAt]);
    });
  }
  /** 只读稳定分页，不含SQL、字段值和原始错误。 */
  tableApplyReceipts(input: TableApplyReceiptListInput): TableApplyReceiptPage {
    const page = input.page ?? 0;
    const rows = this.records<TableApplyReceipt>('SELECT data FROM table_apply_receipts ORDER BY started_at DESC,id DESC').map(parseTableApplyReceipt).filter(r => (!input.outcome || r.outcome === input.outcome) && (!input.connectionId || r.target.connectionId === input.connectionId) && (!input.taskId || r.taskId === input.taskId));
    return { items: rows.slice(page * 25, (page + 1) * 25), total: rows.length, page };
  }
  /** 详情只按随机操作ID读取，不提供重放写入接口。 */
  tableApplyReceipt(operationId: string): TableApplyReceipt {
    const statement = this.db.prepare('SELECT data FROM table_apply_receipts WHERE id=?');
    try { statement.bind([operationId]); if (!statement.step()) throw Error('提交记录不存在或已超出保留范围'); return parseTableApplyReceipt(JSON.parse(String(statement.get()[0]))); } finally { statement.free(); }
  }
  /** 只返回近期任务概要，不持久化完整查询结果。 */
  tasks(): TaskRecord[] { return this.records('SELECT data FROM tasks ORDER BY started_at DESC LIMIT 200'); }
  /** 更新任务概要并保留至多 200 条记录。 */
  saveTask(task: TaskRecord): void { this.mutate(() => { this.db.run('INSERT INTO tasks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [task.id, JSON.stringify(task), task.startedAt]); this.db.run('DELETE FROM tasks WHERE id NOT IN (SELECT id FROM tasks ORDER BY started_at DESC LIMIT 200)'); }); }
  /** 合并默认偏好，兼容缺少新增配置字段的旧记录。 */
  settings(): AppSettings {
    const stored = this.records<AppSettings>('SELECT data FROM settings WHERE id=1')[0];
    // 高度只处理对应标签：缺项保持缺项，坏值局部回退；表标签移除不适用字段，不写回。
    const tabs = Array.isArray(stored?.tabs) ? stored.tabs.map(tab => {
      if (!tab || typeof tab !== 'object' || !Object.hasOwn(tab, 'queryEditorHeight')) return tab;
      if (tab.kind === 'query') return { ...tab, queryEditorHeight: readQueryEditorHeight(tab.queryEditorHeight) };
      const { queryEditorHeight: _height, ...unchanged } = tab; return unchanged;
    }) : stored?.tabs ?? defaultSettings.tabs;
    // 旧颜色标志只认true；缺项或损坏字号回退13，不迁移数据库或隐式强转。
    return { ...defaultSettings, ...stored, tabs: this.queryFileCanonicalTabs(tabs), dataTypeColors: stored?.dataTypeColors === true, editorFontSize: readEditorFontSize(stored?.editorFontSize), editorWordWrap: readEditorWordWrap(stored?.editorWordWrap), editorTabSize: readEditorTabSize(stored?.editorTabSize), editorInsertSpaces: readEditorInsertSpaces(stored?.editorInsertSpaces), ...(stored && Object.hasOwn(stored, 'sqlKeywordCase') ? { sqlKeywordCase: readSqlKeywordCase(stored.sqlKeywordCase) } : {}) };
  }
  /** 独立配置表按需创建，旧库无收藏时返回空配置，不把秘密或工作区 SQL 混入收藏。 */
  workbench(): WorkbenchSnapshot {
    const document = this.records<unknown>('SELECT data FROM workbench WHERE id=1')[0];
    if (document === undefined) return { revision: 0, document: emptyWorkbench() };
    const revision = Number(this.db.exec('SELECT revision FROM workbench WHERE id=1')[0].values[0][0]);
    return { revision, document: workbenchDocumentSchema.parse(document) };
  }
  /** 修订检查与原子落盘共用事务回退，过期界面不能覆盖更新后的收藏或专注状态。 */
  saveWorkbench(input: WorkbenchSnapshot): WorkbenchSnapshot {
    const parsed = workbenchSaveSchema.parse(input);
    const revision = parsed.revision + 1;
    this.mutate(() => {
      if (this.workbench().revision !== parsed.revision) throw new Error('收藏配置已变化，请重新读取后重试');
      this.db.run('INSERT INTO workbench VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data', [revision, JSON.stringify(parsed.document)]);
    });
    return { revision, document: parsed.document };
  }
  /** 保存工作台快照；失败不会留下待下次提交的内存修改。 */
  saveSettings(settings: AppSettings): void {
    // 新缩进字段缺项兼容旧调用；显式坏值先拒绝，不能进入事务或写盘。
    assertEditorIndentationWrite(settings);
    assertSqlKeywordCaseWrite(settings);
    assertQueryLayoutWrite(settings);
    assertQueryFileSourceSettings(settings);
    // 直接存储入口同样拒绝非布尔值；未指定的旧调用仍兼容默认关闭。
    if (settings.dataTypeColors !== undefined && typeof settings.dataTypeColors !== 'boolean') throw new Error('类型颜色偏好必须是布尔值');
    // 兼容缺项的旧调用；显式字号不得越界或借字符串/小数绕过IPC。
    if (settings.editorFontSize !== undefined) assertEditorFontSize(settings.editorFontSize);
    // 只兼容缺项，显式非法换行值必须在任何持久化变更前拒绝。
    if (settings.editorWordWrap !== undefined) assertEditorWordWrap(settings.editorWordWrap);
    const previous = this.settings().tabs;
    this.mutate(() => {
      // 只删除可证明属于已移除文档的精确授权，损坏记录不猜测归属。
      for (const tab of previous) {
        let source: PrivateQueryFileSource | undefined;
        try { source = this.queryFileSource(tab.id); } catch { continue; }
        if (source && !settings.tabs.some(next => next.id === tab.id && next.kind === 'query' && next.connectionId === source!.connectionId)) this.db.run('DELETE FROM query_file_sources WHERE tab_id=? AND id=? AND revision=?', [tab.id, source.ref.id, source.ref.revision]);
      }
      const canonical = { ...settings, tabs: this.queryFileCanonicalTabs(settings.tabs) };
      this.db.run('INSERT INTO settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [JSON.stringify(canonical)]);
    });
    for (const tab of previous) {
      const next = settings.tabs.find(next => next.id === tab.id);
      if (!next || next.kind !== tab.kind || next.connectionId !== tab.connectionId) {
        // 文档令牌已经失效，关闭或重建后不再保留其重载世代，避免随历史标签累计。
        this.queryFileDocuments.delete(tab.id); this.queryFileReloadGenerations.delete(tab.id); continue;
      }
      // 成功的SQL/上下文/来源往返也推进重载世代；现有保存租约仍允许正文继续编辑。
      if (!next || next.sql !== tab.sql || next.connectionId !== tab.connectionId || next.database !== tab.database || JSON.stringify(next.databaseContext) !== JSON.stringify(tab.databaseContext) || !sameQueryFileSource(next.fileSourceBinding, tab.fileSourceBinding) || next.sourceBinding !== tab.sourceBinding) this.queryFileReloadGenerations.set(tab.id, (this.queryFileReloadGenerations.get(tab.id) ?? 0) + 1);
    }
  }
  /** 仅按本地私有表读取授权，坏记录只报错，不删除正文或猜测路径。 */
  queryFileSource(tabId: string): PrivateQueryFileSource | undefined {
    const statement = this.db.prepare('SELECT id,revision,data FROM query_file_sources WHERE tab_id=?');
    try {
      statement.bind([tabId]); if (!statement.step()) return undefined;
      const [id, revision, data] = statement.get();
      const source = privateQueryFileSourceSchema.parse(JSON.parse(String(data)));
      if (source.tabId !== tabId || source.ref.id !== id || source.ref.revision !== revision) throw Error('文件来源索引与正文不一致');
      return source;
    } catch { throw Error('私有文件来源损坏，查询正文保持，请明确另行处理来源'); }
    finally { statement.free(); }
  }
  /** 只供Main检查同文件另存冲突和预算，不进入公开配置接口。 */
  queryFileSourceRecords(): PrivateQueryFileSource[] {
    return this.db.exec('SELECT tab_id FROM query_file_sources')[0]?.values.map(([id]) => this.queryFileSource(String(id))!) ?? [];
  }
  /** 可选元数据缓存向后兼容schema9；首次显式读取从现有Main来源补齐，不探测任何SQL文件。 */
  private recentQueryFileRecords(): PrivateQueryRecentFile[] {
    const record = this.records<unknown>('SELECT data FROM query_file_recents WHERE id=1')[0];
    if (record !== undefined) return privateQueryRecentFilesSchema.parse(record);
    let entries: PrivateQueryRecentFile[] = [];
    for (const source of this.queryFileSourceRecords()) entries = rememberQueryFile(entries, source);
    return entries;
  }
  /** 只访问本地元数据；首次补齐会落盘固定ID，失败不交付临时ID，已有缓存再读取不写盘。 */
  queryRecentFiles(): PrivateQueryRecentFile[] {
    try {
      const entries = this.recentQueryFileRecords();
      if (!this.db.exec('SELECT id FROM query_file_recents WHERE id=1').length) this.mutate(() => this.db.run('INSERT INTO query_file_recents VALUES (1,?)', [JSON.stringify(entries)]));
      return entries;
    } catch { throw Error('最近SQL文件记录不可读取或初始化未保存，文件和草稿保持；可关闭后使用普通文件入口，并在本地配置恢复后重试最近列表'); }
  }
  /** 仅Main由不透明ID解析已保存路径，未知或已移除的ID不能推断为任意路径。 */
  queryRecentFile(id: string): PrivateQueryRecentFile | undefined { return this.queryRecentFiles().find(item => item.id === id); }
  /** 移除仅修改最近记录，不删除磁盘文件，也不释放任何当前标签的文件来源。 */
  forgetRecentFile(id: string): boolean {
    const entries = this.queryRecentFiles(), next = entries.filter(item => item.id !== id);
    if (next.length === entries.length) return false;
    this.mutate(() => this.db.run('INSERT INTO query_file_recents VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [JSON.stringify(next)]));
    return true;
  }
  /** settings展示仅由私有表投影引用，旧回包和renderer伪造引用不能覆盖权威修订。 */
  private queryFileCanonicalTabs(tabs: AppSettings['tabs']): AppSettings['tabs'] {
    return tabs.map(tab => {
      if (!tab || typeof tab !== 'object') return tab;
      const { fileSourceBinding: _untrusted, ...plain } = tab;
      if (tab.kind !== 'query') return plain;
      try {
        const source = this.queryFileSource(tab.id);
        if (!source || source.connectionId !== tab.connectionId) return plain;
        // 明确建立文件来源时原子切换主来源；旧本地查询条目本身不删除。
        const { sourceBinding: _localSource, ...fileTab } = plain; return { ...fileTab, fileSourceBinding: { ...source.ref } };
      }
      catch { return plain; }
    });
  }
  /** 文档代次不受正文输入影响；关闭后同tabId重新打开不能借用旧操作。 */
  queryFileDocument(tabId: string): { token: object; tab: AppSettings['tabs'][number]; generation?: number } {
    // 分块IO的每个await都核文档，但不能每次重解析最多20MiB正文；任何本地事务后失效重取。
    const tabs = (this.queryFileDocumentSnapshot ??= this.settings().tabs).filter(tab => tab.id === tabId);
    if (tabs.length !== 1 || tabs[0].kind !== 'query') throw Error('查询文档不存在或身份不唯一');
    let token = this.queryFileDocuments.get(tabId); if (!token) { token = {}; this.queryFileDocuments.set(tabId, token); }
    return { token, tab: { ...tabs[0] }, generation: this.queryFileReloadGenerations.get(tabId) ?? 0 };
  }
  /** 读取先核旧SQL；只有首次打开提供sql接管占位，重读只原子更新来源而保留原文。 */
  commitQueryFileSource(value: PrivateQueryFileSource, expected?: QueryFileSourceRef, opened?: { previousSql: string; sql?: string }): void {
    const source = privateQueryFileSourceSchema.parse(value), current = this.queryFileSource(source.tabId);
    if (!sameQueryFileSource(current?.ref, expected)) throw Error('文件来源修订已变化');
    const document = this.queryFileDocument(source.tabId);
    if (document.tab.connectionId !== source.connectionId || opened && (document.tab.sql ?? '') !== opened.previousSql) throw Error('查询文档已变化');
    if (!current && this.queryFileSourceRecords().length >= 100) throw Error('文件来源数量超过预算');
    this.mutate(() => {
      this.db.run('INSERT INTO query_file_sources VALUES (?,?,?,?) ON CONFLICT(tab_id) DO UPDATE SET id=excluded.id,revision=excluded.revision,data=excluded.data', [source.tabId, source.ref.id, source.ref.revision, JSON.stringify(source)]);
      const settings = this.settings();
      const openedSql = opened?.sql;
      if (openedSql !== undefined) settings.tabs = settings.tabs.map(tab => tab.id === source.tabId ? { ...tab, sql: openedSql } : tab);
      this.db.run('INSERT INTO settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [JSON.stringify(settings)]);
    });
    // 来源/settings的必需事务已成功落盘。可选历史在独立事务维护，不能回滚已确认的来源或改报文件失败。
    try {
      const previous = this.recentQueryFileRecords(), recent = rememberQueryFile(previous, source), payload = JSON.stringify(recent);
      // 同一路径/编码已置顶时不新增配置写盘；首次初始化即使内容相同仍须保存稳定ID。
      if (!this.db.exec('SELECT id FROM query_file_recents WHERE id=1').length || JSON.stringify(previous) !== payload) this.mutate(() => this.db.run('INSERT INTO query_file_recents VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [payload]));
    } catch {
      // 仅降级新增历史维护；坏记录或上次有效列表保持，显式进入最近列表时仍按其真实状态读取/报错。
      // 不重放文件写入，不自动清空坏缓存；上方必需事务的异常不在此catch范围内。
    }
  }
  /** 精确释放授权与settings引用，旧revision或未知归属均不删除后来来源。 */
  releaseQueryFileSource(tabId: string, ref: QueryFileSourceRef): boolean {
    queryFileSourceRefSchema.parse(ref);
    const current = this.queryFileSource(tabId); if (!current || !sameQueryFileSource(current.ref, ref)) return false;
    this.mutate(() => {
      this.db.run('DELETE FROM query_file_sources WHERE tab_id=? AND id=? AND revision=?', [tabId, ref.id, ref.revision]);
      const settings = this.settings();
      this.db.run('INSERT INTO settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [JSON.stringify(settings)]);
    });
    return true;
  }

  /** 关闭内存数据库并清除明文秘密，已成功保存的文件无需再次写入。 */
  close(): void { this.db.close(); this.volatileSecrets.clear(); }
}
