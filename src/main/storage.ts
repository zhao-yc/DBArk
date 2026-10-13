import { connectionTransferDocumentSchema, connectionTransferLimits, importConnectionProfile, type ExportedConnectionProfile } from '../shared/connectionTransfer';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppSettings, ConnectionProfile, HistoryEntry, SavedQuery, SqlSnippet, TaskRecord } from '../shared/contracts';
import { validateSnippetBudget } from '../shared/snippets';
import { tablePreferenceSaveSchema, tablePreferenceTargetSchema, tablePreferencesSchema, tablePreferenceTargetChanged, validateTablePreferenceBudget, type TablePreferenceTarget, type TablePreferences } from '../shared/tablePreferences';

export interface SecretProtector { available(): boolean; encrypt(value: string): string; decrypt(value: string): string; }
export const defaultSettings: AppSettings = { theme: 'dark', sidebarWidth: 270, resultLimit: 1000, pageSize: 200, tabs: [] };

/** 小型配置库在内存中运行 SQLite，写入时原子替换文件；无需打包本机 ABI 模块。 */
export class LocalStore {
  private connectionRevisionValue = 0;
  private volatileSecrets = new Map<string, string>();
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
    if (version > 4) throw new Error('配置库由更新版本的 DBArk 创建，请使用新版本打开');
    this.mutate(() => {
      this.db.run(`CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS secrets (connection_id TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(connection_id,name));
        CREATE TABLE IF NOT EXISTS queries (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, data TEXT NOT NULL, started_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL, started_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sql_snippets (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS table_preferences (connection_id TEXT NOT NULL, database_name TEXT NOT NULL, table_name TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(connection_id,database_name,table_name));
        PRAGMA user_version=4;`);
    });
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
  private flush(): void {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, this.db.export(), { mode: 0o600 });
    renameSync(temporary, this.path);
  }

  /** 文件写入失败时同时恢复内存数据库和会话凭据，防止后续保存悄悄提交失败操作。 */
  private mutate(action: () => void): void {
    const snapshot = this.db.export();
    const secrets = new Map(this.volatileSecrets);
    try {
      this.db.run('BEGIN'); action(); this.db.run('COMMIT'); this.flush();
    } catch (error) {
      try { this.db.run('ROLLBACK'); } catch { /* COMMIT 后的磁盘错误没有活动事务。 */ }
      this.db.close(); this.db = this.reopen(snapshot); this.volatileSecrets = secrets;
      throw new Error(`本地数据保存失败，修改未保存：${error instanceof Error ? error.message : String(error)}`);
    }
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
    if (remember && this.protector.available()) this.db.run('INSERT INTO secrets VALUES (?,?,?)', [connectionId, name, this.protector.encrypt(effective)]);
    else this.volatileSecrets.set(`${connectionId}\0${name}`, effective);
  }

  /** 返回界面的连接配置只携带是否存在凭据的标记。 */
  connections(): ConnectionProfile[] {
    return this.records<ConnectionProfile>('SELECT data FROM connections ORDER BY rowid').map(profile => ({ ...profile, hasPassword: this.hasSecret(profile.id, 'password'), ssh: profile.ssh ? { ...profile.ssh, hasPassword: this.hasSecret(profile.id, 'sshPassword'), hasPassphrase: this.hasSecret(profile.id, 'sshPassphrase') } : undefined }));
  }

  /** 把连接与秘密分开存储，保存失败时恢复两者原始状态。 */
  saveConnection(input: ConnectionProfile): ConnectionProfile {
    const profile = structuredClone({ ...input, id: input.id || randomUUID() });
    const previous = this.records<ConnectionProfile>('SELECT data FROM connections WHERE id=?', [profile.id])[0];
    const remember = profile.rememberPassword === true;
    this.mutate(() => {
      this.putSecret(profile.id, 'password', profile.password, remember);
      this.putSecret(profile.id, 'sshPassword', profile.ssh?.password, remember);
      this.putSecret(profile.id, 'sshPassphrase', profile.ssh?.passphrase, remember);
      delete profile.password; delete profile.hasPassword;
      if (profile.ssh) { delete profile.ssh.password; delete profile.ssh.passphrase; delete profile.ssh.hasPassword; delete profile.ssh.hasPassphrase; }
      // 更换数据库目标时与连接配置一起提交；磁盘失败不能先丢失原布局。
      if (previous && tablePreferenceTargetChanged(previous, profile)) this.db.run('DELETE FROM table_preferences WHERE connection_id=?', [profile.id]);
      this.db.run('INSERT INTO connections VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [profile.id, JSON.stringify(profile)]);
    });
    this.connectionRevisionValue++;
    return this.connections().find(x => x.id === profile.id)!;
  }

  /** 任意成功的连接配置或认证变更都会让导入预览失效，失败写盘不改变版本。 */
  connectionRevision(): number { return this.connectionRevisionValue; }

  /** 导入仅新增白名单概要；整批一次落盘，不读取、复制或保存任何秘密。 */
  importConnections(input: ExportedConnectionProfile[], allowIncomplete: boolean): ConnectionProfile[] {
    const document = connectionTransferDocumentSchema.parse({ format: 'DBArk-connections', version: 1, connections: input });
    if (Buffer.byteLength(JSON.stringify(document), 'utf8') > connectionTransferLimits.fileBytes) throw new Error('连接配置超过 2 MiB 上限');
    const profiles = document.connections.map(profile => importConnectionProfile(profile, randomUUID()));
    if (!allowIncomplete && profiles.some(profile => profile.pendingFiles?.length)) throw new Error('连接含待重新选择的认证文件，请明确确认暂存后再导入');
    this.mutate(() => { for (const profile of profiles) this.db.run('INSERT INTO connections VALUES (?,?)', [profile.id, JSON.stringify(profile)]); });
    this.connectionRevisionValue++;
    return profiles;
  }

  /** 明文只在主进程与数据库执行进程间传递，不交给渲染进程。 */
  resolveConnection(id: string, overrides?: ConnectionProfile): ConnectionProfile {
    const stored = this.connections().find(x => x.id === id);
    const profile = overrides ?? stored;
    if (!profile) throw new Error('连接不存在，请重新选择连接');
    return { ...profile, password: profile.password ?? this.readSecret(id, 'password'), ssh: profile.ssh ? { ...profile.ssh, password: profile.ssh.password ?? this.readSecret(id, 'sshPassword'), passphrase: profile.ssh.passphrase ?? this.readSecret(id, 'sshPassphrase') } : undefined };
  }

  /** 删除连接时同时移除其密文和会话内秘密。 */
  deleteConnection(id: string): void {
    this.mutate(() => {
      this.db.run('DELETE FROM connections WHERE id=?', [id]); this.db.run('DELETE FROM secrets WHERE connection_id=?', [id]);
      this.db.run('DELETE FROM table_preferences WHERE connection_id=?', [id]);
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
  /** 单独读取片段库，不扩大全局工作台快照。 */
  snippets(): SqlSnippet[] { return this.records('SELECT data FROM sql_snippets ORDER BY updated_at DESC,id'); }
  /** 校验数量与正文预算，保存失败使用统一事务快照回退。 */
  saveSnippet(input: SqlSnippet): SqlSnippet {
    const snippet = validateSnippetBudget(this.snippets(), { ...input, updatedAt: new Date().toISOString() });
    this.mutate(() => this.db.run('INSERT INTO sql_snippets VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at', [snippet.id, JSON.stringify(snippet), snippet.updatedAt]));
    return snippet;
  }
  /** 删除片段不会改动查询正文、历史或连接。 */
  deleteSnippet(id: string): void { this.mutate(() => this.db.run('DELETE FROM sql_snippets WHERE id=?', [id])); }
  /** 查询正文和来源连接一起原子保存。 */
  saveQuery(query: SavedQuery): void { this.mutate(() => this.db.run('INSERT INTO queries VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at', [query.id, JSON.stringify(query), query.updatedAt])); }
  /** 只删除指定查询，不影响数据库或执行历史。 */
  deleteQuery(id: string): void { this.mutate(() => this.db.run('DELETE FROM queries WHERE id=?', [id])); }
  /** 历史显示限制为最近 500 条，可以按连接筛选。 */
  history(connectionId?: string): HistoryEntry[] { return this.records(`SELECT data FROM history ${connectionId ? 'WHERE connection_id=?' : ''} ORDER BY started_at DESC LIMIT 500`, connectionId ? [connectionId] : []); }
  /** 写入执行历史并限制总量，避免配置文件持续膨胀。 */
  addHistory(entry: HistoryEntry): void { this.mutate(() => { this.db.run('INSERT INTO history VALUES (?,?,?,?)', [entry.id, entry.connectionId, JSON.stringify(entry), entry.startedAt]); this.db.run('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY started_at DESC LIMIT 1000)'); }); }
  /** 只返回近期任务概要，不持久化完整查询结果。 */
  tasks(): TaskRecord[] { return this.records('SELECT data FROM tasks ORDER BY started_at DESC LIMIT 200'); }
  /** 更新任务概要并保留至多 200 条记录。 */
  saveTask(task: TaskRecord): void { this.mutate(() => { this.db.run('INSERT INTO tasks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [task.id, JSON.stringify(task), task.startedAt]); this.db.run('DELETE FROM tasks WHERE id NOT IN (SELECT id FROM tasks ORDER BY started_at DESC LIMIT 200)'); }); }
  /** 合并默认偏好，兼容缺少新增配置字段的旧记录。 */
  settings(): AppSettings { return { ...defaultSettings, ...this.records<AppSettings>('SELECT data FROM settings WHERE id=1')[0] }; }
  /** 保存工作台快照；失败不会留下待下次提交的内存修改。 */
  saveSettings(settings: AppSettings): void { this.mutate(() => this.db.run('INSERT INTO settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [JSON.stringify(settings)])); }
  /** 关闭内存数据库并清除明文秘密，已成功保存的文件无需再次写入。 */
  close(): void { this.db.close(); this.volatileSecrets.clear(); }
}
